import { openaiTextApiKey } from "../ai-providers.js";
import { fetchMediaBytes } from "./media-fetch.js";
import { OPENAI_DIARIZE_MODEL } from "./provider.js";

// TASK-002 ROOT review (PR #101): OpenAI'nin /v1/audio/transcriptions
// BELGELENMİŞ format listesi flac/m4a/mp3/mp4/mpeg/mpga/oga/ogg/wav/webm'dir.
// video/quicktime (MOV) ve video/x-m4v BU LİSTEDE YOKTUR — önceki sürüm
// bunları sessizce eşleyip API'ye gönderiyordu, orada başarısız oluyordu.
// Artık burada AÇIKÇA reddedilir (media-fetch.js'in kaba MIME güvenlik ağı
// bunu geçirebilir — sıkı, sağlayıcıya özgü kabul listesi burada uygulanır).
const SUPPORTED_MIME_TYPES = new Set([
  "audio/mpeg", "audio/mp4", "audio/wav", "audio/x-wav", "audio/ogg", "audio/flac",
  "video/mp4", "video/webm"
]);

function extensionFromMime(mimeType) {
  const map = {
    "video/mp4": "mp4", "video/webm": "webm",
    "audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/wav": "wav", "audio/x-wav": "wav", "audio/ogg": "ogg", "audio/flac": "flac"
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
  if (!SUPPORTED_MIME_TYPES.has(mimeType)) {
    throw new Error(
      `OpenAI transkripsiyon uç noktası "${mimeType}" türünü desteklemiyor (desteklenenler: mp3/mp4/wav/ogg/flac ses, mp4/webm video — MOV/M4V gibi kapsayıcılar KABUL EDİLMEZ). ` +
      "Önce mevcut GitHub Actions FFmpeg render kuyruğuyla ses ayıklayın (bkz. src/lib/ffmpeg-command.js) veya provider:'google' deneyin (Google da yalnız ses MIME kabul eder)."
    );
  }
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
