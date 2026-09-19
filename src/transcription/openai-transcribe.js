import { openaiTextApiKey } from "../ai-providers.js";
import { fetchMediaBytes } from "./media-fetch.js";

// TASK-002 — OpenAI adapter. /v1/audio/transcriptions mp4/mov/webm gibi
// video container'larını DA doğrudan kabul eder (belgelenmiş format
// listesi: flac/m4a/mp3/mp4/mpeg/mpga/oga/ogg/wav/webm) — ses ayıklama
// bu depoda AYRICA yapılmaz (bkz. media-fetch.js). Aynı OPENAI_API_KEY/
// OPENAI_IMAGE_API_KEY reuse edilir (bkz. ai-providers.js). "whisper-1"
// varsayılan modeldir (en uzun süredir belgelenmiş/stabil transkripsiyon
// modeli) — OPENAI_TRANSCRIBE_MODEL ile override edilebilir; model adı/
// mevcut alternatifler (ör. gpt-4o-transcribe ailesi) Perplexity review'ında
// (tasks/TASK-002) güncel dokümantasyona karşı doğrulanmalıdır. Whisper API
// resmi olarak diarization SUNMAZ — bu adapter diarization parametresi
// almaz (çağıran taraf, bkz. provider.js, bunu zaten filtreler).
// GERÇEK PARA HARCAR — confirmed kontrolü çağıran tarafta yapılır.
const DEFAULT_MODEL = "whisper-1";

function extensionFromMime(mimeType) {
  const map = {
    "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm", "video/x-m4v": "m4v",
    "audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/wav": "wav", "audio/ogg": "ogg", "audio/flac": "flac"
  };
  return map[mimeType] || "bin";
}

export async function transcribeWithOpenAi({ mediaUrl, languageHint, vocabularyHints = [] }, env = process.env, { fetchImpl = fetch, fetchMediaBytesImpl = fetchMediaBytes } = {}) {
  const apiKey = openaiTextApiKey(env);
  if (!apiKey) throw new Error("OPENAI_API_KEY/OPENAI_IMAGE_API_KEY tanımlı değil.");

  const model = env.OPENAI_TRANSCRIBE_MODEL || DEFAULT_MODEL;
  const { buffer, mimeType } = await fetchMediaBytesImpl(mediaUrl, { fetchImpl });

  const form = new FormData();
  form.append("file", new Blob([buffer], { type: mimeType }), `media.${extensionFromMime(mimeType)}`);
  form.append("model", model);
  form.append("response_format", "verbose_json");
  if (languageHint) form.append("language", languageHint);
  // Whisper'ın "prompt" alanı transkripsiyonu YÖNLENDİRMEZ (talimat değildir),
  // yalnızca kelime hazinesini/yazımı biraz eğiler — marka/terim ipuçları
  // için doğru kullanım budur (ai-providers.js'teki generation prompt'larıyla
  // karıştırılmamalı).
  if (vocabularyHints.length) form.append("prompt", vocabularyHints.join(", "));

  const response = await fetchImpl("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message || data.error?.type || `OpenAI HTTP ${response.status}`);

  return {
    text: data.text || "",
    language: data.language || null,
    segments: Array.isArray(data.segments)
      ? data.segments.map((segment) => ({ startSeconds: segment.start, endSeconds: segment.end, text: segment.text, speaker: null }))
      : [],
    diarizationApplied: false,
    timestampAccuracy: "exact"
  };
}
