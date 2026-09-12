import test from "node:test";
import assert from "node:assert/strict";
import { listProducts, createDraftRecord } from "../src/lib/products.js";

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

test("listProducts only surfaces instagramText/facebookText from a record whose Durum is Onaylandı or Paylaşıldı, never from a Taslak/Hata record", async () => {
  const originalFetch = global.fetch;
  global.fetch = mockFetch({
    airtableRecords: [
      // İlk kayıt (sıralamada önce gelen) hiç incelenmemiş bir Taslak —
      // metni asla yeniden kullanılabilir katalog metni olarak görünmemeli.
      { id: "rec1", fields: { "Başlık": "Code deneme 1", "Kaynak URL": "https://www.buzsu.com.tr/code-su-aritma-cihazi/", "Instagram Metni": "Reddedilen/incelenmemiş metin", "Facebook Metni": "Reddedilen/incelenmemiş metin", Durum: "Taslak" } },
      { id: "rec2", fields: { "Başlık": "Code deneme 2", "Kaynak URL": "https://www.buzsu.com.tr/code-su-aritma-cihazi/", "Instagram Metni": "Onaylanmış gerçek metin", "Facebook Metni": "Onaylanmış gerçek metin", Durum: "Onaylandı" } }
    ]
  });
  try {
    const products = await listProducts();
    const match = products.find((p) => p.url === "https://www.buzsu.com.tr/code-su-aritma-cihazi/");
    assert.equal(match.instagramText, "Onaylanmış gerçek metin");
    assert.equal(match.facebookText, "Onaylanmış gerçek metin");
  } finally {
    global.fetch = originalFetch;
  }
});

test("listProducts leaves instagramText/facebookText empty when every record for a product is still a Taslak/Hata (nothing approved/published yet)", async () => {
  const originalFetch = global.fetch;
  global.fetch = mockFetch({
    airtableRecords: [
      { id: "rec1", fields: { "Başlık": "Code deneme", "Kaynak URL": "https://www.buzsu.com.tr/code-su-aritma-cihazi/", "Instagram Metni": "İncelenmemiş metin", "Facebook Metni": "İncelenmemiş metin", Durum: "Taslak" } }
    ]
  });
  try {
    const products = await listProducts();
    const match = products.find((p) => p.url === "https://www.buzsu.com.tr/code-su-aritma-cihazi/");
    assert.equal(match.instagramText, "");
    assert.equal(match.facebookText, "");
  } finally {
    global.fetch = originalFetch;
  }
});

test("listProducts marks Airtable-sourced products as fromAirtable:true and catalog-only products as fromAirtable:false", async () => {
  const originalFetch = global.fetch;
  global.fetch = mockFetch({
    airtableRecords: [
      { id: "rec1", fields: { "Başlık": "Code deneme", "Kaynak URL": "https://www.buzsu.com.tr/code-su-aritma-cihazi/" } }
    ]
  });
  try {
    const products = await listProducts();
    const airtableProduct = products.find((p) => p.url === "https://www.buzsu.com.tr/code-su-aritma-cihazi/");
    const catalogOnlyProduct = products.find((p) => p.url === "https://www.buzsu.com.tr/ultra-manyetik-kirec-onleyici/");
    assert.equal(airtableProduct.fromAirtable, true);
    assert.equal(catalogOnlyProduct.fromAirtable, false);
  } finally {
    global.fetch = originalFetch;
  }
});

test("createDraftRecord writes an existing single-image draft exactly as before (no Media Items field, no behavior change)", async () => {
  const originalFetch = global.fetch;
  let capturedBody;
  global.fetch = async (url, options) => {
    capturedBody = JSON.parse(options.body);
    return { ok: true, json: async () => ({ id: "recNEW1", fields: capturedBody.fields }) };
  };
  try {
    const product = { url: "https://www.buzsu.com.tr/code-su-aritma-cihazi/", imageUrl: "https://example.com/code.png" };
    const draft = { title: "Code | Gönderi", instagramText: "ig", facebookText: "fb", hashtags: "#Buzsu" };
    await createDraftRecord({ product, draft, format: "Gönderi", platforms: ["Instagram"], publishAt: "2026-08-20T10:00:00.000Z", note: "test" });
    assert.equal(capturedBody.typecast, true);
    assert.equal(capturedBody.fields["Görsel URL"], "https://example.com/code.png");
    assert.equal(capturedBody.fields["Yayın Biçimi"], "Gönderi");
    assert.ok(!("Media Items" in capturedBody.fields), "tekil görsel taslağında Media Items alanı hiç yazılmamalı");
  } finally {
    global.fetch = originalFetch;
  }
});

test("createDraftRecord writes mediaItems as a JSON string in the Media Items field for a Carousel draft", async () => {
  const originalFetch = global.fetch;
  let capturedBody;
  global.fetch = async (url, options) => {
    capturedBody = JSON.parse(options.body);
    return { ok: true, json: async () => ({ id: "recNEW2", fields: capturedBody.fields }) };
  };
  try {
    const mediaItems = [
      { type: "image", url: "https://blob.vercel-storage.com/img1.jpg" },
      { type: "image", url: "https://blob.vercel-storage.com/img2.jpg" },
      { type: "video", url: "https://blob.vercel-storage.com/video.mp4" }
    ];
    const product = { url: "https://www.buzsu.com.tr/code-su-aritma-cihazi/", mediaItems };
    const draft = { title: "Code | Carousel", instagramText: "ig", facebookText: "fb", hashtags: "#Buzsu" };
    await createDraftRecord({ product, draft, format: "Carousel", platforms: ["Instagram"], publishAt: "2026-08-20T10:00:00.000Z", note: "test" });
    assert.equal(capturedBody.fields["Yayın Biçimi"], "Carousel");
    assert.equal(capturedBody.fields["Media Items"], JSON.stringify(mediaItems));
    // Panel önizlemesi için ilk görsel öğeden türetilmiş bir "Görsel URL" olmalı.
    assert.equal(capturedBody.fields["Görsel URL"], "https://blob.vercel-storage.com/img1.jpg");
  } finally {
    global.fetch = originalFetch;
  }
});
