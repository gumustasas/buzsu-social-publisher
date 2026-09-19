import test from "node:test";
import assert from "node:assert/strict";
import { researchWeb, RESEARCH_PROVIDERS } from "../src/research/index.js";

test("RESEARCH_PROVIDERS index.js üzerinden de erişilebilir", () => {
  assert.deepEqual(RESEARCH_PROVIDERS, ["google", "openai"]);
});

test("researchWeb: boş query hiçbir sağlayıcıya istek atmadan reddedilir", async () => {
  await assert.rejects(() => researchWeb({ query: "" }, { GEMINI_API_KEY: "g" }), /query/);
});

test("researchWeb: geçersiz provider hiçbir istek atmadan reddedilir", async () => {
  await assert.rejects(() => researchWeb({ query: "x", provider: "anthropic" }, {}), /provider/);
});

test("researchWeb: provider='google' ama GEMINI_API_KEY yoksa openai'a SESSİZCE geçmez, açık bir hata fırlatır", async () => {
  let openaiCalled = false;
  await assert.rejects(
    () => researchWeb({ query: "test", provider: "google" }, { OPENAI_API_KEY: "o" }, {
      fetchImpl: async (url) => { if (String(url).includes("openai")) openaiCalled = true; throw new Error("çağrılmamalıydı"); }
    }),
    /missing_api_key/
  );
  assert.equal(openaiCalled, false);
});

test("researchWeb: auto — hiçbir sağlayıcı yapılandırılmamışsa açık bir hata fırlatır", async () => {
  await assert.rejects(() => researchWeb({ query: "test" }, {}), /no_available_provider/);
});

test("researchWeb: provider='google' ile çalışır, kaynaklar normalize edilmiş döner", async () => {
  const data = { candidates: [{ content: { parts: [{ text: "Cevap." }] }, groundingMetadata: { groundingChunks: [{ web: { uri: "https://example.com/a", title: "A" } }] } }] };
  const result = await researchWeb({ query: "buzsu su arıtma", provider: "google" }, { GEMINI_API_KEY: "gkey" }, {
    fetchImpl: async () => ({ ok: true, json: async () => data })
  });
  assert.equal(result.provider, "google");
  assert.equal(result.query, "buzsu su arıtma");
  assert.equal(result.answer, "Cevap.");
  assert.deepEqual(result.sources, [{ url: "https://example.com/a", title: "A", snippet: "", provider: "google" }]);
});

test("researchWeb: provider='openai' başarısız olursa google'a OTOMATİK geçilmez, hata olduğu gibi yansır", async () => {
  let googleCalled = false;
  await assert.rejects(
    () => researchWeb({ query: "test", provider: "openai" }, { OPENAI_API_KEY: "okey", GEMINI_API_KEY: "gkey" }, {
      fetchImpl: async (url) => {
        if (String(url).includes("generativelanguage")) { googleCalled = true; throw new Error("google çağrılmamalıydı"); }
        return { ok: false, status: 500, json: async () => ({ error: { message: "internal error" } }) };
      }
    }),
    /internal error/
  );
  assert.equal(googleCalled, false);
});

test("researchWeb: urls en fazla 5 tanesi ile sınırlanır ve provider'a iletilir", async () => {
  let receivedUrls;
  const urls = Array.from({ length: 8 }, (_, i) => `https://example.com/${i}`);
  await researchWeb({ query: "test", provider: "google", urls }, { GEMINI_API_KEY: "gkey" }, {
    fetchImpl: async (url, options) => {
      receivedUrls = JSON.parse(options.body).contents[0].parts[0].text;
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: "x" }] } }] }) };
    }
  });
  const matched = urls.filter((u) => receivedUrls.includes(u));
  assert.equal(matched.length, 5);
});

test("researchWeb: hem answer hem sources boşsa açık bir hata fırlatır (sessizce boş sonuç dönmez)", async () => {
  await assert.rejects(
    () => researchWeb({ query: "test", provider: "openai" }, { OPENAI_API_KEY: "okey" }, {
      fetchImpl: async () => ({ ok: true, json: async () => ({ output_text: "", output: [] }) })
    }),
    /boş bir yanıt/
  );
});
