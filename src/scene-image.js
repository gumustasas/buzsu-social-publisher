import sharp from "sharp";

const CANVAS_SIZE = 1024;
const BACKGROUND_THRESHOLD = 235;
const DEFAULT_SCENE = "modern bir mutfak tezgahı, sabah gün ışığı, ahşap dolaplar, bardağa su dolduran bir el";

// assets/code-product.png üzerinde 1024x1024 normalize edilmiş kanvasta elle
// ölçülmüş musluk bölgesi (kavis, gövde, musluk kolu, ayak, uç). Musluğun üst
// kavisi ve vana kolu cihazın gövdesine değecek kadar yakın/temas halinde
// olduğundan, kutunun sol kenarı (x=660) cihazın gerçek kenarından (x<=776)
// birkaç piksel içeri taşıyor — yani gövdenin sağ kenarında dar bir şerit de
// AI tarafından yeniden üretilecek alana dahil oluyor. Bu, musluğu tamamen
// (kalıntısız) kaldırmak için kabul edilen bir yaklaşım; gerçek AI çıktısında
// bu şeridin sahneyle nasıl birleştiği kontrol edilmeli. Farklı bir referans
// görsel kullanılırsa bu kutu yeniden ölçülmeli.
const FAUCET_REMOVE_BOX = { left: 660, top: 450, width: 260, height: 460 };

function isBackgroundPixel(r, g, b) {
  return r >= BACKGROUND_THRESHOLD && g >= BACKGROUND_THRESHOLD && b >= BACKGROUND_THRESHOLD;
}

export function floodFillBackgroundMask(raw, info) {
  const { width, height, channels } = info;
  const visited = new Uint8Array(width * height);
  const isBackground = new Uint8Array(width * height);
  const stack = [];

  function visit(x, y) {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const idx = y * width + x;
    if (visited[idx]) return;
    visited[idx] = 1;
    const pixelIdx = idx * channels;
    if (!isBackgroundPixel(raw[pixelIdx], raw[pixelIdx + 1], raw[pixelIdx + 2])) return;
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

export function sceneEditPrompt(sceneDescription, { removeFaucet = false } = {}) {
  const scene = String(sceneDescription || "").trim() || DEFAULT_SCENE;
  const preserved = removeFaucet
    ? "şeklini, oranlarını, logosunu ve etiketini birebir aynı koru"
    : "şeklini, oranlarını, logosunu, etiketini, musluğunu ve tüm detaylarını birebir aynı koru";
  const faucetInstruction = removeFaucet
    ? " Musluk maskelenerek kaldırıldı; onun yerine veya sahnenin başka bir yerine yeni bir musluk/tap ekleme, cihazın yanı boş/temiz görünsün."
    : "";
  return `Maskelenmemiş (opak) alandaki ürünü hiç değiştirme; ${preserved}. Yalnızca şeffaf/maskelenmiş arka plan alanını şu sahneyle doldur: ${scene}.${faucetInstruction} Gerçekçi, reklam kalitesinde, yüksek çözünürlüklü bir fotoğraf üret. Ürünün üzerine yeni metin, logo veya filigran ekleme.`;
}

export function applyRemoveBox(isBackground, info, box) {
  const { width, height } = info;
  const left = Math.max(0, box.left);
  const top = Math.max(0, box.top);
  const right = Math.min(width, box.left + box.width);
  const bottom = Math.min(height, box.top + box.height);
  for (let y = top; y < bottom; y++) {
    for (let x = left; x < right; x++) {
      isBackground[y * width + x] = 1;
    }
  }
}

async function buildMaskBuffer(sourceBuffer, { removeFaucet = false } = {}) {
  const normalized = await sharp(sourceBuffer)
    .resize(CANVAS_SIZE, CANVAS_SIZE, { fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 1 } })
    .removeAlpha()
    .toColourspace("srgb");

  const basePng = await normalized.clone().png().toBuffer();
  const { data, info } = await normalized.raw().toBuffer({ resolveWithObject: true });
  const isBackground = floodFillBackgroundMask(data, info);
  if (removeFaucet) applyRemoveBox(isBackground, info, FAUCET_REMOVE_BOX);

  const maskRaw = Buffer.alloc(info.width * info.height * 4);
  for (let i = 0; i < info.width * info.height; i++) {
    const o = i * 4;
    maskRaw[o] = 255; maskRaw[o + 1] = 255; maskRaw[o + 2] = 255;
    maskRaw[o + 3] = isBackground[i] ? 0 : 255;
  }
  const maskPng = await sharp(maskRaw, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();

  return { basePng, maskPng };
}

async function callOpenAIImageEdit({ basePng, maskPng, prompt }, env) {
  if (!env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY Vercel Production ortamında tanımlı değil.");
  const model = env.OPENAI_SCENE_MODEL || "gpt-image-1";
  const form = new FormData();
  form.append("model", model);
  form.append("prompt", prompt);
  form.append("size", `${CANVAS_SIZE}x${CANVAS_SIZE}`);
  form.append("image", new Blob([basePng], { type: "image/png" }), "product.png");
  form.append("mask", new Blob([maskPng], { type: "image/png" }), "mask.png");

  const response = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` },
    body: form
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || `OpenAI HTTP ${response.status}`);
  const item = (data.data || [])[0];
  if (!item?.b64_json) throw new Error("OpenAI görsel yanıtı boş döndü.");
  return item.b64_json;
}

export async function generateSceneImage(product, sceneDescription, env = process.env, { removeFaucet = false } = {}) {
  const imageUrl = String(product?.imageUrl || "").trim();
  if (!/^https:\/\//i.test(imageUrl)) throw new Error("Ürün görseli herkese açık HTTPS URL olmalı.");

  const upstream = await fetch(imageUrl);
  if (!upstream.ok) throw new Error("Kaynak ürün görseli alınamadı.");
  const sourceBuffer = Buffer.from(await upstream.arrayBuffer());

  const { basePng, maskPng } = await buildMaskBuffer(sourceBuffer, { removeFaucet });
  const prompt = sceneEditPrompt(sceneDescription, { removeFaucet });
  const b64 = await callOpenAIImageEdit({ basePng, maskPng, prompt }, env);

  return {
    dataUrl: `data:image/png;base64,${b64}`,
    prompt,
    model: env.OPENAI_SCENE_MODEL || "gpt-image-1",
    product: product.title || "",
    generatedAt: new Date().toISOString()
  };
}
