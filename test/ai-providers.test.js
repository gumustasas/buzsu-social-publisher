import test from "node:test";
import assert from "node:assert/strict";
import { availableProviders, generateScenePlan, generateCaption, generateMotionPlan, generateReelPackage } from "../src/ai-providers.js";

test("AI provider availability is derived from configured keys", () => {
  assert.deepEqual(availableProviders({ OPENAI_API_KEY: "x", ANTHROPIC_API_KEY: "", GEMINI_API_KEY: "y" }), ["openai", "gemini", "veo"]);
  assert.deepEqual(availableProviders({ FAL_KEY: "fal-test" }), ["fal"]);
});

test("AI provider availability lists 'openai' from a standalone OPENAI_IMAGE_API_KEY even without OPENAI_API_KEY", () => {
  assert.deepEqual(availableProviders({ OPENAI_IMAGE_API_KEY: "credited-key" }), ["openai"]);
});

test("generateScenePlan rejects an unsupported provider before making any network call", async () => {
  await assert.rejects(
    () => generateScenePlan("anthropic", { title: "Code Advantage" }, {}),
    /Desteklenmeyen AI sağlayıcısı/
  );
});

test("generateCaption rejects an unsupported provider before making any network call", async () => {
  await assert.rejects(
    () => generateCaption("fal", { title: "Code Advantage" }, {}),
    /Desteklenmeyen AI sağlayıcısı/
  );
});

// Sahne görseli için kredili OPENAI_IMAGE_API_KEY zaten çalışıyor (bkz.
// src/scene-image.js) — sahne planı metni de artık aynı kredili anahtarı,
// eski (kredisiz) OPENAI_API_KEY yerine kullanmalı; ayrıca düşük maliyetli
// gpt-5.4-nano modeline sabit olmalı.
test("generateScenePlan uses the working OPENAI_IMAGE_API_KEY (not the depleted OPENAI_API_KEY) and the cheap gpt-5.4-nano model for provider 'openai'", async () => {
  const originalFetch = global.fetch;
  let capturedAuth = null, capturedBody = null;
  global.fetch = async (url, options) => {
    capturedAuth = options.headers.Authorization;
    capturedBody = JSON.parse(options.body);
    return { ok: true, json: async () => ({ output_text: "test sahne planı" }) };
  };
  try {
    const plan = await generateScenePlan("openai", { title: "Code Advantage" }, { OPENAI_API_KEY: "depleted-key", OPENAI_IMAGE_API_KEY: "credited-key" });
    assert.equal(capturedAuth, "Bearer credited-key");
    assert.equal(capturedBody.model, "gpt-5.4-nano");
    assert.equal(plan, "test sahne planı");
  } finally {
    global.fetch = originalFetch;
  }
});

test("generateScenePlan falls back to OPENAI_API_KEY when no separate OPENAI_IMAGE_API_KEY is set", async () => {
  const originalFetch = global.fetch;
  let capturedAuth = null;
  global.fetch = async (url, options) => {
    capturedAuth = options.headers.Authorization;
    return { ok: true, json: async () => ({ output_text: "test sahne planı" }) };
  };
  try {
    await generateScenePlan("openai", { title: "Code Advantage" }, { OPENAI_API_KEY: "only-key" });
    assert.equal(capturedAuth, "Bearer only-key");
  } finally {
    global.fetch = originalFetch;
  }
});

// generateCaption/generateMotionPlan/generateReelPackage aynı desende
// (kredili anahtar tercih edilir, kredisiz OPENAI_API_KEY'e düşülür) —
// hepsinin gerçekten kredili anahtarı kullandığını doğrula.
test("generateCaption uses the working OPENAI_IMAGE_API_KEY over the depleted OPENAI_API_KEY for provider 'openai'", async () => {
  const originalFetch = global.fetch;
  let capturedAuth = null;
  global.fetch = async (url, options) => {
    capturedAuth = options.headers.Authorization;
    return { ok: true, json: async () => ({ output_text: '{"instagramText":"a","facebookText":"b","hashtags":"#Buzsu"}' }) };
  };
  try {
    await generateCaption("openai", { title: "Code Advantage" }, { OPENAI_API_KEY: "depleted-key", OPENAI_IMAGE_API_KEY: "credited-key" });
    assert.equal(capturedAuth, "Bearer credited-key");
  } finally {
    global.fetch = originalFetch;
  }
});

test("generateMotionPlan uses the working OPENAI_IMAGE_API_KEY over the depleted OPENAI_API_KEY for provider 'openai'", async () => {
  const originalFetch = global.fetch;
  let capturedAuth = null;
  global.fetch = async (url, options) => {
    capturedAuth = options.headers.Authorization;
    return { ok: true, json: async () => ({ output_text: "kamera yavaşça yaklaşır" }) };
  };
  try {
    await generateMotionPlan("openai", "mutfak", { OPENAI_API_KEY: "depleted-key", OPENAI_IMAGE_API_KEY: "credited-key" });
    assert.equal(capturedAuth, "Bearer credited-key");
  } finally {
    global.fetch = originalFetch;
  }
});

test("generateReelPackage uses the working OPENAI_IMAGE_API_KEY over the depleted OPENAI_API_KEY for provider 'openai'", async () => {
  const originalFetch = global.fetch;
  let capturedAuth = null;
  global.fetch = async (url, options) => {
    capturedAuth = options.headers.Authorization;
    return { ok: true, json: async () => ({ output_text: '{"hook":"h","voiceover":"v","scenes":[],"caption":"c","hashtags":["#Buzsu"],"cta":"cta"}' }) };
  };
  try {
    await generateReelPackage("openai", { title: "Code Advantage", url: "https://example.com", imageUrl: "https://example.com/x.jpg" }, { OPENAI_API_KEY: "depleted-key", OPENAI_IMAGE_API_KEY: "credited-key" });
    assert.equal(capturedAuth, "Bearer credited-key");
  } finally {
    global.fetch = originalFetch;
  }
});

// "openai-low" yalnızca sahne GÖRSELİ kalitesi içindir (bkz. src/scene-image.js)
// — panelin paylaşılan sağlayıcı dropdown'undan sahne planı/başlık METNİ
// fonksiyonlarına ulaştığında "Desteklenmeyen AI sağlayıcısı." ile
// reddedilmemeli, "openai" ile aynı şekilde çalışmalı (daha önce
// gemini-2.5-flash'ta yaşanan bug'ın aynısı burada tekrarlanmasın diye).
test("generateScenePlan treats provider 'openai-low' the same as 'openai' instead of rejecting it", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: true, json: async () => ({ output_text: "test sahne planı" }) });
  try {
    const plan = await generateScenePlan("openai-low", { title: "Code Advantage" }, { OPENAI_API_KEY: "key" });
    assert.equal(plan, "test sahne planı");
  } finally {
    global.fetch = originalFetch;
  }
});

// "composite" (bkz. src/scene-composite.js) yalnızca sahne GÖRSELİ üretim
// yöntemidir (Gemini tabanlı kırpma+arka plan) — metin fonksiyonlarına
// ulaştığında "gemini" ile aynı şekilde çalışmalı, reddedilmemeli.
test("generateScenePlan treats provider 'composite' the same as 'gemini' instead of rejecting it", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: "test sahne planı" }] } }] }) });
  try {
    const plan = await generateScenePlan("composite", { title: "Code Advantage" }, { GEMINI_API_KEY: "key" });
    assert.equal(plan, "test sahne planı");
  } finally {
    global.fetch = originalFetch;
  }
});

// NOT: fetchProductContext() modül seviyesinde 30 dakikalık bir önbellek
// tutuyor (bkz. src/lib/product-context.js) — bu dosyadaki testler arasında
// paylaşılır. Bu yüzden bu üç kategori/context testi, önbelleği İLK dolduran
// testin metni sonraki testleri etkilemesin diye kasıtlı olarak bu sırada ve
// birbirinden ayırt edilebilir başlıklarla yazıldı.

// Bir kullanıcı, "Su arıtma cihazları kategori paylaşımı" gibi TEK bir ürüne
// değil bir kategoriye ait bir kaydı seçtiğinde, AI'nin buzsu.com.tr'de
// eşleşen bir ürün sayfası bulamayınca (context boş) en yaygın senaryoya
// (tezgah altı cihaz + ayrı musluk + aile sahnesi) varsayılan olarak
// düştüğünü ve bunu tek bir gerçek ürünmüş gibi iddia ettiğini bildirdi. Bir
// sonraki raporda ise, llms-full.txt bu başlıkla zayıf/genel bir sayfayı
// (örn. kategori listeleme sayfası) eşleştirip context'i doldurunca da aynı
// hatalı iddianın geri döndüğü ortaya çıktı — bu yüzden kontrol artık yalnızca
// "context boş mu" değil, doğrudan başlığa bakıyor (context bulunsa bile).
test("generateScenePlan does not claim a specific under-counter device installation for a category-like title even when a weak/generic context IS matched", async () => {
  const originalFetch = global.fetch;
  let capturedBody = null;
  global.fetch = async (url, options) => {
    if (String(url).includes("llms-full.txt")) return { ok: true, text: async () => "Su Arıtma Cihazları Kategorisi - tüm su arıtma cihazlarımızı burada inceleyebilirsiniz." };
    capturedBody = JSON.parse(options.body);
    return { ok: true, json: async () => ({ output_text: "genel sahne" }) };
  };
  try {
    await generateScenePlan("openai", { title: "Su Arıtma Cihazları Kategorisi" }, { OPENAI_API_KEY: "key" });
    assert.match(capturedBody.input, /TEK bir cihazın kurulum detaylarını.*İDDİA ETME/s);
    assert.doesNotMatch(capturedBody.input, /tezgahı ALTINDAKİ dolabın içinde/);
  } finally {
    global.fetch = originalFetch;
  }
});

test("generateScenePlan does not claim a specific under-counter device installation for a category-like title with no matched product page", async () => {
  const originalFetch = global.fetch;
  let capturedBody = null;
  global.fetch = async (url, options) => {
    if (String(url).includes("llms-full.txt")) return { ok: true, text: async () => "bu metinde eşleşen bir ürün yok" };
    capturedBody = JSON.parse(options.body);
    return { ok: true, json: async () => ({ output_text: "genel sahne" }) };
  };
  try {
    await generateScenePlan("openai", { title: "Su arıtma cihazları kategori paylaşımı" }, { OPENAI_API_KEY: "key" });
    assert.match(capturedBody.input, /KATEGORİSİNE veya genel bir konuya/);
    assert.doesNotMatch(capturedBody.input, /tezgahı ALTINDAKİ dolabın içinde/);
  } finally {
    global.fetch = originalFetch;
  }
});

test("generateScenePlan still offers the under-counter device template for an ordinary product title without a category/collection marker", async () => {
  const originalFetch = global.fetch;
  let capturedBody = null;
  global.fetch = async (url, options) => {
    if (String(url).includes("llms-full.txt")) return { ok: true, text: async () => "eşleşme yok" };
    capturedBody = JSON.parse(options.body);
    return { ok: true, json: async () => ({ output_text: "cihaz sahnesi" }) };
  };
  try {
    await generateScenePlan("openai", { title: "Code Advantage" }, { OPENAI_API_KEY: "key" });
    assert.match(capturedBody.input, /tezgahı ALTINDAKİ dolabın içinde/);
  } finally {
    global.fetch = originalFetch;
  }
});

