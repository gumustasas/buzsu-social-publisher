import test from "node:test";
import assert from "node:assert/strict";
import { CLAIM_CATEGORIES, classifyProhibitedClaims } from "../src/lib/product-claims.js";

test("CLAIM_CATEGORIES is a fixed, small set of categories — not an open-ended list", () => {
  assert.equal(CLAIM_CATEGORIES.length, 5);
  assert.deepEqual(CLAIM_CATEGORIES.map((c) => c.id).sort(), ["certification", "health", "origin", "performance", "warranty"]);
});

test("classifyProhibitedClaims returns ALL categories as prohibited when the source text supports none of them", () => {
  const result = classifyProhibitedClaims("Bu ürün mutfakta kullanılır ve şıktır.");
  assert.equal(result.length, 5);
  for (const item of result) {
    assert.ok(item.category);
    assert.ok(item.label);
    assert.ok(item.reason.length > 0);
  }
});

test("classifyProhibitedClaims drops a category once the source text actually supports it", () => {
  const result = classifyProhibitedClaims("Bu ürün TSE sertifikalıdır ve 2 yıl garanti kapsamındadır.");
  const categories = result.map((item) => item.category);
  assert.ok(!categories.includes("certification"));
  assert.ok(!categories.includes("warranty"));
  // Diğer 3 kategori hâlâ kaynakta doğrulanamadığı için prohibitedClaims'te kalmalı.
  assert.ok(categories.includes("health"));
  assert.ok(categories.includes("performance"));
  assert.ok(categories.includes("origin"));
});

test("classifyProhibitedClaims: health category (reused from content-worker.js riskyClaims) matches superlative/health language", () => {
  const result = classifyProhibitedClaims("Bu ürün hastalığı tedavi eder ve en iyi cihazdır.");
  assert.ok(!result.map((item) => item.category).includes("health"));
});

// riskyClaims (ve bazı desenler) global (`g`) bayraklı regex — lastIndex
// sıfırlanmazsa ikinci çağrıda yanlışlıkla eşleşmeyebilir. Aynı desenle
// art arda iki çağrı doğru sonucu vermeli.
test("classifyProhibitedClaims gives the same result on repeated calls with the same global-flagged pattern (no lastIndex leakage)", () => {
  const text = "Bu ürün garanti kapsamındadır.";
  const first = classifyProhibitedClaims(text).map((item) => item.category);
  const second = classifyProhibitedClaims(text).map((item) => item.category);
  assert.deepEqual(first, second);
  assert.ok(!first.includes("warranty"));
});

test("classifyProhibitedClaims handles empty/undefined input without throwing", () => {
  assert.equal(classifyProhibitedClaims("").length, 5);
  assert.equal(classifyProhibitedClaims(undefined).length, 5);
});
