import { listOpenAiModels } from "./openai.js";
import { listGoogleModels } from "./google.js";

// AI Reels V2 PR-B: Creative Provider abstraction — model REGISTRY.
// generate_reel_script (PR-C, henüz eklenmedi) bu modülü kullanacak. Burada
// KASITLI olarak YOK: hard-code edilmiş model adı varsayılanları
// (src/ai-providers.js'teki `env.OPENAI_REEL_MODEL || "gpt-5.6"` deseninin
// AKSİNE) — tier eşlemesi TAMAMEN env override + GERÇEK discovery
// doğrulamasına dayanır. Bir tier için override verilmemişse tahmini bir
// model ATANMAZ (available:false, reason:"not_configured"); override
// verilmiş ama discovery'de bulunamıyorsa SESSİZCE başka bir modele
// düşülmez (available:false, reason:"model_not_found").

export const CREATIVE_PROVIDERS = ["openai", "google"];
export const CREATIVE_TIERS = ["economy", "balanced", "quality", "premium"];

export const CREATIVE_TIER_ENV_VARS = {
  openai: {
    economy: "OPENAI_CREATIVE_ECONOMY_MODEL",
    balanced: "OPENAI_CREATIVE_BALANCED_MODEL",
    quality: "OPENAI_CREATIVE_QUALITY_MODEL",
    premium: "OPENAI_CREATIVE_PREMIUM_MODEL"
  },
  google: {
    economy: "GOOGLE_CREATIVE_ECONOMY_MODEL",
    balanced: "GOOGLE_CREATIVE_BALANCED_MODEL",
    quality: "GOOGLE_CREATIVE_QUALITY_MODEL",
    premium: "GOOGLE_CREATIVE_PREMIUM_MODEL"
  }
};

function tierCandidateFor(provider, modelId, env) {
  for (const tier of CREATIVE_TIERS) {
    if (env[CREATIVE_TIER_ENV_VARS[provider][tier]] === modelId) return tier;
  }
  return null;
}

// İki sağlayıcıyı PARALEL sorgular; biri key yoksa/başarısız olsa bile
// diğerini etkilemez (product-catalog.js/feed-catalog.js'teki "bir kaynak
// çökerse diğeri etkilenmez" ilkesiyle aynı). Her modele, o an geçerli env
// override'larına göre bir tierCandidate (varsa) etiketlenir — bu bir TAHMİN
// değildir, doğrudan env eşleşmesinin yansımasıdır.
export async function discoverCreativeModels(env = process.env, deps = {}) {
  const [openaiResult, googleResult] = await Promise.all([
    listOpenAiModels(env, deps),
    listGoogleModels(env, deps)
  ]);
  const withTierCandidates = (result) => ({
    ...result,
    models: result.models.map((model) => ({ ...model, tierCandidate: tierCandidateFor(result.provider, model.model, env) }))
  });
  return { openai: withTierCandidates(openaiResult), google: withTierCandidates(googleResult) };
}

// Bir provider+tier için env override'ın GERÇEK discovery'de bulunup
// bulunmadığını doğrular:
//   - override yok                     -> available:false, reason:"not_configured"
//   - provider discovery'si başarısız  -> available:false, reason:<discovery'nin reason'ı> (ör. "missing_api_key")
//   - override var ama listede yok     -> available:false, reason:"model_not_found" (SESSİZCE başka modele geçilmez)
//   - override var ve listede bulundu  -> available:true, + displayName/capabilities
export function resolveTier(provider, tier, discovery, env = process.env) {
  if (!CREATIVE_PROVIDERS.includes(provider)) throw new Error(`Desteklenmeyen provider: ${provider}`);
  if (!CREATIVE_TIERS.includes(tier)) throw new Error(`Desteklenmeyen tier: ${tier}`);

  const configuredModel = env[CREATIVE_TIER_ENV_VARS[provider][tier]];
  if (!configuredModel) return { provider, tier, model: null, available: false, reason: "not_configured" };

  const providerDiscovery = discovery[provider];
  if (!providerDiscovery?.available) {
    return { provider, tier, model: configuredModel, available: false, reason: providerDiscovery?.reason || "list_models_failed" };
  }

  const found = providerDiscovery.models.find((entry) => entry.model === configuredModel);
  if (!found) return { provider, tier, model: configuredModel, available: false, reason: "model_not_found" };

  return { provider, tier, model: configuredModel, available: true, displayName: found.displayName, capabilities: found.capabilities };
}

// "auto", provider/tier'i KENDİ TAHMİN ETMEZ — yalnızca sabit bir öncelik
// sırasıyla (openai -> google, mevcut availableProviders() ile aynı öncelik,
// bkz. ai-providers.js) hangi sağlayıcının bu tier için GERÇEKTEN
// yapılandırılmış ve erişilebilir bir modeli varsa onu seçer. Hiçbir
// koşulda farklı bir tier'a veya daha pahalı bir modele SESSİZCE düşmez —
// hiçbiri uygun değilse açık bir available:false döner.
export function resolveAutoSelection(tier, discovery, env = process.env) {
  for (const provider of CREATIVE_PROVIDERS) {
    const resolved = resolveTier(provider, tier, discovery, env);
    if (resolved.available) return resolved;
  }
  return { provider: null, tier, model: null, available: false, reason: "no_available_provider_for_tier" };
}

// "Özel" (custom) mod için: kullanıcı SERBEST METİNLE model adı yazamaz,
// yalnızca discovery'de GERÇEKTEN listelenmiş/erişilebilir bir (provider,
// model) çiftini seçebilir. Dashboard (PR-D) seçim doğrulamasında bunu
// kullanacak.
export function isModelSelectable(provider, model, discovery) {
  const providerDiscovery = discovery[provider];
  if (!providerDiscovery?.available) return false;
  return providerDiscovery.models.some((entry) => entry.model === model);
}
