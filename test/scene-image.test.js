import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { floodFillBackgroundMask, sceneEditPrompt, geminiScenePrompt, applyRemoveBox, availableSceneProviders, generateSceneImage, NANO_BANANA_2_MODEL, NANO_BANANA_PRO_MODEL, IMAGE_QUALITY_TIERS, IMAGE_TIER_PROVIDERS, isNanoBananaProDiscoverable, callGeminiTextToImage } from "../src/scene-image.js";

test("floodFillBackgroundMask marks border-connected near-white pixels as background", () => {
  const width = 4, height = 4, channels = 3;
  const raw = new Uint8Array(width * height * channels).fill(255);
  for (const [x, y] of [[1, 1], [2, 1], [1, 2], [2, 2]]) {
    const idx = (y * width + x) * channels;
    raw[idx] = 0; raw[idx + 1] = 0; raw[idx + 2] = 0;
  }

  const isBackground = floodFillBackgroundMask(raw, { width, height, channels });

  assert.equal(isBackground[0], 1);
  assert.equal(isBackground[width - 1], 1);
  assert.equal(isBackground[(1 * width) + 1], 0);
  assert.equal(isBackground[(2 * width) + 2], 0);
});

test("floodFillBackgroundMask keeps an enclosed near-white pocket inside the product as product, not background", () => {
  const width = 5, height = 5, channels = 3;
  const raw = new Uint8Array(width * height * channels).fill(255);
  for (let y = 1; y <= 3; y++) {
    for (let x = 1; x <= 3; x++) {
      const idx = (y * width + x) * channels;
      raw[idx] = 0; raw[idx + 1] = 0; raw[idx + 2] = 0;
    }
  }
  const center = (2 * width + 2) * channels;
  raw[center] = 255; raw[center + 1] = 255; raw[center + 2] = 255;

  const isBackground = floodFillBackgroundMask(raw, { width, height, channels });

  assert.equal(isBackground[0], 1);
  assert.equal(isBackground[2 * width + 2], 0);
});

test("sceneEditPrompt embeds the scene description and the preservation instruction", () => {
  const prompt = sceneEditPrompt("modern mutfak, sabah ışığı");
  assert.match(prompt, /modern mutfak, sabah ışığı/);
  assert.match(prompt, /hiç değiştirme/);
});

test("sceneEditPrompt instructs the product to look physically installed, not floating or detached from a pipe", () => {
  const prompt = sceneEditPrompt("mutfak");
  assert.match(prompt, /boru hattının kendisinin bir parçası gibi göster|borunun kendisinin bir parçası gibi göster/);
  assert.match(prompt, /havada asılı veya bağlantısız durmamalı/);
});

test("sceneEditPrompt instructs the AI to keep the product's thickness/proportions identical to the reference photo", () => {
  const prompt = sceneEditPrompt("teknik oda");
  assert.match(prompt, /kalınlığını, çapını ve boyunu referans görseldeki orijinal orantılarıyla BİREBİR aynı tut/);
  assert.match(prompt, /daha kalın, daha ince/);
});

test("sceneEditPrompt falls back to a default scene when empty", () => {
  const prompt = sceneEditPrompt("   ");
  assert.match(prompt, /mutfak/);
});

test("sceneEditPrompt forbids a faucet attached to the device but allows one elsewhere in the scene when removeFaucet is set", () => {
  const withoutRemoval = sceneEditPrompt("mutfak", { removeFaucet: false });
  const withRemoval = sceneEditPrompt("tezgah üstünde ayrı bir musluk", { removeFaucet: true });
  assert.doesNotMatch(withoutRemoval, /bitişik yeni bir musluk/);
  assert.match(withRemoval, /cihazın hemen yanına veya üzerine bitişik yeni bir musluk ekleme/);
  assert.match(withRemoval, /Sahne açıklaması ayrı bir yerde/);
});

test("geminiScenePrompt embeds the scene description and a strong preservation instruction, without mask wording", () => {
  const prompt = geminiScenePrompt("modern mutfak, sabah ışığı");
  assert.match(prompt, /modern mutfak, sabah ışığı/);
  assert.match(prompt, /birebir koru/);
  assert.doesNotMatch(prompt, /maskelenmemiş/);
});

test("geminiScenePrompt treats multiple references as one product gallery and preserves all real components", () => {
  const prompt = geminiScenePrompt("bina girişi teknik odası", { referenceCount: 4 });
  assert.match(prompt, /aynı gerçek ürünün farklı açıları/);
  assert.match(prompt, /filtre gövdeleri ve varsa Ultramag/);
});

test("geminiScenePrompt instructs the product to look physically installed, not floating or detached from a pipe", () => {
  const prompt = geminiScenePrompt("teknik oda, boru hattı");
  assert.match(prompt, /borunun kendisinin bir parçası gibi göster/);
  assert.match(prompt, /havada asılı veya bağlantısız durmamalı/);
});

test("geminiScenePrompt instructs the AI to keep the product's thickness/proportions identical to the reference photo", () => {
  const prompt = geminiScenePrompt("teknik oda, boru hattı");
  assert.match(prompt, /kalınlığını, çapını ve boyunu referans görseldeki orijinal orantılarıyla BİREBİR aynı tut/);
  assert.match(prompt, /boru çapına kıyasla cihazın gövde çapı/);
});

test("geminiScenePrompt forbids a faucet attached to the device but allows one elsewhere in the scene when removeFaucet is set", () => {
  const withRemoval = geminiScenePrompt("tezgah üstünde ayrı bir musluk", { removeFaucet: true });
  assert.match(withRemoval, /Musluğu cihazın gövdesinden kaldır/);
  assert.match(withRemoval, /Sahne açıklaması ayrı bir yerde/);
});

test("sceneEditPrompt forbids water flowing from the device itself and visible hoses on box-shaped purifiers", () => {
  const prompt = sceneEditPrompt("mutfak");
  assert.match(prompt, /cihaz bir musluk veya çeşme DEĞİLDİR/);
  assert.match(prompt, /GÖRÜNÜR hortum, boru, tesisat bağlantısı/);
});

test("geminiScenePrompt forbids water flowing from the device itself and visible hoses on box-shaped purifiers", () => {
  const prompt = geminiScenePrompt("mutfak");
  assert.match(prompt, /cihaz bir musluk veya çeşme DEĞİLDİR/);
  assert.match(prompt, /GÖRÜNÜR hortum, boru, tesisat bağlantısı/);
});

test("sceneEditPrompt forbids fabricated signage/plaques with made-up text on scene walls", () => {
  const prompt = sceneEditPrompt("villa dış cephesi");
  assert.match(prompt, /gerçek olmayan, üzerinde yazı\/marka adı bulunan pleksi, metal veya plastik bir tabela/);
});

test("geminiScenePrompt forbids fabricated signage/plaques with made-up text on scene walls", () => {
  const prompt = geminiScenePrompt("villa dış cephesi");
  assert.match(prompt, /gerçek olmayan, üzerinde yazı\/marka adı bulunan pleksi, metal veya plastik bir tabela/);
});

test("availableSceneProviders lists gemini, nano-banana-2, nano-banana-pro, openai, openai-low, openai-high, then the experimental composite variant, only when keys are present", () => {
  assert.deepEqual(availableSceneProviders({ GEMINI_API_KEY: "g", OPENAI_API_KEY: "o" }), ["gemini", "nano-banana-2", "nano-banana-pro", "openai", "openai-low", "openai-high", "composite"]);
  assert.deepEqual(availableSceneProviders({ OPENAI_API_KEY: "o" }), ["openai", "openai-low", "openai-high"]);
  assert.deepEqual(availableSceneProviders({}), []);
});

test("generateSceneImage provider 'nano-banana-2' calls the Nano Banana 2 model (gemini-3.1-flash-image), distinct from the default 'gemini' (Nano Banana 2 Lite)", async () => {
  const originalFetch = global.fetch;
  let calledUrls = [];
  const tinyPng = await sharp({ create: { width: 4, height: 4, channels: 3, background: { r: 255, g: 255, b: 255 } } }).png().toBuffer();
  global.fetch = async (url) => {
    const u = String(url);
    if (u.includes("example.com")) return { ok: true, arrayBuffer: async () => tinyPng };
    if (u.includes("generativelanguage.googleapis.com")) {
      calledUrls.push(u);
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ inlineData: { data: "AAAA" } }] } }] }) };
    }
    throw new Error(`unexpected fetch: ${u}`);
  };
  try {
    const nanoBananaResult = await generateSceneImage(
      { title: "Test Ürün", imageUrl: "https://example.com/photo.png" },
      "mutfak",
      { GEMINI_API_KEY: "key" },
      { provider: "nano-banana-2" }
    );
    assert.equal(nanoBananaResult.model, NANO_BANANA_2_MODEL);
    assert.ok(calledUrls[0].includes(`models/${NANO_BANANA_2_MODEL}:generateContent`));

    calledUrls = [];
    const liteResult = await generateSceneImage(
      { title: "Test Ürün", imageUrl: "https://example.com/photo.png" },
      "mutfak",
      { GEMINI_API_KEY: "key" },
      { provider: "gemini" }
    );
    assert.equal(liteResult.model, "gemini-3.1-flash-lite-image");
    assert.ok(calledUrls[0].includes("models/gemini-3.1-flash-lite-image:generateContent"));
    assert.notEqual(liteResult.model, NANO_BANANA_2_MODEL);
  } finally {
    global.fetch = originalFetch;
  }
});

test("generateSceneImage provider 'nano-banana-2' honors an explicit GEMINI_NANO_BANANA_2_MODEL override without falling back silently", async () => {
  const originalFetch = global.fetch;
  let calledUrl = null;
  const tinyPng = await sharp({ create: { width: 4, height: 4, channels: 3, background: { r: 255, g: 255, b: 255 } } }).png().toBuffer();
  global.fetch = async (url) => {
    const u = String(url);
    if (u.includes("example.com")) return { ok: true, arrayBuffer: async () => tinyPng };
    calledUrl = u;
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ inlineData: { data: "AAAA" } }] } }] }) };
  };
  try {
    const result = await generateSceneImage(
      { title: "Test Ürün", imageUrl: "https://example.com/photo.png" },
      "mutfak",
      { GEMINI_API_KEY: "key", GEMINI_NANO_BANANA_2_MODEL: "gemini-custom-override" },
      { provider: "nano-banana-2" }
    );
    assert.equal(result.model, "gemini-custom-override");
    assert.ok(calledUrl.includes("models/gemini-custom-override:generateContent"));
  } finally {
    global.fetch = originalFetch;
  }
});

test("callGeminiTextToImage (zero-shot, no product) calls Nano Banana 2 with only the text prompt, no base image", async () => {
  const originalFetch = global.fetch;
  let capturedBody = null;
  global.fetch = async (url, options) => {
    capturedBody = JSON.parse(options.body);
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ inlineData: { data: "AAAA" } }] } }] }) };
  };
  try {
    const result = await callGeminiTextToImage({ prompt: "sıfırdan bir mutfak sahnesi", aspectRatio: "9:16" }, { GEMINI_API_KEY: "key" });
    assert.equal(result.model, NANO_BANANA_2_MODEL);
    assert.equal(result.imageBase64, "AAAA");
    assert.equal(capturedBody.contents[0].parts.length, 1);
    assert.equal(capturedBody.contents[0].parts[0].text, "sıfırdan bir mutfak sahnesi");
    assert.equal(capturedBody.generationConfig.imageConfig.aspectRatio, "9:16");
  } finally {
    global.fetch = originalFetch;
  }
});

test("availableSceneProviders offers openai/openai-low/openai-high from a standalone OPENAI_IMAGE_API_KEY even without OPENAI_API_KEY", () => {
  assert.deepEqual(availableSceneProviders({ OPENAI_IMAGE_API_KEY: "img" }), ["openai", "openai-low", "openai-high"]);
});

test("generateSceneImage sends the standalone OPENAI_IMAGE_API_KEY (not the text OPENAI_API_KEY) for provider 'openai' when both are set", async () => {
  const originalFetch = global.fetch;
  let calledAuth = null;
  const tinyPng = await sharp({ create: { width: 4, height: 4, channels: 3, background: { r: 255, g: 255, b: 255 } } }).png().toBuffer();
  global.fetch = async (url, options) => {
    const u = String(url);
    if (u.includes("example.com")) return { ok: true, arrayBuffer: async () => tinyPng };
    if (u.includes("api.openai.com")) {
      calledAuth = options.headers.Authorization;
      return { ok: true, json: async () => ({ data: [{ b64_json: "AAAA" }] }) };
    }
    throw new Error(`unexpected fetch: ${u}`);
  };
  try {
    await generateSceneImage(
      { title: "Test Ürün", imageUrl: "https://example.com/photo.png" },
      "mutfak",
      { OPENAI_API_KEY: "text-key", OPENAI_IMAGE_API_KEY: "image-key" },
      { provider: "openai" }
    );
    assert.equal(calledAuth, "Bearer image-key");
  } finally {
    global.fetch = originalFetch;
  }
});

test("generateSceneImage sends quality 'low' for provider 'openai-low' but omits quality entirely for plain 'openai' (keeps current default quality/cost)", async () => {
  const originalFetch = global.fetch;
  let capturedFormHasQuality = null, capturedQualityValue = null;
  const tinyPng = await sharp({ create: { width: 4, height: 4, channels: 3, background: { r: 255, g: 255, b: 255 } } }).png().toBuffer();
  global.fetch = async (url, options) => {
    const u = String(url);
    if (u.includes("example.com")) return { ok: true, arrayBuffer: async () => tinyPng };
    if (u.includes("api.openai.com")) {
      capturedFormHasQuality = options.body.has("quality");
      capturedQualityValue = options.body.get("quality");
      return { ok: true, json: async () => ({ data: [{ b64_json: "AAAA" }] }) };
    }
    throw new Error(`unexpected fetch: ${u}`);
  };
  try {
    await generateSceneImage({ title: "Test Ürün", imageUrl: "https://example.com/photo.png" }, "mutfak", { OPENAI_API_KEY: "key" }, { provider: "openai-low" });
    assert.equal(capturedFormHasQuality, true);
    assert.equal(capturedQualityValue, "low");

    await generateSceneImage({ title: "Test Ürün", imageUrl: "https://example.com/photo.png" }, "mutfak", { OPENAI_API_KEY: "key" }, { provider: "openai" });
    assert.equal(capturedFormHasQuality, false);
  } finally {
    global.fetch = originalFetch;
  }
});

// TASK-003: economy/balanced/quality tier mapping is explicit and documented.
test("IMAGE_QUALITY_TIERS/IMAGE_TIER_PROVIDERS map economy/balanced/quality to the exact same provider strings generateSceneImage already supports", () => {
  assert.deepEqual(IMAGE_QUALITY_TIERS, ["economy", "balanced", "quality"]);
  assert.deepEqual(IMAGE_TIER_PROVIDERS.google, { economy: "gemini", balanced: "nano-banana-2", quality: "nano-banana-pro" });
  assert.deepEqual(IMAGE_TIER_PROVIDERS.openai, { economy: "openai-low", balanced: "openai", quality: "openai-high" });
});

test("isNanoBananaProDiscoverable: GEMINI_API_KEY yoksa hiçbir fetch atmadan false döner", async () => {
  let called = false;
  const originalFetch = global.fetch;
  global.fetch = async () => { called = true; throw new Error("çağrılmamalıydı"); };
  try {
    assert.equal(await isNanoBananaProDiscoverable(NANO_BANANA_PRO_MODEL, {}), false);
    assert.equal(called, false);
  } finally {
    global.fetch = originalFetch;
  }
});

test("isNanoBananaProDiscoverable: discovery gerçekten çalışıp modeli listelemiyorsa false döner (SESSİZCE 'var' denmez)", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: true, json: async () => ({ models: [{ name: "models/gemini-3.1-flash-image" }] }) });
  try {
    assert.equal(await isNanoBananaProDiscoverable(NANO_BANANA_PRO_MODEL, { GEMINI_API_KEY: "key" }), false);
  } finally {
    global.fetch = originalFetch;
  }
});

test("isNanoBananaProDiscoverable: discovery modeli listeliyorsa true döner", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: true, json: async () => ({ models: [{ name: `models/${NANO_BANANA_PRO_MODEL}` }] }) });
  try {
    assert.equal(await isNanoBananaProDiscoverable(NANO_BANANA_PRO_MODEL, { GEMINI_API_KEY: "key" }), true);
  } finally {
    global.fetch = originalFetch;
  }
});

test("isNanoBananaProDiscoverable: discovery isteği başarısız/erişilemezse (ör. ağ kısıtlı ortam) SESSİZCE false DENMEZ, anahtar varlığına düşülür (true)", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => { throw new Error("network unreachable"); };
  try {
    assert.equal(await isNanoBananaProDiscoverable(NANO_BANANA_PRO_MODEL, { GEMINI_API_KEY: "key" }), true);
  } finally {
    global.fetch = originalFetch;
  }
});

test("generateSceneImage provider 'nano-banana-pro' discovery'de bulunamazsa ürün görseli hiç indirilmeden/mask oluşturulmadan açık bir hata fırlatır (Nano Banana 2'ye SESSİZCE düşülmez)", async () => {
  const originalFetch = global.fetch;
  let productImageFetched = false;
  global.fetch = async (url) => {
    const u = String(url);
    if (u.includes("example.com")) { productImageFetched = true; throw new Error("çağrılmamalıydı"); }
    if (u.includes("generativelanguage.googleapis.com/v1beta/models") && !u.includes("generateContent")) {
      return { ok: true, json: async () => ({ models: [{ name: "models/gemini-3.1-flash-image" }] }) }; // Pro discovery'de YOK
    }
    throw new Error(`unexpected fetch: ${u}`);
  };
  try {
    await assert.rejects(
      () => generateSceneImage({ title: "Test Ürün", imageUrl: "https://example.com/photo.png" }, "mutfak", { GEMINI_API_KEY: "key" }, { provider: "nano-banana-pro" }),
      /Nano Banana Pro.*bulunamadı/
    );
    assert.equal(productImageFetched, false);
  } finally {
    global.fetch = originalFetch;
  }
});

test("generateSceneImage provider 'nano-banana-pro' discovery'de bulunursa gemini-3-pro-image modelini çağırır", async () => {
  const originalFetch = global.fetch;
  let calledUrls = [];
  const tinyPng = await sharp({ create: { width: 4, height: 4, channels: 3, background: { r: 255, g: 255, b: 255 } } }).png().toBuffer();
  global.fetch = async (url) => {
    const u = String(url);
    if (u.includes("example.com")) return { ok: true, arrayBuffer: async () => tinyPng };
    if (u.includes("generativelanguage.googleapis.com/v1beta/models") && !u.includes("generateContent")) {
      return { ok: true, json: async () => ({ models: [{ name: `models/${NANO_BANANA_PRO_MODEL}` }] }) };
    }
    if (u.includes("generateContent")) {
      calledUrls.push(u);
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ inlineData: { data: "AAAA" } }] } }] }) };
    }
    throw new Error(`unexpected fetch: ${u}`);
  };
  try {
    const result = await generateSceneImage(
      { title: "Test Ürün", imageUrl: "https://example.com/photo.png" },
      "mutfak",
      { GEMINI_API_KEY: "key" },
      { provider: "nano-banana-pro" }
    );
    assert.equal(result.model, NANO_BANANA_PRO_MODEL);
    assert.ok(calledUrls[0].includes(`models/${NANO_BANANA_PRO_MODEL}:generateContent`));
  } finally {
    global.fetch = originalFetch;
  }
});

test("generateSceneImage sends quality 'high' for provider 'openai-high', distinct from 'low'/plain 'openai'", async () => {
  const originalFetch = global.fetch;
  let capturedQualityValue = null;
  const tinyPng = await sharp({ create: { width: 4, height: 4, channels: 3, background: { r: 255, g: 255, b: 255 } } }).png().toBuffer();
  global.fetch = async (url, options) => {
    const u = String(url);
    if (u.includes("example.com")) return { ok: true, arrayBuffer: async () => tinyPng };
    if (u.includes("api.openai.com")) {
      capturedQualityValue = options.body.get("quality");
      return { ok: true, json: async () => ({ data: [{ b64_json: "AAAA" }] }) };
    }
    throw new Error(`unexpected fetch: ${u}`);
  };
  try {
    await generateSceneImage({ title: "Test Ürün", imageUrl: "https://example.com/photo.png" }, "mutfak", { OPENAI_API_KEY: "key" }, { provider: "openai-high" });
    assert.equal(capturedQualityValue, "high");
  } finally {
    global.fetch = originalFetch;
  }
});

test("applyRemoveBox marks only the pixels inside the given box as background, leaving pixels outside untouched", () => {
  const width = 6, height = 6;
  const isBackground = new Uint8Array(width * height);
  isBackground[0] = 1; // pre-existing background pixel outside the box, must stay 1
  applyRemoveBox(isBackground, { width, height }, { left: 2, top: 2, width: 2, height: 2 });

  assert.equal(isBackground[0], 1);
  assert.equal(isBackground[2 * width + 2], 1);
  assert.equal(isBackground[3 * width + 3], 1);
  assert.equal(isBackground[1 * width + 1], 0);
  assert.equal(isBackground[4 * width + 4], 0);
});
