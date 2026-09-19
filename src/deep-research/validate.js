import { RESEARCH_MODES, requiresExplicitObjective } from "./modes.js";

// Bounded — sınırsız bir rakip listesi research_web'e keyfi büyüklükte bir
// sorgu göndermez (research_web'in kendi MAX_QUERY_LENGTH'i zaten sorguyu
// kırpar, ama burada girdi seviyesinde de AÇIK bir sınır tutulur).
export const MAX_COMPETITORS = 5;

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// TASK-008: "malformed or unsupported research modes are rejected" —
// hiçbir ağ çağrısından ÖNCE, tüm girdi TEK seferde doğrulanır ve normalize
// edilir. mode allowlist'te değilse veya seo/competitor için objective
// eksikse burada REDDEDİLİR.
export function validateDeepResearchInput(input) {
  if (!isPlainObject(input)) throw new Error('"input" bir nesne olmalı.');

  const mode = String(input.mode || "").trim();
  if (!RESEARCH_MODES.includes(mode)) {
    throw new Error(`Desteklenmeyen veya bilinmeyen research mode: "${mode || "(boş)"}". Geçerli değerler: ${RESEARCH_MODES.join(", ")}.`);
  }

  const objective = input.objective !== undefined && input.objective !== null ? String(input.objective) : "";
  if (requiresExplicitObjective(mode) && !objective.trim()) {
    throw new Error(`"objective" gerekli — "${mode}" modu için varsayılan bir objective yoktur, uydurma bir hedef kullanılmaz.`);
  }

  const competitors = Array.isArray(input.competitors)
    ? input.competitors.map((item) => String(item || "").trim()).filter(Boolean).slice(0, MAX_COMPETITORS)
    : [];

  return {
    mode,
    objective,
    competitors,
    urls: Array.isArray(input.urls) ? input.urls : [],
    productId: input.productId ? String(input.productId).trim() : "",
    productUrl: input.productUrl ? String(input.productUrl).trim() : "",
    productKnowledgeQuery: input.productKnowledgeQuery ? String(input.productKnowledgeQuery).trim() : "",
    provider: input.provider,
    confirmed: input.confirmed === true
  };
}
