import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { composeBrandedPost } from "../src/post-branding.js";

async function makeScenePng(width = 800, height = 600) {
  return sharp({ create: { width, height, channels: 3, background: { r: 210, g: 220, b: 230 } } }).png().toBuffer();
}

test("composeBrandedPost outputs a 1024x1024 PNG regardless of the source scene's dimensions", async () => {
  const scene = await makeScenePng(800, 600);
  const out = await composeBrandedPost(scene, { title: "Test Ürün" });
  const meta = await sharp(out).metadata();
  assert.equal(meta.width, 1024);
  assert.equal(meta.height, 1024);
  assert.equal(meta.format, "png");
});

test("composeBrandedPost draws an opaque brand bar at the bottom, leaving the top of the scene untouched", async () => {
  const scene = await makeScenePng(1024, 1024);
  const out = await composeBrandedPost(scene, { title: "Test Ürün" });
  const { data, info } = await sharp(out).raw().ensureAlpha().toBuffer({ resolveWithObject: true });
  const pixelAt = (x, y) => {
    const idx = (y * info.width + x) * info.channels;
    return [data[idx], data[idx + 1], data[idx + 2]];
  };
  const [topR, topG, topB] = pixelAt(512, 10);
  assert.ok(topR > 190 && topG > 190 && topB > 190, "top of image should still show the light scene background");

  const [bottomR, bottomG, bottomB] = pixelAt(512, 1014);
  assert.ok(bottomR < 60 && bottomG < 60 && bottomB < 80, "bottom bar should be a dark navy overlay");
});

test("composeBrandedPost does not throw for a long product title that needs wrapping", async () => {
  const scene = await makeScenePng();
  const out = await composeBrandedPost(scene, { title: "1 İnç Manyetik Kireç Önleyici — Apartman Tipi Uzun Ürün Adı Testi" });
  const meta = await sharp(out).metadata();
  assert.equal(meta.width, 1024);
});
