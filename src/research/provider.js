import { openaiTextApiKey } from "../ai-providers.js";

// TASK-001 (research_web): creative-providers/model-registry.js'teki
// resolveTier/resolveAutoSelection İLE AYNI SÖZLEŞME — "auto" hiçbir zaman
// farklı bir sağlayıcıya veya daha pahalı bir moda SESSİZCE düşmez; hangi
// sağlayıcı seçilirse seçilsin (açık veya auto) available:false + reason
// döner, throw etmez. Asıl "başarısızsa ne olur" kararı (hata fırlatma)
// çağıran tarafta (bkz. index.js researchWeb) verilir — bu modül sadece
// GERÇEK yapılandırmayı raporlar.

export const RESEARCH_PROVIDERS = ["google", "openai"];

export function researchProviderAvailability(env = process.env) {
  return {
    google: Boolean(env.GEMINI_API_KEY),
    openai: Boolean(openaiTextApiKey(env))
  };
}

// provider "auto" ise sabit bir öncelik sırasıyla (google -> openai —
// TASK-001 manifestinde "Google Search Grounding + URL Context ve OpenAI
// Web Search" sırasıyla anıldığı için aynı sıra korunur) İLK yapılandırılmış
// sağlayıcı seçilir. Açık bir provider verilmişse yalnız onun availability'si
// kontrol edilir — auto DEĞİLSE diğer sağlayıcıya hiç bakılmaz.
export function resolveResearchProvider(provider, env = process.env) {
  const availability = researchProviderAvailability(env);

  if (provider && provider !== "auto") {
    if (!RESEARCH_PROVIDERS.includes(provider)) {
      return { available: false, provider, reason: "unsupported_provider" };
    }
    if (!availability[provider]) return { available: false, provider, reason: "missing_api_key" };
    return { available: true, provider };
  }

  for (const candidate of RESEARCH_PROVIDERS) {
    if (availability[candidate]) return { available: true, provider: candidate };
  }
  return { available: false, provider: null, reason: "no_available_provider" };
}
