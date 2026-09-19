import test from "node:test";
import assert from "node:assert/strict";
import { configuredKnowledgeProviders, resolveKnowledgeProvider } from "../src/knowledge/provider.js";

test("provider config requires both key and store", () => {
  assert.deepEqual(configuredKnowledgeProviders({ GEMINI_API_KEY: "g", GOOGLE_PRODUCT_KNOWLEDGE_STORE: "fileSearchStores/x" }), { google: true, openai: false });
  assert.deepEqual(configuredKnowledgeProviders({ OPENAI_API_KEY: "o", OPENAI_PRODUCT_KNOWLEDGE_VECTOR_STORE_ID: "vs_x" }), { google: false, openai: true });
  assert.deepEqual(configuredKnowledgeProviders({ GEMINI_API_KEY: "g" }), { google: false, openai: false });
});

test("auto deterministically prefers google, no failure fallback semantics are encoded here", () => {
  const env = { GEMINI_API_KEY: "g", GOOGLE_PRODUCT_KNOWLEDGE_STORE: "fileSearchStores/x", OPENAI_API_KEY: "o", OPENAI_PRODUCT_KNOWLEDGE_VECTOR_STORE_ID: "vs_x" };
  assert.deepEqual(resolveKnowledgeProvider("auto", env), { provider: "google", available: true });
  assert.deepEqual(resolveKnowledgeProvider("openai", env), { provider: "openai", available: true });
});
