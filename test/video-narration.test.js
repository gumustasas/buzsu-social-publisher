import test from "node:test";
import assert from "node:assert/strict";
import { generateVideoNarration, estimateNarrationDurationSeconds, TURKISH_WORDS_PER_SECOND } from "../src/video-narration.js";

function mockGeminiResponse(payload) {
  return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }] }) };
}

test("generateVideoNarration rejects when GEMINI_API_KEY is missing, before any network call", async () => {
  await assert.rejects(
    () => generateVideoNarration({ scenario: "test", durationSeconds: 8 }, {}),
    /GEMINI_API_KEY/
  );
});

test("generateVideoNarration rejects an empty scenario", async () => {
  await assert.rejects(
    () => generateVideoNarration({ scenario: "  ", durationSeconds: 8 }, { GEMINI_API_KEY: "test" }),
    /scenario/
  );
});

test("generateVideoNarration rejects a non-positive durationSeconds", async () => {
  await assert.rejects(
    () => generateVideoNarration({ scenario: "test", durationSeconds: 0 }, { GEMINI_API_KEY: "test" }),
    /durationSeconds/
  );
});

// Süre-farkındalığı: kısa bir video için hedef kelime sayısı promptta
// açıkça istenmeli — 8sn için 20sn'lik bir metin üretilmemesi gerekir.
test("generateVideoNarration asks the model for a word count matching the video duration (not an arbitrarily long text)", async () => {
  const originalFetch = global.fetch;
  let capturedPromptText = null;
  global.fetch = async (url, options) => {
    capturedPromptText = JSON.parse(options.body).contents[0].parts[0].text;
    return mockGeminiResponse({ narrationText: "Kısa ve öz bir seslendirme metni.", musicBrief: { mood: "sıcak", energy: "orta", tempo: "orta", description: "Warm instrumental." } });
  };
  try {
    await generateVideoNarration({ scenario: "Modern mutfakta su arıtma", durationSeconds: 8 }, { GEMINI_API_KEY: "test" });
    const expectedWordCount = Math.round(8 * TURKISH_WORDS_PER_SECOND);
    assert.match(capturedPromptText, new RegExp(`${expectedWordCount} kelime`));
  } finally {
    global.fetch = originalFetch;
  }
});

test("generateVideoNarration returns narrationText, estimatedDurationSeconds, language tr-TR and musicBrief", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => mockGeminiResponse({
    narrationText: "Buzsu ile temiz su her zaman elinizin altında.",
    musicBrief: { mood: "sıcak aile", energy: "orta", tempo: "orta", description: "Warm premium commercial soundtrack, instrumental, no vocals." }
  });
  try {
    const result = await generateVideoNarration({ scenario: "Modern mutfak", productName: "Code Advantage", durationSeconds: 8 }, { GEMINI_API_KEY: "test" });
    assert.equal(result.narrationText, "Buzsu ile temiz su her zaman elinizin altında.");
    assert.equal(result.language, "tr-TR");
    assert.ok(result.estimatedDurationSeconds > 0);
    assert.equal(result.musicBrief.description, "Warm premium commercial soundtrack, instrumental, no vocals.");
  } finally {
    global.fetch = originalFetch;
  }
});

test("generateVideoNarration rejects when the model returns an empty narrationText", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => mockGeminiResponse({ narrationText: "", musicBrief: {} });
  try {
    await assert.rejects(
      () => generateVideoNarration({ scenario: "test", durationSeconds: 8 }, { GEMINI_API_KEY: "test" }),
      /boş döndü/
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test("generateVideoNarration surfaces a plain error on a non-ok Gemini response (regression guard, no misclassification)", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: false, status: 500, json: async () => ({ error: { message: "boom" } }) });
  try {
    await assert.rejects(
      () => generateVideoNarration({ scenario: "test", durationSeconds: 8 }, { GEMINI_API_KEY: "test" }),
      /boom/
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test("estimateNarrationDurationSeconds divides word count by the Turkish words-per-second constant", () => {
  const text = "bir iki üç dört beş"; // 5 kelime
  assert.equal(estimateNarrationDurationSeconds(text), 5 / TURKISH_WORDS_PER_SECOND);
});
