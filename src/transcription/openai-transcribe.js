import { openaiTextApiKey } from "../ai-providers.js";
import { fetchMediaBytes } from "./media-fetch.js";
import { OPENAI_DIARIZE_MODEL } from "./provider.js";

function extensionFromMime(mimeType) {
  const map = {
    "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm", "video/x-m4v": "m4v",
    "audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/wav": "wav", "audio/ogg": "ogg", "audio/flac": "flac"
  };
  return map[mimeType] || "bin";
}

export async function transcribeWithOpenAi(
  { mediaUrl, model, languageHint, vocabularyHints = [], diarization = false },
  env = process.env,
  { fetchImpl = fetch, fetchMediaBytesImpl = fetchMediaBytes } = {}
) {
  const apiKey = openaiTextApiKey(env);
  if (!apiKey) throw new Error("OPENAI_API_KEY/OPENAI_IMAGE_API_KEY tanımlı değil.");
  if (!model) throw new Error("OpenAI transcription model çözülmedi.");

  const { buffer, mimeType } = await fetchMediaBytesImpl(mediaUrl, { fetchImpl });
  const form = new FormData();
  form.append("file", new Blob([buffer], { type: mimeType }), `media.${extensionFromMime(mimeType)}`);
  form.append("model", model);

  const isDiarizeModel = model === OPENAI_DIARIZE_MODEL;
  if (diarization && !isDiarizeModel) throw new Error(`Model "${model}" diarization desteklemiyor.`);

  if (isDiarizeModel) {
    form.append("response_format", "diarized_json");
    form.append("chunking_strategy", "auto");
  } else if (model === "whisper-1") {
    form.append("response_format", "verbose_json");
    form.append("timestamp_granularities[]", "segment");
  } else {
    form.append("response_format", "json");
  }

  if (languageHint) form.append("language", languageHint);
  // gpt-4o-transcribe-diarize prompt desteklemez.
  if (vocabularyHints.length && !isDiarizeModel) form.append("prompt", vocabularyHints.join(", "));

  const response = await fetchImpl("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message || data.error?.type || `OpenAI HTTP ${response.status}`);

  const segments = Array.isArray(data.segments)
    ? data.segments.map((segment) => ({
        startSeconds: segment.start,
        endSeconds: segment.end,
        text: segment.text,
        speaker: segment.speaker || null
      }))
    : [];

  return {
    text: data.text || "",
    language: data.language || null,
    segments,
    diarizationApplied: isDiarizeModel && diarization,
    timestampAccuracy: isDiarizeModel || model === "whisper-1" ? "exact" : null
  };
}
