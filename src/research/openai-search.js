import { openaiTextApiKey } from "../ai-providers.js";

// TASK-001 (research_web) — OpenAI adapter. Responses API'nin "web_search"
// tool'unu kullanır (aynı OPENAI_API_KEY/OPENAI_IMAGE_API_KEY, aynı
// /v1/responses uç noktası — bkz. creative-providers/openai.js). Tool tipinin
// tam adı OpenAI tarafında zaman zaman değişebilir (önceki adı
// "web_search_preview"ydi) — bu isim OPENAI_WEB_SEARCH_TOOL_TYPE ile
// override edilebilir; Perplexity/ROOT review'ı bunu güncel Responses API
// dokümantasyonuna karşı doğrulamalıdır (bkz. tasks/TASK-001, review_by:
// perplexity). GERÇEK PARA HARCAR — confirmed kontrolü çağıran tarafta yapılır.
const DEFAULT_WEB_SEARCH_TOOL_TYPE = "web_search";

export async function researchWithOpenAi({ query, urls = [] }, env = process.env, { fetchImpl = fetch } = {}) {
  const apiKey = openaiTextApiKey(env);
  if (!apiKey) throw new Error("OPENAI_API_KEY/OPENAI_IMAGE_API_KEY tanımlı değil.");

  const model = env.OPENAI_RESEARCH_MODEL || env.OPENAI_REEL_MODEL || "gpt-5.6";
  const toolType = env.OPENAI_WEB_SEARCH_TOOL_TYPE || DEFAULT_WEB_SEARCH_TOOL_TYPE;
  const input = urls.length
    ? `${query}\n\nAşağıdaki URL'lerin güncel içeriğini de dikkate al:\n${urls.join("\n")}`
    : query;

  const response = await fetchImpl("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, input, tools: [{ type: toolType }], store: false })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message || data.error?.type || `OpenAI HTTP ${response.status}`);

  const outputItems = Array.isArray(data.output) ? data.output : [];
  const answer = (data.output_text || outputItems.flatMap((item) => item.content || []).map((item) => item.text || "").join("")).trim();

  // url_citation annotation'ları — Responses API'nin web_search tool
  // çıktısındaki her metin content'ine gerçekten alıntılanan kaynakları
  // ekler (bkz. OpenAI Responses API "annotations"). Annotation şekli
  // değişirse (ör. farklı bir "type") bu liste sessizce boş döner, hata
  // FIRLATMAZ — cevabın kendisi (answer) hâlâ geçerlidir.
  const sources = outputItems
    .flatMap((item) => item.content || [])
    .flatMap((content) => content.annotations || [])
    .filter((annotation) => annotation?.type === "url_citation" && annotation.url)
    .map((annotation) => ({ url: annotation.url, title: annotation.title, provider: "openai" }));

  return { answer, sources, searchQueries: [] };
}
