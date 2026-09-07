import sharp from "sharp";
import { BACKGROUND_GUIDANCE_BY_CONTEXT, DEFAULT_ENVIRONMENT_BY_CONTEXT } from "./lib/product-installation-context.js";

// Deneysel ikinci yöntem: Gemini/OpenAI'nin referans görseli "koruyarak"
// düzenlemesine güvenmek yerine (bkz. scene-image.js — bazen ürünü hafifçe
// değiştirebiliyor), ürünü gerçek fotoğraftan PİKSEL BİREBİR kesip, AI
// yalnızca (ürünsüz) bir arka plan üretiyor, sonra ikisi birleştiriliyor.
// Riski farklı: ürün her zaman doğru kalır ama kesim kenarı/gölge/ışık
// uyumu kusurlu olabilir (özellikle parlak/kromlu yüzeylerde). Bu yüzden
// panelde ayrı, "deneysel" işaretli bir seçenek olarak sunuluyor —
// varsayılan yöntemin yerine geçmiyor.
const CANVAS_SIZE = 1024;
const SHADOW_OFFSET_Y = 18;
const SHADOW_BLUR = 20;
const SHADOW_OPACITY = 110;

// usageContext/negativeConstraints verilirse (bkz. api/scene-image.js —
// yapılandırılmış senaryo akışından geliyor), arka plan üretimi ürünün
// gerçek bağlamına göre yönlendirilir ve o bağlamda ürünün kendi
// bağlantılarıyla çakışacak sahte donanım/etiket üretmemesi için açıkça
// uyarılır (bkz. src/lib/product-installation-context.js
// BACKGROUND_GUIDANCE_BY_CONTEXT — gerçek hata: Silifozlu gibi bina girişi
// setlerinde arka plan kendi boru rakorunu/etiketini uydurup gerçek ürünle
// çakışıyordu).
//
// sceneDescription BOŞ bırakılmalı çağıran tarafından — bkz. api/scene-
// image.js: yapılandırılmış senaryo akışında AI'nın yazdığı sceneDescription
// ürünün KENDİSİNİ ayrıntılı anlatır (o metin normalde serbest-metin/AI-
// redraw akışı için yazılıyor), ve bunu burada temel cümle olarak kullanmak
// "hiç ürün çizme" talimatını geçersiz kılıp AI'nın kendi (yanlış markalı)
// ürününü çizmesine yol açan gerçek bir üretim hatasına neden oldu
// (Ultramag/Silifozlu). Boşsa DEFAULT_ENVIRONMENT_BY_CONTEXT'ten (tamamen
// deterministik, ürün açıklaması İÇERMEYEN) bir taban cümle kullanılır.
export function backgroundOnlyPrompt(sceneDescription, { usageContext, negativeConstraints = [] } = {}) {
  const fallback = (usageContext && DEFAULT_ENVIRONMENT_BY_CONTEXT[usageContext]) || "modern bir mutfak tezgahı, sabah gün ışığı, ahşap dolaplar";
  const scene = String(sceneDescription || "").trim() || fallback;
  const contextGuidance = usageContext && BACKGROUND_GUIDANCE_BY_CONTEXT[usageContext] ? ` ${BACKGROUND_GUIDANCE_BY_CONTEXT[usageContext]}` : "";
  const forbidden = negativeConstraints.length ? ` Ayrıca şunları KESİNLİKLE ÇİZME: ${negativeConstraints.join(", ")}.` : "";
  return `${scene}. Bu sahnede HİÇBİR ürün, cihaz, obje veya insan olmasın — sahne tamamen boş, sadece ortam/arka plan görünsün; üzerine sonradan bir ürün fotoğrafı yapıştırılacak boş bir sahne fotoğrafı.${contextGuidance}${forbidden} Gerçekçi, reklam kalitesinde, yüksek çözünürlüklü, doğal ve yumuşak ışıklı bir fotoğraf olsun. Hiçbir metin, logo veya filigran ekleme.`;
}

// Flood-fill arka plan maskesi, ürün alanını (%) makul bir aralıkta
// bulamazsa (ör. neredeyse tamamı arka plan = ürün tespit edilemedi; ya da
// neredeyse tamamı "ürün" = arka planla ayrım net değil, düz renkli/karmaşık
// fon) kesim GÜVENİLİR SAYILMAZ — sahte bir sonuç üretmek yerine burada
// durulur (bkz. gereksinim: "referans görseli veya güvenilir cutout'u olmayan
// üründe üretimi durdur").
const MIN_PRODUCT_PIXEL_RATIO = 0.015;
const MAX_PRODUCT_PIXEL_RATIO = 0.92;

export function assertReliableCutout(isBackground, info) {
  const total = info.width * info.height;
  let productPixels = 0;
  for (let i = 0; i < total; i++) if (!isBackground[i]) productPixels++;
  const ratio = productPixels / total;
  if (ratio < MIN_PRODUCT_PIXEL_RATIO) {
    throw new Error(`Ürün fotoğrafından güvenilir bir kesim (cutout) üretilemedi — ürün tespit edilemedi (algılanan ürün alanı: %${(ratio * 100).toFixed(1)}). Düz/tek renkli (tercihen beyaz) arka planlı, ürünün net göründüğü bir referans fotoğrafı yükleyin.`);
  }
  if (ratio > MAX_PRODUCT_PIXEL_RATIO) {
    throw new Error(`Ürün fotoğrafından güvenilir bir kesim (cutout) üretilemedi — arka plan ayırt edilemedi (algılanan ürün alanı: %${(ratio * 100).toFixed(1)}). Fotoğrafın kenarlarında düz/tek renkli bir arka plan boşluğu olmalı.`);
  }
  return ratio;
}

// buildProductCutout'un piksel-birebir kesim garantisi, arka planın DOĞRU
// tespit edilmesine bağlı. Daha önce burada scene-image.js'teki
// floodFillBackgroundMask (sabit, katı bir "neredeyse saf beyaz" eşiği,
// >=235/255) kullanılıyordu — bu eski maskeli-düzenleme akışı için
// yeterliydi (maske kusurlu olsa da AI referans görseli görüp telafi
// edebiliyor), ama composite'te maske TEK gerçek kaynak: hatalıysa cutout
// tamamen bozuluyor. Gerçek ürün testinde (Silifozlu, kayıtlı stüdyo
// fotoğrafı) doğrulandı: arka plan saf beyaz değil, hafif gri/off-white —
// sabit eşik kenarlardan hiç yayılamadı, kesim %98.7 "ürün" (yani
// tamamen başarısız) çıktı.
//
// İLK düzeltme (sabit ±26 tolerans) bunu çözdü ama TERSİNE bir regresyona
// yol açtı: gerçek üretimde (Ultramag/Silifozlu) kompozit, açık renkli/
// parlak ürün yüzeylerini de arka planla "yeterince yakın" sayıp şeffaf
// hale getirdi — sonuçta gerçek ürün pikselleri neredeyse hiç kalmadı ve
// kullanıcı, AI'nın kendi uydurduğu (yanlış markalı) bir görsel gördü. Bu,
// sessiz bir hata durumundan çok daha kötü: hata vermek yerine SAHTE bir
// "başarı" üretti.
//
// Doğru çözüm: toleransı sabit/geniş bir sayı yerine kenar piksellerinin
// KENDİ varyansından (medyan mutlak sapma, MAD) türetmek. Gerçek stüdyo
// fotoğraflarında arka plan neredeyse tekdüzedir (düşük varyans) — bu
// yüzden tolerans doğal olarak DAR kalır ve ürünün arka plana yakın ama
// belirgin şekilde farklı (kromlu/açık gri) yüzeylerini yutmaz. Arka
// planda gerçek bir gradyan/gölge varsa (daha yüksek varyans) tolerans
// biraz genişler ama MAX_TOLERANCE ile sınırlı kalır.
const TOLERANCE_MAD_MULTIPLIER = 4;
const MIN_TOLERANCE = 8;
const MAX_TOLERANCE = 18;

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function medianAbsoluteDeviation(values, med) {
  return median(values.map((v) => Math.abs(v - med)));
}

function channelTolerance(mad) {
  return Math.min(MAX_TOLERANCE, Math.max(MIN_TOLERANCE, mad * TOLERANCE_MAD_MULTIPLIER));
}

function sampleBorderColor(data, info) {
  const { width, height, channels } = info;
  const rs = [], gs = [], bs = [];
  function collect(x, y) {
    const idx = (y * width + x) * channels;
    rs.push(data[idx]); gs.push(data[idx + 1]); bs.push(data[idx + 2]);
  }
  for (let x = 0; x < width; x++) { collect(x, 0); collect(x, height - 1); }
  for (let y = 0; y < height; y++) { collect(0, y); collect(width - 1, y); }
  const ref = { r: median(rs), g: median(gs), b: median(bs) };
  const tolerance = {
    r: channelTolerance(medianAbsoluteDeviation(rs, ref.r)),
    g: channelTolerance(medianAbsoluteDeviation(gs, ref.g)),
    b: channelTolerance(medianAbsoluteDeviation(bs, ref.b))
  };
  return { ref, tolerance };
}

function isNearBackgroundColor(r, g, b, ref, tolerance) {
  return Math.abs(r - ref.r) <= tolerance.r
    && Math.abs(g - ref.g) <= tolerance.g
    && Math.abs(b - ref.b) <= tolerance.b;
}

export function adaptiveBackgroundMask(data, info) {
  const { width, height, channels } = info;
  const { ref, tolerance } = sampleBorderColor(data, info);
  const visited = new Uint8Array(width * height);
  const isBackground = new Uint8Array(width * height);
  const stack = [];

  function visit(x, y) {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const idx = y * width + x;
    if (visited[idx]) return;
    visited[idx] = 1;
    const pixelIdx = idx * channels;
    if (!isNearBackgroundColor(data[pixelIdx], data[pixelIdx + 1], data[pixelIdx + 2], ref, tolerance)) return;
    isBackground[idx] = 1;
    stack.push(x, y);
  }

  for (let x = 0; x < width; x++) { visit(x, 0); visit(x, height - 1); }
  for (let y = 0; y < height; y++) { visit(0, y); visit(width - 1, y); }

  while (stack.length) {
    const y = stack.pop();
    const x = stack.pop();
    visit(x + 1, y); visit(x - 1, y); visit(x, y + 1); visit(x, y - 1);
  }

  return isBackground;
}

async function normalizeToCanvas(sourceBuffer) {
  return sharp(sourceBuffer)
    .resize(CANVAS_SIZE, CANVAS_SIZE, { fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 1 } })
    .removeAlpha()
    .toColourspace("srgb");
}

// Ürünü referans fotoğraftan piksel birebir keser; arka plan (kenar
// rengine yakın, kenardan bağlantılı alan) şeffaf, ürünün kendisi opak
// kalır.
export async function buildProductCutout(sourceBuffer) {
  const normalized = await normalizeToCanvas(sourceBuffer);
  const { data, info } = await normalized.raw().toBuffer({ resolveWithObject: true });
  const isBackground = adaptiveBackgroundMask(data, info);

  const cutoutRaw = Buffer.alloc(info.width * info.height * 4);
  for (let i = 0; i < info.width * info.height; i++) {
    const src = i * info.channels;
    const dst = i * 4;
    cutoutRaw[dst] = data[src];
    cutoutRaw[dst + 1] = data[src + 1];
    cutoutRaw[dst + 2] = data[src + 2];
    cutoutRaw[dst + 3] = isBackground[i] ? 0 : 255;
  }
  const cutoutPng = await sharp(cutoutRaw, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
  return { cutoutPng, isBackground, info };
}

// Ürünün alt kısmının hemen altına, hafif aşağı kaydırılmış, bulanıklaştırılmış
// siyah bir siluet — sahneye "oturmuş" gibi görünmesi için basit bir sahte
// gölge. Gerçek ışık yönünü bilmediğimiz için düz/aşağı doğru varsayılıyor.
export async function buildShadowLayer(isBackground, info) {
  const { width, height } = info;
  const shadowRaw = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const sy = y - SHADOW_OFFSET_Y;
      const isProduct = sy >= 0 && sy < height && !isBackground[sy * width + x];
      const o = (y * width + x) * 4;
      shadowRaw[o + 3] = isProduct ? SHADOW_OPACITY : 0;
    }
  }
  return sharp(shadowRaw, { raw: { width, height, channels: 4 } }).blur(SHADOW_BLUR).png().toBuffer();
}

async function callGeminiBackgroundGenerate(prompt, env) {
  if (!env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY Vercel Production ortamında tanımlı değil.");
  const model = env.GEMINI_SCENE_MODEL || "gemini-3.1-flash-lite-image";
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": env.GEMINI_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ["IMAGE"] }
    })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || `Gemini HTTP ${response.status}`);
  const parts = data.candidates?.[0]?.content?.parts || [];
  const imagePart = parts.find((part) => part.inlineData?.data);
  if (!imagePart) throw new Error("Gemini arka plan yanıtı boş döndü.");
  return Buffer.from(imagePart.inlineData.data, "base64");
}

// usageContext/negativeConstraints: yapılandırılmış senaryodan geliyorsa
// (bkz. api/scene-image.js) arka plan bu bağlama göre yönlendirilir. Cutout
// güvenilirliği (assertReliableCutout) AI'ya HİÇ gidilmeden, ücretsiz ve
// deterministik olarak kontrol edilir — ürün sabit piksel/foreground olduğu
// için burada asıl "kalite kapısı" budur (marka/logo/form zaten mutasyona
// uğrayamaz, çünkü hiç yeniden çizilmiyor — bkz. buildProductCutout).
export async function generateCompositeSceneImage(product, sceneDescription, env = process.env, { usageContext, negativeConstraints = [] } = {}) {
  const imageUrl = String(product?.imageUrl || "").trim();
  if (!/^https:\/\//i.test(imageUrl)) throw new Error("Ürün görseli herkese açık HTTPS URL olmalı.");

  const upstream = await fetch(imageUrl);
  if (!upstream.ok) throw new Error("Kaynak ürün görseli alınamadı.");
  const sourceBuffer = Buffer.from(await upstream.arrayBuffer());

  const { cutoutPng, isBackground, info } = await buildProductCutout(sourceBuffer);
  assertReliableCutout(isBackground, info);
  const shadowPng = await buildShadowLayer(isBackground, info);

  const prompt = backgroundOnlyPrompt(sceneDescription, { usageContext, negativeConstraints });
  const backgroundPng = await callGeminiBackgroundGenerate(prompt, env);
  const model = env.GEMINI_SCENE_MODEL || "gemini-3.1-flash-lite-image";

  const composited = await sharp(backgroundPng)
    .resize(CANVAS_SIZE, CANVAS_SIZE, { fit: "cover" })
    .composite([{ input: shadowPng }, { input: cutoutPng }])
    .png()
    .toBuffer();

  return {
    dataUrl: `data:image/png;base64,${composited.toString("base64")}`,
    prompt,
    provider: "composite",
    model,
    product: product.title || "",
    generatedAt: new Date().toISOString()
  };
}
