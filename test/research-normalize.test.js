import test from "node:test";
import assert from "node:assert/strict";
import { normalizeSources } from "../src/research/normalize.js";

test("normalizeSources: boş/eksik url'li kaynakları eler", () => {
  assert.deepEqual(normalizeSources([{ title: "no url" }, { url: "" }]), []);
});

test("normalizeSources: geçerli bir kaynağı {url,title,snippet,provider} şekline normalize eder", () => {
  const result = normalizeSources([{ url: "https://example.com/a", title: "A", snippet: "kısa özet", provider: "google" }]);
  assert.deepEqual(result, [{ url: "https://example.com/a", title: "A", snippet: "kısa özet", provider: "google" }]);
});

test("normalizeSources: title yoksa url'i title olarak kullanır (uydurma başlık ÜRETMEZ)", () => {
  const result = normalizeSources([{ url: "https://example.com/a", provider: "openai" }]);
  assert.equal(result[0].title, "https://example.com/a");
  assert.equal(result[0].snippet, "");
});

test("normalizeSources: aynı url iki kaynaktan gelse bile TEK kayıt bırakır (dedup), ilk görüleni tutar", () => {
  const result = normalizeSources([
    { url: "https://example.com/a", title: "İlk", provider: "google" },
    { url: "https://example.com/a", title: "İkinci", provider: "google" }
  ]);
  assert.equal(result.length, 1);
  assert.equal(result[0].title, "İlk");
});

test("normalizeSources: dizi olmayan girişte hata fırlatmadan boş dizi döner", () => {
  assert.deepEqual(normalizeSources(undefined), []);
  assert.deepEqual(normalizeSources(null), []);
});

test("normalizeSources: en fazla 20 kaynak tutar", () => {
  const many = Array.from({ length: 30 }, (_, i) => ({ url: `https://example.com/${i}`, provider: "google" }));
  assert.equal(normalizeSources(many).length, 20);
});
