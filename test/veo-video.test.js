import test from "node:test";
import assert from "node:assert/strict";
import { veoModel, resolveVeoModel, submitVeoVideo, veoVideoStatus, VeoApiError, VEO_MODEL_TIERS } from "../src/veo-video.js";
import { MAX_FAL_PROMPT_LENGTH } from "../src/fal-video.js";

test("resolveVeoModel with no input and no env config defaults to economy (Lite) — NOT fast, since Fast's daily quota is the reported problem", () => {
  assert.equal(resolveVeoModel(undefined, {}), VEO_MODEL_TIERS.economy);
});

test("veoModel (backward-compatible wrapper) defaults to economy with no config", () => {
  assert.equal(veoModel({}), VEO_MODEL_TIERS.economy);
});

test("resolveVeoModel accepts tier names directly", () => {
  assert.equal(resolveVeoModel("economy", {}), VEO_MODEL_TIERS.economy);
  assert.equal(resolveVeoModel("fast", {}), VEO_MODEL_TIERS.fast);
  assert.equal(resolveVeoModel("quality", {}), VEO_MODEL_TIERS.quality);
});

test("resolveVeoModel accepts an already-valid raw model ID unchanged (backward compat with old VEO_VIDEO_MODEL usage)", () => {
  assert.equal(resolveVeoModel(undefined, { VEO_VIDEO_MODEL: "veo-3.1-generate-preview" }), "veo-3.1-generate-preview");
  assert.equal(veoModel({ VEO_VIDEO_MODEL: "veo-3.1-generate-preview" }), "veo-3.1-generate-preview");
});

test("resolveVeoModel: VEO_VIDEO_MODEL also accepts a tier name, not just a raw model ID", () => {
  assert.equal(resolveVeoModel(undefined, { VEO_VIDEO_MODEL: "quality" }), VEO_MODEL_TIERS.quality);
});

test("resolveVeoModel: VEO_DEFAULT_TIER is used when no call-site model and no VEO_VIDEO_MODEL are set", () => {
  assert.equal(resolveVeoModel(undefined, { VEO_DEFAULT_TIER: "quality" }), VEO_MODEL_TIERS.quality);
});

test("resolveVeoModel priority: call-site model beats VEO_VIDEO_MODEL, which beats VEO_DEFAULT_TIER", () => {
  assert.equal(resolveVeoModel("fast", { VEO_VIDEO_MODEL: "quality", VEO_DEFAULT_TIER: "economy" }), VEO_MODEL_TIERS.fast);
  assert.equal(resolveVeoModel(undefined, { VEO_VIDEO_MODEL: "quality", VEO_DEFAULT_TIER: "economy" }), VEO_MODEL_TIERS.quality);
});

test("resolveVeoModel: an explicit \"auto\" at any layer defers to the next layer instead of resolving to a model itself", () => {
  assert.equal(resolveVeoModel("auto", { VEO_VIDEO_MODEL: "auto", VEO_DEFAULT_TIER: "fast" }), VEO_MODEL_TIERS.fast);
  assert.equal(resolveVeoModel("auto", {}), VEO_MODEL_TIERS.economy);
});

test("resolveVeoModel rejects an unknown tier/model name, listing the valid options", () => {
  assert.throws(() => resolveVeoModel("bogus-model", {}), /auto, economy, fast, quality/);
});

test("resolveVeoModel rejects an unknown VEO_VIDEO_MODEL env value the same way", () => {
  assert.throws(() => resolveVeoModel(undefined, { VEO_VIDEO_MODEL: "bogus-model" }), /Desteklenmeyen Veo modeli/);
});

test("submitVeoVideo rejects when GEMINI_API_KEY is missing, before any network call", async () => {
  await assert.rejects(
    () => submitVeoVideo({ title: "Code Advantage", imageUrl: "https://example.com/x.jpg" }, {}),
    /GEMINI_API_KEY/
  );
});

test("submitVeoVideo rejects an invalid model BEFORE downloading the product image (no fetch at all)", async () => {
  const originalFetch = global.fetch;
  let fetchCalls = 0;
  global.fetch = async () => { fetchCalls++; throw new Error("fetch should not be called for an invalid model"); };
  try {
    await assert.rejects(
      () => submitVeoVideo({ title: "Code Advantage", imageUrl: "https://example.com/x.jpg" }, { GEMINI_API_KEY: "test" }, { model: "bogus-model" }),
      /Desteklenmeyen Veo modeli/
    );
    assert.equal(fetchCalls, 0);
  } finally {
    global.fetch = originalFetch;
  }
});

test("submitVeoVideo rejects a non-HTTPS product image URL", async () => {
  await assert.rejects(
    () => submitVeoVideo({ title: "Code Advantage", imageUrl: "not-a-url" }, { GEMINI_API_KEY: "test" }),
    /HTTPS/
  );
});

test("veoVideoStatus rejects when GEMINI_API_KEY is missing, before any network call", async () => {
  await assert.rejects(
    () => veoVideoStatus({ operationName: "operations/1" }, {}),
    /GEMINI_API_KEY/
  );
});

test("veoVideoStatus rejects when job has no operationName", async () => {
  await assert.rejects(
    () => veoVideoStatus({}, { GEMINI_API_KEY: "test" }),
    /iş bilgisi eksik/
  );
});

test("submitVeoVideo has no fal.ai-style prompt length cap — a prompt well past fal.ai's limit still submits fine", async () => {
  const originalFetch = global.fetch;
  global.fetch = async (url, options) => {
    if (!options) return { ok: true, headers: { get: () => "image/jpeg" }, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
    return { ok: true, json: async () => ({ name: "operations/test-op" }) };
  };
  try {
    const finalizedPrompt = `MOTION:\n${"a".repeat(MAX_FAL_PROMPT_LENGTH + 500)}`;
    const job = await submitVeoVideo({ title: "Code Advantage", imageUrl: "https://example.com/image.jpg" }, { GEMINI_API_KEY: "test" }, { finalizedPrompt });
    assert.equal(job.prompt, finalizedPrompt);
  } finally {
    global.fetch = originalFetch;
  }
});

test("submitVeoVideo sends a preview-approved finalizedPrompt to Veo byte-identical, without rebuilding it", async () => {
  const originalFetch = global.fetch;
  let capturedBody = null;
  global.fetch = async (url, options) => {
    if (!options) return { ok: true, headers: { get: () => "image/jpeg" }, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
    capturedBody = JSON.parse(options.body);
    return { ok: true, json: async () => ({ name: "operations/test-op" }) };
  };
  try {
    const finalizedPrompt = "REFERENCE:\ntest\n\nPRESERVE:\ntest\n\nMOTION:\nözel hareket metni\n\nCAMERA:\ntest\n\nCONSTRAINTS:\ntest";
    const job = await submitVeoVideo({ title: "Code Advantage", imageUrl: "https://example.com/image.jpg" }, { GEMINI_API_KEY: "test" }, { finalizedPrompt });
    assert.equal(capturedBody.instances[0].prompt, finalizedPrompt);
    assert.equal(job.prompt, finalizedPrompt);
  } finally {
    global.fetch = originalFetch;
  }
});

test("submitVeoVideo sends the resolved model in the Veo request URL for each tier", async () => {
  const originalFetch = global.fetch;
  let requestedUrl = null;
  global.fetch = async (url, options) => {
    if (!options) return { ok: true, headers: { get: () => "image/jpeg" }, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
    requestedUrl = String(url);
    return { ok: true, json: async () => ({ name: "operations/test-op" }) };
  };
  try {
    await submitVeoVideo({ title: "x", imageUrl: "https://example.com/x.jpg" }, { GEMINI_API_KEY: "test" }, { finalizedPrompt: "p", model: "economy" });
    assert.match(requestedUrl, /models\/veo-3\.1-lite-generate-preview:predictLongRunning/);
  } finally {
    global.fetch = originalFetch;
  }
});

function mock429Response({ retryAfterHeader, details } = {}) {
  return {
    ok: false,
    status: 429,
    headers: { get: (name) => (name.toLowerCase() === "retry-after" ? retryAfterHeader ?? null : null) },
    json: async () => ({
      error: {
        code: 429,
        message: "Resource has been exhausted (e.g. check quota).",
        status: "RESOURCE_EXHAUSTED",
        details: details ?? [
          { "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier", quotaMetric: "generativelanguage.googleapis.com/generate_content_free_tier_requests" }] },
          { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "36s" }
        ]
      }
    })
  };
}

test("submitVeoVideo classifies HTTP 429 as VeoApiError with code RATE_LIMITED, carrying model/providerStatus/quota/retryAfter/alternatives", async () => {
  const originalFetch = global.fetch;
  let veoCallCount = 0;
  global.fetch = async (url, options) => {
    if (!options) return { ok: true, headers: { get: () => "image/jpeg" }, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
    veoCallCount++;
    return mock429Response();
  };
  try {
    const error = await submitVeoVideo({ title: "x", imageUrl: "https://example.com/x.jpg" }, { GEMINI_API_KEY: "test" }, { finalizedPrompt: "p", model: "fast" }).catch((e) => e);
    assert.ok(error instanceof VeoApiError);
    assert.equal(error.code, "RATE_LIMITED");
    assert.equal(error.httpStatus, 429);
    assert.equal(error.model, VEO_MODEL_TIERS.fast);
    assert.equal(error.providerStatus, "RESOURCE_EXHAUSTED");
    assert.equal(error.retryAfter, 36);
    assert.deepEqual(error.alternatives.map((a) => a.tier), ["economy", "quality"]);
    assert.equal(error.details.quotaId, "GenerateRequestsPerDayPerProjectPerModel-FreeTier");
    // Asla "kesin RPD doldu" denmemeli — RPM/RPD ayrımı belirsiz bırakılmalı.
    assert.doesNotMatch(error.message, /kesinlikle günlük/i);
    // Rate limit sonrası ASLA otomatik olarak başka bir modelle ikinci bir
    // deneme yapılmamalı — tek bir Veo çağrısı (ilk fetch görsel indirme,
    // ikincisi Veo isteğinin kendisi) olmalı.
    assert.equal(veoCallCount, 1);
  } finally {
    global.fetch = originalFetch;
  }
});

test("submitVeoVideo prefers the HTTP Retry-After header over Google's RetryInfo detail when both are present", async () => {
  const originalFetch = global.fetch;
  global.fetch = async (url, options) => {
    if (!options) return { ok: true, headers: { get: () => "image/jpeg" }, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
    return mock429Response({ retryAfterHeader: "12" });
  };
  try {
    const error = await submitVeoVideo({ title: "x", imageUrl: "https://example.com/x.jpg" }, { GEMINI_API_KEY: "test" }, { finalizedPrompt: "p" }).catch((e) => e);
    assert.equal(error.retryAfter, 12);
  } finally {
    global.fetch = originalFetch;
  }
});

test("submitVeoVideo reports quotaType 'unknown' when Google's 429 response carries no QuotaFailure/RetryInfo details", async () => {
  const originalFetch = global.fetch;
  global.fetch = async (url, options) => {
    if (!options) return { ok: true, headers: { get: () => "image/jpeg" }, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
    return mock429Response({ details: [] });
  };
  try {
    const error = await submitVeoVideo({ title: "x", imageUrl: "https://example.com/x.jpg" }, { GEMINI_API_KEY: "test" }, { finalizedPrompt: "p" }).catch((e) => e);
    assert.equal(error.details.quotaType, "unknown");
    assert.equal(error.retryAfter, null);
  } finally {
    global.fetch = originalFetch;
  }
});

test("submitVeoVideo: a non-429 error status (e.g. 500) still behaves exactly as before — plain Error, no .code (regression guard)", async () => {
  const originalFetch = global.fetch;
  global.fetch = async (url, options) => {
    if (!options) return { ok: true, headers: { get: () => "image/jpeg" }, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
    return { ok: false, status: 500, headers: { get: () => null }, json: async () => ({ error: { message: "internal error" } }) };
  };
  try {
    const error = await submitVeoVideo({ title: "x", imageUrl: "https://example.com/x.jpg" }, { GEMINI_API_KEY: "test" }, { finalizedPrompt: "p" }).catch((e) => e);
    assert.equal(error.code, undefined);
    assert.equal(error.message, "internal error");
  } finally {
    global.fetch = originalFetch;
  }
});

test("veoVideoStatus classifies a 429 the same way, using the model recorded on the job", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => mock429Response();
  try {
    const error = await veoVideoStatus({ operationName: "operations/1", model: VEO_MODEL_TIERS.quality }, { GEMINI_API_KEY: "test" }).catch((e) => e);
    assert.ok(error instanceof VeoApiError);
    assert.equal(error.code, "RATE_LIMITED");
    assert.equal(error.model, VEO_MODEL_TIERS.quality);
    assert.deepEqual(error.alternatives.map((a) => a.tier), ["economy", "fast"]);
  } finally {
    global.fetch = originalFetch;
  }
});
