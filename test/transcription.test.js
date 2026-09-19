import test from "node:test";
import assert from "node:assert/strict";
import { transcribeMedia, TRANSCRIPTION_PROVIDERS } from "../src/transcription/index.js";
import { DEFAULT_GOOGLE_TRANSCRIBE_MODEL, DEFAULT_OPENAI_TRANSCRIBE_MODEL, OPENAI_DIARIZE_MODEL } from "../src/transcription/provider.js";

// index.js'in üst seviye orkestrasyonunu (discovery-gated model seçimi,
// diarization+vocabulary erken reddi, normalize) test eder. Provider bazlı
// capability/discovery mantığının kendisi test/transcription-provider.test.js'te
// (owns), her sağlayıcının HTTP taşıması test/transcription-{google,openai}.test.js'te
// zaten kapsanıyor — burada deps.discovery'yi doğrudan vererek gerçek bir
// /models discovery çağrısı yapmadan uçtan uca akışı doğruluyoruz.
function fakeMediaBytesImpl(buffer = Buffer.from("fake-audio"), mimeType = "audio/mpeg") {
  return async () => ({ buffer, mimeType });
}

function discoveryWith({ google = [], openai = [] } = {}) {
  return {
    google: { available: true, models: google },
    openai: { available: true, models: openai }
  };
}

function googleFilesAndInteractionMock(interaction) {
  return async (url, options = {}) => {
    const href = String(url);
    if (href.includes("/upload/v1beta/files")) {
      return {
        ok: true,
        headers: { get: (name) => String(name).toLowerCase() === "x-goog-upload-url" ? "https://upload.example/session" : null },
        json: async () => ({})
      };
    }
    if (href === "https://upload.example/session") {
      return { ok: true, json: async () => ({ file: { uri: "https://files.example/audio", mimeType: "audio/mpeg" } }) };
    }
    if (href.includes("/v1beta/interactions")) {
      return { ok: true, json: async () => interaction };
    }
    throw new Error("beklenmeyen url: " + href);
  };
}

test("TRANSCRIPTION_PROVIDERS index.js üzerinden de erişilebilir", () => {
  assert.deepEqual(TRANSCRIPTION_PROVIDERS, ["google", "openai"]);
});

test("transcribeMedia: boş mediaUrl hiçbir sağlayıcıya/discovery'ye istek atmadan reddedilir", async () => {
  let discoveryCalled = false;
  await assert.rejects(
    () => transcribeMedia({ mediaUrl: "" }, { GEMINI_API_KEY: "g" }, { fetchImpl: async () => { discoveryCalled = true; throw new Error("çağrılmamalıydı"); } }),
    /mediaUrl/
  );
  assert.equal(discoveryCalled, false);
});

test("transcribeMedia: geçersiz provider hiçbir istek atmadan reddedilir", async () => {
  await assert.rejects(() => transcribeMedia({ mediaUrl: "https://example.com/a.mp3", provider: "anthropic" }, {}), /provider/);
});

test("transcribeMedia: diarization:true ile vocabularyHints birlikte verilirse discovery'e bile gitmeden reddedilir", async () => {
  let discoveryCalled = false;
  await assert.rejects(
    () => transcribeMedia(
      { mediaUrl: "https://example.com/a.mp3", diarization: true, vocabularyHints: ["Buzsu"] },
      { GEMINI_API_KEY: "g" },
      { fetchImpl: async () => { discoveryCalled = true; throw new Error("çağrılmamalıydı"); } }
    ),
    /birlikte kullanılamaz/
  );
  assert.equal(discoveryCalled, false);
});

test("transcribeMedia: provider='google' ama GEMINI_API_KEY yoksa openai'a SESSİZCE geçmez, açık bir hata fırlatır", async () => {
  await assert.rejects(
    () => transcribeMedia(
      { mediaUrl: "https://example.com/a.mp3", provider: "google" },
      { OPENAI_API_KEY: "o" },
      { discovery: discoveryWith({ openai: [DEFAULT_OPENAI_TRANSCRIBE_MODEL] }) }
    ),
    /missing_api_key/
  );
});

test("transcribeMedia: auto — hiçbir sağlayıcı yapılandırılmamışsa açık bir hata fırlatır", async () => {
  await assert.rejects(
    () => transcribeMedia({ mediaUrl: "https://example.com/a.mp3" }, {}, { discovery: discoveryWith() }),
    /no_available_provider/
  );
});

test("transcribeMedia: configured model gerçek discovery'de yoksa (model_not_found) SESSİZCE başka bir modele düşülmez, açık hata fırlatır", async () => {
  await assert.rejects(
    () => transcribeMedia(
      { mediaUrl: "https://example.com/a.mp3", provider: "google" },
      { GEMINI_API_KEY: "g" },
      { discovery: discoveryWith({ google: [] }) }
    ),
    /model_not_found/
  );
});

test("transcribeMedia: diarization:true + provider='openai' — env override edilmiş model (whisper-1) diarization desteklemiyorsa SESSİZCE yok sayılmaz, açık hata fırlatır", async () => {
  await assert.rejects(
    () => transcribeMedia(
      { mediaUrl: "https://example.com/a.mp3", provider: "openai", diarization: true },
      { OPENAI_API_KEY: "o", OPENAI_TRANSCRIBE_MODEL: DEFAULT_OPENAI_TRANSCRIBE_MODEL },
      { discovery: discoveryWith({ openai: [DEFAULT_OPENAI_TRANSCRIBE_MODEL] }) }
    ),
    /diarization_not_supported/
  );
});

test("transcribeMedia: provider='openai' ile çalışır (whisper-1 varsayılan model), sonuç normalize edilmiş döner", async () => {
  const result = await transcribeMedia(
    { mediaUrl: "https://example.com/a.mp3", provider: "openai" },
    { OPENAI_API_KEY: "okey" },
    {
      discovery: discoveryWith({ openai: [DEFAULT_OPENAI_TRANSCRIBE_MODEL] }),
      fetchImpl: async () => ({ ok: true, json: async () => ({ text: "Merhaba dünya.", language: "turkish", segments: [{ start: 0, end: 2, text: "Merhaba dünya." }] }) }),
      fetchMediaBytesImpl: fakeMediaBytesImpl()
    }
  );
  assert.equal(result.provider, "openai");
  assert.equal(result.modelUsed, DEFAULT_OPENAI_TRANSCRIBE_MODEL);
  assert.equal(result.mediaUrl, "https://example.com/a.mp3");
  assert.equal(result.text, "Merhaba dünya.");
  assert.equal(result.diarizationRequested, false);
  assert.equal(result.diarizationApplied, false);
  assert.equal(result.timestampAccuracy, "exact");
  assert.deepEqual(result.segments, [{ startSeconds: 0, endSeconds: 2, text: "Merhaba dünya.", speaker: null }]);
});

test("transcribeMedia: diarization:true + provider='openai' — override yoksa gpt-4o-transcribe-diarize otomatik seçilir (discovery'de varsa), diarized_json segments döner", async () => {
  let seenForm;
  const result = await transcribeMedia(
    { mediaUrl: "https://example.com/a.mp3", provider: "openai", diarization: true },
    { OPENAI_API_KEY: "o" },
    {
      discovery: discoveryWith({ openai: [OPENAI_DIARIZE_MODEL] }),
      fetchImpl: async (url, options) => { seenForm = options.body; return { ok: true, json: async () => ({ text: "Merhaba.", segments: [{ start: 0, end: 1, text: "Merhaba.", speaker: "A" }] }) }; },
      fetchMediaBytesImpl: fakeMediaBytesImpl()
    }
  );
  assert.equal(seenForm.get("model"), OPENAI_DIARIZE_MODEL);
  assert.equal(seenForm.get("response_format"), "diarized_json");
  assert.equal(result.modelUsed, OPENAI_DIARIZE_MODEL);
  assert.equal(result.diarizationApplied, true);
  assert.equal(result.segments[0].speaker, "A");
});

test("transcribeMedia: provider='google' başarısız olursa openai'a OTOMATİK geçilmez, hata olduğu gibi yansır", async () => {
  let openaiCalled = false;
  await assert.rejects(
    () => transcribeMedia(
      { mediaUrl: "https://example.com/a.mp3", provider: "google" },
      { GEMINI_API_KEY: "gkey", OPENAI_API_KEY: "okey" },
      {
        discovery: discoveryWith({ google: [DEFAULT_GOOGLE_TRANSCRIBE_MODEL], openai: [DEFAULT_OPENAI_TRANSCRIBE_MODEL] }),
        fetchImpl: async (url) => {
          if (String(url).includes("openai")) { openaiCalled = true; throw new Error("openai çağrılmamalıydı"); }
          return { ok: false, status: 500, json: async () => ({ error: { message: "internal error" } }) };
        },
        fetchMediaBytesImpl: fakeMediaBytesImpl()
      }
    ),
    /internal error/
  );
  assert.equal(openaiCalled, false);
});

test("transcribeMedia: vocabularyHints en fazla 20 tanesi ile sınırlanır", async () => {
  let seenForm;
  const hints = Array.from({ length: 30 }, (_, i) => `terim${i}`);
  await transcribeMedia(
    { mediaUrl: "https://example.com/a.mp3", provider: "openai", vocabularyHints: hints },
    { OPENAI_API_KEY: "okey" },
    {
      discovery: discoveryWith({ openai: [DEFAULT_OPENAI_TRANSCRIBE_MODEL] }),
      fetchImpl: async (url, options) => { seenForm = options.body; return { ok: true, json: async () => ({ text: "x" }) }; },
      fetchMediaBytesImpl: fakeMediaBytesImpl()
    }
  );
  assert.equal(seenForm.get("prompt").split(", ").length, 20);
});

test("transcribeMedia: hem text hem segments boşsa açık bir hata fırlatır (sessizce boş sonuç dönmez)", async () => {
  await assert.rejects(
    () => transcribeMedia(
      { mediaUrl: "https://example.com/a.mp3", provider: "openai" },
      { OPENAI_API_KEY: "okey" },
      {
        discovery: discoveryWith({ openai: [DEFAULT_OPENAI_TRANSCRIBE_MODEL] }),
        fetchImpl: async () => ({ ok: true, json: async () => ({ text: "" }) }),
        fetchMediaBytesImpl: fakeMediaBytesImpl()
      }
    ),
    /boş bir yanıt/
  );
});

test("transcribeMedia: diarization:true + provider='google' ile çalışır (native), capabilities/diarizationApplied doğru raporlanır", async () => {
  const interaction = {
    output_text: "Merhaba dünya.",
    steps: [{
      content: [{
        type: "text",
        text: "Merhaba dünya.",
        annotations: [
          { type: "word_info", text: "Merhaba", start_offset: "0.000s", end_offset: "0.500s", speaker: "spk_1" },
          { type: "word_info", text: "dünya", start_offset: "0.600s", end_offset: "1.000s", speaker: "spk_1" }
        ]
      }]
    }]
  };
  const result = await transcribeMedia(
    { mediaUrl: "https://example.com/a.mp3", provider: "google", diarization: true },
    { GEMINI_API_KEY: "gkey" },
    {
      discovery: discoveryWith({ google: [DEFAULT_GOOGLE_TRANSCRIBE_MODEL] }),
      fetchImpl: googleFilesAndInteractionMock(interaction),
      fetchMediaBytesImpl: fakeMediaBytesImpl()
    }
  );
  assert.equal(result.modelUsed, DEFAULT_GOOGLE_TRANSCRIBE_MODEL);
  assert.equal(result.diarizationRequested, true);
  assert.equal(result.diarizationApplied, true);
  assert.equal(result.capabilities.diarization, true);
  assert.equal(result.segments[0].speaker, "spk_1");
});

test("transcribeMedia: auto — google yapılandırılmışsa (ve discovery'de model varsa) openai'a bakmadan onu seçer", async () => {
  const result = await transcribeMedia(
    { mediaUrl: "https://example.com/a.mp3" },
    { GEMINI_API_KEY: "gkey", OPENAI_API_KEY: "okey" },
    {
      discovery: discoveryWith({ google: [DEFAULT_GOOGLE_TRANSCRIBE_MODEL], openai: [DEFAULT_OPENAI_TRANSCRIBE_MODEL] }),
      fetchImpl: googleFilesAndInteractionMock({ output_text: "x" }),
      fetchMediaBytesImpl: fakeMediaBytesImpl()
    }
  );
  assert.equal(result.provider, "google");
});
