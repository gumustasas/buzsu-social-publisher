import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { backgroundOnlyPrompt, buildProductCutout, buildShadowLayer, generateCompositeSceneImage } from "../src/scene-composite.js";

// White canvas with a solid blue square in the middle — mimics a product
// photo on a white/near-white background (what floodFillBackgroundMask
// treats as background vs. product).
async function makeTestProductPhoto(size = 64, squareStart = 20, squareEnd = 44) {
  const raw = Buffer.alloc(size * size * 3, 255);
  for (let y = squareStart; y < squareEnd; y++) {
    for (let x = squareStart; x < squareEnd; x++) {
      const o = (y * size + x) * 3;
      raw[o] = 10; raw[o + 1] = 20; raw[o + 2] = 200; // solid blue "product"
    }
  }
  return sharp(raw, { raw: { width: size, height: size, channels: 3 } }).png().toBuffer();
}

test("backgroundOnlyPrompt embeds the scene description and explicitly forbids any product/object in the generated background", () => {
  const prompt = backgroundOnlyPrompt("modern mutfak, sabah ışığı");
  assert.match(prompt, /modern mutfak, sabah ışığı/);
  assert.match(prompt, /HİÇBİR ürün, cihaz, obje veya insan olmasın/);
});

test("backgroundOnlyPrompt falls back to a default scene when empty", () => {
  const prompt = backgroundOnlyPrompt("   ");
  assert.match(prompt, /mutfak/);
});

test("buildProductCutout keeps the product's real pixels opaque and exact, and makes the white background transparent", async () => {
  const photo = await makeTestProductPhoto();
  const { cutoutPng, info } = await buildProductCutout(photo);
  const { data } = await sharp(cutoutPng).raw().toBuffer({ resolveWithObject: true });

  // Center of the blue square: opaque, color preserved exactly.
  const centerIdx = (Math.floor(info.height / 2) * info.width + Math.floor(info.width / 2)) * 4;
  assert.equal(data[centerIdx], 10);
  assert.equal(data[centerIdx + 1], 20);
  assert.equal(data[centerIdx + 2], 200);
  assert.equal(data[centerIdx + 3], 255);

  // Corner (background): fully transparent.
  const cornerIdx = 0;
  assert.equal(data[cornerIdx + 3], 0);
});

test("buildShadowLayer produces a soft dark alpha layer shifted below the product, with no shadow far above it", async () => {
  // buildProductCutout always normalizes onto a large (e.g. 1024x1024) canvas
  // regardless of the source photo's size, so shadow test coordinates must be
  // derived proportionally from info.width/height, not the small source size.
  const sourceSize = 64, squareStart = 20, squareEnd = 44;
  const photo = await makeTestProductPhoto(sourceSize, squareStart, squareEnd);
  const { isBackground, info } = await buildProductCutout(photo);
  const shadowPng = await buildShadowLayer(isBackground, info);
  const { data } = await sharp(shadowPng).raw().toBuffer({ resolveWithObject: true });

  const squareBottom = Math.round((squareEnd / sourceSize) * info.height);
  const squareCenterX = Math.round(((squareStart + squareEnd) / 2 / sourceSize) * info.width);

  // Somewhere below the product's lower edge should have non-zero shadow alpha.
  const belowY = Math.min(info.height - 1, squareBottom + Math.round(info.height * 0.03));
  const belowIdx = (belowY * info.width + squareCenterX) * 4;
  assert.ok(data[belowIdx + 3] > 0, "expected non-zero shadow alpha just below the product");

  // Far above the product (top-left corner) should have no shadow.
  const aboveIdx = (2 * info.width + 2) * 4;
  assert.equal(data[aboveIdx + 3], 0);
});

test("generateCompositeSceneImage preserves the real product pixels exactly and rejects a non-HTTPS image URL", async () => {
  await assert.rejects(
    () => generateCompositeSceneImage({ imageUrl: "not-a-url" }, "mutfak", { GEMINI_API_KEY: "test" }),
    /HTTPS/
  );
});

test("generateCompositeSceneImage composites the AI-generated background with the exact original product pixels on top", async () => {
  const originalFetch = global.fetch;
  const productPhoto = await makeTestProductPhoto();
  // Solid red "AI background" — lets us assert the final image is NOT solid red where the product is, but IS solid red elsewhere.
  const redRaw = Buffer.alloc(64 * 64 * 3);
  for (let i = 0; i < redRaw.length; i += 3) { redRaw[i] = 255; redRaw[i + 1] = 0; redRaw[i + 2] = 0; }
  const backgroundPhoto = await sharp(redRaw, { raw: { width: 64, height: 64, channels: 3 } }).png().toBuffer();

  global.fetch = async (url) => {
    const u = String(url);
    if (u.includes("example.com")) return { ok: true, arrayBuffer: async () => productPhoto };
    if (u.includes("generativelanguage.googleapis.com")) {
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ inlineData: { data: backgroundPhoto.toString("base64") } }] } }] }) };
    }
    throw new Error(`unexpected fetch: ${u}`);
  };
  try {
    const result = await generateCompositeSceneImage({ title: "Test Ürün", imageUrl: "https://example.com/photo.png" }, "kırmızı arka plan test", { GEMINI_API_KEY: "test" });
    assert.equal(result.provider, "composite");
    const base64 = result.dataUrl.split(",")[1];
    const { data, info } = await sharp(Buffer.from(base64, "base64")).raw().ensureAlpha().toBuffer({ resolveWithObject: true });

    // Center (product area): still the exact original blue, not the red background.
    const centerIdx = (Math.floor(info.height / 2) * info.width + Math.floor(info.width / 2)) * 4;
    assert.equal(data[centerIdx], 10);
    assert.equal(data[centerIdx + 1], 20);
    assert.equal(data[centerIdx + 2], 200);

    // Far corner (pure background area, no shadow reach): the AI-generated red background.
    const cornerIdx = (2 * info.width + 2) * 4;
    assert.equal(data[cornerIdx], 255);
    assert.equal(data[cornerIdx + 1], 0);
    assert.equal(data[cornerIdx + 2], 0);
  } finally {
    global.fetch = originalFetch;
  }
});
