import test from "node:test";
import assert from "node:assert/strict";
import { ensurePlayableWav, generateTurkishVoiceover, measureAudioDurationSeconds } from "../src/turkish-tts.js";

test("ensurePlayableWav wraps raw Gemini PCM in a browser-playable WAV container without swapping bytes", () => {
  // Two 16-bit little-endian samples already in Gemini's PCM byte order.
  const raw = Buffer.from([0x34, 0x12, 0xdc, 0xfe]);
  const result = ensurePlayableWav(raw, "audio/L16;rate=24000");

  assert.equal(result.mimeType, "audio/wav");
  assert.equal(result.audioBuffer.toString("ascii", 0, 4), "RIFF");
  assert.equal(result.audioBuffer.toString("ascii", 8, 12), "WAVE");
  assert.equal(result.audioBuffer.readUInt32LE(24), 24000);
  assert.equal(result.audioBuffer.readUInt16LE(22), 1);
  assert.equal(result.audioBuffer.readUInt16LE(34), 16);
  assert.equal(result.audioBuffer.readUInt32LE(40), raw.length);
  assert.deepEqual([...result.audioBuffer.subarray(44)], [...raw]);
});

test("ensurePlayableWav leaves an existing WAV payload intact", () => {
  const wav = Buffer.alloc(44);
  wav.write("RIFF", 0, "ascii");
  wav.write("WAVE", 8, "ascii");
  const result = ensurePlayableWav(wav, "audio/wav");
  assert.equal(result.mimeType, "audio/wav");
  assert.strictEqual(result.audioBuffer, wav);
});

test("generateTurkishVoiceover normalizes raw Gemini PCM output to WAV before returning it", async () => {
  const originalFetch = global.fetch;
  const sampleRate = 24000;
  const durationSeconds = 1;
  const raw = Buffer.alloc(sampleRate * 2 * durationSeconds);

  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      id: "v1_tts_pcm",
      steps: [{
        type: "model_output",
        content: [{ type: "audio", data: raw.toString("base64"), mime_type: `audio/L16;rate=${sampleRate}` }]
      }]
    })
  });

  try {
    const result = await generateTurkishVoiceover({ text: "Merhaba", confirmed: true }, { GEMINI_API_KEY: "test" });
    assert.equal(result.status, "COMPLETED");
    assert.equal(result.mimeType, "audio/wav");
    assert.equal(result.audioBuffer.toString("ascii", 0, 4), "RIFF");
    assert.equal(result.audioBuffer.toString("ascii", 8, 12), "WAVE");
    assert.deepEqual(result.audioBuffer.subarray(44), raw);
    assert.ok(Math.abs(result.durationSeconds - durationSeconds) < 0.01);
    assert.ok(Math.abs(measureAudioDurationSeconds(result.audioBuffer, result.mimeType) - durationSeconds) < 0.01);
  } finally {
    global.fetch = originalFetch;
  }
});
