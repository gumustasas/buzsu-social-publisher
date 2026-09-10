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

// zoompan, hedef "s=" boyutundaki HER çıkış karesini kaynak görselden yeniden
// örnekler (incremental/GPU değil, tam pikselli bir yeniden hesaplama) — bu
// yüzden doğrudan 1080x1920'de çalıştırmak ölçülebilir şekilde çok yavaş
// (gerçek bir ffmpeg ile ölçüldü: 3 ürün + kapanış, ~5.8sn'lik bir çıktı için
// tek çekirdekte 9+ dakika). zoompan'ı yarı çözünürlükte (540x960) çalıştırıp
// sonucu ayrı, çok daha ucuz bir `scale` filtresiyle 1080x1920'ye büyütmek
// aynı görsel Ken Burns efektini ~4 kat daha az piksel üzerinde hesaplatarak
// render süresini büyük ölçüde kısaltıyor (aynı ölçümle doğrulandı, bkz. PR
// açıklaması) — kalite kaybı üretim çıktısında (H.264 crf 21, sosyal medya
// paylaşımı) gözle fark edilir düzeyde değil.
const ZOOMPAN_INTERNAL_SCALE_DIVISOR = 2;

function zoompanFilter(inputLabel, outputLabel, durationSeconds, fps, width, height) {
  const frameCount = Math.max(1, Math.round(durationSeconds * fps));
  const zoomStep = (ZOOM_END - ZOOM_START) / frameCount;
  const zExpr = `min(zoom+${zoomStep.toFixed(6)},${ZOOM_END})`;
  const xExpr = "iw/2-(iw/zoom/2)";
  const yExpr = "ih/2-(ih/zoom/2)";
  const internalWidth = Math.round(width / ZOOMPAN_INTERNAL_SCALE_DIVISOR);
  const internalHeight = Math.round(height / ZOOMPAN_INTERNAL_SCALE_DIVISOR);
  // KRİTİK: zoompan'ın "d" parametresi çıkış kare sayısını KENDİSİ sınırlamaz
  // — yalnızca zoom ilerleme eğrisinin bağlamı olarak kullanılır. Tek bir
  // gerçek giriş karesi (loop edilen statik görsel) beslendiğinde zoompan bu
  // kareyi SÜRESİZ olarak "fps" hızında yeniden üretmeye devam eder (gerçek
  // bir ffmpeg ile doğrulandı: d=45 verilmesine rağmen 15 saniyede 1000+ kare
  // üretip durmadı). Bu yüzden her klibi kendi "d" kare sayısında SERT olarak
  // kesen bir trim+setpts eklenmesi ZORUNLU; aksi hâlde render hiç bitmez
  // (xfade de asla gelmeyecek bir "ikinci klip başlangıcı" bekleyip kilitlenir).
  return {
    filter: `[${inputLabel}]zoompan=z='${zExpr}':x='${xExpr}':y='${yExpr}':d=${frameCount}:s=${internalWidth}x${internalHeight}:fps=${fps},scale=${width}:${height}:flags=fast_bilinear,setsar=1,trim=end_frame=${frameCount},setpts=PTS-STARTPTS[${outputLabel}]`,
    exactDurationSeconds: frameCount / fps
  };
}

// İki aşamalı render: her klibi AYRI render et (1 zoompan = düşük bellek),
// sonra önceden kodlanmış klipleri xfade ile birleştir. Tek bir devasa
// filter_complex'te 11 paralel zoompan çalıştırmak GitHub Actions runner'ın
// ~7.8G RAM'ini taşırıyor (ENOSPC olarak raporlanan bir bellek hatası).
export function buildTwoPassFfmpegArgs({
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
  clipDir,
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
  if (!clipDir) {
    throw new Error("clipDir gereklidir.");
  }
  if (!durationPerImageSeconds || durationPerImageSeconds <= 0) {
    throw new Error("durationPerImageSeconds pozitif olmalıdır.");
  }

  const transitionName = TRANSITION_MAP[transition] || TRANSITION_MAP.fade;
  const clips = [
    ...frames.map((frame) => ({ path: frame.path, requestedDuration: durationPerImageSeconds })),
    { path: closingFrame.path, requestedDuration: closingDurationSeconds }
  ];

  const clipRenders = clips.map((clip, index) => {
    const { filter, exactDurationSeconds } = zoompanFilter(
      "0:v", "vout",
      clip.requestedDuration, fps, width, height
    );
    const clipOutputPath = `${clipDir}/clip-${index}.mp4`;
    const args = [
      "-y",
      "-loop", "1",
      "-framerate", String(INPUT_LOOP_FRAMERATE),
      "-t", String(clip.requestedDuration),
      "-i", clip.path,
      "-filter_complex", filter,
      "-map", "[vout]",
      "-c:v", "libx264",
      "-pix_fmt", "yuv420p",
      "-r", String(fps),
      "-crf", "18",
      "-preset", "veryfast",
      "-an",
      clipOutputPath
    ];
    return { args, outputPath: clipOutputPath, exactDurationSeconds };
  });

  const concatArgs = ["-y"];
  for (const render of clipRenders) {
    concatArgs.push("-i", render.outputPath);
  }
  const hasMusic = Boolean(musicPath);
  if (hasMusic) {
    concatArgs.push("-stream_loop", "-1", "-i", musicPath);
  }

  const filterParts = [];
  let prevLabel = "0:v";
  let cumulativeDuration = clipRenders[0].exactDurationSeconds;

  for (let i = 1; i < clipRenders.length; i++) {
    const outLabel = i === clipRenders.length - 1 ? "vout" : `vx${i}`;
    const offset = cumulativeDuration - i * transitionDurationSeconds;
    filterParts.push(
      `[${prevLabel}][${i}:v]xfade=transition=${transitionName}:duration=${transitionDurationSeconds}:offset=${offset.toFixed(3)}[${outLabel}]`
    );
    cumulativeDuration += clipRenders[i].exactDurationSeconds;
    prevLabel = outLabel;
  }
  const totalDurationSeconds = cumulativeDuration - (clipRenders.length - 1) * transitionDurationSeconds;

  if (hasMusic) {
    const musicIndex = clipRenders.length;
    const fadeOutStart = Math.max(0, totalDurationSeconds - 1);
    const fadeOutDuration = Math.min(1, totalDurationSeconds);
    filterParts.push(
      `[${musicIndex}:a]volume=${musicVolume},afade=t=out:st=${fadeOutStart.toFixed(3)}:d=${fadeOutDuration.toFixed(3)}[aout]`
    );
  }

  concatArgs.push("-filter_complex", filterParts.join(";"));
  concatArgs.push("-map", "[vout]");
  if (hasMusic) {
    concatArgs.push("-map", "[aout]");
  }
  concatArgs.push(
    "-c:v", "libx264",
    "-pix_fmt", "yuv420p",
    "-r", String(fps),
    "-crf", "21",
    "-preset", "veryfast",
    "-movflags", "+faststart"
  );
  if (hasMusic) {
    concatArgs.push("-c:a", "aac", "-b:a", "128k");
  } else {
    concatArgs.push("-an");
  }
  concatArgs.push("-shortest");
  concatArgs.push(outputPath);

  return { clipRenders, concatArgs, totalDurationSeconds };
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
