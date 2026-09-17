import { buildVideoPrompt } from "./lib/video-prompt.js";

const API_BASE = "https://generativelanguage.googleapis.com/v1beta";

// ÖNEMLİ: Veo 3 (GA) ve Veo 3.1 (Preview), Google'ın API yüzeyinde İKİ AYRI
// model ailesidir — birbirinin eşanlamlısı DEĞİLDİR, ID'leri de farklıdır.
// Bu depo daha önce yalnızca Veo 3.1'i entegre etmişti; bu ayrım burada
// KASITLI olarak iki ayrı sabitle (VEO_3_1_MODEL_TIERS / VEO_3_0_MODEL_TIERS)
// korunuyor, tek bir "veo3" diye birleştirilmiyor.
//
// Veo 3.1 (Preview) — "auto" bir tier DEĞİL: resolveVeoModel'de kendi
// başına bir modele karşılık gelmez, zincirdeki bir sonraki kaynağa
// (VEO_DEFAULT_TIER, sonunda "economy") devreder. Google'a ASLA bir "kalan
// kota" sorgusu atılmaz — Google bunu üretim öncesi güvenilir şekilde
// sağlamıyor; auto yalnızca statik bir varsayılan zinciridir.
export const VEO_3_1_MODEL_TIERS = {
  economy: "veo-3.1-lite-generate-preview",
  fast: "veo-3.1-fast-generate-preview",
  quality: "veo-3.1-generate-preview"
};
// Geriye dönük uyumluluk — bu isim (VEO_MODEL_TIERS) daha önce bu depoda
// (main'de) tek Veo ailesiymiş gibi kullanılıyordu; aynı referans/değerlerle
// KORUNUYOR, hiçbir mevcut çağıran (resolveVeoModel'in "economy"/"fast"/
// "quality" dalı, api/mcp.js, dashboard.html, mevcut testler) kırılmaz.
export const VEO_MODEL_TIERS = VEO_3_1_MODEL_TIERS;

// Veo 3 (GA) — Google'ın Gemini API'sinde resmi olarak duyurulmuş/dokümante
// edilmiş canonical ID'ler: "veo-3.0-generate-001" ve
// "veo-3.0-fast-generate-001" (bkz. Google Developers Blog "Veo 3 and Veo 3
// Fast" duyurusu + Gemini Enterprise Agent Platform dokümantasyonu — Google
// AI Studio API Referansı/Postman koleksiyonlarında da aynı ID'lerle
// görülüyor). BİLEREK burada bir "lite" tier'ı YOK: Google'ın resmi Veo 3.1
// duyurusuna göre "Lite" tier'ı YALNIZCA Veo 3.1 ile tanıtıldı — Veo 3 (GA)
// için doğrulanmış bir "Lite" canonical ID'si bulunamadı. Hesabınızda
// AI Studio'da bir "Veo 3 Lite" görüyorsanız (kota/erişim ekranı), bu
// muhtemelen AI Studio'nun kendi UI gruplamasıdır — GERÇEK API model ID'si
// farklı bir aileye (örn. Veo 3.1 Lite) ait olabilir. Bu yüzden burada ASLA
// tahmini bir ID uydurulmaz; resolveVeoModel'in "veo-3-lite" dalı, gerçek
// ID'yi yalnızca VEO_3_LITE_MODEL_ID ortam değişkeninden (operatör kendi
// hesabında GET /v1beta/models ile doğrulayıp tanımlar) kabul eder.
export const VEO_3_0_MODEL_TIERS = {
  generate: "veo-3.0-generate-001",
  fast: "veo-3.0-fast-generate-001"
};

export const VEO_ALLOWED_MODELS = new Set([...Object.values(VEO_3_1_MODEL_TIERS), ...Object.values(VEO_3_0_MODEL_TIERS)]);
// Maliyet sırası — 429 sonrası "alternatives" listesi bu sırayla üretilir.
export const VEO_TIER_ORDER = ["economy", "fast", "quality"];
export const VEO_TIER_LABELS = {
  economy: "Veo 3.1 Lite (Preview) — ekonomik",
  fast: "Veo 3.1 Fast (Preview) — hızlı",
  quality: "Veo 3.1 Generate (Preview) — yüksek kalite"
};
export const VEO_3_0_TIER_ORDER = ["fast", "generate"];
export const VEO_3_0_TIER_LABELS = {
  generate: "Veo 3 Generate",
  fast: "Veo 3 Fast"
};

// Temiz/açık, AİLE-BELİRTİK isimler — hangi Veo ailesinden bahsedildiği
// isimden AÇIKÇA anlaşılır ("veo-3-generate" = Veo 3 GA, "veo-3.1-generate"
// = Veo 3.1 Preview). Eski, aile belirtmeyen "veo-lite"/"veo-fast"/
// "veo-generate" isimleri KASITLI OLARAK kaldırıldı — bunlar Veo 3/3.1
// karışıklığına (bu düzeltmenin sebebi) zemin hazırlıyordu ve henüz hiçbir
// sürümde yayınlanmamıştı (bu PR dışında hiçbir yerde kullanılmıyordu).
// resolveVeoModel'deki tier adları ("economy"/"fast"/"quality") ve ham
// model ID'leri (VEO_ALLOWED_MODELS) HÂLÂ birebir aynı şekilde çalışır.
export const VEO_ALIAS_MAP = {
  "veo-3.1-lite": { tiers: VEO_3_1_MODEL_TIERS, tier: "economy" },
  "veo-3.1-fast": { tiers: VEO_3_1_MODEL_TIERS, tier: "fast" },
  "veo-3.1-generate": { tiers: VEO_3_1_MODEL_TIERS, tier: "quality" },
  "veo-3-generate": { tiers: VEO_3_0_MODEL_TIERS, tier: "generate" },
  "veo-3-fast": { tiers: VEO_3_0_MODEL_TIERS, tier: "fast" }
  // "veo-3-lite" KASITLI OLARAK burada YOK — bkz. VEO_3_0_MODEL_TIERS'ın
  // üstündeki not ve resolveVeoModel'deki özel hata dalı.
};

function familyAndTierForModel(model) {
  const tier31 = VEO_TIER_ORDER.find((tier) => VEO_3_1_MODEL_TIERS[tier] === model);
  if (tier31) return { tiers: VEO_3_1_MODEL_TIERS, order: VEO_TIER_ORDER, labels: VEO_TIER_LABELS, tier: tier31 };
  const tier30 = VEO_3_0_TIER_ORDER.find((tier) => VEO_3_0_MODEL_TIERS[tier] === model);
  if (tier30) return { tiers: VEO_3_0_MODEL_TIERS, order: VEO_3_0_TIER_ORDER, labels: VEO_3_0_TIER_LABELS, tier: tier30 };
  return null;
}

// 429 sonrası önerilecek diğer modeller — başarısız olan HARİÇ, ucuzdan
// pahalıya, ve YALNIZCA AYNI AİLE İÇİNDE (Veo 3 başarısız olursa Veo 3.1
// önerilmez, bunun tersi de geçerli — aileler arası "alternatif" önerisi
// bile yapılmaz, kaldı ki hiçbir zaman otomatik olarak çağrılmaz; yalnızca
// bilgi amaçlıdır, bkz. VeoApiError.alternatives). Kullanıcı açıkça yeni
// bir model seçip confirmed:true ile tekrar çağırmalıdır.
function alternativesFor(failedModel) {
  const found = familyAndTierForModel(failedModel);
  if (!found) return [];
  const { tiers, order, labels, tier: failedTier } = found;
  return order.filter((tier) => tier !== failedTier).map((tier) => ({ tier, model: tiers[tier], label: labels[tier] }));
}

// GEMINI_API_KEY zaten bu depoda kullanılıyor (bkz. src/scene-image.js,
// src/ai-providers.js); Veo aynı anahtarla, Gemini API'nin bir parçası
// olarak çalışıyor, ayrı bir hesap/anahtar gerekmiyor.
function veoHeaders(env) {
  return { "x-goog-api-key": env.GEMINI_API_KEY, "Content-Type": "application/json" };
}

// Yapılandırılmış Veo API hatası — yalnızca HTTP 429 (rate limit) için
// oluşturulur; başka bir hata bunu ASLA kullanmaz, düz Error olarak kalır
// (geriye dönük uyumluluk — mevcut çağıranlar error.message'a bakmaya devam
// edebilir). code/httpStatus/model/alternatives gibi alanlar katmanlar
// arası (api/veo-video.js, api/reels.js, api/mcp.js) güvenli JSON olarak
// taşınabilsin diye ayrı property'ler olarak tutulur.
export class VeoApiError extends Error {
  constructor(message, { code, httpStatus, model, providerStatus, retryAfter = null, alternatives = [], details = null } = {}) {
    super(message);
    this.name = "VeoApiError";
    this.code = code;
    this.httpStatus = httpStatus;
    this.model = model;
    this.providerStatus = providerStatus;
    this.retryAfter = retryAfter;
    this.alternatives = alternatives;
    this.details = details;
  }
  toJSON() {
    return {
      code: this.code,
      httpStatus: this.httpStatus,
      model: this.model,
      providerStatus: this.providerStatus,
      retryAfter: this.retryAfter,
      alternatives: this.alternatives,
      details: this.details,
      error: this.message
    };
  }
}

// Retry-After HTTP header'ı (saniye sayısı veya HTTP-date) öncelikli;
// yoksa Google'ın google.rpc.RetryInfo detayındaki retryDelay'e ("36s"
// gibi) bakılır. İkisi de yoksa null — "bilinmiyor" anlamına gelir,
// asla tahmini bir değer uydurulmaz.
function parseRetryAfter(response, data) {
  const header = response && typeof response.headers?.get === "function" ? response.headers.get("retry-after") : null;
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds)) return seconds;
    const dateMs = Date.parse(header);
    if (!Number.isNaN(dateMs)) return Math.max(0, Math.round((dateMs - Date.now()) / 1000));
  }
  const details = data?.error?.details;
  if (Array.isArray(details)) {
    const retryInfo = details.find((item) => String(item?.["@type"] || "").includes("RetryInfo"));
    const match = typeof retryInfo?.retryDelay === "string" ? retryInfo.retryDelay.match(/^(\d+(?:\.\d+)?)s$/) : null;
    if (match) return Number(match[1]);
  }
  return null;
}

// Google'ın google.rpc.QuotaFailure detayı varsa quotaId/quotaMetric'i
// olduğu gibi taşır. Bu her zaman gelmeyebilir (Google'ın yanıt şekli
// modele/kota türüne göre değişebilir) — bu yüzden hangi kota türünün
// (RPM/RPD/başka) dolduğu KESİN olarak iddia edilmez, yalnızca elde
// varsa raporlanır.
function parseQuotaInfo(data) {
  const details = data?.error?.details;
  if (Array.isArray(details)) {
    const quotaFailure = details.find((item) => String(item?.["@type"] || "").includes("QuotaFailure"));
    const violation = quotaFailure?.violations?.[0];
    if (violation && (violation.quotaId || violation.quotaMetric)) {
      return { quotaId: violation.quotaId || null, quotaMetric: violation.quotaMetric || null };
    }
  }
  return { quotaType: "unknown" };
}

// API anahtarı URL/header'da taşınıyor ama Google'ın hata mesajı metninde
// de sızabilir ihtimaline karşı savunmacı bir redaksiyon — details alanı
// "güvenli, API anahtarı içermeyen" olmalı (bkz. plan).
function redact(message) {
  return String(message || "").replace(/key=[^&\s"]+/gi, "key=[gizli]");
}

// HTTP-seviyesi 429 (readJson) VE operation gövdesine gömülü hata
// (veoVideoStatus — Google bir long-running operation'ı HTTP 200 + "done:
// true" ile ama gövde içinde bir google.rpc.Status hatasıyla da
// sonlandırabiliyor) AYNI şekilde RATE_LIMITED'e normalize edilsin diye
// tek bir yerden üretiliyor — iki ayrı hata yolu birbirinden bağımsız
// sürüklenip birinin unutulmasını önler.
function buildRateLimitedError({ model, providerStatus, message, retryAfter, quotaInfo }) {
  const safeMessage = redact(message || "HTTP 429");
  const fullMessage = `Veo modeli (${model}) için istek sınırına ulaşıldı (${providerStatus || "bilinmeyen durum"}). Bu dakikalık (RPM) veya günlük (RPD) bir kota olabilir — kesin tür Google'ın yanıtından anlaşılamadı. ${safeMessage}`;
  return new VeoApiError(fullMessage, {
    code: "RATE_LIMITED",
    httpStatus: 429,
    model,
    providerStatus: providerStatus || null,
    retryAfter,
    alternatives: alternativesFor(model),
    details: { ...quotaInfo, message: safeMessage }
  });
}

async function readJson(response, { model } = {}) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 429) {
      throw buildRateLimitedError({
        model,
        providerStatus: data?.error?.status,
        message: data?.error?.message,
        retryAfter: parseRetryAfter(response, data),
        quotaInfo: parseQuotaInfo(data)
      });
    }
    throw new Error(data.error?.message || `Veo HTTP ${response.status}`);
  }
  return data;
}

// Çağrı parametresi (a) > VEO_VIDEO_MODEL (b) > VEO_DEFAULT_TIER (c) >
// "economy" (d, auto zincirinin sonu). Her katman ya bir tier adı
// ("economy"/"fast"/"quality"), ya zaten geçerli ham bir model ID'si, ya
// "auto" (bu katman karar vermiyor, sıradakine geç) ya da boş olabilir.
// Geçersiz/tanınmayan bir değer zincirin neresinde olursa olsun HEMEN
// fırlatılır — sessizce yok sayılıp bir sonraki katmana düşülmez, aksi
// halde bir yazım hatası fark edilmeden farklı bir modele geçilmiş olurdu.
// "veo-3-lite" için hesapta gerçekten doğrulanmış bir canonical ID
// bulunmadıkça (bkz. VEO_3_0_MODEL_TIERS'ın üstündeki not) burada ASLA bir
// ID uydurulmaz — ne Veo 3.1 Lite'a sessizce düşülür ne de tahmini bir
// "veo-3.0-lite-generate-..." ID'si denenir. Operatör kendi hesabında
// GET /v1beta/models (veya /api/video-provider-capabilities) ile gerçek
// ID'yi doğrulayıp VEO_3_LITE_MODEL_ID'ye tanımlarsa AYNEN o kullanılır.
function resolveVeo3LiteOrThrow(env) {
  if (env.VEO_3_LITE_MODEL_ID) return env.VEO_3_LITE_MODEL_ID;
  throw new Error(
    "Veo 3 (GA) ailesinde \"Lite\" tier'ı için Google tarafında doğrulanmış bir canonical model ID yok " +
    "— Google'ın resmi duyurusuna göre \"Lite\" tier'ı yalnızca Veo 3.1'de tanıtıldı. Hesabınızda gerçekten " +
    "bir \"Veo 3 Lite\" modeli görüyorsanız (AI Studio'nun kendi grup adlandırması gerçek API model ID'sinden " +
    "farklı olabilir), gerçek model ID'sini GET /v1beta/models ile doğrulayıp VEO_3_LITE_MODEL_ID ortam " +
    "değişkenine tanımlayın. Veo 3.1 Lite'ı denemek isterseniz \"veo-3.1-lite\" seçin — bu farklı bir aile, " +
    "otomatik olarak ona düşülmez."
  );
}

export function resolveVeoModel(modelOrProfile, env = process.env) {
  const chain = [modelOrProfile, env.VEO_VIDEO_MODEL, env.VEO_DEFAULT_TIER];
  for (const candidate of chain) {
    if (!candidate) continue;
    if (candidate === "auto") continue;
    if (candidate === "veo-3-lite") return resolveVeo3LiteOrThrow(env);
    if (VEO_ALIAS_MAP[candidate]) { const { tiers, tier } = VEO_ALIAS_MAP[candidate]; return tiers[tier]; }
    if (VEO_MODEL_TIERS[candidate]) return VEO_MODEL_TIERS[candidate];
    if (VEO_ALLOWED_MODELS.has(candidate)) return candidate;
    throw new Error(`Desteklenmeyen Veo modeli/tier'ı: "${candidate}". Kullanılabilir: auto, economy, fast, quality, ${Object.keys(VEO_ALIAS_MAP).join(", ")}, veo-3-lite (VEO_3_LITE_MODEL_ID gerektirir), ${[...VEO_ALLOWED_MODELS].join(", ")}.`);
  }
  return VEO_MODEL_TIERS.economy;
}

// Geriye dönük uyumluluk: önceki sürümlerde yalnızca env tabanlı model
// seçimi vardı (çağrı parametresi yoktu). Aynı davranış artık
// resolveVeoModel'in özel bir hâli (çağrı parametresi boş).
export function veoModel(env = process.env) { return resolveVeoModel(undefined, env); }

// fal.ai'nin aksine Veo, görsel URL'i değil ham baytları (base64) kabul
// ediyor; bu yüzden ürün görselini burada indirip gövdeye gömüyoruz.
// finalizedPrompt, önizleme adımında (bkz. api/reels.js) kurulup snapshot
// alınmış promptun aynısıdır — burada yeniden kurulmaz, olduğu gibi
// kullanılır. Verilmezse (örn. ileride başka bir çağıran) generic bir
// prompt'a düşer.
export async function submitVeoVideo(product, env = process.env, { finalizedPrompt, aspectRatio = "9:16", durationSeconds, resolution, model: modelOverride } = {}) {
  if (!env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY Vercel Production ortamında tanımlı değil.");
  // Model çözümleme + allowlist kontrolü GÖRSEL İNDİRİLMEDEN ÖNCE yapılır —
  // geçersiz bir model/tier adı hiçbir ağ isteği (görsel indirme, Veo
  // çağrısı) tetiklemeden hemen reddedilir.
  const model = resolveVeoModel(modelOverride, env);
  const imageUrl = String(product.imageUrl || "").trim();
  if (!/^https:\/\//i.test(imageUrl)) throw new Error("Veo için ürün görseli herkese açık HTTPS URL olmalı.");
  const upstream = await fetch(imageUrl);
  if (!upstream.ok) throw new Error("Ürün görseli alınamadı.");
  const mimeType = upstream.headers.get("content-type") || "image/jpeg";
  const imageBytes = Buffer.from(await upstream.arrayBuffer()).toString("base64");
  const prompt = String(finalizedPrompt || "").trim() || buildVideoPrompt(product.title);
  const parameters = { aspectRatio, ...(durationSeconds && { durationSeconds }), ...(resolution && { resolution }) };
  const response = await fetch(`${API_BASE}/models/${model}:predictLongRunning`, {
    method: "POST",
    headers: veoHeaders(env),
    body: JSON.stringify({ instances: [{ prompt, image: { bytesBase64Encoded: imageBytes, mimeType } }], parameters })
  });
  const data = await readJson(response, { model });
  if (!data.name) throw new Error("Veo işlem adı (operation) alınamadı.");
  return { provider: "veo", model, operationName: data.name, product: product.title, imageUrl, prompt, createdAt: new Date().toISOString() };
}

export async function veoVideoStatus(job, env = process.env) {
  if (!env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY Vercel Production ortamında tanımlı değil.");
  if (!job?.operationName) throw new Error("Veo iş bilgisi eksik.");
  const response = await fetch(`${API_BASE}/${job.operationName}`, { headers: { "x-goog-api-key": env.GEMINI_API_KEY } });
  const data = await readJson(response, { model: job.model });
  if (!data.done) return { ...job, status: "IN_PROGRESS" };
  if (data.error) {
    // Google, uzun süren bir işlemi HTTP 200 + "done:true" ile ama gövde
    // İÇİNE GÖMÜLÜ bir google.rpc.Status hatasıyla da sonlandırabiliyor —
    // bu, readJson'ın denetlediği HTTP-seviyesi 429'dan TAMAMEN AYRI bir
    // yol (üretim ANINDA değil, işlem SÜRERKEN/pollanırken kota dolabilir).
    // Aynı RATE_LIMITED sınıflandırması burada da uygulanmazsa dashboard/MCP
    // bunu düz bir "başarısız" hatasından ayıramaz.
    if (data.error.code === 429 || data.error.status === "RESOURCE_EXHAUSTED") {
      throw buildRateLimitedError({
        model: job.model,
        providerStatus: data.error.status,
        message: data.error.message,
        retryAfter: parseRetryAfter(null, data),
        quotaInfo: parseQuotaInfo(data)
      });
    }
    throw new Error(data.error.message || "Veo video üretimi başarısız.");
  }
  const sample = data.response?.generateVideoResponse?.generatedSamples?.[0];
  const fileUri = sample?.video?.uri || null;
  if (!fileUri) throw new Error("Veo yanıtında video bulunamadı.");
  return { ...job, status: "COMPLETED", fileUri };
}

// Google'ın dosya URI'si x-goog-api-key ile korunuyor; anahtarı tarayıcıya
// ifşa etmeden kullanıcıya bir bağlantı verebilmek için video burada
// sunucu tarafında indirilir (api/veo-video.js bunu Vercel Blob'a yükleyip
// herkese açık bir URL üretir).
export async function downloadVeoVideo(fileUri, env = process.env) {
  const response = await fetch(fileUri, { headers: { "x-goog-api-key": env.GEMINI_API_KEY } });
  if (!response.ok) throw new Error(`Veo video indirilemedi (HTTP ${response.status}).`);
  return Buffer.from(await response.arrayBuffer());
}
