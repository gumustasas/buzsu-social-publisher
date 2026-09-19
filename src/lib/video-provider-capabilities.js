import { OMNI_MODEL } from "../omni-video.js";
import { VEO_MODEL_TIERS, VEO_TIER_ORDER } from "../veo-video.js";
import { NANO_BANANA_2_MODEL, NANO_BANANA_PRO_MODEL } from "../scene-image.js";
import { VEO_TIER_UI_LABELS, OMNI_UI_LABEL, NANO_BANANA_2_UI_LABEL, NANO_BANANA_2_LITE_UI_LABEL, NANO_BANANA_PRO_UI_LABEL } from "./video-model-labels.js";
import { listGeminiModels } from "./gemini-model-discovery.js";

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
  // TASK-003: Nano Banana Pro (economy/balanced/quality tier'ının "quality"
  // ucu) — Nano Banana 2/Lite ile AYNI ilke: Gemini image modelleri
  // (generateContent, GET /v1beta/models discovery'sinde Veo/Omni ile AYNI
  // listede görünür) aynı discoveredModels setine bakılır; discovery
  // başarısızsa yalnızca anahtar varlığına düşülür.
  const nanoBananaProModel = env.GEMINI_NANO_BANANA_PRO_MODEL || NANO_BANANA_PRO_MODEL;
  const nanoBanana2Listed = discoveredModels ? discoveredModels.has(nanoBanana2Model) : true;
  const nanoBanana2LiteListed = discoveredModels ? discoveredModels.has(nanoBanana2LiteModel) : true;
  const nanoBananaProListed = discoveredModels ? discoveredModels.has(nanoBananaProModel) : true;
  const nanoBanana2Available = hasGeminiKey && nanoBanana2Listed;
  const nanoBanana2LiteAvailable = hasGeminiKey && nanoBanana2LiteListed;
  const nanoBananaProAvailable = hasGeminiKey && nanoBananaProListed;

  return {
    google: {
      omni: { available: omniAvailable, models: omniAvailable ? [OMNI_MODEL] : [], label: OMNI_UI_LABEL },
      veo: { available: hasGeminiKey && veoModels.length > 0, models: veoModels, tiers: veoTiers },
      image: {
        nanoBanana2: { available: nanoBanana2Available, model: nanoBanana2Model, label: NANO_BANANA_2_UI_LABEL },
        nanoBanana2Lite: { available: nanoBanana2LiteAvailable, model: nanoBanana2LiteModel, label: NANO_BANANA_2_LITE_UI_LABEL },
        nanoBananaPro: { available: nanoBananaProAvailable, model: nanoBananaProModel, label: NANO_BANANA_PRO_UI_LABEL },
        // TASK-003 acceptance: "economy/balanced/quality image tiers are
        // explicit" — src/scene-image.js'teki IMAGE_TIER_PROVIDERS eşlemesiyle
        // AYNI provider string'lerine işaret eder (dashboard/MCP tool
        // açıklaması bu üçlüyü doğrudan kullanabilir).
        qualityTiers: {
          economy: { provider: "gemini", model: nanoBanana2LiteModel, available: nanoBanana2LiteAvailable },
          balanced: { provider: "nano-banana-2", model: nanoBanana2Model, available: nanoBanana2Available },
          quality: { provider: "nano-banana-pro", model: nanoBananaProModel, available: nanoBananaProAvailable }
        }
      }
    },
    fal: { available: Boolean(env.FAL_KEY) }
  };
}
