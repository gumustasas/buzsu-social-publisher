import test from "node:test";
import assert from "node:assert/strict";
import { submitOmniVideoEdit, omniInteractionStatus, downloadOmniVideo, waitForOmniFileActive, OmniApiError, OMNI_MODEL } from "../src/omni-video.js";

// Genel amaçlı mock fetch — src/omni-video.js'nin akışındaki ardışık
// isteklere (video indirme -> Files API start -> Files API upload/finalize
// -> dosya durumu poll -> /interactions POST -> [opsiyonel] görsel indirme)
// URL/metoda göre yanıt üretir. Gerçek ağ isteği HİÇBİR testte atılmaz.
function baseMockFetch({ onInteractions, fileState = "ACTIVE" } = {}) {
  let interactionsCallCount = 0;
  const fn = async (url, options) => {
    const href = String(url);
    if (!options && href.startsWith("https://example.com/video")) {
      return { ok: true, headers: { get: () => "video/mp4" }, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
    }
    if (!options && href.startsWith("https://example.com/image")) {
      return { ok: true, headers: { get: () => "image/jpeg" }, arrayBuffer: async () => new Uint8Array([4, 5, 6]).buffer };
    }
    if (href.includes("/upload/v1beta/files") && options?.headers?.["X-Goog-Upload-Command"] === "start") {
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
      return { ok: true, json: async () => ({ id: "interactions/xyz", outputs: [{ content: [{ file_data: { file_uri: "https://example.com/files/output.mp4" } }] }] }) };
    }
    throw new Error(`Beklenmeyen fetch: ${href}`);
  };
  return { fn, getInteractionsCallCount: () => interactionsCallCount };
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

test("submitOmniVideoEdit sends the fixed OMNI_MODEL and the edit prompt as text content", async () => {
  const originalFetch = global.fetch;
  let capturedBody = null;
  const { fn } = baseMockFetch({
    onInteractions: (url, options) => { capturedBody = JSON.parse(options.body); return { ok: true, json: async () => ({ id: "interactions/xyz", outputs: [] }) }; }
  });
  global.fetch = fn;
  try {
    const job = await submitOmniVideoEdit("https://example.com/video.mp4", { GEMINI_API_KEY: "test" }, { editPrompt: "yalnızca ürünü değiştir", confirmed: true });
    assert.equal(capturedBody.model, OMNI_MODEL);
    assert.equal(job.model, OMNI_MODEL);
    assert.equal(capturedBody.input[0].content[0].text, "yalnızca ürünü değiştir");
    assert.equal(capturedBody.input[0].content[1].file_data.file_uri, "https://example.com/files/abc123");
  } finally {
    global.fetch = originalFetch;
  }
});

test("submitOmniVideoEdit includes an inline reference image only when referenceImageUrl is given", async () => {
  const originalFetch = global.fetch;
  let capturedBody = null;
  const { fn } = baseMockFetch({
    onInteractions: (url, options) => { capturedBody = JSON.parse(options.body); return { ok: true, json: async () => ({ id: "interactions/xyz", outputs: [] }) }; }
  });
  global.fetch = fn;
  try {
    await submitOmniVideoEdit("https://example.com/video.mp4", { GEMINI_API_KEY: "test" }, { editPrompt: "fix", referenceImageUrl: "https://example.com/image.png", confirmed: true });
    assert.equal(capturedBody.input[0].content.length, 3);
    assert.ok(capturedBody.input[0].content[2].inline_data.data);
  } finally {
    global.fetch = originalFetch;
  }
});

test("submitOmniVideoEdit without referenceImageUrl sends only text + video file parts", async () => {
  const originalFetch = global.fetch;
  let capturedBody = null;
  const { fn } = baseMockFetch({
    onInteractions: (url, options) => { capturedBody = JSON.parse(options.body); return { ok: true, json: async () => ({ id: "interactions/xyz", outputs: [] }) }; }
  });
  global.fetch = fn;
  try {
    await submitOmniVideoEdit("https://example.com/video.mp4", { GEMINI_API_KEY: "test" }, { editPrompt: "fix", confirmed: true });
    assert.equal(capturedBody.input[0].content.length, 2);
  } finally {
    global.fetch = originalFetch;
  }
});

test("submitOmniVideoEdit returns COMPLETED with fileUri when the interaction response already carries an output video", async () => {
  const { fn } = baseMockFetch();
  const originalFetch = global.fetch;
  global.fetch = fn;
  try {
    const job = await submitOmniVideoEdit("https://example.com/video.mp4", { GEMINI_API_KEY: "test" }, { editPrompt: "fix", confirmed: true });
    assert.equal(job.status, "COMPLETED");
    assert.equal(job.fileUri, "https://example.com/files/output.mp4");
    assert.equal(job.provider, "omni");
  } finally {
    global.fetch = originalFetch;
  }
});

test("submitOmniVideoEdit returns IN_PROGRESS (not an error) when the interaction response carries no output video yet", async () => {
  const { fn } = baseMockFetch({ onInteractions: () => ({ ok: true, json: async () => ({ id: "interactions/xyz", outputs: [] }) }) });
  const originalFetch = global.fetch;
  global.fetch = fn;
  try {
    const job = await submitOmniVideoEdit("https://example.com/video.mp4", { GEMINI_API_KEY: "test" }, { editPrompt: "fix", confirmed: true });
    assert.equal(job.status, "IN_PROGRESS");
    assert.equal(job.fileUri, null);
    assert.equal(job.interactionId, "interactions/xyz");
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
    () => omniInteractionStatus({ interactionId: "interactions/xyz" }, {}),
    /GEMINI_API_KEY/
  );
});

test("omniInteractionStatus rejects when job has no interactionId", async () => {
  await assert.rejects(
    () => omniInteractionStatus({}, { GEMINI_API_KEY: "test" }),
    /iş bilgisi eksik/
  );
});

test("omniInteractionStatus returns IN_PROGRESS while no output video is present yet", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: true, json: async () => ({ id: "interactions/xyz", outputs: [] }) });
  try {
    const job = await omniInteractionStatus({ interactionId: "interactions/xyz", model: OMNI_MODEL }, { GEMINI_API_KEY: "test" });
    assert.equal(job.status, "IN_PROGRESS");
  } finally {
    global.fetch = originalFetch;
  }
});

test("omniInteractionStatus returns COMPLETED with fileUri once an output video appears", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: true, json: async () => ({ id: "interactions/xyz", outputs: [{ content: [{ file_data: { file_uri: "https://example.com/files/final.mp4" } }] }] }) });
  try {
    const job = await omniInteractionStatus({ interactionId: "interactions/xyz", model: OMNI_MODEL }, { GEMINI_API_KEY: "test" });
    assert.equal(job.status, "COMPLETED");
    assert.equal(job.fileUri, "https://example.com/files/final.mp4");
  } finally {
    global.fetch = originalFetch;
  }
});

test("omniInteractionStatus classifies a 429 the same way as the initial submit call", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: false, status: 429, headers: { get: () => null }, json: async () => ({ error: { status: "RESOURCE_EXHAUSTED", message: "quota" } }) });
  try {
    const error = await omniInteractionStatus({ interactionId: "interactions/xyz", model: OMNI_MODEL }, { GEMINI_API_KEY: "test" }).catch((e) => e);
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
