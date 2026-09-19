import path from "node:path";
import { buildSceneFilterGraph } from "./scene-render.js";
import { resolveXfadeNameForScene } from "./transitions.js";

// compose_product_video'nun render-product-video.mjs/ffmpeg-command.js'inde
// öğrenilen AYNI ders: tek bir devasa filter_complex'te çok sayıda zoompan
// (+ burada EK OLARAK renk/ışık/bulanıklık/tipografi filtreleri) paralel
// çalıştırmak GitHub Actions runner RAM'ini taşırır. Bu yüzden AYNI iki
// aşamalı mimari izlenir: (1) her sahne AYRI, kendi ffmpeg çağrısında klip
// olarak render edilir, (2) klipler ardışık ikili xfade ile birleştirilir.
//
// scenes[i].transition, o sahneden BİR SONRAKİ sahneye geçerken kullanılan
// geçişi tanımlar (son sahnenin transition'ı hiç kullanılmaz — birleştirme
// için "sonraki sahne" yoktur). transitionAnchor şu an yalnızca doğrulanıp
// merkeze düşürülür (bkz. schema.js) — kamera bitiş noktasını anchor'a göre
// kaydırma v1 kapsamı DIŞINDA bırakıldı (bkz. final_report known_limitations);
// bu YAPISAL bir no-op'tur, sessizce YANLIŞ bir şey yapmaz.

const INPUT_LOOP_FRAMERATE = 0.1;

function clipOutputPath(workDir, index) {
  return path.join(workDir, `cinematic-clip-${index}.mp4`);
}

function overlayInputPath(workDir, sceneIndex, role) {
  return path.join(workDir, `cinematic-scene-${sceneIndex}-overlay-${role}.png`);
}

// buildScenePlan: TEK bir sahne için ffmpeg argv'sini + yazılması gereken
// overlay PNG buffer'larını üretir. Gerçek dosya yazımı/ffmpeg çalıştırma
// YAPMAZ (bkz. src/lib/ffmpeg-command.js ile AYNI "saf argüman üretici"
// ilkesi) — sharp render'ları (renderTitleOverlayPng vb.) hesaplama
// içerir ama gerçek IO/ffmpeg süreci başlatmaz.
export async function buildScenePlan({ scene, sceneIndex, sourceImagePath, fps, width, height, visualProfile, cinematicOptions, workDir }) {
  const graph = await buildSceneFilterGraph(scene, { width, height, fps, visualProfile, cinematicOptions });

  const filesToWrite = graph.extraInputs.map((input, i) => ({
    path: overlayInputPath(workDir, sceneIndex, `${i}-${input.role}`),
    buffer: input.buffer
  }));

  const args = ["-y", "-loop", "1", "-framerate", String(INPUT_LOOP_FRAMERATE), "-t", String(scene.durationSeconds), "-i", sourceImagePath];
  for (const file of filesToWrite) {
    args.push("-loop", "1", "-i", file.path);
  }
  args.push(
    "-filter_complex", graph.filter,
    "-map", `[${graph.outputLabel}]`,
    "-c:v", "libx264",
    "-pix_fmt", "yuv420p",
    "-r", String(fps),
    "-crf", "18",
    "-preset", "veryfast",
    "-an",
    clipOutputPath(workDir, sceneIndex)
  );

  return {
    args,
    outputPath: clipOutputPath(workDir, sceneIndex),
    filesToWrite,
    exactDurationSeconds: graph.frameCount / fps,
    appliedEffects: graph.appliedEffects,
    fallbacks: graph.fallbacks,
    warnings: graph.warnings
  };
}

// buildMergePlan: sahne klipleri ZATEN render edilmiş varsayılarak (bkz.
// buildScenePlan.outputPath), ardışık ikili xfade birleştirme adımlarını
// üretir (compose_product_video'daki buildTwoPassFfmpegArgs'ın AYNI
// deseni — bkz. src/lib/ffmpeg-command.js).
export function buildMergePlan({ scenePlans, scenes, width, height, fps, workDir, finalOutputPath }) {
  if (scenePlans.length < 2) throw new Error("En az 2 sahne klibi gereklidir.");

  const mergeSteps = [];
  let prevPath = scenePlans[0].outputPath;
  let prevDuration = scenePlans[0].exactDurationSeconds;

  for (let i = 1; i < scenePlans.length; i++) {
    const isLast = i === scenePlans.length - 1;
    const mergeOutputPath = isLast ? finalOutputPath : path.join(workDir, `cinematic-merge-${i}.mp4`);
    // scenes[i-1].transition, (i-1) -> i sahnesine geçerken kullanılır.
    const transition = scenes[i - 1].transition;
    const xfadeName = resolveXfadeNameForScene(transition.type, i - 1);
    const transitionDuration = transition.durationSeconds;
    const offset = prevDuration - transitionDuration;
    if (offset < 0) {
      throw new Error(`scenes[${i - 1}].transition.durationSeconds (${transitionDuration}) önceki sahnenin gerçek süresinden (${prevDuration.toFixed(3)}) büyük olamaz.`);
    }

    const args = [
      "-y", "-i", prevPath, "-i", scenePlans[i].outputPath,
      "-filter_complex", `[0:v][1:v]xfade=transition=${xfadeName}:duration=${transitionDuration}:offset=${offset.toFixed(3)}[vout]`,
      "-map", "[vout]",
      "-c:v", "libx264",
      "-pix_fmt", "yuv420p",
      "-r", String(fps),
      "-crf", isLast ? "20" : "18",
      "-preset", "veryfast",
      "-movflags", "+faststart",
      "-an",
      mergeOutputPath
    ];

    const mergeDuration = prevDuration + scenePlans[i].exactDurationSeconds - transitionDuration;
    mergeSteps.push({ args, outputPath: mergeOutputPath, duration: mergeDuration, xfadeName });
    prevPath = mergeOutputPath;
    prevDuration = mergeDuration;
  }

  return { mergeSteps, totalDurationSeconds: prevDuration };
}
