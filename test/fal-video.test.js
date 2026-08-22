import test from "node:test";
import assert from "node:assert/strict";
import { falModel, submitFalVideo, MAX_FAL_PROMPT_LENGTH } from "../src/fal-video.js";

test("falModel defaults to fal-ai/minimax-video/image-to-video and respects FAL_VIDEO_MODEL override", () => {
  assert.equal(falModel({}), "fal-ai/minimax-video/image-to-video");
  assert.equal(falModel({ FAL_VIDEO_MODEL: "fal-ai/other-model" }), "fal-ai/other-model");
});

test("submitFalVideo rejects when FAL_KEY is missing, before any network call", async () => {
  await assert.rejects(
    () => submitFalVideo({ title: "Code Advantage", imageUrl: "https://example.com/x.jpg" }, {}),
    /FAL_KEY/
  );
});

test("submitFalVideo rejects a non-HTTPS product image URL", async () => {
  await assert.rejects(
    () => submitFalVideo({ title: "Code Advantage", imageUrl: "not-a-url" }, { FAL_KEY: "test" }),
    /HTTPS/
  );
});

test("submitFalVideo rejects a finalizedPrompt longer than fal.ai's own limit, before any network call", async () => {
  const finalizedPrompt = "a".repeat(MAX_FAL_PROMPT_LENGTH + 1);
  await assert.rejects(
    () => submitFalVideo({ title: "Code Advantage", imageUrl: "https://example.com/x.jpg" }, { FAL_KEY: "test" }, { finalizedPrompt }),
    /Prompt çok uzun/
  );
});

test("submitFalVideo sends a preview-approved finalizedPrompt to fal.ai byte-identical, without rebuilding it", async () => {
  const originalFetch = global.fetch;
  let capturedBody = null;
  global.fetch = async (url, options) => {
    capturedBody = JSON.parse(options.body);
    return { ok: true, json: async () => ({ request_id: "req_1", status_url: "https://queue.fal.run/status", response_url: "https://queue.fal.run/response", queue_position: 0 }) };
  };
  try {
    const finalizedPrompt = "REFERENCE:\ntest\n\nPRESERVE:\ntest\n\nMOTION:\nözel hareket metni\n\nCAMERA:\ntest\n\nCONSTRAINTS:\ntest";
    const job = await submitFalVideo({ title: "Code Advantage", imageUrl: "https://example.com/image.jpg" }, { FAL_KEY: "test" }, { finalizedPrompt });
    assert.equal(capturedBody.prompt, finalizedPrompt);
    assert.equal(job.prompt, finalizedPrompt);
  } finally {
    global.fetch = originalFetch;
  }
});
