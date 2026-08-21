import test from "node:test";
import assert from "node:assert/strict";
import { availableProviders } from "../src/ai-providers.js";

test("AI provider availability is derived from configured keys", () => {
  assert.deepEqual(availableProviders({ OPENAI_API_KEY: "x", ANTHROPIC_API_KEY: "", GEMINI_API_KEY: "y" }), ["openai", "gemini"]);
  assert.deepEqual(availableProviders({ FAL_KEY: "fal-test" }), ["fal"]);
});
