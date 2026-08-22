import test from "node:test";
import assert from "node:assert/strict";
import { veoModel, submitVeoVideo, veoVideoStatus } from "../src/veo-video.js";
import { MAX_FAL_PROMPT_LENGTH } from "../src/fal-video.js";

test("veoModel defaults to veo-3.1-fast-generate-preview and respects VEO_VIDEO_MODEL override", () => {
  assert.equal(veoModel({}), "veo-3.1-fast-generate-preview");
  assert.equal(veoModel({ VEO_VIDEO_MODEL: "veo-3.1-generate-preview" }), "veo-3.1-generate-preview");
});

test("submitVeoVideo rejects when GEMINI_API_KEY is missing, before any network call", async () => {
  await assert.rejects(
    () => submitVeoVideo({ title: "Code Advantage", imageUrl: "https://example.com/x.jpg" }, {}),
    /GEMINI_API_KEY/
  );
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
