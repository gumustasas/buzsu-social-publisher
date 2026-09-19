import { RESEARCH_MODES, requiresExplicitObjective } from "./modes.js";

// Bounded — sınırsız bir rakip listesi research_web'e keyfi büyüklükte bir
// sorgu göndermez (research_web'in kendi MAX_QUERY_LENGTH'i zaten sorguyu
// kırpar, ama burada girdi seviyesinde de AÇIK bir sınır tutulur).
export const MAX_COMPETITORS = 5;

// ROOT review (PR #107): research_web'in (TASK-001, src/research/index.js)
// KENDİ `MAX_URLS` sabiti 5'tir ve export EDİLMEMİŞTİR — bu değer BURADA
// KASITLI OLARAK ayrı, TASK-008'e özgü bir sabit olarak MIRROR edilir
// (research_web'in genel amaçlı `normalizeUrls`'ı fazla URL'i SESSİZCE
// kırpar; TASK-008'in kendi sınırı bu sessiz kırpmadan ÖNCE devreye girip
// FAIL-CLOSED reddetmelidir). TASK-001'in dosyasına DOKUNULMAZ/export
// eklenmez — bu, do_not_touch'taki "provider implementations owned by
// TASK-001... except when a minimal, demonstrated compatibility fix is
// strictly required" ilkesine göre STRICTLY REQUIRED değildir (aynı
// invariant, TASK-001'i hiç değiştirmeden burada da sağlanabilir). Bu
// sabit research_web'in gerçek limiti değişirse MANUEL olarak senkronize
// tutulmalıdır — bkz. README "run_deep_research" bölümü.
export const MAX_URLS = 5;

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ROOT review (PR #107): "malformed optional collections" ilkesi —
// omitted (undefined/null) → [] (sessizce normalize edilir, bu bir
// hata DEĞİLDİR); AÇIKÇA verilmiş ama dizi OLMAYAN bir değer → REDDEDİLİR
// (sessizce [] olarak yeniden yorumlanmaz); dizi ama sınırı AŞAN bir
// uzunluk → REDDEDİLİR (SESSİZCE kırpılmaz — önceki sürümün
// `.slice(0, MAX)` davranışı BİLEREK kaldırıldı); dizi içindeki bir öğe
// string olmayan/boş bir öğe İSE → REDDEDİLİR (malformed bir yapı sessizce
// geçerli bir isim/URL gibi yeniden yorumlanmaz). Tüm bunlar HERHANGİ bir
// capability/ağ çağrısından ÖNCE, senkron olarak kontrol edilir.
function validateOptionalStringArray(raw, { maxLength, fieldName }) {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    throw new Error(`"${fieldName}" bir dizi olmalı.`);
  }
  if (raw.length > maxLength) {
    throw new Error(`"${fieldName}" en fazla ${maxLength} öğe içerebilir (gönderilen: ${raw.length}). Sessizce kırpılmaz — daha az öğeyle yeniden gönderin.`);
  }
  return raw.map((item, index) => {
    if (typeof item !== "string" || !item.trim()) {
      throw new Error(`"${fieldName}[${index}]" geçerli, boş olmayan bir metin (string) olmalı.`);
    }
    return item.trim();
  });
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

  const competitors = validateOptionalStringArray(input.competitors, { maxLength: MAX_COMPETITORS, fieldName: "competitors" });
  const urls = validateOptionalStringArray(input.urls, { maxLength: MAX_URLS, fieldName: "urls" });

  return {
    mode,
    objective,
    competitors,
    urls,
    productId: input.productId ? String(input.productId).trim() : "",
    productUrl: input.productUrl ? String(input.productUrl).trim() : "",
    productKnowledgeQuery: input.productKnowledgeQuery ? String(input.productKnowledgeQuery).trim() : "",
    provider: input.provider,
    confirmed: input.confirmed === true
  };
}
