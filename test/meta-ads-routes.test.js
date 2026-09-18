import test from "node:test";
import assert from "node:assert/strict";
import adsHandler from "../api/meta-ads/ads.js";
import adCreativeHandler from "../api/meta-ads/ad-creative.js";
import overviewHandler from "../api/meta-ads/overview.js";
import adStatusHandler from "../api/meta-ads/ad-status.js";
import adsetBudgetHandler from "../api/meta-ads/adset-budget.js";
import { setSession } from "../src/auth.js";

process.env.SESSION_SECRET = process.env.SESSION_SECRET || "test-secret-for-meta-ads-routes";
process.env.META_CONNECT_URL = process.env.META_CONNECT_URL || "https://buzsu-social-connect.example.test";
process.env.META_CONNECT_MCP_PATH_SECRET = process.env.META_CONNECT_MCP_PATH_SECRET || "test-secret-placeholder";

const SESSION_ID = "sess-route-test";

function sessionCookie(user = { id: "u1", username: "test", role: "Editor" }) {
  const headers = {};
  const fakeRes = { setHeader: (key, value) => { headers[key] = value; } };
  setSession(fakeRes, user);
  return String(headers["Set-Cookie"]).split(";")[0];
}

function makeRequest({ method = "GET", url = "", query = {}, body, authorized = true, role = "Editor" } = {}) {
  return { method, url, query, body, headers: authorized ? { cookie: sessionCookie({ id: "u1", username: "test", role }) } : {} };
}

function makeResponse() {
  const res = { statusCode: null, payload: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => { res.payload = payload; return res; };
  return res;
}

function fakeFetchResponse({ ok = true, status = 200, statusText = "OK", headers = {}, bodyText = "" } = {}) {
  const lower = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
  return { ok, status, statusText, headers: { get: (name) => lower[String(name).toLowerCase()] }, text: async () => bodyText };
}

function initSuccessResponse() {
  return fakeFetchResponse({
    headers: { "content-type": "application/json", "mcp-session-id": SESSION_ID },
    bodyText: JSON.stringify({ jsonrpc: "2.0", id: "init", result: { protocolVersion: "2025-03-26", capabilities: {} } })
  });
}

function notifiedResponse() {
  return fakeFetchResponse({ status: 202, bodyText: "" });
}

function toolCallSuccessResponse(payload) {
  return fakeFetchResponse({
    headers: { "content-type": "application/json" },
    bodyText: JSON.stringify({ jsonrpc: "2.0", id: "call", result: { content: [{ type: "text", text: JSON.stringify(payload) }] } })
  });
}

function withMockedFetch(dispatch, run) {
  const originalFetch = global.fetch;
  global.fetch = async (url, options = {}) => dispatch(String(url), options);
  return run().finally(() => {
    global.fetch = originalFetch;
  });
}

// toolHandlers: { toolName: (message) => fakeFetchResponse } — bir route birden
// fazla tool çağırabildiği için (örn. ads.js artık ads_list_ads + ads_list_campaigns
// + ads_list_adsets çağırıyor), her tools/call isteği kendi adına göre yönlendirilir.
// Listelenmeyen bir tool çağrılırsa boş {data:[],paging:{}} döner (varsayılan
// dayanıklılık davranışını test etmeye yarar), calledToolNames her çağrıyı kaydeder.
function withStandardHandshake(toolHandlers, calledToolNames) {
  return (url, options) => {
    if (options.method === "DELETE") return fakeFetchResponse({ status: 200 });
    const message = JSON.parse(options.body);
    if (message.method === "initialize") return initSuccessResponse();
    if (message.method === "notifications/initialized") return notifiedResponse();
    if (message.method === "tools/call") {
      const name = message.params.name;
      if (calledToolNames) calledToolNames.push(name);
      const handler = toolHandlers[name];
      if (handler) return handler(message);
      return toolCallSuccessResponse({ data: [], paging: {} });
    }
    throw new Error(`beklenmeyen JSON-RPC method: ${message.method}`);
  };
}

test("GET /api/meta-ads/ads: oturum yoksa 401 döner", async () => {
  const res = makeResponse();
  await adsHandler(makeRequest({ authorized: false }), res);
  assert.equal(res.statusCode, 401);
  assert.equal(res.payload.ok, false);
});

test("POST /api/meta-ads/ads: yalnız GET desteklenir, 405 döner", async () => {
  const res = makeResponse();
  await adsHandler(makeRequest({ method: "POST" }), res);
  assert.equal(res.statusCode, 405);
});

test("GET /api/meta-ads/ads: reklamları normalize eder ve campaign/adset isimlerini çözer", async () => {
  const calledTools = [];
  const res = makeResponse();
  await withMockedFetch(
    withStandardHandshake(
      {
        ads_list_ads: () =>
          toolCallSuccessResponse({
            data: [
              { id: "ad_1", name: "Code Web Trafiği", status: "ACTIVE", effective_status: "ACTIVE", campaign_id: "camp_1", adset_id: "adset_1", creative: { id: "creative_1" } }
            ],
            paging: {}
          }),
        ads_list_campaigns: () => toolCallSuccessResponse({ data: [{ id: "camp_1", name: "Code Trafik Kampanyası" }], paging: {} }),
        ads_list_adsets: () => toolCallSuccessResponse({ data: [{ id: "adset_1", name: "Code Trafik Set" }], paging: {} })
      },
      calledTools
    ),
    async () => {
      await adsHandler(makeRequest(), res);
    }
  );
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.ok, true);
  assert.deepEqual(res.payload.ads, [
    {
      id: "ad_1",
      name: "Code Web Trafiği",
      status: "ACTIVE",
      effective_status: "ACTIVE",
      campaign_id: "camp_1",
      campaign_name: "Code Trafik Kampanyası",
      adset_id: "adset_1",
      adset_name: "Code Trafik Set",
      creative_id: "creative_1"
    }
  ]);
  assert.deepEqual(new Set(calledTools), new Set(["ads_list_ads", "ads_list_campaigns", "ads_list_adsets"]));
});

test("GET /api/meta-ads/ads: campaign/adset isim çözümlemesi başarısız olursa reklam listesi boş isimle yine döner", async () => {
  const res = makeResponse();
  await withMockedFetch(
    withStandardHandshake({
      ads_list_ads: () => toolCallSuccessResponse({ data: [{ id: "ad_1", campaign_id: "camp_1", adset_id: "adset_1" }], paging: {} }),
      ads_list_campaigns: () => fakeFetchResponse({ ok: false, status: 500, bodyText: "boom" }),
      ads_list_adsets: () => fakeFetchResponse({ ok: false, status: 500, bodyText: "boom" })
    }),
    async () => {
      await adsHandler(makeRequest(), res);
    }
  );
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.ads[0].campaign_name, "");
  assert.equal(res.payload.ads[0].adset_name, "");
});

test("GET /api/meta-ads/ads: status filtresi tüm sayfalar toplandıktan SONRA uygulanır", async () => {
  let page = 0;
  const res = makeResponse();
  await withMockedFetch(
    withStandardHandshake({
      ads_list_ads: () => {
        page += 1;
        if (page === 1) return toolCallSuccessResponse({ data: [{ id: "ad_active", status: "ACTIVE", effective_status: "ACTIVE" }], paging: { cursors: { after: "C1" } } });
        return toolCallSuccessResponse({ data: [{ id: "ad_paused", status: "PAUSED", effective_status: "PAUSED" }], paging: {} });
      }
    }),
    async () => {
      await adsHandler(makeRequest({ query: { status: "PAUSED" } }), res);
    }
  );
  assert.equal(page, 2); // iki sayfa da MCP'den çekildi
  assert.equal(res.payload.ads.length, 1);
  assert.equal(res.payload.ads[0].id, "ad_paused");
});

test("GET /api/meta-ads/ads: reklam listesi upstream hata verirse sabit hata sözleşmesiyle 502 döner (ham MCP hatası UI'ya sızmaz)", async () => {
  const res = makeResponse();
  await withMockedFetch(
    (url, options) => {
      if (options.method === "DELETE") return fakeFetchResponse({ status: 200 });
      const message = JSON.parse(options.body);
      if (message.method === "initialize") return initSuccessResponse();
      if (message.method === "notifications/initialized") return notifiedResponse();
      return fakeFetchResponse({ ok: false, status: 500, statusText: "Internal Server Error", bodyText: "boom" });
    },
    async () => {
      await adsHandler(makeRequest(), res);
    }
  );
  assert.equal(res.statusCode, 502);
  assert.equal(res.payload.ok, false);
  assert.equal(res.payload.error.code, "MCP_UPSTREAM_ERROR");
  assert.ok(!JSON.stringify(res.payload).includes("jsonrpc"), "ham JSON-RPC gövdesi UI'ya sızmamalı");
});

test("GET /api/meta-ads/ad-creative: ad_id eksikse 400 döner", async () => {
  const res = makeResponse();
  await adCreativeHandler(makeRequest({ query: {} }), res);
  assert.equal(res.statusCode, 400);
});

test("GET /api/meta-ads/ad-creative: oturum yoksa 401 döner", async () => {
  const res = makeResponse();
  await adCreativeHandler(makeRequest({ authorized: false, query: { ad_id: "ad_1" } }), res);
  assert.equal(res.statusCode, 401);
});

test("GET /api/meta-ads/ad-creative: kreatif çıktısını normalize eder ve duplicate_image_hashes'i taşır", async () => {
  const calledTools = [];
  const res = makeResponse();
  await withMockedFetch(
    withStandardHandshake(
      {
        ads_get_ad_creative_assets: () =>
          toolCallSuccessResponse({
            ad_id: "ad_1",
            ad_name: "Code Web Trafiği",
            format: "carousel",
            supported: true,
            cards: [{ position: 1, image_hash: "hash_a" }],
            diagnostics: { duplicate_image_hashes: ["hash_a"] }
          })
      },
      calledTools
    ),
    async () => {
      await adCreativeHandler(makeRequest({ query: { ad_id: "ad_1" } }), res);
    }
  );
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.ok, true);
  assert.equal(res.payload.creative.format, "carousel");
  assert.deepEqual(res.payload.creative.duplicate_image_hashes, ["hash_a"]);
  assert.deepEqual(calledTools, ["ads_get_ad_creative_assets"]);
});

test("GET /api/meta-ads/ad-creative: MCP zaman aşımı 504 ve MCP_TIMEOUT koduyla döner", async (t) => {
  // Gerçek DEFAULT_CALL_TIMEOUT_MS (22s) kadar beklememek için sahte zamanlayıcı kullanılıyor.
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const res = makeResponse();
  const handlerPromise = withMockedFetch(
    (url, options) => {
      if (options.method === "DELETE") return fakeFetchResponse({ status: 200 });
      const message = JSON.parse(options.body);
      if (message.method === "initialize") {
        return new Promise((resolve, reject) => {
          options.signal?.addEventListener("abort", () => {
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          });
        });
      }
      return notifiedResponse();
    },
    async () => {
      await adCreativeHandler(makeRequest({ query: { ad_id: "ad_1" } }), res);
    }
  );
  t.mock.timers.tick(30_000);
  await handlerPromise;
  assert.equal(res.statusCode, 504);
  assert.equal(res.payload.error.code, "MCP_TIMEOUT");
});

test("GET /api/meta-ads/overview: oturum yoksa 401 döner", async () => {
  const res = makeResponse();
  await overviewHandler(makeRequest({ authorized: false }), res);
  assert.equal(res.statusCode, 401);
});

test("POST /api/meta-ads/overview: yalnız GET desteklenir, 405 döner", async () => {
  const res = makeResponse();
  await overviewHandler(makeRequest({ method: "POST" }), res);
  assert.equal(res.statusCode, 405);
});

test("GET /api/meta-ads/overview: hesap + bugün + 7 gün + aktif kampanya + pixel tek cevapta normalize edilir", async () => {
  const calledTools = [];
  const res = makeResponse();
  await withMockedFetch(
    withStandardHandshake(
      {
        ads_get_account: () => toolCallSuccessResponse({ id: "act_1", name: "Buzsu Ads", currency: "TRY", account_status: 1, amount_spent: "999999", balance: "0" }),
        ads_get_performance_summary: () => toolCallSuccessResponse({ period: { since: "2026-09-18", until: "2026-09-18" }, level: "account", data: [{ spend: 123.45, impressions: 1000, clicks: 10, ctr: 1.0, cpc: 12.345 }], paging: {} }),
        ads_compare_performance: () =>
          toolCallSuccessResponse({
            level: "account",
            comparisons: [
              {
                id: "account",
                current: { spend: 800, impressions: 4170, clicks: 50, ctr: 1.2, cpc: 16, messaging_conversations_started: 19, purchase_roas: null },
                previous: { spend: 700 },
                deltas: { spend: { absolute: 100, percent: 14.29 } },
                low_volume: {
                  flagged: true,
                  rule: "flagged is true when any signal has a known value below its threshold.",
                  signals: [
                    { basis: "results", metric: "messaging_conversations_started", threshold: 50, value: 19 },
                    { basis: "impressions", metric: "impressions", threshold: 500, value: 4170 }
                  ]
                }
              }
            ],
            previous_only: []
          }),
        ads_list_campaigns: () =>
          toolCallSuccessResponse({
            data: [
              { id: "camp_1", status: "ACTIVE", effective_status: "ACTIVE" },
              { id: "camp_2", status: "PAUSED", effective_status: "PAUSED" }
            ],
            paging: {}
          }),
        pixel_get: () => toolCallSuccessResponse({ id: "pixel_1", name: "Buzsu Pixel", last_fired_time: "2026-09-18T10:00:00+0000" })
      },
      calledTools
    ),
    async () => {
      await overviewHandler(makeRequest(), res);
    }
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.ok, true);
  const { overview } = res.payload;
  assert.equal(overview.account.currency, "TRY");
  assert.ok(!("amount_spent" in overview.account), "doğrulanamayan para birimi biriminde amount_spent overview'a sızmamalı");
  assert.equal(overview.today.spend, 123.45);
  assert.equal(overview.last7d.spend, 800);
  assert.equal(overview.last7d.purchase_roas, null, "purchase_roas null ise 0'a çevrilmemeli");
  assert.equal(overview.last7d.low_volume.flagged, true);
  assert.equal(overview.last7d.low_volume.signals[0].value, 19);
  assert.equal(overview.active_campaign_count, 1);
  assert.equal(overview.pixel.name, "Buzsu Pixel");
  assert.deepEqual(
    new Set(calledTools),
    new Set(["ads_get_account", "ads_get_performance_summary", "ads_compare_performance", "ads_list_campaigns", "pixel_get"])
  );
});

test("GET /api/meta-ads/overview: pixel_get başarısız olursa yalnız pixel bölümü etkilenir, diğer bölümler normal döner", async () => {
  const res = makeResponse();
  await withMockedFetch(
    withStandardHandshake({
      ads_get_account: () => toolCallSuccessResponse({ id: "act_1", name: "Buzsu Ads", currency: "TRY" }),
      ads_get_performance_summary: () => toolCallSuccessResponse({ data: [{ spend: 10, impressions: 100, clicks: 1, ctr: 1, cpc: 10 }], paging: {} }),
      ads_compare_performance: () => toolCallSuccessResponse({ comparisons: [{ id: "account", current: { spend: 50 }, low_volume: { flagged: false, signals: [] } }] }),
      ads_list_campaigns: () => toolCallSuccessResponse({ data: [], paging: {} }),
      pixel_get: () => fakeFetchResponse({ ok: false, status: 500, bodyText: "pixel not configured" })
    }),
    async () => {
      await overviewHandler(makeRequest(), res);
    }
  );
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.ok, true);
  assert.equal(res.payload.overview.pixel, null);
  assert.equal(res.payload.overview.pixel_error.code, "MCP_UPSTREAM_ERROR");
  assert.equal(res.payload.overview.account.name, "Buzsu Ads");
  assert.equal(res.payload.overview.today.spend, 10);
});

test("Yalnız izin verilen tool'lar çağrılır — PR-1/2 read-only'ler + PR-3'ün iki tersinir write'ı, başka hiçbiri", async () => {
  const calledTools = [];
  await withMockedFetch(
    withStandardHandshake(
      { ads_set_ad_status: () => toolCallSuccessResponse({ success: true }), ads_update_adset_budget: () => toolCallSuccessResponse({ success: true }) },
      calledTools
    ),
    async () => {
      await adsHandler(makeRequest(), makeResponse());
      await adCreativeHandler(makeRequest({ query: { ad_id: "ad_1" } }), makeResponse());
      await overviewHandler(makeRequest(), makeResponse());
      await adStatusHandler(makeRequest({ method: "POST", role: "Admin", body: { ad_id: "ad_1", status: "PAUSED", confirm: true } }), makeResponse());
      await adsetBudgetHandler(makeRequest({ method: "POST", role: "Admin", body: { adset_id: "adset_1", daily_budget_try: 100, confirm: true } }), makeResponse());
    }
  );
  const ALLOWED_TOOLS = new Set([
    "ads_list_ads",
    "ads_list_campaigns",
    "ads_list_adsets",
    "ads_get_ad_creative_assets",
    "ads_get_account",
    "ads_get_performance_summary",
    "ads_compare_performance",
    "pixel_get",
    "ads_set_ad_status",
    "ads_update_adset_budget"
  ]);
  assert.ok(calledTools.every((name) => ALLOWED_TOOLS.has(name)), `izin verilmeyen tool çağrıldı: ${calledTools}`);
  // delete/create/catalog/creative-update tool'ları asla çağrılmamalı (PR-4 kapsamı).
  assert.ok(!calledTools.some((name) => /delete|create|catalog/i.test(name)), `PR-4 kapsamındaki bir tool çağrıldı: ${calledTools}`);
});

test("POST /api/meta-ads/ad-status: oturum yoksa 401 döner", async () => {
  const res = makeResponse();
  await adStatusHandler(makeRequest({ method: "POST", authorized: false, body: { ad_id: "ad_1", status: "PAUSED" } }), res);
  assert.equal(res.statusCode, 401);
});

test("POST /api/meta-ads/ad-status: Editor rolü 403 döner — Admin-only", async () => {
  const res = makeResponse();
  await adStatusHandler(makeRequest({ method: "POST", role: "Editor", body: { ad_id: "ad_1", status: "PAUSED" } }), res);
  assert.equal(res.statusCode, 403);
  assert.equal(res.payload.error.code, "FORBIDDEN");
});

test("GET /api/meta-ads/ad-status: yalnız POST desteklenir, 405 döner", async () => {
  const res = makeResponse();
  await adStatusHandler(makeRequest({ method: "GET", role: "Admin" }), res);
  assert.equal(res.statusCode, 405);
});

test("POST /api/meta-ads/ad-status: ad_id eksikse 400 döner", async () => {
  const res = makeResponse();
  await adStatusHandler(makeRequest({ method: "POST", role: "Admin", body: { status: "PAUSED" } }), res);
  assert.equal(res.statusCode, 400);
});

test("POST /api/meta-ads/ad-status: status ACTIVE/PAUSED dışındaysa (örn. DELETED) 400 döner ve tool hiç çağrılmaz", async () => {
  const calledTools = [];
  const res = makeResponse();
  await withMockedFetch(withStandardHandshake({}, calledTools), async () => {
    await adStatusHandler(makeRequest({ method: "POST", role: "Admin", body: { ad_id: "ad_1", status: "DELETED" } }), res);
  });
  assert.equal(res.statusCode, 400);
  assert.deepEqual(calledTools, []);
});

test("POST /api/meta-ads/ad-status: Admin + geçerli body AMA confirm yok/false → 400 CONFIRMATION_REQUIRED, tool hiç çağrılmaz", async () => {
  const calledTools = [];
  const noConfirm = makeResponse();
  const falseConfirm = makeResponse();
  await withMockedFetch(withStandardHandshake({}, calledTools), async () => {
    await adStatusHandler(makeRequest({ method: "POST", role: "Admin", body: { ad_id: "ad_1", status: "PAUSED" } }), noConfirm);
    await adStatusHandler(makeRequest({ method: "POST", role: "Admin", body: { ad_id: "ad_1", status: "PAUSED", confirm: false } }), falseConfirm);
  });
  assert.equal(noConfirm.statusCode, 400);
  assert.equal(noConfirm.payload.error.code, "CONFIRMATION_REQUIRED");
  assert.equal(falseConfirm.statusCode, 400);
  assert.deepEqual(calledTools, []);
});

test("POST /api/meta-ads/ad-status: Admin + confirm:true → ads_set_ad_status TAM BİR KEZ confirmed:true ile çağrılır, 200 döner", async () => {
  let capturedArgs;
  let callCount = 0;
  const res = makeResponse();
  await withMockedFetch(
    withStandardHandshake({
      ads_set_ad_status: (message) => {
        callCount += 1;
        capturedArgs = message.params.arguments;
        return toolCallSuccessResponse({ success: true });
      }
    }),
    async () => {
      await adStatusHandler(makeRequest({ method: "POST", role: "Admin", body: { ad_id: "ad_42", status: "ACTIVE", confirm: true } }), res);
    }
  );
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.ok, true);
  assert.equal(res.payload.success, true);
  assert.equal(callCount, 1);
  assert.deepEqual(capturedArgs, { ad_id: "ad_42", status: "ACTIVE", confirmed: true });
});

test("POST /api/meta-ads/ad-status: MCP guard'ı reddederse (örn. connector kısıtı) sabit hata sözleşmesiyle 502 döner", async () => {
  const res = makeResponse();
  await withMockedFetch(
    withStandardHandshake({
      ads_set_ad_status: () =>
        fakeFetchResponse({
          headers: { "content-type": "application/json" },
          bodyText: JSON.stringify({ jsonrpc: "2.0", id: "call", result: { isError: true, content: [{ type: "text", text: "reddedildi" }] } })
        })
    }),
    async () => {
      await adStatusHandler(makeRequest({ method: "POST", role: "Admin", body: { ad_id: "ad_1", status: "PAUSED", confirm: true } }), res);
    }
  );
  assert.equal(res.statusCode, 502);
  assert.equal(res.payload.ok, false);
});

test("POST /api/meta-ads/adset-budget: oturum yoksa 401, Editor ise 403 döner", async () => {
  const unauthorized = makeResponse();
  await adsetBudgetHandler(makeRequest({ method: "POST", authorized: false, body: { adset_id: "adset_1", daily_budget_try: 100 } }), unauthorized);
  assert.equal(unauthorized.statusCode, 401);

  const forbidden = makeResponse();
  await adsetBudgetHandler(makeRequest({ method: "POST", role: "Editor", body: { adset_id: "adset_1", daily_budget_try: 100 } }), forbidden);
  assert.equal(forbidden.statusCode, 403);
});

test("POST /api/meta-ads/adset-budget: daily_budget_try aralık dışıysa (0 veya 100001) 400 döner ve tool hiç çağrılmaz", async () => {
  const calledTools = [];
  const tooLow = makeResponse();
  const tooHigh = makeResponse();
  await withMockedFetch(withStandardHandshake({}, calledTools), async () => {
    await adsetBudgetHandler(makeRequest({ method: "POST", role: "Admin", body: { adset_id: "adset_1", daily_budget_try: 0 } }), tooLow);
    await adsetBudgetHandler(makeRequest({ method: "POST", role: "Admin", body: { adset_id: "adset_1", daily_budget_try: 100001 } }), tooHigh);
  });
  assert.equal(tooLow.statusCode, 400);
  assert.equal(tooHigh.statusCode, 400);
  assert.deepEqual(calledTools, []);
});

test("POST /api/meta-ads/adset-budget: Admin + geçerli body AMA confirm yok/false → 400 CONFIRMATION_REQUIRED, tool hiç çağrılmaz", async () => {
  const calledTools = [];
  const noConfirm = makeResponse();
  const falseConfirm = makeResponse();
  await withMockedFetch(withStandardHandshake({}, calledTools), async () => {
    await adsetBudgetHandler(makeRequest({ method: "POST", role: "Admin", body: { adset_id: "adset_1", daily_budget_try: 100 } }), noConfirm);
    await adsetBudgetHandler(makeRequest({ method: "POST", role: "Admin", body: { adset_id: "adset_1", daily_budget_try: 100, confirm: false } }), falseConfirm);
  });
  assert.equal(noConfirm.statusCode, 400);
  assert.equal(noConfirm.payload.error.code, "CONFIRMATION_REQUIRED");
  assert.equal(falseConfirm.statusCode, 400);
  assert.deepEqual(calledTools, []);
});

test("POST /api/meta-ads/adset-budget: Admin + confirm:true → ads_update_adset_budget TAM BİR KEZ confirmed:true ile çağrılır, 200 döner", async () => {
  let capturedArgs;
  let callCount = 0;
  const res = makeResponse();
  await withMockedFetch(
    withStandardHandshake({
      ads_update_adset_budget: (message) => {
        callCount += 1;
        capturedArgs = message.params.arguments;
        return toolCallSuccessResponse({ success: true });
      }
    }),
    async () => {
      await adsetBudgetHandler(makeRequest({ method: "POST", role: "Admin", body: { adset_id: "adset_9", daily_budget_try: 350.5, confirm: true } }), res);
    }
  );
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.ok, true);
  assert.equal(callCount, 1);
  assert.deepEqual(capturedArgs, { adset_id: "adset_9", daily_budget_try: 350.5, confirmed: true });
});
