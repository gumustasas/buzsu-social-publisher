import test from "node:test";
import assert from "node:assert/strict";
import { resolveProductUrl, slugFromUrl } from "../src/lib/buzsu-url.js";

test("resolveProductUrl accepts www.buzsu.com.tr and normalizes to a trailing-slash absolute URL", () => {
  assert.equal(resolveProductUrl("https://www.buzsu.com.tr/code-su-aritma-cihazi"), "https://www.buzsu.com.tr/code-su-aritma-cihazi/");
  assert.equal(resolveProductUrl("https://www.buzsu.com.tr/code-su-aritma-cihazi/"), "https://www.buzsu.com.tr/code-su-aritma-cihazi/");
});

test("resolveProductUrl accepts a bare relative path and resolves it against the site origin", () => {
  assert.equal(resolveProductUrl("/code-su-aritma-cihazi"), "https://www.buzsu.com.tr/code-su-aritma-cihazi/");
  assert.equal(resolveProductUrl("code-su-aritma-cihazi"), "https://www.buzsu.com.tr/code-su-aritma-cihazi/");
});

// get_buzsu_product_context (bkz. product-intelligence.js) için eklenen
// KONTROLLÜ canonicalizasyon: www'siz "buzsu.com.tr" de kabul edilir ama
// HER ZAMAN www.buzsu.com.tr'ye normalize edilir — başka hiçbir host'a
// genişletme YOKTUR (aşağıdaki reddetme testleri bunu doğrular).
test("resolveProductUrl accepts bare buzsu.com.tr (no www) and canonicalizes it to www.buzsu.com.tr", () => {
  assert.equal(resolveProductUrl("https://buzsu.com.tr/code-su-aritma-cihazi/"), "https://www.buzsu.com.tr/code-su-aritma-cihazi/");
  assert.equal(resolveProductUrl("http://buzsu.com.tr/code-su-aritma-cihazi/"), "https://www.buzsu.com.tr/code-su-aritma-cihazi/");
});

test("resolveProductUrl rejects every other host, including look-alikes and subdomains", () => {
  assert.equal(resolveProductUrl("https://buzsu.com/code/"), null);
  assert.equal(resolveProductUrl("https://evil-buzsu.com.tr/code/"), null);
  assert.equal(resolveProductUrl("https://www.buzsu.com.tr.evil.com/code/"), null);
  assert.equal(resolveProductUrl("https://cdn.buzsu.com.tr/code/"), null);
  assert.equal(resolveProductUrl("https://www.buzsu.com/code/"), null);
});

test("resolveProductUrl returns null for empty input instead of throwing", () => {
  assert.equal(resolveProductUrl(""), null);
  assert.equal(resolveProductUrl(null), null);
  assert.equal(resolveProductUrl(undefined), null);
});

test("resolveProductUrl strips query strings and hash fragments (canonical identity is path-only)", () => {
  assert.equal(resolveProductUrl("https://www.buzsu.com.tr/code-su-aritma-cihazi/?ref=instagram#top"), "https://www.buzsu.com.tr/code-su-aritma-cihazi/");
});

test("slugFromUrl extracts the last path segment for a canonicalized URL", () => {
  assert.equal(slugFromUrl(resolveProductUrl("https://buzsu.com.tr/code-su-aritma-cihazi")), "code-su-aritma-cihazi");
});
