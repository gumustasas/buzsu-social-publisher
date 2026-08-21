import test from "node:test";
import assert from "node:assert/strict";
import { floodFillBackgroundMask, sceneEditPrompt, geminiScenePrompt, applyRemoveBox, availableSceneProviders } from "../src/scene-image.js";

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

test("geminiScenePrompt forbids a faucet attached to the device but allows one elsewhere in the scene when removeFaucet is set", () => {
  const withRemoval = geminiScenePrompt("tezgah üstünde ayrı bir musluk", { removeFaucet: true });
  assert.match(withRemoval, /Musluğu cihazın gövdesinden kaldır/);
  assert.match(withRemoval, /Sahne açıklaması ayrı bir yerde/);
});

test("availableSceneProviders lists gemini before openai and only when keys are present", () => {
  assert.deepEqual(availableSceneProviders({ GEMINI_API_KEY: "g", OPENAI_API_KEY: "o" }), ["gemini", "openai"]);
  assert.deepEqual(availableSceneProviders({ OPENAI_API_KEY: "o" }), ["openai"]);
  assert.deepEqual(availableSceneProviders({}), []);
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
