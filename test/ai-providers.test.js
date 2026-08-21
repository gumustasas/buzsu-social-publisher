import test from "node:test";
import assert from "node:assert/strict";
import { availableProviders, generateScenePlan } from "../src/ai-providers.js";

test("AI provider availability is derived from configured keys", () => {
  assert.deepEqual(availableProviders({ OPENAI_API_KEY: "x", ANTHROPIC_API_KEY: "", GEMINI_API_KEY: "y" }), ["openai", "gemini"]);
  assert.deepEqual(availableProviders({ FAL_KEY: "fal-test" }), ["fal"]);
});

test("generateScenePlan rejects an unsupported provider before making any network call", async () => {
  await assert.rejects(
    () => generateScenePlan("anthropic", { title: "Code Advantage" }, {}),
    /Desteklenmeyen AI sağlayıcısı/
  );
});
