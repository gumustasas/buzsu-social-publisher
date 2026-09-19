// TASK-004 (validate_product_visual): 7 sabit, somut kontrol kategorisi —
// src/lib/scene-validation.js:SCENE_VALIDATION_CHECKS İLE AYNI ilke: karar
// modelin kendi verdiği bir "confidence"/güven puanından DEĞİL, bu sabit
// listedeki kontrol kodlarından türetilir. LLM'lerin kendi güven puanları
// genelde kalibrasyonsuzdur; "hangi kontrol başarısız oldu" ise
// denetlenebilir ve MCP yanıtında doğrudan gösterilebilir. Prompt (bkz.
// prompt.js) modelden bir sayısal puan İSTEMEZ/ÜRETMEZ — bu dosya da hiçbir
// koşulda öyle bir alanı okumaz/kullanmaz.
export const VISUAL_VALIDATION_CHECKS = [
  "identity",
  "logo",
  "label",
  "proportions",
  "component_count",
  "installation",
  "fabricated_text"
];

const VISUAL_VALIDATION_CHECK_SET = new Set(VISUAL_VALIDATION_CHECKS);

// Modelin döndürdüğü ham failedChecks listesini sabit kod kümesine karşı
// filtreler — halüsinasyon/uydurma bir kontrol kodu (veya sayı/obje gibi
// beklenmeyen bir tür) SESSİZCE bir "başarısız kontrol" olarak kabul
// edilmez, elenir.
export function normalizeFailedChecks(rawFailedChecks) {
  if (!Array.isArray(rawFailedChecks)) return [];
  return [...new Set(rawFailedChecks.filter((check) => VISUAL_VALIDATION_CHECK_SET.has(check)))];
}
