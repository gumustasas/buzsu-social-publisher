import test from "node:test";
import assert from "node:assert/strict";
import adsHandler from "../api/meta-ads/ads.js";
import adCreativeHandler from "../api/meta-ads/ad-creative.js";
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

function makeRequest({ method = "GET", url = "", query = {}, authorized = true } = {}) {
  return { method, url, query, headers: authorized ? { cookie: sessionCookie() } : {} };
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

function withStandardHandshake(onToolCall, calledToolNames) {
  return (url, options) => {
    if (options.method === "DELETE") return fakeFetchResponse({ status: 200 });
    const message = JSON.parse(options.body);
    if (message.method === "initialize") return initSuccessResponse();
    if (message.method === "notifications/initialized") return notifiedResponse();
    if (message.method === "tools/call") {
      if (calledToolNames) calledToolNames.push(message.params.name);
      return onToolCall(message);
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

test("GET /api/meta-ads/ads: reklamları normalize eder — nested creative.id -> creative_id", async () => {
  const calledTools = [];
  const res = makeResponse();
  await withMockedFetch(
    withStandardHandshake(
      () =>
        toolCallSuccessResponse({
          data: [
            { id: "ad_1", name: "Code Web Trafiği", status: "ACTIVE", effective_status: "ACTIVE", campaign_id: "camp_1", adset_id: "adset_1", creative: { id: "creative_1" } }
          ],
          paging: {}
        }),
      calledTools
    ),
    async () => {
      await adsHandler(makeRequest(), res);
    }
  );
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.ok, true);
  assert.deepEqual(res.payload.ads, [
    { id: "ad_1", name: "Code Web Trafiği", status: "ACTIVE", effective_status: "ACTIVE", campaign_id: "camp_1", adset_id: "adset_1", creative_id: "creative_1" }
  ]);
  assert.deepEqual(calledTools, ["ads_list_ads"]);
});

test("GET /api/meta-ads/ads: status filtresi tüm sayfalar toplandıktan SONRA uygulanır", async () => {
  let page = 0;
  const res = makeResponse();
  await withMockedFetch(
    withStandardHandshake(() => {
      page += 1;
      if (page === 1) return toolCallSuccessResponse({ data: [{ id: "ad_active", status: "ACTIVE", effective_status: "ACTIVE" }], paging: { cursors: { after: "C1" } } });
      return toolCallSuccessResponse({ data: [{ id: "ad_paused", status: "PAUSED", effective_status: "PAUSED" }], paging: {} });
    }),
    async () => {
      await adsHandler(makeRequest({ query: { status: "PAUSED" } }), res);
    }
  );
  assert.equal(page, 2); // iki sayfa da MCP'den çekildi
  assert.equal(res.payload.ads.length, 1);
  assert.equal(res.payload.ads[0].id, "ad_paused");
});

test("GET /api/meta-ads/ads: upstream hata verirse sabit hata sözleşmesiyle 502 döner (ham MCP hatası UI'ya sızmaz)", async () => {
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
      () =>
        toolCallSuccessResponse({
          ad_id: "ad_1",
          ad_name: "Code Web Trafiği",
          format: "carousel",
          supported: true,
          cards: [{ position: 1, image_hash: "hash_a" }],
          diagnostics: { duplicate_image_hashes: ["hash_a"] }
        }),
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

test("Bu PR'da hiçbir write tool çağrılmaz — ads.js ve ad-creative.js yalnız ads_list_ads/ads_get_ad_creative_assets kullanır", async () => {
  const calledTools = [];
  await withMockedFetch(
    withStandardHandshake(() => toolCallSuccessResponse({ data: [], paging: {} }), calledTools),
    async () => {
      await adsHandler(makeRequest(), makeResponse());
    }
  );
  await withMockedFetch(
    withStandardHandshake(() => toolCallSuccessResponse({}), calledTools),
    async () => {
      await adCreativeHandler(makeRequest({ query: { ad_id: "ad_1" } }), makeResponse());
    }
  );
  assert.deepEqual(new Set(calledTools), new Set(["ads_list_ads", "ads_get_ad_creative_assets"]));
});
