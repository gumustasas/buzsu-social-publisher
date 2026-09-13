import test from "node:test";
import assert from "node:assert/strict";
import handler from "../api/reels.js";
import { setSession } from "../src/auth.js";
import { hashVideoPrompt } from "../src/lib/video-prompt.js";

process.env.SESSION_SECRET = process.env.SESSION_SECRET || "test-secret-for-reels-handler";
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || "test-gemini-key";
process.env.AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN || "test-airtable-token";

const PRODUCT_ID = "recVeoTest1";
const PRODUCT_RECORD = { id: PRODUCT_ID, fields: { Başlık: "Test Ürünü", "Kaynak URL": "https://example.com/p", "Görsel URL": "https://example.com/p.jpg" } };

function sessionCookie(user = { id: "u1", username: "test", role: "Admin" }) {
  const headers = {};
  const fakeResponse = { setHeader: (key, value) => { headers[key] = value; } };
  setSession(fakeResponse, user);
  return String(headers["Set-Cookie"]).split(";")[0];
}

function makeRequest(body) {
  return { method: "POST", headers: { cookie: sessionCookie() }, body: JSON.stringify(body) };
}

function makeResponse() {
  const res = { statusCode: null, payload: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => { res.payload = payload; return res; };
  return res;
}

function withMockedFetch(veoResponder, run) {
  const originalFetch = global.fetch;
  const veoCalls = [];
  global.fetch = async (url, options) => {
    const urlStr = String(url);
    if (urlStr.includes("api.airtable.com")) return { ok: true, json: async () => ({ records: [PRODUCT_RECORD] }) };
    if (urlStr === "https://example.com/p.jpg") return { ok: true, headers: { get: () => "image/jpeg" }, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
    veoCalls.push({ url: urlStr, options });
    return veoResponder(urlStr, options);
  };
  return run(veoCalls).finally(() => { global.fetch = originalFetch; });
}

test("reels handler: yetkisiz istek 401 döner", async () => {
  const res = makeResponse();
  await handler({ method: "POST", headers: {}, body: JSON.stringify({ provider: "veo" }) }, res);
  assert.equal(res.statusCode, 401);
});

test("reels handler: body.model seçilen tier'ı submitVeoVideo'ya aktarır (Veo isteğinin URL'sinde doğrulanır)", async () => {
  await withMockedFetch(
    (url) => ({ ok: true, json: async () => ({ name: "operations/test" }) }),
    async (veoCalls) => {
      const prompt = "REFERENCE:\ntest\n\nMOTION:\ntest";
      const req = makeRequest({ provider: "veo", productId: PRODUCT_ID, finalizedPrompt: prompt, promptId: hashVideoPrompt(prompt), model: "economy" });
      const res = makeResponse();
      await handler(req, res);
      assert.equal(res.statusCode, 200);
      assert.equal(res.payload.ok, true);
      assert.equal(res.payload.veo.model, "veo-3.1-lite-generate-preview");
      const veoRequestUrl = veoCalls.find((c) => c.url.includes("predictLongRunning"))?.url;
      assert.match(veoRequestUrl, /veo-3\.1-lite-generate-preview/);
    }
  );
});

test("reels handler: body.profile, body.model'in eşanlamlısı olarak kabul edilir", async () => {
  await withMockedFetch(
    () => ({ ok: true, json: async () => ({ name: "operations/test" }) }),
    async () => {
      const prompt = "REFERENCE:\ntest\n\nMOTION:\ntest";
      const req = makeRequest({ provider: "veo", productId: PRODUCT_ID, finalizedPrompt: prompt, promptId: hashVideoPrompt(prompt), profile: "quality" });
      const res = makeResponse();
      await handler(req, res);
      assert.equal(res.statusCode, 200);
      assert.equal(res.payload.veo.model, "veo-3.1-generate-preview");
    }
  );
});

test("reels handler: model belirtilmezse (undefined) resolver zincirine düşer — economy varsayılanı kullanılır", async () => {
  await withMockedFetch(
    () => ({ ok: true, json: async () => ({ name: "operations/test" }) }),
    async () => {
      const prompt = "REFERENCE:\ntest\n\nMOTION:\ntest";
      const req = makeRequest({ provider: "veo", productId: PRODUCT_ID, finalizedPrompt: prompt, promptId: hashVideoPrompt(prompt) });
      const res = makeResponse();
      await handler(req, res);
      assert.equal(res.payload.veo.model, "veo-3.1-lite-generate-preview");
    }
  );
});

test("reels handler: geçersiz model (allowlist dışı) hiçbir Veo/görsel ağ isteği atmadan 500 ile reddedilir", async () => {
  await withMockedFetch(
    () => { throw new Error("Veo'ya hiç istek atılmamalıydı"); },
    async (veoCalls) => {
      const prompt = "REFERENCE:\ntest\n\nMOTION:\ntest";
      const req = makeRequest({ provider: "veo", productId: PRODUCT_ID, finalizedPrompt: prompt, promptId: hashVideoPrompt(prompt), model: "bogus" });
      const res = makeResponse();
      await handler(req, res);
      assert.equal(res.statusCode, 500);
      assert.match(res.payload.error, /Desteklenmeyen Veo modeli/);
      assert.equal(veoCalls.length, 0);
    }
  );
});

test("reels handler: Veo 429 döndürürse HTTP 429 + yapılandırılmış JSON (code/model/alternatives) döner, 500'e düşmez", async () => {
  await withMockedFetch(
    () => ({
      ok: false,
      status: 429,
      headers: { get: (name) => (name.toLowerCase() === "retry-after" ? "5" : null) },
      json: async () => ({ error: { message: "quota exceeded", status: "RESOURCE_EXHAUSTED", details: [] } })
    }),
    async () => {
      const prompt = "REFERENCE:\ntest\n\nMOTION:\ntest";
      const req = makeRequest({ provider: "veo", productId: PRODUCT_ID, finalizedPrompt: prompt, promptId: hashVideoPrompt(prompt), model: "fast" });
      const res = makeResponse();
      await handler(req, res);
      assert.equal(res.statusCode, 429);
      assert.equal(res.payload.ok, false);
      assert.equal(res.payload.code, "RATE_LIMITED");
      assert.equal(res.payload.model, "veo-3.1-fast-generate-preview");
      assert.equal(res.payload.retryAfter, 5);
      assert.deepEqual(res.payload.alternatives.map((a) => a.tier), ["economy", "quality"]);
    }
  );
});

test("reels handler: prompt hash doğrulaması model parametresinden etkilenmiyor — model değişse de aynı prompt/promptId kabul edilir", async () => {
  await withMockedFetch(
    () => ({ ok: true, json: async () => ({ name: "operations/test" }) }),
    async () => {
      const prompt = "REFERENCE:\nsame\n\nMOTION:\nsame";
      const promptId = hashVideoPrompt(prompt);
      for (const model of ["economy", "fast", "quality"]) {
        const req = makeRequest({ provider: "veo", productId: PRODUCT_ID, finalizedPrompt: prompt, promptId, model });
        const res = makeResponse();
        await handler(req, res);
        assert.equal(res.statusCode, 200, `model=${model} için beklenmedik durum: ${JSON.stringify(res.payload)}`);
      }
    }
  );
});
