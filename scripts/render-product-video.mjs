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
import { buildTwoPassFfmpegArgs } from "../src/lib/ffmpeg-command.js";
import { upscaleImage } from "../src/lib/image-upscale.js";

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

// Ürün/müzik URL'leri imzalı (signed) olabilir — query string'de kısa ömürlü
// ama yine de hassas bir erişim token'ı taşıyabilir. Loglarda yalnızca
// origin+path görünür, query/hash asla yazılmaz.
function redactUrlForLog(rawUrl) {
  try {
    const url = new URL(String(rawUrl));
    return `${url.origin}${url.pathname}`;
  } catch {
    return "[geçersiz URL]";
  }
}

// run() bu değişkeni payload'u başarıyla okuduğu anda doldurur. markFailed
// bunu koruyarak yazar — aksi halde bir hata sonrası "failed" durumu
// payload'un ÜSTÜNE yazılıp işi yok ederdi: aynı jobId ile workflow'u
// yeniden tetiklemek (ör. GitHub Actions "Re-run failed jobs") bir sonraki
// denemede "payload bulunamadı" hatasıyla anında düşerdi — render gerçekte
// hiç çalışmamış olsa bile.
let currentPayload;

async function markFailed(error) {
  console.error(error);
  if (!currentPayload) {
    // run()'ın İLK readVideoJobStatus çağrısı (payload henüz hiç okunmamışken)
    // geçici bir sebeple (Blob list/fetch/JSON hatası) başarısız olmuş olabilir
    // — "failed" yazmadan önce kaydı bir kez daha okumayı deniyoruz, aksi
    // halde bu ilk-okuma hatası da payload'u yok ederdi (tam olarak bu
    // düzeltmenin önlemeye çalıştığı veri kaybı senaryosu).
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
  currentPayload = job.payload;
  const { mediaItems, durationPerImageSeconds, transition, transitionDurationSeconds, closing, musicUrl, musicVolume, upscaleImages } = job.payload;

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
      console.log(`[${i + 1}/${mediaItems.length}] indiriliyor: ${redactUrlForLog(item.imageUrl)}`);
      const { buffer: rawBuffer, mimeType } = await fetchPublicImage(item.imageUrl);
      let buffer = rawBuffer;
      if (upscaleImages) {
        console.log(`[${i + 1}/${mediaItems.length}] AI ile büyütülüyor (Replicate/Real-ESRGAN)...`);
        const upscaledUrl = await upscaleImage(rawBuffer, mimeType);
        ({ buffer } = await fetchPublicImage(upscaledUrl));
      }
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
      console.log(`Müzik indiriliyor: ${redactUrlForLog(musicUrl)}`);
      const { buffer } = await fetchPublicAudio(musicUrl);
      musicPath = path.join(workDir, "music.mp3");
      await fs.writeFile(musicPath, buffer);
    }

    const outputPath = path.join(workDir, "output.mp4");
    const { clipRenders, mergeSteps, totalDurationSeconds } = buildTwoPassFfmpegArgs({
      frames,
      closingFrame: { path: closingPath },
      durationPerImageSeconds,
      transition,
      transitionDurationSeconds,
      musicPath,
      musicVolume,
      clipDir: workDir,
      outputPath
    });

    // Pass 1: Her klibi ayrı render et — tek zoompan filtresi, düşük bellek
    for (let i = 0; i < clipRenders.length; i++) {
      console.log(`[Klip ${i + 1}/${clipRenders.length}] render ediliyor...`);
      try {
        await execFileAsync("ffmpeg", clipRenders[i].args, { maxBuffer: 1024 * 1024 * 64 });
      } catch (error) {
        const stderrTail = String(error.stderr || "").split("\n").slice(-100).join("\n");
        console.error(`Klip ${i + 1} ffmpeg stderr (son 100 satır):\n` + stderrTail);
        throw error;
      }
    }

    // Pass 2: Ardışık ikili birleştirme — her adımda 2 input, düşük bellek
    for (let i = 0; i < mergeSteps.length; i++) {
      console.log(`[Birleştirme ${i + 1}/${mergeSteps.length}] xfade...`);
      try {
        await execFileAsync("ffmpeg", mergeSteps[i].args, { maxBuffer: 1024 * 1024 * 64 });
      } catch (error) {
        const stderrTail = String(error.stderr || "").split("\n").slice(-100).join("\n");
        console.error(`Birleştirme ${i + 1} ffmpeg stderr (son 100 satır):\n` + stderrTail);
        throw error;
      }
    }

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
