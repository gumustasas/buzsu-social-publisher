import { fetchMediaBytes } from "./media-fetch.js";

const AUDIO_MIME_PATTERN = /^audio\//i;

function secondsFromOffset(value) {
  const match = String(value || "").match(/^([0-9]+(?:\.[0-9]+)?)s$/);
  return match ? Number(match[1]) : NaN;
}

function extractText(interaction) {
  if (interaction.output_text) return String(interaction.output_text).trim();
  return (interaction.steps || [])
    .flatMap((step) => step.content || [])
    .filter((content) => content.type === "text")
    .map((content) => content.text || "")
    .join("")
    .trim();
}

function extractWordSegments(interaction) {
  return (interaction.steps || [])
    .flatMap((step) => step.content || [])
    .flatMap((content) => content.annotations || [])
    .filter((annotation) => annotation?.type === "word_info")
    .map((annotation) => ({
      startSeconds: secondsFromOffset(annotation.start_offset),
      endSeconds: secondsFromOffset(annotation.end_offset),
      text: annotation.text || "",
      speaker: annotation.speaker || null
    }));
}

async function uploadGeminiFile(buffer, mimeType, apiKey, fetchImpl) {
  const start = await fetchImpl("https://generativelanguage.googleapis.com/upload/v1beta/files", {
    method: "POST",
    headers: {
      "x-goog-api-key": apiKey,
      "X-Goog-Upload-Protocol": "resumable",
      "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": String(buffer.length),
      "X-Goog-Upload-Header-Content-Type": mimeType,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ file: { display_name: "transcribe-media" } })
  });
  if (!start.ok) {
    const data = await start.json().catch(() => ({}));
    throw new Error(data.error?.message || `Gemini Files start HTTP ${start.status}`);
  }
  const uploadUrl = start.headers?.get?.("x-goog-upload-url");
  if (!uploadUrl) throw new Error("Gemini Files API upload URL döndürmedi.");

  const upload = await fetchImpl(uploadUrl, {
    method: "POST",
    headers: {
      "Content-Length": String(buffer.length),
      "X-Goog-Upload-Offset": "0",
      "X-Goog-Upload-Command": "upload, finalize",
      "Content-Type": mimeType
    },
    body: buffer
  });
  const info = await upload.json().catch(() => ({}));
  if (!upload.ok) throw new Error(info.error?.message || `Gemini Files upload HTTP ${upload.status}`);
  const file = info.file || {};
  if (!file.uri) throw new Error("Gemini Files API file URI döndürmedi.");
  return { uri: file.uri, mimeType: file.mimeType || mimeType };
}

export async function transcribeWithGoogle(
  { mediaUrl, model, languageHint, vocabularyHints = [], diarization = false },
  env = process.env,
  { fetchImpl = fetch, fetchMediaBytesImpl = fetchMediaBytes } = {}
) {
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY tanımlı değil.");
  if (!model) throw new Error("Google transcription model çözülmedi.");

  const { buffer, mimeType } = await fetchMediaBytesImpl(mediaUrl, { fetchImpl });
  if (!AUDIO_MIME_PATTERN.test(mimeType)) {
    throw new Error("Gemini 3.5 Transcribe yalnız ses MIME türlerini kabul eder; video için mevcut FFmpeg render kuyruğuyla ses ayıklayın veya OpenAI transkripsiyon sağlayıcısını seçin.");
  }
  if (diarization && vocabularyHints.length) {
    throw new Error("Gemini custom_vocabulary, speaker diarization ile birlikte kullanılamaz.");
  }

  const file = await uploadGeminiFile(buffer, mimeType, apiKey, fetchImpl);
  const transcriptionConfig = {};
  if (languageHint) transcriptionConfig.language_codes = [languageHint];
  if (vocabularyHints.length) transcriptionConfig.custom_vocabulary = vocabularyHints;

  // Word timestamps are requested only when compatible with custom vocabulary.
  const mode = { type: "verbatim" };
  if (!vocabularyHints.length) mode.timestamp_granularities = ["word"];
  if (diarization) mode.diarization_mode = "speaker";
  if (mode.timestamp_granularities || mode.diarization_mode) transcriptionConfig.mode = mode;

  const response = await fetchImpl("https://generativelanguage.googleapis.com/v1beta/interactions", {
    method: "POST",
    headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      input: [{ type: "audio", uri: file.uri, mime_type: file.mimeType }],
      generation_config: { transcription_config: transcriptionConfig }
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message || `Gemini HTTP ${response.status}`);

  return {
    text: extractText(data),
    language: null,
    segments: extractWordSegments(data),
    diarizationApplied: diarization,
    timestampAccuracy: !vocabularyHints.length ? "exact" : null
  };
}
