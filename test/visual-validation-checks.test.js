import test from "node:test";
import assert from "node:assert/strict";
import { VISUAL_VALIDATION_CHECKS, normalizeFailedChecks } from "../src/visual-validation/checks.js";

test("VISUAL_VALIDATION_CHECKS exposes exactly the 7 agreed criteria from the task goal", () => {
  assert.deepEqual([...VISUAL_VALIDATION_CHECKS].sort(), [
    "component_count", "fabricated_text", "identity", "installation", "label", "logo", "proportions"
  ]);
});

test("normalizeFailedChecks: dizi olmayan girdide boş dizi döner", () => {
  assert.deepEqual(normalizeFailedChecks(undefined), []);
  assert.deepEqual(normalizeFailedChecks(null), []);
  assert.deepEqual(normalizeFailedChecks("identity"), []);
});

test("normalizeFailedChecks: bilinen kontrol kodlarını olduğu gibi geçirir", () => {
  assert.deepEqual(normalizeFailedChecks(["identity", "logo"]), ["identity", "logo"]);
});

test("normalizeFailedChecks: uydurma/bilinmeyen bir kontrol kodunu SESSİZCE eler (halüsinasyona karşı savunma)", () => {
  assert.deepEqual(normalizeFailedChecks(["identity", "made_up_check", 42, {}, "logo"]), ["identity", "logo"]);
});

test("normalizeFailedChecks: yinelenen kontrol kodlarını tekilleştirir", () => {
  assert.deepEqual(normalizeFailedChecks(["identity", "identity", "logo"]), ["identity", "logo"]);
});
