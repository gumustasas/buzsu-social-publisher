import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const DURATION_TOLERANCE_SECONDS = 0.75;
const MIN_FILE_SIZE_BYTES = 15 * 1024;

function parseFrameRate(rFrameRate) {
  if (!rFrameRate) return NaN;
  const [num, den] = String(rFrameRate).split("/").map(Number);
  if (!den) return num;
  return num / den;
}

// evaluateCinematicQc: SAF doğrulama — gerçek ffprobe çalıştırmaz, yalnızca
// zaten alınmış bir ffprobe JSON çıktısını + dosya boyutunu beklenen
// output sözleşmesine karşı kontrol eder. Bu ayrım (probe vs. evaluate),
// tests.required'daki "QC failure must PREVENT the output from being
// reported as a successful production-ready render" şartını gerçek bir
// ffmpeg/ffprobe binary'si OLMAYAN ortamlarda da unit test edilebilir kılar
// (bkz. src/lib/ffmpeg-command.js'in AYNI "saf argüman üretici" ilkesi).
export function evaluateCinematicQc({ ffprobeJson, fileSizeBytes, expected, audioExpected }) {
  const checks = [];
  const record = (name, pass, detail) => checks.push({ name, pass, detail });

  const videoStream = ffprobeJson?.streams?.find((s) => s.codec_type === "video");
  record("video_stream_exists", Boolean(videoStream), videoStream ? "ok" : "video akışı bulunamadı");

  record(
    "resolution_matches",
    Boolean(videoStream) && videoStream.width === expected.width && videoStream.height === expected.height,
    `${videoStream?.width}x${videoStream?.height} (beklenen ${expected.width}x${expected.height})`
  );

  record("pixel_format_yuv420p", videoStream?.pix_fmt === "yuv420p", videoStream?.pix_fmt);

  const codecOk = videoStream?.codec_name === "h264";
  record("codec_h264", codecOk, videoStream?.codec_name);

  const fps = parseFrameRate(videoStream?.r_frame_rate);
  record("fps_matches", Math.abs(fps - expected.fps) < 0.5, `${fps} (beklenen ${expected.fps})`);

  const durationSeconds = Number.parseFloat(ffprobeJson?.format?.duration || "0");
  record("duration_positive", durationSeconds > 0, `${durationSeconds}s`);
  record(
    "duration_within_tolerance",
    Math.abs(durationSeconds - expected.durationSeconds) <= DURATION_TOLERANCE_SECONDS,
    `ölçülen ${durationSeconds.toFixed(2)}s, beklenen ${expected.durationSeconds.toFixed(2)}s ± ${DURATION_TOLERANCE_SECONDS}s`
  );

  record("file_size_above_minimum", fileSizeBytes >= MIN_FILE_SIZE_BYTES, `${fileSizeBytes} bayt (min ${MIN_FILE_SIZE_BYTES})`);

  if (audioExpected) {
    const audioStream = ffprobeJson?.streams?.find((s) => s.codec_type === "audio");
    record("audio_stream_exists", Boolean(audioStream), audioStream ? "ok" : "ses eklenmesi beklendi ama ses akışı bulunamadı");
  }

  const failed = checks.filter((c) => !c.pass);
  return {
    pass: failed.length === 0,
    checks,
    measured: { width: videoStream?.width, height: videoStream?.height, fps, durationSeconds, codec: videoStream?.codec_name, pixFmt: videoStream?.pix_fmt }
  };
}

// probeCinematicOutput: gerçek ffprobe'u çalıştırıp evaluateCinematicQc'e
// besler. execFileImpl enjekte edilebilir (test'te sahte ffprobe çıktısı
// vermek için) — worker script'i (scripts/render-cinematic-reel.mjs) bunu
// GERÇEK execFile ile kullanır.
export async function probeCinematicOutput(filePath, { execFileImpl = execFileAsync } = {}) {
  const { stdout } = await execFileImpl("ffprobe", [
    "-v", "error",
    "-print_format", "json",
    "-show_format",
    "-show_streams",
    filePath
  ]);
  return JSON.parse(stdout);
}
