import test from "node:test";
import assert from "node:assert/strict";
import { validatePlan, MAX_STEPS, MAX_RETRY_ATTEMPTS } from "../src/orchestrator/validate.js";
import { createCapabilityRegistry } from "../src/orchestrator/capabilities.js";

const registry = createCapabilityRegistry({});

test("validatePlan: steps dizi değilse reddedilir", () => {
  assert.throws(() => validatePlan("not-an-array", registry), /dizi olmalı/);
  assert.throws(() => validatePlan(undefined, registry), /dizi olmalı/);
});

test("validatePlan: boş steps dizisi reddedilir", () => {
  assert.throws(() => validatePlan([], registry), /en az 1 adım/);
});

test(`validatePlan: ${MAX_STEPS}'den fazla adım içeren bir plan (bounded) reddedilir`, () => {
  const steps = Array.from({ length: MAX_STEPS + 1 }, (_, i) => ({ stepId: `s${i}`, capability: "list_products", args: {} }));
  assert.throws(() => validatePlan(steps, registry), /en fazla/);
});

test("validatePlan: bilinmeyen/izin verilmeyen bir capability adı PLANIN TAMAMINI reddeder", () => {
  assert.throws(
    () => validatePlan([{ stepId: "a", capability: "publish_now", args: {} }], registry),
    /bilinmeyen veya izin verilmeyen capability/
  );
});

test("validatePlan: forbidden capability'ler (publish/delete/update/upload/autopilot) registry'de hiç YOKTUR — hepsi 'bilinmeyen' olarak reddedilir", () => {
  for (const forbidden of ["publish_now", "create_draft", "update_draft", "update_status", "set_autopilot", "upload_media", "delete_draft"]) {
    assert.throws(() => validatePlan([{ stepId: "a", capability: forbidden, args: {} }], registry), /bilinmeyen veya izin verilmeyen capability/);
  }
});

test("validatePlan: stepId eksikse veya tekrarlanıyorsa reddedilir", () => {
  assert.throws(() => validatePlan([{ capability: "list_products", args: {} }], registry), /stepId. gerekli/);
  assert.throws(
    () => validatePlan([{ stepId: "a", capability: "list_products", args: {} }, { stepId: "a", capability: "list_products", args: {} }], registry),
    /Tekrarlanan stepId/
  );
});

test("validatePlan: allowedArgs dışında bir alan gönderilirse reddedilir", () => {
  assert.throws(
    () => validatePlan([{ stepId: "a", capability: "list_products", args: { madeUpField: true } }], registry),
    /izin verilmeyen alan/
  );
});

test("validatePlan: bir capability'nin zorunlu alanı eksikse reddedilir (örn. research_web'de query yok)", () => {
  assert.throws(
    () => validatePlan([{ stepId: "a", capability: "research_web", args: { confirmed: true } }], registry),
    /zorunlu alan eksik: "query"/
  );
});

test("validatePlan: confirmed alanı eksik olsa da (henüz false/verilmemiş) zorunlu-alan hatası vermez — sadece confirmed:false gibi ele alınır", () => {
  const steps = validatePlan([{ stepId: "a", capability: "research_web", args: { query: "x", confirmed: false } }], registry);
  assert.equal(steps[0].args.confirmed, false);
});

test(`validatePlan: maxAttempts 1-${MAX_RETRY_ATTEMPTS} dışında bir tam sayıysa reddedilir`, () => {
  assert.throws(
    () => validatePlan([{ stepId: "a", capability: "list_products", args: {}, maxAttempts: 0 }], registry),
    /maxAttempts/
  );
  assert.throws(
    () => validatePlan([{ stepId: "a", capability: "list_products", args: {}, maxAttempts: MAX_RETRY_ATTEMPTS + 1 }], registry),
    /maxAttempts/
  );
  assert.throws(
    () => validatePlan([{ stepId: "a", capability: "list_products", args: {}, maxAttempts: 1.5 }], registry),
    /maxAttempts/
  );
});

test("validatePlan: maxAttempts verilmezse varsayılan 1'dir, geçerli bir değer verilirse aynen korunur", () => {
  const steps = validatePlan([
    { stepId: "a", capability: "list_products", args: {} },
    { stepId: "b", capability: "list_products", args: {}, maxAttempts: 3 }
  ], registry);
  assert.equal(steps[0].maxAttempts, 1);
  assert.equal(steps[1].maxAttempts, 3);
});

test("validatePlan: geçerli bir plan normalize edilmiş {stepId,capability,args,maxAttempts} dizisi döner", () => {
  const steps = validatePlan([{ stepId: "a", capability: "list_products" }], registry);
  assert.deepEqual(steps, [{ stepId: "a", capability: "list_products", args: {}, maxAttempts: 1 }]);
});
