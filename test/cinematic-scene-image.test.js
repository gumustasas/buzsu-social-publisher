import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { downloadAndNormalizeSceneImage, InvalidSceneImageError, redactSceneUrlForLog } from "../src/cinematic/scene-image.js";
import { InvalidImageInputError } from "../src/lib/upload-media.js";

async function tinyPng(width = 40, height = 30, color = { r: 200, g: 40, b: 40 }) {
  return sharp({ create: { width, height, channels: 3, background: color } }).png().toBuffer();
}
async function tinyJpeg() {
  return sharp({ create: { width: 40, height: 30, channels: 3, background: { r: 10, g: 200, b: 10 } } }).jpeg().toBuffer();
}

// tests.required: "PNG normalized input"
test("downloadAndNormalizeSceneImage always returns a valid PNG buffer at the requested canvas size", async () => {
  const buffer = await downloadAndNormalizeSceneImage(
    { imageUrl: "https://example.com/p.png" }, 0,
    { width: 1080, height: 1920, fetchPublicImageImpl: async () => ({ buffer: await tinyPng(), mimeType: "image/png" }) }
  );
  const meta = await sharp(buffer).metadata();
  assert.equal(meta.format, "png");
  assert.equal(meta.width, 1080);
  assert.equal(meta.height, 1920);
});

// tests.required: "JPEG TASK-010 path (goes through TASK-010 normalization safely)"
test("downloadAndNormalizeSceneImage accepts a JPEG source (via the TASK-010-hardened fetchPublicImage) and normalizes it to PNG — the renderer is never dependent on the original remote extension", async () => {
  const buffer = await downloadAndNormalizeSceneImage(
    { imageUrl: "https://example.com/p.jpg" }, 1,
    { width: 1080, height: 1920, fetchPublicImageImpl: async () => ({ buffer: await tinyJpeg(), mimeType: "image/jpeg" }) }
  );
  const meta = await sharp(buffer).metadata();
  assert.equal(meta.format, "png", "orijinal JPEG uzantısından BAĞIMSIZ olarak her zaman PNG'ye normalize edilmeli");
});

// tests.required: "invalid image context (error includes scene index and original URL)"
test("downloadAndNormalizeSceneImage wraps a TASK-010 INVALID_IMAGE_INPUT rejection with scene_index/original_url/failure_stage=validate, preserving stable_error_code", async () => {
  const underlying = new InvalidImageInputError("INVALID_IMAGE_INPUT: dosya imzası tanınmadı.", { reason: "unsupported_bytes" });
  await assert.rejects(
    () => downloadAndNormalizeSceneImage(
      { imageUrl: "https://example.com/corrupt.png" }, 2,
      { width: 1080, height: 1920, fetchPublicImageImpl: async () => { throw underlying; } }
    ),
    (err) => {
      assert.ok(err instanceof InvalidSceneImageError);
      assert.equal(err.stable_error_code, "INVALID_SCENE_IMAGE");
      assert.equal(err.scene_index, 2);
      assert.equal(err.original_url, "https://example.com/corrupt.png");
      assert.equal(err.failure_stage, "validate");
      assert.equal(err.cause, underlying, "alt seviye TASK-010 hatası (.code/.reason dahil) cause olarak korunmalı");
      return true;
    }
  );
});

test("downloadAndNormalizeSceneImage reports failure_stage='fetch' for a raw network/SSRF-layer error (not TASK-010's own INVALID_IMAGE_INPUT)", async () => {
  await assert.rejects(
    () => downloadAndNormalizeSceneImage(
      { imageUrl: "https://example.com/unreachable.png" }, 4,
      { width: 1080, height: 1920, fetchPublicImageImpl: async () => { throw new Error("özel IP adresine erişim reddedildi"); } }
    ),
    (err) => {
      assert.equal(err.failure_stage, "fetch");
      assert.equal(err.scene_index, 4);
      return true;
    }
  );
});

test("downloadAndNormalizeSceneImage never leaks a signed URL's query/hash into the error message/original_url", async () => {
  const signedUrl = "https://cdn.example.com/scene.jpg?token=SUPERSECRET123&x=1#frag";
  await assert.rejects(
    () => downloadAndNormalizeSceneImage(
      { imageUrl: signedUrl }, 0,
      { width: 1080, height: 1920, fetchPublicImageImpl: async () => { throw new Error("boom"); } }
    ),
    (err) => {
      assert.doesNotMatch(err.message, /SUPERSECRET123/);
      assert.doesNotMatch(err.original_url, /token=/);
      assert.equal(err.original_url, "https://cdn.example.com/scene.jpg");
      return true;
    }
  );
});

test("redactSceneUrlForLog reduces a URL to origin+pathname only", () => {
  assert.equal(redactSceneUrlForLog("https://cdn.example.com/a/b.jpg?token=x#y"), "https://cdn.example.com/a/b.jpg");
  assert.equal(redactSceneUrlForLog("not a url"), "[geçersiz URL]");
});

test("downloadAndNormalizeSceneImage reports failure_stage='normalize' when TASK-010 validation passes but sharp itself fails downstream", async () => {
  const brokenSharpImpl = () => { throw new Error("sharp patladı"); };
  await assert.rejects(
    () => downloadAndNormalizeSceneImage(
      { imageUrl: "https://example.com/ok.png" }, 3,
      { width: 1080, height: 1920, fetchPublicImageImpl: async () => ({ buffer: await tinyPng(), mimeType: "image/png" }), sharpImpl: brokenSharpImpl }
    ),
    (err) => {
      assert.equal(err.failure_stage, "normalize");
      assert.equal(err.scene_index, 3);
      return true;
    }
  );
});
