import test from "node:test";
import assert from "node:assert/strict";
import handler from "../api/omni-video.js";
import { setSession } from "../src/auth.js";

process.env.SESSION_SECRET = process.env.SESSION_SECRET || "test-secret-for-omni-video-handler";
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || "test-gemini-key";
delete process.env.BLOB_READ_WRITE_TOKEN;

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

// src/omni-video.js akışının ardışık isteklerine (video indir -> Files API
// start -> upload/finalize -> dosya durumu -> /interactions POST) URL'e göre
// yanıt üreten mock — gerçek ağ isteği atılmaz. Tamamlanmış çıktı, resmi
// şemaya göre steps[]/model_output içinde döner.
function baseMockFetch({ onInteractions } = {}) {
  return async (url, options) => {
    const href = String(url);
    if (!options && href.startsWith("https://example.com/video")) {
      return { ok: true, headers: { get: () => "video/mp4" }, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
    }
    if (href.includes("/upload/v1beta/files") && options?.headers?.["X-Goog-Upload-Command"] === "start") {
      return { ok: true, headers: { get: (name) => (name === "x-goog-upload-url" ? "https://example.com/upload-session" : null) } };
    }
    if (href === "https://example.com/upload-session") {
      return { ok: true, json: async () => ({ file: { uri: "https://example.com/files/abc123", name: "files/abc123", mimeType: "video/mp4" } }) };
    }
    if (href.includes("/v1beta/files/abc123")) {
      return { ok: true, json: async () => ({ name: "files/abc123", uri: "https://example.com/files/abc123", mimeType: "video/mp4", state: "ACTIVE" }) };
    }
    if (href.endsWith("/v1beta/interactions")) {
      if (onInteractions) return onInteractions(url, options);
      return { ok: true, json: async () => ({ id: "v1_xyz", steps: [] }) };
    }
    throw new Error(`Beklenmeyen fetch: ${href}`);
  };
}

test("omni-video handler: yetkisiz istek 401 döner", async () => {
  const res = makeResponse();
  await handler({ method: "POST", headers: {}, body: JSON.stringify({}) }, res);
  assert.equal(res.statusCode, 401);
});

test("omni-video handler: confirmed:true olmadan 500 döner (gerçek harcama yapılmaz, ücretli işlem onaysız durur)", async () => {
  const req = makeRequest({ existingVideoUrl: "https://example.com/video.mp4", editPrompt: "fix", confirmed: false });
  const res = makeResponse();
  await handler(req, res);
  assert.equal(res.statusCode, 500);
  assert.match(res.payload.error, /confirmed:true/);
});

test("omni-video handler: GET/DELETE gibi desteklenmeyen metotlar 405 döner", async () => {
  const res = makeResponse();
  await handler({ method: "GET", headers: { cookie: sessionCookie() } }, res);
  assert.equal(res.statusCode, 405);
});

test("omni-video handler: model_output'ta uri varsa (BLOB_READ_WRITE_TOKEN yokken) downloadNote ile COMPLETED döner", async () => {
  const originalFetch = global.fetch;
  global.fetch = baseMockFetch({ onInteractions: () => ({ ok: true, json: async () => ({ id: "v1_xyz", steps: [{ type: "model_output", content: [{ type: "video", uri: "https://example.com/files/output.mp4", mime_type: "video/mp4" }] }] }) }) });
  try {
    const req = makeRequest({ existingVideoUrl: "https://example.com/video.mp4", editPrompt: "fix", confirmed: true });
    const res = makeResponse();
    await handler(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.ok, true);
    assert.equal(res.payload.omni.status, "COMPLETED");
    assert.equal(res.payload.omni.videoUrl, undefined);
    assert.match(res.payload.omni.downloadNote, /BLOB_READ_WRITE_TOKEN/);
  } finally {
    global.fetch = originalFetch;
  }
});

// Google, delivery:"uri" istenmiş olsa bile inline base64 döndürebiliyor —
// handler bunu da (fileUri olmadan) COMPLETED olarak tanımalı, sonsuza
// kadar IN_PROGRESS'te kalmamalı.
test("omni-video handler: model_output'ta uri yerine inline base64 varsa da COMPLETED döner (downloadNote ile, BLOB_READ_WRITE_TOKEN yokken)", async () => {
  const originalFetch = global.fetch;
  global.fetch = baseMockFetch({ onInteractions: () => ({ ok: true, json: async () => ({ id: "v1_xyz", steps: [{ type: "model_output", content: [{ type: "video", data: "AQIDBA==", mime_type: "video/mp4" }] }] }) }) });
  try {
    const req = makeRequest({ existingVideoUrl: "https://example.com/video.mp4", editPrompt: "fix", confirmed: true });
    const res = makeResponse();
    await handler(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.omni.status, "COMPLETED");
    assert.equal(res.payload.omni.fileUri, null);
    assert.match(res.payload.omni.downloadNote, /BLOB_READ_WRITE_TOKEN/);
  } finally {
    global.fetch = originalFetch;
  }
});

test("omni-video handler: durum sorgusu (action:status) HTTP 429 alırsa gerçek HTTP 429 + yapılandırılmış JSON döner (500'e düşmez)", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: false, status: 429, headers: { get: () => null }, json: async () => ({ error: { status: "RESOURCE_EXHAUSTED", message: "quota" } }) });
  try {
    const req = makeRequest({ action: "status", job: { interactionId: "v1_xyz", model: "gemini-omni-1.1-flash" } });
    const res = makeResponse();
    await handler(req, res);
    assert.equal(res.statusCode, 429);
    assert.equal(res.payload.ok, false);
    assert.equal(res.payload.code, "RATE_LIMITED");
  } finally {
    global.fetch = originalFetch;
  }
});

test("omni-video handler: bölgesel kısıt hatası (REGION_UNAVAILABLE) gerçek HTTP kodu ile döner, 500'e düşmez", async () => {
  const originalFetch = global.fetch;
  global.fetch = baseMockFetch({
    onInteractions: () => ({
      ok: false,
      status: 403,
      headers: { get: () => null },
      json: async () => ({ error: { status: "PERMISSION_DENIED", message: "Video editing is not available in your region." } })
    })
  });
  try {
    const req = makeRequest({ existingVideoUrl: "https://example.com/video.mp4", editPrompt: "fix", confirmed: true });
    const res = makeResponse();
    await handler(req, res);
    assert.equal(res.statusCode, 403);
    assert.equal(res.payload.ok, false);
    assert.equal(res.payload.code, "REGION_UNAVAILABLE");
  } finally {
    global.fetch = originalFetch;
  }
});

test("omni-video handler: 429/REGION_UNAVAILABLE dışındaki bir hata eskisi gibi 500 döner (regresyon)", async () => {
  const originalFetch = global.fetch;
  global.fetch = baseMockFetch({
    onInteractions: () => ({ ok: false, status: 500, headers: { get: () => null }, json: async () => ({ error: { message: "boom" } }) })
  });
  try {
    const req = makeRequest({ existingVideoUrl: "https://example.com/video.mp4", editPrompt: "fix", confirmed: true });
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

test("omni-video handler: model_output var ama video parçası yoksa (örn. metinle reddetme) 500 + açık hata döner, sessizce IN_PROGRESS'e düşmez", async () => {
  const originalFetch = global.fetch;
  global.fetch = baseMockFetch({
    onInteractions: () => ({ ok: true, json: async () => ({ id: "v1_xyz", steps: [{ type: "model_output", content: [{ type: "text", text: "Bu videoyu düzenleyemem." }] }] }) })
  });
  try {
    const req = makeRequest({ existingVideoUrl: "https://example.com/video.mp4", editPrompt: "fix", confirmed: true });
    const res = makeResponse();
    await handler(req, res);
    assert.equal(res.statusCode, 500);
    assert.match(res.payload.error, /Bu videoyu düzenleyemem/);
  } finally {
    global.fetch = originalFetch;
  }
});
