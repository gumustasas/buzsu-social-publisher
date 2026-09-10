import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { composeVideoFrame, composeClosingScene } from "../src/post-branding.js";
import { buildFfmpegArgs } from "../src/lib/ffmpeg-command.js";

// GERÇEK bir FFmpeg render'ı yapan, secrets/token GEREKTİRMEYEN bir smoke
// testi: scripts/render-product-video.mjs (gerçek worker) ile aynı
// composeVideoFrame/composeClosingScene/buildFfmpegArgs çağrılarını, depo
// içindeki küçük fixture görselleriyle (test/fixtures/video/) çalıştırır ve
// çıktı MP4'ü ffprobe + piksel analiziyle doğrular. Blob'a yükleme veya
// GitHub API çağrısı YAPMAZ — çıktı yalnızca local-output/ altına yazılır
// (CI'da bu klasör bir artifact olarak yüklenir).
//
// Amaç: src/lib/ffmpeg-command.js'in zoompan/xfade matematiğini yalnızca
// argv üretimi düzeyinde değil, GERÇEK ffmpeg çalıştırarak doğrulamak —
// özellikle zoompan'ın "loop edilen görsele ikinci gerçek kare gelirse zoom
// biriktiricisi sıfırlanır" tuzağına karşı alınan önlemin işe yaradığını.

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "..");
const FIXTURES_DIR = path.join(REPO_ROOT, "test/fixtures/video");
const OUTPUT_DIR = path.join(REPO_ROOT, "local-output", "smoke-test");

const DURATION_PER_IMAGE_SECONDS = 1.5;
const CLOSING_DURATION_SECONDS = 2.5;
const TRANSITION_DURATION_SECONDS = 0.4;
const DURATION_TOLERANCE_SECONDS = 0.5;
const EXPECTED_WIDTH = 1080;
const EXPECTED_HEIGHT = 1920;
const EXPECTED_FPS = 30;
const MIN_FILE_SIZE_BYTES = 20 * 1024;
// Bir kare "siyah/boş" sayılır eğer tüm kanalların ortalaması bu değerin
// altındaysa (neredeyse tamamen siyah) VEYA standart sapması bu değerin
// altındaysa (tek renk, hiçbir detay/bindirme görünmüyor).
const BLACK_FRAME_MEAN_THRESHOLD = 8;
const BLANK_FRAME_STDDEV_THRESHOLD = 3;
// Beklenen sahneyle çıkarılan kare arasındaki fark bu eşiğin altında kalmalı
// (0-255 skalasında, 16x16 gri tonlamalı ortalama mutlak fark). zoompan'ın
// hafif kırpması/kodlama artefaktları payı bırakılıyor — tam piksel eşitliği
// beklenmiyor, yalnızca "doğru sahne bu mu" kabaca doğrulanıyor.
const SCENE_MATCH_MAX_DIFF = 45;

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
}

async function run() {
  await fs.rm(OUTPUT_DIR, { recursive: true, force: true }).catch(() => {});
  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  const fixtureFiles = ["product-1.png", "product-2.png", "product-3.png"];
  const frames = [];
  const expectedFramePngs = [];
  for (let i = 0; i < fixtureFiles.length; i++) {
    const buffer = await fs.readFile(path.join(FIXTURES_DIR, fixtureFiles[i]));
    const framePng = await composeVideoFrame(buffer, { title: `Ürün ${i + 1}` });
    const framePath = path.join(OUTPUT_DIR, `frame-${i}.png`);
    await fs.writeFile(framePath, framePng);
    frames.push({ path: framePath });
    expectedFramePngs.push(framePng);
  }

  const closingPng = await composeClosingScene();
  const closingPath = path.join(OUTPUT_DIR, "closing.png");
  await fs.writeFile(closingPath, closingPng);

  const outputPath = path.join(OUTPUT_DIR, "smoke-test.mp4");
  const { args, totalDurationSeconds } = buildFfmpegArgs({
    frames,
    closingFrame: { path: closingPath },
    durationPerImageSeconds: DURATION_PER_IMAGE_SECONDS,
    closingDurationSeconds: CLOSING_DURATION_SECONDS,
    transition: "fade",
    transitionDurationSeconds: TRANSITION_DURATION_SECONDS,
    outputPath
  });

  console.log(`Beklenen toplam süre (filtre grafiği matematiğinden): ${totalDurationSeconds.toFixed(2)}s`);
  console.log("ffmpeg çalıştırılıyor (gerçek render, birkaç dakika sürebilir)...");
  const renderStart = Date.now();
  await execFileAsync("ffmpeg", args, { maxBuffer: 1024 * 1024 * 64 });
  console.log(`ffmpeg tamamlandı (${((Date.now() - renderStart) / 1000).toFixed(1)}s).`);

  // --- Dosya var mı / boş değil mi ---
  const stat = await fs.stat(outputPath).catch(() => null);
  record("output.mp4 oluşturuldu ve boş değil", Boolean(stat && stat.size >= MIN_FILE_SIZE_BYTES), stat ? `${stat.size} bayt` : "dosya yok");

  // --- ffprobe ile codec/çözünürlük/pix_fmt/fps/süre ---
  const probe = await ffprobeJson(outputPath);
  const videoStream = probe.streams?.find((s) => s.codec_type === "video");
  record("video codec H.264", videoStream?.codec_name === "h264", videoStream?.codec_name);
  record(`çözünürlük ${EXPECTED_WIDTH}x${EXPECTED_HEIGHT}`, videoStream?.width === EXPECTED_WIDTH && videoStream?.height === EXPECTED_HEIGHT, `${videoStream?.width}x${videoStream?.height}`);
  record("pixel format yuv420p", videoStream?.pix_fmt === "yuv420p", videoStream?.pix_fmt);
  const fps = parseFrameRate(videoStream?.r_frame_rate);
  record(`frame rate ${EXPECTED_FPS}fps`, Math.abs(fps - EXPECTED_FPS) < 0.5, `${fps}fps (r_frame_rate=${videoStream?.r_frame_rate})`);
  const measuredDuration = Number.parseFloat(probe.format?.duration || "0");
  record(
    `süre beklenen tolerans içinde (${totalDurationSeconds.toFixed(2)}s ± ${DURATION_TOLERANCE_SECONDS}s)`,
    Math.abs(measuredDuration - totalDurationSeconds) <= DURATION_TOLERANCE_SECONDS,
    `ölçülen ${measuredDuration.toFixed(2)}s`
  );

  // --- Başlangıç/orta/son karelerin siyah/boş olmadığını doğrula ---
  const sampleTimes = {
    start: 0.15,
    middle: measuredDuration / 2,
    end: Math.max(0.1, measuredDuration - 0.25)
  };
  const extractedFrames = {};
  for (const [label, t] of Object.entries(sampleTimes)) {
    const framePath = path.join(OUTPUT_DIR, `extracted-${label}.png`);
    await extractFrameAt(outputPath, t, framePath);
    extractedFrames[label] = framePath;
    const stats = await sharp(framePath).stats();
    const means = stats.channels.map((c) => c.mean);
    const stddevs = stats.channels.map((c) => c.stdev);
    const isBlack = means.every((m) => m < BLACK_FRAME_MEAN_THRESHOLD);
    const isBlank = stddevs.every((s) => s < BLANK_FRAME_STDDEV_THRESHOLD);
    record(
      `${label} kare (t=${t.toFixed(2)}s) siyah/boş değil`,
      !isBlack && !isBlank,
      `mean=[${means.map((m) => m.toFixed(1)).join(",")}] stdev=[${stddevs.map((s) => s.toFixed(1)).join(",")}]`
    );
  }

  // --- İlk ürün sahnesi gerçekten göründü mü (başlangıç karesi ~ frame-0) ---
  const startDiff = await grayscaleMeanAbsDiff(extractedFrames.start, path.join(OUTPUT_DIR, "frame-0.png"));
  record("ilk ürün sahnesi (frame-0) başlangıç karesinde tanınıyor", startDiff <= SCENE_MATCH_MAX_DIFF, `fark=${startDiff.toFixed(1)} (eşik ${SCENE_MATCH_MAX_DIFF})`);

  // --- Kapanış sahnesi gerçekten göründü mü (son kare ~ closing.png) ---
  const endDiff = await grayscaleMeanAbsDiff(extractedFrames.end, closingPath);
  record("kapanış sahnesi son karede tanınıyor", endDiff <= SCENE_MATCH_MAX_DIFF, `fark=${endDiff.toFixed(1)} (eşik ${SCENE_MATCH_MAX_DIFF})`);

  const report = {
    generatedAt: new Date().toISOString(),
    expectedTotalDurationSeconds: totalDurationSeconds,
    measuredDurationSeconds: measuredDuration,
    ffprobe: { codec: videoStream?.codec_name, width: videoStream?.width, height: videoStream?.height, pixFmt: videoStream?.pix_fmt, fps },
    fileSizeBytes: stat?.size ?? 0,
    checks: results
  };
  await fs.writeFile(path.join(OUTPUT_DIR, "report.json"), JSON.stringify(report, null, 2));

  const failed = results.filter((r) => !r.pass);
  console.log("\n--- Smoke test özeti ---");
  for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}`);
  if (failed.length) {
    console.error(`\n${failed.length} kontrol başarısız oldu.`);
    process.exitCode = 1;
  } else {
    console.log(`\nTüm ${results.length} kontrol başarılı.`);
  }
}

async function ffprobeJson(filePath) {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "error",
    "-print_format", "json",
    "-show_format",
    "-show_streams",
    filePath
  ]);
  return JSON.parse(stdout);
}

function parseFrameRate(rFrameRate) {
  if (!rFrameRate) return NaN;
  const [num, den] = rFrameRate.split("/").map(Number);
  if (!den) return num;
  return num / den;
}

async function extractFrameAt(videoPath, timeSeconds, outPath) {
  await execFileAsync("ffmpeg", [
    "-y",
    "-ss", String(Math.max(0, timeSeconds)),
    "-i", videoPath,
    "-frames:v", "1",
    outPath
  ]);
}

// İki görseli 16x16 gri tonlamaya indirger ve piksel başına ortalama mutlak
// farkı (0-255) döner — sıkı bir piksel eşitliği değil, kaba bir "aynı sahne
// mi" benzerlik kontrolü (zoompan kırpması/H.264 kodlama artefaktları payı
// bırakılır).
async function grayscaleMeanAbsDiff(pathA, pathB) {
  const size = 16;
  const [a, b] = await Promise.all([
    sharp(pathA).resize(size, size, { fit: "fill" }).grayscale().raw().toBuffer(),
    sharp(pathB).resize(size, size, { fit: "fill" }).grayscale().raw().toBuffer()
  ]);
  let total = 0;
  for (let i = 0; i < a.length; i++) total += Math.abs(a[i] - b[i]);
  return total / a.length;
}

run().catch((error) => {
  console.error("Smoke test beklenmeyen bir hatayla durdu:", error);
  process.exitCode = 1;
});
