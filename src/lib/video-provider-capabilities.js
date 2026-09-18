import { OMNI_MODEL } from "../omni-video.js";
import { VEO_MODEL_TIERS, VEO_TIER_ORDER } from "../veo-video.js";
import { NANO_BANANA_2_MODEL } from "../scene-image.js";
import { VEO_TIER_UI_LABELS, OMNI_UI_LABEL, NANO_BANANA_2_UI_LABEL, NANO_BANANA_2_LITE_UI_LABEL } from "./video-model-labels.js";

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

// VEO_MODEL_TIERS (bkz. src/veo-video.js), Google'ın TEK AKTİF Veo ailesini
// (Veo 3.1 Preview) temsil eder — Veo 3 (GA)'nın canonical ID'leri
// (veo-3.0-generate-001/veo-3.0-fast-generate-001) Google tarafından 30
// Haziran 2026'da kapatıldığı için src/veo-video.js:VEO_ALLOWED_MODELS'te
// ARTIK YOKTUR; bu yüzden burada da hiçbir zaman "available:true" olarak
// raporlanamazlar — deprecated bir model'in hard-code edilmiş bir "var"
// listesi burada YOKTUR, yalnızca gerçekten aktif olan modeller filtrelenir.
//
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

  // Her tier için ayrı available/label — dashboard bunu kullanarak
  // discovery'de görünmeyen bir tier'ı (ör. hesapta erişim yoksa) UI'da
  // disabled gösterir; hard-code edilmiş bir "hepsi açık" varsayımı YOKTUR.
  const veoTiers = VEO_TIER_ORDER.map((tier) => {
    const model = VEO_MODEL_TIERS[tier];
    return { tier, model, label: VEO_TIER_UI_LABELS[tier], available: veoModels.includes(model) };
  });

  const nanoBanana2LiteModel = env.GEMINI_SCENE_MODEL || "gemini-3.1-flash-lite-image";
  const nanoBanana2Model = env.GEMINI_NANO_BANANA_2_MODEL || NANO_BANANA_2_MODEL;
  // Nano Banana 2, Gemini image modelleri (generateContent, GET /v1beta/models
  // discovery'sinde Veo/Omni ile AYNI listede görünür) — bu yüzden aynı
  // discoveredModels setine bakılır; discovery başarısızsa (bkz. listGeminiModels)
  // yalnızca anahtar varlığına düşülür, Veo/Omni ile BİREBİR aynı davranış.
  const nanoBanana2Listed = discoveredModels ? discoveredModels.has(nanoBanana2Model) : true;
  const nanoBanana2LiteListed = discoveredModels ? discoveredModels.has(nanoBanana2LiteModel) : true;

  return {
    google: {
      omni: { available: omniAvailable, models: omniAvailable ? [OMNI_MODEL] : [], label: OMNI_UI_LABEL },
      veo: { available: hasGeminiKey && veoModels.length > 0, models: veoModels, tiers: veoTiers },
      image: {
        nanoBanana2: { available: hasGeminiKey && nanoBanana2Listed, model: nanoBanana2Model, label: NANO_BANANA_2_UI_LABEL },
        nanoBanana2Lite: { available: hasGeminiKey && nanoBanana2LiteListed, model: nanoBanana2LiteModel, label: NANO_BANANA_2_LITE_UI_LABEL }
      }
    },
    fal: { available: Boolean(env.FAL_KEY) }
  };
}
