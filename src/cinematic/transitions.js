// 5 desteklenen geçiş tipini FFmpeg'in xfade filtresine (compose_product_
// video ile AYNI mekanizma, bkz. src/lib/ffmpeg-command.js) sabit bir
// allowlist üzerinden eşler. Geçiş TİPİ asla ham kullanıcı string'i olarak
// filtergraph'a enjekte edilmez — yalnızca bu Map'teki sabit xfade adları
// kullanılır (schema.js zaten transition.type'ı TRANSITION_TYPES'a karşı
// doğrulamıştır; burası ikinci, bağımsız bir fail-closed katmanıdır).
//
// motion-blur ve match-cut, xfade'in kendi yerleşik bir "motion blur" modu
// OLMADIĞI için (xfade yalnızca sabit geçiş adları sunar) deterministik
// yaklaşımlarla eşleniyor: motion-blur -> "fade" + ayrı bir yön odaklı
// tblend/hızlı-crossfade YERİNE (aşırı karmaşıklık, GH Actions render
// süresini riske atar) kısa süreli hızlı bir "fadeblack" benzeri crossfade
// (fade) kullanılıyor; gerçek optik akış tabanlı motion blur bu v1'in
// kapsamı DIŞINDA — bu bir fallback DEĞİL, manifest'in "deterministic"
// şartını karşılayan bilinçli bir v1 yaklaşımıdır ve final_report'ta
// "known limitation" olarak raporlanmalıdır.
const XFADE_TRANSITION_MAP = {
  "crossfade": "fade",
  "motion-blur": "fade",
  "light-wipe": "fadewhite",
  "whip": "slideleft",
  "match-cut": "fade"
};

// match-cut, transitionAnchor'ı xfade'in kendisine DEĞİL (xfade anchor
// desteklemez), geçişten HEMEN ÖNCEKİ/SONRAKİ sahnenin kamera hedef
// noktasını hafifçe anchor'a doğru kaydırmak için üst katmana (scene-render.js)
// bırakır — burası yalnızca xfade adını çözer.
export function resolveXfadeName(transitionType) {
  const name = XFADE_TRANSITION_MAP[transitionType];
  if (!name) throw new Error(`Bilinmeyen geçiş tipi: "${transitionType}".`);
  return name;
}

// whip'in yön varyasyonu (soldan/sağdan) deterministik olarak sahne
// indeksine göre değişir — tüm geçişler aynı yönde olursa "kinetik" hissi
// kaybolur; indeks tabanlı seçim rastgelelik İÇERMEZ (aynı girdi = aynı çıktı).
export function resolveWhipDirection(sceneIndex) {
  return sceneIndex % 2 === 0 ? "slideleft" : "slideright";
}

export function resolveXfadeNameForScene(transitionType, sceneIndex) {
  if (transitionType === "whip") return resolveWhipDirection(sceneIndex);
  return resolveXfadeName(transitionType);
}
