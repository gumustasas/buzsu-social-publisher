import "dotenv/config";
import { getSession } from "../src/auth.js";
import { getBuzsuProductContext } from "../src/lib/product-intelligence.js";
import { generateReelScript } from "../src/reel-script.js";
import { validateReelScript, REEL_DURATIONS, REEL_ASPECT_RATIOS, REEL_OBJECTIVES, ReelScriptError } from "../src/lib/reel-script-schema.js";
import { discoverCreativeModels, CREATIVE_PROVIDERS, CREATIVE_TIERS } from "../src/creative-providers/model-registry.js";

const DISCOVERY_CACHE_TTL_MS = 10 * 60 * 1000;
const MODEL_FIELDS = ["provider", "model", "displayName", "capabilities", "available", "tierCandidate"];
let discoveryCache = null;

function publicModel(model) {
  return Object.fromEntries(MODEL_FIELDS.map((key) => [key, model[key] ?? (key === "available" ? true : null)]));
}

function parseBody(request) {
  return typeof request.body === "string" ? JSON.parse(request.body || "{}") : (request.body || {});
}

function productReference(input = {}) {
  return { productId: input.productId, productUrl: input.productUrl || input.canonicalUrl };
}

async function cachedDiscovery(env, discover, now) {
  const timestamp = now();
  if (discoveryCache && timestamp - discoveryCache.createdAt < DISCOVERY_CACHE_TTL_MS) return discoveryCache.value;
  const value = await discover(env);
  discoveryCache = { createdAt: timestamp, value };
  return value;
}

function errorStatus(error) {
  if (error instanceof SyntaxError) return 400;
  if (error instanceof ReelScriptError) return error.code === "MODEL_UNAVAILABLE" ? 409 : 400;
  if (/confirmed:true/.test(error.message || "")) return 400;
  return 500;
}

export function resetReelScriptDiscoveryCache() {
  discoveryCache = null;
}

export function createReelScriptHandler({
  getSessionImpl = getSession,
  getProductContextImpl = getBuzsuProductContext,
  generateReelScriptImpl = generateReelScript,
  validateReelScriptImpl = validateReelScript,
  discoverCreativeModelsImpl = discoverCreativeModels,
  env = process.env,
  now = Date.now
} = {}) {
  return async function handler(request, response) {
    if (!getSessionImpl(request)) return response.status(401).json({ ok: false, error: "Unauthorized" });
    try {
      const action = String(request.query?.action || "");
      if (request.method === "GET" && action === "options") {
        const discovery = await cachedDiscovery(env, discoverCreativeModelsImpl, now);
        const models = CREATIVE_PROVIDERS.flatMap((provider) =>
          (discovery[provider]?.models || []).map((model) => publicModel({ ...model, provider, available: discovery[provider]?.available === true }))
        );
        return response.status(200).json({
          ok: true,
          durations: REEL_DURATIONS,
          aspectRatios: REEL_ASPECT_RATIOS,
          objectives: REEL_OBJECTIVES,
          tiers: CREATIVE_TIERS,
          providers: ["auto", ...CREATIVE_PROVIDERS],
          models
        });
      }

      if (request.method === "GET" && action === "product-context") {
        const context = await getProductContextImpl(productReference(request.query || {}));
        return response.status(200).json({ ok: true, productContext: context });
      }

      if (request.method === "POST" && action === "generate") {
        const body = parseBody(request);
        const reelScript = await generateReelScriptImpl({
          ...productReference(body),
          provider: body.provider,
          modelTier: body.modelTier,
          model: body.model || undefined,
          objective: body.objective,
          durationSeconds: body.durationSeconds,
          aspectRatio: body.aspectRatio,
          userBrief: body.userBrief,
          confirmed: body.confirmed === true
        }, env);
        return response.status(200).json({ ok: true, reelScript });
      }

      if (request.method === "POST" && action === "validate") {
        const body = parseBody(request);
        const candidate = body.reelScript;
        const durationSeconds = Number(candidate?.durationSeconds);
        if (!REEL_DURATIONS.includes(durationSeconds)) {
          throw new ReelScriptError("ReelScript içindeki durationSeconds geçersiz.", { code: "INVALID_INPUT", details: { durationSeconds } });
        }
        const productContext = await getProductContextImpl(productReference(body));
        const validated = validateReelScriptImpl(candidate, { durationSeconds, productContext, userBrief: body.userBrief });
        return response.status(200).json({
          ok: true,
          reelScript: {
            ...candidate,
            ...validated,
            durationSeconds,
            product: { id: productContext.productId, name: productContext.productName, url: productContext.canonicalUrl }
          }
        });
      }

      if (!["GET", "POST"].includes(request.method)) return response.status(405).json({ ok: false, error: "Method not allowed" });
      return response.status(400).json({ ok: false, error: "Geçersiz action." });
    } catch (error) {
      console.error(error);
      return response.status(errorStatus(error)).json({
        ok: false,
        error: error.message,
        ...(error.code ? { code: error.code } : {}),
        ...(error.details ? { details: error.details } : {})
      });
    }
  };
}

export default createReelScriptHandler();
