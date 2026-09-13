import test from "node:test";
import assert from "node:assert/strict";
import { generateTurkishVoiceover, turkishVoiceoverStatus, measureAudioDurationSeconds, TtsApiError, TTS_MODEL, TTS_LANGUAGE_CODE } from "../src/turkish-tts.js";

// WAV başlığı sadece MATEMATİKSEL olarak süre hesabı için kullanılıyor —
// ffmpeg/ffprobe gerekmiyor (bkz. src/turkish-tts.js:measureAudioDurationSeconds).
function buildWavBuffer({ sampleRate = 24000, channels = 1, bitsPerSample = 16, durationSeconds = 2 } = {}) {
  const dataSize = Math.round(sampleRate * channels * (bitsPerSample / 8) * durationSeconds);
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channels * (bitsPerSample / 8), 28);
  buffer.writeUInt16LE(channels * (bitsPerSample / 8), 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataSize, 40);
  return buffer;
}

function mockInteractionsResponse(base64Data, mimeType = "audio/wav") {
  return { ok: true, json: async () => ({ id: "v1_tts_xyz", steps: [{ type: "model_output", content: [{ type: "audio", data: base64Data, mime_type: mimeType }] }] }) };
}

test("measureAudioDurationSeconds computes exact duration from a WAV header (no ffmpeg needed)", () => {
  const wav = buildWavBuffer({ sampleRate: 24000, channels: 1, bitsPerSample: 16, durationSeconds: 3 });
  assert.ok(Math.abs(measureAudioDurationSeconds(wav, "audio/wav") - 3) < 0.01);
});

test("measureAudioDurationSeconds computes duration from raw L16 PCM via the mime_type rate parameter", () => {
  const sampleRate = 24000;
  const durationSeconds = 2.5;
  const buffer = Buffer.alloc(Math.round(sampleRate * 2 * durationSeconds));
  assert.ok(Math.abs(measureAudioDurationSeconds(buffer, `audio/L16;rate=${sampleRate}`) - durationSeconds) < 0.01);
});

test("measureAudioDurationSeconds throws a clear error for an unrecognized format (e.g. compressed mp3) rather than guessing", () => {
  assert.throws(() => measureAudioDurationSeconds(Buffer.from([1, 2, 3]), "audio/mpeg"), /ölçülemedi/);
});

test("generateTurkishVoiceover rejects without confirmed:true, before any network call", async () => {
  const originalFetch = global.fetch;
  let calls = 0;
  global.fetch = async () => { calls++; throw new Error("fetch should not be called without confirmed:true"); };
  try {
    await assert.rejects(
      () => generateTurkishVoiceover({ text: "test", confirmed: false }, { GEMINI_API_KEY: "test" }),
      /confirmed:true/
    );
    assert.equal(calls, 0);
  } finally {
    global.fetch = originalFetch;
  }
});

test("generateTurkishVoiceover rejects when GEMINI_API_KEY is missing", async () => {
  await assert.rejects(
    () => generateTurkishVoiceover({ text: "test", confirmed: true }, {}),
    /GEMINI_API_KEY/
  );
});

test("generateTurkishVoiceover rejects an empty text", async () => {
  await assert.rejects(
    () => generateTurkishVoiceover({ text: "   ", confirmed: true }, { GEMINI_API_KEY: "test" }),
    /text/
  );
});

test("generateTurkishVoiceover always requests the fixed model and language_code tr-TR", async () => {
  const originalFetch = global.fetch;
  let capturedBody = null;
  const wav = buildWavBuffer({ durationSeconds: 1 });
  global.fetch = async (url, options) => {
    capturedBody = JSON.parse(options.body);
    return mockInteractionsResponse(wav.toString("base64"));
  };
  try {
    await generateTurkishVoiceover({ text: "Merhaba", confirmed: true }, { GEMINI_API_KEY: "test" });
    assert.equal(capturedBody.model, TTS_MODEL);
    assert.equal(capturedBody.response_format.language_code, TTS_LANGUAGE_CODE);
  } finally {
    global.fetch = originalFetch;
  }
});

test("generateTurkishVoiceover maps gender to a default voice name, and an explicit voice overrides it", async () => {
  const originalFetch = global.fetch;
  let capturedBody = null;
  const wav = buildWavBuffer({ durationSeconds: 1 });
  global.fetch = async (url, options) => { capturedBody = JSON.parse(options.body); return mockInteractionsResponse(wav.toString("base64")); };
  try {
    await generateTurkishVoiceover({ text: "Merhaba", gender: "male", confirmed: true }, { GEMINI_API_KEY: "test" });
    const maleVoice = capturedBody.response_format.voice_name;
    await generateTurkishVoiceover({ text: "Merhaba", voice: "CustomVoice", gender: "male", confirmed: true }, { GEMINI_API_KEY: "test" });
    assert.equal(capturedBody.response_format.voice_name, "CustomVoice");
    assert.ok(maleVoice && maleVoice !== "CustomVoice");
  } finally {
    global.fetch = originalFetch;
  }
});

test("generateTurkishVoiceover returns COMPLETED with a measured durationSeconds from the actual audio", async () => {
  const originalFetch = global.fetch;
  const wav = buildWavBuffer({ durationSeconds: 4 });
  global.fetch = async () => mockInteractionsResponse(wav.toString("base64"));
  try {
    const result = await generateTurkishVoiceover({ text: "Merhaba dünya", confirmed: true }, { GEMINI_API_KEY: "test" });
    assert.equal(result.status, "COMPLETED");
    assert.ok(Math.abs(result.durationSeconds - 4) < 0.01);
    assert.equal(result.language, "tr-TR");
  } finally {
    global.fetch = originalFetch;
  }
});

// Süre uyumu / senkronizasyon: gerçek ses hedef süreyi önemli ölçüde
// aşarsa (burada %15 eşiği), otomatik hızlandırma YAPILMAZ — açık bir
// hata (VOICEOVER_TOO_LONG) fırlatılır.
test("generateTurkishVoiceover throws VOICEOVER_TOO_LONG when the real measured duration exceeds targetDurationSeconds by more than 15%, without any auto-speedup", async () => {
  const originalFetch = global.fetch;
  const wav = buildWavBuffer({ durationSeconds: 12 }); // hedef 8sn'nin çok üzerinde
  global.fetch = async () => mockInteractionsResponse(wav.toString("base64"));
  try {
    const error = await generateTurkishVoiceover({ text: "çok uzun bir metin", targetDurationSeconds: 8, confirmed: true }, { GEMINI_API_KEY: "test" }).catch((e) => e);
    assert.equal(error.code, "VOICEOVER_TOO_LONG");
    assert.ok(Math.abs(error.durationSeconds - 12) < 0.01);
    assert.equal(error.targetDurationSeconds, 8);
  } finally {
    global.fetch = originalFetch;
  }
});

test("generateTurkishVoiceover does not throw VOICEOVER_TOO_LONG when within the 15% tolerance", async () => {
  const originalFetch = global.fetch;
  const wav = buildWavBuffer({ durationSeconds: 8.5 }); // hedef 8sn, %15 tolerans (9.2sn) içinde
  global.fetch = async () => mockInteractionsResponse(wav.toString("base64"));
  try {
    const result = await generateTurkishVoiceover({ text: "kısa metin", targetDurationSeconds: 8, confirmed: true }, { GEMINI_API_KEY: "test" });
    assert.equal(result.status, "COMPLETED");
  } finally {
    global.fetch = originalFetch;
  }
});

test("generateTurkishVoiceover classifies HTTP 429 as TtsApiError with code RATE_LIMITED", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: false, status: 429, headers: { get: () => null }, json: async () => ({ error: { status: "RESOURCE_EXHAUSTED", message: "quota" } }) });
  try {
    const error = await generateTurkishVoiceover({ text: "test", confirmed: true }, { GEMINI_API_KEY: "test" }).catch((e) => e);
    assert.ok(error instanceof TtsApiError);
    assert.equal(error.code, "RATE_LIMITED");
  } finally {
    global.fetch = originalFetch;
  }
});

// Kullanıcı doğrulaması: Türkçe desteklenmiyorsa başka bir dile ASLA
// otomatik geçilmez — açık bir TURKISH_TTS_UNAVAILABLE hatası fırlatılır.
test("generateTurkishVoiceover classifies a language-unsupported response as TtsApiError with code TURKISH_TTS_UNAVAILABLE, never falling back to another language", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: false, status: 400, headers: { get: () => null }, json: async () => ({ error: { status: "INVALID_ARGUMENT", message: "The requested language tr-TR is not supported by this voice." } }) });
  try {
    const error = await generateTurkishVoiceover({ text: "test", confirmed: true }, { GEMINI_API_KEY: "test" }).catch((e) => e);
    assert.ok(error instanceof TtsApiError);
    assert.equal(error.code, "TURKISH_TTS_UNAVAILABLE");
  } finally {
    global.fetch = originalFetch;
  }
});

test("generateTurkishVoiceover: a 400 unrelated to language stays a plain Error, not misclassified (regression guard)", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: false, status: 400, headers: { get: () => null }, json: async () => ({ error: { status: "INVALID_ARGUMENT", message: "Text is too long." } }) });
  try {
    const error = await generateTurkishVoiceover({ text: "test", confirmed: true }, { GEMINI_API_KEY: "test" }).catch((e) => e);
    assert.equal(error.code, undefined);
    assert.equal(error.message, "Text is too long.");
  } finally {
    global.fetch = originalFetch;
  }
});

test("generateTurkishVoiceover returns IN_PROGRESS (not COMPLETED) when no model_output step exists yet", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: true, json: async () => ({ id: "v1_tts_xyz", steps: [{ type: "thought" }] }) });
  try {
    const result = await generateTurkishVoiceover({ text: "test", confirmed: true }, { GEMINI_API_KEY: "test" });
    assert.equal(result.status, "IN_PROGRESS");
    assert.equal(result.interactionId, "v1_tts_xyz");
  } finally {
    global.fetch = originalFetch;
  }
});

test("turkishVoiceoverStatus polls GET /interactions/{id} and returns COMPLETED with a measured duration once ready", async () => {
  const originalFetch = global.fetch;
  let requestedUrl = null;
  const wav = buildWavBuffer({ durationSeconds: 2 });
  global.fetch = async (url) => { requestedUrl = String(url); return mockInteractionsResponse(wav.toString("base64")); };
  try {
    const result = await turkishVoiceoverStatus({ interactionId: "v1_tts_xyz", model: TTS_MODEL }, { GEMINI_API_KEY: "test" });
    assert.equal(requestedUrl, "https://generativelanguage.googleapis.com/v1beta/interactions/v1_tts_xyz");
    assert.equal(result.status, "COMPLETED");
    assert.ok(Math.abs(result.durationSeconds - 2) < 0.01);
  } finally {
    global.fetch = originalFetch;
  }
});

test("turkishVoiceoverStatus rejects when job has no interactionId", async () => {
  await assert.rejects(() => turkishVoiceoverStatus({}, { GEMINI_API_KEY: "test" }), /iş bilgisi eksik/);
});
