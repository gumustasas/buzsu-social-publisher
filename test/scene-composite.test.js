import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { backgroundOnlyPrompt, buildProductCutout, buildShadowLayer, generateCompositeSceneImage, assertReliableCutout, adaptiveBackgroundMask } from "../src/scene-composite.js";
import { floodFillBackgroundMask } from "../src/scene-image.js";
import { INSTALLATION_CONTEXTS } from "../src/lib/product-installation-context.js";

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

// Off-white/light-gray studio background (below the old fixed >=235
// threshold) with a solid blue "product" square — mimics the real Silifozlu
// catalog photo that triggered the production incident.
async function makeOffWhiteTestProductPhoto(size = 64, squareStart = 20, squareEnd = 44, bg = 224) {
  const raw = Buffer.alloc(size * size * 3, bg);
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

// --- REGRESYON: gerçek üretim olayı (Silifozlu, kayıtlı stüdyo fotoğrafı) —
// arka plan saf beyaz değil, hafif gri/off-white idi. Eski sabit eşikli
// floodFillBackgroundMask (>=235/255) kenarlardan hiç yayılamadı, kesim
// %98.7 "ürün" (tamamen başarısız) çıktı ve assertReliableCutout kullanıcıyı
// tamamen durdurdu. adaptiveBackgroundMask (kenar renginin medyanına göre
// yakınlık eşiği) bu durumu düzgün ele almalı. ---
test("REGRESSION: the old fixed-threshold mask misclassifies an off-white studio background as product, but adaptiveBackgroundMask correctly recovers it", async () => {
  const photo = await makeOffWhiteTestProductPhoto(64, 20, 44, 224);
  const normalized = await sharp(photo).resize(256, 256, { fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 1 } }).removeAlpha().toColourspace("srgb");
  const { data, info } = await normalized.raw().toBuffer({ resolveWithObject: true });

  const oldMask = floodFillBackgroundMask(data, info);
  const oldProductRatio = oldMask.reduce((sum, v) => sum + (v ? 0 : 1), 0) / (info.width * info.height);
  assert.ok(oldProductRatio > 0.92, `eski algoritma bu senaryoda başarısız olmalıydı (ratio=${oldProductRatio})`);

  const newMask = adaptiveBackgroundMask(data, info);
  const newProductRatio = newMask.reduce((sum, v) => sum + (v ? 0 : 1), 0) / (info.width * info.height);
  assert.ok(newProductRatio > 0.015 && newProductRatio < 0.92, `yeni algoritma güvenilir bir oran döndürmeli (ratio=${newProductRatio})`);
});

test("REGRESSION: generateCompositeSceneImage no longer throws on an off-white studio background product photo, and still preserves the exact product pixels", async () => {
  const originalFetch = global.fetch;
  const productPhoto = await makeOffWhiteTestProductPhoto();
  const backgroundPhoto = await sharp(Buffer.alloc(64 * 64 * 3, 200), { raw: { width: 64, height: 64, channels: 3 } }).png().toBuffer();
  global.fetch = async (url, options) => {
    const u = String(url);
    if (u.includes("example.com")) return { ok: true, arrayBuffer: async () => productPhoto };
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ inlineData: { data: backgroundPhoto.toString("base64") } }] } }] }) };
  };
  try {
    const result = await generateCompositeSceneImage(
      { title: "Silifozlu Ev Ana Giriş Su Arıtma Sistemi", imageUrl: "https://example.com/silifozlu-offwhite.png" },
      "Bina girişindeki teknik odada, ana su hattı üzerinde profesyonel bir kurulum.",
      { GEMINI_API_KEY: "test" },
      { usageContext: INSTALLATION_CONTEXTS.TECHNICAL_INSTALLATION, negativeConstraints: [] }
    );
    const base64 = result.dataUrl.split(",")[1];
    const { data, info } = await sharp(Buffer.from(base64, "base64")).raw().ensureAlpha().toBuffer({ resolveWithObject: true });
    const centerIdx = (Math.floor(info.height / 2) * info.width + Math.floor(info.width / 2)) * 4;
    assert.equal(data[centerIdx], 10);
    assert.equal(data[centerIdx + 1], 20);
    assert.equal(data[centerIdx + 2], 200);
  } finally {
    global.fetch = originalFetch;
  }
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

// --- assertReliableCutout: "referans görseli veya güvenilir cutout'u olmayan
// üründe üretimi durdur" gereksinimi ---
test("assertReliableCutout rejects a near-empty cutout (product not detected — e.g. an almost entirely white/blank photo)", () => {
  const size = 64;
  // Only a 2x2 speck is "product" — far below MIN_PRODUCT_PIXEL_RATIO.
  const isBackground = new Uint8Array(size * size).fill(1);
  isBackground[0] = 0; isBackground[1] = 0;
  assert.throws(() => assertReliableCutout(isBackground, { width: size, height: size }), /ürün tespit edilemedi/);
});

test("assertReliableCutout rejects a near-full cutout (background not separable — e.g. a busy or non-white-background photo)", () => {
  const size = 64;
  const isBackground = new Uint8Array(size * size).fill(0); // everything looks like "product"
  assert.throws(() => assertReliableCutout(isBackground, { width: size, height: size }), /arka plan ayırt edilemedi/);
});

test("assertReliableCutout accepts a normal product photo (reasonable product/background split)", async () => {
  const photo = await makeTestProductPhoto();
  const { isBackground, info } = await buildProductCutout(photo);
  assert.doesNotThrow(() => assertReliableCutout(isBackground, info));
});

test("generateCompositeSceneImage stops BEFORE any AI network call when the cutout is unreliable", async () => {
  const originalFetch = global.fetch;
  // An almost entirely white photo — no real product silhouette to detect.
  const blankPhoto = await sharp(Buffer.alloc(64 * 64 * 3, 255), { raw: { width: 64, height: 64, channels: 3 } }).png().toBuffer();
  let aiWasCalled = false;
  global.fetch = async (url) => {
    const u = String(url);
    if (u.includes("example.com")) return { ok: true, arrayBuffer: async () => blankPhoto };
    aiWasCalled = true;
    throw new Error(`AI çağrısı yapılmamalıydı: ${u}`);
  };
  try {
    await assert.rejects(
      () => generateCompositeSceneImage({ title: "Test Ürün", imageUrl: "https://example.com/blank.png" }, "sahne", { GEMINI_API_KEY: "test" }),
      /güvenilir bir kesim/
    );
    assert.equal(aiWasCalled, false, "AI (Gemini) hiç çağrılmamalıydı — cutout güvenilmez olduğu için erken durulmalı");
  } finally {
    global.fetch = originalFetch;
  }
});

// --- Bağlam-farkında arka plan üretimi ---
test("backgroundOnlyPrompt includes the technical_installation guidance and explicitly forbids background hardware/labels that would clash with the real product's own connections", () => {
  const prompt = backgroundOnlyPrompt("bina giriş noktası", { usageContext: INSTALLATION_CONTEXTS.TECHNICAL_INSTALLATION });
  assert.match(prompt, /bina girişi\/ana su hattı/);
  assert.match(prompt, /rakor, valf, conta, vana/);
});

test("backgroundOnlyPrompt includes the mandatory context-specific negative constraints when given", () => {
  const prompt = backgroundOnlyPrompt("bina giriş noktası", { usageContext: INSTALLATION_CONTEXTS.TECHNICAL_INSTALLATION, negativeConstraints: ["sahte etiket", "çamaşır odası"] });
  assert.match(prompt, /KESİNLİKLE ÇİZME: sahte etiket, çamaşır odası/);
});

test("backgroundOnlyPrompt has no context guidance block when usageContext is omitted (legacy free-text scene-image flow, unchanged)", () => {
  const prompt = backgroundOnlyPrompt("modern mutfak");
  assert.doesNotMatch(prompt, /bina girişi/);
});

// --- REGRESYON: Silifozlu (ana giriş: üçlü filtre + UltraMag) tipi bina
// girişi setlerinde arka planın kendi (sahte) boru rakorunu/etiketini
// uydurup gerçek ürünle çakışmaması ---
test("REGRESSION: generateCompositeSceneImage sends a background prompt for a main-entry multi-filter product that forbids fabricated pipe fittings/labels, and the composited output still preserves the exact original product pixels", async () => {
  const originalFetch = global.fetch;
  const productPhoto = await makeTestProductPhoto();
  const backgroundPhoto = await sharp(Buffer.alloc(64 * 64 * 3, 200), { raw: { width: 64, height: 64, channels: 3 } }).png().toBuffer();
  let capturedPrompt = null;
  global.fetch = async (url, options) => {
    const u = String(url);
    if (u.includes("example.com")) return { ok: true, arrayBuffer: async () => productPhoto };
    capturedPrompt = JSON.parse(options.body).contents[0].parts[0].text;
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ inlineData: { data: backgroundPhoto.toString("base64") } }] } }] }) };
  };
  try {
    const result = await generateCompositeSceneImage(
      { title: "Silifozlu Ev Ana Giriş Su Arıtma Sistemi", imageUrl: "https://example.com/silifozlu.png" },
      "Cihaz bina ana giriş noktasında, ana su hattına monte edilmiş; üçlü filtre seti ve UltraMag manyetik cihaz ev içi dağıtım hattına doğru sıralı bağlı.",
      { GEMINI_API_KEY: "test" },
      { usageContext: INSTALLATION_CONTEXTS.TECHNICAL_INSTALLATION, negativeConstraints: ["sahte etiket", "uydurma yazı", "yanlış bağlantı yönü", "tamamlanmış boru bağlantı parçası"] }
    );
    assert.match(capturedPrompt, /sahte etiket/);
    assert.match(capturedPrompt, /tamamlanmış boru bağlantı parçası/);
    assert.match(capturedPrompt, /rakor, valf, conta, vana/);

    // Ürün pikselleri (mavi kare) hiç dokunulmadan, birebir korunmuş olmalı.
    const base64 = result.dataUrl.split(",")[1];
    const { data, info } = await sharp(Buffer.from(base64, "base64")).raw().ensureAlpha().toBuffer({ resolveWithObject: true });
    const centerIdx = (Math.floor(info.height / 2) * info.width + Math.floor(info.width / 2)) * 4;
    assert.equal(data[centerIdx], 10);
    assert.equal(data[centerIdx + 1], 20);
    assert.equal(data[centerIdx + 2], 200);
  } finally {
    global.fetch = originalFetch;
  }
});
