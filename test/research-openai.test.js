import test from "node:test";
import assert from "node:assert/strict";
import { researchWithOpenAi } from "../src/research/openai-search.js";

test("researchWithOpenAi: OPENAI_API_KEY yoksa hiçbir fetch atmadan hata fırlatır", async () => {
  let called = false;
  await assert.rejects(
    () => researchWithOpenAi({ query: "test" }, {}, { fetchImpl: async () => { called = true; throw new Error("çağrılmamalıydı"); } }),
    /OPENAI_API_KEY/
  );
  assert.equal(called, false);
});

test("researchWithOpenAi: Authorization header ile /v1/responses'a web_search tool'uyla çağırır ve url_citation annotation'larını kaynak olarak normalize eder", async () => {
  let seenUrl, seenHeaders, seenBody;
  const data = {
    output_text: "Cevap metni.",
    output: [{ content: [{ text: "Cevap metni.", annotations: [{ type: "url_citation", url: "https://example.com/a", title: "A" }] }] }]
  };
  const result = await researchWithOpenAi({ query: "test sorgusu" }, { OPENAI_API_KEY: "okey" }, {
    fetchImpl: async (url, options) => {
      seenUrl = url; seenHeaders = options.headers; seenBody = JSON.parse(options.body);
      return { ok: true, json: async () => data };
    }
  });
  assert.match(seenUrl, /api\.openai\.com\/v1\/responses/);
  assert.equal(seenHeaders.Authorization, "Bearer okey");
  assert.deepEqual(seenBody.tools, [{ type: "web_search" }]);
  assert.equal(result.answer, "Cevap metni.");
  assert.deepEqual(result.sources, [{ url: "https://example.com/a", title: "A", provider: "openai" }]);
});

test("researchWithOpenAi: OPENAI_WEB_SEARCH_TOOL_TYPE override edilebilir (API tool adı değişirse SESSİZCE eski adda kalınmaz)", async () => {
  let seenBody;
  const result = await researchWithOpenAi({ query: "test" }, { OPENAI_API_KEY: "okey", OPENAI_WEB_SEARCH_TOOL_TYPE: "web_search_preview" }, {
    fetchImpl: async (url, options) => { seenBody = JSON.parse(options.body); return { ok: true, json: async () => ({ output_text: "x", output: [] }) }; }
  });
  assert.deepEqual(seenBody.tools, [{ type: "web_search_preview" }]);
  assert.equal(result.answer, "x");
});

test("researchWithOpenAi: urls verilirse input metnine eklenir", async () => {
  let seenBody;
  await researchWithOpenAi({ query: "test", urls: ["https://example.com/b"] }, { OPENAI_API_KEY: "okey" }, {
    fetchImpl: async (url, options) => { seenBody = JSON.parse(options.body); return { ok: true, json: async () => ({ output_text: "x", output: [] }) }; }
  });
  assert.match(seenBody.input, /example\.com\/b/);
});

test("researchWithOpenAi: annotation type'ı url_citation değilse (veya yoksa) kaynak listesi boş döner, hata FIRLATMAZ", async () => {
  const result = await researchWithOpenAi({ query: "test" }, { OPENAI_API_KEY: "okey" }, {
    fetchImpl: async () => ({ ok: true, json: async () => ({ output_text: "x", output: [{ content: [{ text: "x", annotations: [{ type: "file_citation" }] }] }] }) })
  });
  assert.deepEqual(result.sources, []);
});

test("researchWithOpenAi: HTTP hatası açık bir hata fırlatır", async () => {
  await assert.rejects(
    () => researchWithOpenAi({ query: "test" }, { OPENAI_API_KEY: "okey" }, {
      fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({ error: { message: "internal error" } }) })
    }),
    /internal error/
  );
});
