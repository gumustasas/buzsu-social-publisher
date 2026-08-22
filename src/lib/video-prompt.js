// fal.ai ve Veo aynı Reels video prompt'unu kullanıyor; kullanıcı önceden bir
// AI sahne görseli ürettiyse (bkz. src/scene-image.js), o sahnenin AI
// açıklaması burada videoya da aktarılır — video, gönderi için önizlenen
// sahneyle tutarlı olsun diye. userIntent, "Tek cümleyle anlat" kutusuna
// yazılan HAM cümledir; sceneDescription bunun AI tarafından çıkarılmış
// (özetlenmiş) sahne kısmıdır. İkisi çoğu zaman örtüşür ama userIntent, AI'ın
// çıkarım sırasında atlayabileceği ton/ilişki detaylarını (örn. "aile"
// vurgusu) yedekte tutar; sceneDescription ile birebir aynıysa tekrar
// eklenmez.
export function buildVideoPrompt(title, sceneDescription, userIntent) {
  const scene = String(sceneDescription || "").trim();
  const intent = String(userIntent || "").trim();
  const sceneClause = scene ? ` Sahne: ${scene}.` : "";
  const intentClause = intent && intent !== scene ? ` Kullanıcının orijinal isteği: ${intent}.` : "";
  return `Buzsu ${title} ürünü için 9:16 sosyal medya Reels videosu.${sceneClause}${intentClause} Ürünün şeklini, logosunu ve renklerini koru; kamera hafifçe yaklaşsın ve ürün doğal bir ortamda sabit kalsın. Metin, fiyat, kampanya veya yeni ürün detayı ekleme. Sağlık ve kesin sonuç iddiası kullanma.`;
}
