import test from "node:test";
import assert from "node:assert/strict";
import { researchWithGoogle } from "../src/research/google-search.js";

test("researchWithGoogle: GEMINI_API_KEY yoksa hiçbir fetch atmadan hata fırlatır", async () => {
  let called = false;
  await assert.rejects(
    () => researchWithGoogle({ query: "test" }, {}, { fetchImpl: async () => { called = true; throw new Error("çağrılmamalıydı"); } }),
    /GEMINI_API_KEY/
  );
  assert.equal(called, false);
});

test("researchWithGoogle: x-goog-api-key header ile çağırır, sadece googleSearch tool'unu ekler (urls verilmezse urlContext eklenmez)", async () => {
  let seenHeaders, seenBody, seenUrl;
  const data = { candidates: [{ content: { parts: [{ text: "Cevap metni." }] }, groundingMetadata: { groundingChunks: [{ web: { uri: "https://example.com/a", title: "A" } }], webSearchQueries: ["test sorgusu"] } }] };
  const result = await researchWithGoogle({ query: "test sorgusu" }, { GEMINI_API_KEY: "gkey" }, {
    fetchImpl: async (url, options) => {
      seenUrl = url; seenHeaders = options.headers; seenBody = JSON.parse(options.body);
      return { ok: true, json: async () => data };
    }
  });
  assert.match(seenUrl, /generativelanguage\.googleapis\.com/);
  assert.equal(seenHeaders["x-goog-api-key"], "gkey");
  assert.deepEqual(seenBody.tools, [{ googleSearch: {} }]);
  assert.equal(result.answer, "Cevap metni.");
  assert.deepEqual(result.sources, [{ url: "https://example.com/a", title: "A", provider: "google" }]);
  assert.deepEqual(result.searchQueries, ["test sorgusu"]);
});

test("researchWithGoogle: urls verilirse urlContext tool'u eklenir ve urlContextMetadata sonuçları da kaynak olarak döner", async () => {
  let seenBody;
  const data = {
    candidates: [{
      content: { parts: [{ text: "Cevap." }] },
      urlContextMetadata: { urlMetadata: [{ retrievedUrl: "https://example.com/b", urlRetrievalStatus: "URL_RETRIEVAL_STATUS_SUCCESS" }] }
    }]
  };
  const result = await researchWithGoogle({ query: "test", urls: ["https://example.com/b"] }, { GEMINI_API_KEY: "gkey" }, {
    fetchImpl: async (url, options) => { seenBody = JSON.parse(options.body); return { ok: true, json: async () => data }; }
  });
  assert.deepEqual(seenBody.tools, [{ googleSearch: {} }, { urlContext: {} }]);
  assert.match(seenBody.contents[0].parts[0].text, /example\.com\/b/);
  assert.deepEqual(result.sources, [{ url: "https://example.com/b", title: "https://example.com/b", provider: "google" }]);
});

test("researchWithGoogle: başarısız URL Context retrieval kaynak listesine eklenmez", async () => {
  const data = {
    candidates: [{
      content: { parts: [{ text: "Cevap." }] },
      urlContextMetadata: { urlMetadata: [{ retrievedUrl: "https://example.com/paywall", urlRetrievalStatus: "URL_RETRIEVAL_STATUS_PAYWALL" }] }
    }]
  };
  const result = await researchWithGoogle({ query: "test", urls: ["https://example.com/paywall"] }, { GEMINI_API_KEY: "gkey" }, {
    fetchImpl: async () => ({ ok: true, json: async () => data })
  });
  assert.deepEqual(result.sources, []);
});

test("researchWithGoogle: HTTP hatası açık bir hata fırlatır", async () => {
  await assert.rejects(
    () => researchWithGoogle({ query: "test" }, { GEMINI_API_KEY: "gkey" }, {
      fetchImpl: async () => ({ ok: false, status: 429, json: async () => ({ error: { message: "quota exceeded" } }) })
    }),
    /quota exceeded/
  );
});

test("researchWithGoogle: groundingMetadata yoksa boş kaynak listesiyle (hata fırlatmadan) döner", async () => {
  const result = await researchWithGoogle({ query: "test" }, { GEMINI_API_KEY: "gkey" }, {
    fetchImpl: async () => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: "Cevap." }] } }] }) })
  });
  assert.deepEqual(result.sources, []);
  assert.deepEqual(result.searchQueries, []);
});
