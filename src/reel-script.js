import crypto from "node:crypto";
import { getBuzsuProductContext } from "./lib/product-intelligence.js";
import { discoverCreativeModels, resolveTier, resolveAutoSelection, isModelSelectable, CREATIVE_TIERS, CREATIVE_PROVIDERS } from "./creative-providers/model-registry.js";
import { generateReelScriptOpenAi } from "./creative-providers/openai.js";
import { generateReelScriptGoogle } from "./creative-providers/google.js";
import { buildReelScriptPrompt } from "./creative-providers/reel-script-prompt.js";
import { validateReelScript, ReelScriptError, REEL_OBJECTIVES, REEL_ASPECT_RATIOS, REEL_DURATIONS } from "./lib/reel-script-schema.js";
import { researchWeb, RESEARCH_PROVIDERS } from "./research/index.js";

// TASK-001: researchMode TAMAMEN İSTEĞE BAĞLIDIR ve varsayılanı "none"dir —
// verilmezse research_web'e HİÇBİR istek atılmaz, prompt eskisiyle AYNI
// kalır (bkz. creative-providers/reel-script-prompt.js researchContext).
// "auto"/"google"/"openai" verilirse researchWeb'in KENDİ auto/no-silent-
// fallback sözleşmesi (bkz. research/provider.js) burada da AYNEN geçerlidir.
const RESEARCH_MODES = ["none", "auto", ...RESEARCH_PROVIDERS];

// generate_reel_script (AI Reels V2 PR-C) — Product Intelligence (PR-A) ile
// Creative Provider katmanını (PR-B) birbirine bağlayan ana orkestrasyon:
//
//   productId/productUrl -> getBuzsuProductContext -> verified product facts
//   -> provider/model resolution (model-registry.js) -> structured ReelScript
//   -> validateReelScript (structure/timing/narration/veo constraints;
//      product-claim doğruluğu BLOKLAMAZ, claimsUsed yalnız işaretlenir)
//   -> kullanıcıya sonuç
//
// Bu adımda Veo/TTS/Lyria/Omni/FFmpeg HİÇ ÇALIŞTIRILMAZ — yalnızca senaryo
// üretimi. GERÇEK PARA HARCAR (bir inference çağrısıdır) — confirmed:true
// olmadan hiçbir provider'a istek atılmaz.

const GENERATOR_BY_PROVIDER = { openai: generateReelScriptOpenAi, google: generateReelScriptGoogle };

function assertEnum(value, allowed, fieldName) {
  if (!allowed.includes(value)) {
    throw new ReelScriptError(`"${fieldName}" geçersiz: "${value}". Geçerli değerler: ${allowed.join(", ")}.`, { code: "INVALID_INPUT", details: { field: fieldName, value, allowed } });
  }
}

// model verilmişse (Özel mod) provider "auto" OLAMAZ — bir model ismi
// hangi sağlayıcıya ait olduğunu belirtmeden anlamsızdır; provider+model
// ikisi de AÇIKÇA verilmelidir.
function resolveProviderAndModel({ provider, modelTier, model }, discovery, env) {
  if (model) {
    if (!CREATIVE_PROVIDERS.includes(provider)) {
      throw new ReelScriptError('"model" verildiğinde "provider" açıkça "openai" veya "google" olmalı (auto olamaz).', { code: "INVALID_INPUT", details: { provider, model } });
    }
    if (!isModelSelectable(provider, model, discovery)) {
      throw new ReelScriptError(`Model "${model}" (${provider}) gerçek discovery'de bulunamadı/erişilebilir değil — serbest yazılmış model adları kabul edilmez.`, {
        code: "MODEL_UNAVAILABLE",
        details: { provider, model, reason: "model_not_selectable" }
      });
    }
    return { provider, model, tierUsed: null };
  }

  assertEnum(modelTier, CREATIVE_TIERS, "modelTier");
  const resolved = provider === "auto" ? resolveAutoSelection(modelTier, discovery, env) : resolveTier(provider, modelTier, discovery, env);
  if (!resolved.available) {
    throw new ReelScriptError(`"${modelTier}" tier'ı için erişilebilir bir model bulunamadı (${resolved.reason}).`, {
      code: "MODEL_UNAVAILABLE",
      details: { provider, modelTier, reason: resolved.reason }
    });
  }
  return { provider: resolved.provider, model: resolved.model, tierUsed: modelTier };
}

export async function generateReelScript(input = {}, env = process.env, deps = {}) {
  const {
    productContextDeps = {},
    discoveryDeps = {},
    generationDeps = {},
    researchDeps = {},
    randomUUIDImpl = crypto.randomUUID
  } = deps;

  // GERÇEK PARA HARCAR — confirmed:true olmadan HİÇBİR provider'a (ne
  // OpenAI ne Google, ne de researchMode!=none iken research_web'e) istek
  // atılmaz. Otomatik ücretli fallback de YOKTUR.
  if (input.confirmed !== true) {
    throw new Error("Senaryo üretimi gerçek bir AI inference çağrısıdır ve ücretlidir. Onaylamak için confirmed:true gönderin.");
  }

  const durationSeconds = Number(input.durationSeconds);
  assertEnum(durationSeconds, REEL_DURATIONS, "durationSeconds");
  assertEnum(input.objective, REEL_OBJECTIVES, "objective");
  const aspectRatio = input.aspectRatio || "9:16";
  assertEnum(aspectRatio, REEL_ASPECT_RATIOS, "aspectRatio");
  const provider = input.provider || "auto";
  if (!["auto", ...CREATIVE_PROVIDERS].includes(provider)) {
    throw new ReelScriptError(`"provider" geçersiz: "${provider}". Geçerli değerler: auto, ${CREATIVE_PROVIDERS.join(", ")}.`, { code: "INVALID_INPUT" });
  }
  const researchMode = input.researchMode || "none";
  if (!RESEARCH_MODES.includes(researchMode)) {
    throw new ReelScriptError(`"researchMode" geçersiz: "${researchMode}". Geçerli değerler: ${RESEARCH_MODES.join(", ")}.`, { code: "INVALID_INPUT" });
  }

  // productId/productUrl'den EN AZ biri yeterli — bu kural getBuzsuProductContext'in
  // KENDİSİNDE zaten var (PR-A), burada tekrar edilmiyor.
  const productContext = await getBuzsuProductContext({ productId: input.productId, productUrl: input.productUrl }, productContextDeps);

  // researchMode "none" (varsayılan) olduğunda research_web'e HİÇ istek
  // atılmaz — TASK-001 acceptance'ının "generate_reel_script remains
  // researchMode=none by default" gereksinimi budur. Sorgu verilmezse ürün
  // adı kullanılır (uydurma bir değer değil, zaten çözülmüş productContext'ten).
  let research = null;
  if (researchMode !== "none") {
    const researchQuery = String(input.researchQuery || "").trim() || productContext.productName;
    research = await researchWeb({ provider: researchMode, query: researchQuery, urls: input.researchUrls }, env, researchDeps);
  }
  const researchContext = research
    ? [research.answer, ...research.sources.map((source) => `- ${source.title} (${source.url})`)].filter(Boolean).join("\n")
    : "";

  const discovery = await discoverCreativeModels(env, discoveryDeps);
  const { provider: resolvedProvider, model: resolvedModel, tierUsed } = resolveProviderAndModel(
    { provider, modelTier: input.modelTier, model: input.model || null },
    discovery,
    env
  );

  const promptText = buildReelScriptPrompt({ productContext, userBrief: input.userBrief, durationSeconds, objective: input.objective, aspectRatio, researchContext });
  const generate = GENERATOR_BY_PROVIDER[resolvedProvider];
  const rawCandidate = await generate({ model: resolvedModel, promptText }, env, generationDeps);
  const validated = validateReelScript(rawCandidate, { durationSeconds, productContext });

  return {
    scriptId: randomUUIDImpl(),
    product: { id: productContext.productId, name: productContext.productName, url: productContext.canonicalUrl },
    provider: resolvedProvider,
    modelUsed: resolvedModel,
    modelTier: tierUsed,
    objective: input.objective,
    durationSeconds,
    aspectRatio,
    researchMode,
    research: research ? { provider: research.provider, query: research.query, sources: research.sources } : null,
    ...validated
  };
}
