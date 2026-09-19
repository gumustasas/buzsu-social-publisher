import test from "node:test";
import assert from "node:assert/strict";
import { transcribeWithGoogle } from "../src/transcription/google-transcribe.js";

function fakeMediaBytesImpl(buffer = Buffer.from("fake-audio"), mimeType = "audio/mpeg") {
  return async () => ({ buffer, mimeType });
}

test("transcribeWithGoogle: GEMINI_API_KEY yoksa hiçbir fetch/medya indirme yapmadan hata fırlatır", async () => {
  let mediaCalled = false;
  await assert.rejects(
    () => transcribeWithGoogle({ mediaUrl: "https://example.com/a.mp3" }, {}, {
      fetchImpl: async () => { throw new Error("çağrılmamalıydı"); },
      fetchMediaBytesImpl: async () => { mediaCalled = true; throw new Error("çağrılmamalıydı"); }
    }),
    /GEMINI_API_KEY/
  );
  assert.equal(mediaCalled, false);
});

test("transcribeWithGoogle: medyayı inlineData olarak base64 gönderir, JSON yanıtı normalize edilmeden (ham) döner", async () => {
  let seenBody, seenHeaders;
  const data = { candidates: [{ content: { parts: [{ text: JSON.stringify({ language: "tr", text: "Merhaba dünya.", segments: [{ startSeconds: 0, endSeconds: 2, text: "Merhaba dünya." }] }) }] } }] };
  const result = await transcribeWithGoogle({ mediaUrl: "https://example.com/a.mp3" }, { GEMINI_API_KEY: "gkey" }, {
    fetchImpl: async (url, options) => { seenHeaders = options.headers; seenBody = JSON.parse(options.body); return { ok: true, json: async () => data }; },
    fetchMediaBytesImpl: fakeMediaBytesImpl()
  });
  assert.equal(seenHeaders["x-goog-api-key"], "gkey");
  assert.equal(seenBody.contents[0].parts[0].inlineData.mimeType, "audio/mpeg");
  assert.equal(seenBody.contents[0].parts[0].inlineData.data, Buffer.from("fake-audio").toString("base64"));
  assert.equal(result.text, "Merhaba dünya.");
  assert.equal(result.language, "tr");
  assert.equal(result.timestampAccuracy, "best_effort");
  assert.equal(result.diarizationApplied, false);
});

test("transcribeWithGoogle: vocabularyHints ve diarization prompt metnine yansır", async () => {
  let seenBody;
  await transcribeWithGoogle({ mediaUrl: "https://example.com/a.mp3", vocabularyHints: ["Buzsu", "kireç önleyici"], diarization: true }, { GEMINI_API_KEY: "gkey" }, {
    fetchImpl: async (url, options) => { seenBody = JSON.parse(options.body); return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ text: "x" }) }] } }] }) }; },
    fetchMediaBytesImpl: fakeMediaBytesImpl()
  });
  const promptText = seenBody.contents[0].parts[1].text;
  assert.match(promptText, /Buzsu, kireç önleyici/);
  assert.match(promptText, /Konuşmacı değişimlerini/);
});

test("transcribeWithGoogle: diarizationApplied istek gerçekten diarization:true olduğunda true döner", async () => {
  const result = await transcribeWithGoogle({ mediaUrl: "https://example.com/a.mp3", diarization: true }, { GEMINI_API_KEY: "gkey" }, {
    fetchImpl: async () => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ text: "x" }) }] } }] }) }),
    fetchMediaBytesImpl: fakeMediaBytesImpl()
  });
  assert.equal(result.diarizationApplied, true);
});

test("transcribeWithGoogle: HTTP hatası açık bir hata fırlatır", async () => {
  await assert.rejects(
    () => transcribeWithGoogle({ mediaUrl: "https://example.com/a.mp3" }, { GEMINI_API_KEY: "gkey" }, {
      fetchImpl: async () => ({ ok: false, status: 429, json: async () => ({ error: { message: "quota exceeded" } }) }),
      fetchMediaBytesImpl: fakeMediaBytesImpl()
    }),
    /quota exceeded/
  );
});

test("transcribeWithGoogle: geçersiz JSON döndürürse (onarmaya çalışmadan) açık bir hata fırlatır", async () => {
  await assert.rejects(
    () => transcribeWithGoogle({ mediaUrl: "https://example.com/a.mp3" }, { GEMINI_API_KEY: "gkey" }, {
      fetchImpl: async () => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: "bu json değil" }] } }] }) }),
      fetchMediaBytesImpl: fakeMediaBytesImpl()
    }),
    /geçerli JSON değil/
  );
});
