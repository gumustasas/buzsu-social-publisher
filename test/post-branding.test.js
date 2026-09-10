import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { composeBrandedPost, composeVideoFrame, composeClosingScene } from "../src/post-branding.js";

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

test("composeVideoFrame outputs a 1080x1920 (9:16) PNG regardless of the source image's dimensions", async () => {
  const scene = await makeScenePng(800, 600);
  const out = await composeVideoFrame(scene, { title: "Test Ürün" });
  const meta = await sharp(out).metadata();
  assert.equal(meta.width, 1080);
  assert.equal(meta.height, 1920);
  assert.equal(meta.format, "png");
});

test("composeVideoFrame returns the plain cropped frame (no title bar drawn) when no title is given", async () => {
  const scene = await makeScenePng(1080, 1920);
  const withTitle = await composeVideoFrame(scene, { title: "Test Ürün" });
  const withoutTitle = await composeVideoFrame(scene, {});
  const { data: withData } = await sharp(withTitle).raw().ensureAlpha().toBuffer({ resolveWithObject: true });
  const { data: withoutData } = await sharp(withoutTitle).raw().ensureAlpha().toBuffer({ resolveWithObject: true });
  assert.notDeepEqual(withData, withoutData, "with a title the pixels must differ from the untouched frame");
});

test("composeVideoFrame draws the title bar within the bottom safe area, leaving the top of the frame untouched", async () => {
  const scene = await makeScenePng(1080, 1920);
  const out = await composeVideoFrame(scene, { title: "Test Ürün" });
  const { data, info } = await sharp(out).raw().ensureAlpha().toBuffer({ resolveWithObject: true });
  const pixelAt = (x, y) => {
    const idx = (y * info.width + x) * info.channels;
    return [data[idx], data[idx + 1], data[idx + 2]];
  };
  const [topR, topG, topB] = pixelAt(540, 10);
  assert.ok(topR > 190 && topG > 190 && topB > 190, "top of frame should still show the light scene background");
  // Reels/Shorts platform arayüzüyle çakışmasın diye bandın en alttan en az
  // 230px yukarıda kalması gerekiyor — en alt piksel bu yüzden banttan boş olmalı.
  const [bottomR, bottomG, bottomB] = pixelAt(540, 1918);
  assert.ok(bottomR > 190 && bottomG > 190 && bottomB > 190, "absolute bottom pixel must stay outside the brand bar (safe-area margin)");
});

test("composeVideoFrame does not throw for a long product title that needs wrapping", async () => {
  const scene = await makeScenePng(1080, 1920);
  const out = await composeVideoFrame(scene, { title: "1 İnç Manyetik Kireç Önleyici — Apartman Tipi Uzun Ürün Adı Testi" });
  const meta = await sharp(out).metadata();
  assert.equal(meta.width, 1080);
});

test("composeClosingScene outputs a 1080x1920 PNG with the default Buzsu brand copy and no source image needed", async () => {
  const out = await composeClosingScene();
  const meta = await sharp(out).metadata();
  assert.equal(meta.width, 1080);
  assert.equal(meta.height, 1920);
  assert.equal(meta.format, "png");
});

test("composeClosingScene accepts a custom title/subtitle without throwing", async () => {
  const out = await composeClosingScene({ title: "Özel kapanış metni testi çok uzun bir başlıkla deneniyor", subtitle: "ornek.com" });
  const meta = await sharp(out).metadata();
  assert.equal(meta.width, 1080);
});
