import "dotenv/config";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { put } from "@vercel/blob";
import { readVideoJobStatus, writeVideoJobStatus } from "../src/lib/video-jobs.js";
import { fetchPublicVideo, fetchPublicAudio } from "../src/lib/upload-media.js";
import { buildReelAudioFfmpegArgs } from "../src/lib/reel-audio-ffmpeg.js";

const execFileAsync = promisify(execFile);

// bkz. scripts/render-product-video.mjs — jobId ile video-jobs/<jobId>.json
// içindeki payload'u okuyan AYNI desen (workflow_dispatch karmaşık veri
// taşıyamıyor).
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

async function run() {
  const job = await readVideoJobStatus(jobId);
  if (!job || !job.payload) {
    throw new Error(`video-jobs/${jobId}.json içinde bir payload bulunamadı.`);
  }
  currentPayload = job.payload;
  const { videoUrl, voiceoverUrl, musicUrl, musicVolume } = job.payload;

  await writeVideoJobStatus(jobId, { status: "rendering", payload: job.payload }, { allowOverwrite: true });

  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "buzsu-reel-audio-"));
  try {
    console.log(`Video indiriliyor: ${redactUrlForLog(videoUrl)}`);
    const { buffer: videoBuffer } = await fetchPublicVideo(videoUrl);
    const videoPath = path.join(workDir, "input.mp4");
    await fs.writeFile(videoPath, videoBuffer);
    const videoDurationSeconds = await probeDurationSeconds(videoPath);

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
    const { args: ffmpegArgs } = buildReelAudioFfmpegArgs({
      videoPath,
      voiceoverPath,
      musicPath,
      musicVolume,
      videoDurationSeconds,
      outputPath
    });

    console.log("FFmpeg ses mix'i başlıyor...");
    try {
      await execFileAsync("ffmpeg", ffmpegArgs, { maxBuffer: 1024 * 1024 * 64 });
    } catch (error) {
      const stderrTail = String(error.stderr || "").split("\n").slice(-100).join("\n");
      console.error("ffmpeg stderr (son 100 satır):\n" + stderrTail);
      throw error;
    }

    const stat = await fs.stat(outputPath);
    const realDurationSeconds = await probeDurationSeconds(outputPath);
    const fileBuffer = await fs.readFile(outputPath);

    if (!process.env.BLOB_READ_WRITE_TOKEN) throw new Error("BLOB_READ_WRITE_TOKEN tanımlı değil.");
    console.log("Vercel Blob'a yükleniyor.");
    const blob = await put(`reel-audio/${jobId}.mp4`, fileBuffer, {
      access: "public",
      contentType: "video/mp4",
      addRandomSuffix: false
    });

    await writeVideoJobStatus(jobId, {
      status: "completed",
      videoUrl: blob.url,
      durationSeconds: Number(realDurationSeconds.toFixed(2)),
      fileSizeBytes: stat.size,
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
