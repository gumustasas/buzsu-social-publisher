import test from "node:test";
import assert from "node:assert/strict";
import { listProducts } from "../src/lib/products.js";

const LLMS_FULL_SAMPLE = `
#### ⭐ Ana Ürün: UltraMag Manyetik Kireç Önleyici
**URL:** https://www.buzsu.com.tr/ultra-manyetik-kirec-onleyici/
Daire girişi 3/4 inç model.
`;

function mockFetch({ airtableRecords }) {
  return async (url) => {
    if (String(url).includes("api.airtable.com")) {
      return { ok: true, json: async () => ({ records: airtableRecords }) };
    }
    if (String(url).includes("llms-full.txt")) {
      return { ok: true, text: async () => LLMS_FULL_SAMPLE };
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
}

test("listProducts prefers the llms-full.txt catalog title over a stray/test Airtable draft title for the same product URL", async () => {
  const originalFetch = global.fetch;
  global.fetch = mockFetch({
    airtableRecords: [
      // En eski taslak kaydı test amaçlı bir başlık taşıyor — bu, ürünün
      // dropdown'da "DENEME" olarak görünmesine neden olan gerçek bug'dı.
      { id: "rec1", fields: { "Başlık": "DENEME | UltraMag Hikâye | 14:56", "Kaynak URL": "https://www.buzsu.com.tr/ultra-manyetik-kirec-onleyici/", "Görsel URL": "https://example.com/photo.png" } },
      { id: "rec2", fields: { "Başlık": "UltraMag Manyetik Kireç Önleyici | Hikâye 6", "Kaynak URL": "https://www.buzsu.com.tr/ultra-manyetik-kirec-onleyici/" } }
    ]
  });
  try {
    const products = await listProducts();
    const match = products.find((p) => p.url === "https://www.buzsu.com.tr/ultra-manyetik-kirec-onleyici/");
    assert.ok(match, "ürün listede bulunamadı");
    assert.equal(match.title, "UltraMag Manyetik Kireç Önleyici");
    assert.notEqual(match.title, "DENEME");
    // Görsel URL hâlâ ilk Airtable kaydından geliyor (katalog başlığı yalnızca ismi değiştirir).
    assert.equal(match.imageUrl, "https://example.com/photo.png");
  } finally {
    global.fetch = originalFetch;
  }
});

test("listProducts falls back to the Airtable draft title when the product has no known catalog entry", async () => {
  const originalFetch = global.fetch;
  global.fetch = mockFetch({
    airtableRecords: [
      { id: "rec1", fields: { "Başlık": "Code Su Arıtma Cihazı | Hikâye 1", "Kaynak URL": "https://www.buzsu.com.tr/code-su-aritma-cihazi/" } }
    ]
  });
  try {
    const products = await listProducts();
    const match = products.find((p) => p.url === "https://www.buzsu.com.tr/code-su-aritma-cihazi/");
    assert.equal(match.title, "Code Su Arıtma Cihazı");
  } finally {
    global.fetch = originalFetch;
  }
});
