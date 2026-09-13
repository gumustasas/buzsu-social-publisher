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
  assert.equal(result[0].provenance, "verified");
  assert.equal(result[0].sourceUrl, "https://www.buzsu.com.tr/llms-full.txt");
});

test("validateClaimsUsed: verifiedFacts'te karşılığı OLMAYAN bir iddia REDDEDİLMEZ, unverified olarak işaretlenir", () => {
  const result = validateClaimsUsed([{ claim: "TSE sertifikalı ve 5 yıl garantilidir", sourceUrl: "https://www.buzsu.com.tr/llms-full.txt" }], PRODUCT_CONTEXT);
  assert.deepEqual(result, [{ claim: "TSE sertifikalı ve 5 yıl garantilidir", provenance: "unverified" }]);
});

test("validateClaimsUsed: bilinmeyen bir sourceUrl bloklamaz ama geri de yansıtılmaz (uydurma kaynak yankılanmaz)", () => {
  const result = validateClaimsUsed([{ claim: "3 kademeli filtre sistemi", sourceUrl: "https://baska-site.com/sayfa" }], PRODUCT_CONTEXT);
  assert.equal(result.length, 1);
  assert.equal(result[0].provenance, "verified");
  assert.equal(result[0].sourceUrl, "https://www.buzsu.com.tr/llms-full.txt");
});

test("validateClaimsUsed: yaratıcı reklam dili sourceUrl olmadan geçer", () => {
  const result = validateClaimsUsed([{ claim: "Modern yaşam için premium görsel atmosfer" }], PRODUCT_CONTEXT);
  assert.deepEqual(result, [{ claim: "Modern yaşam için premium görsel atmosfer", provenance: "unverified" }]);
});

test("validateClaimsUsed: claim metni eksik kayıt sessizce atılır, istek reddedilmez", () => {
  assert.deepEqual(validateClaimsUsed([{ sourceUrl: "https://www.buzsu.com.tr/llms-full.txt" }], PRODUCT_CONTEXT), []);
});

test("validateClaimsUsed: verilmezse veya bozuk gelirse boş dizi döner (asla throw etmez)", () => {
  assert.deepEqual(validateClaimsUsed(undefined, PRODUCT_CONTEXT), []);
  assert.deepEqual(validateClaimsUsed(null, PRODUCT_CONTEXT), []);
  assert.deepEqual(validateClaimsUsed("dizi değil", PRODUCT_CONTEXT), []);
  assert.deepEqual(validateClaimsUsed([{ claim: "x" }], {}), [{ claim: "x", provenance: "unverified" }]);
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

// ÜRÜN KARARI: product-claim doğrulaması BLOCKING DEĞİLDİR. Aşağıdaki
// ifadelerin hiçbiri claim nedeniyle senaryoyu reddetmemelidir.
test("validateReelScript: doğrulanamayan claim TÜM isteği REDDETMEZ, unverified işaretlenir", () => {
  const candidate = buildCandidate({ claimsUsed: [{ claim: "TSE sertifikalıdır", sourceUrl: "https://www.buzsu.com.tr/llms-full.txt" }] });
  const result = validateReelScript(candidate, { durationSeconds: 8, productContext: PRODUCT_CONTEXT });
  assert.deepEqual(result.claimsUsed, [{ claim: "TSE sertifikalıdır", provenance: "unverified" }]);
});

test("validateReelScript: gerçek acceptance'ı durduran KRAFT membran ifadesi artık geçer (regression)", () => {
  const claim = "Yüksek Alman KRAFT membran teknolojisiyle saf su";
  const candidate = buildCandidate({ hook: claim, claimsUsed: [{ claim }] });
  const result = validateReelScript(candidate, { durationSeconds: 8, productContext: PRODUCT_CONTEXT });
  assert.equal(result.hook, claim);
  assert.deepEqual(result.claimsUsed, [{ claim, provenance: "unverified" }]);
});

test("validateReelScript: teknik/ölçülebilir/sertifika/garanti ifadeleri claim nedeniyle reddedilmez", () => {
  for (const claim of [
    "KRAFT membran teknolojisi",
    "Saatte 20 litre üretir",
    "%99,9 kirleticileri giderir",
    "NSF sertifikalıdır",
    "10 yıl garantilidir",
    "Filtre 24 ay dayanır",
    "Alkali ve mineralli saf su",
    "300 GPD üretim kapasitesi vardır",
    "%40 su tasarrufu sağlar",
    "Sağlıklı ve güvenli içme suyu sağlar",
    "Paslanmaz çelik gövde",
    "Yüksek üretim debisi, dayanıklı kasa ve kolay filtre erişimi ön plandadır."
  ]) {
    const candidate = buildCandidate({ hook: claim, claimsUsed: [{ claim }] });
    const result = validateReelScript(candidate, { durationSeconds: 8, productContext: PRODUCT_CONTEXT });
    assert.equal(result.claimsUsed.length, 1, claim);
    assert.equal(result.hook, claim, claim);
  }
});

test("validateReelScript: claimsUsed'a yazılmayan sayısal ifade de senaryoyu bloklamaz", () => {
  const candidate = buildCandidate({ hook: "300 GPD üretim kapasitesi", claimsUsed: [] });
  const result = validateReelScript(candidate, { durationSeconds: 8, productContext: PRODUCT_CONTEXT });
  assert.equal(result.hook, "300 GPD üretim kapasitesi");
  assert.deepEqual(result.claimsUsed, []);
});

test("validateReelScript: verifiedFacts ile eşleşen claim gerçek kaynağıyla verified kalır", () => {
  const candidate = buildCandidate({ claimsUsed: [{ claim: "3 kademeli filtre sistemi" }] });
  const result = validateReelScript(candidate, { durationSeconds: 8, productContext: PRODUCT_CONTEXT });
  assert.deepEqual(result.claimsUsed, [{ claim: "3 kademeli filtre sistemi", provenance: "verified", sourceUrl: "https://www.buzsu.com.tr/llms-full.txt" }]);
});

test("validateReelScript: çakışan sahneler TÜM isteği reddeder", () => {
  const candidate = buildCandidate({ scenes: [buildScene(), buildScene({ sceneId: "scene-2", startSeconds: 2, endSeconds: 8 })] });
  assert.throws(() => validateReelScript(candidate, { durationSeconds: 8, productContext: PRODUCT_CONTEXT }), (e) => e.code === "INVALID_SCENE_TIMING");
});

// --- claim serbestliği structural validator'ı GEVŞETMEZ ------------------
// Aşağıdaki senaryolar iddia bakımından tamamen serbest kabul edilen
// metinler içerir; buna karşılık pipeline'ı bozacak teknik/yapısal hatalar
// HÂLÂ reddedilmelidir.

const CLAIM_HEAVY = "NSF sertifikalı, 10 yıl garantili, saatte 20 litre üreten KRAFT membran";

test("structural: claim'lerden bağımsız olarak bozuk sahne zamanlaması reddedilir", () => {
  const candidate = buildCandidate({
    hook: CLAIM_HEAVY,
    claimsUsed: [{ claim: CLAIM_HEAVY }],
    scenes: [buildScene(), buildScene({ sceneId: "scene-2", startSeconds: 2, endSeconds: 8 })]
  });
  assert.throws(() => validateReelScript(candidate, { durationSeconds: 8, productContext: PRODUCT_CONTEXT }), (e) => e.code === "INVALID_SCENE_TIMING");
});

test("structural: claim'lerden bağımsız olarak video süresini aşan sahne planı reddedilir", () => {
  const candidate = buildCandidate({
    hook: CLAIM_HEAVY,
    scenes: [buildScene({ startSeconds: 0, endSeconds: 12 })]
  });
  assert.throws(() => validateReelScript(candidate, { durationSeconds: 8, productContext: PRODUCT_CONTEXT }), (e) => e.code === "INVALID_SCENE_TIMING");
});

test("structural: claim'lerden bağımsız olarak süreye sığmayan narration reddedilir", () => {
  const candidate = buildCandidate({
    hook: CLAIM_HEAVY,
    fullNarrationText: `${CLAIM_HEAVY} ${Array.from({ length: 60 }, () => "kelime").join(" ")}`
  });
  assert.throws(() => validateReelScript(candidate, { durationSeconds: 8, productContext: PRODUCT_CONTEXT }), (e) => e.code === "NARRATION_TOO_LONG");
});

test("structural: claim'lerden bağımsız olarak eksik zorunlu alanlar ve bozuk şekil reddedilir", () => {
  assert.throws(
    () => validateReelScript(buildCandidate({ hook: "", claimsUsed: [{ claim: CLAIM_HEAVY }] }), { durationSeconds: 8, productContext: PRODUCT_CONTEXT }),
    (e) => e.code === "STRUCTURED_JSON_INVALID"
  );
  assert.throws(
    () => validateReelScript(buildCandidate({ fullNarrationText: "", hook: CLAIM_HEAVY }), { durationSeconds: 8, productContext: PRODUCT_CONTEXT }),
    (e) => e.code === "STRUCTURED_JSON_INVALID"
  );
  assert.throws(() => validateReelScript("düz metin", { durationSeconds: 8, productContext: PRODUCT_CONTEXT }), (e) => e.code === "STRUCTURED_JSON_INVALID");
});

test("structural: doğrulanmamış claim içeren senaryoda da Veo sessiz kısıtı ve Product Identity Lock deterministik uygulanır", () => {
  const candidate = buildCandidate({
    hook: CLAIM_HEAVY,
    claimsUsed: [{ claim: CLAIM_HEAVY }],
    scenes: [buildScene({ referenceImageRequired: true, veoPrompt: "Product on kitchen counter" })]
  });
  const result = validateReelScript(candidate, { durationSeconds: 8, productContext: PRODUCT_CONTEXT });
  assert.equal(result.claimsUsed[0].provenance, "unverified");
  assert.ok(result.scenes[0].veoPrompt.includes(VEO_SILENT_CONSTRAINT));
  assert.ok(result.scenes[0].veoPrompt.includes(PRODUCT_IDENTITY_LOCK));
});
