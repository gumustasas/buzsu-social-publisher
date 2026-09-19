import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { downloadAndNormalizeSceneImage } from "./scene-image.js";
import { buildScenePlan } from "./render-plan.js";

const execFileAsync = promisify(execFile);

// ROOT REVIEW (PR #110, review 5257372536) — BLOCKER 1: TASK-011 manifest'in
// "Invalid images must fail before cinematic processing begins." şartı,
// TÜM sahneler için TEK bir birleşik döngüde (indir+doğrula+normalize+
// HEMEN render et) değil, İKİ AYRI aşamada karşılanmalıdır: önce TÜM
// sahneler indirilip TASK-010 ile doğrulanıp normalize edilir (bu fonksiyon,
// preflightSceneImages — HİÇBİR FFmpeg/execFile çağrısı İÇERMEZ), ancak bu
// aşama TÜM sahneler için başarıyla tamamlandıktan SONRA renderSceneClips
// çağrılıp gerçek FFmpeg render'ları başlar. Böylece sahne N+1 geçersizse,
// sahne 0..N için (önceden başarıyla indirilmiş olsalar bile) TEK bir
// FFmpeg süreci dahi BAŞLAMAMIŞ olur — çünkü renderSceneClips bu noktaya
// hiç ulaşmaz (preflightSceneImages'ın kendisi throw eder).

// preflightSceneImages: TÜM sahneleri SIRAYLA indirir/TASK-010'un
// sertleştirilmiş fetchPublicImage yolundan (SSRF/DNS + MIME + magic-byte +
// decode doğrulaması, bkz. src/cinematic/scene-image.js) geçirir/normalize
// eder ve diske yazar. Herhangi bir sahne başarısız olursa (InvalidSceneImageError,
// scene_index/original_url/failure_stage/stable_error_code bağlamıyla)
// BURADA throw eder — bu fonksiyon çağrıldığında henüz TEK BİR FFmpeg
// süreci dahi başlatılmamıştır (execFile hiç import edilmiyor/kullanılmıyor).
export async function preflightSceneImages(scenes, {
  width,
  height,
  workDir,
  downloadAndNormalizeSceneImageImpl = downloadAndNormalizeSceneImage,
  writeFileImpl = fs.writeFile
} = {}) {
  const sourcePaths = [];
  for (let i = 0; i < scenes.length; i++) {
    console.log(`[preflight ${i + 1}/${scenes.length}] indiriliyor/doğrulanıyor...`);
    const normalizedPng = await downloadAndNormalizeSceneImageImpl(scenes[i], i, { width, height });
    const sourcePath = path.join(workDir, `cinematic-scene-${i}-source.png`);
    await writeFileImpl(sourcePath, normalizedPng);
    sourcePaths.push(sourcePath);
  }
  return sourcePaths;
}

// renderSceneClips: SADECE preflightSceneImages TÜM sahneler için başarıyla
// TAMAMLANDIKTAN SONRA çağrılmalıdır (bkz. scripts/render-cinematic-reel.mjs
// run()'daki çağrı sırası). Her sahne için AYRI bir FFmpeg süreci başlatır.
export async function renderSceneClips(scenes, sourcePaths, {
  fps,
  width,
  height,
  visualProfile,
  cinematicOptions,
  workDir,
  buildScenePlanImpl = buildScenePlan,
  writeFileImpl = fs.writeFile,
  execFileImpl = execFileAsync,
  onProgress
} = {}) {
  const scenePlans = [];
  const appliedEffects = new Set();
  const fallbacks = new Set();
  const warnings = [];

  for (let i = 0; i < scenes.length; i++) {
    const plan = await buildScenePlanImpl({
      scene: scenes[i], sceneIndex: i, sourceImagePath: sourcePaths[i],
      fps, width, height, visualProfile, cinematicOptions, workDir
    });
    for (const file of plan.filesToWrite) await writeFileImpl(file.path, file.buffer);

    if (onProgress) onProgress(i, scenes.length, scenes[i]);
    await execFileImpl("ffmpeg", plan.args, { maxBuffer: 1024 * 1024 * 64 });

    plan.appliedEffects.forEach((e) => appliedEffects.add(e));
    plan.fallbacks.forEach((f) => fallbacks.add(f));
    warnings.push(...plan.warnings);
    scenePlans.push(plan);
  }

  return { scenePlans, appliedEffects, fallbacks, warnings };
}
