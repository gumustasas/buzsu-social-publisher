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
import { redactSceneUrlForLog } from "../src/cinematic/scene-image.js";
import { buildMergePlan } from "../src/cinematic/render-plan.js";
import { preflightSceneImages, renderSceneClips } from "../src/cinematic/scene-pipeline.js";
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
    // --- Aşama 1 (preflight): TÜM sahneler indirilip TASK-010 ile
    // doğrulanıp normalize edilir — BU AŞAMADA TEK BİR FFmpeg/execFile
    // ÇAĞRISI YAPILMAZ (bkz. src/cinematic/scene-pipeline.js dosya başı
    // yorumu). Sahne N+1 geçersizse (InvalidSceneImageError — scene_index/
    // original_url/failure_stage/stable_error_code bağlamıyla), sahne 0..N
    // için TEK bir FFmpeg render süreci dahi BAŞLAMAMIŞ olur; renderSceneClips
    // (Aşama 2) bu satıra hiç ulaşmaz çünkü preflightSceneImages throw eder.
    console.log(`Preflight: ${scenes.length} sahne indirilip doğrulanacak (henüz render YOK)...`);
    const sourcePaths = await preflightSceneImages(scenes, { width, height, workDir });
    console.log("Preflight tamamlandı — tüm sahne görselleri geçerli. Render başlıyor.");

    // --- Aşama 2: her sahne için AYRI bir FFmpeg klibi render edilir
    // (yalnızca Aşama 1 TÜM sahneler için başarıyla bittikten SONRA) ---
    const { scenePlans, appliedEffects, fallbacks, warnings } = await renderSceneClips(scenes, sourcePaths, {
      fps, width, height, visualProfile, cinematicOptions: cinematic, workDir,
      onProgress: (i, total, scene) => console.log(`[sahne ${i + 1}/${total}] render ediliyor (kamera: ${scene.camera.type}, geçiş: ${scene.transition.type})...`)
    });

    // --- Aşama 3: klipleri ardışık ikili xfade ile birleştir ---
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

    // --- Aşama 4: (varsa) ses mix ---
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

    // --- Aşama 5: ffprobe QC (manifest: "QC failure must PREVENT the
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
