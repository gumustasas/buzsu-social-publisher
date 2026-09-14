import test from "node:test";
import assert from "node:assert/strict";
import { getBuzsuProductContext } from "../src/lib/product-intelligence.js";
import { catalogProductId } from "../src/lib/product-catalog.js";
import { FEED_URL } from "../src/lib/feed-catalog.js";

const CANONICAL_URL = "https://www.buzsu.com.tr/naturalsnet/";
const OTHER_URL = "https://www.buzsu.com.tr/dwp-817/";
const NOW_ISO = "2026-09-13T12:00:00.000Z";
const NOW_MS = Date.parse(NOW_ISO);

function noopPut() { return Promise.resolve({ url: "https://blob.example.com/x" }); }
function emptyCacheList() { return Promise.resolve({ blobs: [] }); }
function pageHtml(description = "", jsonLd = "") {
  return `<html><head><meta name="description" content="${description}">${jsonLd}</head></html>`;
}
function okPage(html = pageHtml()) {
  return { ok: true, status: 200, headers: { get: () => null }, text: async () => html };
}
function naturalsFeed(overrides = {}) {
  return {
    feedId: "nat-1",
    title: "Naturalsnet",
    url: CANONICAL_URL,
    description: "Naturalsnet tezgah altı kullanım için kompakt bir üründür.",
    productType: "Su Arıtma",
    brand: "Buzsu",
    imageUrl: "https://www.buzsu.com.tr/naturalsnet.png",
    imageUrls: ["https://www.buzsu.com.tr/naturalsnet.png"],
    ...overrides
  };
}
function baseDeps(overrides = {}) {
  return {
    listProductsImpl: async () => [],
    listFeedProductsImpl: async () => [],
    fetchImpl: async () => okPage(),
    putImpl: noopPut,
    listImpl: emptyCacheList,
    now: () => NOW_MS,
    ...overrides
  };
}

test("productId veya productUrl verilmezse açık hata verir", async () => {
  await assert.rejects(() => getBuzsuProductContext({}, baseDeps()), /productId veya productUrl gerekli/);
});

test("allowlist dışındaki productUrl katalog/feed/page çağrısından önce reddedilir", async () => {
  let called = false;
  const deps = baseDeps({ listProductsImpl: async () => { called = true; return []; } });
  await assert.rejects(() => getBuzsuProductContext({ productUrl: "https://evil.example/urun/" }, deps), /buzsu\.com\.tr/);
  assert.equal(called, false);
});

test("exact feed product canonical URL, ad ve yalnız kendi görsellerini sağlar", async () => {
  const selected = naturalsFeed();
  const other = { ...naturalsFeed({ feedId: "dwp", title: "DWP 817", url: OTHER_URL, imageUrl: "https://www.buzsu.com.tr/dwp.png", imageUrls: ["https://www.buzsu.com.tr/dwp.png"] }) };
  const result = await getBuzsuProductContext({ productUrl: CANONICAL_URL }, baseDeps({
    listProductsImpl: async () => [{ id: "rec-nat", title: "Naturalsnet", url: CANONICAL_URL }],
    listFeedProductsImpl: async () => [other, selected]
  }));
  assert.equal(result.canonicalUrl, CANONICAL_URL);
  assert.equal(result.productName, "Naturalsnet");
  assert.deepEqual(result.productImageUrls, ["https://www.buzsu.com.tr/naturalsnet.png"]);
  assert.ok(!result.productImageUrls.includes("https://www.buzsu.com.tr/dwp.png"));
});

test("Naturalsnet context komşu DWP 817 veya 50/80 litre feed metnini içermez", async () => {
  const result = await getBuzsuProductContext({ productUrl: CANONICAL_URL }, baseDeps({
    listFeedProductsImpl: async () => [
      naturalsFeed(),
      naturalsFeed({ feedId: "dwp", title: "DWP 817", url: OTHER_URL, description: "DWP 817, 50/80 litre kapasite sunar.", imageUrls: ["https://www.buzsu.com.tr/dwp.png"] })
    ],
    fetchImpl: async () => okPage(pageHtml("Naturalsnet modern mutfaklarda kullanılır."))
  }));
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /DWP 817/i);
  assert.doesNotMatch(serialized, /50\/80 litre/i);
  assert.match(serialized, /Naturalsnet/i);
});

test("verifiedFacts yalnız exact feed kaydı ve canonical sayfa cümlelerinden oluşur", async () => {
  const result = await getBuzsuProductContext({ productUrl: CANONICAL_URL }, baseDeps({
    listFeedProductsImpl: async () => [
      naturalsFeed({ description: "Naturalsnet 3 kademeli filtre içerir." }),
      naturalsFeed({ url: OTHER_URL, description: "Komşu ürün 500 GPD kapasitelidir." })
    ],
    fetchImpl: async (url) => {
      assert.equal(url, CANONICAL_URL);
      return okPage(pageHtml("Naturalsnet kurulumu kolaydır."));
    }
  }));
  assert.deepEqual(result.verifiedFacts, [
    { fact: "Naturalsnet 3 kademeli filtre içerir.", sourceUrl: FEED_URL },
    { fact: "Naturalsnet kurulumu kolaydır.", sourceUrl: CANONICAL_URL }
  ]);
  assert.doesNotMatch(JSON.stringify(result.verifiedFacts), /500 GPD/);
});

test("feed miss canonical product page ile kontrollü fallback yapar", async () => {
  const result = await getBuzsuProductContext({ productUrl: CANONICAL_URL }, baseDeps({
    listFeedProductsImpl: async () => [],
    fetchImpl: async () => okPage(pageHtml("Naturalsnet seçilen ürün sayfası açıklamasıdır."))
  }));
  assert.equal(result.verifiedFacts[0].sourceUrl, CANONICAL_URL);
  assert.match(result.description, /seçilen ürün sayfası/);
  assert.ok(result.warnings.some((warning) => warning.includes("birebir eşleşen")));
});

test("feed miss benzer başlıklı başka URL'yi fuzzy eşleşme olarak kabul etmez", async () => {
  const result = await getBuzsuProductContext({ productUrl: CANONICAL_URL }, baseDeps({
    listFeedProductsImpl: async () => [naturalsFeed({ title: "Naturalsnet Plus", url: OTHER_URL, description: "Yanlış fuzzy kayıt." })],
    fetchImpl: async () => okPage(pageHtml("Doğru canonical sayfa."))
  }));
  assert.doesNotMatch(JSON.stringify(result), /Yanlış fuzzy kayıt/);
  assert.match(result.description, /Doğru canonical sayfa/);
});

test("canonical sayfadaki JSON-LD yalnız exact Product URL eşleşince kullanılır", async () => {
  const jsonLd = `<script type="application/ld+json">${JSON.stringify({
    "@graph": [
      { "@type": "Product", url: OTHER_URL, description: "DWP 817 80 litre." },
      { "@type": "Product", url: CANONICAL_URL, description: "Naturalsnet exact JSON-LD açıklaması.", image: "https://www.buzsu.com.tr/jsonld-nat.png" }
    ]
  })}</script>`;
  const result = await getBuzsuProductContext({ productUrl: CANONICAL_URL }, baseDeps({
    fetchImpl: async () => okPage(pageHtml("", jsonLd))
  }));
  assert.match(result.description, /exact JSON-LD/);
  assert.doesNotMatch(JSON.stringify(result), /DWP 817|80 litre/);
  assert.deepEqual(result.productImageUrls, ["https://www.buzsu.com.tr/jsonld-nat.png"]);
});

test("canonical redirect yalnız buzsu.com.tr içinde takip edilir", async () => {
  let calls = 0;
  const result = await getBuzsuProductContext({ productUrl: CANONICAL_URL }, baseDeps({
    fetchImpl: async (url) => {
      calls++;
      if (calls === 1) return { status: 301, headers: { get: () => "/naturalsnet/" } };
      assert.equal(url, CANONICAL_URL);
      return okPage(pageHtml("Yönlendirilmiş exact sayfa."));
    }
  }));
  assert.equal(calls, 2);
  assert.match(result.description, /Yönlendirilmiş/);
});

test("canonical redirect allowlist dışına çıkarsa içerik kullanılmaz", async () => {
  const result = await getBuzsuProductContext({ productUrl: CANONICAL_URL }, baseDeps({
    fetchImpl: async () => ({ status: 302, headers: { get: () => "https://evil.example/phish" } })
  }));
  assert.deepEqual(result.verifiedFacts, []);
  assert.ok(result.warnings.some((warning) => warning.includes("buzsu.com.tr dışına")));
});

test("normalize alanlar exact source cümlelerinin aynı alıntılarını sınıflandırır", async () => {
  const result = await getBuzsuProductContext({ productUrl: CANONICAL_URL }, baseDeps({
    listFeedProductsImpl: async () => [naturalsFeed({ description: "3 kademeli filtre sistemi vardır. Kurulumu kolaydır. Mutfak ve ofis ortamları için idealdir. Aileler için uygundur." })]
  }));
  assert.ok(result.technicalFeatures.some((item) => item.fact.includes("kademeli")));
  assert.ok(result.sellingPoints.some((item) => item.fact.includes("kolaydır")));
  assert.ok(result.useCases.some((item) => item.fact.includes("idealdir")));
  assert.ok(result.targetAudience.some((item) => item.fact.includes("Aileler")));
  const allFacts = result.verifiedFacts.map((item) => item.fact);
  assert.ok(result.technicalFeatures.every((item) => allFacts.includes(item.fact)));
});

test("taze v2 cache içerik fetch'i yapmadan döner", async () => {
  const cached = {
    productId: "rec-nat", productName: "Naturalsnet", canonicalUrl: CANONICAL_URL,
    description: "v2 cached", verifiedFacts: [], technicalFeatures: [], sellingPoints: [],
    useCases: [], targetAudience: [], productImageUrls: [], prohibitedClaims: [],
    sourceUrls: [], fetchedAt: NOW_ISO, contentHash: "v2"
  };
  let feedCalled = false;
  let pageCalled = false;
  const result = await getBuzsuProductContext({ productUrl: CANONICAL_URL }, baseDeps({
    listFeedProductsImpl: async () => { feedCalled = true; return []; },
    listImpl: async ({ prefix }) => ({ blobs: [{ pathname: prefix, url: "https://blob.example/v2.json" }] }),
    fetchImpl: async (url) => {
      if (url.includes("blob.example")) return { ok: true, json: async () => cached };
      pageCalled = true;
      return okPage();
    }
  }));
  assert.equal(result.fromCache, true);
  assert.equal(result.description, "v2 cached");
  assert.equal(feedCalled, false);
  assert.equal(pageCalled, false);
});

test("stale cache exact kaynaklardan yeniden üretilir", async () => {
  const stale = { canonicalUrl: CANONICAL_URL, fetchedAt: new Date(NOW_MS - 31 * 60 * 1000).toISOString(), description: "old" };
  const result = await getBuzsuProductContext({ productUrl: CANONICAL_URL }, baseDeps({
    listImpl: async ({ prefix }) => ({ blobs: [{ pathname: prefix, url: "https://blob.example/stale.json" }] }),
    listFeedProductsImpl: async () => [naturalsFeed({ description: "Taze exact feed içeriği." })],
    fetchImpl: async (url) => url.includes("blob.example") ? { ok: true, json: async () => stale } : okPage()
  }));
  assert.equal(result.fromCache, false);
  assert.match(result.description, /Taze exact feed/);
});

test("contentHash exact source içeriğine göre deterministik ve değişkendir", async () => {
  const depsFor = (description) => baseDeps({ listFeedProductsImpl: async () => [naturalsFeed({ description })] });
  const first = await getBuzsuProductContext({ productUrl: CANONICAL_URL }, depsFor("Sabit exact içerik."));
  const again = await getBuzsuProductContext({ productUrl: CANONICAL_URL }, depsFor("Sabit exact içerik."));
  const changed = await getBuzsuProductContext({ productUrl: CANONICAL_URL }, depsFor("Farklı exact içerik."));
  assert.equal(first.fetchedAt, NOW_ISO);
  assert.equal(first.contentHash, again.contentHash);
  assert.notEqual(first.contentHash, changed.contentHash);
});

test("productId korunur; URL için katalog sentetik id kuralı değişmez", async () => {
  const byUrl = await getBuzsuProductContext({ productUrl: CANONICAL_URL }, baseDeps());
  assert.equal(byUrl.productId, catalogProductId(CANONICAL_URL));
  const byId = await getBuzsuProductContext({ productId: "rec-nat" }, baseDeps({
    listProductsImpl: async () => [{ id: "rec-nat", title: "Naturalsnet", url: CANONICAL_URL }]
  }));
  assert.equal(byId.productId, "rec-nat");
});

