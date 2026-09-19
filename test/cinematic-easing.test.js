import test from "node:test";
import assert from "node:assert/strict";
import { easeLinear, easeIn, easeOut, easeInOut, applyEasing, clamp01 } from "../src/cinematic/easing.js";

// tests.required: "easing determinism (same inputs -> same motion values)"
test("easing functions are deterministic — identical (type, t) always produces identical output", () => {
  for (const t of [0, 0.1, 0.33, 0.5, 0.77, 1]) {
    assert.equal(applyEasing("ease-in-out", t), applyEasing("ease-in-out", t));
    assert.equal(easeInOut(t), easeInOut(t));
  }
});

test("all easing curves start at 0 and end at 1", () => {
  for (const fn of [easeLinear, easeIn, easeOut, easeInOut]) {
    assert.equal(fn(0), 0);
    assert.equal(fn(1), 1);
  }
});

test("easeInOut matches the manifest's recommended formula: 0.5 - 0.5*cos(PI*t)", () => {
  for (const t of [0, 0.25, 0.5, 0.75, 1]) {
    assert.ok(Math.abs(easeInOut(t) - (0.5 - 0.5 * Math.cos(Math.PI * t))) < 1e-9);
  }
});

test("easeIn is t^2 and easeOut is 1-(1-t)^2", () => {
  assert.equal(easeIn(0.5), 0.25);
  assert.equal(easeOut(0.5), 0.75);
});

test("clamp01 keeps out-of-range/non-finite input safe", () => {
  assert.equal(clamp01(-1), 0);
  assert.equal(clamp01(2), 1);
  assert.equal(clamp01(NaN), 0);
});

test("applyEasing throws (fail-closed) for an unknown easing type instead of silently defaulting", () => {
  assert.throws(() => applyEasing("bounce", 0.5), /Bilinmeyen easing/);
});
