// Buzsu Social Publisher'ın Meta Ads MCP servisine (instagram-Facebook-connect,
// "buzsu-social-connect") konuştuğu tek merkezi katman. Hiçbir route bu dosyanın
// dışında JSON-RPC/MCP protokol detayı bilmemeli.
//
// Akış: initialize -> notifications/initialized -> tools/call -> (finally) DELETE session.
// MCP_PATH_SECRET upstream URL'nin path'ine gömülü olduğu için hiçbir hata mesajında,
// log satırında veya döndürülen nesnede ham görünmemeli — bu yüzden her hata redact()'ten geçer.

import { randomUUID } from "node:crypto";

const PROTOCOL_VERSION = "2025-03-26";
const CLIENT_INFO = { name: "buzsu-social-publisher", version: "1.0.0" };
const DEFAULT_CALL_TIMEOUT_MS = 22_000;
const CLEANUP_TIMEOUT_MS = 4_000;
const MAX_AD_PAGES = 20; // sonsuz döngü koruması: 20 sayfa * limit 100 = en fazla 2000 reklam

function connectSecret() {
  return process.env.META_CONNECT_MCP_PATH_SECRET || "";
}

function connectBaseUrl() {
  const base = process.env.META_CONNECT_URL || "";
  const secret = connectSecret();
  if (!base || !secret) {
    throw new Error("META_CONNECT_URL veya META_CONNECT_MCP_PATH_SECRET tanımlı değil.");
  }
  return `${base.replace(/\/+$/, "")}/mcp/${encodeURIComponent(secret)}`;
}

function redact(text) {
  const secret = connectSecret();
  const value = String(text ?? "");
  return secret ? value.split(secret).join("***") : value;
}

function redactedError(message, extra) {
  return Object.assign(new Error(redact(message)), extra || {});
}

// SSE ("text/event-stream") ve düz JSON cevaplarının ikisini de kabul eder —
// StreamableHTTPServerTransport isteğe göre ikisinden birini seçebilir.
function parseJsonRpcBody(contentType, raw) {
  if (!raw) return null;
  if (String(contentType || "").includes("text/event-stream")) {
    const dataLines = raw.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).filter(Boolean);
    const last = dataLines[dataLines.length - 1];
    return last ? JSON.parse(last) : null;
  }
  return JSON.parse(raw);
}

async function postJsonRpc(message, { sessionId, signal } = {}) {
  const url = connectBaseUrl();
  const headers = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };
  if (sessionId) headers["mcp-session-id"] = sessionId;

  let response;
  try {
    response = await fetch(url, { method: "POST", headers, body: JSON.stringify(message), signal });
  } catch (error) {
    if (error?.name === "AbortError") throw redactedError("Meta bağlantı servisi zamanında yanıt vermedi.", { code: "MCP_TIMEOUT" });
    throw redactedError(`Meta bağlantı servisine ulaşılamadı: ${error.message}`);
  }

  // Session id, gövde parse edilmeden ÖNCE header'dan okunuyor: sunucu
  // initialize sırasında session'ı gövde tamamlanmadan önce oluşturmuş olabilir.
  // Gövde parse/HTTP hatası sonradan patlasa bile, DELETE bu header ile denenebilsin.
  const sessionIdFromHeader = response.headers?.get?.("mcp-session-id") || undefined;

  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    throw redactedError(`MCP HTTP ${response.status}: ${bodyText || response.statusText || ""}`.trim(), { sessionId: sessionIdFromHeader });
  }

  const contentType = response.headers?.get?.("content-type") || "";
  const raw = await response.text();
  let body;
  try {
    body = parseJsonRpcBody(contentType, raw);
  } catch {
    throw redactedError("MCP servisinden gelen yanıt parse edilemedi.", { sessionId: sessionIdFromHeader });
  }

  return { body, sessionId: sessionIdFromHeader };
}

async function initializeSession(signal) {
  const { body, sessionId } = await postJsonRpc(
    {
      jsonrpc: "2.0",
      id: randomUUID(),
      method: "initialize",
      params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: CLIENT_INFO }
    },
    { signal }
  );

  if (!sessionId) {
    throw redactedError("MCP servisi initialize yanıtında oturum kimliği (mcp-session-id) döndürmedi.");
  }
  if (body?.error) {
    throw redactedError(`MCP initialize hatası: ${body.error.message || JSON.stringify(body.error)}`, { sessionId });
  }
  if (!body?.result) {
    throw redactedError("MCP initialize yanıtı geçersiz.", { sessionId });
  }

  // Bildirim tek yönlüdür (yanıt beklenmez, sunucu 202/boş dönebilir) — kendi
  // hatası asıl session'ı geçersiz kılmaz, akış session id ile devam eder.
  await postJsonRpc({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }, { sessionId, signal }).catch(() => {});

  return sessionId;
}

async function deleteSession(sessionId) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CLEANUP_TIMEOUT_MS);
  try {
    const url = connectBaseUrl();
    const response = await fetch(url, { method: "DELETE", headers: { "mcp-session-id": sessionId }, signal: controller.signal });
    if (!response.ok && response.status !== 404) {
      throw redactedError(`MCP DELETE HTTP ${response.status}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Tek bir MCP tool çağırır. Her çağrı kendi session'ını açar ve (başarı/hata
 * her ne olursa olsun) finally içinde kapatmayı dener. Cleanup hatası ne
 * başarılı sonucu ne de asıl tool hatasını asla ezmez — yalnızca redakte
 * edilmiş biçimde loglanır.
 */
export async function callTool(name, args = {}, { timeoutMs = DEFAULT_CALL_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let sessionId;

  try {
    try {
      sessionId = await initializeSession(controller.signal);
    } catch (error) {
      sessionId = error.sessionId; // initialize header'ı yakaladıysa cleanup için taşı
      throw error;
    }

    const { body } = await postJsonRpc(
      { jsonrpc: "2.0", id: randomUUID(), method: "tools/call", params: { name, arguments: args } },
      { sessionId, signal: controller.signal }
    );

    if (body?.error) {
      throw redactedError(`MCP hatası (${name}): ${body.error.message || JSON.stringify(body.error)}`);
    }
    const result = body?.result;
    if (!result) {
      throw redactedError(`MCP servisi ${name} için geçerli bir sonuç döndürmedi.`);
    }
    if (result.isError) {
      const message = result.content?.[0]?.text || "Meta MCP servisi hata döndürdü.";
      throw redactedError(`${name} hata döndürdü: ${message}`);
    }
    const text = result.content?.[0]?.text;
    if (typeof text !== "string") {
      throw redactedError(`${name} beklenen içerik metnini döndürmedi.`);
    }
    try {
      return JSON.parse(text);
    } catch {
      throw redactedError(`${name} sonucundaki JSON parse edilemedi.`);
    }
  } finally {
    clearTimeout(timer);
    if (sessionId) {
      try {
        await deleteSession(sessionId);
      } catch (cleanupError) {
        console.error("[meta-connect] session cleanup başarısız:", redact(cleanupError.message));
      }
    }
  }
}

/**
 * ads_list_ads/ads_list_campaigns/ads_list_adsets üçü de aynı şekilde Meta'nın
 * kendi cursor pagination'ını (paging.cursors.after) döndürür — MCP
 * protokolünün ayrı bir pagination'ı yok, sayfalama tamamen tool argümanı/tool
 * sonucu seviyesinde. Filtre uygulanmadan önce tüm sayfalar toplanır.
 */
async function paginateTool(toolName, { adAccountId, limit = 100 } = {}) {
  const rows = [];
  const seenCursors = new Set();
  let after;

  for (let page = 0; page < MAX_AD_PAGES; page += 1) {
    const data = await callTool(toolName, { ad_account_id: adAccountId, limit, after });
    const pageRows = Array.isArray(data?.data) ? data.data : [];
    rows.push(...pageRows);

    const nextAfter = data?.paging?.cursors?.after;
    if (!nextAfter || seenCursors.has(nextAfter)) break; // cursor yok veya tekrar geldi -> tamamlandı
    seenCursors.add(nextAfter);
    after = nextAfter;
  }

  return rows;
}

export function listAllAds(options) {
  return paginateTool("ads_list_ads", options);
}

export function listAllCampaigns(options) {
  return paginateTool("ads_list_campaigns", options);
}

export function listAllAdSets(options) {
  return paginateTool("ads_list_adsets", options);
}

/**
 * ads_get_ad_creative_assets çıktısını, upstream şeması sürüklenirse frontend'i
 * kırmayacak bilinen bir alan kümesine indirger. Alan uydurmaz — yalnızca
 * instagram-Facebook-connect/src/meta.ts'in fiilen döndürdüğü alanları taşır.
 */
export async function getAdCreativeAssets(adId) {
  const data = await callTool("ads_get_ad_creative_assets", { ad_id: adId });
  return {
    ad_id: data.ad_id ?? adId,
    ad_name: data.ad_name ?? "",
    adset_id: data.adset_id ?? "",
    campaign_id: data.campaign_id ?? "",
    creative_id: data.creative_id ?? "",
    creative_name: data.creative_name ?? "",
    format: data.format ?? "unknown",
    supported: Boolean(data.supported),
    reason: data.reason ?? null,
    has_asset_feed_spec: Boolean(data.has_asset_feed_spec),
    page_id: data.page_id ?? null,
    instagram_user_id: data.instagram_user_id ?? null,
    primary_text: data.primary_text ?? null,
    headline: data.headline ?? null,
    description: data.description ?? null,
    destination_url: data.destination_url ?? null,
    call_to_action: data.call_to_action ?? null,
    cards: Array.isArray(data.cards)
      ? data.cards.map((card) => ({
          position: card.position ?? null,
          name: card.name ?? null,
          description: card.description ?? null,
          link: card.link ?? null,
          cta: card.cta ?? null,
          image_hash: card.image_hash ?? null,
          image_url: card.image_url ?? null,
          permalink_url: card.permalink_url ?? null,
          width: card.width ?? null,
          height: card.height ?? null,
          image_error: card.image_error ?? null
        }))
      : [],
    duplicate_image_hashes: Array.isArray(data.diagnostics?.duplicate_image_hashes) ? data.diagnostics.duplicate_image_hashes : [],
    image_lookup_error: data.image_lookup_error ?? null
  };
}

// Route'ların UI'ya döndürdüğü hata her zaman bu sabit sözleşmeye normalize
// edilir; MCP/JSON-RPC'nin ham hata biçimi asla UI'ya sızmaz.
export function errorToApiShape(error) {
  return {
    code: error?.code || "MCP_UPSTREAM_ERROR",
    message: redact(error?.message || "Meta bağlantı servisiyle iletişimde beklenmeyen bir hata oluştu.")
  };
}

function todaySummaryFields(row) {
  if (!row) return { spend: 0, impressions: 0, clicks: 0, ctr: 0, cpc: 0 };
  return {
    spend: row.spend ?? 0,
    impressions: row.impressions ?? 0,
    clicks: row.clicks ?? 0,
    ctr: row.ctr ?? 0,
    cpc: row.cpc ?? 0
  };
}

// current.spend/impressions/clicks/ctr/cpc Meta Insights'ta hiçbir zaman null
// değildir (aksiyon yoksa 0'dır) — ama purchase_roas ve messaging_conversations_started
// gibi türetilmiş alanlar null olabilir ("ölçülmedi", 0 "ölçüldü ve sıfır" değil).
// Bu ayrım burada bozulmadan taşınır; "0" haline getirip UI'ya öyle vermeyiz.
function last7dSummaryFields(comparison) {
  if (!comparison) return null;
  const current = comparison.current || {};
  return {
    spend: current.spend ?? 0,
    impressions: current.impressions ?? 0,
    clicks: current.clicks ?? 0,
    ctr: current.ctr ?? 0,
    cpc: current.cpc ?? 0,
    messaging_conversations_started: current.messaging_conversations_started ?? 0,
    purchase_roas: current.purchase_roas ?? null,
    deltas: comparison.deltas ?? null,
    low_volume: comparison.low_volume ?? null
  };
}

/**
 * Genel Bakış ekranı için hesap kimliği + bugünkü/7 günlük performans +
 * aktif kampanya sayısı + Pixel durumunu TEK cevapta toplar. Her alt çağrı
 * kendi MCP session'ını paralel açar (Promise.allSettled) — biri (örn.
 * Pixel yapılandırılmamışsa) başarısız olsa bile diğer bölümler etkilenmez;
 * hangi bölümün neden eksik olduğu *_error alanında ayrıca döner.
 *
 * amount_spent/balance/spend_cap (ads_get_account) kasıtlı olarak burada
 * KULLANILMAZ: bu alanların minor/major para birimi biriminde mi döndüğü
 * instagram-Facebook-connect kodunda doğrulanamadı. Harcama rakamları
 * yalnızca ads_get_performance_summary/ads_compare_performance'ın (kodda
 * `currency_note: "Amounts use the Meta ad account currency."` ile
 * belgelenen, major-unit) `spend` alanından alınır.
 */
export async function getOverview({ adAccountId } = {}) {
  const [accountSettled, todaySettled, compareSettled, campaignsSettled, pixelSettled] = await Promise.allSettled([
    callTool("ads_get_account", { ad_account_id: adAccountId }),
    callTool("ads_get_performance_summary", { ad_account_id: adAccountId, level: "account", days: 1 }),
    callTool("ads_compare_performance", { ad_account_id: adAccountId, level: "account", period_days: 7 }),
    listAllCampaigns({ adAccountId }),
    callTool("pixel_get", {})
  ]);

  const account =
    accountSettled.status === "fulfilled"
      ? {
          id: accountSettled.value.id ?? null,
          name: accountSettled.value.name ?? null,
          currency: accountSettled.value.currency ?? null,
          account_status: accountSettled.value.account_status ?? null
        }
      : null;

  const today = todaySettled.status === "fulfilled" ? todaySummaryFields(todaySettled.value.data?.[0]) : null;

  const comparison = compareSettled.status === "fulfilled" ? compareSettled.value.comparisons?.[0] ?? null : null;
  const last7d = compareSettled.status === "fulfilled" ? last7dSummaryFields(comparison) : null;

  const activeCampaignCount =
    campaignsSettled.status === "fulfilled"
      ? campaignsSettled.value.filter((campaign) => campaign.status === "ACTIVE" || campaign.effective_status === "ACTIVE").length
      : null;

  const pixel =
    pixelSettled.status === "fulfilled"
      ? { id: pixelSettled.value.id ?? null, name: pixelSettled.value.name ?? null, last_fired_time: pixelSettled.value.last_fired_time ?? null }
      : null;

  return {
    account,
    account_error: accountSettled.status === "rejected" ? errorToApiShape(accountSettled.reason) : null,
    today,
    today_error: todaySettled.status === "rejected" ? errorToApiShape(todaySettled.reason) : null,
    last7d,
    last7d_error: compareSettled.status === "rejected" ? errorToApiShape(compareSettled.reason) : null,
    active_campaign_count: activeCampaignCount,
    campaigns_error: campaignsSettled.status === "rejected" ? errorToApiShape(campaignsSettled.reason) : null,
    pixel,
    pixel_error: pixelSettled.status === "rejected" ? errorToApiShape(pixelSettled.reason) : null
  };
}
