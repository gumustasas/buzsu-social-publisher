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
// /api/veo-video) çağırır — bu artık beklenen davranış. Ses/müzik/Omni/final
// render (§15/§16) HÂLÂ dokunulmamış olmalı; Adım 6/7 hâlâ pasif.
test("PR-E: Adım 5 mevcut Veo altyapısını çağırır ama ses/müzik/Omni/final render'a dokunmaz; Adım 6/7 pasif kalır", () => {
  assert.match(client, /v2Api\("\/api\/reel-scene-video"/);
  assert.match(client, /v2Api\("\/api\/veo-video"/);
  assert.doesNotMatch(client, /\/api\/(?:omni|turkish|lyria|reel-audio|compose)/i);
  assert.match(client, /const passive = step > 5;/);
  assert.match(client, /passive \? " disabled"/);
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

test("PR-E: dashboard.html'de Adım 5-7 için toplam yalnız 5 aktif .reels-v2-stage bloğu var (6/7 hâlâ eklenmedi)", () => {
  const stageCount = (dashboard.match(/class="reels-v2-stage"/g) || []).length;
  assert.equal(stageCount, 5);
  assert.doesNotMatch(dashboard, /<h3>6\. Ses/);
  assert.doesNotMatch(dashboard, /<h3>7\. Final Reel/);
});

test("mevcut ses paneli otomatik doldurulur ama alanlar readonly yapılmaz", () => {
  for (const id of ["reel-audio-narration-text", "reel-audio-music-prompt", "reel-audio-duration", "reel-audio-product-name"]) {
    assert.match(client, new RegExp(`byId\\("${id}"\\)\\.value`));
  }
  assert.match(dashboard, /Video süresi \(saniye\)<input id="reel-audio-duration"/);
  assert.doesNotMatch(dashboard, /id="reel-audio-(?:narration-text|music-prompt|duration|product-name)"[^>]*readonly/);
});
