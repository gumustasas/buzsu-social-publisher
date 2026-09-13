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

// Türkçe seslendirme (TTS) + Lyria müziği + FFmpeg mix mimarisi eklenince
// (bkz. src/turkish-tts.js, src/lyria-music.js, src/reel-audio-compose.js)
// Veo/fal'ın kendi ürettiği konuşma/müzik/altyazı bu katmanlarla ÇAKIŞIR —
// ses artık ayrı, kontrollü adımlarda ekleniyor. Bu yüzden varsayılan
// olarak Veo'nun native sesi (varsa) İSTENMİYOR; kullanıcı özellikle
// isterse allowNativeAudio:true ile bu kısıtı kaldırabilir. Serbest metin
// promptu (freePrompt) bu şablonu hiç kullanmaz, dolayısıyla bu varsayılan
// ondan etkilenmez.
const NO_AUDIO_CONSTRAINT = "Sessiz video: konuşma, anlatım (narration), arka plan müziği veya otomatik altyazı EKLEME — ses ayrı bir adımda (Türkçe seslendirme + Lyria müziği) eklenecek.";

export function buildVideoPromptSections({ productTitle, motion, allowNativeAudio = false } = {}) {
  const title = String(productTitle || "Buzsu ürünü").trim();
  const constraints = ["Yeni kişi, nesne, cihaz veya filtre ekleme. Kişilerin yüz ve kimliğini değiştirme. Görüntü fotogerçekçi, premium reklam filmi estetiğinde olsun. Metin, fiyat, kampanya veya filigran ekleme."];
  if (!allowNativeAudio) constraints.push(NO_AUDIO_CONSTRAINT);
  return {
    reference: "Onaylanmış sahne görselini temel al; sahneyi baştan oluşturma, görseldeki her şeyi koru.",
    preserve: `Referans görseldeki tüm kişiler, nesneler, mobilyalar, ışık, kamera açısı ve kompozisyon birebir korunsun. ${title} ürününün tasarımı, logosu ve rengi değişmesin.`,
    motion: String(motion || "").trim() || GENERIC_MOTION,
    camera: "Yavaş ve sinematik kamera hareketleri kullan; gereksiz hızlı veya ani hareketlerden kaçın.",
    constraints: constraints.join(" ")
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

export function buildVideoPrompt(productTitle, motion, allowNativeAudio) {
  return renderVideoPrompt(buildVideoPromptSections({ productTitle, motion, allowNativeAudio }));
}
