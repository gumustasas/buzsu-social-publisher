import test from "node:test";
import assert from "node:assert/strict";
import { runDeepResearch, DEEP_RESEARCH_ALLOWED_CAPABILITIES } from "../src/deep-research/index.js";

function fakeResearchWeb(overrides = {}) {
  return async (args) => ({
    provider: "google",
    query: args.query,
    urls: args.urls || [],
    answer: "Araştırma cevabı.",
    sources: [{ url: "https://example.com/a", title: "A", snippet: "", provider: "google" }],
    searchQueries: [],
    ...overrides
  });
}

test("DEEP_RESEARCH_ALLOWED_CAPABILITIES yalnız salt-okunur/araştırma capability'lerini içerir — publish/update/delete/upload/autopilot AYRIK tutulur", () => {
  assert.deepEqual(DEEP_RESEARCH_ALLOWED_CAPABILITIES, ["research_web", "search_product_knowledge", "get_buzsu_product_context"]);
  for (const forbidden of ["publish_now", "create_draft", "update_draft", "update_status", "set_autopilot", "upload_media", "delete_draft"]) {
    assert.ok(!DEEP_RESEARCH_ALLOWED_CAPABILITIES.includes(forbidden));
  }
});

test("runDeepResearch: geçerli bir SEO akışı — research_web'i çağırır, normalize edilmiş kaynakları ve boş uncertainty/conflicts döner", async () => {
  let seenQuery;
  const twoSources = [
    { url: "https://example.com/a", title: "A", snippet: "", provider: "google" },
    { url: "https://example.com/b", title: "B", snippet: "", provider: "google" }
  ];
  const result = await runDeepResearch(
    { mode: "seo", objective: "kireç önleyici anahtar kelimeleri", confirmed: true },
    {},
    { researchWebImpl: async (args) => { seenQuery = args.query; return fakeResearchWeb({ sources: twoSources })(args); } }
  );
  assert.match(seenQuery, /SEO/);
  assert.equal(result.query_or_objective, "kireç önleyici anahtar kelimeleri");
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].capability, "research_web");
  assert.deepEqual(result.sources, twoSources.map((s) => ({ ...s, capability: "research_web" })));
  assert.deepEqual(result.uncertainty, []);
  assert.deepEqual(result.conflicts, []);
  assert.deepEqual(result.providers_or_capabilities_used, ["research_web:google"]);
});

test("runDeepResearch: geçerli bir competitor akışı — rakip listesi sorguya yansır", async () => {
  let seenQuery;
  const result = await runDeepResearch(
    { mode: "competitor", objective: "fiyat karşılaştırması", competitors: ["MarkaX", "MarkaY"], confirmed: true },
    {},
    { researchWebImpl: async (args) => { seenQuery = args.query; return fakeResearchWeb()(args); } }
  );
  assert.match(seenQuery, /MarkaX/);
  assert.match(seenQuery, /MarkaY/);
  assert.equal(result.query_or_objective, "fiyat karşılaştırması");
});

test("runDeepResearch: geçerli bir weekly_content_opportunities akışı — objective verilmeden de çalışır", async () => {
  const result = await runDeepResearch(
    { mode: "weekly_content_opportunities", confirmed: true },
    {},
    { researchWebImpl: fakeResearchWeb() }
  );
  assert.equal(result.findings.length, 1);
  assert.match(result.query_or_objective, /Buzsu/);
});

test("runDeepResearch: desteklenmeyen/bilinmeyen bir mode hiçbir ağ çağrısı yapılmadan reddedilir", async () => {
  let called = false;
  await assert.rejects(
    () => runDeepResearch({ mode: "made_up_mode", confirmed: true }, {}, { researchWebImpl: async () => { called = true; return {}; } }),
    /Desteklenmeyen veya bilinmeyen research mode/
  );
  assert.equal(called, false);
});

test("runDeepResearch: malformed girdi (seo modunda objective eksik) hiçbir ağ çağrısı yapılmadan reddedilir", async () => {
  let called = false;
  await assert.rejects(
    () => runDeepResearch({ mode: "seo", confirmed: true }, {}, { researchWebImpl: async () => { called = true; return {}; } }),
    /"objective" gerekli/
  );
  assert.equal(called, false);
});

test("runDeepResearch: confirmed:true olmadan (ÜCRETSİZ get_buzsu_product_context dahil) HİÇBİR çağrı yapılmaz — onay hiçbir zaman kendiliğinden üretilmez", async () => {
  let researchCalled = false;
  let contextCalled = false;
  await assert.rejects(
    () => runDeepResearch(
      { mode: "seo", objective: "x", productId: "rec1" },
      {},
      {
        researchWebImpl: async () => { researchCalled = true; return {}; },
        getBuzsuProductContextImpl: async () => { contextCalled = true; return {}; }
      }
    ),
    /confirmed:true/
  );
  assert.equal(researchCalled, false);
  assert.equal(contextCalled, false);
});

test("runDeepResearch: research_web'in KENDİ 'sessiz fallback yok' hatası olduğu gibi yansır — deep-research kendi başka bir provider'a GEÇMEZ", async () => {
  await assert.rejects(
    () => runDeepResearch(
      { mode: "seo", objective: "x", provider: "openai", confirmed: true },
      {},
      { researchWebImpl: async () => { throw new Error('Research provider "openai" için API key yapılandırılmamış (missing_key). Başka bir ücretli sağlayıcıya sessizce geçilmez.'); } }
    ),
    /sessizce geçilmez/
  );
});

test("runDeepResearch: provider/tool hatası (dependency failure) olduğu gibi (redaksiyon dışında) yansır", async () => {
  await assert.rejects(
    () => runDeepResearch(
      { mode: "seo", objective: "x", confirmed: true },
      {},
      { researchWebImpl: async () => { throw new Error("upstream quota exceeded"); } }
    ),
    /upstream quota exceeded/
  );
});

test("runDeepResearch: research_web hiç kaynak döndürmezse uncertainty'de açıkça raporlanır", async () => {
  const result = await runDeepResearch(
    { mode: "seo", objective: "x", confirmed: true },
    {},
    { researchWebImpl: fakeResearchWeb({ sources: [] }) }
  );
  assert.equal(result.uncertainty.length, 1);
  assert.match(result.uncertainty[0], /hiçbir kaynak döndürmedi/);
});

test("runDeepResearch: research_web tam olarak 1 kaynak döndürürse bu da uncertainty'de raporlanır", async () => {
  const result = await runDeepResearch(
    { mode: "seo", objective: "x", confirmed: true },
    {},
    { researchWebImpl: fakeResearchWeb() }
  );
  assert.equal(result.uncertainty.length, 1);
  assert.match(result.uncertainty[0], /yalnızca 1 kaynağa/);
});

test("runDeepResearch: 2+ kaynak varsa ve productKnowledgeQuery kullanılmıyorsa uncertainty boştur", async () => {
  const result = await runDeepResearch(
    { mode: "seo", objective: "x", confirmed: true },
    {},
    { researchWebImpl: fakeResearchWeb({ sources: [{ url: "https://a.com", title: "A", snippet: "", provider: "google" }, { url: "https://b.com", title: "B", snippet: "", provider: "google" }] }) }
  );
  assert.deepEqual(result.uncertainty, []);
});

test("runDeepResearch: productId + productKnowledgeQuery verilirse get_buzsu_product_context VE search_product_knowledge'ı çağırır, TASK-006'nın kendi çelişki tespitini OLDUĞU GİBİ yüzeye çıkarır", async () => {
  const result = await runDeepResearch(
    { mode: "seo", objective: "x", productId: "rec1", productKnowledgeQuery: "kurulum talimatı nedir", confirmed: true },
    {},
    {
      researchWebImpl: fakeResearchWeb(),
      getBuzsuProductContextImpl: async () => ({ productName: "Buzsu Ultramag", sellingPoints: ["manyetik kireç önleyici"] }),
      searchProductKnowledgeImpl: async () => ({
        provider: "openai",
        query: "kurulum talimatı nedir",
        answer: "Kurulum X şekildedir.",
        citations: [{ url: "https://buzsu.com.tr/urun", title: "Ürün sayfası" }],
        conflicts: [{ field: "kurulum", airtable: "A", document: "B" }],
        hasConflicts: true
      })
    }
  );
  assert.deepEqual(result.providers_or_capabilities_used, ["get_buzsu_product_context", "research_web:google", "search_product_knowledge:openai"]);
  assert.equal(result.findings.length, 2);
  assert.deepEqual(result.conflicts, [{ field: "kurulum", airtable: "A", document: "B" }]);
  assert.ok(result.uncertainty.some((note) => /çelişki/.test(note)));
  assert.ok(result.sources.some((s) => s.capability === "search_product_knowledge" && s.url === "https://buzsu.com.tr/urun"));
});

test("runDeepResearch: productKnowledgeQuery verilse de productId/productUrl YOKSA search_product_knowledge HİÇ çağrılmaz (o capability productId/productUrl zorunlu kılar)", async () => {
  let knowledgeCalled = false;
  const result = await runDeepResearch(
    { mode: "seo", objective: "x", productKnowledgeQuery: "soru", confirmed: true },
    {},
    { researchWebImpl: fakeResearchWeb(), searchProductKnowledgeImpl: async () => { knowledgeCalled = true; return {}; } }
  );
  assert.equal(knowledgeCalled, false);
  assert.deepEqual(result.providers_or_capabilities_used, ["research_web:google"]);
});

test("runDeepResearch: hata mesajında ham bir secret env değeri varsa [REDACTED] ile değiştirilir, asla olduğu gibi sızmaz", async () => {
  const secretValue = "sk-supersecrettestvalue987654";
  await assert.rejects(
    () => runDeepResearch(
      { mode: "seo", objective: "x", confirmed: true },
      { GEMINI_API_KEY: secretValue },
      { researchWebImpl: async () => { throw new Error(`HTTP 401: key=${secretValue} geçersiz`); } }
    ),
    (err) => {
      assert.doesNotMatch(err.message, new RegExp(secretValue));
      assert.match(err.message, /\[REDACTED\]/);
      return true;
    }
  );
});
