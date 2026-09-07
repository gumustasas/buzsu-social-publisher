import test from "node:test";
import assert from "node:assert/strict";
import { findKnownProductPhoto, findKnownProductPhotos } from "../src/lib/product-photos.js";

test("findKnownProductPhoto returns the verified photo for a known product URL", () => {
  const url = findKnownProductPhoto("https://www.buzsu.com.tr/manyetik-kombi-filtresi/");
  assert.equal(url, "https://www.buzsu.com.tr/upload/small/rivermag-1-inc-manyetik-kombi-filtresi-endustriyel-kombi-filtresi-buzsu.jpg");
});

test("findKnownProductPhoto normalizes a missing trailing slash", () => {
  const url = findKnownProductPhoto("https://www.buzsu.com.tr/manyetik-kombi-filtresi");
  assert.equal(url, "https://www.buzsu.com.tr/upload/small/rivermag-1-inc-manyetik-kombi-filtresi-endustriyel-kombi-filtresi-buzsu.jpg");
});

test("findKnownProductPhoto returns empty string for an unknown product URL", () => {
  assert.equal(findKnownProductPhoto("https://www.buzsu.com.tr/hic-boyle-bir-urun-yok/"), "");
});

test("findKnownProductPhotos returns the full reference gallery for a filter + Ultramag set", () => {
  const urls = findKnownProductPhotos("https://www.buzsu.com.tr/silifozlu-ev-ana-giris-su-aritma-sistemi");
  assert.ok(urls.length >= 3);
  assert.ok(urls.some((url) => url.includes("ultramag")));
  assert.ok(urls.some((url) => url.includes("3-lu")));
});
