import test from "node:test";
import assert from "node:assert/strict";
import { transcribeWithGoogle } from "../src/transcription/google-transcribe.js";

function fakeMediaBytesImpl(buffer = Buffer.from("fake-audio"), mimeType = "audio/mpeg") {
  return async () => ({ buffer, mimeType });
}

function googleFetchMock({ interaction } = {}) {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).includes("/upload/v1beta/files")) {
      return {
        ok: true,
        headers: { get: (name) => String(name).toLowerCase() === "x-goog-upload-url" ? "https://upload.example/session" : null },
        json: async () => ({})
      };
    }
    if (String(url) === "https://upload.example/session") {
      return { ok: true, json: async () => ({ file: { uri: "https://files.example/audio", mimeType: "audio/mpeg" } }) };
    }
    if (String(url).includes("/v1beta/interactions")) {
      return { ok: true, json: async () => interaction || { output_text: "Merhaba." } };
    }
    throw new Error("beklenmeyen url: " + url);
  };
  return { calls, fetchImpl };
}

test("GEMINI key yoksa medya indirilmez", async () => {
  let mediaCalled = false;
  await assert.rejects(
    () => transcribeWithGoogle({ mediaUrl: "https://example.com/a.mp3", model: "gemini-3.5-transcribe" }, {}, {
      fetchMediaBytesImpl: async () => { mediaCalled = true; throw new Error("çağrılmamalıydı"); }
    }),
    /GEMINI_API_KEY/
  );
  assert.equal(mediaCalled, false);
});

test("Gemini Files API upload + Interactions API kullanır", async () => {
  const { calls, fetchImpl } = googleFetchMock({
    interaction: {
      output_text: "Merhaba dünya.",
      steps: [{
        content: [{
          type: "text",
          text: "Merhaba dünya.",
          annotations: [
            { type: "word_info", text: "Merhaba", start_offset: "0.100s", end_offset: "0.500s", speaker: "spk_1" },
            { type: "word_info", text: "dünya", start_offset: "0.600s", end_offset: "1.000s", speaker: "spk_1" }
          ]
        }]
      }]
    }
  });
  const result = await transcribeWithGoogle(
    { mediaUrl: "https://example.com/a.mp3", model: "gemini-3.5-transcribe", diarization: true },
    { GEMINI_API_KEY: "gkey" },
    { fetchImpl, fetchMediaBytesImpl: fakeMediaBytesImpl() }
  );
  const interactionCall = calls.find((c) => c.url.includes("/v1beta/interactions"));
  const body = JSON.parse(interactionCall.options.body);
  assert.equal(body.model, "gemini-3.5-transcribe");
  assert.equal(body.input[0].uri, "https://files.example/audio");
  assert.equal(body.generation_config.transcription_config.mode.diarization_mode, "speaker");
  assert.deepEqual(body.generation_config.transcription_config.mode.timestamp_granularities, ["word"]);
  assert.equal(result.text, "Merhaba dünya.");
  assert.equal(result.timestampAccuracy, "exact");
  assert.equal(result.diarizationApplied, true);
  assert.equal(result.segments[0].speaker, "spk_1");
});

test("custom vocabulary gerçek transcription_config alanına yazılır", async () => {
  const { calls, fetchImpl } = googleFetchMock();
  await transcribeWithGoogle(
    { mediaUrl: "https://example.com/a.mp3", model: "gemini-3.5-transcribe", languageHint: "tr-TR", vocabularyHints: ["Buzsu", "Ultramag"] },
    { GEMINI_API_KEY: "gkey" },
    { fetchImpl, fetchMediaBytesImpl: fakeMediaBytesImpl() }
  );
  const body = JSON.parse(calls.find((c) => c.url.includes("/v1beta/interactions")).options.body);
  const config = body.generation_config.transcription_config;
  assert.deepEqual(config.language_codes, ["tr-TR"]);
  assert.deepEqual(config.custom_vocabulary, ["Buzsu", "Ultramag"]);
  assert.equal(config.mode, undefined);
});

test("custom vocabulary + diarization birlikte reddedilir", async () => {
  await assert.rejects(
    () => transcribeWithGoogle(
      { mediaUrl: "https://example.com/a.mp3", model: "gemini-3.5-transcribe", vocabularyHints: ["Buzsu"], diarization: true },
      { GEMINI_API_KEY: "gkey" },
      { fetchMediaBytesImpl: fakeMediaBytesImpl() }
    ),
    /birlikte kullanılamaz/
  );
});

test("Gemini transcribe video MIME türünü doğrudan kabul etmez", async () => {
  await assert.rejects(
    () => transcribeWithGoogle(
      { mediaUrl: "https://example.com/a.mp4", model: "gemini-3.5-transcribe" },
      { GEMINI_API_KEY: "gkey" },
      { fetchMediaBytesImpl: fakeMediaBytesImpl(Buffer.from("video"), "video/mp4") }
    ),
    /yalnız ses MIME/
  );
});
