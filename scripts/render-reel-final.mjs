import "dotenv/config";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { put } from "@vercel/blob";
import { readVideoJobStatus, writeVideoJobStatus } from "../src/lib/video-jobs.js";
import { fetchPublicVideo, fetchPublicAudio } from "../src/lib/upload-media.js";
import { buildSceneConcatFfmpegArgs } from "../src/lib/reel-scene-concat-ffmpeg.js";
import { buildReelAudioFfmpegArgs } from "../src/lib/reel-audio-ffmpeg.js";

const execFileAsync = promisify(execFile);

// bkz. scripts/render-reel-audio.mjs — jobId ile video-jobs/<jobId>.json
// içindeki payload'u okuyan AYNI desen. Bu script İKİ AŞAMADIR: (1) Step 5'in
// sahne videolarını sırayla TEK bir sessiz videoya birleştirir (concat,
// src/lib/reel-scene-concat-ffmpeg.js — YENİ, küçük ek), (2) o birleşik
// videoyu, MEVCUT/DEĞİŞTİRİLMEMİŞ buildReelAudioFfmpegArgs (aynı
// render-reel-audio.mjs'in kullandığı fonksiyon) ile seslendirme/müzik
// mix'inden geçirir — ses-mix FFmpeg mantığı BURADA TEKRAR YAZILMAZ.
const jobId = process.env.JOB_ID;
if (!jobId) {
  console.error("JOB_ID env değişkeni gerekli.");
  process.exit(1);
}

function redactUrlForLog(rawUrl) {
  try {
    const url = new URL(String(rawUrl));
    return `${url.origin}${url.pathname}`;
  } catch {
    return "[geçersiz URL]";
  }
}

let currentPayload;

async function markFailed(error) {
  console.error(error);
  if (!currentPayload) {
    try {
      const existing = await readVideoJobStatus(jobId);
      if (existing?.payload) currentPayload = existing.payload;
    } catch { /* kurtarılamadı — aşağıda payload'sız yazılacak */ }
  }
  try {
    await writeVideoJobStatus(jobId, {
      status: "failed",
      error: error?.message || String(error),
      ...(currentPayload ? { payload: currentPayload } : {})
    }, { allowOverwrite: true });
  } catch (writeError) {
    console.error("Durum 'failed' olarak yazılamadı:", writeError);
  }
}

async function probeDurationSeconds(filePath) {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "csv=p=0",
    filePath
  ]);
  const parsed = Number.parseFloat(stdout.trim());
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error("Video süresi ffprobe ile ölçülemedi.");
  return parsed;
}

async function runFfmpeg(args) {
  try {
    await execFileAsync("ffmpeg", args, { maxBuffer: 1024 * 1024 * 64 });
  } catch (error) {
    const stderrTail = String(error.stderr || "").split("\n").slice(-100).join("\n");
    console.error("ffmpeg stderr (son 100 satır):\n" + stderrTail);
    throw error;
  }
}

async function run() {
  const job = await readVideoJobStatus(jobId);
  if (!job || !job.payload) {
    throw new Error(`video-jobs/${jobId}.json içinde bir payload bulunamadı.`);
  }
  currentPayload = job.payload;
  const { sceneVideoUrls, voiceoverUrl, musicUrl, musicVolume } = job.payload;

  await writeVideoJobStatus(jobId, { status: "rendering", payload: job.payload }, { allowOverwrite: true });

  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "buzsu-reel-final-"));
  try {
    console.log(`${sceneVideoUrls.length} sahne videosu indiriliyor (sırayla)...`);
    const scenePaths = [];
    for (let index = 0; index < sceneVideoUrls.length; index++) {
      console.log(`  Sahne ${index + 1}/${sceneVideoUrls.length}: ${redactUrlForLog(sceneVideoUrls[index])}`);
      const { buffer } = await fetchPublicVideo(sceneVideoUrls[index]);
      const scenePath = path.join(workDir, `scene-${index}.mp4`);
      await fs.writeFile(scenePath, buffer);
      scenePaths.push(scenePath);
    }

    const concatenatedPath = path.join(workDir, "concatenated.mp4");
    const { args: concatArgs } = buildSceneConcatFfmpegArgs({ scenePaths, outputPath: concatenatedPath });
    console.log(`FFmpeg sahne birleştirme başlıyor (${scenePaths.length} sahne)...`);
    await runFfmpeg(concatArgs);
    const videoDurationSeconds = await probeDurationSeconds(concatenatedPath);

    let voiceoverPath;
    if (voiceoverUrl) {
      console.log(`Seslendirme indiriliyor: ${redactUrlForLog(voiceoverUrl)}`);
      const { buffer } = await fetchPublicAudio(voiceoverUrl);
      voiceoverPath = path.join(workDir, "voice.audio");
      await fs.writeFile(voiceoverPath, buffer);
    }

    let musicPath;
    if (musicUrl) {
      console.log(`Müzik indiriliyor: ${redactUrlForLog(musicUrl)}`);
      const { buffer } = await fetchPublicAudio(musicUrl);
      musicPath = path.join(workDir, "music.audio");
      await fs.writeFile(musicPath, buffer);
    }

    const outputPath = path.join(workDir, "output.mp4");
    // Ses-mix mantığı BİREBİR reuse edilir — render-reel-audio.mjs'in
    // kullandığı AYNI fonksiyon, yalnızca videoPath artık birleştirilmiş
    // sahne videosudur.
    const { args: mixArgs } = buildReelAudioFfmpegArgs({
      videoPath: concatenatedPath,
      voiceoverPath,
      musicPath,
      musicVolume,
      videoDurationSeconds,
      outputPath
    });

    console.log("FFmpeg ses mix'i başlıyor...");
    await runFfmpeg(mixArgs);

    const stat = await fs.stat(outputPath);
    const realDurationSeconds = await probeDurationSeconds(outputPath);
    const fileBuffer = await fs.readFile(outputPath);

    if (!process.env.BLOB_READ_WRITE_TOKEN) throw new Error("BLOB_READ_WRITE_TOKEN tanımlı değil.");
    console.log("Vercel Blob'a yükleniyor.");
    const blob = await put(`reel-final/${jobId}.mp4`, fileBuffer, {
      access: "public",
      contentType: "video/mp4",
      addRandomSuffix: false
    });

    await writeVideoJobStatus(jobId, {
      status: "completed",
      videoUrl: blob.url,
      durationSeconds: Number(realDurationSeconds.toFixed(2)),
      fileSizeBytes: stat.size,
      sceneCount: scenePaths.length,
      voiceoverIncluded: Boolean(voiceoverUrl),
      musicIncluded: Boolean(musicUrl)
    }, { allowOverwrite: true });

    console.log("Tamamlandı:", blob.url);
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

run().catch(async (error) => {
  await markFailed(error);
  process.exit(1);
});
