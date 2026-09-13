import test from "node:test";
import assert from "node:assert/strict";
import {
  validateReelScript,
  validateSceneTimings,
  validateNarrationBudget,
  validateClaimsUsed,
  ReelScriptError,
  VEO_SILENT_CONSTRAINT,
  PRODUCT_IDENTITY_LOCK
} from "../src/lib/reel-script-schema.js";

const PRODUCT_CONTEXT = {
  productId: "llms:x",
  productName: "Code Su Arıtma Cihazı",
  canonicalUrl: "https://www.buzsu.com.tr/code-su-aritma-cihazi/",
  verifiedFacts: [{ fact: "Code Su Arıtma Cihazı 3 kademeli filtre sistemi ile mutfağınıza kurulur.", sourceUrl: "https://www.buzsu.com.tr/llms-full.txt" }],
  sourceUrls: ["https://www.buzsu.com.tr/llms-full.txt"]
};

function buildScene(overrides = {}) {
  return {
    sceneId: "scene-1", startSeconds: 0, endSeconds: 4, purpose: "hero shot",
    visualDescription: "Ürün mutfakta duruyor.", action: "Kadın ürünü gösteriyor.", camera: "Yakın çekim.",
    productVisibility: "hero", referenceImageRequired: true,
    veoPrompt: "A modern kitchen with the product on the counter.",
    narrationText: "Code ile temiz su.", onScreenText: "", transition: "cut",
    ...overrides
  };
}

function buildCandidate(overrides = {}) {
  return {
    title: "Başlık", concept: "Konsept", hook: "Hook cümlesi", creativeDirection: "Yönetmen notu",
    scenes: [
      buildScene(),
      buildScene({ sceneId: "scene-2", startSeconds: 4, endSeconds: 8, referenceImageRequired: false, veoPrompt: "A family drinking water happily.", narrationText: "Hemen deneyin." })
    ],
    fullNarrationText: "Code ile temiz su. Hemen deneyin.",
    musicBrief: { mood: "premium", energy: "orta", tempo: "orta", instruments: ["piano"], lyriaPrompt: "Premium commercial soundtrack" },
    claimsUsed: [{ claim: "3 kademeli filtre sistemi", sourceUrl: "https://www.buzsu.com.tr/llms-full.txt" }],
    negativeConstraints: [], warnings: [],
    ...overrides
  };
}

// --- validateSceneTimings ---------------------------------------------

test("validateSceneTimings: geçerli, 0'dan başlayan, çakışmayan sahneler kabul edilir", () => {
  assert.doesNotThrow(() => validateSceneTimings([{ sceneId: "s1", startSeconds: 0, endSeconds: 4 }, { sceneId: "s2", startSeconds: 4, endSeconds: 8 }], 8));
});

test("validateSceneTimings: boş sahne dizisi reddedilir", () => {
  assert.throws(() => validateSceneTimings([], 8), (e) => e instanceof ReelScriptError && e.code === "INVALID_SCENE_TIMING");
});

test("validateSceneTimings: ilk sahne 0'dan başlamıyorsa reddedilir", () => {
  assert.throws(() => validateSceneTimings([{ sceneId: "s1", startSeconds: 1, endSeconds: 4 }], 8), (e) => e.details.issue === "first_scene_not_zero");
});

test("validateSceneTimings: çakışan sahneler reddedilir", () => {
  assert.throws(() => validateSceneTimings([{ sceneId: "s1", startSeconds: 0, endSeconds: 5 }, { sceneId: "s2", startSeconds: 4, endSeconds: 8 }], 8), (e) => e.details.issue === "overlap");
});

test("validateSceneTimings: negatif startSeconds reddedilir", () => {
  assert.throws(() => validateSceneTimings([{ sceneId: "s1", startSeconds: -1, endSeconds: 4 }], 8), (e) => e.details.issue === "negative_start");
});

test("validateSceneTimings: endSeconds startSeconds'tan büyük olmalı", () => {
  assert.throws(() => validateSceneTimings([{ sceneId: "s1", startSeconds: 0, endSeconds: 0 }], 8), (e) => e.details.issue === "invalid_end");
});

test("validateSceneTimings: toplam süre durationSeconds'ı aşarsa reddedilir", () => {
  assert.throws(() => validateSceneTimings([{ sceneId: "s1", startSeconds: 0, endSeconds: 10 }], 8), (e) => e.details.issue === "exceeds_duration");
});

// --- validateNarrationBudget -------------------------------------------

test("validateNarrationBudget: süreye sığan kısa metin kabul edilir", () => {
  const estimated = validateNarrationBudget("Code ile temiz su. Hemen deneyin.", 8);
  assert.ok(estimated > 0 && estimated < 8);
});

test("validateNarrationBudget: 8sn'lik videoya uzun bir paragraf yazılırsa NARRATION_TOO_LONG ile reddedilir", () => {
  const longText = Array.from({ length: 60 }, () => "kelime").join(" "); // ~24sn'lik metin
  assert.throws(() => validateNarrationBudget(longText, 8), (e) => e instanceof ReelScriptError && e.code === "NARRATION_TOO_LONG");
});

// --- validateClaimsUsed --------------------------------------------------

test("validateClaimsUsed: verifiedFacts'ten gelen, sourceUrl'ü doğru bir iddia kabul edilir", () => {
  const result = validateClaimsUsed([{ claim: "3 kademeli filtre sistemi", sourceUrl: "https://www.buzsu.com.tr/llms-full.txt" }], PRODUCT_CONTEXT);
  assert.equal(result.length, 1);
});

test("validateClaimsUsed: verifiedFacts'te KARŞILIĞI olmayan bir iddia UNVERIFIED_PRODUCT_CLAIM ile reddedilir", () => {
  assert.throws(
    () => validateClaimsUsed([{ claim: "TSE sertifikalı ve 5 yıl garantilidir", sourceUrl: "https://www.buzsu.com.tr/llms-full.txt" }], PRODUCT_CONTEXT),
    (e) => e instanceof ReelScriptError && e.code === "UNVERIFIED_PRODUCT_CLAIM"
  );
});

test("validateClaimsUsed: bilinmeyen bir sourceUrl reddedilir (uydurma kaynak)", () => {
  assert.throws(
    () => validateClaimsUsed([{ claim: "3 kademeli filtre sistemi", sourceUrl: "https://baska-site.com/sayfa" }], PRODUCT_CONTEXT),
    (e) => e.code === "UNVERIFIED_PRODUCT_CLAIM"
  );
});

test("validateClaimsUsed: claim veya sourceUrl eksikse reddedilir", () => {
  assert.throws(() => validateClaimsUsed([{ claim: "bir şey" }], PRODUCT_CONTEXT), (e) => e.code === "UNVERIFIED_PRODUCT_CLAIM");
  assert.throws(() => validateClaimsUsed([{ sourceUrl: "https://www.buzsu.com.tr/llms-full.txt" }], PRODUCT_CONTEXT), (e) => e.code === "UNVERIFIED_PRODUCT_CLAIM");
});

test("validateClaimsUsed: verilmezse boş dizi döner (creative sloganların claimsUsed'e girmesi zorunlu değil)", () => {
  assert.deepEqual(validateClaimsUsed(undefined, PRODUCT_CONTEXT), []);
  assert.deepEqual(validateClaimsUsed(null, PRODUCT_CONTEXT), []);
});

// --- validateReelScript (tam akış) --------------------------------------

test("validateReelScript: geçerli bir candidate'i normalize edip döner", () => {
  const result = validateReelScript(buildCandidate(), { durationSeconds: 8, productContext: PRODUCT_CONTEXT });
  assert.equal(result.title, "Başlık");
  assert.equal(result.scenes.length, 2);
  assert.equal(result.claimsUsed.length, 1);
});

test("validateReelScript: her sahnenin veoPrompt'una İngilizce sessiz-video kısıtı DETERMİNİSTİK olarak eklenir", () => {
  const result = validateReelScript(buildCandidate(), { durationSeconds: 8, productContext: PRODUCT_CONTEXT });
  for (const scene of result.scenes) assert.ok(scene.veoPrompt.includes(VEO_SILENT_CONSTRAINT));
});

test("validateReelScript: yalnızca referenceImageRequired:true olan sahnelere Product Identity Lock eklenir", () => {
  const result = validateReelScript(buildCandidate(), { durationSeconds: 8, productContext: PRODUCT_CONTEXT });
  assert.ok(result.scenes[0].veoPrompt.includes(PRODUCT_IDENTITY_LOCK)); // referenceImageRequired:true
  assert.ok(!result.scenes[1].veoPrompt.includes(PRODUCT_IDENTITY_LOCK)); // referenceImageRequired:false
});

test("validateReelScript: veoPrompt zaten kısıtı içeriyorsa TEKRAR eklenmez (lyria-music.js'teki instrumental deseniyle aynı idempotency)", () => {
  const candidate = buildCandidate({ scenes: [buildScene({ veoPrompt: `Some visual. ${VEO_SILENT_CONSTRAINT}` })] });
  const result = validateReelScript(candidate, { durationSeconds: 8, productContext: PRODUCT_CONTEXT });
  const occurrences = result.scenes[0].veoPrompt.split(VEO_SILENT_CONSTRAINT).length - 1;
  assert.equal(occurrences, 1);
});

test("validateReelScript: musicBrief.lyriaPrompt'a 'instrumental' ibaresi yoksa deterministik olarak eklenir", () => {
  const result = validateReelScript(buildCandidate(), { durationSeconds: 8, productContext: PRODUCT_CONTEXT });
  assert.match(result.musicBrief.lyriaPrompt, /instrumental/i);
});

test("validateReelScript: musicBrief.lyriaPrompt zaten 'instrumental' içeriyorsa tekrar eklenmez", () => {
  const candidate = buildCandidate({ musicBrief: { mood: "x", energy: "orta", tempo: "orta", instruments: [], lyriaPrompt: "Calm instrumental track, no vocals." } });
  const result = validateReelScript(candidate, { durationSeconds: 8, productContext: PRODUCT_CONTEXT });
  assert.equal(result.musicBrief.lyriaPrompt, "Calm instrumental track, no vocals.");
});

test("validateReelScript: title/concept/hook boşsa STRUCTURED_JSON_INVALID ile reddedilir", () => {
  assert.throws(
    () => validateReelScript(buildCandidate({ title: "" }), { durationSeconds: 8, productContext: PRODUCT_CONTEXT }),
    (e) => e instanceof ReelScriptError && e.code === "STRUCTURED_JSON_INVALID"
  );
});

test("validateReelScript: geçersiz JSON şekli (nesne değil) STRUCTURED_JSON_INVALID ile reddedilir", () => {
  assert.throws(() => validateReelScript(null, { durationSeconds: 8, productContext: PRODUCT_CONTEXT }), (e) => e.code === "STRUCTURED_JSON_INVALID");
  assert.throws(() => validateReelScript([], { durationSeconds: 8, productContext: PRODUCT_CONTEXT }), (e) => e.code === "STRUCTURED_JSON_INVALID");
});

test("validateReelScript: doğrulanamayan bir claimsUsed kaydı TÜM isteği reddeder", () => {
  const candidate = buildCandidate({ claimsUsed: [{ claim: "TSE sertifikalıdır", sourceUrl: "https://www.buzsu.com.tr/llms-full.txt" }] });
  assert.throws(() => validateReelScript(candidate, { durationSeconds: 8, productContext: PRODUCT_CONTEXT }), (e) => e.code === "UNVERIFIED_PRODUCT_CLAIM");
});

test("validateReelScript: çakışan sahneler TÜM isteği reddeder", () => {
  const candidate = buildCandidate({ scenes: [buildScene(), buildScene({ sceneId: "scene-2", startSeconds: 2, endSeconds: 8 })] });
  assert.throws(() => validateReelScript(candidate, { durationSeconds: 8, productContext: PRODUCT_CONTEXT }), (e) => e.code === "INVALID_SCENE_TIMING");
});
