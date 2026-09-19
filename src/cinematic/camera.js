// Deterministik kamera hareketi (zoompan tabanlı) — src/lib/ffmpeg-command.js'teki
// mevcut zoompanFilter'dan bağımsız (TASK-011 manifest gereği: compose_
// product_video'dan tamamen ayrı bir motor). Temel fark: mevcut kod zoom'u
// SABİT bir adımla (her karede +step) artırıyor — bu, manifest'in açıkça
// kaçınılması gereken "PowerPoint tarzı sabit hızlı zoom" örneğidir. Burada
// zoom/x/y, FFmpeg'in kendi zoompan "on" (o ana kadar üretilen çıktı kare
// sayısı) değişkeni üzerinden, seçilen easing eğrisinin SEMBOLİK matematiksel
// karşılığı olarak ifade edilir — yani easing.js'teki AYNI formüller, FFmpeg
// expression sözdiziminde tekrar yazılır (ffmpeg'in kendi eval motoru "on",
// "PI", "cos", "^" destekler). Girdi yalnızca doğrulanmış sayısal
// sabitlerdir (zoom/x/y sınırları, kare sayısı) — hiçbir kullanıcı metni bu
// ifadelere enjekte edilmez, filtergraph injection riski yoktur.

import { CAMERA_TYPES, EASING_TYPES } from "./schema.js";

// Manifest: "Push-in recommended zoom range min 1.0 max 1.10." — intensity
// bu üst sınırı SADECE azaltabilir, hiçbir preset onu aşıp kaynak görselin
// dışını (uninitialized border) göstermez.
export const MAX_ZOOM = 1.10;
export const MIN_ZOOM = 1.0;
// Pan/tilt sırasında kırpma penceresinin görsel dışına asla taşmaması için
// sabit tutulan zoom düzeyi — intensity ile MAX_ZOOM'a kadar ölçeklenir.
const PAN_TILT_BASE_ZOOM_RANGE = MAX_ZOOM - MIN_ZOOM;
// zoompan'ın kendi kısıtları (bkz. ffmpeg-command.js'teki AYNI not): tek bir
// döngülenen giriş karesi kullanıldığından "d" çıktıyı sınırlamaz — sert bir
// trim ZORUNLUDUR, aksi halde render hiç bitmez / xfade asla tetiklenmez.
const ZOOMPAN_INTERNAL_SCALE_DIVISOR = 2;

function easingExpr(easing, frameCountVar) {
  // Normalize edilmiş ilerleme t = on/frameCount, [0,1] aralığında —
  // easing.js'teki easeLinear/easeIn/easeOut/easeInOut ile MATEMATİKSEL
  // olarak birebir aynı formüller, yalnızca FFmpeg eval sözdiziminde.
  const t = `(on/${frameCountVar})`;
  switch (easing) {
    case "linear": return t;
    case "ease-in": return `(${t}^2)`;
    case "ease-out": return `(1-(1-${t})^2)`;
    case "ease-in-out": return `(0.5-0.5*cos(PI*${t}))`;
    default: throw new Error(`Bilinmeyen easing tipi: "${easing}".`);
  }
}

// intensity [0,1] -> gerçek zoom aralığı genişliği (asla MAX_ZOOM'u aşmaz).
function intensityZoomDelta(intensity) {
  return (MAX_ZOOM - MIN_ZOOM) * Math.max(0, Math.min(1, intensity));
}

function panTiltZoom(intensity) {
  // Pan/tilt'te zoom SABİT tutulur (animasyon x/y üzerindedir) — küçük bir
  // intensity'ye bağlı sabit zoom, kırpma penceresi için pay ("overscan")
  // sağlar; en az %2 zoom her zaman uygulanır ki x/y hareketi için görünür
  // bir kırpma alanı olsun (intensity=0 olsa bile hareketin kendisi hâlâ
  // anlamlı kalsın diye taban bir pay bırakılır).
  const minPan = MIN_ZOOM + PAN_TILT_BASE_ZOOM_RANGE * 0.3;
  return Math.min(MAX_ZOOM, minPan + intensityZoomDelta(intensity) * 0.5);
}

// buildCameraMotion: verilen kamera/tür/easing/intensity için zoompan'ın
// z/x/y ifadelerini ve uygulanan efekt adını üretir. Saf fonksiyon — ffmpeg
// çalıştırmaz, yalnızca filtergraph ifadesi üretir (unit test edilebilir).
export function buildCameraMotion({ type, intensity, easing }, { durationSeconds, fps, width, height }) {
  if (!CAMERA_TYPES.has(type)) throw new Error(`Bilinmeyen kamera tipi: "${type}".`);
  if (!EASING_TYPES.has(easing)) throw new Error(`Bilinmeyen easing tipi: "${easing}".`);
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) throw new Error("durationSeconds pozitif olmalıdır.");
  if (!Number.isFinite(fps) || fps <= 0) throw new Error("fps pozitif olmalıdır.");

  const frameCount = Math.max(1, Math.round(durationSeconds * fps));
  const internalWidth = Math.round(width / ZOOMPAN_INTERNAL_SCALE_DIVISOR);
  const internalHeight = Math.round(height / ZOOMPAN_INTERNAL_SCALE_DIVISOR);
  const progress = easingExpr(easing, frameCount);

  let zExpr;
  let xExpr;
  let yExpr;
  let appliedEffect;

  switch (type) {
    case "push-in": {
      const delta = intensityZoomDelta(intensity);
      zExpr = `(${MIN_ZOOM}+${delta.toFixed(6)}*${progress})`;
      xExpr = "iw/2-(iw/zoom/2)";
      yExpr = "ih/2-(ih/zoom/2)";
      appliedEffect = "camera_push_in";
      break;
    }
    case "pull-out": {
      const delta = intensityZoomDelta(intensity);
      zExpr = `(${(MIN_ZOOM + delta).toFixed(6)}-${delta.toFixed(6)}*${progress})`;
      xExpr = "iw/2-(iw/zoom/2)";
      yExpr = "ih/2-(ih/zoom/2)";
      appliedEffect = "camera_pull_out";
      break;
    }
    case "pan-left":
    case "pan-right": {
      const zoom = panTiltZoom(intensity);
      // Kırpma penceresi genişliği iw/zoom'dur; x, [0, iw-iw/zoom] aralığında
      // kalırsa pencere HİÇBİR ZAMAN görsel dışına taşmaz (matematiksel
      // garanti, algılama gerektirmez).
      const maxX = `(iw-iw/${zoom.toFixed(6)})`;
      const dir = type === "pan-left" ? `(1-${progress})` : progress;
      zExpr = zoom.toFixed(6);
      xExpr = `${maxX}*${dir}`;
      yExpr = "ih/2-(ih/zoom/2)";
      appliedEffect = type === "pan-left" ? "camera_pan_left" : "camera_pan_right";
      break;
    }
    case "tilt-up":
    case "tilt-down": {
      const zoom = panTiltZoom(intensity);
      const maxY = `(ih-ih/${zoom.toFixed(6)})`;
      const dir = type === "tilt-up" ? `(1-${progress})` : progress;
      zExpr = zoom.toFixed(6);
      xExpr = "iw/2-(iw/zoom/2)";
      yExpr = `${maxY}*${dir}`;
      appliedEffect = type === "tilt-up" ? "camera_tilt_up" : "camera_tilt_down";
      break;
    }
    case "static-premium": {
      // Gerçekten sabit bir çekim: hareket yok, bu yüzden "sabit hızlı zoom"
      // problemi zaten oluşmaz (hiç zoom animasyonu yok).
      zExpr = MIN_ZOOM.toFixed(6);
      xExpr = "iw/2-(iw/zoom/2)";
      yExpr = "ih/2-(ih/zoom/2)";
      appliedEffect = "camera_static_premium";
      break;
    }
    default:
      throw new Error(`Bilinmeyen kamera tipi: "${type}".`);
  }

  return {
    // internalWidth/Height'ta çalıştırılan zoompan, tam çözünürlüğe geri
    // "scale" ile büyütülür (bkz. ffmpeg-command.js'teki AYNI performans
    // gerekçesi: zoompan her çıktı karesini TAM piksel yeniden örnekler,
    // yarı çözünürlükte çalıştırmak render süresini ölçülebilir şekilde kısaltır).
    filter: `zoompan=z='${zExpr}':x='${xExpr}':y='${yExpr}':d=${frameCount}:s=${internalWidth}x${internalHeight}:fps=${fps},scale=${width}:${height}:flags=fast_bilinear,setsar=1,trim=end_frame=${frameCount},setpts=PTS-STARTPTS`,
    frameCount,
    appliedEffect
  };
}
