import test from "node:test";
import assert from "node:assert/strict";
import { TRANSCRIPTION_PROVIDERS, TRANSCRIPTION_CAPABILITIES, transcriptionProviderAvailability, resolveTranscriptionProvider } from "../src/transcription/provider.js";

test("TRANSCRIPTION_PROVIDERS sabit ve öngörülebilir", () => {
  assert.deepEqual(TRANSCRIPTION_PROVIDERS, ["google", "openai"]);
});

test("TRANSCRIPTION_CAPABILITIES: openai diarization desteklemez, google best-effort destekler", () => {
  assert.equal(TRANSCRIPTION_CAPABILITIES.openai.diarization, false);
  assert.equal(TRANSCRIPTION_CAPABILITIES.google.diarization, true);
  assert.equal(TRANSCRIPTION_CAPABILITIES.openai.timestampAccuracy, "exact");
  assert.equal(TRANSCRIPTION_CAPABILITIES.google.timestampAccuracy, "best_effort");
});

test("transcriptionProviderAvailability: yalnız gerçek API key'i olan sağlayıcıları true işaretler", () => {
  assert.deepEqual(transcriptionProviderAvailability({}), { google: false, openai: false });
  assert.deepEqual(transcriptionProviderAvailability({ GEMINI_API_KEY: "g" }), { google: true, openai: false });
  assert.deepEqual(transcriptionProviderAvailability({ OPENAI_API_KEY: "o" }), { google: false, openai: true });
});

test("resolveTranscriptionProvider: açık provider verilip key yoksa reason:missing_api_key", () => {
  const result = resolveTranscriptionProvider("google", {}, { OPENAI_API_KEY: "o" });
  assert.deepEqual(result, { available: false, provider: "google", reason: "missing_api_key" });
});

test("resolveTranscriptionProvider: açık provider + key varsa capabilities ile birlikte available:true döner", () => {
  const result = resolveTranscriptionProvider("openai", {}, { OPENAI_API_KEY: "o" });
  assert.equal(result.available, true);
  assert.equal(result.provider, "openai");
  assert.deepEqual(result.capabilities, TRANSCRIPTION_CAPABILITIES.openai);
});

test("resolveTranscriptionProvider: desteklenmeyen provider adı reason:unsupported_provider döner", () => {
  const result = resolveTranscriptionProvider("anthropic", {}, { OPENAI_API_KEY: "o" });
  assert.deepEqual(result, { available: false, provider: "anthropic", reason: "unsupported_provider" });
});

test("resolveTranscriptionProvider: diarization:true + açık provider openai ise (key olsa da) SESSİZCE yok sayılmaz, reason:diarization_not_supported döner", () => {
  const result = resolveTranscriptionProvider("openai", { diarization: true }, { OPENAI_API_KEY: "o" });
  assert.deepEqual(result, { available: false, provider: "openai", reason: "diarization_not_supported" });
});

test("resolveTranscriptionProvider: diarization:true + açık provider google ise available:true döner", () => {
  const result = resolveTranscriptionProvider("google", { diarization: true }, { GEMINI_API_KEY: "g" });
  assert.equal(result.available, true);
  assert.equal(result.provider, "google");
});

test("resolveTranscriptionProvider: auto — google yapılandırılmışsa openai'a bakmadan onu seçer (öncelik sırası)", () => {
  const result = resolveTranscriptionProvider("auto", {}, { GEMINI_API_KEY: "g", OPENAI_API_KEY: "o" });
  assert.equal(result.provider, "google");
});

test("resolveTranscriptionProvider: auto + diarization:true — openai yapılandırılmış olsa da diarization desteklemediği için google'a düşer", () => {
  const result = resolveTranscriptionProvider("auto", { diarization: true }, { OPENAI_API_KEY: "o", GEMINI_API_KEY: "g" });
  assert.equal(result.provider, "google");
});

test("resolveTranscriptionProvider: auto + diarization:true — yalnız openai yapılandırılmışsa (diarization capable hiçbir sağlayıcı yok) reason:no_diarization_capable_provider döner", () => {
  const result = resolveTranscriptionProvider("auto", { diarization: true }, { OPENAI_API_KEY: "o" });
  assert.deepEqual(result, { available: false, provider: null, reason: "no_diarization_capable_provider" });
});

test("resolveTranscriptionProvider: auto — hiçbir sağlayıcı yapılandırılmamışsa reason:no_available_provider döner (SESSİZCE bir şey seçilmez)", () => {
  const result = resolveTranscriptionProvider("auto", {}, {});
  assert.deepEqual(result, { available: false, provider: null, reason: "no_available_provider" });
});
