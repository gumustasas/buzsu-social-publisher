// DepthProvider arayüzü (manifest: "abstraction interface DepthProvider.
// getDepth(image)"). v1'de yerel/OSS bir derinlik tahmini modeli KURULU
// DEĞİL (paid_ai.allowed:false olduğundan bulut tabanlı bir derinlik API'si
// de KULLANILAMAZ) — bu yüzden tek gerçek implementasyon, manifest'in
// AÇIKÇA izin verdiği deterministik fallback'tir: "if local/OSS segmentation
// unavailable, ... render MUST continue" ve "fallback behavior
// deterministic_non_depth_motion, MUST report metadata".
//
// getDepth() bu yüzden HER ZAMAN null döner (gerçek bir derinlik haritası
// üretmez) — bu bir hata/silinmiş özellik değil, v1'in kasıtlı, dürüst
// mimarisidir: üst katman (scene-render.js) null gördüğünde depthParallax
// istenmiş olsa bile normal (tüm-kare) kamera hareketine düşer ve bunu
// appliedEffects/fallbacks içinde raporlar.
export async function getDepth(_image) {
  return null;
}

export const DEPTH_FALLBACK_CODE = "depth_parallax_unavailable";

// depthEffect istenmiş ama getDepth() null dönmüşse çağıran taraf bunu
// çağırıp fallbacks listesine ekler — tek bir yerden, tutarlı bir mesajla.
export function describeDepthFallback() {
  return "Yerel/ücretsiz bir derinlik tahmini sağlayıcısı bulunmadığından depthParallax istendi ancak deterministik tüm-kare kamera hareketine düşüldü (render durdurulmadı).";
}
