import "dotenv/config";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { put } from "@vercel/blob";
import { readVideoJobStatus, writeVideoJobStatus } from "../src/lib/video-jobs.js";
import { fetchPublicImage, fetchPublicAudio } from "../src/lib/upload-media.js";
import { composeVideoFrame, composeClosingScene } from "../src/post-branding.js";
import { buildFfmpegArgs } from "../src/lib/ffmpeg-command.js";

const execFileAsync = promisify(execFile);

// GitHub Actions workflow_dispatch en fazla 10 string input kabul eder ve
// mediaItems gibi karmaşık/uzun verileri taşımaya uygun değildir — bu yüzden
// src/video-compose.js dispatch'ten ÖNCE tüm işi (mediaItems, süre/transition
// seçenekleri, opsiyonel müzik) video-jobs/<jobId>.json'a "queued" durumuyla
// yazar ve workflow_dispatch'e yalnızca jobId gönderir. Bu worker aynı
// jobId'yi okuyup gerçek payload'u buradan alır.
const jobId = process.env.JOB_ID;
if (!jobId) {
  console.error("JOB_ID env değişkeni gerekli.");
  process.exit(1);
}

async function markFailed(error) {
  console.error(error);
  try {
    await writeVideoJobStatus(jobId, { status: "failed", error: error?.message || String(error) }, { allowOverwrite: true });
  } catch (writeError) {
    console.error("Durum 'failed' olarak yazılamadı:", writeError);
  }
}

async function probeDurationSeconds(filePath, fallbackSeconds) {
  try {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "csv=p=0",
      filePath
    ]);
    const parsed = Number.parseFloat(stdout.trim());
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackSeconds;
  } catch {
    // ffprobe her ortamda garanti değil (apt'deki ffmpeg paketiyle birlikte
    // gelir ama yine de savunmacı davranıyoruz) — bulunamazsa filtre
    // grafiğinden matematiksel olarak hesaplanan süreye düşülür.
    return fallbackSeconds;
  }
}

async function run() {
  const job = await readVideoJobStatus(jobId);
  if (!job || !job.payload) {
    throw new Error(`video-jobs/${jobId}.json içinde bir payload bulunamadı.`);
  }
  const { mediaItems, durationPerImageSeconds, transition, transitionDurationSeconds, closing, musicUrl, musicVolume } = job.payload;

  await writeVideoJobStatus(jobId, { status: "rendering", payload: job.payload }, { allowOverwrite: true });

  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "buzsu-video-"));
  try {
    // src/video-compose.js yalnızca URL'lerin söz dizimini (yalnızca HTTPS)
    // doğrular; gerçek SSRF/DNS koruması ve indirme burada,
    // fetchPublicImage/fetchPublicAudio (bkz. src/lib/upload-media.js)
    // üzerinden yapılır — bu worker'ın tek gerçek ağ erişim noktası.
    const frames = [];
    for (let i = 0; i < mediaItems.length; i++) {
      const item = mediaItems[i];
      console.log(`[${i + 1}/${mediaItems.length}] indiriliyor: ${item.imageUrl}`);
      const { buffer } = await fetchPublicImage(item.imageUrl);
      const framePng = await composeVideoFrame(buffer, { title: item.title || "" });
      const framePath = path.join(workDir, `frame-${i}.png`);
      await fs.writeFile(framePath, framePng);
      frames.push({ path: framePath });
    }

    console.log("Kapanış sahnesi oluşturuluyor.");
    const closingPng = await composeClosingScene(closing || {});
    const closingPath = path.join(workDir, "closing.png");
    await fs.writeFile(closingPath, closingPng);

    let musicPath;
    if (musicUrl) {
      console.log(`Müzik indiriliyor: ${musicUrl}`);
      const { buffer } = await fetchPublicAudio(musicUrl);
      musicPath = path.join(workDir, "music.mp3");
      await fs.writeFile(musicPath, buffer);
    }

    const outputPath = path.join(workDir, "output.mp4");
    const { args, totalDurationSeconds } = buildFfmpegArgs({
      frames,
      closingFrame: { path: closingPath },
      durationPerImageSeconds,
      transition,
      transitionDurationSeconds,
      musicPath,
      musicVolume,
      outputPath
    });

    console.log("ffmpeg çalıştırılıyor:", ["ffmpeg", ...args].join(" "));
    await execFileAsync("ffmpeg", args, { maxBuffer: 1024 * 1024 * 64 });

    const stat = await fs.stat(outputPath);
    const realDurationSeconds = await probeDurationSeconds(outputPath, totalDurationSeconds);
    const fileBuffer = await fs.readFile(outputPath);

    if (!process.env.BLOB_READ_WRITE_TOKEN) throw new Error("BLOB_READ_WRITE_TOKEN tanımlı değil.");
    console.log("Vercel Blob'a yükleniyor.");
    const blob = await put(`product-videos/${jobId}.mp4`, fileBuffer, {
      access: "public",
      contentType: "video/mp4",
      addRandomSuffix: false
    });

    await writeVideoJobStatus(jobId, {
      status: "completed",
      videoUrl: blob.url,
      durationSeconds: Number(realDurationSeconds.toFixed(2)),
      width: 1080,
      height: 1920,
      fileSizeBytes: stat.size
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
