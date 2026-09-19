import sharp from "sharp";
import { buildCameraMotion } from "./camera.js";
import { buildColorGradeChain } from "./color-grade.js";
import { buildTitleAnimationFilter, renderTitleOverlayPng } from "./typography.js";
import { getDepth, describeDepthFallback } from "./depth.js";

// buildSceneFilterGraph: TEK bir sahne için normalize edilmiş bir kaynak
// görselden (loop edilen statik PNG) kamera hareketi + renk derecelendirme +
// [ışık geçişi] + [derinlik alanı yaklaşımı] + [hareket bulanıklığı] +
// [temas gölgesi] + [başlık/alt başlık] içeren TEK bir filter_complex parçası
// üretir. compose_product_video'nun buildTwoPassFfmpegArgs'ı ile AYNI
// mimari ilke: her sahne AYRI render edilir (tek zoompan/scene = düşük
// bellek) — bkz. ffmpeg-command.js'teki "11 paralel zoompan RAM'i taşırıyor"
// notu; TASK-011'in kat kat daha fazla filtre eklediği düşünülürse bu ilke
// BURADA DAHA DA kritik.
//
// Dönen filter, girişi `[0:v]` olarak varsayar (her sahne KENDİ ayrı ffmpeg
// çağrısında, TEK bir -loop 1 -i ile çalıştırılır — reel-scene-concat gibi
// çoklu-girdi karmaşasına gerek yok, extra overlay PNG'leri ayrı input
// index'leriyle eklenir).
export async function buildSceneFilterGraph(scene, {
  width,
  height,
  fps,
  visualProfile,
  cinematicOptions
}) {
  const appliedEffects = [];
  const fallbacks = [];
  const warnings = [];
  const extraInputs = []; // [{ path likely filled by caller; burada yalnızca buffer üretilir }]

  const camera = buildCameraMotion(scene.camera, { durationSeconds: scene.durationSeconds, fps, width, height });
  appliedEffects.push(camera.appliedEffect);

  if (scene.depthEffect) {
    const depth = await getDepth();
    if (depth) {
      appliedEffects.push("depth_parallax");
    } else {
      fallbacks.push("depth_parallax_unavailable");
      warnings.push(describeDepthFallback());
    }
  }

  const colorGrade = buildColorGradeChain(visualProfile, {
    vignette: cinematicOptions.vignette,
    grain: cinematicOptions.grain
  });
  appliedEffects.push(`color_grade_${visualProfile}`);
  if (cinematicOptions.vignette !== "off") appliedEffects.push("vignette");
  if (cinematicOptions.grain !== "off") appliedEffects.push(`grain_${cinematicOptions.grain}`);

  const filterChainParts = [`[0:v]${camera.filter},${colorGrade}[graded]`];
  let currentLabel = "graded";

  // depthOfField: v1 YAKLAŞIMI — gerçek uzamsal (arka plan bulanık/ürün
  // keskin) derinlik alanı, subject-lock.js'in AÇIKÇA belirttiği gibi bir
  // segmentasyon modeli GEREKTİRİR (bu v1'de mevcut değil). Bunun yerine
  // ZAMANSAL bir yaklaşım uygulanır: bulanıklık yalnızca geçişlere yakın
  // (manifest: "blur may rise briefly during transitions") kısa bir
  // pencerede, FFmpeg'in kendi "enable" zaman kapısıyla devreye girer —
  // clean-tech profili minimum yarıçap kullanır (manifest: "clean-tech
  // profile must use minimal blur").
  if (cinematicOptions.depthOfField) {
    const radius = visualProfile === "clean-tech" ? 3 : 5;
    const windowSeconds = Math.min(0.35, scene.durationSeconds * 0.15);
    const endStart = Math.max(0, scene.durationSeconds - windowSeconds);
    const enableExpr = `lt(t,${windowSeconds.toFixed(3)})+gt(t,${endStart.toFixed(3)})`;
    filterChainParts.push(`[${currentLabel}]boxblur=${radius}:1:enable='${enableExpr}'[dof]`);
    currentLabel = "dof";
    appliedEffects.push("depth_of_field_temporal_approx");
    warnings.push("depthOfField v1'de uzamsal değil, geçişlere yakın zamansal bir bulanıklık yaklaşımıdır (subject extraction mevcut değil).");
  }

  // motionBlur: kamera SABİT (static-premium) değilse ve intensity>0 ise
  // ardışık kareleri hafifçe harmanlayan tblend — hareket ne kadar güçlüyse
  // (intensity) blend opasitesi o kadar yüksek; sabit karelerde opasite 0'a
  // yakın olduğundan görünür bir etki bırakmaz (manifest: "static frames
  // nearly unblurred").
  if (cinematicOptions.motionBlur) {
    const intensity = scene.camera.type === "static-premium" ? 0 : scene.camera.intensity;
    const opacity = Math.min(0.6, Math.max(0, intensity * 0.6));
    if (opacity > 0.02) {
      filterChainParts.push(`[${currentLabel}]tblend=all_mode=average:all_opacity=${opacity.toFixed(3)}[blurred]`);
      currentLabel = "blurred";
      appliedEffects.push("motion_blur");
    } else {
      fallbacks.push("motion_blur_negligible_static_camera");
    }
  }

  let nextInputIndex = 1;
  let contactShadowInputIndex = null;
  let lightSweepInputIndex = null;

  if (cinematicOptions.contactShadow) {
    contactShadowInputIndex = nextInputIndex++;
    const shadowPng = await renderContactShadowPng({ width, height });
    extraInputs.push({ role: "contact_shadow", buffer: shadowPng, loop: true });
    filterChainParts.push(`[${currentLabel}][${contactShadowInputIndex}:v]overlay=x=0:y=0:shortest=1[shadowed]`);
    currentLabel = "shadowed";
    appliedEffects.push("contact_shadow");
  }

  if (cinematicOptions.lightSweep) {
    lightSweepInputIndex = nextInputIndex++;
    const sweepPng = await renderLightSweepPng({ width, height });
    extraInputs.push({ role: "light_sweep", buffer: sweepPng, loop: true });
    const sweepWidth = Math.round(width * 0.6);
    const startX = -sweepWidth;
    const endX = width;
    const xExpr = `${startX}+(${endX}-${startX})*min(1,t/${scene.durationSeconds.toFixed(3)})`;
    filterChainParts.push(`[${currentLabel}][${lightSweepInputIndex}:v]overlay=x='${xExpr}':y=0:shortest=1[swept]`);
    currentLabel = "swept";
    appliedEffects.push("light_sweep");
  }

  let titleInputIndex = null;
  if (scene.title) {
    titleInputIndex = nextInputIndex++;
    const { buffer: titlePng } = await renderTitleOverlayPng({
      title: scene.title,
      subtitle: scene.subtitle,
      width,
      height
    });
    extraInputs.push({ role: "title", buffer: titlePng, loop: true });
    const animation = buildTitleAnimationFilter({
      textInputLabel: `${titleInputIndex}:v`,
      sceneInputLabel: currentLabel,
      outputLabel: "titled"
    });
    filterChainParts.push(animation);
    currentLabel = "titled";
    appliedEffects.push("kinetic_typography");
  }

  filterChainParts.push(`[${currentLabel}]null[sceneout]`);

  return {
    filter: filterChainParts.join(";"),
    outputLabel: "sceneout",
    extraInputs,
    frameCount: camera.frameCount,
    appliedEffects,
    fallbacks,
    warnings
  };
}

// Sahne içeriğinden BAĞIMSIZ, sabit boyutlu, yumuşak kenarlı elips —
// "hard CSS/drop-shadow" görünümünden kaçınmak için gaussian blur ile
// yumuşatılıyor (manifest şartı).
async function renderContactShadowPng({ width, height }) {
  const shadowWidth = Math.round(width * 0.55);
  const shadowHeight = Math.round(height * 0.035);
  const cx = width / 2;
  const cy = height * 0.94;
  const svg = Buffer.from(
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <ellipse cx="${cx}" cy="${cy}" rx="${shadowWidth / 2}" ry="${shadowHeight / 2}" fill="#000000" fill-opacity="0.28"/>
    </svg>`
  );
  return sharp(svg).blur(Math.max(2, Math.round(shadowHeight * 0.6))).png().toBuffer();
}

// Geniş, yumuşak, düşük opasiteli diyagonal bant — overlay'in kendi alpha
// kanalı üzerinden "screen benzeri" hafif bir ışık geçişi verir (ayrı bir
// blend-mode filtresine gerek kalmadan).
async function renderLightSweepPng({ width, height }) {
  const bandWidth = Math.round(width * 0.35);
  const svg = Buffer.from(
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="sweep" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stop-color="#ffffff" stop-opacity="0"/>
          <stop offset="0.5" stop-color="#ffffff" stop-opacity="0.16"/>
          <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <rect x="${(width - bandWidth) / 2}" y="0" width="${bandWidth}" height="${height}" fill="url(#sweep)" transform="skewX(-18)"/>
    </svg>`
  );
  return sharp(svg).png().toBuffer();
}
