import { KNOWLEDGE_RESPONSE_SCHEMA, buildKnowledgePrompt } from "./prompt.js";

function parseInteractionText(data) {
  if (typeof data.output_text === "string" && data.output_text.trim()) return data.output_text.trim();
  return (data.steps || [])
    .flatMap((step) => step.content || [])
    .filter((block) => block?.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("")
    .trim();
}

function citationsFromInteraction(data) {
  const seen = new Set();
  const out = [];
  for (const block of (data.steps || []).flatMap((step) => step.content || [])) {
    for (const ann of block.annotations || []) {
      if (ann?.type !== "file_citation") continue;
      const source = ann.source || ann.file_name || "";
      const key = `${ann.file_name || ""}|${source}`;
      if (!source || seen.has(key)) continue;
      seen.add(key);
      out.push({ provider: "google", fileName: ann.file_name || "", source });
    }
  }
  return out;
}

export async function searchKnowledgeWithGoogle({ query, authoritative }, env = process.env, { fetchImpl = fetch } = {}) {
  if (!env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY tanımlı değil.");
  const store = String(env.GOOGLE_PRODUCT_KNOWLEDGE_STORE || "").trim();
  if (!store) throw new Error("GOOGLE_PRODUCT_KNOWLEDGE_STORE tanımlı değil.");

  const model = env.GOOGLE_PRODUCT_KNOWLEDGE_MODEL || "gemini-3.7-flash";
  const response = await fetchImpl("https://generativelanguage.googleapis.com/v1beta/interactions", {
    method: "POST",
    headers: { "x-goog-api-key": env.GEMINI_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      input: buildKnowledgePrompt({ query, authoritative }),
      tools: [{ type: "file_search", file_search_store_names: [store] }],
      response_format: {
        type: "text",
        mime_type: "application/json",
        schema: KNOWLEDGE_RESPONSE_SCHEMA
      }
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message || `Gemini knowledge HTTP ${response.status}`);
  const text = parseInteractionText(data);
  if (!text) throw new Error("Gemini File Search boş yanıt döndürdü.");
  let parsed;
  try { parsed = JSON.parse(text); } catch { throw new Error("Gemini File Search geçersiz JSON döndürdü."); }
  if (!Array.isArray(parsed.retrievedFacts) || !Array.isArray(parsed.conflicts) || typeof parsed.answer !== "string") {
    throw new Error("Gemini File Search yanıt şeması geçersiz.");
  }
  return { ...parsed, citations: citationsFromInteraction(data), model };
}
