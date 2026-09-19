import { openaiTextApiKey } from "../ai-providers.js";

export const TRANSCRIPTION_PROVIDERS = ["google", "openai"];
export const DEFAULT_GOOGLE_TRANSCRIBE_MODEL = "gemini-3.5-transcribe";
export const DEFAULT_OPENAI_TRANSCRIBE_MODEL = "whisper-1";
export const OPENAI_DIARIZE_MODEL = "gpt-4o-transcribe-diarize";

function capabilitiesForGoogleModel(model) {
  if (model === "gemini-3.5-transcribe") {
    return {
      timestamps: true,
      timestampAccuracy: "exact_word",
      diarization: true,
      diarizationAccuracy: "native",
      customVocabulary: true
    };
  }
  return { timestamps: false, timestampAccuracy: null, diarization: false, diarizationAccuracy: null, customVocabulary: false };
}

function capabilitiesForOpenAiModel(model) {
  if (model === OPENAI_DIARIZE_MODEL) {
    return {
      timestamps: true,
      timestampAccuracy: "exact_segment",
      diarization: true,
      diarizationAccuracy: "native",
      customVocabulary: false
    };
  }
  if (model === "whisper-1") {
    return {
      timestamps: true,
      timestampAccuracy: "exact_segment",
      diarization: false,
      diarizationAccuracy: null,
      customVocabulary: true
    };
  }
  if (/^gpt-4o(?:-mini)?-transcribe(?:-|$)/.test(model)) {
    return {
      timestamps: false,
      timestampAccuracy: null,
      diarization: false,
      diarizationAccuracy: null,
      customVocabulary: true
    };
  }
  return { timestamps: false, timestampAccuracy: null, diarization: false, diarizationAccuracy: null, customVocabulary: false };
}

export function transcriptionCapabilities(provider, model) {
  return provider === "google" ? capabilitiesForGoogleModel(model) : capabilitiesForOpenAiModel(model);
}

export function transcriptionProviderAvailability(env = process.env) {
  return {
    google: Boolean(env.GEMINI_API_KEY),
    openai: Boolean(openaiTextApiKey(env))
  };
}

export async function discoverTranscriptionModels(env = process.env, { fetchImpl = fetch } = {}) {
  const result = {
    google: { available: false, reason: "missing_api_key", models: [] },
    openai: { available: false, reason: "missing_api_key", models: [] }
  };

  if (env.GEMINI_API_KEY) {
    try {
      const response = await fetchImpl("https://generativelanguage.googleapis.com/v1beta/models?pageSize=100", {
        headers: { "x-goog-api-key": env.GEMINI_API_KEY }
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok) {
        const models = (data.models || [])
          .map((m) => String(m.name || "").replace(/^models\//, ""))
          .filter((id) => /transcribe/i.test(id));
        result.google = { available: true, models };
      } else {
        result.google = { available: false, reason: "list_models_failed", models: [] };
      }
    } catch {
      result.google = { available: false, reason: "list_models_failed", models: [] };
    }
  }

  const openaiKey = openaiTextApiKey(env);
  if (openaiKey) {
    try {
      const response = await fetchImpl("https://api.openai.com/v1/models", {
        headers: { Authorization: `Bearer ${openaiKey}` }
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok) {
        const models = (data.data || []).map((m) => String(m.id || "")).filter((id) => /transcribe|whisper/i.test(id));
        result.openai = { available: true, models };
      } else {
        result.openai = { available: false, reason: "list_models_failed", models: [] };
      }
    } catch {
      result.openai = { available: false, reason: "list_models_failed", models: [] };
    }
  }

  return result;
}

function configuredModelFor(provider, { diarization = false } = {}, env = process.env) {
  if (provider === "google") return env.GOOGLE_TRANSCRIBE_MODEL || DEFAULT_GOOGLE_TRANSCRIBE_MODEL;
  if (env.OPENAI_TRANSCRIBE_MODEL) return env.OPENAI_TRANSCRIBE_MODEL;
  return diarization ? OPENAI_DIARIZE_MODEL : DEFAULT_OPENAI_TRANSCRIBE_MODEL;
}

function resolveOne(provider, requirements, env, discovery) {
  const availability = transcriptionProviderAvailability(env);
  if (!availability[provider]) return { available: false, provider, reason: "missing_api_key" };

  const model = configuredModelFor(provider, requirements, env);
  const providerDiscovery = discovery?.[provider];
  if (!providerDiscovery?.available) {
    return { available: false, provider, model, reason: providerDiscovery?.reason || "list_models_failed" };
  }
  if (!providerDiscovery.models.includes(model)) {
    return { available: false, provider, model, reason: "model_not_found" };
  }

  const capabilities = transcriptionCapabilities(provider, model);
  if (requirements.diarization && !capabilities.diarization) {
    return { available: false, provider, model, reason: "diarization_not_supported" };
  }
  if (requirements.vocabularyHints && !capabilities.customVocabulary) {
    return { available: false, provider, model, reason: "custom_vocabulary_not_supported" };
  }
  return { available: true, provider, model, capabilities };
}

export function resolveTranscriptionProvider(provider, requirements = {}, env = process.env, discovery = {}) {
  if (provider && provider !== "auto") {
    if (!TRANSCRIPTION_PROVIDERS.includes(provider)) {
      return { available: false, provider, reason: "unsupported_provider" };
    }
    return resolveOne(provider, requirements, env, discovery);
  }

  for (const candidate of TRANSCRIPTION_PROVIDERS) {
    const resolved = resolveOne(candidate, requirements, env, discovery);
    if (resolved.available) return resolved;
  }
  return {
    available: false,
    provider: null,
    reason: requirements.diarization ? "no_diarization_capable_provider" : "no_available_provider"
  };
}
