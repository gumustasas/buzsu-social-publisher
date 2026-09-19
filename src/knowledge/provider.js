import { openaiTextApiKey } from "../ai-providers.js";

export const KNOWLEDGE_PROVIDERS = ["google", "openai"];

export function configuredKnowledgeProviders(env = process.env) {
  return {
    google: Boolean(env.GEMINI_API_KEY && env.GOOGLE_PRODUCT_KNOWLEDGE_STORE),
    openai: Boolean(openaiTextApiKey(env) && env.OPENAI_PRODUCT_KNOWLEDGE_VECTOR_STORE_ID)
  };
}

export function resolveKnowledgeProvider(requested = "auto", env = process.env) {
  if (!["auto", ...KNOWLEDGE_PROVIDERS].includes(requested)) {
    throw new Error(`Geçersiz knowledge provider: ${requested}`);
  }
  const configured = configuredKnowledgeProviders(env);
  if (requested !== "auto") {
    return configured[requested]
      ? { provider: requested, available: true }
      : { provider: requested, available: false, reason: "missing_api_key_or_store" };
  }
  if (configured.google) return { provider: "google", available: true };
  if (configured.openai) return { provider: "openai", available: true };
  return { provider: null, available: false, reason: "no_configured_provider" };
}
