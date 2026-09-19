import { TRANSCRIPTION_PROVIDERS, resolveTranscriptionProvider } from "./provider.js";
import { transcribeWithGoogle } from "./google-transcribe.js";
import { transcribeWithOpenAi } from "./openai-transcribe.js";
import { normalizeTranscript } from "./normalize.js";

// TASK-002: provider-independent transcription katmanı — transcribe_media
// (bkz. api/mcp.js) BU tek fonksiyonu kullanır. research/index.js İLE AYNI
// "sessiz ücretli fallback yok" ilkesi (bkz. provider.js resolveTranscriptionProvider).

export { TRANSCRIPTION_PROVIDERS };

const RUNNER_BY_PROVIDER = { google: transcribeWithGoogle, openai: transcribeWithOpenAi };
const MAX_VOCABULARY_HINTS = 20;

function normalizeVocabularyHints(hints) {
  if (!Array.isArray(hints)) return [];
  return hints.map((hint) => String(hint || "").trim()).filter(Boolean).slice(0, MAX_VOCABULARY_HINTS);
}

export async function transcribeMedia(input = {}, env = process.env, deps = {}) {
  const mediaUrl = String(input.mediaUrl || "").trim();
  if (!mediaUrl) throw new Error('"mediaUrl" gerekli.');

  const provider = input.provider || "auto";
  if (!["auto", ...TRANSCRIPTION_PROVIDERS].includes(provider)) {
    throw new Error(`"provider" geçersiz: "${provider}". Geçerli değerler: auto, ${TRANSCRIPTION_PROVIDERS.join(", ")}.`);
  }
  const diarization = input.diarization === true;
  const vocabularyHints = normalizeVocabularyHints(input.vocabularyHints);
  const languageHint = input.languageHint ? String(input.languageHint).trim() : undefined;

  const resolved = resolveTranscriptionProvider(provider, { diarization }, env);
  if (!resolved.available) {
    const scope = provider === "auto" ? "auto (google/openai)" : provider;
    throw new Error(`Transcription provider "${scope}" kullanılamıyor (${resolved.reason}). Başka bir ücretli sağlayıcıya sessizce geçilmez.`);
  }

  const runner = RUNNER_BY_PROVIDER[resolved.provider];
  const raw = await runner({ mediaUrl, languageHint, vocabularyHints, diarization }, env, deps);
  const normalized = normalizeTranscript(raw);
  if (!normalized.text && !normalized.segments.length) {
    throw new Error("Transkripsiyon sağlayıcısı boş bir yanıt döndürdü (ne metin ne segment).");
  }

  return {
    provider: resolved.provider,
    mediaUrl,
    diarizationRequested: diarization,
    diarizationApplied: raw.diarizationApplied === true,
    timestampAccuracy: raw.timestampAccuracy || null,
    capabilities: resolved.capabilities,
    ...normalized
  };
}
