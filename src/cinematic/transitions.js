// 5 desteklenen geçiş tipini FFmpeg'in xfade filtresine (compose_product_
// video ile AYNI mekanizma, bkz. src/lib/ffmpeg-command.js) sabit bir
// allowlist üzerinden eşler. Geçiş TİPİ asla ham kullanıcı string'i olarak
// filtergraph'a enjekte edilmez — yalnızca bu Map'teki sabit xfade adları
// kullanılır (schema.js zaten transition.type'ı TRANSITION_TYPES'a karşı
// doğrulamıştır; burası ikinci, bağımsız bir fail-closed katmanıdır).
//
// ROOT REVIEW (PR #110, review 5257372536) — BLOCKER 2: motion-blur ÖNCEDEN
// "fade"e (yani ordinary crossfade'e) alias'lanıyordu — bu, "motion-blur
// transition works" kabul kriterini karşılamıyordu (crossfade'den ayırt
// edilemez). Düzeltme: motion-blur artık FFmpeg'in xfade filtresinin
// KENDİ yerleşik "hblur" (transition #35, "hblur transition" — bkz.
// `ffmpeg -h filter=xfade` çıktısı) geçiş moduna eşleniyor. hblur, geçiş
// sırasında görüntüyü yatay yönde bulanıklaştırarak GERÇEK bir motion-blur
// benzeri, yönlü bir bulanıklık/akış efekti üretir — bu, optik akış/AI
// GEREKTİRMEYEN, tamamen deterministik, FFmpeg'in kendi (üçüncü taraf
// olmayan, stabil) yerleşik bir filtresidir. "fade" ile ARTIK aynı değildir
// (test/cinematic-transitions.test.js bunu doğrudan doğrular) — çıktı
// filtergraph'ı plain crossfade'den YAPISAL olarak farklıdır
// (xfade=transition=hblur vs. xfade=transition=fade).
//
// match-cut, xfade'in kendi yerleşik bir "match cut" modu OLMADIĞI için
// (xfade yalnızca sabit geçiş adları sunar) hâlâ "fade"e eşleniyor —
// transitionAnchor'ı kamera hedef noktasına yansıtma v1 kapsamı DIŞINDA
// (final_report'ta "known limitation" olarak raporlanır).
const XFADE_TRANSITION_MAP = {
  "crossfade": "fade",
  "motion-blur": "hblur",
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
