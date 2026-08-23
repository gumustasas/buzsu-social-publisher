import sharp from "sharp";
import { floodFillBackgroundMask } from "./scene-image.js";

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

export function backgroundOnlyPrompt(sceneDescription) {
  const scene = String(sceneDescription || "").trim() || "modern bir mutfak tezgahı, sabah gün ışığı, ahşap dolaplar";
  return `${scene}. Bu sahnede HİÇBİR ürün, cihaz, obje veya insan olmasın — sahne tamamen boş, sadece ortam/arka plan görünsün; üzerine sonradan bir ürün fotoğrafı yapıştırılacak boş bir sahne fotoğrafı. Gerçekçi, reklam kalitesinde, yüksek çözünürlüklü, doğal ve yumuşak ışıklı bir fotoğraf olsun. Hiçbir metin, logo veya filigran ekleme.`;
}

async function normalizeToCanvas(sourceBuffer) {
  return sharp(sourceBuffer)
    .resize(CANVAS_SIZE, CANVAS_SIZE, { fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 1 } })
    .removeAlpha()
    .toColourspace("srgb");
}

// Ürünü referans fotoğraftan piksel birebir keser; arka plan (beyaza yakın,
// kenardan bağlantılı alan) şeffaf, ürünün kendisi opak kalır.
export async function buildProductCutout(sourceBuffer) {
  const normalized = await normalizeToCanvas(sourceBuffer);
  const { data, info } = await normalized.raw().toBuffer({ resolveWithObject: true });
  const isBackground = floodFillBackgroundMask(data, info);

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

export async function generateCompositeSceneImage(product, sceneDescription, env = process.env) {
  const imageUrl = String(product?.imageUrl || "").trim();
  if (!/^https:\/\//i.test(imageUrl)) throw new Error("Ürün görseli herkese açık HTTPS URL olmalı.");

  const upstream = await fetch(imageUrl);
  if (!upstream.ok) throw new Error("Kaynak ürün görseli alınamadı.");
  const sourceBuffer = Buffer.from(await upstream.arrayBuffer());

  const { cutoutPng, isBackground, info } = await buildProductCutout(sourceBuffer);
  const shadowPng = await buildShadowLayer(isBackground, info);

  const prompt = backgroundOnlyPrompt(sceneDescription);
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
