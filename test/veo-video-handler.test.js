import test from "node:test";
import assert from "node:assert/strict";
import handler from "../api/veo-video.js";
import { setSession } from "../src/auth.js";

process.env.SESSION_SECRET = process.env.SESSION_SECRET || "test-secret-for-veo-video-handler";
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || "test-gemini-key";

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

function mock429() {
  return {
    ok: false,
    status: 429,
    headers: { get: (name) => (name.toLowerCase() === "retry-after" ? "20" : null) },
    json: async () => ({ error: { message: "quota exceeded", status: "RESOURCE_EXHAUSTED", details: [] } })
  };
}

test("veo-video handler: yetkisiz istek 401 döner", async () => {
  const res = makeResponse();
  await handler({ method: "POST", headers: {}, body: JSON.stringify({ job: {} }) }, res);
  assert.equal(res.statusCode, 401);
});

test("veo-video handler: durum sorgusu 429 alırsa HTTP 429 + yapılandırılmış JSON döner (500'e düşmez)", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => mock429();
  try {
    const req = makeRequest({ job: { operationName: "operations/1", model: "veo-3.1-fast-generate-preview" } });
    const res = makeResponse();
    await handler(req, res);
    assert.equal(res.statusCode, 429);
    assert.equal(res.payload.ok, false);
    assert.equal(res.payload.code, "RATE_LIMITED");
    assert.equal(res.payload.httpStatus, 429);
    assert.equal(res.payload.model, "veo-3.1-fast-generate-preview");
    assert.equal(res.payload.retryAfter, 20);
    assert.ok(Array.isArray(res.payload.alternatives) && res.payload.alternatives.length === 2);
  } finally {
    global.fetch = originalFetch;
  }
});

test("veo-video handler: 429 dışındaki bir hata eskisi gibi 500 döner (regresyon)", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: false, status: 500, headers: { get: () => null }, json: async () => ({ error: { message: "boom" } }) });
  try {
    const req = makeRequest({ job: { operationName: "operations/1" } });
    const res = makeResponse();
    await handler(req, res);
    assert.equal(res.statusCode, 500);
    assert.equal(res.payload.ok, false);
    assert.equal(res.payload.code, undefined);
    assert.equal(res.payload.error, "boom");
  } finally {
    global.fetch = originalFetch;
  }
});
