import { createHash } from "node:crypto";

// fal.ai ve Veo aynı, provider-bağımsız prompt modelini kullanır. İkisine de
// onaylanmış sahne görseli referans olarak veriliyor, bu yüzden PRESERVE/
// CONSTRAINTS metinde sahnedeki nesneleri (dolap, musluk, aile vb.) tek tek
// saymaya çalışmıyor — model zaten görseli görüyor; metnin işi "gördüğünü
// koru" demek. Ürüne özgü tek değişken ürün adı. MOTION ise kullanıcının
// yazdığı serbest metin ya da (boşsa) AI'ın sahne açıklamasından türettiği
// kısa bir hareket planı olabilir; bu prompt modelinin kendisi hangisi
// olduğunu bilmez, sadece hazır bir motion string'i bekler.
const GENERIC_MOTION = "Kamera hafifçe yaklaşsın, ürün ve sahnedeki her şey doğal biçimde sabit kalsın; ani veya abartılı hareket olmasın.";

// fal.ai (fal-ai/minimax-video/image-to-video) prompt alanını 2000 karakterle
// sınırlıyor ("Error validating the input: String should have at most 2000
// characters" — gerçek bir denemede görüldü). Bu sınır provider'a bağlı
// gibi görünse de fal.ai ile Veo aynı finalizedPrompt'u kullandığından, bu
// katmanda ikisi için de ortak, güvenli bir üst sınır olarak uygulanıyor.
export const MAX_VIDEO_PROMPT_LENGTH = 1990;

export function buildVideoPromptSections({ productTitle, motion } = {}) {
  const title = String(productTitle || "Buzsu ürünü").trim();
  return {
    reference: "Onaylanmış sahne görselini temel al; sahneyi baştan oluşturma, görseldeki her şeyi koru.",
    preserve: `Referans görseldeki tüm kişiler, nesneler, mobilyalar, ışık, kamera açısı ve kompozisyon birebir korunsun. ${title} ürününün tasarımı, logosu ve rengi değişmesin.`,
    motion: String(motion || "").trim() || GENERIC_MOTION,
    camera: "Yavaş ve sinematik kamera hareketleri kullan; gereksiz hızlı veya ani hareketlerden kaçın.",
    constraints: "Yeni kişi, nesne, cihaz veya filtre ekleme. Kişilerin yüz ve kimliğini değiştirme. Görüntü fotogerçekçi, premium reklam filmi estetiğinde olsun. Metin, fiyat, kampanya veya filigran ekleme."
  };
}

export function renderVideoPrompt(sections) {
  return [
    `REFERENCE:\n${sections.reference}`,
    `PRESERVE:\n${sections.preserve}`,
    `MOTION:\n${sections.motion}`,
    `CAMERA:\n${sections.camera}`,
    `CONSTRAINTS:\n${sections.constraints}`
  ].join("\n\n");
}

// Preview ve gerçek üretim aynı promptu kullanmalı: preview anında bu hash
// bir promptId olarak döner, üretim isteği finalizedPrompt'u aynen gönderir,
// sunucu sadece hash'in eşleştiğini doğrular — promptu yeniden kurmaz.
export function hashVideoPrompt(renderedPrompt) {
  return createHash("sha256").update(String(renderedPrompt || "")).digest("hex").slice(0, 16);
}

export function buildVideoPrompt(productTitle, motion) {
  return renderVideoPrompt(buildVideoPromptSections({ productTitle, motion }));
}
