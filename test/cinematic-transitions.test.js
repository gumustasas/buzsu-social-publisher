import test from "node:test";
import assert from "node:assert/strict";
import { resolveXfadeName, resolveWhipDirection, resolveXfadeNameForScene } from "../src/cinematic/transitions.js";

test("resolveXfadeName maps all 5 required transition types to a valid, fixed xfade name", () => {
  assert.equal(resolveXfadeName("crossfade"), "fade");
  assert.equal(resolveXfadeName("motion-blur"), "fade");
  assert.equal(resolveXfadeName("light-wipe"), "fadewhite");
  assert.equal(resolveXfadeName("match-cut"), "fade");
  assert.equal(resolveWhipDirection(0), "slideleft");
});

test("resolveXfadeName throws (fail-closed) for an unknown transition type — never falls back silently to a default", () => {
  assert.throws(() => resolveXfadeName("spin"), /Bilinmeyen geçiş tipi/);
});

test("resolveWhipDirection alternates deterministically by scene index (no randomness)", () => {
  assert.equal(resolveWhipDirection(0), "slideleft");
  assert.equal(resolveWhipDirection(1), "slideright");
  assert.equal(resolveWhipDirection(2), "slideleft");
  assert.equal(resolveWhipDirection(0), resolveWhipDirection(0), "aynı indeks her zaman aynı yönü vermeli");
});

test("resolveXfadeNameForScene routes 'whip' through the deterministic direction resolver, other types through the fixed map", () => {
  assert.equal(resolveXfadeNameForScene("whip", 0), "slideleft");
  assert.equal(resolveXfadeNameForScene("whip", 1), "slideright");
  assert.equal(resolveXfadeNameForScene("crossfade", 5), "fade");
});
