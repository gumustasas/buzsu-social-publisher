import sharp from "sharp";

const CANVAS_SIZE = 1024;
const BACKGROUND_THRESHOLD = 235;
const DEFAULT_SCENE = "modern bir mutfak tezgahı, sabah gün ışığı, ahşap dolaplar, bardağa su dolduran bir el";

// Silindirik, boruya montajlı ürünlerde (örn. manyetik kireç önleyici) AI
// cihazı boru hattının yanına ayrı/bağlantısız bir obje gibi yerleştirme
// eğiliminde. Gerçek kurulumlarda cihaz borunun kendisinin bir parçasıdır:
// borunun iki ucu doğrudan cihazın giriş/çıkış ağızlarına bağlanır, aralarında
// boşluk veya ayrık duruş olmaz.
const INSTALLATION_INSTRUCTION = "Ürün sahnede gerçekten kurulu/kullanımda görünsün; ürün havada asılı veya bağlantısız durmamalı, sahnedeki ilgili yüzeyle (tezgah, duvar, boru vb.) fiziksel olarak temas etsin. Ürün bir boruya/tesisata montajlı, silindirik bir cihazsa (örn. manyetik kireç önleyici), cihazı borunun kendisinin bir parçası gibi göster: borunun iki ucu doğrudan cihazın giriş ve çıkış ağızlarına vidalı/rakorlu şekilde bağlansın. Ama ürün kutu/kasa şeklinde bir su arıtma cihazıysa (tezgah altı, kompakt), cihaza GÖRÜNÜR hortum, boru, tesisat bağlantısı veya rakor EKLEME — gerçek kurulumlarda tüm bağlantılar dolabın içinde gizlidir, görselde de öyle olmalı.";

const WATER_NEGATIVE = "Cihazın gövdesinden dışarı doğru akan/dökülen/fışkıran su gösterme — cihaz bir musluk veya çeşme DEĞİLDİR, su doğrudan cihazdan akmaz. Sahnede su gösterilecekse su yalnızca bir musluktan (cihazdan ayrı, tezgah üstünde duran bir musluk) veya bir bardaktan akıyor olsun.";

// AI, sahnedeki duvara/yüzeye gerçek olmayan, üzerinde uydurma marka adı
// veya yazı bulunan pleksi/metal tabela ya da pano ekleme eğiliminde
// (kullanıcı, gerçek üründe olmayan sahte bir "Buz-Su" tabelası bulunan bir
// çıktı bildirdi). Bu tür sahte tabelalar hem yanıltıcı hem de marka
// tutarsızlığı yaratıyor.
const SIGNAGE_NEGATIVE = "Sahnede duvara veya herhangi bir yüzeye gerçek olmayan, üzerinde yazı/marka adı bulunan pleksi, metal veya plastik bir tabela, pano ya da etiket EKLEME. Duvarlar ve çevre yüzeyler sade kalsın; var olmayan bir tabela veya yazı uydurma.";

// Maskesiz düzenleme yapan sağlayıcılarda (Gemini) AI, arka planı yeniden
// çizerken ürünün kalınlığını/çapını da hafifçe değiştirme eğiliminde
// olabiliyor — kullanıcı canlıda gerçek ürünle karşılaştırıp bunu bildirdi.
// Bu talimat özellikle boru/silindir çapı gibi oranların referans görselle
// birebir aynı kalmasını, tahminen "düzeltilmeye" çalışılmamasını ister.
const PROPORTION_INSTRUCTION = "Cihazın kalınlığını, çapını ve boyunu referans görseldeki orijinal orantılarıyla BİREBİR aynı tut — sahnede cihazı referans görseldekinden daha kalın, daha ince, daha uzun veya daha kısa gösterme. Cihazın boruya/tesisata göre kalınlık oranı (örn. boru çapına kıyasla cihazın gövde çapı) referans görseldeki gibi kalmalı; bu oranı tahmin ederek düzeltmeye çalışma.";

const FILTER_SET_ORIENTATION_INSTRUCTION = "Bu bir filtre + Ultramag manyetik kireç önleyici setiyse, referans görseldeki gerçek Ultramag cihazını yeniden çizme veya başka bir silindirle değiştirme. Ultramag, filtre gövdelerinin yanında ve ana su hattı üzerinde yatay olarak, filtre çıkışından ev/daire içi dağıtım yönüne doğru sıralı biçimde monte edilmiş olmalı; dikey asılı, aşağı sarkan veya filtrelerden kopuk bir parça yapma. Üç filtre gövdesi ve Ultramag aynı gerçek setin parçaları olarak tek bir sürekli boru hattında görünmeli."

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
    ? " Musluk maskelenerek kaldırıldı; cihazın hemen yanına veya üzerine bitişik yeni bir musluk ekleme, cihazın yanı boş/temiz görünsün. Sahne açıklaması ayrı bir yerde (örn. tezgah üstünde) bağımsız bir musluk tarif ediyorsa, o musluğu sahnenin tarif edilen yerine ekle."
    : "";
  return `Maskelenmemiş (opak) alandaki ürünü hiç değiştirme; ${preserved}. Yalnızca şeffaf/maskelenmiş arka plan alanını şu sahneyle doldur: ${scene}.${faucetInstruction} ${INSTALLATION_INSTRUCTION} ${WATER_NEGATIVE} ${SIGNAGE_NEGATIVE} ${PROPORTION_INSTRUCTION} Gerçekçi, reklam kalitesinde, yüksek çözünürlüklü bir fotoğraf üret. Ürünün üzerine yeni metin, logo veya filigran ekleme.`;
}

// Gemini'nin images/edits benzeri bir maske uç noktası yok; referans görsel +
// metin talimatıyla çalışıyor. Maskeleme olmadığı için "koru" talimatı prompt
// içinde daha güçlü vurgulanıyor (bkz. AI Studio'da elle doğrulanan sürüm).
export function geminiScenePrompt(sceneDescription, { removeFaucet = false, referenceCount = 1 } = {}) {
  const scene = String(sceneDescription || "").trim() || DEFAULT_SCENE;
  const preserved = removeFaucet
    ? "tasarımını, oranlarını, rengini, logosunu ve etiketini birebir koru — cihazın kendisinde hiçbir değişiklik yapma, yeniden tasarlama"
    : "tasarımını, oranlarını, rengini, krom musluğunu, logosunu ve tüm detaylarını birebir koru — cihazın kendisinde hiçbir değişiklik yapma, yeniden tasarlama";
  const faucetInstruction = removeFaucet
    ? " Musluğu cihazın gövdesinden kaldır; cihazın hemen yanına veya üzerine bitişik yeni bir musluk ekleme, cihazın yanı boş/temiz görünsün. Sahne açıklaması ayrı bir yerde (örn. tezgah üstünde) bağımsız bir musluk tarif ediyorsa, o musluğu sahnenin tarif edilen yerine ekle."
    : "";
  const galleryInstruction = referenceCount > 1
    ? `Aşağıdaki görseller aynı gerçek ürünün farklı açıları/ürün sayfası görselleridir; bunları bir ürün galerisi olarak değerlendir. Görsellerdeki parçaları birleştirip başka bir model icat etme; sette görülen tüm gerçek parçaları (filtre gövdeleri ve varsa Ultramag manyetik kireç önleyici) koru.`
    : "Referans görseldeki gerçek ürünü tek kaynak kabul et; benzer görünen başka bir cihazla değiştirme.";
  const setOrientation = /filtre|ultramag|manyetik kireç/i.test(scene) ? FILTER_SET_ORIENTATION_INSTRUCTION : "";
  return `${galleryInstruction} Bu görseldeki su arıtma cihazının ${preserved}. Sadece arka planı ve sahneyi değiştir: ${scene}.${faucetInstruction} ${INSTALLATION_INSTRUCTION} ${WATER_NEGATIVE} ${SIGNAGE_NEGATIVE} ${PROPORTION_INSTRUCTION} ${setOrientation} Fotoğraf gerçekçi, reklam/katalog kalitesinde, yüksek çözünürlüklü olsun. Ürünün üzerine hiçbir yeni metin, logo veya filigran ekleme; etiket üzerindeki mevcut metni bulanıklaştırma veya değiştirme, olduğu gibi koru.`;
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

async function callGeminiImageEdit({ basePng, referencePngs = [], prompt }, env) {
  if (!env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY Vercel Production ortamında tanımlı değil.");
  const model = env.GEMINI_SCENE_MODEL || "gemini-3.1-flash-lite-image";
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": env.GEMINI_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }, ...[basePng, ...referencePngs].map((buffer) => ({ inlineData: { mimeType: "image/png", data: buffer.toString("base64") } }))] }],
      generationConfig: { responseModalities: ["IMAGE"] }
    })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || `Gemini HTTP ${response.status}`);
  const parts = data.candidates?.[0]?.content?.parts || [];
  const imagePart = parts.find((part) => part.inlineData?.data);
  if (!imagePart) throw new Error("Gemini görsel yanıtı boş döndü.");
  return imagePart.inlineData.data;
}

// Görsel üretimi ve metin üretimi (başlık/sahne planı, bkz. src/ai-providers.js)
// farklı OpenAI hesaplarında olabilir — biri kredili/görsel için, diğeri
// zaten metin için kullanılıyor olabilir. OPENAI_IMAGE_API_KEY tanımlıysa
// sahne görseli onu kullanır; tanımlı değilse eskisi gibi OPENAI_API_KEY'e
// düşer (geriye dönük uyumlu).
function openaiImageApiKey(env) {
  return env.OPENAI_IMAGE_API_KEY || env.OPENAI_API_KEY;
}

async function callOpenAIImageEdit({ basePng, referencePngs = [], maskPng, prompt, apiKey, quality }, env) {
  if (!apiKey) throw new Error("OPENAI_API_KEY Vercel Production ortamında tanımlı değil.");
  const model = env.OPENAI_SCENE_MODEL || "gpt-image-2";
  const form = new FormData();
  form.append("model", model);
  form.append("prompt", prompt);
  form.append("size", `${CANVAS_SIZE}x${CANVAS_SIZE}`);
  if (quality) form.append("quality", quality);
  // OpenAI accepts one or more input images, but the multipart field must use
  // one consistent shape. Mixing `image` with `image[]` makes the request fail
  // with "image already has a different value". Always send the primary
  // product image and its gallery references as the array form.
  form.append("image[]", new Blob([basePng], { type: "image/png" }), "product.png");
  for (const [index, referencePng] of referencePngs.entries()) {
    form.append("image[]", new Blob([referencePng], { type: "image/png" }), `product-reference-${index + 1}.png`);
  }
  form.append("mask", new Blob([maskPng], { type: "image/png" }), "mask.png");

  const response = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || `OpenAI HTTP ${response.status}`);
  const item = (data.data || [])[0];
  if (!item?.b64_json) throw new Error("OpenAI görsel yanıtı boş döndü.");
  return item.b64_json;
}

export function availableSceneProviders(env = process.env) {
  return [
    env.GEMINI_API_KEY && "gemini",
    openaiImageApiKey(env) && "openai",
    openaiImageApiKey(env) && "openai-low",
    // "composite": ürünü gerçek fotoğraftan piksel birebir kesip AI sadece
    // arka planı üretiyor (bkz. src/scene-composite.js) — deneysel ikinci
    // yöntem, aynı GEMINI_API_KEY ile çalışır.
    env.GEMINI_API_KEY && "composite"
  ].filter(Boolean);
}

export async function generateSceneImage(product, sceneDescription, env = process.env, { removeFaucet = false, provider = "gemini" } = {}) {
  const imageUrls = [...new Set((Array.isArray(product?.imageUrls) ? product.imageUrls : [product?.imageUrl]).map((url) => String(url || "").trim()).filter((url) => /^https:\/\//i.test(url)))].slice(0, 4);
  const imageUrl = imageUrls[0] || "";
  if (!/^https:\/\//i.test(imageUrl)) throw new Error("Ürün görseli herkese açık HTTPS URL olmalı.");

  const sourceBuffers = await Promise.all(imageUrls.map(async (url) => {
    const upstream = await fetch(url);
    if (!upstream.ok) throw new Error("Kaynak ürün görseli alınamadı.");
    return Buffer.from(await upstream.arrayBuffer());
  }));
  const sourceBuffer = sourceBuffers[0];

  const { basePng, maskPng } = await buildMaskBuffer(sourceBuffer, { removeFaucet });
  const referencePngs = [];
  for (const referenceBuffer of sourceBuffers.slice(1)) {
    referencePngs.push(await sharp(referenceBuffer).resize(CANVAS_SIZE, CANVAS_SIZE, { fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 1 } }).removeAlpha().png().toBuffer());
  }

  let b64, model, prompt;
  if (provider === "gemini") {
    prompt = geminiScenePrompt(sceneDescription, { removeFaucet, referenceCount: imageUrls.length });
    model = env.GEMINI_SCENE_MODEL || "gemini-3.1-flash-lite-image";
    b64 = await callGeminiImageEdit({ basePng, referencePngs, prompt }, env);
  } else if (provider === "openai" || provider === "openai-low") {
    prompt = `${sceneEditPrompt(sceneDescription, { removeFaucet })} ${imageUrls.length > 1 ? "Ek referans görselleri aynı ürünün farklı açılarıdır; tüm gerçek parçaları koru ve yeni model icat etme." : ""}`;
    model = env.OPENAI_SCENE_MODEL || "gpt-image-2";
    const quality = provider === "openai-low" ? "low" : undefined;
    b64 = await callOpenAIImageEdit({ basePng, referencePngs, maskPng, prompt, apiKey: openaiImageApiKey(env), quality }, env);
  } else {
    throw new Error("Desteklenmeyen sahne üretim sağlayıcısı.");
  }

  return {
    dataUrl: `data:image/png;base64,${b64}`,
    prompt,
    provider,
    model,
    product: product.title || "",
    referenceImageCount: imageUrls.length,
    generatedAt: new Date().toISOString()
  };
}
