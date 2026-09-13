import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildReelAudioFfmpegArgs } from "../src/lib/reel-audio-ffmpeg.js";

// GERÇEK bir FFmpeg render'ı yapan, secrets/token GEREKTİRMEYEN bir smoke
// testi (bkz. scripts/smoke-test-render.mjs — aynı ilke) — sidechaincompress/
// amix/alimiter filtre grafiğinin GERÇEK ffmpeg'te syntax hatası vermediğini
// doğrular; bu, buildReelAudioFfmpegArgs'ın kendi unit testlerinin (ffmpeg
// binary'si olmadan) kapsayamadığı bir şey. Depo fixture'ı gerektirmez —
// video/ses girdileri ffmpeg'in kendi lavfi jeneratörleriyle (color/sine)
// sentetik olarak üretilir.

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "..");
const OUTPUT_DIR = path.join(REPO_ROOT, "local-output", "smoke-test-reel-audio");
const CLIP_DURATION_SECONDS = 3;
const DURATION_TOLERANCE_SECONDS = 0.3;

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
}

async function makeSyntheticVideo(outPath, durationSeconds) {
  await execFileAsync("ffmpeg", [
    "-y", "-f", "lavfi", "-i", `color=c=blue:s=320x568:d=${durationSeconds}:r=30`,
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-an", outPath
  ]);
}

async function makeSyntheticTone(outPath, frequencyHz, durationSeconds) {
  await execFileAsync("ffmpeg", [
    "-y", "-f", "lavfi", "-i", `sine=frequency=${frequencyHz}:duration=${durationSeconds}`,
    "-c:a", "pcm_s16le", outPath
  ]);
}

async function ffprobeJson(filePath) {
  const { stdout } = await execFileAsync("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", filePath]);
  return JSON.parse(stdout);
}

async function run() {
  await fs.rm(OUTPUT_DIR, { recursive: true, force: true }).catch(() => {});
  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  const videoPath = path.join(OUTPUT_DIR, "input.mp4");
  const voicePath = path.join(OUTPUT_DIR, "voice.wav");
  const musicPath = path.join(OUTPUT_DIR, "music.wav");
  await makeSyntheticVideo(videoPath, CLIP_DURATION_SECONDS);
  await makeSyntheticTone(voicePath, 440, CLIP_DURATION_SECONDS);
  await makeSyntheticTone(musicPath, 220, CLIP_DURATION_SECONDS);

  // En karmaşık filtre grafiği (ducking + amix + limiter) — voice+müzik
  // birlikte. voice-only ve music-only kolları unit testlerde (mock,
  // ffmpeg'siz) zaten kapsanıyor; burada gerçek ffmpeg'e karşı en riskli
  // kombinasyon çalıştırılıyor.
  const outputPath = path.join(OUTPUT_DIR, "output.mp4");
  const { args } = buildReelAudioFfmpegArgs({
    videoPath,
    voiceoverPath: voicePath,
    musicPath,
    musicVolume: 0.5,
    videoDurationSeconds: CLIP_DURATION_SECONDS,
    outputPath
  });

  console.log("ffmpeg ses mix'i çalıştırılıyor (sidechaincompress + amix + alimiter)...");
  try {
    await execFileAsync("ffmpeg", args, { maxBuffer: 1024 * 1024 * 64 });
  } catch (error) {
    console.error("ffmpeg stderr:\n" + String(error.stderr || "").split("\n").slice(-60).join("\n"));
    throw error;
  }

  const stat = await fs.stat(outputPath).catch(() => null);
  record("output.mp4 oluşturuldu ve boş değil", Boolean(stat && stat.size > 0), stat ? `${stat.size} bayt` : "dosya yok");

  const probe = await ffprobeJson(outputPath);
  const videoStream = probe.streams?.find((s) => s.codec_type === "video");
  const audioStream = probe.streams?.find((s) => s.codec_type === "audio");
  record("video akışı var (kopyalanmış, -c:v copy)", Boolean(videoStream), videoStream?.codec_name);
  record("ses akışı var (AAC)", audioStream?.codec_name === "aac", audioStream?.codec_name);
  const duration = Number.parseFloat(probe.format?.duration || "0");
  record(
    `süre beklenen tolerans içinde (${CLIP_DURATION_SECONDS}s ± ${DURATION_TOLERANCE_SECONDS}s)`,
    Math.abs(duration - CLIP_DURATION_SECONDS) <= DURATION_TOLERANCE_SECONDS,
    `ölçülen ${duration.toFixed(2)}s`
  );

  const failed = results.filter((r) => !r.pass);
  console.log("\n--- Reel audio smoke test özeti ---");
  for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}`);
  if (failed.length) {
    console.error(`\n${failed.length} kontrol başarısız oldu.`);
    process.exitCode = 1;
  } else {
    console.log(`\nTüm ${results.length} kontrol başarılı.`);
  }
}

run().catch((error) => {
  console.error("Smoke test beklenmeyen bir hatayla durdu:", error);
  process.exitCode = 1;
});
