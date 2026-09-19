// compose_cinematic_reel'in ham MCP argümanlarını doğrulayıp normalize
// edilmiş bir job payload'una çevirir (bkz. src/video-compose.js'teki AYNI
// desen: validateComposeInput). Ağ/IO içermez — bağımsız test edilebilir.
// TASK-011: compose_product_video'dan TAMAMEN bağımsız bir şema/doğrulama —
// mevcut mediaItems/transition/closing sözleşmesi burada YOK, "no silent
// fallback" ilkesiyle her alan ya açıkça doğrulanır ya da net bir hata fırlatır.

export const MIN_SCENES = 2;
export const MAX_SCENES = 10;
export const MIN_SCENE_DURATION_SECONDS = 1.0;
export const MAX_SCENE_DURATION_SECONDS = 8.0;
export const MAX_TEXT_LENGTH = 80;

export const CAMERA_TYPES = new Set([
  "push-in", "pull-out", "pan-left", "pan-right", "tilt-up", "tilt-down", "static-premium"
]);
export const EASING_TYPES = new Set(["linear", "ease-in", "ease-out", "ease-in-out"]);
export const TRANSITION_TYPES = new Set(["crossfade", "motion-blur", "light-wipe", "whip", "match-cut"]);
export const ASPECT_RATIOS = new Set(["9:16", "1:1", "16:9"]);
export const VISUAL_PROFILES = new Set(["clean-tech", "premium-soft", "commercial", "natural"]);
export const VIGNETTE_MODES = new Set(["off", "subtle"]);
export const GRAIN_MODES = new Set(["off", "very-low", "low"]);
export const OUTPUT_FPS_VALUES = new Set([24, 25, 30, 60]);
export const OUTPUT_CODECS = new Set(["h264"]);
export const OUTPUT_QUALITIES = new Set(["standard", "high"]);

export const MIN_TRANSITION_DURATION_SECONDS = 0.15;
export const MAX_TRANSITION_DURATION_SECONDS = 1.5;
export const DEFAULT_TRANSITION_DURATION_SECONDS = 0.4;
export const DEFAULT_CAMERA_INTENSITY = 0.35;
export const MIN_CAMERA_INTENSITY = 0;
export const MAX_CAMERA_INTENSITY = 1;
export const MIN_DUCK_DB = 6;
export const MAX_DUCK_DB = 10;
export const DEFAULT_DUCK_DB = 8;

const ASPECT_RATIO_DEFAULT_DIMENSIONS = {
  "9:16": { width: 1080, height: 1920 },
  "1:1": { width: 1080, height: 1080 },
  "16:9": { width: 1920, height: 1080 }
};

function assertHttpsUrlSyntax(rawUrl, label) {
  let url;
  try {
    url = new URL(String(rawUrl || ""));
  } catch {
    throw new Error(`${label} geçerli bir URL değil.`);
  }
  if (url.protocol !== "https:") throw new Error(`${label} yalnızca HTTPS olabilir.`);
  return url.toString();
}

function normalizeText(value, label) {
  if (value === undefined || value === null) return undefined;
  const trimmed = String(value).trim();
  if (!trimmed) return undefined;
  if (trimmed.length > MAX_TEXT_LENGTH) {
    throw new Error(`${label} en fazla ${MAX_TEXT_LENGTH} karakter olabilir.`);
  }
  return trimmed;
}

function normalizeCamera(camera, label) {
  if (camera === undefined) {
    return { type: "static-premium", intensity: DEFAULT_CAMERA_INTENSITY, easing: "ease-in-out" };
  }
  if (!camera || typeof camera !== "object") throw new Error(`${label} geçersiz.`);
  const type = camera.type === undefined ? "static-premium" : String(camera.type);
  if (!CAMERA_TYPES.has(type)) {
    throw new Error(`${label}.type şunlardan biri olmalıdır: ${[...CAMERA_TYPES].join(", ")}.`);
  }
  const intensity = camera.intensity === undefined ? DEFAULT_CAMERA_INTENSITY : Number(camera.intensity);
  if (!Number.isFinite(intensity) || intensity < MIN_CAMERA_INTENSITY || intensity > MAX_CAMERA_INTENSITY) {
    throw new Error(`${label}.intensity ${MIN_CAMERA_INTENSITY}-${MAX_CAMERA_INTENSITY} aralığında olmalıdır.`);
  }
  const easing = camera.easing === undefined ? "ease-in-out" : String(camera.easing);
  if (!EASING_TYPES.has(easing)) {
    throw new Error(`${label}.easing şunlardan biri olmalıdır: ${[...EASING_TYPES].join(", ")}.`);
  }
  return { type, intensity, easing };
}

// transitionAnchor geçersiz/eksikse (manifest: "invalid anchor/crop must
// fall back safely to center") sessizce ortaya (0.5,0.5) düşer — bu tek
// istisnai "silent fallback" davranışı MANİFESTO tarafından AÇIKÇA istendi,
// diğer tüm alanlar fail-closed'dır.
function normalizeTransitionAnchor(anchor) {
  const center = { x: 0.5, y: 0.5 };
  if (!anchor || typeof anchor !== "object") return center;
  const x = Number(anchor.x);
  const y = Number(anchor.y);
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) return center;
  return { x, y };
}

function normalizeTransition(transition, label, sceneDurationSeconds) {
  if (transition === undefined) {
    return { type: "crossfade", durationSeconds: DEFAULT_TRANSITION_DURATION_SECONDS };
  }
  if (!transition || typeof transition !== "object") throw new Error(`${label} geçersiz.`);
  const type = transition.type === undefined ? "crossfade" : String(transition.type);
  if (!TRANSITION_TYPES.has(type)) {
    throw new Error(`${label}.type şunlardan biri olmalıdır: ${[...TRANSITION_TYPES].join(", ")}.`);
  }
  const durationSeconds = transition.durationSeconds === undefined
    ? DEFAULT_TRANSITION_DURATION_SECONDS
    : Number(transition.durationSeconds);
  if (!Number.isFinite(durationSeconds) || durationSeconds < MIN_TRANSITION_DURATION_SECONDS || durationSeconds > MAX_TRANSITION_DURATION_SECONDS) {
    throw new Error(`${label}.durationSeconds ${MIN_TRANSITION_DURATION_SECONDS}-${MAX_TRANSITION_DURATION_SECONDS} aralığında olmalıdır.`);
  }
  // Manifest: "transition duration must not exceed scene duration" — fail
  // closed, sessizce kırpılmaz.
  if (durationSeconds >= sceneDurationSeconds) {
    throw new Error(`${label}.durationSeconds (${durationSeconds}), sahne süresinden (${sceneDurationSeconds}) küçük olmalıdır.`);
  }
  return { type, durationSeconds };
}

function normalizeScene(sceneInput, index) {
  if (!sceneInput || typeof sceneInput !== "object") throw new Error(`scenes[${index}] geçersiz.`);
  const imageUrl = assertHttpsUrlSyntax(sceneInput.imageUrl, `scenes[${index}].imageUrl`);

  const durationSeconds = Number(sceneInput.durationSeconds);
  if (!Number.isFinite(durationSeconds) || durationSeconds < MIN_SCENE_DURATION_SECONDS || durationSeconds > MAX_SCENE_DURATION_SECONDS) {
    throw new Error(`scenes[${index}].durationSeconds ${MIN_SCENE_DURATION_SECONDS}-${MAX_SCENE_DURATION_SECONDS} aralığında olmalıdır.`);
  }

  const title = normalizeText(sceneInput.title, `scenes[${index}].title`);
  const subtitle = normalizeText(sceneInput.subtitle, `scenes[${index}].subtitle`);
  const camera = normalizeCamera(sceneInput.camera, `scenes[${index}].camera`);
  const depthEffect = sceneInput.depthEffect === true;
  const subjectLock = sceneInput.subjectLock !== false;
  const transition = normalizeTransition(sceneInput.transition, `scenes[${index}].transition`, durationSeconds);
  const transitionAnchor = normalizeTransitionAnchor(sceneInput.transitionAnchor);

  return { imageUrl, durationSeconds, title, subtitle, camera, depthEffect, subjectLock, transition, transitionAnchor };
}

function normalizeCinematicOptions(cinematic) {
  const input = cinematic && typeof cinematic === "object" ? cinematic : {};
  const vignette = input.vignette === undefined ? "off" : String(input.vignette);
  if (!VIGNETTE_MODES.has(vignette)) {
    throw new Error(`cinematic.vignette şunlardan biri olmalıdır: ${[...VIGNETTE_MODES].join(", ")}.`);
  }
  const grain = input.grain === undefined ? "off" : String(input.grain);
  if (!GRAIN_MODES.has(grain)) {
    throw new Error(`cinematic.grain şunlardan biri olmalıdır: ${[...GRAIN_MODES].join(", ")}.`);
  }
  return {
    depthParallax: input.depthParallax === true,
    contactShadow: input.contactShadow === true,
    lightSweep: input.lightSweep === true,
    motionBlur: input.motionBlur === true,
    depthOfField: input.depthOfField === true,
    vignette,
    grain
  };
}

function normalizeAudioOptions(audio) {
  const input = audio && typeof audio === "object" ? audio : {};
  const voiceoverUrl = input.voiceoverUrl !== undefined && input.voiceoverUrl !== null && String(input.voiceoverUrl).trim()
    ? assertHttpsUrlSyntax(input.voiceoverUrl, "audio.voiceoverUrl")
    : undefined;
  const musicUrl = input.musicUrl !== undefined && input.musicUrl !== null && String(input.musicUrl).trim()
    ? assertHttpsUrlSyntax(input.musicUrl, "audio.musicUrl")
    : undefined;
  const autoDuck = input.autoDuck === true;
  const soundDesign = input.soundDesign === true;
  const duckDb = input.duckDb === undefined ? DEFAULT_DUCK_DB : Number(input.duckDb);
  if (!Number.isFinite(duckDb) || duckDb < MIN_DUCK_DB || duckDb > MAX_DUCK_DB) {
    throw new Error(`audio.duckDb ${MIN_DUCK_DB}-${MAX_DUCK_DB} aralığında olmalıdır.`);
  }
  return { voiceoverUrl, musicUrl, autoDuck, soundDesign, duckDb };
}

function normalizeOutputOptions(output, aspectRatio) {
  const input = output && typeof output === "object" ? output : {};
  const defaults = ASPECT_RATIO_DEFAULT_DIMENSIONS[aspectRatio];
  const width = input.width === undefined ? defaults.width : Number(input.width);
  const height = input.height === undefined ? defaults.height : Number(input.height);
  if (!Number.isInteger(width) || width < 240 || width > 3840) {
    throw new Error("output.width geçerli bir tam sayı (240-3840) olmalıdır.");
  }
  if (!Number.isInteger(height) || height < 240 || height > 3840) {
    throw new Error("output.height geçerli bir tam sayı (240-3840) olmalıdır.");
  }
  const fps = input.fps === undefined ? 30 : Number(input.fps);
  if (!OUTPUT_FPS_VALUES.has(fps)) {
    throw new Error(`output.fps şunlardan biri olmalıdır: ${[...OUTPUT_FPS_VALUES].join(", ")}.`);
  }
  const codec = input.codec === undefined ? "h264" : String(input.codec);
  if (!OUTPUT_CODECS.has(codec)) {
    throw new Error(`output.codec şunlardan biri olmalıdır: ${[...OUTPUT_CODECS].join(", ")}.`);
  }
  const quality = input.quality === undefined ? "high" : String(input.quality);
  if (!OUTPUT_QUALITIES.has(quality)) {
    throw new Error(`output.quality şunlardan biri olmalıdır: ${[...OUTPUT_QUALITIES].join(", ")}.`);
  }
  return { width, height, fps, codec, quality };
}

export function validateComposeCinematicInput(args = {}) {
  const scenesInput = args.scenes;
  if (!Array.isArray(scenesInput) || scenesInput.length < MIN_SCENES || scenesInput.length > MAX_SCENES) {
    throw new Error(`scenes en az ${MIN_SCENES}, en fazla ${MAX_SCENES} öğe içermelidir.`);
  }
  const scenes = scenesInput.map((scene, index) => normalizeScene(scene, index));

  const aspectRatio = args.aspectRatio === undefined ? "9:16" : String(args.aspectRatio);
  if (!ASPECT_RATIOS.has(aspectRatio)) {
    throw new Error(`aspectRatio şunlardan biri olmalıdır: ${[...ASPECT_RATIOS].join(", ")}.`);
  }

  const visualProfile = args.visualProfile === undefined ? "clean-tech" : String(args.visualProfile);
  if (!VISUAL_PROFILES.has(visualProfile)) {
    throw new Error(`visualProfile şunlardan biri olmalıdır: ${[...VISUAL_PROFILES].join(", ")}.`);
  }

  const cinematic = normalizeCinematicOptions(args.cinematic);
  const audio = normalizeAudioOptions(args.audio);
  const output = normalizeOutputOptions(args.output, aspectRatio);

  return { scenes, aspectRatio, visualProfile, cinematic, audio, output };
}
