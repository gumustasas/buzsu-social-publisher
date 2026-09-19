import test from "node:test";
import assert from "node:assert/strict";

// TASK-011: scripts/render-cinematic-reel.mjs, render-product-video.mjs ile
// AYNI import.meta.url ana-modül koruması (bkz. o dosyadaki AYNI desen) ile
// korunuyor. tests.required: "import side-effect free (worker/module import
// doesn't auto-execute render)" — bu dosyayı import etmek (JOB_ID env
// değişkeni TANIMSIZ olsa dahi) process.exit/gerçek render/dosya sistemi
// yan etkisi TETİKLEMEMELİDİR.
test("importing scripts/render-cinematic-reel.mjs triggers zero side effects (no JOB_ID check, no process.exit, no render)", async () => {
  const originalExit = process.exit;
  let exitCalled = false;
  process.exit = () => { exitCalled = true; };
  try {
    await import("../scripts/render-cinematic-reel.mjs");
    assert.equal(exitCalled, false, "modül import edilirken process.exit ÇAĞRILMAMALI");
  } finally {
    process.exit = originalExit;
  }
});

// "worker error context (failed scene reports stage/index/url)" — worker'ın
// KENDİSİ scene-image.js'in downloadAndNormalizeSceneImage'ını DOĞRUDAN,
// hiçbir ek sarmalama/yutma OLMADAN çağırır (bkz. scripts/render-cinematic-
// reel.mjs run()'daki "await downloadAndNormalizeSceneImage(scene, i, ...)"
// satırı) — bu yüzden InvalidSceneImageError'ın scene_index/original_url/
// failure_stage alanları worker seviyesinde DE aynen korunur; ayrıntılı
// birim testleri test/cinematic-scene-image.test.js'te (owns), burada
// yalnızca worker'ın bu fonksiyonu GERÇEKTEN, DEĞİŞTİRMEDEN import ettiği
// doğrulanır (regresyon: worker kendi paralel bir hata-sarmalama katmanı
// icat ETMEMELİ).
test("the worker imports downloadAndNormalizeSceneImage/InvalidSceneImageError directly from src/cinematic/scene-image.js — no parallel error-wrapping layer", async () => {
  const workerSource = await import("node:fs/promises").then((fs) => fs.readFile(new URL("../scripts/render-cinematic-reel.mjs", import.meta.url), "utf8"));
  assert.match(workerSource, /import \{ downloadAndNormalizeSceneImage, redactSceneUrlForLog \} from "\.\.\/src\/cinematic\/scene-image\.js"/);
});
