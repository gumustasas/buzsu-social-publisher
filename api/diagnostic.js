import { getSession } from "../src/auth.js";

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
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`);
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
    const models = (data.models || []).map(m => m.name);
    return buildResult({
      envPresent: true,
      httpStatus: res.status,
      success: true,
      modelCount: models.length,
      models
    });
  } catch (e) {
    return buildResult({
      envPresent: true,
      success: false,
      errorType: "NetworkError",
      errorCode: e.name || "FetchFailed"
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
    const models = (data.data || []).map(m => m.id);
    return buildResult({
      envPresent: true,
      httpStatus: res.status,
      success: true,
      modelCount: models.length,
      models
    });
  } catch (e) {
    return buildResult({
      envPresent: true,
      success: false,
      errorType: "NetworkError",
      errorCode: e.name || "FetchFailed"
    });
  }
}

export default async function handler(req, res) {
  const session = getSession(req);
  if (!session) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const results = {
    GEMINI_API_KEY: await testGemini(process.env.GEMINI_API_KEY),
    OPENAI_API_KEY: await testOpenAI(process.env.OPENAI_API_KEY),
    OPENAI_IMAGE_API_KEY: await testOpenAI(process.env.OPENAI_IMAGE_API_KEY)
  };

  res.status(200).json(results);
}
