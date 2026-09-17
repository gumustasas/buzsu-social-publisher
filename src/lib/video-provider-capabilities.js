import { OMNI_MODEL } from "../omni-video.js";
import { VEO_3_1_MODEL_TIERS } from "../veo-video.js";

// Google'ın Gemini API'sinde model listeleme (GET /v1beta/models) ÜCRETSİZDİR
// — bu bir üretim/generation çağrısı DEĞİL, salt bir discovery isteğidir.
// Bu yüzden confirmed:true kuralına tabi değildir. Anahtar yoksa veya ağ
// isteği herhangi bir sebeple başarısız olursa (örn. bu ortamdan Google'a
// erişim engelli) sessizce null'a düşülür — çağıran taraf bu durumda
// aşağıdaki fallbackVeoFamilies'e geri düşer, hiçbir zaman bir hata
// fırlatmaz.
async function listGeminiModels(env) {
  if (!env.GEMINI_API_KEY) return null;
  try {
    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models", {
      headers: { "x-goog-api-key": env.GEMINI_API_KEY }
    });
    if (!response.ok) return null;
    const data = await response.json().catch(() => null);
    if (!Array.isArray(data?.models)) return null;
    return new Set(data.models.map((model) => String(model?.name || "").replace(/^models\//, "")));
  } catch {
    return null;
  }
}

// Veo model ID'lerini AİLE (major.minor sürüm — "3.0" vs "3.1") ve TIER
// ("generate"/"fast"/"lite") olarak sınıflandırır — sabit bir ID listesine
// karşı eşleştirme YAPMAZ, ID'nin kendi şeklini (regex) ayrıştırır. Bu,
// "Model ID'lerini körlemesine hard-code etme" isteğinin doğrudan karşılığı:
// gerçek discovery'den (GET /v1beta/models) dönen HERHANGİ bir "veo-X.Y-..."
// ID'si, kod hiçbir zaman ID'yi önceden bilmese bile doğru aile/tier'a
// yerleşir — örn. Google ileride "veo-3.0-lite-generate-XXX" gibi
// dokümante etmediğimiz bir ID eklerse bu otomatik olarak "3.0"/"lite"
// altında raporlanır, kodda tek satır değişmeden.
const VEO_ID_PATTERN = /^veo-(\d+\.\d+)-(?:(lite)-)?(?:(fast)-)?generate(?:-preview|-\d{3})?$/;

function classifyVeoModelId(id) {
  const match = VEO_ID_PATTERN.exec(String(id || ""));
  if (!match) return null;
  const [, version, lite, fast] = match;
  return { version, tier: lite ? "lite" : fast ? "fast" : "generate" };
}

function emptyFamilyModels() {
  return { generate: null, fast: null, lite: null };
}

function buildVeoFamiliesFromDiscovery(discoveredModels) {
  const families = {};
  for (const id of discoveredModels) {
    const classified = classifyVeoModelId(id);
    if (!classified) continue;
    families[classified.version] ??= emptyFamilyModels();
    families[classified.version][classified.tier] = id;
  }
  return families;
}

// Gerçek discovery imkansızsa (GEMINI_API_KEY yok VEYA GET /v1beta/models
// isteği herhangi bir sebeple başarısız/erişilemez — örn. ağ erişimi
// kısıtlı bir ortam): YALNIZCA Veo 3.1 (bu depoda önceden entegre/varsayılan
// aile, bkz. src/veo-video.js:VEO_3_1_MODEL_TIERS) için anahtar varlığına
// dayalı bir varsayım yapılır — bu, depodaki mevcut availableProviders()
// ile AYNI, önceden var olan davranış. Veo 3 (GA) BU VARSAYIMA DAHİL
// EDİLMEZ: hangi hesapların Veo 3 (GA)'ya erişimi olduğu hesaba göre
// değişir (kullanıcının kendi hesabında gördüğü kota bunun kanıtı) — bu
// yüzden gerçek discovery doğrulamadan "available" denmez, sessizce
// unavailable kalır.
function fallbackVeoFamilies(hasGeminiKey) {
  if (!hasGeminiKey) return {};
  return {
    "3.1": { generate: VEO_3_1_MODEL_TIERS.quality, fast: VEO_3_1_MODEL_TIERS.fast, lite: VEO_3_1_MODEL_TIERS.economy }
  };
}

export async function getVideoProviderCapabilities(env = process.env) {
  const hasGeminiKey = Boolean(env.GEMINI_API_KEY);
  const discoveredModels = hasGeminiKey ? await listGeminiModels(env) : null;

  const omniListed = discoveredModels ? discoveredModels.has(OMNI_MODEL) : true;
  const omniAvailable = hasGeminiKey && omniListed;

  const veoFamilies = discoveredModels ? buildVeoFamiliesFromDiscovery(discoveredModels) : fallbackVeoFamilies(hasGeminiKey);
  const veo = {};
  for (const version of ["3.0", "3.1"]) {
    const models = veoFamilies[version] || emptyFamilyModels();
    veo[version] = { available: Object.values(models).some(Boolean), models };
  }

  return {
    google: {
      omni: { available: omniAvailable, models: omniAvailable ? [OMNI_MODEL] : [] },
      veo
    },
    fal: { available: Boolean(env.FAL_KEY) }
  };
}
