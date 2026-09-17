import { OMNI_MODEL } from "../omni-video.js";
import { VEO_MODEL_TIERS } from "../veo-video.js";

// Google'ın Gemini API'sinde model listeleme (GET /v1beta/models) ÜCRETSİZDİR
// — bu bir üretim/generation çağrısı DEĞİL, salt bir discovery isteğidir.
// Bu yüzden confirmed:true kuralına tabi değildir. Anahtar yoksa veya ağ
// isteği herhangi bir sebeple başarısız olursa (örn. bu ortamdan Google'a
// erişim engelli) sessizce null'a düşülür — çağıran taraf bu durumda
// "anahtar var mı" bilgisine geri düşer, hiçbir zaman bir hata fırlatmaz.
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

// discoveredModels null ise (anahtar yok VEYA discovery isteği
// başarısız/erişilemez) yalnızca "GEMINI_API_KEY tanımlı mı" bilgisine
// düşülür — bu, discovery isteğinin çalışamadığı ortamlarda (örn. ağ
// erişimi kısıtlı bir geliştirme sandbox'ı) capability'nin sessizce
// "unavailable" görünmesini ÖNLER; Vercel Production'da (gerçek ağ erişimi
// varken) ise gerçekten hangi modellerin listede olduğunu yansıtır.
export async function getVideoProviderCapabilities(env = process.env) {
  const hasGeminiKey = Boolean(env.GEMINI_API_KEY);
  const discoveredModels = hasGeminiKey ? await listGeminiModels(env) : null;

  const omniListed = discoveredModels ? discoveredModels.has(OMNI_MODEL) : true;
  const omniAvailable = hasGeminiKey && omniListed;

  const veoModelIds = Object.values(VEO_MODEL_TIERS);
  const veoModels = discoveredModels
    ? veoModelIds.filter((id) => discoveredModels.has(id))
    : (hasGeminiKey ? veoModelIds : []);

  return {
    google: {
      omni: { available: omniAvailable, models: omniAvailable ? [OMNI_MODEL] : [] },
      veo: { available: hasGeminiKey && veoModels.length > 0, models: veoModels }
    },
    fal: { available: Boolean(env.FAL_KEY) }
  };
}
