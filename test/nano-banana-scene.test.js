import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { generateNanoBananaScene } from "../src/nano-banana-scene.js";
import { NANO_BANANA_2_MODEL } from "../src/scene-image.js";

const ENV = { GEMINI_API_KEY: "test-key" };

function mockGeminiFetch({ imageBase64 = "AAAA", validationJson = { failedChecks: [], notes: "" } } = {}) {
  const calls = [];
  return {
    calls,
    fetch: async (url, options) => {
      const u = String(url);
      calls.push(u);
      if (u.includes("example.com")) {
        const tinyPng = await sharp({ create: { width: 4, height: 4, channels: 3, background: { r: 255, g: 255, b: 255 } } }).png().toBuffer();
        return { ok: true, arrayBuffer: async () => tinyPng };
      }
      const body = JSON.parse(options.body);
      // Doğrulama çağrısı (scene-validation.js) responseMimeType:"application/json" kullanır;
      // görsel üretim çağrıları (Nano Banana 2) responseModalities:["IMAGE"] kullanır.
      if (body.generationConfig?.responseMimeType === "application/json") {
        return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(validationJson) }] } }] }) };
      }
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ inlineData: { data: imageBase64 } }] } }] }) };
    }
  };
}

test("generateNanoBananaScene throws and makes NO network call at all when confirmed is not true", async () => {
  const originalFetch = global.fetch;
  let called = false;
  global.fetch = async () => { called = true; throw new Error("should never be called"); };
  try {
    await assert.rejects(
      () => generateNanoBananaScene({ prompt: "mutfak sahnesi", confirmed: false }, ENV),
      /confirmed:true/
    );
    assert.equal(called, false);
  } finally {
    global.fetch = originalFetch;
  }
});

test("generateNanoBananaScene zero-shot (no productId/product) calls Nano Banana 2 with only the text prompt and skips product-identity validation", async () => {
  const originalFetch = global.fetch;
  const mock = mockGeminiFetch();
  global.fetch = mock.fetch;
  try {
    const result = await generateNanoBananaScene({ prompt: "sıfırdan modern bir mutfak sahnesi", aspectRatio: "9:16", confirmed: true }, ENV);
    assert.equal(result.ok, true);
    assert.equal(result.mode, "zero-shot");
    assert.equal(result.model, NANO_BANANA_2_MODEL);
    assert.equal(result.provider, "nano-banana-2");
    assert.equal(result.needsReview, false);
    assert.equal(result.checked, false);
    assert.match(result.reviewNotes, /zero-shot|Ürün referansı verilmediği/);
    // Yalnızca 1 çağrı yapıldı — ürün indirme veya doğrulama çağrısı yok.
    assert.equal(mock.calls.length, 1);
    assert.ok(mock.calls[0].includes(`models/${NANO_BANANA_2_MODEL}:generateContent`));
  } finally {
    global.fetch = originalFetch;
  }
});

test("generateNanoBananaScene product-reference mode reuses the existing scene-validation review system and surfaces needsReview", async () => {
  const originalFetch = global.fetch;
  const mock = mockGeminiFetch({ validationJson: { failedChecks: ["fabricated_signage"], notes: "Duvarda uydurma bir tabela var." } });
  global.fetch = mock.fetch;
  try {
    const product = { title: "Buzsu Ultramag", imageUrl: "https://example.com/photo.png" };
    const result = await generateNanoBananaScene({ product, prompt: "dış cephe montajı", aspectRatio: "9:16", confirmed: true }, ENV);
    assert.equal(result.mode, "product-reference");
    assert.equal(result.model, NANO_BANANA_2_MODEL);
    assert.equal(result.needsReview, true);
    assert.deepEqual(result.failedChecks, ["fabricated_signage"]);
    assert.equal(result.checked, true);
    // Ürün görseli indirme + Nano Banana 2 üretim çağrısı + doğrulama çağrısı.
    assert.ok(mock.calls.some((u) => u.includes(`models/${NANO_BANANA_2_MODEL}:generateContent`)));
    assert.ok(mock.calls.some((u) => u.includes("example.com")));
  } finally {
    global.fetch = originalFetch;
  }
});

test("generateNanoBananaScene never calls a Veo or Omni video endpoint — it is image-only", async () => {
  const originalFetch = global.fetch;
  const mock = mockGeminiFetch();
  global.fetch = mock.fetch;
  try {
    await generateNanoBananaScene({ prompt: "mutfak", confirmed: true }, ENV);
    for (const url of mock.calls) {
      assert.ok(!url.includes("predictLongRunning"), `unexpected Veo call: ${url}`);
      assert.ok(!/interactions/i.test(url), `unexpected Omni call: ${url}`);
    }
  } finally {
    global.fetch = originalFetch;
  }
});

test("generateNanoBananaScene rejects an empty prompt before any network call", async () => {
  const originalFetch = global.fetch;
  let called = false;
  global.fetch = async () => { called = true; };
  try {
    await assert.rejects(() => generateNanoBananaScene({ prompt: "   ", confirmed: true }, ENV));
    assert.equal(called, false);
  } finally {
    global.fetch = originalFetch;
  }
});
