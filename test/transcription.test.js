import test from "node:test";
import assert from "node:assert/strict";
import { transcribeMedia, TRANSCRIPTION_PROVIDERS } from "../src/transcription/index.js";

function fakeMediaBytesImpl(buffer = Buffer.from("fake-audio"), mimeType = "audio/mpeg") {
  return async () => ({ buffer, mimeType });
}

test("TRANSCRIPTION_PROVIDERS index.js üzerinden de erişilebilir", () => {
  assert.deepEqual(TRANSCRIPTION_PROVIDERS, ["google", "openai"]);
});

test("transcribeMedia: boş mediaUrl hiçbir sağlayıcıya istek atmadan reddedilir", async () => {
  await assert.rejects(() => transcribeMedia({ mediaUrl: "" }, { GEMINI_API_KEY: "g" }), /mediaUrl/);
});

test("transcribeMedia: geçersiz provider hiçbir istek atmadan reddedilir", async () => {
  await assert.rejects(() => transcribeMedia({ mediaUrl: "https://example.com/a.mp3", provider: "anthropic" }, {}), /provider/);
});

test("transcribeMedia: provider='google' ama GEMINI_API_KEY yoksa openai'a SESSİZCE geçmez, açık bir hata fırlatır", async () => {
  let openaiCalled = false;
  await assert.rejects(
    () => transcribeMedia({ mediaUrl: "https://example.com/a.mp3", provider: "google" }, { OPENAI_API_KEY: "o" }, {
      fetchImpl: async (url) => { if (String(url).includes("openai")) openaiCalled = true; throw new Error("çağrılmamalıydı"); }
    }),
    /missing_api_key/
  );
  assert.equal(openaiCalled, false);
});

test("transcribeMedia: auto — hiçbir sağlayıcı yapılandırılmamışsa açık bir hata fırlatır", async () => {
  await assert.rejects(() => transcribeMedia({ mediaUrl: "https://example.com/a.mp3" }, {}), /no_available_provider/);
});

test("transcribeMedia: diarization:true + provider='openai' (destekliyor gibi görünse de) SESSİZCE yok sayılmaz, açık bir hata fırlatır", async () => {
  await assert.rejects(
    () => transcribeMedia({ mediaUrl: "https://example.com/a.mp3", provider: "openai", diarization: true }, { OPENAI_API_KEY: "o" }),
    /diarization_not_supported/
  );
});

test("transcribeMedia: provider='openai' ile çalışır, sonuç normalize edilmiş döner", async () => {
  const result = await transcribeMedia({ mediaUrl: "https://example.com/a.mp3", provider: "openai" }, { OPENAI_API_KEY: "okey" }, {
    fetchImpl: async () => ({ ok: true, json: async () => ({ text: "Merhaba dünya.", language: "turkish", segments: [{ start: 0, end: 2, text: "Merhaba dünya." }] }) }),
    fetchMediaBytesImpl: fakeMediaBytesImpl()
  });
  assert.equal(result.provider, "openai");
  assert.equal(result.mediaUrl, "https://example.com/a.mp3");
  assert.equal(result.text, "Merhaba dünya.");
  assert.equal(result.diarizationRequested, false);
  assert.equal(result.diarizationApplied, false);
  assert.equal(result.timestampAccuracy, "exact");
  assert.deepEqual(result.segments, [{ startSeconds: 0, endSeconds: 2, text: "Merhaba dünya.", speaker: null }]);
});

test("transcribeMedia: provider='google' başarısız olursa openai'a OTOMATİK geçilmez, hata olduğu gibi yansır", async () => {
  let openaiCalled = false;
  await assert.rejects(
    () => transcribeMedia({ mediaUrl: "https://example.com/a.mp3", provider: "google" }, { GEMINI_API_KEY: "gkey", OPENAI_API_KEY: "okey" }, {
      fetchImpl: async (url) => {
        if (String(url).includes("openai")) { openaiCalled = true; throw new Error("openai çağrılmamalıydı"); }
        return { ok: false, status: 500, json: async () => ({ error: { message: "internal error" } }) };
      },
      fetchMediaBytesImpl: fakeMediaBytesImpl()
    }),
    /internal error/
  );
  assert.equal(openaiCalled, false);
});

test("transcribeMedia: vocabularyHints en fazla 20 tanesi ile sınırlanır", async () => {
  let seenForm;
  const hints = Array.from({ length: 30 }, (_, i) => `terim${i}`);
  await transcribeMedia({ mediaUrl: "https://example.com/a.mp3", provider: "openai", vocabularyHints: hints }, { OPENAI_API_KEY: "okey" }, {
    fetchImpl: async (url, options) => { seenForm = options.body; return { ok: true, json: async () => ({ text: "x" }) }; },
    fetchMediaBytesImpl: fakeMediaBytesImpl()
  });
  assert.equal(seenForm.get("prompt").split(", ").length, 20);
});

test("transcribeMedia: hem text hem segments boşsa açık bir hata fırlatır (sessizce boş sonuç dönmez)", async () => {
  await assert.rejects(
    () => transcribeMedia({ mediaUrl: "https://example.com/a.mp3", provider: "openai" }, { OPENAI_API_KEY: "okey" }, {
      fetchImpl: async () => ({ ok: true, json: async () => ({ text: "" }) }),
      fetchMediaBytesImpl: fakeMediaBytesImpl()
    }),
    /boş bir yanıt/
  );
});

test("transcribeMedia: diarization:true + provider='google' ile çalışır, capabilities/diarizationApplied doğru raporlanır", async () => {
  const result = await transcribeMedia({ mediaUrl: "https://example.com/a.mp3", provider: "google", diarization: true }, { GEMINI_API_KEY: "gkey" }, {
    fetchImpl: async () => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ text: "x", segments: [{ startSeconds: 0, endSeconds: 1, text: "x", speaker: "Speaker 1" }] }) }] } }] }) }),
    fetchMediaBytesImpl: fakeMediaBytesImpl()
  });
  assert.equal(result.diarizationRequested, true);
  assert.equal(result.diarizationApplied, true);
  assert.equal(result.capabilities.diarization, true);
  assert.equal(result.segments[0].speaker, "Speaker 1");
});
