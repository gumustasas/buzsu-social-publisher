import test from "node:test";
import assert from "node:assert/strict";
import { searchKnowledgeWithOpenAi } from "../src/knowledge/openai.js";

test("OpenAI uses Responses file_search vector store + json_schema", async () => {
  let body;
  const result = await searchKnowledgeWithOpenAi(
    { query: "soru", authoritative: { airtable: null, buzsuOfficial: { verifiedFacts: [] } } },
    { OPENAI_API_KEY: "o", OPENAI_PRODUCT_KNOWLEDGE_VECTOR_STORE_ID: "vs_1", OPENAI_PRODUCT_KNOWLEDGE_MODEL: "gpt-test" },
    { fetchImpl: async (url, options) => {
      assert.equal(url, "https://api.openai.com/v1/responses");
      body = JSON.parse(options.body);
      return {
        ok: true,
        json: async () => ({
          output_text: JSON.stringify({ answer: "a", retrievedFacts: [], conflicts: [] }),
          output: [{ type: "file_search_call", results: [{ file_id: "f1", filename: "manual.pdf", score: 0.9, text: "chunk" }] }]
        })
      };
    } }
  );
  assert.deepEqual(body.tools[0], { type: "file_search", vector_store_ids: ["vs_1"] });
  assert.deepEqual(body.include, ["file_search_call.results"]);
  assert.equal(body.text.format.type, "json_schema");
  assert.equal(result.citations[0].fileName, "manual.pdf");
});

test("OpenAI invalid shape fails closed", async () => {
  await assert.rejects(() => searchKnowledgeWithOpenAi(
    { query: "q", authoritative: {} },
    { OPENAI_API_KEY: "o", OPENAI_PRODUCT_KNOWLEDGE_VECTOR_STORE_ID: "vs_1" },
    { fetchImpl: async () => ({ ok: true, json: async () => ({ output_text: JSON.stringify({ answer: "a" }) }) }) }
  ), /şeması geçersiz/);
});


test("OpenAI retries malformed strict JSON on same provider and drops include after first attempt", async () => {
  const seenBodies = [];
  let calls = 0;
  const result = await searchKnowledgeWithOpenAi(
    { query: "soru", authoritative: { airtable: null, buzsuOfficial: { verifiedFacts: [] } } },
    { OPENAI_API_KEY: "o", OPENAI_PRODUCT_KNOWLEDGE_VECTOR_STORE_ID: "vs_1", OPENAI_PRODUCT_KNOWLEDGE_MODEL: "gpt-test" },
    { fetchImpl: async (url, options) => {
      calls++;
      seenBodies.push(JSON.parse(options.body));
      if (calls === 1) {
        return { ok: true, json: async () => ({ output_text: '{"answer":"a":"broken"}', output: [{ type: "file_search_call", results: [{ file_id: "f1", filename: "manual.pdf", text: "chunk" }] }] }) };
      }
      return { ok: true, json: async () => ({ output_text: JSON.stringify({ answer: "a", retrievedFacts: [], conflicts: [] }), output: [] }) };
    } }
  );
  assert.equal(calls, 2);
  assert.deepEqual(seenBodies[0].include, ["file_search_call.results"]);
  assert.equal("include" in seenBodies[1], false);
  assert.equal(result.parseRetryCount, 1);
  assert.deepEqual(result.citations, []);
});

test("OpenAI malformed JSON remains fail-closed after bounded retries", async () => {
  let calls = 0;
  await assert.rejects(() => searchKnowledgeWithOpenAi(
    { query: "q", authoritative: {} },
    { OPENAI_API_KEY: "o", OPENAI_PRODUCT_KNOWLEDGE_VECTOR_STORE_ID: "vs_1" },
    { fetchImpl: async () => {
      calls++;
      return { ok: true, json: async () => ({ output_text: "not-json" }) };
    } }
  ), /geçersiz JSON/);
  assert.equal(calls, 3);
});
