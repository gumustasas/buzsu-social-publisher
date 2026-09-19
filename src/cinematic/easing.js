// Deterministik easing eğrileri: aynı (type, t) girdisi HER ZAMAN aynı
// çıktıyı üretir (bkz. tests.required — "easing determinism"). Girdi t
// [0,1] normalize edilmiş zaman ilerlemesidir (manifest: "normalized
// timeline progress 0.0-1.0"). Yalnızca saf matematik — IO/randomness yok.

export function clamp01(t) {
  if (!Number.isFinite(t)) return 0;
  return Math.min(1, Math.max(0, t));
}

export function easeLinear(t) {
  return clamp01(t);
}

export function easeIn(t) {
  const c = clamp01(t);
  return c * c;
}

export function easeOut(t) {
  const c = clamp01(t);
  return 1 - (1 - c) * (1 - c);
}

// Manifest'in önerdiği formül: progress = 0.5 - 0.5 * cos(pi * t)
export function easeInOut(t) {
  const c = clamp01(t);
  return 0.5 - 0.5 * Math.cos(Math.PI * c);
}

const EASING_FUNCTIONS = {
  "linear": easeLinear,
  "ease-in": easeIn,
  "ease-out": easeOut,
  "ease-in-out": easeInOut
};

// Bilinmeyen bir easing adı burada SESSİZCE linear'a düşmez — bu, schema.js
// tarafından zaten allowlist'e karşı doğrulanmış bir değer olmalı; burada
// tekrar fail-closed davranmak, iki katmanın (şema + motor) birbirinden
// bağımsız olarak "no silent fallback" ilkesini koruduğunu garanti eder.
export function applyEasing(type, t) {
  const fn = EASING_FUNCTIONS[type];
  if (!fn) throw new Error(`Bilinmeyen easing tipi: "${type}".`);
  return fn(t);
}
