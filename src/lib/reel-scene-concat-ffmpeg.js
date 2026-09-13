// Saf FFmpeg argüman üretici — src/lib/reel-audio-ffmpeg.js ile AYNI ilke:
// gerçek ffmpeg çalıştırmaz, yalnızca argv dizisini hesaplar (unit test
// edilebilir). Gerçek çalıştırma scripts/render-reel-final.mjs içinde yapılır.
//
// compose_reel_final (AI Reels V2 PR-F/G) — Step 5'in ürettiği sahne
// videolarını (generatedSceneVideos, reelScript.scenes SIRASINA göre)
// TEK bir sessiz videoya birleştirir. Ses mix'i (voiceover/music) BU
// AŞAMANIN İŞİ DEĞİLDİR — o adım, DEĞİŞTİRİLMEMİŞ buildReelAudioFfmpegArgs'a
// (src/lib/reel-audio-ffmpeg.js) bırakılır; bu dosya yalnızca "N sahne ->
// 1 sessiz video" adımını üretir.
//
// Her sahnenin KENDİ ses kanalı burada BİLEREK YOK SAYILIR (concat=...:a=0) —
// Veo sahneleri zaten deterministik olarak "sessiz" kısıtıyla üretiliyor
// (VEO_SILENT_CONSTRAINT, bkz. src/lib/reel-script-schema.js), bu yüzden
// her klipte gerçekten bir ses akışı olup olmadığını (Veo'nun mp4 çıktısı
// hiç audio track içermeyebilir) varsaymak GEREKMEZ — video-only concat bu
// riski tamamen ortadan kaldırır. Video akışı burada YENİDEN KODLANIR
// (concat filtresi kod çözülmüş kareler üzerinde çalışır, "-c:v copy" ile
// mümkün değildir) — reel-audio-ffmpeg.js'in "video re-encode YOK" ilkesi
// yalnızca SONRAKİ (ses mix) adım için geçerlidir, burada tek seferlik bir
// re-encode kaçınılmazdır.
export function buildSceneConcatFfmpegArgs({ scenePaths, outputPath }) {
  if (!Array.isArray(scenePaths) || scenePaths.length === 0) {
    throw new Error("scenePaths en az bir sahne video yolu içermelidir.");
  }
  if (!outputPath) throw new Error("outputPath gereklidir.");

  const args = ["-y"];
  scenePaths.forEach((path) => args.push("-i", path));

  if (scenePaths.length === 1) {
    // Tek sahne varsa concat filtresine hiç gerek yok — yeniden kodlama
    // olmadan (-c:v copy) doğrudan kopyalanır.
    args.push("-map", "0:v", "-c:v", "copy", "-an", outputPath);
    return { args, skippedConcat: true };
  }

  const filterInputs = scenePaths.map((_, index) => `[${index}:v]`).join("");
  const filter = `${filterInputs}concat=n=${scenePaths.length}:v=1:a=0[outv]`;
  args.push(
    "-filter_complex", filter,
    "-map", "[outv]",
    "-c:v", "libx264",
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    outputPath
  );
  return { args, skippedConcat: false };
}
