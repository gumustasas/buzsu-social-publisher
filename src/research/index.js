import { RESEARCH_PROVIDERS, resolveResearchProvider } from "./provider.js";
import { researchWithGoogle } from "./google-search.js";
import { researchWithOpenAi } from "./openai-search.js";
import { normalizeSources } from "./normalize.js";

// TASK-001: provider-independent research katmanı — research_web (bkz.
// api/mcp.js) ve generate_reel_script'in isteğe bağlı researchMode'u (bkz.
// src/reel-script.js) BU tek fonksiyonu kullanır. Google Search Grounding +
// URL Context ve OpenAI Web Search ARASINDA hiçbir sessiz ücretli fallback
// yoktur (bkz. resolveResearchProvider) — generate_reel_script'in
// creative-providers/model-registry.js'teki resolveAutoSelection ile AYNI
// ilkesi.

export { RESEARCH_PROVIDERS };

const RUNNER_BY_PROVIDER = { google: researchWithGoogle, openai: researchWithOpenAi };
const MAX_URLS = 5;
const MAX_QUERY_LENGTH = 300;

function normalizeUrls(urls) {
  if (!Array.isArray(urls)) return [];
  return urls.map((url) => String(url || "").trim()).filter(Boolean).slice(0, MAX_URLS);
}

export async function researchWeb(input = {}, env = process.env, deps = {}) {
  const query = String(input.query || "").trim().slice(0, MAX_QUERY_LENGTH);
  if (!query) throw new Error('"query" gerekli.');

  const provider = input.provider || "auto";
  if (!["auto", ...RESEARCH_PROVIDERS].includes(provider)) {
    throw new Error(`"provider" geçersiz: "${provider}". Geçerli değerler: auto, ${RESEARCH_PROVIDERS.join(", ")}.`);
  }
  const urls = normalizeUrls(input.urls);

  const resolved = resolveResearchProvider(provider, env);
  if (!resolved.available) {
    const scope = provider === "auto" ? "auto (google/openai)" : provider;
    throw new Error(`Research provider "${scope}" için API key yapılandırılmamış (${resolved.reason}). Başka bir ücretli sağlayıcıya sessizce geçilmez.`);
  }

  const runner = RUNNER_BY_PROVIDER[resolved.provider];
  const raw = await runner({ query, urls }, env, deps);
  const sources = normalizeSources(raw.sources);
  if (!raw.answer && !sources.length) {
    throw new Error("Research sağlayıcısı boş bir yanıt döndürdü (ne metin ne kaynak).");
  }

  return {
    provider: resolved.provider,
    query,
    urls,
    answer: raw.answer || "",
    sources,
    searchQueries: Array.isArray(raw.searchQueries) ? raw.searchQueries : []
  };
}
