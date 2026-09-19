import test from "node:test";
import assert from "node:assert/strict";
import { buildCameraMotion, MIN_ZOOM, MAX_ZOOM } from "../src/cinematic/camera.js";

const OPTS = { durationSeconds: 5, fps: 30, width: 1080, height: 1920 };

test("buildCameraMotion: frameCount is round(durationSeconds*fps), matching the zoompan 'd' trim convention", () => {
  const result = buildCameraMotion({ type: "static-premium", intensity: 0.35, easing: "linear" }, OPTS);
  assert.equal(result.frameCount, 150);
  assert.match(result.filter, /trim=end_frame=150/, "sert trim zorunlu — aksi halde zoompan sonsuz kare üretir (bkz. dosya başı yorumu)");
});

// tests.required: "camera crop safety (no black/uninitialized border exposure)"
test("push-in/pull-out: zoom never exceeds MAX_ZOOM (1.10) at maximum intensity, and starts/ends at exactly MIN_ZOOM (1.0) at the resting side", () => {
  const pushIn = buildCameraMotion({ type: "push-in", intensity: 1, easing: "linear" }, OPTS);
  assert.match(pushIn.filter, new RegExp(`z='\\(${MIN_ZOOM}\\+${(MAX_ZOOM - MIN_ZOOM).toFixed(6)}\\*`), "push-in zoom ifadesi MIN_ZOOM'dan başlayıp en fazla MAX_ZOOM'a ulaşmalı");
  const pullOut = buildCameraMotion({ type: "pull-out", intensity: 1, easing: "linear" }, OPTS);
  assert.match(pullOut.filter, /z='\(1\.100000-0\.100000\*/, "pull-out MAX_ZOOM'dan başlayıp MIN_ZOOM'a inmeli");
});

test("push-in/pull-out keep the crop centered (x/y formula never shifts off-center) — no directional border exposure risk", () => {
  const result = buildCameraMotion({ type: "push-in", intensity: 0.5, easing: "ease-in-out" }, OPTS);
  assert.match(result.filter, /x='iw\/2-\(iw\/zoom\/2\)'/);
  assert.match(result.filter, /y='ih\/2-\(ih\/zoom\/2\)'/);
});

test("pan-left/pan-right: x range is mathematically bounded to [0, iw-iw/zoom] — the crop window can never exceed the source image bounds", () => {
  const panRight = buildCameraMotion({ type: "pan-right", intensity: 0.6, easing: "linear" }, OPTS);
  assert.match(panRight.filter, /x='\(iw-iw\/1\.060000\)\*\(on\/150\)'/, "pan-right ilerledikçe SAĞA hareket etmeli (dir=progress)");
  const panLeft = buildCameraMotion({ type: "pan-left", intensity: 0.6, easing: "linear" }, OPTS);
  assert.match(panLeft.filter, /x='\(iw-iw\/1\.060000\)\*\(1-\(on\/150\)\)'/, "pan-left ilerledikçe SOLA (progress'in tersine) hareket etmeli");
});

test("tilt-up/tilt-down: y range is mathematically bounded to [0, ih-ih/zoom]", () => {
  const tiltDown = buildCameraMotion({ type: "tilt-down", intensity: 0.4, easing: "linear" }, OPTS);
  assert.match(tiltDown.filter, /y='\(ih-ih\/1\.050000\)\*\(on\/150\)'/);
  const tiltUp = buildCameraMotion({ type: "tilt-up", intensity: 0.4, easing: "linear" }, OPTS);
  assert.match(tiltUp.filter, /y='\(ih-ih\/1\.050000\)\*\(1-\(on\/150\)\)'/);
});

test("static-premium: zoom is a fixed constant (no PowerPoint-style constant-speed zoom animation at all)", () => {
  const result = buildCameraMotion({ type: "static-premium", intensity: 0.8, easing: "linear" }, OPTS);
  assert.match(result.filter, /z='1\.000000'/);
  assert.equal(result.appliedEffect, "camera_static_premium");
});

test("buildCameraMotion rejects an unknown camera type/easing (fail-closed, no silent fallback)", () => {
  assert.throws(() => buildCameraMotion({ type: "dolly-zoom", intensity: 0.5, easing: "linear" }, OPTS), /Bilinmeyen kamera tipi/);
  assert.throws(() => buildCameraMotion({ type: "push-in", intensity: 0.5, easing: "bounce" }, OPTS), /Bilinmeyen easing/);
});

test("buildCameraMotion output always scales back up to the requested full output resolution after the internal half-res zoompan pass", () => {
  const result = buildCameraMotion({ type: "push-in", intensity: 0.3, easing: "linear" }, OPTS);
  assert.match(result.filter, /scale=1080:1920:flags=fast_bilinear/);
});
