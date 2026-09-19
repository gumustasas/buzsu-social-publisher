import test from "node:test";
import assert from "node:assert/strict";
import { resolveXfadeName, resolveWhipDirection, resolveXfadeNameForScene } from "../src/cinematic/transitions.js";

test("resolveXfadeName maps all 5 required transition types to a valid, fixed xfade name", () => {
  assert.equal(resolveXfadeName("crossfade"), "fade");
  assert.equal(resolveXfadeName("motion-blur"), "hblur");
  assert.equal(resolveXfadeName("light-wipe"), "fadewhite");
  assert.equal(resolveXfadeName("match-cut"), "fade");
  assert.equal(resolveWhipDirection(0), "slideleft");
});

// ROOT REVIEW blocker 2 (PR #110, review 5257372536): motion-blur must NOT
// be an alias of plain crossfade — it must resolve to a materially
// different, deterministic FFmpeg-only xfade transition.
test("motion-blur resolves to a distinct FFmpeg xfade transition ('hblur') — it is NOT an alias of crossfade ('fade')", () => {
  const crossfade = resolveXfadeName("crossfade");
  const motionBlur = resolveXfadeName("motion-blur");
  assert.notEqual(motionBlur, crossfade, "motion-blur artık crossfade ile AYNI xfade adını kullanmamalı");
  assert.equal(motionBlur, "hblur", "hblur, FFmpeg'in xfade filtresinin kendi yerleşik yönlü-bulanıklık geçiş modudur (bkz. `ffmpeg -h filter=xfade`)");
});

test("crossfade transition remains unchanged (still plain 'fade') — this fix must not regress the existing, already-shipped transition", () => {
  assert.equal(resolveXfadeName("crossfade"), "fade");
  assert.equal(resolveXfadeNameForScene("crossfade", 3), "fade");
});

test("all other previously-supported transitions (light-wipe, whip, match-cut) continue to resolve exactly as before — motion-blur's fix is isolated", () => {
  assert.equal(resolveXfadeName("light-wipe"), "fadewhite");
  assert.equal(resolveXfadeName("match-cut"), "fade");
  assert.equal(resolveXfadeNameForScene("whip", 0), "slideleft");
  assert.equal(resolveXfadeNameForScene("whip", 1), "slideright");
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
