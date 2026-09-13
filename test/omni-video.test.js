import test from "node:test";
import assert from "node:assert/strict";
import { submitOmniVideoEdit, omniInteractionStatus, downloadOmniVideo, waitForOmniFileActive, OmniApiError, OMNI_MODEL } from "../src/omni-video.js";

// Genel amaçlı mock fetch — src/omni-video.js'nin akışındaki ardışık
// isteklere (video indirme -> Files API start -> Files API upload/finalize
// -> dosya durumu poll -> /interactions POST -> [opsiyonel] görsel indirme +
// aynı Files API akışı) URL/metoda göre yanıt üretir. Gerçek ağ isteği
// HİÇBİR testte atılmaz. Files API her iki medya için de AYNI mock dosya
// adını (files/abc123) döner — testler her ikisinin de Files API'den geçtiğini
// çağrı sayısıyla doğrular.
function baseMockFetch({ onInteractions, fileState = "ACTIVE" } = {}) {
  let interactionsCallCount = 0;
  let filesUploadStartCount = 0;
  const fn = async (url, options) => {
    const href = String(url);
    if (!options && href.startsWith("https://example.com/video")) {
      return { ok: true, headers: { get: () => "video/mp4" }, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
    }
    if (!options && href.startsWith("https://example.com/image")) {
      return { ok: true, headers: { get: () => "image/jpeg" }, arrayBuffer: async () => new Uint8Array([4, 5, 6]).buffer };
    }
    if (href.includes("/upload/v1beta/files") && options?.headers?.["X-Goog-Upload-Command"] === "start") {
      filesUploadStartCount++;
      return { ok: true, headers: { get: (name) => (name === "x-goog-upload-url" ? "https://example.com/upload-session" : null) } };
    }
    if (href === "https://example.com/upload-session") {
      return { ok: true, json: async () => ({ file: { uri: "https://example.com/files/abc123", name: "files/abc123", mimeType: "video/mp4" } }) };
    }
    if (href.includes("/v1beta/files/abc123")) {
      return { ok: true, json: async () => ({ name: "files/abc123", uri: "https://example.com/files/abc123", mimeType: "video/mp4", state: fileState }) };
    }
    if (href.endsWith("/v1beta/interactions")) {
      interactionsCallCount++;
      if (onInteractions) return onInteractions(url, options, interactionsCallCount);
      return {
        ok: true,
        json: async () => ({ id: "v1_xyz", steps: [{ type: "model_output", content: [{ type: "video", uri: "https://example.com/files/output.mp4", mime_type: "video/mp4" }] }] })
      };
    }
    throw new Error(`Beklenmeyen fetch: ${href}`);
  };
  return { fn, getInteractionsCallCount: () => interactionsCallCount, getFilesUploadStartCount: () => filesUploadStartCount };
}

test("submitOmniVideoEdit rejects without confirmed:true, before any network call", async () => {
  const originalFetch = global.fetch;
  let calls = 0;
  global.fetch = async () => { calls++; throw new Error("fetch should not be called without confirmed:true"); };
  try {
    await assert.rejects(
      () => submitOmniVideoEdit("https://example.com/video.mp4", { GEMINI_API_KEY: "test" }, { editPrompt: "fix product" }),
      /confirmed:true/
    );
    assert.equal(calls, 0);
  } finally {
    global.fetch = originalFetch;
  }
});

test("submitOmniVideoEdit rejects when GEMINI_API_KEY is missing", async () => {
  await assert.rejects(
    () => submitOmniVideoEdit("https://example.com/video.mp4", {}, { editPrompt: "fix", confirmed: true }),
    /GEMINI_API_KEY/
  );
});

test("submitOmniVideoEdit rejects a non-HTTPS existingVideoUrl", async () => {
  await assert.rejects(
    () => submitOmniVideoEdit("not-a-url", { GEMINI_API_KEY: "test" }, { editPrompt: "fix", confirmed: true }),
    /HTTPS/
  );
});

test("submitOmniVideoEdit rejects an empty editPrompt", async () => {
  await assert.rejects(
    () => submitOmniVideoEdit("https://example.com/video.mp4", { GEMINI_API_KEY: "test" }, { editPrompt: "   ", confirmed: true }),
    /editPrompt/
  );
});

test("submitOmniVideoEdit rejects an unsupported resolution", async () => {
  await assert.rejects(
    () => submitOmniVideoEdit("https://example.com/video.mp4", { GEMINI_API_KEY: "test" }, { editPrompt: "fix", resolution: "144p", confirmed: true }),
    /çözünürlüğü/
  );
});

// Şema düzeltmesi: input dizisi düz {type,uri,mime_type}/{type,text} öğeleri
// olmalı — role/content/file_data/inline_data DEĞİL (bkz. resmi doküman
// doğrulaması, önceki sürümde yanlış varsayılmıştı).
test("submitOmniVideoEdit sends the documented flat {type,uri}/{type,text} input array, not role/content/file_data", async () => {
  const originalFetch = global.fetch;
  let capturedBody = null;
  const { fn } = baseMockFetch({
    onInteractions: (url, options) => { capturedBody = JSON.parse(options.body); return { ok: true, json: async () => ({ id: "v1_xyz", steps: [] }) }; }
  });
  global.fetch = fn;
  try {
    await submitOmniVideoEdit("https://example.com/video.mp4", { GEMINI_API_KEY: "test" }, { editPrompt: "yalnızca ürünü değiştir", confirmed: true });
    assert.equal(capturedBody.model, OMNI_MODEL);
    assert.equal(capturedBody.input[0].type, "video");
    assert.equal(capturedBody.input[0].uri, "https://example.com/files/abc123");
    assert.equal(capturedBody.input[1].type, "text");
    assert.equal(capturedBody.input[1].text, "yalnızca ürünü değiştir");
    assert.equal(capturedBody.role, undefined);
    assert.equal(capturedBody.generation_config, undefined);
  } finally {
    global.fetch = originalFetch;
  }
});

// Şema düzeltmesi: response_format bir DİZİ, aspect_ratio/resolution
// generation_config'te değil response_format öğesinin İÇİNDE.
test("submitOmniVideoEdit sends response_format as an array with delivery/aspect_ratio/resolution inside the element", async () => {
  const originalFetch = global.fetch;
  let capturedBody = null;
  const { fn } = baseMockFetch({
    onInteractions: (url, options) => { capturedBody = JSON.parse(options.body); return { ok: true, json: async () => ({ id: "v1_xyz", steps: [] }) }; }
  });
  global.fetch = fn;
  try {
    await submitOmniVideoEdit("https://example.com/video.mp4", { GEMINI_API_KEY: "test" }, { editPrompt: "fix", resolution: "720p", aspectRatio: "16:9", confirmed: true });
    assert.ok(Array.isArray(capturedBody.response_format));
    assert.equal(capturedBody.response_format[0].type, "video");
    assert.equal(capturedBody.response_format[0].delivery, "uri");
    assert.equal(capturedBody.response_format[0].aspect_ratio, "16:9");
    assert.equal(capturedBody.response_format[0].resolution, "720p");
  } finally {
    global.fetch = originalFetch;
  }
});

// Şema düzeltmesi: referans görsel de Files API'ye yüklenip {type:"image",uri}
// olarak eklenir — inline_data/base64 KULLANILMAZ.
test("submitOmniVideoEdit uploads the reference image through Files API too and adds it as {type:'image',uri}, not inline_data", async () => {
  const originalFetch = global.fetch;
  let capturedBody = null;
  const { fn, getFilesUploadStartCount } = baseMockFetch({
    onInteractions: (url, options) => { capturedBody = JSON.parse(options.body); return { ok: true, json: async () => ({ id: "v1_xyz", steps: [] }) }; }
  });
  global.fetch = fn;
  try {
    await submitOmniVideoEdit("https://example.com/video.mp4", { GEMINI_API_KEY: "test" }, { editPrompt: "fix", referenceImageUrl: "https://example.com/image.png", confirmed: true });
    assert.equal(capturedBody.input.length, 3);
    assert.equal(capturedBody.input[1].type, "image");
    assert.equal(capturedBody.input[1].uri, "https://example.com/files/abc123");
    assert.equal(capturedBody.input[1].inline_data, undefined);
    assert.equal(getFilesUploadStartCount(), 2); // video + image, ikisi de Files API'den
  } finally {
    global.fetch = originalFetch;
  }
});

test("submitOmniVideoEdit without referenceImageUrl sends only video + text input items", async () => {
  const originalFetch = global.fetch;
  let capturedBody = null;
  const { fn, getFilesUploadStartCount } = baseMockFetch({
    onInteractions: (url, options) => { capturedBody = JSON.parse(options.body); return { ok: true, json: async () => ({ id: "v1_xyz", steps: [] }) }; }
  });
  global.fetch = fn;
  try {
    await submitOmniVideoEdit("https://example.com/video.mp4", { GEMINI_API_KEY: "test" }, { editPrompt: "fix", confirmed: true });
    assert.equal(capturedBody.input.length, 2);
    assert.equal(getFilesUploadStartCount(), 1);
  } finally {
    global.fetch = originalFetch;
  }
});

// Şema düzeltmesi: tamamlanmış çıktı outputs[]/output[] DEĞİL, steps[]
// içindeki type:"model_output" adımının content[]'inde (type:"video").
test("submitOmniVideoEdit returns COMPLETED with fileUri when steps[] carries a model_output video part with a uri", async () => {
  const { fn } = baseMockFetch();
  const originalFetch = global.fetch;
  global.fetch = fn;
  try {
    const job = await submitOmniVideoEdit("https://example.com/video.mp4", { GEMINI_API_KEY: "test" }, { editPrompt: "fix", confirmed: true });
    assert.equal(job.status, "COMPLETED");
    assert.equal(job.fileUri, "https://example.com/files/output.mp4");
    assert.equal(job.videoBase64, null);
    assert.equal(job.provider, "omni");
    assert.equal(job.interactionId, "v1_xyz");
  } finally {
    global.fetch = originalFetch;
  }
});

// Google, delivery:"uri" istense bile inline base64 döndürebiliyor —
// extractOmniVideoOutput ikisini de tanımalı, biri "her zaman doğru şekil"
// diye varsayılmamalı.
test("submitOmniVideoEdit returns COMPLETED with videoBase64 when the model_output video part carries inline base64 data instead of a uri", async () => {
  const { fn } = baseMockFetch({
    onInteractions: () => ({ ok: true, json: async () => ({ id: "v1_xyz", steps: [{ type: "model_output", content: [{ type: "video", data: "AQIDBA==", mime_type: "video/mp4" }] }] }) })
  });
  const originalFetch = global.fetch;
  global.fetch = fn;
  try {
    const job = await submitOmniVideoEdit("https://example.com/video.mp4", { GEMINI_API_KEY: "test" }, { editPrompt: "fix", confirmed: true });
    assert.equal(job.status, "COMPLETED");
    assert.equal(job.fileUri, null);
    assert.equal(job.videoBase64, "AQIDBA==");
  } finally {
    global.fetch = originalFetch;
  }
});

test("submitOmniVideoEdit returns IN_PROGRESS (not an error) when steps[] has no model_output step yet", async () => {
  const { fn } = baseMockFetch({ onInteractions: () => ({ ok: true, json: async () => ({ id: "v1_xyz", steps: [{ type: "thought", content: [] }] }) }) });
  const originalFetch = global.fetch;
  global.fetch = fn;
  try {
    const job = await submitOmniVideoEdit("https://example.com/video.mp4", { GEMINI_API_KEY: "test" }, { editPrompt: "fix", confirmed: true });
    assert.equal(job.status, "IN_PROGRESS");
    assert.equal(job.fileUri, null);
    assert.equal(job.interactionId, "v1_xyz");
  } finally {
    global.fetch = originalFetch;
  }
});

// Kullanıcı doğrulaması: model_output VARSA ama içinde video YOKSA (örn.
// metinle reddetme) bu sessizce IN_PROGRESS'e düşüp hayalî polling'e
// geçmemeli — açık bir hata fırlatılmalı.
test("submitOmniVideoEdit throws a clear error when a model_output step exists but carries no video part (never silently falls into fake polling)", async () => {
  const { fn } = baseMockFetch({
    onInteractions: () => ({ ok: true, json: async () => ({ id: "v1_xyz", steps: [{ type: "model_output", content: [{ type: "text", text: "Bu videoyu düzenleyemem çünkü ..." }] }] }) })
  });
  const originalFetch = global.fetch;
  global.fetch = fn;
  try {
    await assert.rejects(
      () => submitOmniVideoEdit("https://example.com/video.mp4", { GEMINI_API_KEY: "test" }, { editPrompt: "fix", confirmed: true }),
      /Bu videoyu düzenleyemem/
    );
  } finally {
    global.fetch = originalFetch;
  }
});

// interactionId normalizasyonu: Google "name" alanında zaten "interactions/"
// önekiyle tam kaynak yolunu dönerse, bu önek bir kez temizlenmeli —
// aksi halde sonraki GET isteği .../interactions/interactions/xyz gibi
// YANLIŞ bir URL'e giderdi.
test("submitOmniVideoEdit normalizes an interaction id that already carries an 'interactions/' prefix in the 'name' field", async () => {
  const { fn } = baseMockFetch({ onInteractions: () => ({ ok: true, json: async () => ({ name: "interactions/v1_xyz", steps: [] }) }) });
  const originalFetch = global.fetch;
  global.fetch = fn;
  try {
    const job = await submitOmniVideoEdit("https://example.com/video.mp4", { GEMINI_API_KEY: "test" }, { editPrompt: "fix", confirmed: true });
    assert.equal(job.interactionId, "v1_xyz");
  } finally {
    global.fetch = originalFetch;
  }
});

test("submitOmniVideoEdit classifies HTTP 429 on the interactions call as OmniApiError with code RATE_LIMITED", async () => {
  const { fn } = baseMockFetch({
    onInteractions: () => ({
      ok: false,
      status: 429,
      headers: { get: () => null },
      json: async () => ({ error: { status: "RESOURCE_EXHAUSTED", message: "Resource has been exhausted (e.g. check quota)." } })
    })
  });
  const originalFetch = global.fetch;
  global.fetch = fn;
  try {
    const error = await submitOmniVideoEdit("https://example.com/video.mp4", { GEMINI_API_KEY: "test" }, { editPrompt: "fix", confirmed: true }).catch((e) => e);
    assert.ok(error instanceof OmniApiError);
    assert.equal(error.code, "RATE_LIMITED");
    assert.equal(error.httpStatus, 429);
    assert.equal(error.model, OMNI_MODEL);
  } finally {
    global.fetch = originalFetch;
  }
});

test("submitOmniVideoEdit classifies a region-restricted response (403 PERMISSION_DENIED mentioning region) as OmniApiError with code REGION_UNAVAILABLE", async () => {
  const { fn } = baseMockFetch({
    onInteractions: () => ({
      ok: false,
      status: 403,
      headers: { get: () => null },
      json: async () => ({ error: { status: "PERMISSION_DENIED", message: "Video editing is not available in your region." } })
    })
  });
  const originalFetch = global.fetch;
  global.fetch = fn;
  try {
    const error = await submitOmniVideoEdit("https://example.com/video.mp4", { GEMINI_API_KEY: "test" }, { editPrompt: "fix", confirmed: true }).catch((e) => e);
    assert.ok(error instanceof OmniApiError);
    assert.equal(error.code, "REGION_UNAVAILABLE");
    assert.equal(error.httpStatus, 403);
  } finally {
    global.fetch = originalFetch;
  }
});

test("submitOmniVideoEdit: a 400 unrelated to region/quota (e.g. bad request) stays a plain Error, not misclassified (regression guard)", async () => {
  const { fn } = baseMockFetch({
    onInteractions: () => ({
      ok: false,
      status: 400,
      headers: { get: () => null },
      json: async () => ({ error: { status: "INVALID_ARGUMENT", message: "The provided video is corrupt." } })
    })
  });
  const originalFetch = global.fetch;
  global.fetch = fn;
  try {
    const error = await submitOmniVideoEdit("https://example.com/video.mp4", { GEMINI_API_KEY: "test" }, { editPrompt: "fix", confirmed: true }).catch((e) => e);
    assert.equal(error.code, undefined);
    assert.equal(error.message, "The provided video is corrupt.");
  } finally {
    global.fetch = originalFetch;
  }
});

test("submitOmniVideoEdit never retries automatically after a RATE_LIMITED or REGION_UNAVAILABLE response — exactly one /interactions call", async () => {
  const { fn, getInteractionsCallCount } = baseMockFetch({
    onInteractions: () => ({ ok: false, status: 429, headers: { get: () => null }, json: async () => ({ error: { status: "RESOURCE_EXHAUSTED", message: "quota" } }) })
  });
  const originalFetch = global.fetch;
  global.fetch = fn;
  try {
    await submitOmniVideoEdit("https://example.com/video.mp4", { GEMINI_API_KEY: "test" }, { editPrompt: "fix", confirmed: true }).catch(() => {});
    assert.equal(getInteractionsCallCount(), 1);
  } finally {
    global.fetch = originalFetch;
  }
});

test("waitForOmniFileActive throws when the file state becomes FAILED", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: true, json: async () => ({ name: "files/abc123", state: "FAILED" }) });
  try {
    await assert.rejects(() => waitForOmniFileActive("files/abc123", { GEMINI_API_KEY: "test" }), /FAILED/);
  } finally {
    global.fetch = originalFetch;
  }
});

test("waitForOmniFileActive throws after exhausting its bounded retry budget (no infinite loop)", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: true, json: async () => ({ name: "files/abc123", state: "PROCESSING" }) });
  try {
    await assert.rejects(
      () => waitForOmniFileActive("files/abc123", { GEMINI_API_KEY: "test" }, { maxAttempts: 2, intervalMs: 1 }),
      /zaman aşımı/
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test("omniInteractionStatus rejects when GEMINI_API_KEY is missing, before any network call", async () => {
  await assert.rejects(
    () => omniInteractionStatus({ interactionId: "v1_xyz" }, {}),
    /GEMINI_API_KEY/
  );
});

test("omniInteractionStatus rejects when job has no interactionId", async () => {
  await assert.rejects(
    () => omniInteractionStatus({}, { GEMINI_API_KEY: "test" }),
    /iş bilgisi eksik/
  );
});

test("omniInteractionStatus never duplicates an 'interactions/' prefix when polling by URL", async () => {
  const originalFetch = global.fetch;
  let requestedUrl = null;
  global.fetch = async (url) => { requestedUrl = String(url); return { ok: true, json: async () => ({ id: "v1_xyz", steps: [] }) }; };
  try {
    await omniInteractionStatus({ interactionId: "v1_xyz", model: OMNI_MODEL }, { GEMINI_API_KEY: "test" });
    assert.equal(requestedUrl, "https://generativelanguage.googleapis.com/v1beta/interactions/v1_xyz");
  } finally {
    global.fetch = originalFetch;
  }
});

test("omniInteractionStatus returns IN_PROGRESS while no model_output step is present yet", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: true, json: async () => ({ id: "v1_xyz", steps: [{ type: "thought" }] }) });
  try {
    const job = await omniInteractionStatus({ interactionId: "v1_xyz", model: OMNI_MODEL }, { GEMINI_API_KEY: "test" });
    assert.equal(job.status, "IN_PROGRESS");
  } finally {
    global.fetch = originalFetch;
  }
});

test("omniInteractionStatus returns COMPLETED with fileUri once a model_output video part with a uri appears", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: true, json: async () => ({ id: "v1_xyz", steps: [{ type: "model_output", content: [{ type: "video", uri: "https://example.com/files/final.mp4", mime_type: "video/mp4" }] }] }) });
  try {
    const job = await omniInteractionStatus({ interactionId: "v1_xyz", model: OMNI_MODEL }, { GEMINI_API_KEY: "test" });
    assert.equal(job.status, "COMPLETED");
    assert.equal(job.fileUri, "https://example.com/files/final.mp4");
  } finally {
    global.fetch = originalFetch;
  }
});

// Bu, Google'ın "GET /interactions/{id} delivery:'uri' istenmiş olsa bile
// inline base64 döndürebilir" davranışının polling tarafındaki karşılığı —
// önceki sürümde omniInteractionStatus SADECE bir uri bekliyordu ve bu
// durumda sonsuza kadar IN_PROGRESS kalabilirdi.
test("omniInteractionStatus returns COMPLETED with videoBase64 when polling returns inline base64 instead of a uri (regression guard for the fix)", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: true, json: async () => ({ id: "v1_xyz", steps: [{ type: "model_output", content: [{ type: "video", data: "AQIDBA==", mime_type: "video/mp4" }] }] }) });
  try {
    const job = await omniInteractionStatus({ interactionId: "v1_xyz", model: OMNI_MODEL }, { GEMINI_API_KEY: "test" });
    assert.equal(job.status, "COMPLETED");
    assert.equal(job.fileUri, null);
    assert.equal(job.videoBase64, "AQIDBA==");
  } finally {
    global.fetch = originalFetch;
  }
});

test("omniInteractionStatus throws a clear error when a model_output step exists but carries no video part", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: true, json: async () => ({ id: "v1_xyz", steps: [{ type: "model_output", content: [{ type: "text", text: "content policy violation" }] }] }) });
  try {
    await assert.rejects(
      () => omniInteractionStatus({ interactionId: "v1_xyz", model: OMNI_MODEL }, { GEMINI_API_KEY: "test" }),
      /content policy violation/
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test("omniInteractionStatus classifies a 429 the same way as the initial submit call", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: false, status: 429, headers: { get: () => null }, json: async () => ({ error: { status: "RESOURCE_EXHAUSTED", message: "quota" } }) });
  try {
    const error = await omniInteractionStatus({ interactionId: "v1_xyz", model: OMNI_MODEL }, { GEMINI_API_KEY: "test" }).catch((e) => e);
    assert.ok(error instanceof OmniApiError);
    assert.equal(error.code, "RATE_LIMITED");
  } finally {
    global.fetch = originalFetch;
  }
});

test("downloadOmniVideo throws a clear error on a non-ok response", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: false, status: 403 });
  try {
    await assert.rejects(() => downloadOmniVideo("https://example.com/files/final.mp4", { GEMINI_API_KEY: "test" }), /HTTP 403/);
  } finally {
    global.fetch = originalFetch;
  }
});
