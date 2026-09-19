import test from "node:test";
import assert from "node:assert/strict";
import {
  TRANSCRIPTION_PROVIDERS,
  DEFAULT_GOOGLE_TRANSCRIBE_MODEL,
  DEFAULT_OPENAI_TRANSCRIBE_MODEL,
  OPENAI_DIARIZE_MODEL,
  discoverTranscriptionModels,
  transcriptionCapabilities,
  transcriptionProviderAvailability,
  resolveTranscriptionProvider
} from "../src/transcription/provider.js";

test("provider sabitleri öngörülebilir", () => {
  assert.deepEqual(TRANSCRIPTION_PROVIDERS, ["google", "openai"]);
  assert.equal(DEFAULT_GOOGLE_TRANSCRIBE_MODEL, "gemini-3.5-transcribe");
  assert.equal(DEFAULT_OPENAI_TRANSCRIBE_MODEL, "whisper-1");
  assert.equal(OPENAI_DIARIZE_MODEL, "gpt-4o-transcribe-diarize");
});

test("capability matrisi güncel model bazlıdır", () => {
  assert.equal(transcriptionCapabilities("google", "gemini-3.5-transcribe").diarization, true);
  assert.equal(transcriptionCapabilities("google", "gemini-3.5-transcribe").timestampAccuracy, "exact_word");
  assert.equal(transcriptionCapabilities("openai", "gpt-4o-transcribe-diarize").diarization, true);
  assert.equal(transcriptionCapabilities("openai", "whisper-1").diarization, false);
});

test("transcriptionProviderAvailability API key'leri raporlar", () => {
  assert.deepEqual(transcriptionProviderAvailability({}), { google: false, openai: false });
  assert.deepEqual(transcriptionProviderAvailability({ GEMINI_API_KEY: "g" }), { google: true, openai: false });
  assert.deepEqual(transcriptionProviderAvailability({ OPENAI_API_KEY: "o" }), { google: false, openai: true });
});

test("discoverTranscriptionModels gerçek model listelerinden yalnız transcribe/whisper modellerini alır", async () => {
  const discovery = await discoverTranscriptionModels({ GEMINI_API_KEY: "g", OPENAI_API_KEY: "o" }, {
    fetchImpl: async (url) => {
      if (String(url).includes("googleapis")) {
        return { ok: true, json: async () => ({ models: [{ name: "models/gemini-3.5-transcribe" }, { name: "models/gemini-3.5-flash" }] }) };
      }
      return { ok: true, json: async () => ({ data: [{ id: "whisper-1" }, { id: "gpt-4o-transcribe-diarize" }, { id: "gpt-5.6" }] }) };
    }
  });
  assert.deepEqual(discovery.google.models, ["gemini-3.5-transcribe"]);
  assert.deepEqual(discovery.openai.models, ["whisper-1", "gpt-4o-transcribe-diarize"]);
});

test("açık provider key yoksa missing_api_key", () => {
  const discovery = { google: { available: true, models: ["gemini-3.5-transcribe"] }, openai: { available: true, models: ["whisper-1"] } };
  assert.deepEqual(resolveTranscriptionProvider("google", {}, { OPENAI_API_KEY: "o" }, discovery), {
    available: false, provider: "google", reason: "missing_api_key"
  });
});

test("Google configured model discovery'de varsa seçilir", () => {
  const discovery = { google: { available: true, models: ["gemini-3.5-transcribe"] }, openai: { available: true, models: [] } };
  const result = resolveTranscriptionProvider("google", {}, { GEMINI_API_KEY: "g" }, discovery);
  assert.equal(result.available, true);
  assert.equal(result.model, "gemini-3.5-transcribe");
  assert.equal(result.capabilities.diarization, true);
});

test("configured model discovery'de yoksa silent fallback olmaz", () => {
  const discovery = { google: { available: true, models: [] }, openai: { available: true, models: ["whisper-1"] } };
  const result = resolveTranscriptionProvider("google", {}, { GEMINI_API_KEY: "g" }, discovery);
  assert.equal(result.available, false);
  assert.equal(result.reason, "model_not_found");
});

test("OpenAI diarization isteği gpt-4o-transcribe-diarize seçer", () => {
  const discovery = { google: { available: false, reason: "missing_api_key", models: [] }, openai: { available: true, models: ["whisper-1", "gpt-4o-transcribe-diarize"] } };
  const result = resolveTranscriptionProvider("openai", { diarization: true }, { OPENAI_API_KEY: "o" }, discovery);
  assert.equal(result.available, true);
  assert.equal(result.model, "gpt-4o-transcribe-diarize");
  assert.equal(result.capabilities.diarization, true);
});

test("OpenAI env override diarization desteklemiyorsa açık hata", () => {
  const discovery = { google: { available: false, reason: "missing_api_key", models: [] }, openai: { available: true, models: ["whisper-1"] } };
  const result = resolveTranscriptionProvider("openai", { diarization: true }, { OPENAI_API_KEY: "o", OPENAI_TRANSCRIBE_MODEL: "whisper-1" }, discovery);
  assert.equal(result.available, false);
  assert.equal(result.reason, "diarization_not_supported");
});

test("auto uygun ilk provider/modeli seçer", () => {
  const discovery = { google: { available: true, models: ["gemini-3.5-transcribe"] }, openai: { available: true, models: ["whisper-1"] } };
  const result = resolveTranscriptionProvider("auto", {}, { GEMINI_API_KEY: "g", OPENAI_API_KEY: "o" }, discovery);
  assert.equal(result.provider, "google");
});

test("unsupported provider reddedilir", () => {
  const result = resolveTranscriptionProvider("anthropic", {}, {}, {});
  assert.deepEqual(result, { available: false, provider: "anthropic", reason: "unsupported_provider" });
});
