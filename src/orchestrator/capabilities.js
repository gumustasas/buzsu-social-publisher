import { listProducts, listRawRecords } from "../lib/products.js";
import { isCatalogProductId, findCatalogProduct } from "../lib/product-catalog.js";
import { baseProductTitle } from "../lib/product-title.js";
import { getBuzsuProductContext } from "../lib/product-intelligence.js";
import { researchWeb } from "../research/index.js";
import { transcribeMedia } from "../transcription/index.js";
import { validateProductVisual } from "../visual-validation/index.js";
import { generateImageFromVideo } from "../video-to-image/index.js";
import { searchProductKnowledge } from "../knowledge/index.js";
import { availableSceneProviders, generateSceneImage } from "../scene-image.js";
import { generateCompositeSceneImage } from "../scene-composite.js";

// TASK-007: bu depoda (api/mcp.js:resolveProduct) ZATEN var olan ürün
// çözümleme mantığının BİREBİR aynısı — ama api/mcp.js'ten import ETMEZ
// (bir src/ modülünün bir api/ route dosyasına bağımlı olması ters bir
// katman ilişkisi olurdu). Bunun yerine listRawRecords/isCatalogProductId/
// findCatalogProduct/baseProductTitle GİBİ ZATEN export edilmiş, paylaşılan
// src/lib/ birincillerini kullanır — Airtable HTTP+pagination mantığı
// (listRawRecords İÇİNDE) TEK bir yerde kalır, burada YENİDEN İCAT EDİLMEZ.
// Salt-okunur bir READ'dir; hiçbir alanı güncellemez (generate_scene_image
// case handler'ındaki Airtable PATCH BİLEREK burada YOKTUR — bkz.
// README "orkestratör güvenlik kararları").
async function resolveOrchestratorProduct(productId) {
  if (isCatalogProductId(productId)) {
    const catalogProduct = await findCatalogProduct(productId);
    if (!catalogProduct) throw new Error("Ürün bulunamadı.");
    return { title: baseProductTitle(catalogProduct.title) || "Buzsu ürünü", url: catalogProduct.url, imageUrl: catalogProduct.imageUrl || "", imageUrls: catalogProduct.imageUrls || [] };
  }
  const records = await listRawRecords();
  const record = records.find((item) => item.id === productId);
  if (!record) throw new Error("Ürün bulunamadı.");
  const fields = record.fields || {};
  return { title: baseProductTitle(fields["Başlık"]) || "Buzsu ürünü", url: fields["Kaynak URL"] || "", imageUrl: fields["Görsel URL"] || "", imageUrls: fields["Görsel URL"] ? [fields["Görsel URL"]] : [] };
}

// generate_scene_image'ın MCP case handler'ındaki provider seçim satırı
// İLE AYNI — ama case handler'ın ARDINDAN geldiği Blob upload + Airtable
// "Görsel URL" PATCH'i (arbitrary external-state update, orkestratörün
// forbidden_capabilities listesi) BİLEREK dahil EDİLMEZ. Bu fonksiyon
// SADECE dataUrl/prompt/provider/model döner, hiçbir kalıcı yan etkisi
// yoktur.
async function runGenerateSceneImage(args, env, deps) {
  const resolveProductImpl = deps.resolveOrchestratorProductImpl || resolveOrchestratorProduct;
  const availableSceneProvidersImpl = deps.availableSceneProvidersImpl || availableSceneProviders;
  const generateSceneImageImpl = deps.generateSceneImageImpl || generateSceneImage;
  const generateCompositeSceneImageImpl = deps.generateCompositeSceneImageImpl || generateCompositeSceneImage;

  const product = await resolveProductImpl(args.productId);
  if (!product.imageUrl) throw new Error("Bu ürünün bilinen bir fotoğrafı yok; önce Görsel URL alanını doldurun.");
  const providers = availableSceneProvidersImpl(env);
  if (!providers.length) throw new Error("AI görsel sağlayıcı anahtarı (GEMINI_API_KEY veya OPENAI_API_KEY) tanımlı değil.");
  const provider = providers.includes(args.provider) ? args.provider : providers[0];

  return provider === "composite"
    ? generateCompositeSceneImageImpl(product, args.sceneDescription, env, {})
    : generateSceneImageImpl(product, args.sceneDescription, env, {
        removeFaucet: Boolean(args.removeFaucet),
        provider,
        aspectRatio: args.aspectRatio
      });
}

// Her capability'nin AÇIK, sınırlı (bounded) bir sözleşmesi vardır:
// allowedArgs dışındaki HİÇBİR alan kabul edilmez, requiredArgs eksikse
// adım hiç çalıştırılmadan REDDEDİLİR (bkz. validate.js) — orkestratörün
// yürütme yetkisi "doğrulanmış şema + state + policy"den gelir, serbest
// biçimli/keyfi bir girdi asla doğrudan bir capability'ye ulaşmaz.
//
// requiresConfirmation:true olan HER capability için confirmed:true
// kontrolü BURADA (registry seviyesinde, ağ çağrısından ÖNCE) yapılır —
// altındaki çekirdek fonksiyonların (researchWeb/transcribeMedia/
// validateProductVisual/generateSceneImage) KENDİ bir confirmed kontrolü
// YOKTUR (bu kontrol normalde SADECE api/mcp.js'in case handler'ında
// yaşar) — orkestratör bu çekirdek fonksiyonları case handler'ı ATLAYARAK
// çağırdığı için, aynı onay kapısını BURADA yeniden uygulamak ZORUNLUDUR
// (manifest: "preserve every existing confirmed:true ... gate").
// generate_image_from_video/search_product_knowledge KENDİ İÇLERİNDE de
// AYRICA confirmed kontrolü yapar (savunma katmanı) — burada erken
// reddetmek yalnızca temiz bir waiting_for_confirmation durumu üretir,
// güvenliği onlar SAĞLAR.
export function createCapabilityRegistry(deps = {}) {
  return {
    list_products: {
      kind: "read",
      requiresConfirmation: false,
      allowedArgs: new Set([]),
      requiredArgs: [],
      run: async (args, env) => (deps.listProductsImpl || listProducts)()
    },
    get_buzsu_product_context: {
      kind: "read",
      requiresConfirmation: false,
      allowedArgs: new Set(["productId", "productUrl", "refresh"]),
      requiredArgs: [],
      run: async (args, env) => {
        if (!args.productId && !args.productUrl) throw new Error('"productId" veya "productUrl" gerekli.');
        return (deps.getBuzsuProductContextImpl || getBuzsuProductContext)({ productId: args.productId, productUrl: args.productUrl, refresh: args.refresh === true });
      }
    },
    research_web: {
      kind: "generate",
      requiresConfirmation: true,
      allowedArgs: new Set(["query", "provider", "urls", "confirmed"]),
      requiredArgs: ["query"],
      run: async (args, env) => (deps.researchWebImpl || researchWeb)({ query: args.query, provider: args.provider, urls: args.urls }, env)
    },
    transcribe_media: {
      kind: "generate",
      requiresConfirmation: true,
      allowedArgs: new Set(["mediaUrl", "provider", "languageHint", "vocabularyHints", "diarization", "confirmed"]),
      requiredArgs: ["mediaUrl"],
      run: async (args, env) => (deps.transcribeMediaImpl || transcribeMedia)(
        { mediaUrl: args.mediaUrl, provider: args.provider, languageHint: args.languageHint, vocabularyHints: args.vocabularyHints, diarization: args.diarization === true },
        env
      )
    },
    generate_scene_image: {
      kind: "generate",
      requiresConfirmation: true,
      allowedArgs: new Set(["productId", "sceneDescription", "provider", "removeFaucet", "aspectRatio", "confirmed"]),
      requiredArgs: ["productId", "sceneDescription"],
      run: async (args, env) => runGenerateSceneImage(args, env, deps)
    },
    validate_product_visual: {
      kind: "generate",
      requiresConfirmation: true,
      allowedArgs: new Set(["referenceImageUrl", "generatedImageUrl", "generatedImageBase64", "generatedImageMimeType", "productTitle", "sceneDescription", "confirmed"]),
      requiredArgs: ["referenceImageUrl"],
      run: async (args, env) => (deps.validateProductVisualImpl || validateProductVisual)(
        {
          referenceImageUrl: args.referenceImageUrl,
          generatedImageUrl: args.generatedImageUrl,
          generatedImageBase64: args.generatedImageBase64,
          generatedImageMimeType: args.generatedImageMimeType,
          productTitle: args.productTitle,
          sceneDescription: args.sceneDescription
        },
        env
      )
    },
    generate_image_from_video: {
      kind: "generate",
      requiresConfirmation: true,
      allowedArgs: new Set(["videoUrl", "prompt", "aspectRatio", "model", "confirmed"]),
      requiredArgs: ["videoUrl", "prompt"],
      run: async (args, env) => (deps.generateImageFromVideoImpl || generateImageFromVideo)(
        { videoUrl: args.videoUrl, prompt: args.prompt, aspectRatio: args.aspectRatio, model: args.model, confirmed: args.confirmed === true },
        env
      )
    },
    search_product_knowledge: {
      kind: "generate",
      requiresConfirmation: true,
      allowedArgs: new Set(["productId", "productUrl", "query", "provider", "confirmed"]),
      requiredArgs: [],
      run: async (args, env) => (deps.searchProductKnowledgeImpl || searchProductKnowledge)(
        { productId: args.productId, productUrl: args.productUrl, query: args.query, provider: args.provider, confirmed: args.confirmed === true },
        env
      )
    }
  };
}

export const ORCHESTRATOR_CAPABILITIES = [
  "list_products",
  "get_buzsu_product_context",
  "research_web",
  "transcribe_media",
  "generate_scene_image",
  "validate_product_visual",
  "generate_image_from_video",
  "search_product_knowledge"
];
