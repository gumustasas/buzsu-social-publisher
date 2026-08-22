// fal.ai ve Veo aynı Reels video prompt'unu kullanıyor; kullanıcı önceden bir
// AI sahne görseli ürettiyse (bkz. src/scene-image.js), o sahnenin AI
// açıklaması burada videoya da aktarılır — video, gönderi için önizlenen
// sahneyle tutarlı olsun diye.
export function buildVideoPrompt(title, sceneDescription) {
  const scene = String(sceneDescription || "").trim();
  const sceneClause = scene ? ` Sahne: ${scene}.` : "";
  return `Buzsu ${title} ürünü için 9:16 sosyal medya Reels videosu.${sceneClause} Ürünün şeklini, logosunu ve renklerini koru; kamera hafifçe yaklaşsın ve ürün doğal bir ortamda sabit kalsın. Metin, fiyat, kampanya veya yeni ürün detayı ekleme. Sağlık ve kesin sonuç iddiası kullanma.`;
}
