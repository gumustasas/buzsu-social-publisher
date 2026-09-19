import { TRANSCRIPTION_PROVIDERS, discoverTranscriptionModels, resolveTranscriptionProvider } from "./provider.js";
import { transcribeWithGoogle } from "./google-transcribe.js";
import { transcribeWithOpenAi } from "./openai-transcribe.js";
import { normalizeTranscript } from "./normalize.js";

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

  // Google and OpenAI both reject/ignore vocabulary in diarization modes.
  // Rejecting this combination before discovery avoids a paid call and avoids
  // pretending that a hint was applied when the selected model cannot use it.
  if (diarization && vocabularyHints.length) {
    throw new Error("diarization:true ile vocabularyHints birlikte kullanılamaz.");
  }

  const discovery = deps.discovery || await discoverTranscriptionModels(env, { fetchImpl: deps.discoveryFetchImpl || deps.fetchImpl || fetch });
  const resolved = resolveTranscriptionProvider(
    provider,
    { diarization, vocabularyHints: vocabularyHints.length > 0 },
    env,
    discovery
  );

  if (!resolved.available) {
    const scope = provider === "auto" ? "auto (google/openai)" : provider;
    throw new Error(`Transcription provider "${scope}" kullanılamıyor (${resolved.reason}). Başka bir ücretli sağlayıcıya sessizce geçilmez.`);
  }

  const runner = RUNNER_BY_PROVIDER[resolved.provider];
  const raw = await runner(
    { mediaUrl, model: resolved.model, languageHint, vocabularyHints, diarization },
    env,
    deps
  );
  const normalized = normalizeTranscript(raw);
  if (!normalized.text && !normalized.segments.length) {
    throw new Error("Transkripsiyon sağlayıcısı boş bir yanıt döndürdü (ne metin ne segment).");
  }

  return {
    provider: resolved.provider,
    modelUsed: resolved.model,
    mediaUrl,
    diarizationRequested: diarization,
    diarizationApplied: raw.diarizationApplied === true,
    timestampAccuracy: raw.timestampAccuracy || null,
    capabilities: resolved.capabilities,
    ...normalized
  };
}
