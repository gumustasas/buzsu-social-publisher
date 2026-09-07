import test from "node:test";
import assert from "node:assert/strict";
import { classifyInstallationContext, detectsContextConflict, INSTALLATION_CONTEXTS, FORBIDDEN_ELEMENTS_BY_CONTEXT } from "../src/lib/product-installation-context.js";

// Gerçek hata raporu: "Daire Girişi Manyetik Kireç Önleyici" gibi bina
// girişi/ana hat ürünleri iç mekân (çamaşır odası) sahnesinde, yanlış boru
// bağlamıyla gösterildi. Bu test, sınıflandırıcının böyle bir ürünü doğru
// (technical_installation) bağlama koyduğunu doğrular.
test("classifyInstallationContext identifies a building-entry/main-line product as technical_installation", () => {
  const result = classifyInstallationContext({ title: "Daire Girişi Manyetik Kireç Önleyici Set" }, "");
  assert.equal(result.context, INSTALLATION_CONTEXTS.TECHNICAL_INSTALLATION);
  assert.equal(result.confident, true);
});

test("classifyInstallationContext identifies an under-counter kitchen product as indoor_countertop", () => {
  const result = classifyInstallationContext({ title: "Buzsu Slim Kasa Tezgah Altı Su Arıtma Cihazı" }, "");
  assert.equal(result.context, INSTALLATION_CONTEXTS.INDOOR_COUNTERTOP);
  assert.equal(result.confident, true);
});

test("classifyInstallationContext returns ambiguous (not a guess) when no keyword matches", () => {
  const result = classifyInstallationContext({ title: "Buzsu Ürünü" }, "");
  assert.equal(result.context, INSTALLATION_CONTEXTS.AMBIGUOUS);
  assert.equal(result.confident, false);
});

test("classifyInstallationContext returns ambiguous when both indoor and technical keywords match", () => {
  const result = classifyInstallationContext({ title: "Mutfak için endüstriyel filtre" }, "");
  assert.equal(result.context, INSTALLATION_CONTEXTS.AMBIGUOUS);
});

test("classifyInstallationContext also reads grounding context text, not just the title", () => {
  const result = classifyInstallationContext({ title: "UltraMag" }, "Bu ürün bina girişi ana su hattına monte edilir.");
  assert.equal(result.context, INSTALLATION_CONTEXTS.TECHNICAL_INSTALLATION);
});

test("detectsContextConflict flags an indoor request for a technical-installation product", () => {
  assert.equal(detectsContextConflict("evin içine koy, salon gibi gösterelim", INSTALLATION_CONTEXTS.TECHNICAL_INSTALLATION), true);
});

test("detectsContextConflict does not flag an unrelated note", () => {
  assert.equal(detectsContextConflict("ışık daha sıcak olsun", INSTALLATION_CONTEXTS.TECHNICAL_INSTALLATION), false);
});

test("detectsContextConflict never flags anything for indoor_countertop products (already indoor)", () => {
  assert.equal(detectsContextConflict("evin içine koy", INSTALLATION_CONTEXTS.INDOOR_COUNTERTOP), false);
});

test("FORBIDDEN_ELEMENTS_BY_CONTEXT bans the exact elements from the real bug report for technical_installation", () => {
  const forbidden = FORBIDDEN_ELEMENTS_BY_CONTEXT[INSTALLATION_CONTEXTS.TECHNICAL_INSTALLATION];
  assert.ok(forbidden.includes("çamaşır odası"));
  assert.ok(forbidden.includes("çamaşır makinesi"));
});
