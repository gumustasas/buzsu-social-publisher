import "dotenv/config";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { put } from "@vercel/blob";
import { readVideoJobStatus, writeVideoJobStatus } from "../src/lib/video-jobs.js";
import { fetchPublicAudio } from "../src/lib/upload-media.js";
import { downloadAndNormalizeSceneImage, redactSceneUrlForLog } from "../src/cinematic/scene-image.js";
import { buildScenePlan, buildMergePlan } from "../src/cinematic/render-plan.js";
import { buildCinematicAudioMixArgs, resolveSoundDesignFallback } from "../src/cinematic/audio-mix.js";
import { probeCinematicOutput, evaluateCinematicQc } from "../src/cinematic/qc.js";

// compose_cinematic_reel (TASK-011) worker — render-product-video.mjs ile
// AYNI mimari (GitHub Actions workflow_dispatch, video-jobs.js Blob
// job-status), ama TAMAMEN AYRI bir render motoru: sahne başına AYRI klip +
// xfade birleştirme + (varsa) ayrı bir ses mix geçişi + ffprobe QC kapısı
// (bkz. src/cinematic/render-plan.js, audio-mix.js, qc.js).

const execFileAsync = promisify(execFile);
const jobId = process.env.JOB_ID;

let currentPayload;

// markFailed, render-product-video.mjs'teki AYNI "payload'u koru" deseni —
// bkz. o dosyadaki ayrıntılı gerekçe (GitHub Actions "re-run failed jobs"
// payload'u kaybetmesin diye).
async function markFailed(error, extra = {}) {
  console.error(error);
  if (!currentPayload) {
    try {
      const existing = await readVideoJobStatus(jobId);
      if (existing?.payload) currentPayload = existing.payload;
    } catch { /* kurtarılamadı */ }
  }
  try {
    await writeVideoJobStatus(jobId, {
      status: "failed",
      error: error?.message || String(error),
      ...extra,
      ...(currentPayload ? { payload: currentPayload } : {})
    }, { allowOverwrite: true });
  } catch (writeError) {
    console.error("Durum 'failed' olarak yazılamadı:", writeError);
  }
}

async function run() {
  const job = await readVideoJobStatus(jobId);
  if (!job || !job.payload) {
    throw new Error(`video-jobs/${jobId}.json içinde bir payload bulunamadı.`);
  }
  currentPayload = job.payload;
  const { scenes, visualProfile, cinematic, audio, output } = job.payload;
  const { width, height, fps } = output;

  await writeVideoJobStatus(jobId, { status: "rendering", payload: job.payload }, { allowOverwrite: true });

  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "buzsu-cinematic-"));
  try {
    const appliedEffects = new Set();
    const fallbacks = new Set();
    const warnings = [];

    // --- Aşama 1: her sahneyi indir/doğrula/normalize et, sonra AYRI klip render et ---
    const scenePlans = [];
    for (let i = 0; i < scenes.length; i++) {
      const scene = scenes[i];
      console.log(`[sahne ${i + 1}/${scenes.length}] indiriliyor: ${redactSceneUrlForLog(scene.imageUrl)}`);
      // TASK-010'un sertleştirilmiş fetchPublicImage yolu (SSRF/DNS + MIME +
      // magic-byte + decode doğrulaması) BURADA, tüm render/FFmpeg
      // adımlarından ÖNCE tetiklenir — geçersiz bir görsel bu satırda,
      // sahne bağlamıyla (InvalidSceneImageError) throw eder.
      const normalizedPng = await downloadAndNormalizeSceneImage(scene, i, { width, height });
      const sourcePath = path.join(workDir, `cinematic-scene-${i}-source.png`);
      await fs.writeFile(sourcePath, normalizedPng);

      const plan = await buildScenePlan({
        scene, sceneIndex: i, sourceImagePath: sourcePath,
        fps, width, height, visualProfile, cinematicOptions: cinematic, workDir
      });
      for (const file of plan.filesToWrite) await fs.writeFile(file.path, file.buffer);

      console.log(`[sahne ${i + 1}/${scenes.length}] render ediliyor (kamera: ${scene.camera.type}, geçiş: ${scene.transition.type})...`);
      await execFileAsync("ffmpeg", plan.args, { maxBuffer: 1024 * 1024 * 64 });

      plan.appliedEffects.forEach((e) => appliedEffects.add(e));
      plan.fallbacks.forEach((f) => fallbacks.add(f));
      warnings.push(...plan.warnings);
      scenePlans.push(plan);
    }

    // --- Aşama 2: klipleri ardışık ikili xfade ile birleştir ---
    const silentOutputPath = audio.voiceoverUrl || audio.musicUrl
      ? path.join(workDir, "cinematic-silent.mp4")
      : path.join(workDir, "cinematic-final.mp4");
    const { mergeSteps, totalDurationSeconds } = buildMergePlan({
      scenePlans, scenes, width, height, fps, workDir, finalOutputPath: silentOutputPath
    });
    for (let i = 0; i < mergeSteps.length; i++) {
      console.log(`[birleştirme ${i + 1}/${mergeSteps.length}] xfade=${mergeSteps[i].xfadeName}...`);
      await execFileAsync("ffmpeg", mergeSteps[i].args, { maxBuffer: 1024 * 1024 * 64 });
    }
    scenes.slice(0, -1).forEach((scene) => appliedEffects.add(`transition_${scene.transition.type}`));

    // --- Aşama 3: (varsa) ses mix ---
    let finalOutputPath = silentOutputPath;
    let audioIncluded = false;
    const soundDesignResult = resolveSoundDesignFallback(audio.soundDesign);
    if (soundDesignResult.fallback) fallbacks.add(soundDesignResult.fallback);

    if (audio.voiceoverUrl || audio.musicUrl) {
      let voiceoverPath;
      let musicPath;
      if (audio.voiceoverUrl) {
        console.log("Seslendirme indiriliyor:", redactSceneUrlForLog(audio.voiceoverUrl));
        const { buffer } = await fetchPublicAudio(audio.voiceoverUrl);
        voiceoverPath = path.join(workDir, "cinematic-voiceover.mp3");
        await fs.writeFile(voiceoverPath, buffer);
      }
      if (audio.musicUrl) {
        console.log("Müzik indiriliyor:", redactSceneUrlForLog(audio.musicUrl));
        const { buffer } = await fetchPublicAudio(audio.musicUrl);
        musicPath = path.join(workDir, "cinematic-music.mp3");
        await fs.writeFile(musicPath, buffer);
      }
      finalOutputPath = path.join(workDir, "cinematic-final.mp4");
      const { args: audioArgs } = buildCinematicAudioMixArgs({
        videoPath: silentOutputPath,
        voiceoverPath,
        musicPath,
        duckDb: audio.duckDb,
        autoDuck: audio.autoDuck,
        videoDurationSeconds: totalDurationSeconds,
        outputPath: finalOutputPath
      });
      console.log("Ses mix ediliyor...");
      await execFileAsync("ffmpeg", audioArgs, { maxBuffer: 1024 * 1024 * 64 });
      audioIncluded = true;
      if (voiceoverPath && musicPath && audio.autoDuck) appliedEffects.add("audio_auto_duck");
      if (voiceoverPath || musicPath) appliedEffects.add("audio_mix");
    }

    // --- Aşama 4: ffprobe QC (manifest: "QC failure must PREVENT the
    // output from being reported as a successful production-ready render") ---
    const stat = await fs.stat(finalOutputPath);
    const probeJson = await probeCinematicOutput(finalOutputPath);
    const qc = evaluateCinematicQc({
      ffprobeJson: probeJson,
      fileSizeBytes: stat.size,
      expected: { width, height, fps, durationSeconds: totalDurationSeconds },
      audioExpected: audioIncluded
    });
    if (!qc.pass) {
      const failedChecks = qc.checks.filter((c) => !c.pass).map((c) => `${c.name}: ${c.detail}`).join("; ");
      throw new Error(`ffprobe QC başarısız oldu, çıktı başarılı olarak raporlanmayacak: ${failedChecks}`);
    }

    console.log("Vercel Blob'a yükleniyor.");
    if (!process.env.BLOB_READ_WRITE_TOKEN) throw new Error("BLOB_READ_WRITE_TOKEN tanımlı değil.");
    const fileBuffer = await fs.readFile(finalOutputPath);
    const blob = await put(`cinematic-reels/${jobId}.mp4`, fileBuffer, {
      access: "public",
      contentType: "video/mp4",
      addRandomSuffix: false
    });

    await writeVideoJobStatus(jobId, {
      status: "completed",
      videoUrl: blob.url,
      durationSeconds: Number(qc.measured.durationSeconds.toFixed(2)),
      width: qc.measured.width,
      height: qc.measured.height,
      fps: qc.measured.fps,
      fileSizeBytes: stat.size,
      sceneCount: scenes.length,
      appliedEffects: [...appliedEffects],
      fallbacks: [...fallbacks],
      warnings: [...new Set(warnings)],
      qc: { pass: true, checks: qc.checks }
    }, { allowOverwrite: true });

    console.log("Tamamlandı:", blob.url);
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

// TASK-010/TASK-011 ile AYNI desen (bkz. scripts/render-product-video.mjs):
// bu dosya import edildiğinde (test'ler için) JOB_ID kontrolü/process.exit/
// gerçek render ASLA tetiklenmez.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!jobId) {
    console.error("JOB_ID env değişkeni gerekli.");
    process.exit(1);
  }
  run().catch(async (error) => {
    await markFailed(error);
    process.exit(1);
  });
}
