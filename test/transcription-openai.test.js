import test from "node:test";
import assert from "node:assert/strict";
import { transcribeWithOpenAi } from "../src/transcription/openai-transcribe.js";

function fakeMediaBytesImpl(buffer = Buffer.from("fake-audio"), mimeType = "audio/mpeg") {
  return async () => ({ buffer, mimeType });
}

test("transcribeWithOpenAi: OPENAI_API_KEY yoksa hiçbir fetch/medya indirme yapmadan hata fırlatır", async () => {
  let mediaCalled = false;
  await assert.rejects(
    () => transcribeWithOpenAi({ mediaUrl: "https://example.com/a.mp3" }, {}, {
      fetchImpl: async () => { throw new Error("çağrılmamalıydı"); },
      fetchMediaBytesImpl: async () => { mediaCalled = true; throw new Error("çağrılmamalıydı"); }
    }),
    /OPENAI_API_KEY/
  );
  assert.equal(mediaCalled, false);
});

test("transcribeWithOpenAi: /v1/audio/transcriptions'a multipart FormData ile whisper-1 varsayılan modeliyle çağırır", async () => {
  let seenUrl, seenHeaders, seenForm;
  const data = { text: "Merhaba dünya.", language: "turkish", segments: [{ start: 0, end: 2, text: "Merhaba dünya." }] };
  const result = await transcribeWithOpenAi({ mediaUrl: "https://example.com/a.mp3" }, { OPENAI_API_KEY: "okey" }, {
    fetchImpl: async (url, options) => { seenUrl = url; seenHeaders = options.headers; seenForm = options.body; return { ok: true, json: async () => data }; },
    fetchMediaBytesImpl: fakeMediaBytesImpl()
  });
  assert.match(seenUrl, /api\.openai\.com\/v1\/audio\/transcriptions/);
  assert.equal(seenHeaders.Authorization, "Bearer okey");
  assert.ok(seenForm instanceof FormData);
  assert.equal(seenForm.get("model"), "whisper-1");
  assert.equal(seenForm.get("response_format"), "verbose_json");
  assert.equal(result.text, "Merhaba dünya.");
  assert.equal(result.language, "turkish");
  assert.deepEqual(result.segments, [{ startSeconds: 0, endSeconds: 2, text: "Merhaba dünya.", speaker: null }]);
  assert.equal(result.diarizationApplied, false);
  assert.equal(result.timestampAccuracy, "exact");
});

test("transcribeWithOpenAi: OPENAI_TRANSCRIBE_MODEL override edilebilir (yeni model isimleri SESSİZCE eski adda kalınmaz)", async () => {
  let seenForm;
  await transcribeWithOpenAi({ mediaUrl: "https://example.com/a.mp3" }, { OPENAI_API_KEY: "okey", OPENAI_TRANSCRIBE_MODEL: "gpt-4o-mini-transcribe" }, {
    fetchImpl: async (url, options) => { seenForm = options.body; return { ok: true, json: async () => ({ text: "x" }) }; },
    fetchMediaBytesImpl: fakeMediaBytesImpl()
  });
  assert.equal(seenForm.get("model"), "gpt-4o-mini-transcribe");
});

test("transcribeWithOpenAi: languageHint ve vocabularyHints form alanlarına yazılır (prompt talimat değil kelime hazinesi ipucudur)", async () => {
  let seenForm;
  await transcribeWithOpenAi({ mediaUrl: "https://example.com/a.mp3", languageHint: "tr", vocabularyHints: ["Buzsu", "kireç önleyici"] }, { OPENAI_API_KEY: "okey" }, {
    fetchImpl: async (url, options) => { seenForm = options.body; return { ok: true, json: async () => ({ text: "x" }) }; },
    fetchMediaBytesImpl: fakeMediaBytesImpl()
  });
  assert.equal(seenForm.get("language"), "tr");
  assert.equal(seenForm.get("prompt"), "Buzsu, kireç önleyici");
});

test("transcribeWithOpenAi: HTTP hatası açık bir hata fırlatır", async () => {
  await assert.rejects(
    () => transcribeWithOpenAi({ mediaUrl: "https://example.com/a.mp3" }, { OPENAI_API_KEY: "okey" }, {
      fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({ error: { message: "internal error" } }) }),
      fetchMediaBytesImpl: fakeMediaBytesImpl()
    }),
    /internal error/
  );
});

test("transcribeWithOpenAi: segments yoksa boş dizi döner (hata fırlatmaz)", async () => {
  const result = await transcribeWithOpenAi({ mediaUrl: "https://example.com/a.mp3" }, { OPENAI_API_KEY: "okey" }, {
    fetchImpl: async () => ({ ok: true, json: async () => ({ text: "x" }) }),
    fetchMediaBytesImpl: fakeMediaBytesImpl()
  });
  assert.deepEqual(result.segments, []);
});
