import test from "node:test";
import assert from "node:assert/strict";
import { catalogProductId, isCatalogProductId, findCatalogProduct } from "../src/lib/product-catalog.js";
import { findKnownProductPhoto } from "../src/lib/product-photos.js";

test("catalogProductId encodes the product URL into a synthetic id distinguishable from Airtable record ids", () => {
  const id = catalogProductId("https://www.buzsu.com.tr/ultramag/");
  assert.match(id, /^llms:/);
  assert.equal(isCatalogProductId(id), true);
  assert.equal(isCatalogProductId("recABC123"), false);
  assert.equal(isCatalogProductId(""), false);
  assert.equal(isCatalogProductId(undefined), false);
});

test("findCatalogProduct returns null for a non-catalog id", async () => {
  assert.equal(await findCatalogProduct("recABC123"), null);
});

test("findCatalogProduct falls back to a slug-derived title when the catalog can't be fetched (e.g. network blocked)", async () => {
  const url = "https://www.buzsu.com.tr/ultramag-apartman-tipi/";
  const product = await findCatalogProduct(catalogProductId(url));
  assert.equal(product.url, url);
  assert.equal(product.title, "Ultramag Apartman Tipi");
});

// Bu değer test/product-catalog.test.js'i çalıştıran ortamın ağ erişimine
// göre değişebilir: bu ortamda (ör. bu geliştirme kutusu) buzsu.com.tr'ye
// erişim engelliyken, CI runner'ında gerçek erişim var — o zaman canlı
// feed.xml'de bu ürün bulunursa (product-photos.js'teki elle tutulan
// listeden daha güncel bir görselle) feed kazanır, bu bilinçli ve istenen
// bir davranış (bkz. src/lib/product-catalog.js fetchCatalog()). Bu yüzden
// burada kaynağın hangisi olduğuna değil, sadece gerçek bir https görsel
// döndüğüne bakıyoruz; product-photos.js'teki sabit eşlemenin kendisi ayrı,
// ağdan bağımsız bir testte (aşağıda) doğrulanıyor.
test("findCatalogProduct returns a real image URL for a product that has a known photo (from feed.xml when reachable, otherwise the product-photos.js fallback)", async () => {
  const url = "https://www.buzsu.com.tr/manyetik-kombi-filtresi/";
  const product = await findCatalogProduct(catalogProductId(url));
  assert.match(product.imageUrl, /^https:\/\/www\.buzsu\.com\.tr\//);
});

test("product-photos.js keeps a stable fallback entry for manyetik-kombi-filtresi (network-independent regression check)", () => {
  assert.equal(
    findKnownProductPhoto("https://www.buzsu.com.tr/manyetik-kombi-filtresi/"),
    "https://www.buzsu.com.tr/upload/small/rivermag-1-inc-manyetik-kombi-filtresi-endustriyel-kombi-filtresi-buzsu.jpg"
  );
});

test("findCatalogProduct leaves imageUrl empty for a product with no verified photo", async () => {
  const url = "https://www.buzsu.com.tr/hic-boyle-bir-urun-yok/";
  const product = await findCatalogProduct(catalogProductId(url));
  assert.equal(product.imageUrl, "");
});
