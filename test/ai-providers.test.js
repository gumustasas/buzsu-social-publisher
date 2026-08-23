import test from "node:test";
import assert from "node:assert/strict";
import { availableProviders, generateScenePlan, generateCaption } from "../src/ai-providers.js";

test("AI provider availability is derived from configured keys", () => {
  assert.deepEqual(availableProviders({ OPENAI_API_KEY: "x", ANTHROPIC_API_KEY: "", GEMINI_API_KEY: "y" }), ["openai", "gemini", "veo"]);
  assert.deepEqual(availableProviders({ FAL_KEY: "fal-test" }), ["fal"]);
});

test("generateScenePlan rejects an unsupported provider before making any network call", async () => {
  await assert.rejects(
    () => generateScenePlan("anthropic", { title: "Code Advantage" }, {}),
    /Desteklenmeyen AI sağlayıcısı/
  );
});

test("generateCaption rejects an unsupported provider before making any network call", async () => {
  await assert.rejects(
    () => generateCaption("fal", { title: "Code Advantage" }, {}),
    /Desteklenmeyen AI sağlayıcısı/
  );
});

// Sahne görseli için kredili OPENAI_IMAGE_API_KEY zaten çalışıyor (bkz.
// src/scene-image.js) — sahne planı metni de artık aynı kredili anahtarı,
// eski (kredisiz) OPENAI_API_KEY yerine kullanmalı; ayrıca düşük maliyetli
// gpt-5.4-nano modeline sabit olmalı.
test("generateScenePlan uses the working OPENAI_IMAGE_API_KEY (not the depleted OPENAI_API_KEY) and the cheap gpt-5.4-nano model for provider 'openai'", async () => {
  const originalFetch = global.fetch;
  let capturedAuth = null, capturedBody = null;
  global.fetch = async (url, options) => {
    capturedAuth = options.headers.Authorization;
    capturedBody = JSON.parse(options.body);
    return { ok: true, json: async () => ({ output_text: "test sahne planı" }) };
  };
  try {
    const plan = await generateScenePlan("openai", { title: "Code Advantage" }, { OPENAI_API_KEY: "depleted-key", OPENAI_IMAGE_API_KEY: "credited-key" });
    assert.equal(capturedAuth, "Bearer credited-key");
    assert.equal(capturedBody.model, "gpt-5.4-nano");
    assert.equal(plan, "test sahne planı");
  } finally {
    global.fetch = originalFetch;
  }
});

test("generateScenePlan falls back to OPENAI_API_KEY when no separate OPENAI_IMAGE_API_KEY is set", async () => {
  const originalFetch = global.fetch;
  let capturedAuth = null;
  global.fetch = async (url, options) => {
    capturedAuth = options.headers.Authorization;
    return { ok: true, json: async () => ({ output_text: "test sahne planı" }) };
  };
  try {
    await generateScenePlan("openai", { title: "Code Advantage" }, { OPENAI_API_KEY: "only-key" });
    assert.equal(capturedAuth, "Bearer only-key");
  } finally {
    global.fetch = originalFetch;
  }
});
