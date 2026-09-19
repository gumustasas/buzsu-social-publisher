import test from "node:test";
import assert from "node:assert/strict";
import { validateDeepResearchInput, MAX_COMPETITORS } from "../src/deep-research/validate.js";

test("validateDeepResearchInput: input bir nesne değilse reddedilir", () => {
  assert.throws(() => validateDeepResearchInput("not-an-object"), /nesne olmalı/);
  assert.throws(() => validateDeepResearchInput(null), /nesne olmalı/);
});

test("validateDeepResearchInput: bilinmeyen/desteklenmeyen bir mode reddedilir", () => {
  assert.throws(() => validateDeepResearchInput({ mode: "made_up_mode" }), /Desteklenmeyen veya bilinmeyen research mode/);
  assert.throws(() => validateDeepResearchInput({}), /Desteklenmeyen veya bilinmeyen research mode/);
});

test("validateDeepResearchInput: seo/competitor modunda objective eksikse reddedilir", () => {
  assert.throws(() => validateDeepResearchInput({ mode: "seo" }), /"objective" gerekli/);
  assert.throws(() => validateDeepResearchInput({ mode: "competitor", objective: "   " }), /"objective" gerekli/);
});

test("validateDeepResearchInput: weekly_content_opportunities modunda objective olmadan da kabul edilir", () => {
  const normalized = validateDeepResearchInput({ mode: "weekly_content_opportunities" });
  assert.equal(normalized.mode, "weekly_content_opportunities");
  assert.equal(normalized.objective, "");
});

test(`validateDeepResearchInput: competitors en fazla ${MAX_COMPETITORS} ile sınırlanır (bounded)`, () => {
  const competitors = Array.from({ length: MAX_COMPETITORS + 5 }, (_, i) => `Marka${i}`);
  const normalized = validateDeepResearchInput({ mode: "competitor", objective: "x", competitors });
  assert.equal(normalized.competitors.length, MAX_COMPETITORS);
});

test("validateDeepResearchInput: confirmed yalnızca tam olarak true ise true olarak normalize edilir", () => {
  assert.equal(validateDeepResearchInput({ mode: "seo", objective: "x", confirmed: true }).confirmed, true);
  assert.equal(validateDeepResearchInput({ mode: "seo", objective: "x", confirmed: "true" }).confirmed, false);
  assert.equal(validateDeepResearchInput({ mode: "seo", objective: "x" }).confirmed, false);
});

test("validateDeepResearchInput: geçerli bir girdi normalize edilmiş şekli döner", () => {
  const normalized = validateDeepResearchInput({ mode: "seo", objective: " x ", productId: "rec1", productKnowledgeQuery: "  soru  " });
  assert.equal(normalized.productId, "rec1");
  assert.equal(normalized.productKnowledgeQuery, "soru");
  assert.deepEqual(normalized.competitors, []);
  assert.deepEqual(normalized.urls, []);
});
