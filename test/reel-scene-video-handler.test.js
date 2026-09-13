import test from "node:test";
import assert from "node:assert/strict";
import handler from "../api/reel-scene-video.js";
import { setSession } from "../src/auth.js";

process.env.SESSION_SECRET = process.env.SESSION_SECRET || "test-secret-for-reel-scene-video-handler";
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || "test-gemini-key";

function sessionCookie(user = { id: "u1", username: "test", role: "Admin" }) {
  const headers = {};
  const fakeResponse = { setHeader: (key, value) => { headers[key] = value; } };
  setSession(fakeResponse, user);
  return String(headers["Set-Cookie"]).split(";")[0];
}

function makeRequest(body, { authorized = true, method = "POST" } = {}) {
  return { method, headers: authorized ? { cookie: sessionCookie() } : {}, body: JSON.stringify(body) };
}

function makeResponse() {
  const res = { statusCode: null, payload: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => { res.payload = payload; return res; };
  return res;
}

const VALID_BODY = {
  sceneId: "scene-1",
  approved: true,
  confirmed: true,
  referenceImageUrl: "https://example.com/product.jpg",
  referenceImageRequired: true,
  veoPrompt: "A cinematic shot of the product on a kitchen counter.",
  aspectRatio: "9:16",
  durationSeconds: 8
};

function mockVeoSuccess() {
  let call = 0;
  return async (url) => {
    call += 1;
    if (call === 1) {
      // referenceImageUrl indirme
      return { ok: true, headers: { get: () => "image/jpeg" }, arrayBuffer: async () => new ArrayBuffer(4) };
    }
    // Veo predictLongRunning
    assert.match(String(url), /:predictLongRunning$/);
    return { ok: true, json: async () => ({ name: "operations/abc123" }) };
  };
}

test("reel-scene-video handler: yetkisiz istek 401 döner ve submitVeoVideo çağrılmaz", async () => {
  const originalFetch = global.fetch;
  let fetchCalled = false;
  global.fetch = async () => { fetchCalled = true; return { ok: true }; };
  try {
    const res = makeResponse();
    await handler(makeRequest(VALID_BODY, { authorized: false }), res);
    assert.equal(res.statusCode, 401);
    assert.equal(fetchCalled, false);
  } finally {
    global.fetch = originalFetch;
  }
});

test("reel-scene-video handler: confirmed:true olmadan hiçbir API çağrısı yapılmaz", async () => {
  const originalFetch = global.fetch;
  let fetchCalled = false;
  global.fetch = async () => { fetchCalled = true; return { ok: true }; };
  try {
    const res = makeResponse();
    await handler(makeRequest({ ...VALID_BODY, confirmed: false }), res);
    assert.equal(res.statusCode, 500);
    assert.match(res.payload.error, /confirmed:true/);
    assert.equal(fetchCalled, false);
  } finally {
    global.fetch = originalFetch;
  }
});

test("reel-scene-video handler: approved:true olmadan (onaylanmamış sahne) hiçbir API çağrısı yapılmaz", async () => {
  const originalFetch = global.fetch;
  let fetchCalled = false;
  global.fetch = async () => { fetchCalled = true; return { ok: true }; };
  try {
    const res = makeResponse();
    await handler(makeRequest({ ...VALID_BODY, approved: false }), res);
    assert.equal(res.statusCode, 500);
    assert.match(res.payload.error, /onaylanmamış/);
    assert.equal(fetchCalled, false);
  } finally {
    global.fetch = originalFetch;
  }
});

test("reel-scene-video handler: referenceImageUrl https değilse reddedilir", async () => {
  const res = makeResponse();
  await handler(makeRequest({ ...VALID_BODY, referenceImageUrl: "http://example.com/x.jpg" }), res);
  assert.equal(res.statusCode, 500);
  assert.match(res.payload.error, /HTTPS/);
});

test("reel-scene-video handler: veoPrompt boşsa reddedilir", async () => {
  const res = makeResponse();
  await handler(makeRequest({ ...VALID_BODY, veoPrompt: "  " }), res);
  assert.equal(res.statusCode, 500);
  assert.match(res.payload.error, /veoPrompt/);
});

test("reel-scene-video handler: onaylı+confirmed istek TEK bir submitVeoVideo çağrısı yapar ve job'u sceneId ile döner", async () => {
  const originalFetch = global.fetch;
  global.fetch = mockVeoSuccess();
  try {
    const res = makeResponse();
    await handler(makeRequest(VALID_BODY), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.ok, true);
    assert.equal(res.payload.sceneId, "scene-1");
    assert.equal(res.payload.veo.operationName, "operations/abc123");
    assert.equal(res.payload.veo.provider, "veo");
  } finally {
    global.fetch = originalFetch;
  }
});

test("reel-scene-video handler: Veo'ya gönderilen prompt her zaman VEO_SILENT_CONSTRAINT içerir", async () => {
  const originalFetch = global.fetch;
  let sentPrompt = null;
  global.fetch = async (url, options) => {
    if (!options) return { ok: true, headers: { get: () => "image/jpeg" }, arrayBuffer: async () => new ArrayBuffer(4) };
    sentPrompt = JSON.parse(options.body).instances[0].prompt;
    return { ok: true, json: async () => ({ name: "operations/abc123" }) };
  };
  try {
    const res = makeResponse();
    await handler(makeRequest({ ...VALID_BODY, veoPrompt: "Bare prompt without any constraint." }), res);
    assert.equal(res.statusCode, 200);
    assert.match(sentPrompt, /NO spoken dialogue\. NO narration\. NO background music\. NO generated captions\./);
  } finally {
    global.fetch = originalFetch;
  }
});

test("reel-scene-video handler: referenceImageRequired:true olan sahnede Product Identity Lock de eklenir", async () => {
  const originalFetch = global.fetch;
  let sentPrompt = null;
  global.fetch = async (url, options) => {
    if (!options) return { ok: true, headers: { get: () => "image/jpeg" }, arrayBuffer: async () => new ArrayBuffer(4) };
    sentPrompt = JSON.parse(options.body).instances[0].prompt;
    return { ok: true, json: async () => ({ name: "operations/abc123" }) };
  };
  try {
    const res = makeResponse();
    await handler(makeRequest({ ...VALID_BODY, referenceImageRequired: true, veoPrompt: "Bare prompt." }), res);
    assert.equal(res.statusCode, 200);
    assert.match(sentPrompt, /Preserve the exact physical product/);
  } finally {
    global.fetch = originalFetch;
  }
});

test("reel-scene-video handler: geçersiz aspectRatio sessizce 9:16'ya düşer (uydurma değer Veo'ya gitmez)", async () => {
  const originalFetch = global.fetch;
  let sentParams = null;
  global.fetch = async (url, options) => {
    if (!options) return { ok: true, headers: { get: () => "image/jpeg" }, arrayBuffer: async () => new ArrayBuffer(4) };
    sentParams = JSON.parse(options.body).parameters;
    return { ok: true, json: async () => ({ name: "operations/abc123" }) };
  };
  try {
    const res = makeResponse();
    await handler(makeRequest({ ...VALID_BODY, aspectRatio: "4:3-not-real" }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(sentParams.aspectRatio, "9:16");
  } finally {
    global.fetch = originalFetch;
  }
});

test("reel-scene-video handler: RATE_LIMITED hatası HTTP 429 + code/alternatives ile döner (500'e düşmez)", async () => {
  const originalFetch = global.fetch;
  let call = 0;
  global.fetch = async () => {
    call += 1;
    if (call === 1) return { ok: true, headers: { get: () => "image/jpeg" }, arrayBuffer: async () => new ArrayBuffer(4) };
    return {
      ok: false,
      status: 429,
      headers: { get: (name) => (name.toLowerCase() === "retry-after" ? "15" : null) },
      json: async () => ({ error: { message: "quota exceeded", status: "RESOURCE_EXHAUSTED", details: [] } })
    };
  };
  try {
    const res = makeResponse();
    await handler(makeRequest(VALID_BODY), res);
    assert.equal(res.statusCode, 429);
    assert.equal(res.payload.ok, false);
    assert.equal(res.payload.code, "RATE_LIMITED");
    assert.ok(Array.isArray(res.payload.alternatives) && res.payload.alternatives.length === 2);
  } finally {
    global.fetch = originalFetch;
  }
});

test("reel-scene-video handler: Veo başarısız olursa düz 500 döner, otomatik başka bir provider/model denenmez", async () => {
  const originalFetch = global.fetch;
  let call = 0;
  global.fetch = async () => {
    call += 1;
    if (call === 1) return { ok: true, headers: { get: () => "image/jpeg" }, arrayBuffer: async () => new ArrayBuffer(4) };
    return { ok: false, status: 500, headers: { get: () => null }, json: async () => ({ error: { message: "boom" } }) };
  };
  try {
    const res = makeResponse();
    await handler(makeRequest(VALID_BODY), res);
    assert.equal(res.statusCode, 500);
    assert.equal(res.payload.ok, false);
    assert.equal(res.payload.error, "boom");
    assert.equal(call, 2, "yalnız bir görsel indirme + bir Veo çağrısı yapılmalı, ek deneme olmamalı");
  } finally {
    global.fetch = originalFetch;
  }
});
