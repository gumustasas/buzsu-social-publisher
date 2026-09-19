import test from "node:test";
import assert from "node:assert/strict";
import { validateDeepResearchInput, MAX_COMPETITORS, MAX_URLS } from "../src/deep-research/validate.js";

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

// ROOT review (PR #107): FAIL CLOSED, SESSİZCE KIRPMA YOK — sınırı aşan bir
// competitors/urls dizisi artık providers[0]/slice benzeri bir davranışla
// örtük kabul edilmez, açıkça reddedilir.
test(`validateDeepResearchInput: competitors ${MAX_COMPETITORS}'ten fazlaysa REDDEDİLİR (sessizce kırpılmaz)`, () => {
  const competitors = Array.from({ length: MAX_COMPETITORS + 1 }, (_, i) => `Marka${i}`);
  assert.throws(() => validateDeepResearchInput({ mode: "competitor", objective: "x", competitors }), /"competitors" en fazla 5 öğe içerebilir/);
});

test(`validateDeepResearchInput: tam olarak ${MAX_COMPETITORS} competitors kabul edilir, hiçbiri kaybolmaz`, () => {
  const competitors = Array.from({ length: MAX_COMPETITORS }, (_, i) => `Marka${i}`);
  const normalized = validateDeepResearchInput({ mode: "competitor", objective: "x", competitors });
  assert.deepEqual(normalized.competitors, competitors);
});

test("validateDeepResearchInput: competitors AÇIKÇA verilmiş ama dizi DEĞİLSE reddedilir (sessizce [] olarak yeniden yorumlanmaz)", () => {
  assert.throws(() => validateDeepResearchInput({ mode: "competitor", objective: "x", competitors: "MarkaX" }), /"competitors" bir dizi olmalı/);
  assert.throws(() => validateDeepResearchInput({ mode: "competitor", objective: "x", competitors: { 0: "MarkaX" } }), /"competitors" bir dizi olmalı/);
});

test("validateDeepResearchInput: competitors dizisinde string olmayan/boş bir öğe varsa reddedilir (malformed bir yapı sessizce geçerli bir isim gibi yorumlanmaz)", () => {
  assert.throws(() => validateDeepResearchInput({ mode: "competitor", objective: "x", competitors: ["MarkaX", { name: "MarkaY" }] }), /"competitors\[1\]" geçerli, boş olmayan bir metin/);
  assert.throws(() => validateDeepResearchInput({ mode: "competitor", objective: "x", competitors: ["MarkaX", 42] }), /"competitors\[1\]"/);
  assert.throws(() => validateDeepResearchInput({ mode: "competitor", objective: "x", competitors: ["MarkaX", "   "] }), /"competitors\[1\]"/);
});

test("validateDeepResearchInput: competitors verilmezse (omitted) sessizce [] olarak normalize edilir — bu bir REJECT DEĞİLDİR", () => {
  const normalized = validateDeepResearchInput({ mode: "seo", objective: "x" });
  assert.deepEqual(normalized.competitors, []);
});

test(`validateDeepResearchInput: urls ${MAX_URLS}'ten fazlaysa (research_web'in kendi sessiz kırpmasından ÖNCE) REDDEDİLİR`, () => {
  const urls = Array.from({ length: MAX_URLS + 1 }, (_, i) => `https://example.com/${i}`);
  assert.throws(() => validateDeepResearchInput({ mode: "seo", objective: "x", urls }), /"urls" en fazla 5 öğe içerebilir/);
});

test(`validateDeepResearchInput: tam olarak ${MAX_URLS} urls kabul edilir, hiçbiri kaybolmaz`, () => {
  const urls = Array.from({ length: MAX_URLS }, (_, i) => `https://example.com/${i}`);
  const normalized = validateDeepResearchInput({ mode: "seo", objective: "x", urls });
  assert.deepEqual(normalized.urls, urls);
});

test("validateDeepResearchInput: urls AÇIKÇA verilmiş ama dizi DEĞİLSE reddedilir", () => {
  assert.throws(() => validateDeepResearchInput({ mode: "seo", objective: "x", urls: "https://example.com" }), /"urls" bir dizi olmalı/);
});

test("validateDeepResearchInput: urls dizisinde string olmayan/boş bir öğe varsa reddedilir", () => {
  assert.throws(() => validateDeepResearchInput({ mode: "seo", objective: "x", urls: ["https://example.com", null] }), /"urls\[1\]"/);
});

test("validateDeepResearchInput: urls verilmezse (omitted) sessizce [] olarak normalize edilir — bu bir REJECT DEĞİLDİR", () => {
  const normalized = validateDeepResearchInput({ mode: "seo", objective: "x" });
  assert.deepEqual(normalized.urls, []);
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
