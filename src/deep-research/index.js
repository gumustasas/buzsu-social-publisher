import { sanitizeUserText } from "../lib/scenario-schema.js";
import { researchWeb } from "../research/index.js";
import { searchProductKnowledge } from "../knowledge/index.js";
import { getBuzsuProductContext } from "../lib/product-intelligence.js";
import { RESEARCH_MODES, buildDeepResearchQuery } from "./modes.js";
import { validateDeepResearchInput } from "./validate.js";
import { redactSecrets } from "./redact.js";

export { RESEARCH_MODES };

// TASK-008: bu modülün TEK ağa dokunan bağımlılığı — sabit bir allowlist.
// publish_now/create_draft/update_draft/update_status/set_autopilot/
// upload_media/delete/env/deployment İLGİLİ HİÇBİR ŞEY burada import
// EDİLMEZ/çağrılmaz; deep-research SALT-OKUNURDUR (bkz. src/orchestrator/
// capabilities.js İLE AYNI ilke, TASK-007 — ama BU modül ona bağımlı
// DEĞİLDİR, kendi bağımsız allowlist'ini tutar, TASK-008'in depends_on'u
// yalnız TASK-001/TASK-006'dır).
export const DEEP_RESEARCH_ALLOWED_CAPABILITIES = ["research_web", "search_product_knowledge", "get_buzsu_product_context"];

// GERÇEK PARA HARCAR — bu TEK confirmed:true, generate_reel_script'in
// KENDİ isteğe bağlı research_web alt-çağrısını AYNI onay altında yapması
// İLE AYNI ilke (bkz. README "AI Reels V2 — generate_reel_script"): deep
// research sabit, çağıranın seçtiği ADIMLARDAN oluşan genel bir plan
// DEĞİLDİR (TASK-007'nin orchestrator'ının aksine) — tek, bütün bir
// araştırma akışıdır, bu yüzden TEK bir üst-seviye onay yeterli ve
// tutarlıdır. confirmed:true olmadan (get_buzsu_product_context gibi
// ÜCRETSİZ bir alt-adım dahi) HİÇBİR çağrı yapılmaz — konfirmasyon asla
// kendiliğinden üretilmez.
export async function runDeepResearch(input = {}, env = process.env, deps = {}) {
  try {
    const normalized = validateDeepResearchInput(input);
    if (normalized.confirmed !== true) {
      throw new Error("Bu işlem gerçek API kredisi harcar (research_web ve/veya search_product_knowledge). Onaylamak için confirmed:true gönderin.");
    }

    const researchWebImpl = deps.researchWebImpl || researchWeb;
    const searchProductKnowledgeImpl = deps.searchProductKnowledgeImpl || searchProductKnowledge;
    const getBuzsuProductContextImpl = deps.getBuzsuProductContextImpl || getBuzsuProductContext;

    const capabilitiesUsed = [];
    const findings = [];
    const sources = [];
    const uncertainty = [];
    let conflicts = [];

    // ÜCRETSİZ, salt-okunur ürün bağlamı — productId/productUrl verilmişse
    // her zaman denenir (research_web sorgusunu zenginleştirmek için),
    // hiçbir ayrı ücret/onay GEREKMEZ.
    let productContextSummary = "";
    if (normalized.productId || normalized.productUrl) {
      const context = await getBuzsuProductContextImpl({ productId: normalized.productId || undefined, productUrl: normalized.productUrl || undefined });
      capabilitiesUsed.push("get_buzsu_product_context");
      const summaryParts = [context.productName, ...(Array.isArray(context.sellingPoints) ? context.sellingPoints.slice(0, 3) : [])].filter(Boolean);
      productContextSummary = sanitizeUserText(summaryParts.join("; "), { maxLength: 300 });
    }

    const query = buildDeepResearchQuery(normalized.mode, {
      objective: normalized.objective,
      competitors: normalized.competitors,
      productContextSummary
    });

    // TASK-001 research katmanı REUSE edilir — kendi provider mantığı
    // (google/openai seçimi, sessiz fallback YOK) burada TEKRARLANMAZ.
    const webResult = await researchWebImpl({ query, provider: normalized.provider, urls: normalized.urls }, env);
    capabilitiesUsed.push(`research_web:${webResult.provider}`);
    findings.push({ capability: "research_web", provider: webResult.provider, answer: webResult.answer });
    for (const source of webResult.sources) sources.push({ ...source, capability: "research_web" });

    if (!webResult.sources.length) {
      uncertainty.push("research_web hiçbir kaynak döndürmedi; cevap doğrulanabilir bir web kaynağına dayanmıyor olabilir.");
    } else if (webResult.sources.length === 1) {
      uncertainty.push("research_web yalnızca 1 kaynağa dayanıyor; tek kaynaklı bir bulgu olarak değerlendirin.");
    }

    // TASK-006 product-knowledge katmanı YALNIZ caller AÇIKÇA bir
    // productKnowledgeQuery verdiğinde ve bir ürün bağlamı (productId/
    // productUrl) varken çağrılır — otomatik/örtük DEĞİLDİR, çünkü bu
    // AYRICA ücretli bir File Search/model çağrısıdır.
    if (normalized.productKnowledgeQuery && (normalized.productId || normalized.productUrl)) {
      const knowledgeResult = await searchProductKnowledgeImpl(
        {
          productId: normalized.productId || undefined,
          productUrl: normalized.productUrl || undefined,
          query: normalized.productKnowledgeQuery,
          provider: normalized.provider,
          confirmed: true
        },
        env
      );
      capabilitiesUsed.push(`search_product_knowledge:${knowledgeResult.provider}`);
      findings.push({ capability: "search_product_knowledge", provider: knowledgeResult.provider, answer: knowledgeResult.answer });
      for (const citation of knowledgeResult.citations || []) sources.push({ ...citation, capability: "search_product_knowledge" });
      // TASK-006'nın KENDİ çelişki tespiti REUSE edilir — burada sessizce
      // yeniden çözülmez/atlanmaz, olduğu gibi yüzeye çıkarılır.
      conflicts = knowledgeResult.conflicts || [];
      if (knowledgeResult.hasConflicts) {
        uncertainty.push("search_product_knowledge, yüksek-otoriteli kaynaklarla dokümanlar arasında çelişki buldu (bkz. conflicts).");
      }
    }

    return {
      query_or_objective: normalized.objective || query,
      findings,
      sources,
      uncertainty,
      conflicts,
      providers_or_capabilities_used: capabilitiesUsed
    };
  } catch (err) {
    throw new Error(redactSecrets(err.message, env));
  }
}
