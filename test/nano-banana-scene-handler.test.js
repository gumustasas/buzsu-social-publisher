import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import handler from "../api/nano-banana-scene.js";
import { setSession } from "../src/auth.js";

process.env.SESSION_SECRET = process.env.SESSION_SECRET || "test-secret-for-nano-banana-scene-handler";
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

test("nano-banana-scene handler: unauthorized request returns 401", async () => {
  const res = makeResponse();
  await handler({ method: "POST", headers: {}, body: JSON.stringify({ prompt: "x", confirmed: true }) }, res);
  assert.equal(res.statusCode, 401);
});

test("nano-banana-scene handler: confirmed:false makes no network call and returns an error (not a 200)", async () => {
  const originalFetch = global.fetch;
  let called = false;
  global.fetch = async () => { called = true; throw new Error("must not be called"); };
  try {
    const res = makeResponse();
    await handler(makeRequest({ prompt: "mutfak sahnesi", confirmed: false }), res);
    assert.equal(res.statusCode, 500);
    assert.equal(res.payload.ok, false);
    assert.match(res.payload.error, /confirmed:true/);
    assert.equal(called, false);
  } finally {
    global.fetch = originalFetch;
  }
});

test("nano-banana-scene handler: zero-shot (no productId) succeeds with a 200 and never touches Airtable", async () => {
  const originalFetch = global.fetch;
  const calledUrls = [];
  global.fetch = async (url) => {
    const href = String(url);
    calledUrls.push(href);
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ inlineData: { data: "AAAA" } }] } }] }) };
  };
  try {
    const res = makeResponse();
    await handler(makeRequest({ prompt: "sıfırdan bir sahne", aspectRatio: "9:16", confirmed: true }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.ok, true);
    assert.equal(res.payload.scene.mode, "zero-shot");
    assert.equal(res.payload.scene.model, "gemini-3.1-flash-image");
    assert.ok(!calledUrls.some((u) => u.includes("airtable.com")));
  } finally {
    global.fetch = originalFetch;
  }
});

test("nano-banana-scene handler: product-reference mode resolves the product via Airtable then calls Nano Banana 2 and surfaces needsReview", async () => {
  process.env.AIRTABLE_TOKEN = "test-token";
  const originalFetch = global.fetch;
  const tinyPng = await sharp({ create: { width: 4, height: 4, channels: 3, background: { r: 255, g: 255, b: 255 } } }).png().toBuffer();
  global.fetch = async (url, options) => {
    const href = String(url);
    if (href.includes("api.airtable.com")) {
      return { ok: true, json: async () => ({ records: [{ id: "recTEST123", fields: { "Başlık": "Buzsu Ultramag", "Görsel URL": "https://example.com/photo.png" } }] }) };
    }
    if (href.includes("example.com")) {
      return { ok: true, arrayBuffer: async () => tinyPng };
    }
    const body = JSON.parse(options.body);
    if (body.generationConfig?.responseMimeType === "application/json") {
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ failedChecks: ["product_identity"], notes: "şekil değişti" }) }] } }] }) };
    }
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ inlineData: { data: "AAAA" } }] } }] }) };
  };
  try {
    const res = makeResponse();
    await handler(makeRequest({ productId: "recTEST123", prompt: "dış cephe montajı", confirmed: true }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.scene.mode, "product-reference");
    assert.equal(res.payload.scene.needsReview, true);
    assert.deepEqual(res.payload.scene.failedChecks, ["product_identity"]);
  } finally {
    global.fetch = originalFetch;
    delete process.env.AIRTABLE_TOKEN;
  }
});

test("nano-banana-scene handler: unknown productId returns a plain error, no crash", async () => {
  process.env.AIRTABLE_TOKEN = "test-token";
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    if (String(url).includes("api.airtable.com")) return { ok: true, json: async () => ({ records: [] }) };
    throw new Error("must not reach Gemini for an unresolved product");
  };
  try {
    const res = makeResponse();
    await handler(makeRequest({ productId: "recMISSING", prompt: "x", confirmed: true }), res);
    assert.equal(res.statusCode, 500);
    assert.equal(res.payload.ok, false);
    assert.match(res.payload.error, /bulunamadı/);
  } finally {
    global.fetch = originalFetch;
    delete process.env.AIRTABLE_TOKEN;
  }
});
