import { openaiTextApiKey } from "../ai-providers.js";

// TASK-002 (transcribe_media): research/provider.js İLE AYNI sözleşme —
// "auto" hiçbir zaman sessizce diğer sağlayıcıya düşmez, available:false +
// reason döner. Ek olarak burada bir de CAPABILITY filtresi var: diarization
// istenirse yalnızca bunu destekleyen sağlayıcılar adaydır.
//
// Capability matrisi GERÇEK bir /models discovery çağrısı DEĞİLDİR (Whisper/
// Gemini'nin transkripsiyon API'leri model listesi döndürmez) — bu ikisinin
// belgelenmiş, sabit ürün yetenekleridir. timestamps: ikisi de segment
// zaman damgası döner ama doğruluk seviyesi farklıdır (bkz. index.js
// timestampAccuracy: openai "exact" — Whisper verbose_json segment'lerinden;
// google "best_effort" — prompt tabanlı yapılandırılmış JSON'dan tahmini).
// diarization: Google best-effort (prompt'a konuşmacı etiketi istenir);
// OpenAI Whisper resmi olarak desteklemez. Bu varsayımlar Perplexity review'ında
// (tasks/TASK-002, review_by: perplexity) güncel API dokümantasyonuna karşı
// doğrulanmalıdır.
export const TRANSCRIPTION_PROVIDERS = ["google", "openai"];

export const TRANSCRIPTION_CAPABILITIES = {
  google: { timestamps: true, timestampAccuracy: "best_effort", diarization: true, diarizationAccuracy: "best_effort" },
  openai: { timestamps: true, timestampAccuracy: "exact", diarization: false, diarizationAccuracy: null }
};

export function transcriptionProviderAvailability(env = process.env) {
  return {
    google: Boolean(env.GEMINI_API_KEY),
    openai: Boolean(openaiTextApiKey(env))
  };
}

// diarization:true istendiğinde "auto" yalnızca bunu destekleyen sağlayıcılar
// arasından seçer (SESSİZCE desteklemeyen bir sağlayıcıya düşüp diarization'ı
// yok saymaz). Açık bir provider verilmişse ve o sağlayıcı diarization'ı
// desteklemiyorsa, key'i olsa da available:false + reason:diarization_not_supported
// döner — istek "sessizce" göz ardı edilmez.
export function resolveTranscriptionProvider(provider, { diarization = false } = {}, env = process.env) {
  const availability = transcriptionProviderAvailability(env);

  if (provider && provider !== "auto") {
    if (!TRANSCRIPTION_PROVIDERS.includes(provider)) {
      return { available: false, provider, reason: "unsupported_provider" };
    }
    if (!availability[provider]) return { available: false, provider, reason: "missing_api_key" };
    if (diarization && !TRANSCRIPTION_CAPABILITIES[provider].diarization) {
      return { available: false, provider, reason: "diarization_not_supported" };
    }
    return { available: true, provider, capabilities: TRANSCRIPTION_CAPABILITIES[provider] };
  }

  for (const candidate of TRANSCRIPTION_PROVIDERS) {
    if (!availability[candidate]) continue;
    if (diarization && !TRANSCRIPTION_CAPABILITIES[candidate].diarization) continue;
    return { available: true, provider: candidate, capabilities: TRANSCRIPTION_CAPABILITIES[candidate] };
  }
  return { available: false, provider: null, reason: diarization ? "no_diarization_capable_provider" : "no_available_provider" };
}
