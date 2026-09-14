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

  const [gemini, openai, openaiImage] = await Promise.all([
    testGemini(process.env.GEMINI_API_KEY),
    testOpenAI(process.env.OPENAI_API_KEY),
    testOpenAI(process.env.OPENAI_IMAGE_API_KEY)
  ]);

  return res.status(200).json({
    GEMINI_API_KEY: gemini,
    OPENAI_API_KEY: openai,
    OPENAI_IMAGE_API_KEY: openaiImage
  });
}
