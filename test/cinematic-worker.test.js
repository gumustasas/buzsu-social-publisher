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

// ROOT REVIEW blocker 1 (PR #110, review 5257372536) fix: the worker no
// longer downloads+validates+renders each scene in a single combined loop.
// It now calls preflightSceneImages (src/cinematic/scene-pipeline.js) for
// ALL scenes FIRST — which itself calls downloadAndNormalizeSceneImage
// (scene-image.js) directly, no parallel error-wrapping layer, so
// InvalidSceneImageError's scene_index/original_url/failure_stage/
// stable_error_code context is preserved unchanged — and only calls
// renderSceneClips (which starts FFmpeg) after preflightSceneImages has
// resolved for every scene. Detailed unit tests for the "zero FFmpeg
// execution on a later invalid scene" invariant live in
// test/cinematic-scene-pipeline.test.js (owns); this is a source-level
// regression check that the worker's call ORDER can't silently drift back
// to the old single-loop shape.
test("the worker calls preflightSceneImages for ALL scenes before calling renderSceneClips — no parallel/inline download+render loop was reintroduced", async () => {
  const workerSource = await import("node:fs/promises").then((fs) => fs.readFile(new URL("../scripts/render-cinematic-reel.mjs", import.meta.url), "utf8"));
  assert.match(workerSource, /import \{ preflightSceneImages, renderSceneClips \} from "\.\.\/src\/cinematic\/scene-pipeline\.js"/);
  const preflightIndex = workerSource.indexOf("await preflightSceneImages(");
  const renderIndex = workerSource.indexOf("await renderSceneClips(");
  assert.ok(preflightIndex > -1, "worker preflightSceneImages'ı çağırmalı");
  assert.ok(renderIndex > -1, "worker renderSceneClips'i çağırmalı");
  assert.ok(preflightIndex < renderIndex, "preflightSceneImages, renderSceneClips'TEN ÖNCE çağrılmalı");
  // downloadAndNormalizeSceneImage/execFileAsync'in doğrudan bir render
  // döngüsü içinde (eski, tek-geçişli mimari) birlikte kullanılmadığını
  // doğrula — worker artık bu iki adımı KENDİSİ birleştirmiyor.
  assert.doesNotMatch(workerSource, /import \{ downloadAndNormalizeSceneImage,/, "worker artık downloadAndNormalizeSceneImage'ı DOĞRUDAN import ETMEMELİ — bu artık yalnızca scene-pipeline.js'in sorumluluğu");
});
