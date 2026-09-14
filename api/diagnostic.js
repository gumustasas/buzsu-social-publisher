import { getSession } from "../src/auth.js";
import {
  CREATIVE_PROVIDERS,
  CREATIVE_TIERS,
  CREATIVE_TIER_ENV_VARS,
  discoverCreativeModels,
  resolveTier
} from "../src/creative-providers/model-registry.js";

function buildResult({
  envPresent = false,
  httpStatus = null,
  success = false,
  modelCount = 0,
  errorType = null,
  errorCode = null,
  models = []
} = {}) {
  return { envPresent, httpStatus, success, modelCount, errorType, errorCode, models };
}

async function testGemini(key) {
  if (!key) return buildResult({ envPresent: false });
  try {
    const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models", {
      headers: { "x-goog-api-key": key }
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return buildResult({
        envPresent: true,
        httpStatus: res.status,
        success: false,
        errorType: data.error?.status || "ProviderError",
        errorCode: data.error?.code || res.status
      });
    }
    const models = (data.models || []).map((model) => model.name).filter(Boolean);
    return buildResult({
      envPresent: true,
      httpStatus: res.status,
      success: true,
      modelCount: models.length,
      models
    });
  } catch (error) {
    return buildResult({
      envPresent: true,
      success: false,
      errorType: "NetworkError",
      errorCode: error?.name || "FetchFailed"
    });
  }
}

async function testOpenAI(key) {
  if (!key) return buildResult({ envPresent: false });
  try {
    const res = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${key}` }
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return buildResult({
        envPresent: true,
        httpStatus: res.status,
        success: false,
        errorType: data.error?.type || "ProviderError",
        errorCode: data.error?.code || res.status
      });
    }
    const models = (data.data || []).map((model) => model.id).filter(Boolean);
    return buildResult({
      envPresent: true,
      httpStatus: res.status,
      success: true,
      modelCount: models.length,
      models
    });
  } catch (error) {
    return buildResult({
      envPresent: true,
      success: false,
      errorType: "NetworkError",
      errorCode: error?.name || "FetchFailed"
    });
  }
}

function buildCreativeTierDiagnostics(discovery, env = process.env) {
  const output = {};
  for (const provider of CREATIVE_PROVIDERS) {
    output[provider] = {};
    for (const tier of CREATIVE_TIERS) {
      const envVar = CREATIVE_TIER_ENV_VARS[provider][tier];
      const configuredModel = env[envVar] || null;
      const resolved = resolveTier(provider, tier, discovery, env);
      output[provider][tier] = {
        envVar,
        configured: Boolean(configuredModel),
        configuredModel,
        providerAvailable: Boolean(discovery[provider]?.available),
        discovered: Boolean(configuredModel && discovery[provider]?.models?.some((entry) => entry.model === configuredModel)),
        available: resolved.available,
        reason: resolved.available ? null : resolved.reason
      };
    }
  }
  return output;
}

export default async function handler(req, res) {
  res.setHeader?.("Cache-Control", "no-store, max-age=0");

  if (req.method && req.method !== "GET") {
    res.setHeader?.("Allow", "GET");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const session = getSession(req);
  if (!session) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  if (session.role !== "Admin") {
    return res.status(403).json({ error: "Forbidden" });
  }

  const [gemini, openai, openaiImage, creativeDiscovery] = await Promise.all([
    testGemini(process.env.GEMINI_API_KEY),
    testOpenAI(process.env.OPENAI_API_KEY),
    testOpenAI(process.env.OPENAI_IMAGE_API_KEY),
    discoverCreativeModels(process.env, { fetchImpl: fetch })
  ]);

  return res.status(200).json({
    GEMINI_API_KEY: gemini,
    OPENAI_API_KEY: openai,
    OPENAI_IMAGE_API_KEY: openaiImage,
    CREATIVE_TIERS: buildCreativeTierDiagnostics(creativeDiscovery)
  });
}
