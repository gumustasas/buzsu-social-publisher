import test from "node:test";
import assert from "node:assert/strict";
import { findKnownProductPhoto } from "../src/lib/product-photos.js";

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
