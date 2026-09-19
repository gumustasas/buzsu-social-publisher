import test from "node:test";
import assert from "node:assert/strict";
import { validateComposeCinematicInput } from "../src/cinematic/schema.js";

const SCENE = (overrides = {}) => ({ imageUrl: "https://example.com/p.png", durationSeconds: 3, ...overrides });

// tests.required: "schema validation"
test("validateComposeCinematicInput rejects fewer than 2 scenes", () => {
  assert.throws(() => validateComposeCinematicInput({ scenes: [SCENE()] }), /en az 2/);
  assert.throws(() => validateComposeCinematicInput({ scenes: [] }), /en az 2/);
});

test("validateComposeCinematicInput rejects more than 10 scenes", () => {
  const scenes = Array.from({ length: 11 }, () => SCENE());
  assert.throws(() => validateComposeCinematicInput({ scenes }), /en fazla 10/);
});

test("validateComposeCinematicInput accepts 2 scenes and applies documented defaults", () => {
  const result = validateComposeCinematicInput({ scenes: [SCENE(), SCENE()] });
  assert.equal(result.scenes.length, 2);
  assert.equal(result.aspectRatio, "9:16");
  assert.equal(result.visualProfile, "clean-tech");
  assert.equal(result.output.width, 1080);
  assert.equal(result.output.height, 1920);
  assert.equal(result.output.fps, 30);
  assert.equal(result.output.codec, "h264");
  assert.equal(result.scenes[0].camera.type, "static-premium");
  assert.equal(result.scenes[0].camera.easing, "ease-in-out");
  assert.equal(result.scenes[0].subjectLock, true, "subjectLock varsayılan true olmalı (manifest şartı)");
  assert.equal(result.scenes[0].depthEffect, false);
  assert.equal(result.scenes[0].transition.type, "crossfade");
  assert.deepEqual(result.scenes[0].transitionAnchor, { x: 0.5, y: 0.5 });
});

test("validateComposeCinematicInput rejects a non-HTTPS scene imageUrl", () => {
  assert.throws(() => validateComposeCinematicInput({ scenes: [SCENE({ imageUrl: "http://example.com/a.png" }), SCENE()] }), /yalnızca HTTPS/);
});

test("validateComposeCinematicInput rejects a scene durationSeconds outside 1.0-8.0", () => {
  assert.throws(() => validateComposeCinematicInput({ scenes: [SCENE({ durationSeconds: 0.2 }), SCENE()] }), /durationSeconds/);
  assert.throws(() => validateComposeCinematicInput({ scenes: [SCENE({ durationSeconds: 9 }), SCENE()] }), /durationSeconds/);
});

test("validateComposeCinematicInput rejects an unknown camera.type/easing", () => {
  assert.throws(() => validateComposeCinematicInput({ scenes: [SCENE({ camera: { type: "dolly-zoom" } }), SCENE()] }), /camera\.type/);
  assert.throws(() => validateComposeCinematicInput({ scenes: [SCENE({ camera: { easing: "bounce" } }), SCENE()] }), /camera\.easing/);
});

test("validateComposeCinematicInput rejects camera.intensity outside 0-1", () => {
  assert.throws(() => validateComposeCinematicInput({ scenes: [SCENE({ camera: { intensity: 1.5 } }), SCENE()] }), /camera\.intensity/);
});

// tests.required: "transition validation (invalid duration rejected)"
test("validateComposeCinematicInput rejects a transition.durationSeconds >= scene durationSeconds", () => {
  assert.throws(
    () => validateComposeCinematicInput({ scenes: [SCENE({ durationSeconds: 1, transition: { durationSeconds: 1 } }), SCENE()] }),
    /transition\.durationSeconds/
  );
});

test("validateComposeCinematicInput rejects a transition.durationSeconds outside the global 0.15-1.5 bound", () => {
  assert.throws(() => validateComposeCinematicInput({ scenes: [SCENE({ transition: { durationSeconds: 2 } }), SCENE()] }), /transition\.durationSeconds/);
});

test("validateComposeCinematicInput rejects an unknown transition.type", () => {
  assert.throws(() => validateComposeCinematicInput({ scenes: [SCENE({ transition: { type: "spin" } }), SCENE()] }), /transition\.type/);
});

// manifest: "invalid anchor/crop must fall back safely to center" — bu, şemadaki BİLİNÇLİ tek "silent fallback"tir.
test("validateComposeCinematicInput falls back an invalid/missing transitionAnchor to the center (documented exception)", () => {
  const invalid = validateComposeCinematicInput({ scenes: [SCENE({ transitionAnchor: { x: 2, y: -1 } }), SCENE()] });
  assert.deepEqual(invalid.scenes[0].transitionAnchor, { x: 0.5, y: 0.5 });
  const missing = validateComposeCinematicInput({ scenes: [SCENE(), SCENE()] });
  assert.deepEqual(missing.scenes[0].transitionAnchor, { x: 0.5, y: 0.5 });
  const valid = validateComposeCinematicInput({ scenes: [SCENE({ transitionAnchor: { x: 0.2, y: 0.8 } }), SCENE()] });
  assert.deepEqual(valid.scenes[0].transitionAnchor, { x: 0.2, y: 0.8 });
});

test("validateComposeCinematicInput rejects a title/subtitle longer than 80 characters", () => {
  const long = "x".repeat(81);
  assert.throws(() => validateComposeCinematicInput({ scenes: [SCENE({ title: long }), SCENE()] }), /title/);
});

test("validateComposeCinematicInput rejects an unknown aspectRatio/visualProfile/vignette/grain", () => {
  assert.throws(() => validateComposeCinematicInput({ scenes: [SCENE(), SCENE()], aspectRatio: "4:3" }), /aspectRatio/);
  assert.throws(() => validateComposeCinematicInput({ scenes: [SCENE(), SCENE()], visualProfile: "vintage" }), /visualProfile/);
  assert.throws(() => validateComposeCinematicInput({ scenes: [SCENE(), SCENE()], cinematic: { vignette: "heavy" } }), /vignette/);
  assert.throws(() => validateComposeCinematicInput({ scenes: [SCENE(), SCENE()], cinematic: { grain: "high" } }), /grain/);
});

// tests.required: "output resolution (1080x1920 default)"
test("validateComposeCinematicInput derives default output dimensions from aspectRatio when output is omitted", () => {
  assert.deepEqual(
    { w: validateComposeCinematicInput({ scenes: [SCENE(), SCENE()], aspectRatio: "9:16" }).output.width, h: validateComposeCinematicInput({ scenes: [SCENE(), SCENE()], aspectRatio: "9:16" }).output.height },
    { w: 1080, h: 1920 }
  );
  const square = validateComposeCinematicInput({ scenes: [SCENE(), SCENE()], aspectRatio: "1:1" });
  assert.equal(square.output.width, 1080);
  assert.equal(square.output.height, 1080);
  const landscape = validateComposeCinematicInput({ scenes: [SCENE(), SCENE()], aspectRatio: "16:9" });
  assert.equal(landscape.output.width, 1920);
  assert.equal(landscape.output.height, 1080);
});

test("validateComposeCinematicInput rejects an unsupported output.fps/codec", () => {
  assert.throws(() => validateComposeCinematicInput({ scenes: [SCENE(), SCENE()], output: { fps: 23 } }), /output\.fps/);
  assert.throws(() => validateComposeCinematicInput({ scenes: [SCENE(), SCENE()], output: { codec: "vp9" } }), /output\.codec/);
});

// tests.required: "audio ducking configuration" ve "no-audio render"
test("validateComposeCinematicInput: audio hiç verilmezse voiceoverUrl/musicUrl undefined kalır (sessiz render), duckDb varsayılanı 8'dir", () => {
  const result = validateComposeCinematicInput({ scenes: [SCENE(), SCENE()] });
  assert.equal(result.audio.voiceoverUrl, undefined);
  assert.equal(result.audio.musicUrl, undefined);
  assert.equal(result.audio.autoDuck, false);
  assert.equal(result.audio.duckDb, 8);
});

test("validateComposeCinematicInput rejects audio.duckDb outside 6-10", () => {
  assert.throws(() => validateComposeCinematicInput({ scenes: [SCENE(), SCENE()], audio: { duckDb: 3 } }), /duckDb/);
  assert.throws(() => validateComposeCinematicInput({ scenes: [SCENE(), SCENE()], audio: { duckDb: 15 } }), /duckDb/);
});

test("validateComposeCinematicInput rejects a non-HTTPS audio.voiceoverUrl/musicUrl", () => {
  assert.throws(() => validateComposeCinematicInput({ scenes: [SCENE(), SCENE()], audio: { voiceoverUrl: "http://example.com/v.mp3" } }), /voiceoverUrl/);
  assert.throws(() => validateComposeCinematicInput({ scenes: [SCENE(), SCENE()], audio: { musicUrl: "http://example.com/m.mp3" } }), /musicUrl/);
});
