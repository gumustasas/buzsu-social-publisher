import test from "node:test";
import assert from "node:assert/strict";
import { catalogProductId, isCatalogProductId, findCatalogProduct } from "../src/lib/product-catalog.js";

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

test("findCatalogProduct fills imageUrl from the verified product-photos map even when the live catalog fetch fails", async () => {
  const url = "https://www.buzsu.com.tr/manyetik-kombi-filtresi/";
  const product = await findCatalogProduct(catalogProductId(url));
  assert.equal(product.imageUrl, "https://www.buzsu.com.tr/upload/small/rivermag-1-inc-manyetik-kombi-filtresi-endustriyel-kombi-filtresi-buzsu.jpg");
});

test("findCatalogProduct leaves imageUrl empty for a product with no verified photo", async () => {
  const url = "https://www.buzsu.com.tr/hic-boyle-bir-urun-yok/";
  const product = await findCatalogProduct(catalogProductId(url));
  assert.equal(product.imageUrl, "");
});
