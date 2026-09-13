// Saf FFmpeg argüman üretici — src/lib/ffmpeg-command.js ile AYNI ilke:
// gerçek ffmpeg çalıştırmaz, yalnızca argv dizisini hesaplar; böylece ffmpeg
// binary'si olmayan ortamlarda (Vercel serverless, CI) da unit test
// edilebilir. Gerçek çalıştırma scripts/render-reel-audio.mjs içinde
// execFile ile yapılır.
//
// compose_reel_audio: video + [Türkçe seslendirme] + [Lyria müziği] ->
// tek bir final MP4. En az biri (voiceoverPath/musicPath) verilmelidir.
// Voice ana ses (0 dB); müzik varsayılan olarak ~-16 dB altına alınır ve
// voice çalarken sidechaincompress ile daha da kısılır ("ducking"). Video
// akışı hiç yeniden kodlanmaz (-c:v copy) — yalnızca ses işlenir.

const VOICE_GAIN_DB = 0; // sabit — spesifikasyonun kendi varsayımı
const MUSIC_BASELINE_DB = -16; // musicVolume=0.5 (varsayılan) iken hedeflenen seviye
const MUSIC_FADE_SECONDS = 0.6;
const LIMITER = "alimiter=limit=0.95";

function dbToLinear(db) {
  return 10 ** (db / 20);
}

// musicVolume 0-1 aralığında bir slider (compose_product_video'daki
// musicVolume ile aynı sözleşme) — 0.5 varsayılanı MUSIC_BASELINE_DB'yi
// (-16dB) DEĞİŞTİRMEDEN uygular; 0 tamamen susturur, 1 baseline'ı ikiye
// katlar (yaklaşık +6dB).
function musicGain(musicVolume) {
  const clamped = Math.max(0, Math.min(1, musicVolume));
  return dbToLinear(MUSIC_BASELINE_DB) * (clamped / 0.5);
}

export function buildReelAudioFfmpegArgs({
  videoPath,
  voiceoverPath,
  musicPath,
  musicVolume = 0.5,
  videoDurationSeconds,
  outputPath
}) {
  if (!videoPath) throw new Error("videoPath gereklidir.");
  if (!voiceoverPath && !musicPath) throw new Error("voiceoverPath veya musicPath'ten en az biri gereklidir.");
  if (!outputPath) throw new Error("outputPath gereklidir.");
  if (!Number.isFinite(videoDurationSeconds) || videoDurationSeconds <= 0) {
    throw new Error("videoDurationSeconds pozitif bir sayı olmalıdır (video ffprobe ile ölçülmeli).");
  }

  const args = ["-y", "-i", videoPath];
  const inputIndexes = { video: 0 };
  let nextIndex = 1;
  if (voiceoverPath) {
    args.push("-i", voiceoverPath);
    inputIndexes.voice = nextIndex++;
  }
  if (musicPath) {
    // Müzik videodan kısa kalırsa güvenli şekilde döngüye alınır, uzun
    // kalırsa -shortest ile kesilir — compose_product_video'daki otomatik
    // müzikle aynı yaklaşım (bkz. src/lib/ffmpeg-command.js).
    args.push("-stream_loop", "-1", "-t", String(videoDurationSeconds + 1), "-i", musicPath);
    inputIndexes.music = nextIndex++;
  }

  const filterParts = [];
  const gain = musicGain(musicVolume);
  const fadeOutStart = Math.max(0, videoDurationSeconds - MUSIC_FADE_SECONDS);

  if (voiceoverPath && musicPath) {
    // KRİTİK: ffmpeg'de bir filtre pad/link etiketi ([voice] gibi) yalnızca
    // TEK BİR filtreye girdi olarak kullanılabilir — aynı etiketi hem
    // sidechaincompress'e (kontrol sinyali) hem amix'e (asıl mix) doğrudan
    // vermek "Stream specifier 'voice' ... matches no streams" gibi
    // (gerçek sebebi hiç açıklamayan) bir ffmpeg hatasıyla sonuçlanıyor —
    // gerçek ffmpeg'e karşı smoke test'te (scripts/smoke-test-reel-audio.mjs)
    // yakalandı. Çözüm: voice sinyali asplit ile İKİ bağımsız kopyaya
    // ayrılıp her filtreye kendi kopyası veriliyor.
    filterParts.push(`[${inputIndexes.voice}:a]volume=${dbToLinear(VOICE_GAIN_DB)},asplit=2[voice1][voice2]`);
    filterParts.push(
      `[${inputIndexes.music}:a]volume=${gain},afade=t=in:st=0:d=${MUSIC_FADE_SECONDS},afade=t=out:st=${fadeOutStart.toFixed(3)}:d=${MUSIC_FADE_SECONDS}[musicvol]`
    );
    // sidechaincompress: voice konuştuğunda müzik otomatik kısılır ("ducking"),
    // voice susunca müzik kendi seviyesine geri döner.
    filterParts.push("[musicvol][voice1]sidechaincompress=threshold=0.05:ratio=8:attack=20:release=1000[ducked]");
    filterParts.push(`[voice2][ducked]amix=inputs=2:duration=first:dropout_transition=2,${LIMITER}[aout]`);
  } else if (voiceoverPath) {
    filterParts.push(`[${inputIndexes.voice}:a]volume=${dbToLinear(VOICE_GAIN_DB)},${LIMITER}[aout]`);
  } else {
    filterParts.push(
      `[${inputIndexes.music}:a]volume=${gain},afade=t=in:st=0:d=${MUSIC_FADE_SECONDS},afade=t=out:st=${fadeOutStart.toFixed(3)}:d=${MUSIC_FADE_SECONDS},${LIMITER}[aout]`
    );
  }

  args.push("-filter_complex", filterParts.join(";"));
  args.push("-map", `${inputIndexes.video}:v`);
  args.push("-map", "[aout]");
  // Video akışı hiç filtrelenmiyor — yeniden kodlamadan kopyalanır (spesifikasyon
  // isteği: "-c:v copy tercih et"). movflags +faststart, önceki render
  // adımlarıyla (bkz. ffmpeg-command.js) aynı sebeple: web'de hızlı başlatma.
  args.push("-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-shortest", outputPath);

  return { args, clipping: false };
}
