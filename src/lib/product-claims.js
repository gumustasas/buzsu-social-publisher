import { riskyClaims } from "../content-worker.js";

// get_buzsu_product_context'in (bkz. product-intelligence.js) prohibitedClaims
// alanı için: "sayfada geçmeyen HER ŞEYİ" listeleyen sonsuz bir alan DEĞİL,
// sabit ve küçük (5) bir iddia KATEGORİSİ listesi. Her kategori, kaynak
// metinde (llms-full.txt penceresi + varsa destekleyici sayfa metni) EN AZ
// BİR deseniyle eşleşirse "kaynakta doğrulanabilir" sayılır ve
// prohibitedClaims'e DÜŞMEZ — o durumda kategoriye ait gerçek metin zaten
// verifiedFacts'te sourceUrl ile yer alır. Eşleşme yoksa kategori
// prohibitedClaims'e eklenir: bu, AI Creative Director'a (PR-C) "bu
// kategoride kaynak yok, uydurma" sinyalidir.
//
// "health" kategorisi content-worker.js'teki mevcut riskyClaims deseni
// AYNEN reuse eder (yeni bir liste icat edilmedi) — orijinal istekte
// belirtilen sertifika/menşe/garanti/tasarruf/performans kategorileri ona
// EK olarak tanımlandı.
export const CLAIM_CATEGORIES = [
  { id: "health", label: "Sağlık/tedavi/kesinlik iddiası", patterns: riskyClaims },
  { id: "certification", label: "Sertifika/standart iddiası", patterns: [/sertifika/i, /\btse\b/i, /\bce\b/i, /iso\s?\d{3,5}/i, /onaylı/i] },
  { id: "warranty", label: "Garanti iddiası", patterns: [/garanti/i] },
  { id: "performance", label: "Performans/tasarruf oranı iddiası", patterns: [/tasarruf/i, /verim/i, /performans/i, /%\s?\d/i] },
  { id: "origin", label: "Menşe/üretim yeri iddiası", patterns: [/made in/i, /menşe/i, /üretim yeri/i, /orijinal/i] }
];

// riskyClaims (ve bazı yukarıdaki desenler) global (`g`) bayraklı — global
// regex'lerde .test() lastIndex'i ilerletip bir sonraki çağrıyı bozar
// (content-worker.js'in kendi findRiskyClaim'i de bu yüzden lastIndex'i
// sıfırlar). Her denemeden önce sıfırlanıyor.
function matchesCategory(text, patterns) {
  return patterns.some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(text);
  });
}

export function classifyProhibitedClaims(sourceText) {
  const text = String(sourceText || "");
  return CLAIM_CATEGORIES
    .filter((category) => !matchesCategory(text, category.patterns))
    .map(({ id, label }) => ({
      category: id,
      label,
      reason: "Kaynak metinde bu kategoriye ait doğrulanmış bir ifade bulunamadı; senaryoda kullanılmamalı/uydurulmamalı."
    }));
}
