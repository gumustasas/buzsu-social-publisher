import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const dashboard = await readFile(new URL("../dashboard.html", import.meta.url), "utf8");
const client = await readFile(new URL("../dashboard-reels-v2.js", import.meta.url), "utf8");

test("AI Reels V2 client ayrı dosyada kalır ve eski dashboard JS global'lerine bağlanmaz", () => {
  assert.match(dashboard, /<script src="\/dashboard-reels-v2\.js"><\/script>/);
  assert.match(client, /const v2Api = /);
  assert.doesNotMatch(client, /\bapi\(/);
  assert.doesNotMatch(client, /\brenderProductSelect\b/);
  assert.doesNotMatch(client, /\bproducts\./);
});

test("validate yanıtındaki normalize ReelScript client state'inin kaynağı olur", () => {
  assert.match(client, /state\.reelScript = data\.reelScript;/);
  assert.match(client, /autofillAudio\(state\.reelScript\);\s*renderScript\(\);/);
  assert.match(client, /productId: selectedProductId, reelScript: candidate/);
});

test("PR-D senaryo/onay ucları hâlâ yalnız options/product-context/generate/validate; PR-E'de yeni action= eklenmedi", () => {
  const actions = [...client.matchAll(/action=([a-z-]+)/g)].map((match) => match[1]);
  assert.deepEqual([...new Set(actions)].sort(), ["generate", "options", "product-context", "validate"]);
});

// PR-E: Adım 5 (Video Üretimi) aktif hale geldi ve MEVCUT Veo altyapısını
// (yeni bir endpoint: /api/reel-scene-video; DEĞİŞTİRİLMEMİŞ durum ucu:
// /api/veo-video) çağırır.
test("PR-E: Adım 5 mevcut Veo altyapısını çağırır", () => {
  assert.match(client, /v2Api\("\/api\/reel-scene-video"/);
  assert.match(client, /v2Api\("\/api\/veo-video"/);
});

// PR-F/G: Adım 6/7 de aktif hale geldi ve MEVCUT turkish-tts/lyria-music/
// reel-final uçlarını çağırır — ama Omni'ye (§15) ve eski, tek-video
// compose_reel_audio ucuna (/api/reel-audio, mevcut standalone panelin
// kullandığı, dokunulmamış uç) hiç dokunmaz; kendi ayrı /api/reel-final
// ucunu kullanır. Artık pasif bir adım kalmadı ("passive" değişkeni
// renderSteps'ten tamamen kaldırıldı).
test("PR-F/G: Adım 6/7 mevcut TTS/Lyria altyapısını ve YENİ /api/reel-final ucunu çağırır; Omni'ye ve eski /api/reel-audio ucuna dokunmaz; artık pasif adım yok", () => {
  assert.match(client, /v2Api\("\/api\/turkish-tts"/);
  assert.match(client, /v2Api\("\/api\/lyria-music"/);
  assert.match(client, /v2Api\(`\/api\/reel-final/);
  assert.match(client, /v2Api\("\/api\/reel-final"/);
  assert.doesNotMatch(client, /\/api\/omni/i);
  assert.doesNotMatch(client, /\/api\/reel-audio/i);
  assert.doesNotMatch(client, /\bpassive\b/);
});

test("PR-E: sahne videosu onaylanmamış bir sahne için ÜRETİLEMEZ (server çağrısından önce approvedScenes kontrolü)", () => {
  const fn = client.match(/async function generateSceneVideo\(sceneId\) \{[\s\S]*?\n  \}/)[0];
  const approvedCheckIndex = fn.indexOf("state.approvedScenes[sceneId] !== true");
  const fetchIndex = fn.indexOf('v2Api("/api/reel-scene-video"');
  assert.ok(approvedCheckIndex >= 0, "approvedScenes kontrolü bulunamadı");
  assert.ok(fetchIndex > approvedCheckIndex, "approvedScenes kontrolü, sunucuya isteğin ÖNÜNDE olmalı");
});

test("PR-E: ilk tıklama HİÇBİR API çağrısı yapmadan yalnız onay özeti gösterir; gerçek istek yalnız İKİNCİ tıklamada gider", () => {
  const fn = client.match(/async function generateSceneVideo\(sceneId\) \{[\s\S]*?\n  \}/)[0];
  const armIndex = fn.indexOf('pendingSceneConfirm[sceneId] !== confirmKey');
  const returnIndex = fn.indexOf("return;", armIndex);
  const resetIndex = fn.indexOf("resetSceneConfirm(sceneId);", returnIndex);
  const fetchIndex = fn.indexOf('v2Api("/api/reel-scene-video"');
  assert.ok(armIndex >= 0 && returnIndex > armIndex && resetIndex > returnIndex && fetchIndex > resetIndex, "confirm-arm bloğu erken 'return' içermeli ve gerçek istek yalnız resetSceneConfirm SONRASINDA gönderilmeli");
});

test("PR-E: gerçek isteğe her zaman approved:true VE confirmed:true birlikte gönderilir (sunucu contract'ı, §8)", () => {
  assert.match(client, /approved:\s*true,\s*\n\s*confirmed:\s*true,/);
});

test("PR-E: referans görsel seçilmeden üretim butonu isteği tetiklemez", () => {
  const fn = client.match(/async function generateSceneVideo\(sceneId\) \{[\s\S]*?\n  \}/)[0];
  assert.match(fn, /if \(!referenceImageUrl\) \{ message\.textContent = .*?; return; \}/);
});

test("PR-E: regenerate önceki tamamlanmış videoUrl'i YENİ üretim başarılı olana kadar korur (§12)", () => {
  const fn = client.match(/async function generateSceneVideo\(sceneId\) \{[\s\S]*?\n  \}/)[0];
  assert.match(fn, /state\.generatedSceneVideos\[sceneId\] = \{ \.\.\.previous, pending: true, error: null \};/);
  assert.match(fn, /videoUrl: previous\.videoUrl \|\| null,/);
});

test("PR-E: polling (pollSceneVideo) yalnız durum sorgular, ASLA yeni bir üretim isteği göndermez", () => {
  const fn = client.match(/async function pollSceneVideo\(sceneId\) \{[\s\S]*?\n  \}/)[0];
  assert.doesNotMatch(fn, /reel-scene-video/);
  assert.doesNotMatch(fn, /confirmed/);
  assert.match(fn, /v2Api\("\/api\/veo-video"/);
});

test("PR-E: sahne için Veo'ya gönderilen prompt PR-D'de zaten onaylanmış scene.veoPrompt'tur — burada AI ile yeniden yazılmaz", () => {
  const fn = client.match(/async function generateSceneVideo\(sceneId\) \{[\s\S]*?\n  \}/)[0];
  assert.match(fn, /veoPrompt:\s*scene\.veoPrompt,/);
  assert.doesNotMatch(fn, /generateReelScript|buildReelScriptPrompt/);
});

test("PR-F/G: dashboard.html'de 7 adımın tamamı için .reels-v2-stage bloğu var", () => {
  const stageCount = (dashboard.match(/class="reels-v2-stage"/g) || []).length;
  assert.equal(stageCount, 7);
  assert.match(dashboard, /<h3>6\. Ses/);
  assert.match(dashboard, /<h3>7\. Final Reel/);
});

test("PR-F/G: Adım 6 varsayılan narration/music metni YALNIZ yeni senaryo üretiminde (initAudioDefaults) set edilir, her sahne onayında DEĞİL", () => {
  assert.match(client, /function initAudioDefaults\(script\) \{[\s\S]*?fullNarrationText[\s\S]*?musicBrief\?\.lyriaPrompt/);
  const generateScriptFn = client.match(/async function generateScript\(\) \{[\s\S]*?\n  \}/)[0];
  assert.match(generateScriptFn, /initAudioDefaults\(state\.reelScript\);/);
  const validateEditsFn = client.match(/async function validateEdits\([\s\S]*?\n  \}/)[0];
  assert.doesNotMatch(validateEditsFn, /initAudioDefaults/);
});

test("PR-F/G: TTS ilk tıklama HİÇBİR API çağrısı yapmadan yalnız onay özeti gösterir; gerçek istek yalnız İKİNCİ tıklamada gider", () => {
  const fn = client.match(/async function generateNarrationVoiceover\(\) \{[\s\S]*?\n  \}/)[0];
  const armIndex = fn.indexOf("pendingNarrationConfirm !== confirmKey");
  const returnIndex = fn.indexOf("return;", armIndex);
  const resetIndex = fn.indexOf("resetNarrationConfirm();", returnIndex);
  const fetchIndex = fn.indexOf('v2Api("/api/turkish-tts"');
  assert.ok(armIndex >= 0 && returnIndex > armIndex && resetIndex > returnIndex && fetchIndex > resetIndex);
  assert.match(fn, /confirmed:\s*true/);
});

test("PR-F/G: Lyria ilk tıklama HİÇBİR API çağrısı yapmadan yalnız onay özeti gösterir; gerçek istek yalnız İKİNCİ tıklamada gider", () => {
  const fn = client.match(/async function generateMusic\(\) \{[\s\S]*?\n  \}/)[0];
  const armIndex = fn.indexOf("pendingMusicConfirm !== confirmKey");
  const returnIndex = fn.indexOf("return;", armIndex);
  const resetIndex = fn.indexOf("resetMusicConfirm();", returnIndex);
  const fetchIndex = fn.indexOf('v2Api("/api/lyria-music"');
  assert.ok(armIndex >= 0 && returnIndex > armIndex && resetIndex > returnIndex && fetchIndex > resetIndex);
  assert.match(fn, /confirmed:\s*true/);
});

test("PR-F/G: TTS/Lyria polling yalnız durum sorgular, ASLA yeni bir üretim isteği göndermez", () => {
  const pollTts = client.match(/async function pollNarrationVoiceover\(\) \{[\s\S]*?\n  \}/)[0];
  assert.doesNotMatch(pollTts, /confirmed/);
  assert.match(pollTts, /action:\s*"status"/);
  const pollLyria = client.match(/async function pollMusic\(\) \{[\s\S]*?\n  \}/)[0];
  assert.doesNotMatch(pollLyria, /confirmed/);
  assert.match(pollLyria, /action:\s*"status"/);
});

test("PR-F/G: başarısız TTS/Lyria otomatik başka bir provider'a düşmez; önceki tamamlanmış sonuç korunur", () => {
  const genTts = client.match(/async function generateNarrationVoiceover\(\) \{[\s\S]*?\n  \}/)[0];
  assert.match(genTts, /status: previous\.audioUrl \? "completed" : "failed"/);
  const genLyria = client.match(/async function generateMusic\(\) \{[\s\S]*?\n  \}/)[0];
  assert.match(genLyria, /status: previous\.musicUrl \? "completed" : "failed"/);
});

test("PR-F/G: Final Reel FFmpeg mix/concat ÜCRETSİZ olduğundan confirmed:true göndermez (Veo/TTS/Lyria'dan FARKLI kural)", () => {
  const fn = client.match(/async function composeFinalReel\(\) \{[\s\S]*?\n  \}/)[0];
  assert.doesNotMatch(fn, /confirmed:\s*true/);
});

test("PR-F/G: Final Reel yalnız tüm sahneler tamamlanmış VE en az bir ses kaynağı hazırsa (finalReadiness) tetiklenebilir", () => {
  const fn = client.match(/async function composeFinalReel\(\) \{[\s\S]*?\n  \}/)[0];
  assert.match(fn, /if \(!readiness\.ready\) \{ renderFinalStage\(\); return; \}/);
  const readinessFn = client.match(/function finalReadiness\(\) \{[\s\S]*?\n  \}/)[0];
  assert.match(readinessFn, /allScenesVideoCompleted/);
  assert.match(readinessFn, /hasAnyAudioReady/);
});

test("PR-F/G: Final Reel'e gönderilen sahne videoları reelScript.scenes SIRASINA göre dizilir", () => {
  const fn = client.match(/async function composeFinalReel\(\) \{[\s\S]*?\n  \}/)[0];
  assert.match(fn, /state\.reelScript\.scenes\.map\(\(scene\) => state\.generatedSceneVideos\[scene\.sceneId\]\.videoUrl\)/);
});

test("PR-F/G: Final Reel polling yalnız durum sorgular, ASLA yeni bir compose isteği göndermez", () => {
  const fn = client.match(/async function pollFinalReel\(\) \{[\s\S]*?\n  \}/)[0];
  assert.doesNotMatch(fn, /method:\s*"POST"/);
  assert.match(fn, /v2Api\(`\/api\/reel-final/);
});

test("PR-F/G: sahne/narration/music yeniden üretimi başladığında zaten var olan final video otomatik silinmez, yalnız 'stale' işaretlenir", () => {
  assert.match(client, /function markFinalStale\(\) \{\s*if \(state\.finalVideo\.videoUrl\) state\.finalVideo\.stale = true;\s*\}/);
  const genScene = client.match(/async function generateSceneVideo\(sceneId\) \{[\s\S]*?\n  \}/)[0];
  assert.match(genScene, /markFinalStale\(\);/);
  const genTts = client.match(/async function generateNarrationVoiceover\(\) \{[\s\S]*?\n  \}/)[0];
  assert.match(genTts, /markFinalStale\(\);/);
  const genLyria = client.match(/async function generateMusic\(\) \{[\s\S]*?\n  \}/)[0];
  assert.match(genLyria, /markFinalStale\(\);/);
});

test("PR-F/G: Final Reel yeniden compose'da Veo/TTS/Lyria OTOMATİK tetiklenmez (yalnız /api/reel-final çağrılır)", () => {
  const fn = client.match(/async function composeFinalReel\(\) \{[\s\S]*?\n  \}/)[0];
  assert.doesNotMatch(fn, /reel-scene-video|turkish-tts|lyria-music/);
});

test("PR-F/G: Step 5 regresyon yok — Product Identity Lock/sessiz Veo kısıtları ve confirmed:true+approved:true sözleşmesi hâlâ mevcut", () => {
  assert.match(client, /veoPrompt:\s*scene\.veoPrompt,/);
  assert.match(client, /approved:\s*true,\s*\n\s*confirmed:\s*true,/);
});

test("PR-F/G: claim bloklama geri gelmedi — audio/final assembly kodunda claim validator/filter/whitelist/denylist/classifier yok", () => {
  assert.doesNotMatch(client, /claimValidator|claimFilter|whitelist|denylist|classifyClaim|UNVERIFIED_PRODUCT_CLAIM/i);
});

test("mevcut ses paneli otomatik doldurulur ama alanlar readonly yapılmaz", () => {
  for (const id of ["reel-audio-narration-text", "reel-audio-music-prompt", "reel-audio-duration", "reel-audio-product-name"]) {
    assert.match(client, new RegExp(`byId\\("${id}"\\)\\.value`));
  }
  assert.match(dashboard, /Video süresi \(saniye\)<input id="reel-audio-duration"/);
  assert.doesNotMatch(dashboard, /id="reel-audio-(?:narration-text|music-prompt|duration|product-name)"[^>]*readonly/);
});
