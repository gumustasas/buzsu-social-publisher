// Saf FFmpeg argüman üretici: gerçek ffmpeg çalıştırmaz, yalnızca argv
// dizisini ve toplam süreyi hesaplar. Bu sayede filtre grafiği/offset
// matematiği ffmpeg binary'si olmayan ortamlarda da unit test edilebilir.
// Gerçek çalıştırma scripts/render-product-video.mjs içinde execFile ile yapılır.

const TRANSITION_MAP = { fade: "fade", wipe: "wiperight" };

const ZOOM_START = 1.0;
const ZOOM_END = 1.08;

// Loop edilen tek bir statik görselden ffmpeg'in yalnızca TEK gerçek kare
// çözmesini garanti eder: framerate çok düşük (0.1 = her 10 saniyede bir
// kare) tutulup -t bu projedeki tüm klip sürelerinden (en fazla birkaç
// saniye) kısa kaldığı için ikinci bir kare asla gelmez. İkinci bir kare
// zoompan'a ulaşırsa filtrenin dahili zoom biriktiricisi sıfırlanır ve
// zoom animasyonu klip ortasında aniden baştan başlar — bu yüzden zoompan'ın
// "d" (çıkış kare sayısı) parametresi klip süresini tek başına belirler,
// girişteki -t bunu asla aşmamalı / etkilememeli.
const INPUT_LOOP_FRAMERATE = 0.1;

function zoompanFilter(inputLabel, outputLabel, durationSeconds, fps, width, height) {
  const frameCount = Math.max(1, Math.round(durationSeconds * fps));
  const zoomStep = (ZOOM_END - ZOOM_START) / frameCount;
  const zExpr = `min(zoom+${zoomStep.toFixed(6)},${ZOOM_END})`;
  const xExpr = "iw/2-(iw/zoom/2)";
  const yExpr = "ih/2-(ih/zoom/2)";
  return {
    filter: `[${inputLabel}]zoompan=z='${zExpr}':x='${xExpr}':y='${yExpr}':d=${frameCount}:s=${width}x${height}:fps=${fps},setsar=1[${outputLabel}]`,
    exactDurationSeconds: frameCount / fps
  };
}

export function buildFfmpegArgs({
  frames,
  closingFrame,
  durationPerImageSeconds,
  closingDurationSeconds = 2.5,
  transition = "fade",
  transitionDurationSeconds = 0.4,
  musicPath,
  musicVolume = 0.5,
  width = 1080,
  height = 1920,
  fps = 30,
  outputPath
}) {
  if (!Array.isArray(frames) || frames.length < 1) {
    throw new Error("frames en az bir öğe içermelidir.");
  }
  if (!closingFrame || !closingFrame.path) {
    throw new Error("closingFrame gereklidir.");
  }
  if (!outputPath) {
    throw new Error("outputPath gereklidir.");
  }
  if (!durationPerImageSeconds || durationPerImageSeconds <= 0) {
    throw new Error("durationPerImageSeconds pozitif olmalıdır.");
  }

  const transitionName = TRANSITION_MAP[transition] || TRANSITION_MAP.fade;
  const clips = [
    ...frames.map((frame) => ({ path: frame.path, requestedDuration: durationPerImageSeconds })),
    { path: closingFrame.path, requestedDuration: closingDurationSeconds }
  ];

  const args = ["-y"];
  for (const clip of clips) {
    args.push(
      "-loop", "1",
      "-framerate", String(INPUT_LOOP_FRAMERATE),
      "-t", String(clip.requestedDuration),
      "-i", clip.path
    );
  }
  const hasMusic = Boolean(musicPath);
  if (hasMusic) {
    args.push("-stream_loop", "-1", "-i", musicPath);
  }

  const filterParts = [];
  const exactDurations = [];
  clips.forEach((clip, index) => {
    const { filter, exactDurationSeconds } = zoompanFilter(
      `${index}:v`,
      `v${index}`,
      clip.requestedDuration,
      fps,
      width,
      height
    );
    filterParts.push(filter);
    exactDurations.push(exactDurationSeconds);
  });

  let prevLabel = "v0";
  let cumulativeDuration = exactDurations[0];
  for (let i = 1; i < clips.length; i++) {
    const outLabel = i === clips.length - 1 ? "vout" : `vx${i}`;
    const offset = cumulativeDuration - i * transitionDurationSeconds;
    filterParts.push(
      `[${prevLabel}][v${i}]xfade=transition=${transitionName}:duration=${transitionDurationSeconds}:offset=${offset.toFixed(3)}[${outLabel}]`
    );
    cumulativeDuration += exactDurations[i];
    prevLabel = outLabel;
  }
  const totalDurationSeconds = cumulativeDuration - (clips.length - 1) * transitionDurationSeconds;

  if (hasMusic) {
    const musicIndex = clips.length;
    const fadeOutStart = Math.max(0, totalDurationSeconds - 1);
    const fadeOutDuration = Math.min(1, totalDurationSeconds);
    filterParts.push(
      `[${musicIndex}:a]volume=${musicVolume},afade=t=out:st=${fadeOutStart.toFixed(3)}:d=${fadeOutDuration.toFixed(3)}[aout]`
    );
  }

  const filterComplex = filterParts.join(";");

  args.push("-filter_complex", filterComplex);
  args.push("-map", "[vout]");
  if (hasMusic) {
    args.push("-map", "[aout]");
  }
  args.push(
    "-c:v", "libx264",
    "-pix_fmt", "yuv420p",
    "-r", String(fps),
    "-crf", "21",
    "-preset", "veryfast",
    "-movflags", "+faststart"
  );
  if (hasMusic) {
    args.push("-c:a", "aac", "-b:a", "128k");
  } else {
    args.push("-an");
  }
  args.push("-shortest");
  args.push(outputPath);

  return { args, totalDurationSeconds };
}
