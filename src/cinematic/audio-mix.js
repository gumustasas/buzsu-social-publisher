// Saf FFmpeg argüman üretici (src/lib/reel-audio-ffmpeg.js ile AYNI ilke:
// gerçek ffmpeg çalıştırmaz). TASK-011 kendi bağımsız ses mix fonksiyonuna
// sahiptir (reel-audio-ffmpeg.js'i DEĞİŞTİRMEZ/reuse etmez) çünkü manifest
// duckDb'yi 6-10dB aralığında YAPILANDIRILABİLİR ister (reel-audio-ffmpeg.js
// sabit bir sidechaincompress eşiği kullanır) ve çıktı örnekleme hızı
// açıkça 48kHz olmalıdır (reel-audio-ffmpeg.js 128k/192k bitrate'e odaklı,
// sample rate'i sabitlemez) — aynı FİKİR (asplit+sidechaincompress+amix+
// alimiter), farklı, TASK-011'e özgü parametrelerle yeniden yazıldı.

const VOICE_GAIN_DB = 0;
const MUSIC_BASELINE_DB = -16;
const FADE_SECONDS = 0.6;
const LIMITER = "alimiter=limit=0.95";
const OUTPUT_SAMPLE_RATE = 48000;

function dbToLinear(db) {
  return 10 ** (db / 20);
}

// duckDb (6-10 aralığı, schema.js zaten doğrulamış) sidechaincompress'in
// "ratio" parametresine deterministik olarak eşlenir: daha yüksek dB
// azaltma hedefi -> daha agresif (yüksek) ratio. threshold/attack/release
// sabit tutulur (manifest: "requires smooth attack/recovery, no clipping").
function duckDbToRatio(duckDb) {
  // 6dB -> ratio 4, 10dB -> ratio 12 (lineer interpolasyon, deterministik).
  return 4 + ((duckDb - 6) / (10 - 6)) * (12 - 4);
}

export function buildCinematicAudioMixArgs({
  videoPath,
  voiceoverPath,
  musicPath,
  duckDb = 8,
  autoDuck = true,
  videoDurationSeconds,
  outputPath
}) {
  if (!videoPath) throw new Error("videoPath gereklidir.");
  if (!outputPath) throw new Error("outputPath gereklidir.");
  if (!Number.isFinite(videoDurationSeconds) || videoDurationSeconds <= 0) {
    throw new Error("videoDurationSeconds pozitif bir sayı olmalıdır.");
  }
  if (!voiceoverPath && !musicPath) {
    throw new Error("voiceoverPath veya musicPath'ten en az biri gereklidir (audio hiç yoksa bu fonksiyon hiç çağrılmamalı).");
  }

  const args = ["-y", "-i", videoPath];
  const idx = { video: 0 };
  let next = 1;
  if (voiceoverPath) { args.push("-i", voiceoverPath); idx.voice = next++; }
  if (musicPath) {
    args.push("-stream_loop", "-1", "-t", String(videoDurationSeconds + 1), "-i", musicPath);
    idx.music = next++;
  }

  const filterParts = [];
  const gain = dbToLinear(MUSIC_BASELINE_DB);
  const fadeOutStart = Math.max(0, videoDurationSeconds - FADE_SECONDS);

  if (voiceoverPath && musicPath && autoDuck) {
    const ratio = duckDbToRatio(duckDb);
    filterParts.push(`[${idx.voice}:a]volume=${dbToLinear(VOICE_GAIN_DB)},asplit=2[voice1][voice2]`);
    filterParts.push(`[${idx.music}:a]volume=${gain},afade=t=in:st=0:d=${FADE_SECONDS},afade=t=out:st=${fadeOutStart.toFixed(3)}:d=${FADE_SECONDS}[musicvol]`);
    filterParts.push(`[musicvol][voice1]sidechaincompress=threshold=0.05:ratio=${ratio.toFixed(2)}:attack=20:release=1000[ducked]`);
    filterParts.push(`[voice2][ducked]amix=inputs=2:duration=first:dropout_transition=2,${LIMITER}[aout]`);
  } else if (voiceoverPath && musicPath) {
    // autoDuck=false: iki kanal doğrudan (ducking olmadan) miksleniyor.
    filterParts.push(`[${idx.voice}:a]volume=${dbToLinear(VOICE_GAIN_DB)}[voicevol]`);
    filterParts.push(`[${idx.music}:a]volume=${gain},afade=t=in:st=0:d=${FADE_SECONDS},afade=t=out:st=${fadeOutStart.toFixed(3)}:d=${FADE_SECONDS}[musicvol]`);
    filterParts.push(`[voicevol][musicvol]amix=inputs=2:duration=first:dropout_transition=2,${LIMITER}[aout]`);
  } else if (voiceoverPath) {
    filterParts.push(`[${idx.voice}:a]volume=${dbToLinear(VOICE_GAIN_DB)},${LIMITER}[aout]`);
  } else {
    filterParts.push(`[${idx.music}:a]volume=${gain},afade=t=in:st=0:d=${FADE_SECONDS},afade=t=out:st=${fadeOutStart.toFixed(3)}:d=${FADE_SECONDS},${LIMITER}[aout]`);
  }

  args.push("-filter_complex", filterParts.join(";"));
  args.push("-map", `${idx.video}:v`, "-map", "[aout]");
  args.push("-c:v", "copy", "-c:a", "aac", "-ar", String(OUTPUT_SAMPLE_RATE), "-b:a", "192k", "-movflags", "+faststart", "-shortest", outputPath);

  return { args };
}

// TASK-011 manifest: sound_design.paid_generation_allowed=false,
// fallback="if deterministic local SFX unavailable, skip without failing
// the render". Bu repoda BUGÜN hiçbir bundled SFX ses varlığı (assets/
// altında yalnızca logo/arka plan/ürün görselleri var, ses dosyası yok) ve
// birden fazla ayrı efekti (whoosh/impact/ping) sentetik lavfi
// kaynaklarından güvenilir/tutarlı biçimde üretmek bu v1'in kapsamı dışında
// bırakıldı — bu yüzden soundDesign HER ZAMAN bu deterministik fallback'e
// düşer (render'ı ASLA başarısız etmez, yalnızca uygulanmadığını raporlar).
export function resolveSoundDesignFallback(requested) {
  if (!requested) return { applied: false, fallback: null };
  return { applied: false, fallback: "sound_design_unavailable" };
}
