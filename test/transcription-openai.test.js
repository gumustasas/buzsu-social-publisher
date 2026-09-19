import test from "node:test";
import assert from "node:assert/strict";
import { transcribeWithOpenAi } from "../src/transcription/openai-transcribe.js";

function fakeMediaBytesImpl(buffer = Buffer.from("fake-audio"), mimeType = "audio/mpeg") {
  return async () => ({ buffer, mimeType });
}

test("OPENAI key yoksa medya indirilmez", async () => {
  let mediaCalled = false;
  await assert.rejects(
    () => transcribeWithOpenAi({ mediaUrl: "https://example.com/a.mp3", model: "whisper-1" }, {}, {
      fetchImpl: async () => { throw new Error("çağrılmamalıydı"); },
      fetchMediaBytesImpl: async () => { mediaCalled = true; throw new Error("çağrılmamalıydı"); }
    }),
    /OPENAI_API_KEY/
  );
  assert.equal(mediaCalled, false);
});

test("whisper-1 verbose_json + segment timestamps kullanır", async () => {
  let seenForm;
  const result = await transcribeWithOpenAi(
    { mediaUrl: "https://example.com/a.mp3", model: "whisper-1" },
    { OPENAI_API_KEY: "okey" },
    {
      fetchImpl: async (url, options) => {
        seenForm = options.body;
        return { ok: true, json: async () => ({ text: "Merhaba.", language: "turkish", segments: [{ start: 0, end: 1, text: "Merhaba." }] }) };
      },
      fetchMediaBytesImpl: fakeMediaBytesImpl()
    }
  );
  assert.equal(seenForm.get("model"), "whisper-1");
  assert.equal(seenForm.get("response_format"), "verbose_json");
  assert.equal(seenForm.get("timestamp_granularities[]"), "segment");
  assert.equal(result.timestampAccuracy, "exact");
  assert.equal(result.diarizationApplied, false);
  assert.equal(result.segments[0].speaker, null);
});

test("gpt-4o-transcribe-diarize diarized_json + chunking_strategy=auto kullanır", async () => {
  let seenForm;
  const result = await transcribeWithOpenAi(
    { mediaUrl: "https://example.com/a.mp3", model: "gpt-4o-transcribe-diarize", diarization: true },
    { OPENAI_API_KEY: "okey" },
    {
      fetchImpl: async (url, options) => {
        seenForm = options.body;
        return { ok: true, json: async () => ({ text: "Merhaba.", segments: [{ start: 0, end: 1, text: "Merhaba.", speaker: "A" }] }) };
      },
      fetchMediaBytesImpl: fakeMediaBytesImpl()
    }
  );
  assert.equal(seenForm.get("response_format"), "diarized_json");
  assert.equal(seenForm.get("chunking_strategy"), "auto");
  assert.equal(seenForm.get("prompt"), null);
  assert.equal(result.diarizationApplied, true);
  assert.equal(result.segments[0].speaker, "A");
});

test("diarization desteklemeyen modelle diarization istenirse hata", async () => {
  await assert.rejects(
    () => transcribeWithOpenAi(
      { mediaUrl: "https://example.com/a.mp3", model: "whisper-1", diarization: true },
      { OPENAI_API_KEY: "okey" },
      { fetchMediaBytesImpl: fakeMediaBytesImpl() }
    ),
    /diarization desteklemiyor/
  );
});

test("language ve vocabulary prompt alanlarına yazılır; diarize modelde prompt gönderilmez", async () => {
  let seenForm;
  await transcribeWithOpenAi(
    { mediaUrl: "https://example.com/a.mp3", model: "whisper-1", languageHint: "tr", vocabularyHints: ["Buzsu", "kireç"] },
    { OPENAI_API_KEY: "okey" },
    {
      fetchImpl: async (url, options) => { seenForm = options.body; return { ok: true, json: async () => ({ text: "x" }) }; },
      fetchMediaBytesImpl: fakeMediaBytesImpl()
    }
  );
  assert.equal(seenForm.get("language"), "tr");
  assert.equal(seenForm.get("prompt"), "Buzsu, kireç");
});

test("HTTP hatası açıkça yansır", async () => {
  await assert.rejects(
    () => transcribeWithOpenAi(
      { mediaUrl: "https://example.com/a.mp3", model: "whisper-1" },
      { OPENAI_API_KEY: "okey" },
      {
        fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({ error: { message: "internal error" } }) }),
        fetchMediaBytesImpl: fakeMediaBytesImpl()
      }
    ),
    /internal error/
  );
});
