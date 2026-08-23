import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { floodFillBackgroundMask, sceneEditPrompt, geminiScenePrompt, applyRemoveBox, availableSceneProviders, generateSceneImage } from "../src/scene-image.js";

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

test("availableSceneProviders lists gemini, the free gemini-2.5-flash option, then openai, only when keys are present", () => {
  assert.deepEqual(availableSceneProviders({ GEMINI_API_KEY: "g", OPENAI_API_KEY: "o" }), ["gemini", "gemini-2.5-flash", "openai"]);
  assert.deepEqual(availableSceneProviders({ GEMINI_API_KEY: "g" }), ["gemini", "gemini-2.5-flash"]);
  assert.deepEqual(availableSceneProviders({ OPENAI_API_KEY: "o" }), ["openai"]);
  assert.deepEqual(availableSceneProviders({}), []);
});

test("availableSceneProviders offers gemini-2.5-flash from a standalone GEMINI_FREE_API_KEY even without the paid GEMINI_API_KEY", () => {
  assert.deepEqual(availableSceneProviders({ GEMINI_FREE_API_KEY: "free" }), ["gemini-2.5-flash"]);
});

test("generateSceneImage pins provider 'gemini-2.5-flash' to the free gemini-2.5-flash-image model, regardless of GEMINI_SCENE_MODEL", async () => {
  const originalFetch = global.fetch;
  let calledModel = null;
  const tinyPng = await sharp({ create: { width: 4, height: 4, channels: 3, background: { r: 255, g: 255, b: 255 } } }).png().toBuffer();
  global.fetch = async (url) => {
    const u = String(url);
    if (u.includes("example.com")) return { ok: true, arrayBuffer: async () => tinyPng };
    if (u.includes("generativelanguage.googleapis.com")) {
      calledModel = u.match(/models\/([^:]+):/)[1];
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ inlineData: { data: "AAAA" } }] } }] }) };
    }
    throw new Error(`unexpected fetch: ${u}`);
  };
  try {
    const result = await generateSceneImage(
      { title: "Test Ürün", imageUrl: "https://example.com/photo.png" },
      "mutfak",
      { GEMINI_API_KEY: "test", GEMINI_SCENE_MODEL: "some-other-paid-model" },
      { provider: "gemini-2.5-flash" }
    );
    assert.equal(calledModel, "gemini-2.5-flash-image");
    assert.equal(result.model, "gemini-2.5-flash-image");
  } finally {
    global.fetch = originalFetch;
  }
});

test("generateSceneImage sends the standalone GEMINI_FREE_API_KEY (not the paid GEMINI_API_KEY) for provider 'gemini-2.5-flash' when both are set", async () => {
  const originalFetch = global.fetch;
  let calledApiKey = null;
  const tinyPng = await sharp({ create: { width: 4, height: 4, channels: 3, background: { r: 255, g: 255, b: 255 } } }).png().toBuffer();
  global.fetch = async (url, options) => {
    const u = String(url);
    if (u.includes("example.com")) return { ok: true, arrayBuffer: async () => tinyPng };
    if (u.includes("generativelanguage.googleapis.com")) {
      calledApiKey = options.headers["x-goog-api-key"];
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ inlineData: { data: "AAAA" } }] } }] }) };
    }
    throw new Error(`unexpected fetch: ${u}`);
  };
  try {
    await generateSceneImage(
      { title: "Test Ürün", imageUrl: "https://example.com/photo.png" },
      "mutfak",
      { GEMINI_API_KEY: "paid-key", GEMINI_FREE_API_KEY: "free-key" },
      { provider: "gemini-2.5-flash" }
    );
    assert.equal(calledApiKey, "free-key");
  } finally {
    global.fetch = originalFetch;
  }
});

test("generateSceneImage keeps provider 'gemini' on the paid GEMINI_API_KEY even when a separate GEMINI_FREE_API_KEY is set", async () => {
  const originalFetch = global.fetch;
  let calledApiKey = null;
  const tinyPng = await sharp({ create: { width: 4, height: 4, channels: 3, background: { r: 255, g: 255, b: 255 } } }).png().toBuffer();
  global.fetch = async (url, options) => {
    const u = String(url);
    if (u.includes("example.com")) return { ok: true, arrayBuffer: async () => tinyPng };
    if (u.includes("generativelanguage.googleapis.com")) {
      calledApiKey = options.headers["x-goog-api-key"];
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ inlineData: { data: "AAAA" } }] } }] }) };
    }
    throw new Error(`unexpected fetch: ${u}`);
  };
  try {
    await generateSceneImage(
      { title: "Test Ürün", imageUrl: "https://example.com/photo.png" },
      "mutfak",
      { GEMINI_API_KEY: "paid-key", GEMINI_FREE_API_KEY: "free-key" },
      { provider: "gemini" }
    );
    assert.equal(calledApiKey, "paid-key");
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
