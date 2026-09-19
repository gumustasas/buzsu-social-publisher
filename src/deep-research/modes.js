import { sanitizeUserText } from "../lib/scenario-schema.js";

// TASK-008 goal metnindeki 3 araştırma modu.
export const RESEARCH_MODES = ["seo", "competitor", "weekly_content_opportunities"];

const MODE_LABELS = {
  seo: "SEO fırsatları, anahtar kelime trendleri ve içerik boşluğu araştırması",
  competitor: "rakip ürün/marka karşılaştırma araştırması",
  weekly_content_opportunities: "haftalık içerik fırsatı ve güncel gündem araştırması"
};

// weekly_content_opportunities için "bu hafta genel olarak ne var" sorusu
// mantıklı bir varsayılana sahiptir; seo/competitor'da objective YOKSA ne
// araştırılacağı BELİRSİZDİR (uydurma bir hedef İCAT EDİLMEZ) — bu yüzden
// bu ikisi için objective ZORUNLUDUR (bkz. validate.js).
const DEFAULT_OBJECTIVE_BY_MODE = {
  weekly_content_opportunities: "Bu hafta Buzsu su arıtma ürünleri için güncel içerik ve trend fırsatları."
};

export function requiresExplicitObjective(mode) {
  return !(mode in DEFAULT_OBJECTIVE_BY_MODE);
}

// research_web'e gönderilecek asıl sorguyu inşa eder. objective/
// productContextSummary serbest metin olabileceği için (kullanıcıdan veya
// başka bir AI adımından gelebilir) sanitizeUserText'ten geçirilip bir VERİ
// bloğu olarak çerçevelenir — bkz. src/visual-validation/prompt.js İLE AYNI
// ilke (TASK-004).
export function buildDeepResearchQuery(mode, { objective, competitors = [], productContextSummary = "" } = {}) {
  const sanitizedObjective = sanitizeUserText(objective, { maxLength: 250 }) || DEFAULT_OBJECTIVE_BY_MODE[mode] || "";
  const label = MODE_LABELS[mode] || mode;
  const competitorBlock = competitors.length ? ` Rakip ürün/markalar: ${competitors.join(", ")}.` : "";
  const contextBlock = productContextSummary ? ` Ürün bağlamı: ${productContextSummary}.` : "";
  return `${label}: ${sanitizedObjective}.${competitorBlock}${contextBlock}`.replace(/\s+/g, " ").trim();
}
