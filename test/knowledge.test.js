import test from "node:test";
import assert from "node:assert/strict";
import { searchProductKnowledge, SOURCE_PRIORITY } from "../src/knowledge/index.js";

const product = { id: "rec1", title: "Code Advantage", url: "https://www.buzsu.com.tr/code-advantage/", imageUrls: ["https://img.example/code.png"], fromAirtable: true };
const context = {
  productId: "rec1",
  productName: "Code Advantage",
  canonicalUrl: product.url,
  category: "Tezgah altı",
  verifiedFacts: [{ fact: "Resmi bilgi.", sourceUrl: product.url }],
  technicalFeatures: [], sellingPoints: [], useCases: [], targetAudience: [],
  sourceUrls: [product.url]
};

test("source priority is explicit: Airtable > official Buzsu > file search", () => {
  assert.deepEqual(SOURCE_PRIORITY, ["airtable", "buzsu_official", "file_search"]);
});

test("search surfaces provider conflicts instead of silently resolving them", async () => {
  const result = await searchProductKnowledge(
    { productId: "rec1", query: "filtre sayısı nedir?", provider: "google", confirmed: true },
    { GEMINI_API_KEY: "g", GOOGLE_PRODUCT_KNOWLEDGE_STORE: "fileSearchStores/x" },
    {
      getBuzsuProductContextImpl: async () => context,
      listProductsImpl: async () => [product],
      runners: {
        google: async ({ authoritative }) => {
          assert.equal(authoritative.airtable.productName, "Code Advantage");
          assert.deepEqual(authoritative.buzsuOfficial.verifiedFacts, context.verifiedFacts);
          return {
            answer: "Resmi kaynağı esas alın.",
            retrievedFacts: [{ fact: "Eski belgede farklı bilgi.", source: "legacy.pdf" }],
            conflicts: [{ topic: "filtre", authoritativeFact: "Resmi bilgi.", retrievedFact: "Eski belgede farklı bilgi.", retrievedSource: "legacy.pdf" }],
            citations: [{ source: "legacy.pdf" }],
            model: "mock"
          };
        }
      }
    }
  );
  assert.equal(result.hasConflicts, true);
  assert.equal(result.conflicts.length, 1);
  assert.deepEqual(result.sourcePriority, ["airtable", "buzsu_official", "file_search"]);
});

test("explicit provider failure does not silently run another provider", async () => {
  let openaiCalled = false;
  await assert.rejects(() => searchProductKnowledge(
    { productId: "rec1", query: "x", provider: "google", confirmed: true },
    { OPENAI_API_KEY: "o", OPENAI_PRODUCT_KNOWLEDGE_VECTOR_STORE_ID: "vs_x" },
    { runners: { openai: async () => { openaiCalled = true; return {}; } } }
  ), /sessiz fallback/);
  assert.equal(openaiCalled, false);
});

test("confirmed:true gate occurs before product/network work", async () => {
  let called = false;
  await assert.rejects(() => searchProductKnowledge(
    { productId: "rec1", query: "x" },
    { GEMINI_API_KEY: "g", GOOGLE_PRODUCT_KNOWLEDGE_STORE: "fileSearchStores/x" },
    { getBuzsuProductContextImpl: async () => { called = true; return context; } }
  ), /confirmed:true/);
  assert.equal(called, false);
});


test("productId + productUrl farklı ürünleri gösterirse authority kaynakları karıştırılmaz", async () => {
  const other = { id: "rec2", title: "UltraMag", url: "https://www.buzsu.com.tr/ultra-manyetik-kirec-onleyici/", fromAirtable: true };
  let runnerCalled = false;
  await assert.rejects(() => searchProductKnowledge(
    { productId: "rec1", productUrl: other.url, query: "x", provider: "google", confirmed: true },
    { GEMINI_API_KEY: "g", GOOGLE_PRODUCT_KNOWLEDGE_STORE: "fileSearchStores/x" },
    {
      getBuzsuProductContextImpl: async () => ({ ...context, canonicalUrl: other.url, productName: "UltraMag" }),
      listProductsImpl: async () => [product, other],
      runners: { google: async () => { runnerCalled = true; return {}; } }
    }
  ), /farklı ürünleri işaret ediyor/);
  assert.equal(runnerCalled, false);
});
