// visualProfile -> sabit FFmpeg filtre zinciri. Her profil schema.js'te
// zaten bir allowlist'e (VISUAL_PROFILES) karşı doğrulanmıştır; burada da
// yalnızca bu sabit Map üzerinden çözülür — hiçbir sayısal değer kullanıcı
// girdisinden türetilmez, bu yüzden filtergraph injection riski yoktur.
//
// Manifest güvenlik şartı: "do not materially change true product color;
// clamp aggressive filter values" — bu yüzden tüm eq/colorbalance değerleri
// bilinçli olarak küçük tutuldu (ör. saturation her zaman 0.9-1.15 aralığında,
// brightness/contrast ±%8'i aşmaz).
const PROFILE_EQ = {
  // Nötr beyazlar, hafif serin vurgular, düşük doygunluk, hafif kontrast.
  "clean-tech": "eq=contrast=1.04:saturation=0.96:brightness=0.01,colorbalance=rs=-0.02:gs=0:bs=0.03",
  // Sıcak-nötr, daha yumuşak kontrast, pürüzsüz highlight'lar.
  "premium-soft": "eq=contrast=0.97:saturation=1.05:brightness=0.015,colorbalance=rs=0.03:gs=0.01:bs=-0.02",
  // Orta düzeyde artırılmış kontrast/doygunluk.
  "commercial": "eq=contrast=1.08:saturation=1.15:brightness=0.005",
  // Minimal grading — neredeyse kaynağa sadık.
  "natural": "eq=contrast=1.0:saturation=1.0:brightness=0"
};

const VIGNETTE_FILTERS = {
  "off": null,
  // Hafif, düşük opasiteli vignette — PI/5 açısı ffmpeg'in vignette
  // filtresinde standart "subtle" değeridir (varsayılanın hafif altı).
  "subtle": "vignette=angle=PI/5"
};

// noise filtresinin "alls" parametresi (0-100) film grain yoğunluğunu
// belirler — değerler bilinçli olarak çok düşük tutuldu (manifest: "very
// low grain" clean-tech için varsayılan).
const GRAIN_FILTERS = {
  "off": null,
  "very-low": "noise=alls=4:allf=t",
  "low": "noise=alls=9:allf=t"
};

// buildColorGradeChain: verilen visualProfile + vignette + grain için
// virgülle ayrılmış bir FFmpeg filtre zinciri parçası döner (boşsa null).
// Saf fonksiyon — hiçbir IO içermez.
export function buildColorGradeChain(visualProfile, { vignette = "off", grain = "off" } = {}) {
  const eq = PROFILE_EQ[visualProfile];
  if (!eq) throw new Error(`Bilinmeyen visualProfile: "${visualProfile}".`);
  if (!(vignette in VIGNETTE_FILTERS)) throw new Error(`Bilinmeyen vignette modu: "${vignette}".`);
  if (!(grain in GRAIN_FILTERS)) throw new Error(`Bilinmeyen grain modu: "${grain}".`);

  const parts = [eq];
  const vignetteFilter = VIGNETTE_FILTERS[vignette];
  if (vignetteFilter) parts.push(vignetteFilter);
  const grainFilter = GRAIN_FILTERS[grain];
  if (grainFilter) parts.push(grainFilter);

  return parts.join(",");
}
