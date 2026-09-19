import { openaiTextApiKey } from "../ai-providers.js";
import { KNOWLEDGE_RESPONSE_SCHEMA, buildKnowledgePrompt } from "./prompt.js";

function outputText(data) {
  if (typeof data.output_text === "string" && data.output_text.trim()) return data.output_text.trim();
  return (data.output || [])
    .flatMap((item) => item.content || [])
    .filter((content) => typeof content.text === "string")
    .map((content) => content.text)
    .join("")
    .trim();
}

function fileSearchResults(data) {
  const seen = new Set();
  const out = [];
  for (const item of data.output || []) {
    if (item?.type !== "file_search_call") continue;
    for (const result of item.results || []) {
      const key = `${result.file_id || ""}|${result.filename || ""}|${result.text || ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        provider: "openai",
        fileId: result.file_id || "",
        fileName: result.filename || "",
        score: typeof result.score === "number" ? result.score : null,
        text: String(result.text || "")
      });
    }
  }
  return out;
}

export async function searchKnowledgeWithOpenAi({ query, authoritative }, env = process.env, { fetchImpl = fetch } = {}) {
  const apiKey = openaiTextApiKey(env);
  if (!apiKey) throw new Error("OPENAI_API_KEY/OPENAI_IMAGE_API_KEY tanımlı değil.");
  const vectorStoreId = String(env.OPENAI_PRODUCT_KNOWLEDGE_VECTOR_STORE_ID || "").trim();
  if (!vectorStoreId) throw new Error("OPENAI_PRODUCT_KNOWLEDGE_VECTOR_STORE_ID tanımlı değil.");

  const model = env.OPENAI_PRODUCT_KNOWLEDGE_MODEL || env.OPENAI_REEL_MODEL || "gpt-5.6";
  const response = await fetchImpl("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      input: buildKnowledgePrompt({ query, authoritative }),
      tools: [{ type: "file_search", vector_store_ids: [vectorStoreId] }],
      include: ["file_search_call.results"],
      text: {
        format: {
          type: "json_schema",
          name: "buzsu_product_knowledge",
          strict: true,
          schema: KNOWLEDGE_RESPONSE_SCHEMA
        }
      },
      store: false
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message || data.error?.type || `OpenAI knowledge HTTP ${response.status}`);
  const text = outputText(data);
  if (!text) throw new Error("OpenAI File Search boş yanıt döndürdü.");
  let parsed;
  try { parsed = JSON.parse(text); } catch { throw new Error("OpenAI File Search geçersiz JSON döndürdü."); }
  if (!Array.isArray(parsed.retrievedFacts) || !Array.isArray(parsed.conflicts) || typeof parsed.answer !== "string") {
    throw new Error("OpenAI File Search yanıt şeması geçersiz.");
  }
  return { ...parsed, citations: fileSearchResults(data), model };
}
