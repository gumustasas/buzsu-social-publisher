import test from "node:test";
import assert from "node:assert/strict";
import { normalizeTranscript } from "../src/transcription/normalize.js";

test("normalizeTranscript: metin ve dili trimler, segment yoksa boş dizi döner", () => {
  const result = normalizeTranscript({ text: "  Merhaba dünya.  ", language: " tr " });
  assert.deepEqual(result, { text: "Merhaba dünya.", language: "tr", segments: [] });
});

test("normalizeTranscript: start/end (OpenAI şekli) ve startSeconds/endSeconds (Google şekli) ikisini de kabul eder", () => {
  const result = normalizeTranscript({
    text: "x",
    segments: [
      { start: 0, end: 4, text: "İlk parça" },
      { startSeconds: 4, endSeconds: 8, text: "İkinci parça", speaker: "Speaker 1" }
    ]
  });
  assert.deepEqual(result.segments, [
    { startSeconds: 0, endSeconds: 4, text: "İlk parça", speaker: null },
    { startSeconds: 4, endSeconds: 8, text: "İkinci parça", speaker: "Speaker 1" }
  ]);
});

test("normalizeTranscript: endSeconds <= startSeconds olan bozuk segmentleri sessizce ATLAR (uydurma zaman damgası üretmez)", () => {
  const result = normalizeTranscript({ text: "x", segments: [{ startSeconds: 5, endSeconds: 5, text: "sıfır süre" }, { startSeconds: 8, endSeconds: 4, text: "ters" }] });
  assert.deepEqual(result.segments, []);
});

test("normalizeTranscript: metni boş olan segmentleri atlar", () => {
  const result = normalizeTranscript({ text: "x", segments: [{ startSeconds: 0, endSeconds: 1, text: "  " }] });
  assert.deepEqual(result.segments, []);
});

test("normalizeTranscript: language verilmezse null döner (uydurma bir dil kodu ÜRETMEZ)", () => {
  const result = normalizeTranscript({ text: "x" });
  assert.equal(result.language, null);
});

test("normalizeTranscript: girdi tamamen boşsa/eksikse hata fırlatmadan boş bir yapı döner", () => {
  assert.deepEqual(normalizeTranscript(), { text: "", language: null, segments: [] });
  assert.deepEqual(normalizeTranscript({}), { text: "", language: null, segments: [] });
});

test("normalizeTranscript: en fazla 500 segment tutar", () => {
  const many = Array.from({ length: 600 }, (_, i) => ({ startSeconds: i, endSeconds: i + 1, text: `parça ${i}` }));
  assert.equal(normalizeTranscript({ text: "x", segments: many }).segments.length, 500);
});
