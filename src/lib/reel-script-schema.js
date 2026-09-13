import { sanitizeUserText } from "./scenario-schema.js";
import { estimateNarrationDurationSeconds } from "../video-narration.js";

// generate_reel_script (AI Reels V2 PR-C) için tek doğrulama katmanı —
// scenario-schema.js'in ("mevcut" AI sahne akışı) ReelScript için birebir
// eşdeğeri. Provider'dan (OpenAI/Google) gelen JSON, buradan GEÇMEDEN
// çağırana dönmez (bkz. src/reel-script.js generateReelScript).

export const REEL_OBJECTIVES = ["sales", "awareness", "product_demo", "educational"];
export const REEL_ASPECT_RATIOS = ["9:16", "1:1", "16:9"];
export const REEL_DURATIONS = [8, 15, 20, 30];
export const PRODUCT_VISIBILITY_VALUES = ["hero", "visible", "background", "none"];
const MAX_SCENES = 12;
const MAX_FIELD_LENGTH = 500;
const MAX_NEGATIVE_CONSTRAINTS = 10;
// claimsUsed yalnız bilgilendirici bir listedir (bloklamaz); sınırsız büyümesin.
const MAX_CLAIMS_USED = 20;
// turkish-tts.js'teki VOICEOVER_TOO_LONG ile AYNI tolerans (%15) — otomatik
// kısaltma YAPILMAZ, sadece reddedilir (bkz. validateNarrationBudget).
const NARRATION_TOLERANCE = 1.15;

// Veo/fal'ın Türkçe NO_AUDIO_CONSTRAINT'iyle (bkz. src/lib/video-prompt.js)
// AYNI amaç, ama generate_reel_script'in veoPrompt alanı İngilizce
// (görsel üretim modeline doğrudan verilebilir) olduğundan burada KASITLI
// olarak AYRI, İngilizce bir sabit tanımlandı — eski Türkçe pipeline'ın
// kendi promptuna dokunulmuyor.
export const VEO_SILENT_CONSTRAINT = "NO spoken dialogue. NO narration. NO background music. NO generated captions.";

// Bölüm 7 (Product Identity Lock) — kullanıcının kendi verdiği metin,
// birebir.
export const PRODUCT_IDENTITY_LOCK =
  "Preserve the exact physical product shown in the supplied reference image. Do not redesign the product. " +
  "Do not alter proportions, housing count, connections, colors, geometry, logo placement or visible physical components. " +
  "NO invented product labels. NO rewritten logo. NO generated brand typography.";

export class ReelScriptError extends Error {
  constructor(message, { code, details = null } = {}) {
    super(message);
    this.name = "ReelScriptError";
    this.code = code;
    this.details = details;
  }
  toJSON() {
    return { code: this.code, details: this.details, error: this.message };
  }
}

function coerceString(value, { maxLength = MAX_FIELD_LENGTH } = {}) {
  return sanitizeUserText(value, { maxLength });
}

// lyria-music.js'teki buildLyriaPrompt/generateLyriaMusic'in "instrumental"
// ekleme deseniyle AYNI mantık: metin zaten kısıtı içeriyorsa tekrar
// eklenmez, yoksa deterministik olarak eklenir — LLM'in bunu unutmasına
// GÜVENİLMEZ.
function ensureConstraint(text, marker, constraint) {
  const value = String(text || "").trim();
  if (!value) return constraint;
  return marker.test(value) ? value : `${value} ${constraint}`;
}

function normalizeVeoPrompt(rawPrompt, referenceImageRequired) {
  let prompt = ensureConstraint(rawPrompt, /no spoken dialogue/i, VEO_SILENT_CONSTRAINT);
  if (referenceImageRequired) {
    prompt = ensureConstraint(prompt, /preserve the exact physical product/i, PRODUCT_IDENTITY_LOCK);
  }
  return prompt;
}

function normalizeLyriaPrompt(rawPrompt) {
  const value = String(rawPrompt || "").trim();
  if (!value) return value;
  return /instrumental/i.test(value) ? value : `${value} Instrumental only. No vocals.`;
}

function coerceProductVisibility(value) {
  return PRODUCT_VISIBILITY_VALUES.includes(value) ? value : "visible";
}

function coerceScene(raw, index) {
  if (!raw || typeof raw !== "object") throw new ReelScriptError(`scenes[${index}] geçerli bir nesne değil.`, { code: "INVALID_SCENE_TIMING", details: { index } });
  const sceneId = String(raw.sceneId || `scene-${index + 1}`).trim() || `scene-${index + 1}`;
  const startSeconds = Number(raw.startSeconds);
  const endSeconds = Number(raw.endSeconds);
  const referenceImageRequired = raw.referenceImageRequired === true;
  return {
    sceneId,
    startSeconds,
    endSeconds,
    purpose: coerceString(raw.purpose, { maxLength: 200 }),
    visualDescription: coerceString(raw.visualDescription),
    action: coerceString(raw.action, { maxLength: 200 }),
    camera: coerceString(raw.camera, { maxLength: 200 }),
    productVisibility: coerceProductVisibility(raw.productVisibility),
    referenceImageRequired,
    veoPrompt: normalizeVeoPrompt(raw.veoPrompt, referenceImageRequired),
    narrationText: coerceString(raw.narrationText),
    onScreenText: coerceString(raw.onScreenText, { maxLength: 120 }),
    transition: coerceString(raw.transition, { maxLength: 80 })
  };
}

// Sahne zamanlamaları: 0'dan başlamalı, çakışmamalı, negatif olmamalı,
// toplam süre durationSeconds'ı aşmamalı. Sessizce "düzeltilmez" — ilk
// ihlalde açık bir ReelScriptError fırlatılır (bkz. kullanıcı isteği).
export function validateSceneTimings(scenes, durationSeconds) {
  if (!Array.isArray(scenes) || !scenes.length) {
    throw new ReelScriptError("En az bir sahne (scenes) gerekli.", { code: "INVALID_SCENE_TIMING" });
  }
  if (scenes.length > MAX_SCENES) {
    throw new ReelScriptError(`En fazla ${MAX_SCENES} sahne desteklenir.`, { code: "INVALID_SCENE_TIMING", details: { count: scenes.length } });
  }
  let previousEnd = 0;
  scenes.forEach((scene, index) => {
    if (!Number.isFinite(scene.startSeconds) || scene.startSeconds < 0) {
      throw new ReelScriptError(`Sahne "${scene.sceneId}": startSeconds negatif olamaz.`, { code: "INVALID_SCENE_TIMING", details: { sceneId: scene.sceneId, issue: "negative_start" } });
    }
    if (!Number.isFinite(scene.endSeconds) || scene.endSeconds <= scene.startSeconds) {
      throw new ReelScriptError(`Sahne "${scene.sceneId}": endSeconds, startSeconds'tan büyük olmalı.`, { code: "INVALID_SCENE_TIMING", details: { sceneId: scene.sceneId, issue: "invalid_end" } });
    }
    if (index === 0 && scene.startSeconds !== 0) {
      throw new ReelScriptError(`İlk sahne ("${scene.sceneId}") 0. saniyeden başlamalı.`, { code: "INVALID_SCENE_TIMING", details: { sceneId: scene.sceneId, issue: "first_scene_not_zero" } });
    }
    if (scene.startSeconds < previousEnd) {
      throw new ReelScriptError(`Sahne "${scene.sceneId}" önceki sahneyle çakışıyor.`, { code: "INVALID_SCENE_TIMING", details: { sceneId: scene.sceneId, issue: "overlap" } });
    }
    previousEnd = scene.endSeconds;
  });
  if (previousEnd > durationSeconds) {
    throw new ReelScriptError(`Sahnelerin toplam süresi (${previousEnd}s) videonun süresini (${durationSeconds}s) aşıyor.`, { code: "INVALID_SCENE_TIMING", details: { issue: "exceeds_duration", totalSeconds: previousEnd, durationSeconds } });
  }
}

// 8sn'lik bir videoya uzun bir paragraf yazılmasını engeller — otomatik
// kısaltma YAPILMAZ (turkish-tts.js'teki VOICEOVER_TOO_LONG ile AYNI
// felsefe), yalnızca reddedilir.
export function validateNarrationBudget(fullNarrationText, durationSeconds) {
  const estimated = estimateNarrationDurationSeconds(fullNarrationText);
  const maxSeconds = durationSeconds * NARRATION_TOLERANCE;
  if (estimated > maxSeconds) {
    throw new ReelScriptError(
      `Seslendirme metni bu video süresine sığmıyor (tahmini ${estimated.toFixed(1)}sn > izin verilen ${maxSeconds.toFixed(1)}sn).`,
      { code: "NARRATION_TOO_LONG", details: { estimatedSeconds: Math.round(estimated * 10) / 10, durationSeconds, maxSeconds: Math.round(maxSeconds * 10) / 10 } }
    );
  }
  return Math.round(estimated * 10) / 10;
}

function normalizeForMatch(text) {
  return String(text || "")
    .toLocaleLowerCase("tr-TR")
    .replace(/[^\p{L}\p{N}%]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenOverlapRatio(a, b) {
  const aTokens = new Set(a.split(" ").filter((token) => token.length > 2));
  const bTokens = new Set(b.split(" ").filter((token) => token.length > 2));
  if (!aTokens.size) return 0;
  let common = 0;
  for (const token of aTokens) if (bTokens.has(token)) common++;
  return common / aTokens.size;
}

// Bir claim'in productContext.verifiedFacts ile eşleşip eşleşmediğini bulur.
// Bu bir KAPI değildir, yalnızca KAYNAK ATAMASI içindir: eşleşme varsa
// claim'e fact'in gerçek sourceUrl'ü yazılır. Model bir sourceUrl verdiyse
// yalnız o kaynağın fact'leri içinde aranır; vermediyse tüm verifiedFacts
// taranır. Eşleşme bulunamaması bir hata DEĞİLDİR (bkz. validateClaimsUsed).
function findGroundedFact(claim, productContext, sourceUrl = null) {
  if (sourceUrl && !(productContext.sourceUrls || []).includes(sourceUrl)) return null;
  const claimNorm = normalizeForMatch(claim);
  if (!claimNorm) return null;
  return (productContext.verifiedFacts || []).find((fact) => {
    if (sourceUrl && fact.sourceUrl !== sourceUrl) return false;
    const factNorm = normalizeForMatch(fact.fact);
    if (!factNorm) return false;
    return factNorm.includes(claimNorm) || claimNorm.includes(factNorm) || tokenOverlapRatio(claimNorm, factNorm) >= 0.6;
  }) || null;
}

// ÜRÜN KARARI: product-claim doğruluğu ReelScript üretiminin/validasyonunun
// BLOCKING validator'ı DEĞİLDİR. Doğrulanamayan bir ürün iddiası artık
// senaryoyu REDDETMEZ — UNVERIFIED_PRODUCT_CLAIM hata sınıfı bu yoldan
// tamamen kaldırıldı. Product Intelligence korunur ve modeli gerçek ürün
// bilgisine yönlendirmeye devam eder (bkz. creative-providers/reel-script-prompt.js),
// fakat bu bir kapı değil bir YÖNLENDİRMEdir.
//
// Bu fonksiyon yalnız KAYNAK ATAMASI yapar: modelin bildirdiği her claim,
// verifiedFacts ile eşleşiyorsa fact'in gerçek sourceUrl'ü ile "verified",
// eşleşmiyorsa "unverified" olarak işaretlenir. Hiçbir claim atılmaz,
// sansürlenmez veya reddedilmez; işaretleme yalnızca dashboard onay
// ekranındaki insan incelemesine görünürlük sağlamak içindir.
// Burada whitelist/denylist/regex claim filtresi veya claim-classifier YOKTUR
// ve eklenmemelidir.
export function validateClaimsUsed(claimsUsed, productContext = {}) {
  if (!Array.isArray(claimsUsed)) return [];
  return claimsUsed
    .slice(0, MAX_CLAIMS_USED)
    .map((entry) => {
      const claim = coerceString(entry?.claim, { maxLength: 300 });
      if (!claim) return null;
      const declaredUrl = coerceString(entry?.sourceUrl, { maxLength: 500 });
      const knownUrl = declaredUrl && (productContext.sourceUrls || []).includes(declaredUrl) ? declaredUrl : null;
      const fact = findGroundedFact(claim, productContext, knownUrl);
      if (fact) return { claim, provenance: "verified", sourceUrl: fact.sourceUrl };
      return { claim, provenance: "unverified" };
    })
    .filter(Boolean);
}

function coerceMusicBrief(raw) {
  const value = raw && typeof raw === "object" ? raw : {};
  return {
    mood: coerceString(value.mood, { maxLength: 120 }),
    energy: coerceString(value.energy, { maxLength: 40 }),
    tempo: coerceString(value.tempo, { maxLength: 40 }),
    instruments: Array.isArray(value.instruments) ? value.instruments.slice(0, 8).map((item) => coerceString(item, { maxLength: 60 })).filter(Boolean) : [],
    lyriaPrompt: normalizeLyriaPrompt(value.lyriaPrompt)
  };
}

function coerceNegativeConstraints(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, MAX_NEGATIVE_CONSTRAINTS).map((item) => coerceString(item, { maxLength: 160 })).filter(Boolean);
}

// candidate: provider'dan (OpenAI/Google) parse edilmiş ham JSON.
// productContext: getBuzsuProductContext() çıktısı (claimsUsed kaynak ataması
// için — claim doğruluğu BLOKLAMAZ). durationSeconds: KULLANICININ isteğinden
// gelir (candidate'teki değere GÜVENİLMEZ — AI süreyi değiştiremez).
//
// Burada uygulanan validasyonlar TEKNİK/YAPISALdır ve korunur: schema/scene
// structure, scene timing, narration bütçesi, deterministik Veo sessiz-video
// kısıtı ve Product Identity Lock. Bunlar ürünün ne söylediğini sansürlemek
// için değil, Reel pipeline'ının bozulmasını engellemek içindir.
export function validateReelScript(candidate, { durationSeconds, productContext }) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new ReelScriptError("Provider yanıtı geçerli bir JSON nesnesi değil.", { code: "STRUCTURED_JSON_INVALID" });
  }
  const title = coerceString(candidate.title, { maxLength: 120 });
  const concept = coerceString(candidate.concept, { maxLength: 300 });
  const hook = coerceString(candidate.hook, { maxLength: 200 });
  if (!title || !concept || !hook) {
    throw new ReelScriptError('Senaryo alanları boş: "title", "concept" ve "hook" gerekli.', { code: "STRUCTURED_JSON_INVALID" });
  }
  const creativeDirection = coerceString(candidate.creativeDirection, { maxLength: 500 });

  const scenes = Array.isArray(candidate.scenes) ? candidate.scenes.map((scene, index) => coerceScene(scene, index)) : [];
  validateSceneTimings(scenes, durationSeconds);

  const fullNarrationText = coerceString(candidate.fullNarrationText, { maxLength: 2000 });
  if (!fullNarrationText) throw new ReelScriptError('"fullNarrationText" boş olamaz.', { code: "STRUCTURED_JSON_INVALID" });
  const estimatedNarrationSeconds = validateNarrationBudget(fullNarrationText, durationSeconds);

  const musicBrief = coerceMusicBrief(candidate.musicBrief);
  const claimsUsed = validateClaimsUsed(candidate.claimsUsed, productContext);
  const negativeConstraints = coerceNegativeConstraints(candidate.negativeConstraints);
  const warnings = Array.isArray(candidate.warnings) ? candidate.warnings.map((item) => coerceString(item, { maxLength: 200 })).filter(Boolean) : [];

  return { title, concept, hook, creativeDirection, scenes, fullNarrationText, estimatedNarrationSeconds, musicBrief, claimsUsed, negativeConstraints, warnings };
}
