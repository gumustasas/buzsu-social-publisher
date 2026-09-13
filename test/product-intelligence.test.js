import test from "node:test";
import assert from "node:assert/strict";
import { getBuzsuProductContext } from "../src/lib/product-intelligence.js";
import { catalogProductId } from "../src/lib/product-catalog.js";

const CANONICAL_URL = "https://www.buzsu.com.tr/code-su-aritma-cihazi/";
const NOW_ISO = "2026-09-13T12:00:00.000Z";
const NOW_MS = Date.parse(NOW_ISO);

function noopPut() { return Promise.resolve({ url: "https://blob.example.com/x" }); }
function emptyCacheList() { return Promise.resolve({ blobs: [] }); }

function baseDeps(overrides = {}) {
  return {
    listProductsImpl: async () => [],
    fetchProductContextImpl: async () => "",
    fetchImpl: async () => { throw new Error("fetch çağrılmamalıydı"); },
    putImpl: noopPut,
    listImpl: emptyCacheList,
    now: () => NOW_MS,
    ...overrides
  };
}

// --- Kimlik çözümleme + allowlist -----------------------------------------

test("productId veya productUrl verilmezse açık bir hata fırlatır", async () => {
  await assert.rejects(() => getBuzsuProductContext({}, baseDeps()), /productId veya productUrl gerekli/);
});

test("productUrl allowlist dışındaysa listProductsImpl HİÇ çağrılmadan reddeder", async () => {
  let called = false;
  const deps = baseDeps({ listProductsImpl: async () => { called = true; return []; } });
  await assert.rejects(
    () => getBuzsuProductContext({ productUrl: "https://evil-buzsu.com.tr/urun/" }, deps),
    /buzsu\.com\.tr/
  );
  assert.equal(called, false);
});

test("productUrl www'siz verilse de (buzsu.com.tr) canonicalize edilip kabul edilir", async () => {
  const deps = baseDeps({ listProductsImpl: async () => [] });
  const result = await getBuzsuProductContext({ productUrl: "https://buzsu.com.tr/code-su-aritma-cihazi/" }, deps);
  assert.equal(result.canonicalUrl, CANONICAL_URL);
});

test("productUrl bir katalog eşleşmesi bulursa productName/productImageUrls oradan gelir", async () => {
  const deps = baseDeps({
    listProductsImpl: async () => [{ id: "llms:x", title: "Code Su Arıtma Cihazı", url: CANONICAL_URL, imageUrl: "https://www.buzsu.com.tr/code.png", imageUrls: ["https://www.buzsu.com.tr/code.png"] }]
  });
  const result = await getBuzsuProductContext({ productUrl: CANONICAL_URL }, deps);
  assert.equal(result.productName, "Code Su Arıtma Cihazı");
  assert.deepEqual(result.productImageUrls, ["https://www.buzsu.com.tr/code.png"]);
});

test("productUrl katalogda bulunamazsa slug'dan türetilmiş bir başlığa düşer, hata vermez", async () => {
  const deps = baseDeps({ listProductsImpl: async () => [] });
  const result = await getBuzsuProductContext({ productUrl: "https://www.buzsu.com.tr/yeni-urun-sayfasi/" }, deps);
  assert.equal(result.productName, "Yeni Urun Sayfasi");
});

test("productId bulunamazsa 'Ürün bulunamadı' hatası verir", async () => {
  const deps = baseDeps({ listProductsImpl: async () => [] });
  await assert.rejects(() => getBuzsuProductContext({ productId: "rec-does-not-exist" }, deps), /Ürün bulunamadı/);
});

test("productId bulunsa da kayıtlı URL allowlist'ten geçemezse reddeder (productUrl ile AYNI güvenlik kontrolü)", async () => {
  const deps = baseDeps({ listProductsImpl: async () => [{ id: "rec1", title: "Şüpheli", url: "https://baska-site.com/urun/" }] });
  await assert.rejects(() => getBuzsuProductContext({ productId: "rec1" }, deps), /allowlist/);
});

test("hem productId hem productUrl verilirse productUrl önceliklidir", async () => {
  const deps = baseDeps({ listProductsImpl: async () => [{ id: "rec1", title: "Yanlış Ürün", url: "https://www.buzsu.com.tr/yanlis-urun/" }] });
  const result = await getBuzsuProductContext({ productId: "rec1", productUrl: CANONICAL_URL }, deps);
  assert.equal(result.canonicalUrl, CANONICAL_URL);
});

// --- verifiedFacts / kaynak ------------------------------------------------

test("verifiedFacts llms-full.txt grounding metninden BİREBİR cümle alıntısıdır, her biri LLMS_FULL_URL taşır; destekleyici sayfa fetch edilmez", async () => {
  let supportiveFetchCalled = false;
  const deps = baseDeps({
    listProductsImpl: async () => [],
    fetchProductContextImpl: async () => "Bu cihaz 3 kademeli filtre içerir. Mutfak tezgahı altına monte edilir.",
    fetchImpl: async () => { supportiveFetchCalled = true; throw new Error("çağrılmamalıydı"); }
  });
  const result = await getBuzsuProductContext({ productUrl: CANONICAL_URL }, deps);
  assert.equal(supportiveFetchCalled, false);
  assert.equal(result.verifiedFacts.length, 2);
  assert.equal(result.verifiedFacts[0].fact, "Bu cihaz 3 kademeli filtre içerir.");
  assert.equal(result.verifiedFacts[0].sourceUrl, "https://www.buzsu.com.tr/llms-full.txt");
  assert.equal(result.sourceUrls[0], "https://www.buzsu.com.tr/llms-full.txt");
});

test("llms-full.txt eşleşmesi yoksa destekleyici sayfadan meta description çekilir ve sourceUrl canonicalUrl olur", async () => {
  const html = `<html><head><meta name="description" content="Code su arıtma cihazı ailenize sağlıklı su sağlar. Kolay kurulum."></head></html>`;
  const deps = baseDeps({
    listProductsImpl: async () => [],
    fetchProductContextImpl: async () => "",
    fetchImpl: async () => ({ ok: true, status: 200, text: async () => html })
  });
  const result = await getBuzsuProductContext({ productUrl: CANONICAL_URL }, deps);
  assert.ok(result.verifiedFacts.length > 0);
  assert.equal(result.verifiedFacts[0].sourceUrl, CANONICAL_URL);
  assert.equal(result.sourceUrls[0], CANONICAL_URL);
  assert.ok(result.warnings.some((w) => w.includes("llms-full.txt")));
});

test("hem llms-full.txt hem destekleyici sayfa başarısız olursa verifiedFacts boş kalır ama tool FAIL OLMAZ", async () => {
  const deps = baseDeps({
    listProductsImpl: async () => [],
    fetchProductContextImpl: async () => "",
    fetchImpl: async () => { throw new Error("ağ hatası") }
  });
  const result = await getBuzsuProductContext({ productUrl: CANONICAL_URL }, deps);
  assert.deepEqual(result.verifiedFacts, []);
  assert.equal(result.description, "");
  assert.ok(result.warnings.some((w) => w.includes("llms-full.txt")));
  assert.ok(result.warnings.some((w) => w.includes("Destekleyici")));
});

// --- Yönlendirme (redirect) yeniden doğrulaması ---------------------------

test("destekleyici sayfa fetch'i buzsu.com.tr içindeki bir yönlendirmeyi takip eder", async () => {
  const html = `<html><head><meta name="description" content="Yönlendirilmiş sayfa açıklaması."></head></html>`;
  let calls = 0;
  const deps = baseDeps({
    listProductsImpl: async () => [],
    fetchProductContextImpl: async () => "",
    fetchImpl: async (url) => {
      calls++;
      if (calls === 1) return { status: 301, headers: { get: (h) => (h === "location" ? "/yeni-adres/" : null) } };
      assert.equal(url, "https://www.buzsu.com.tr/yeni-adres/");
      return { ok: true, status: 200, text: async () => html };
    }
  });
  const result = await getBuzsuProductContext({ productUrl: CANONICAL_URL }, deps);
  assert.equal(calls, 2);
  assert.ok(result.verifiedFacts[0].fact.includes("Yönlendirilmiş"));
});

test("yönlendirme buzsu.com.tr DIŞINA çıkarsa takip edilmez, hata warnings'e düşer (tool fail olmaz)", async () => {
  const deps = baseDeps({
    listProductsImpl: async () => [],
    fetchProductContextImpl: async () => "",
    fetchImpl: async () => ({ status: 302, headers: { get: (h) => (h === "location" ? "https://evil.com/phish/" : null) } })
  });
  const result = await getBuzsuProductContext({ productUrl: CANONICAL_URL }, deps);
  assert.deepEqual(result.verifiedFacts, []);
  assert.ok(result.warnings.some((w) => w.includes("buzsu.com.tr dışına")));
});

// --- prohibitedClaims / category ------------------------------------------

test("prohibitedClaims: kaynakta doğrulanan kategoriler listeden düşer, doğrulanmayanlar kalır", async () => {
  const deps = baseDeps({
    listProductsImpl: async () => [],
    fetchProductContextImpl: async () => "Bu ürün TSE sertifikalıdır. Modern mutfaklar için idealdir."
  });
  const result = await getBuzsuProductContext({ productUrl: CANONICAL_URL }, deps);
  const categories = result.prohibitedClaims.map((c) => c.category);
  assert.ok(!categories.includes("certification"));
  assert.ok(categories.includes("warranty"));
  assert.equal(result.prohibitedClaims.length, 4);
});

test("category: bağlam belirsizse boş bırakılır ve warnings'e not düşülür", async () => {
  const deps = baseDeps({ listProductsImpl: async () => [{ id: "rec1", title: "Genel Ürün", url: CANONICAL_URL }] });
  const result = await getBuzsuProductContext({ productId: "rec1" }, deps);
  assert.equal(result.category, "");
  assert.ok(result.warnings.some((w) => w.includes("kategori")));
});

test("category: bağlam net belirlenirse insan-okunur bir etiketle doldurulur", async () => {
  const deps = baseDeps({ listProductsImpl: async () => [{ id: "rec1", title: "Tezgah Altı Mutfak Su Arıtma Cihazı", url: CANONICAL_URL }] });
  const result = await getBuzsuProductContext({ productId: "rec1" }, deps);
  assert.ok(result.category.length > 0);
});

// --- Önbellek (cache) -------------------------------------------------------

test("taze bir cache kaydı varsa hiçbir içerik fetch'i yapılmadan doğrudan döner (fromCache:true)", async () => {
  const cachedRecord = {
    productId: "llms:x", productName: "Code", canonicalUrl: CANONICAL_URL, category: "", description: "eski",
    verifiedFacts: [], technicalFeatures: [], sellingPoints: [], useCases: [], targetAudience: [],
    productImageUrls: [], prohibitedClaims: [], sourceUrls: [], fetchedAt: NOW_ISO, contentHash: "abc"
  };
  let groundingCalled = false;
  const deps = baseDeps({
    listProductsImpl: async () => [],
    fetchProductContextImpl: async () => { groundingCalled = true; return ""; },
    listImpl: async ({ prefix }) => ({ blobs: [{ pathname: prefix, url: `https://blob.example.com/${prefix}` }] }),
    fetchImpl: async () => ({ ok: true, json: async () => cachedRecord })
  });
  const result = await getBuzsuProductContext({ productUrl: CANONICAL_URL }, deps);
  assert.equal(result.fromCache, true);
  assert.equal(result.description, "eski");
  assert.equal(groundingCalled, false);
});

test("cache eski (TTL aşılmış) ise yeniden üretilir", async () => {
  const staleFetchedAt = new Date(NOW_MS - 31 * 60 * 1000).toISOString(); // 31dk önce > 30dk TTL
  const cachedRecord = { productName: "Code", canonicalUrl: CANONICAL_URL, fetchedAt: staleFetchedAt, description: "eski" };
  let groundingCalled = false;
  const deps = baseDeps({
    listProductsImpl: async () => [],
    fetchProductContextImpl: async () => { groundingCalled = true; return "Taze içerik burada."; },
    listImpl: async ({ prefix }) => ({ blobs: [{ pathname: prefix, url: `https://blob.example.com/${prefix}` }] }),
    fetchImpl: async () => ({ ok: true, json: async () => cachedRecord })
  });
  const result = await getBuzsuProductContext({ productUrl: CANONICAL_URL }, deps);
  assert.equal(result.fromCache, false);
  assert.equal(groundingCalled, true);
});

test("refresh:true taze bir cache olsa bile önbelleği hiç okumadan yeniden üretir", async () => {
  let cacheReadCalled = false;
  const deps = baseDeps({
    listProductsImpl: async () => [],
    fetchProductContextImpl: async () => "Taze içerik.",
    listImpl: async () => { cacheReadCalled = true; return { blobs: [] }; }
  });
  const result = await getBuzsuProductContext({ productUrl: CANONICAL_URL, refresh: true }, deps);
  assert.equal(cacheReadCalled, false);
  assert.equal(result.fromCache, false);
});

test("bozuk (JSON parse edilemeyen) cache güvenli şekilde yok sayılır ve yeniden üretilir", async () => {
  const deps = baseDeps({
    listProductsImpl: async () => [],
    fetchProductContextImpl: async () => "Taze içerik.",
    listImpl: async ({ prefix }) => ({ blobs: [{ pathname: prefix, url: `https://blob.example.com/${prefix}` }] }),
    fetchImpl: async () => ({ ok: true, json: async () => { throw new SyntaxError("bozuk"); } })
  });
  const result = await getBuzsuProductContext({ productUrl: CANONICAL_URL }, deps);
  assert.equal(result.fromCache, false);
  assert.equal(result.description, "Taze içerik.");
});

test("cache yazımı başarısız olsa da tool FAIL OLMAZ — taze context döner, hata warnings'e eklenir", async () => {
  const deps = baseDeps({
    listProductsImpl: async () => [],
    fetchProductContextImpl: async () => "Taze içerik.",
    putImpl: async () => { throw new Error("BLOB_READ_WRITE_TOKEN tanımlı değil"); }
  });
  const result = await getBuzsuProductContext({ productUrl: CANONICAL_URL }, deps);
  assert.equal(result.fromCache, false);
  assert.equal(result.description, "Taze içerik.");
  assert.ok(result.warnings.some((w) => w.includes("Önbelleğe yazılamadı")));
});

// --- Normalize edilmiş alanlar ---------------------------------------------

test("productId verilmezse çıktıda katalog kuralına uygun sentetik bir productId üretilir", async () => {
  const deps = baseDeps({ listProductsImpl: async () => [] });
  const result = await getBuzsuProductContext({ productUrl: CANONICAL_URL }, deps);
  assert.equal(result.productId, catalogProductId(CANONICAL_URL));
});

test("productId verilirse çıktıda AYNEN korunur", async () => {
  const deps = baseDeps({ listProductsImpl: async () => [{ id: "rec1", title: "Code", url: CANONICAL_URL }] });
  const result = await getBuzsuProductContext({ productId: "rec1" }, deps);
  assert.equal(result.productId, "rec1");
});

test("technicalFeatures/sellingPoints/useCases/targetAudience: aynı birebir cümleler anahtar kelimeye göre sınıflandırılır, yeni metin üretilmez", async () => {
  const deps = baseDeps({
    listProductsImpl: async () => [],
    fetchProductContextImpl: async () => "3 kademeli filtre sistemi vardır. Kurulumu kolaydır. Mutfak ve ofis ortamları için idealdir. Aileler için uygundur."
  });
  const result = await getBuzsuProductContext({ productUrl: CANONICAL_URL }, deps);
  assert.ok(result.technicalFeatures.some((f) => f.fact.includes("kademeli")));
  assert.ok(result.sellingPoints.some((f) => f.fact.includes("kolaydır")));
  assert.ok(result.useCases.some((f) => f.fact.includes("idealdir")));
  assert.ok(result.targetAudience.some((f) => f.fact.includes("Aileler")));
  // Her kategori öğesi de verifiedFacts'teki AYNI birebir cümledir.
  const allFacts = result.verifiedFacts.map((f) => f.fact);
  assert.ok(result.technicalFeatures.every((f) => allFacts.includes(f.fact)));
});

test("fetchedAt ISO biçiminde now()'a göre üretilir, contentHash kaynak metne göre deterministiktir", async () => {
  const deps = baseDeps({ listProductsImpl: async () => [], fetchProductContextImpl: async () => "Sabit metin." });
  const result1 = await getBuzsuProductContext({ productUrl: CANONICAL_URL }, deps);
  const result2 = await getBuzsuProductContext({ productUrl: CANONICAL_URL }, deps);
  assert.equal(result1.fetchedAt, NOW_ISO);
  assert.equal(result1.contentHash, result2.contentHash);
  const deps2 = baseDeps({ listProductsImpl: async () => [], fetchProductContextImpl: async () => "Farklı metin." });
  const result3 = await getBuzsuProductContext({ productUrl: CANONICAL_URL }, deps2);
  assert.notEqual(result1.contentHash, result3.contentHash);
});

test("hiçbir ücretli AI/API çağrısı yapılmaz — inject edilen tüm fetch'ler yalnızca buzsu.com.tr/blob kaynaklıdır", async () => {
  // Bu test belgesel niteliğindedir: getBuzsuProductContext hiçbir yerde
  // OPENAI/GEMINI/ANTHROPIC anahtarı okumaz veya generateContent/responses
  // uç noktasına istek atmaz — yalnızca yukarıdaki testlerde enjekte edilen
  // fetchProductContextImpl/fetchImpl (buzsu.com.tr) ve putImpl/listImpl
  // (Vercel Blob) çağrılır.
  const deps = baseDeps({ listProductsImpl: async () => [], fetchProductContextImpl: async () => "Metin." });
  const result = await getBuzsuProductContext({ productUrl: CANONICAL_URL }, deps);
  assert.equal(result.ok, undefined); // handler seviyesinde eklenir, burada yok
  assert.ok(result.productName);
});
