import test from "node:test";
import assert from "node:assert/strict";
import { searchKnowledgeWithGoogle } from "../src/knowledge/google.js";

test("Google uses Interactions file_search store and structured response format", async () => {
  let body;
  const result = await searchKnowledgeWithGoogle(
    { query: "soru", authoritative: { airtable: null, buzsuOfficial: { verifiedFacts: [] } } },
    { GEMINI_API_KEY: "g", GOOGLE_PRODUCT_KNOWLEDGE_STORE: "fileSearchStores/store1" },
    { fetchImpl: async (url, options) => {
      assert.equal(url, "https://generativelanguage.googleapis.com/v1beta/interactions");
      body = JSON.parse(options.body);
      return {
        ok: true,
        json: async () => ({
          steps: [{ type: "model_output", content: [{ type: "text", text: JSON.stringify({ answer: "a", retrievedFacts: [], conflicts: [] }), annotations: [{ type: "file_citation", file_name: "manual.pdf", source: "fileSearchStores/store1/documents/1" }] }] }]
        })
      };
    } }
  );
  assert.equal(body.tools[0].type, "file_search");
  assert.deepEqual(body.tools[0].file_search_store_names, ["fileSearchStores/store1"]);
  assert.equal(body.response_format.mime_type, "application/json");
  assert.equal(result.citations[0].fileName, "manual.pdf");
});

test("Google malformed structured output fails closed", async () => {
  await assert.rejects(() => searchKnowledgeWithGoogle(
    { query: "q", authoritative: {} },
    { GEMINI_API_KEY: "g", GOOGLE_PRODUCT_KNOWLEDGE_STORE: "fileSearchStores/s" },
    { fetchImpl: async () => ({ ok: true, json: async () => ({ output_text: "not-json" }) }) }
  ), /geçersiz JSON/);
});
