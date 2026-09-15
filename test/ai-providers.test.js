import test from "node:test";
import assert from "node:assert/strict";
import { availableProviders, generateScenePlan, generateCaption, generateMotionPlan, generateReelPackage, generateSeoArticle, generateHashtags, generateScenario } from "../src/ai-providers.js";
import { INSTALLATION_CONTEXTS } from "../src/lib/product-installation-context.js";

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

// usageContext verildiğinde: bağlam AI'nin kendi tahminine bırakılmaz,
// zorunlu bağlam cümlesi + bağlama özgü yasaklı öğe listesi prompt'a
// açıkça yazılır (bkz. src/lib/product-installation-context.js).
test("generateScenePlan with usageContext injects the mandatory context label and forbidden-element list into the prompt", async () => {
  const originalFetch = global.fetch;
  let capturedInput = null;
  global.fetch = async (url, options) => {
    capturedInput = JSON.parse(options.body).input;
    return { ok: true, json: async () => ({ output_text: "test sahne planı" }) };
  };
  try {
    await generateScenePlan("openai", { title: "UltraMag Manyetik Kireç Önleyici" }, { OPENAI_API_KEY: "k" }, { usageContext: INSTALLATION_CONTEXTS.TECHNICAL_INSTALLATION });
    assert.match(capturedInput, /ZORUNLU KULLANIM BAĞLAMI/);
    assert.match(capturedInput, /bina girişi|ana su hattı|teknik tesisat/i);
    assert.match(capturedInput, /çamaşır odası/i, "yasaklı öğe listesi prompt'ta görünmeli");
  } finally {
    global.fetch = originalFetch;
  }
});

// userNotes verildiğinde kullanıcının somut ayrıntıları ("çelişirse yok say"
// gibi belirsiz bir çekince olmadan) doğrudan prompt'a aktarılır.
test("generateScenePlan passes the user's scene notes through to the prompt without a silent-ignore hedge", async () => {
  const originalFetch = global.fetch;
  let capturedInput = null;
  global.fetch = async (url, options) => {
    capturedInput = JSON.parse(options.body).input;
    return { ok: true, json: async () => ({ output_text: "test sahne planı" }) };
  };
  try {
    await generateScenePlan("openai", { title: "Code Advantage" }, { OPENAI_API_KEY: "k" }, { userNotes: "3 filtre gövdesi solda, Ultramag sağda görünsün" });
    assert.match(capturedInput, /3 filtre gövdesi solda, Ultramag sağda görünsün/);
    assert.doesNotMatch(capturedInput, /YALNIZCA BİR SAHNE\/ATMOSFER TERCİHİ/i, "eski senaryo promptundaki 'çelişirse yok say' çekincesi burada tekrarlanmamalı");
  } finally {
    global.fetch = originalFetch;
  }
});

test("generateScenePlan rejects an AMBIGUOUS usageContext before making any network call", async () => {
  await assert.rejects(
    () => generateScenePlan("openai", { title: "Code Advantage" }, { OPENAI_API_KEY: "k" }, { usageContext: INSTALLATION_CONTEXTS.AMBIGUOUS }),
    /belirsiz bağlam netleştirilmelidir/
  );
});

test("generateScenePlan rejects an invalid usageContext value before making any network call", async () => {
  await assert.rejects(
    () => generateScenePlan("openai", { title: "Code Advantage" }, { OPENAI_API_KEY: "k" }, { usageContext: "not_a_real_context" }),
    /Geçersiz kullanım bağlamı/
  );
});

// Üretim SONRASI güvenlik ağı: AI, kullanıcının notunu (veya kendi
// tahminini) zorunlu bağlamla çelişecek bir öğe ÜRETEREK uygularsa, bu
// sessizce geçmez — validateScenarioAgainstContext'teki aynı prensip.
test("generateScenePlan throws when the AI output contains a term forbidden for the given usageContext", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: true, json: async () => ({ output_text: "Cihaz, evin içindeki çamaşır odasında sıcak bir atmosferde gösteriliyor." }) });
  try {
    await assert.rejects(
      () => generateScenePlan("openai", { title: "UltraMag Manyetik Kireç Önleyici" }, { OPENAI_API_KEY: "k" }, { usageContext: INSTALLATION_CONTEXTS.TECHNICAL_INSTALLATION }),
      /yasaklı bir öğe içeriyor.*çamaşır odası/i
    );
  } finally {
    global.fetch = originalFetch;
  }
});

// Geriye uyumluluk: usageContext/userNotes hiç verilmeden (eski 3 parametreli
// çağrı biçimi) yapılan bir çağrı, eski serbest-tahmin sahne rehberliğini
// aynen kullanmaya devam etmeli — yeni zorunlu bağlam bloğu eklenmemeli.
test("generateScenePlan without usageContext keeps the original free-guess scene guidance (backward compatible)", async () => {
  const originalFetch = global.fetch;
  let capturedInput = null;
  global.fetch = async (url, options) => {
    capturedInput = JSON.parse(options.body).input;
    return { ok: true, json: async () => ({ output_text: "test sahne planı" }) };
  };
  try {
    await generateScenePlan("openai", { title: "Code Advantage" }, { OPENAI_API_KEY: "k" });
    assert.doesNotMatch(capturedInput, /ZORUNLU KULLANIM BAĞLAMI/);
    assert.match(capturedInput, /BU ŞABLONU ZORLAMA/);
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

test("generateSeoArticle rejects an unsupported provider before making any network call", async () => {
  await assert.rejects(
    () => generateSeoArticle("anthropic", { title: "UltraMag" }, "manyetik kireç önleyici", {}),
    /Desteklenmeyen AI sağlayıcısı/
  );
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

test("generateScenePlan under-counter template explicitly forbids visible hoses and water flowing from the device", async () => {
  const originalFetch = global.fetch;
  let capturedBody = null;
  global.fetch = async (url, options) => {
    if (String(url).includes("llms-full.txt")) return { ok: true, text: async () => "eşleşme yok" };
    capturedBody = JSON.parse(options.body);
    return { ok: true, json: async () => ({ output_text: "cihaz sahnesi" }) };
  };
  try {
    await generateScenePlan("openai", { title: "Buzsu Slim Kasa" }, { OPENAI_API_KEY: "key" });
    assert.match(capturedBody.input, /GÖRÜNÜR hortum, boru veya tesisat bağlantısı yok/);
    assert.match(capturedBody.input, /cihaz bir çeşme veya musluk DEĞİLDİR/);
    assert.match(capturedBody.input, /su yalnızca BU musluktan akıyor/);
  } finally {
    global.fetch = originalFetch;
  }
});


// Kullanıcı, serbest metin yazarken hashtag'leri elle yazmak yerine markaya
// (Buzsu), seçilen ürüne/kategoriye ve yazılan metne göre otomatik üretilmesini
// istedi (bkz. dashboard.html "Serbest metin (yaz)" — hashtag alanı artık bir
// "Hashtag üret (AI)" butonuyla dolduruluyor).
test("generateHashtags rejects an unsupported provider before making any network call", async () => {
  await assert.rejects(
    () => generateHashtags("anthropic", { title: "Code Advantage" }, "merhaba", {}),
    /Desteklenmeyen AI sağlayıcısı/
  );
});

test("generateSeoArticle uses the working OPENAI_IMAGE_API_KEY over the depleted OPENAI_API_KEY and returns title+body", async () => {
  const originalFetch = global.fetch;
  let capturedAuth = null;
  global.fetch = async (url, options) => {
    capturedAuth = options.headers.Authorization;
    return { ok: true, json: async () => ({ output_text: '{"title":"Manyetik Kireç Önleyici Nedir?","metaDescription":"Kısa özet.","intro":"Manyetik kireç önleyici, su hattındaki kireci manyetik alanla azaltan bir cihazdır.","sections":[],"faq":[],"ctaSentence":"Detaylar için buzsu.com.tr."}' }) };
  };
  try {
    const article = await generateSeoArticle("openai", { title: "UltraMag" }, "manyetik kireç önleyici", { OPENAI_API_KEY: "depleted-key", OPENAI_IMAGE_API_KEY: "credited-key" });
    assert.equal(capturedAuth, "Bearer credited-key");
    assert.equal(article.title, "Manyetik Kireç Önleyici Nedir?");
    assert.equal(article.metaDescription, "Kısa özet.");
    assert.match(article.body, /manyetik alanla/);
    assert.deepEqual(article.warnings, []);
  } finally {
    global.fetch = originalFetch;
  }
});

test("generateSeoArticle throws when the AI response has no title or body", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: true, json: async () => ({ output_text: '{"title":"","metaDescription":"","intro":"","sections":[],"faq":[],"ctaSentence":""}' }) });
  try {
    await assert.rejects(
      () => generateSeoArticle("openai", { title: "UltraMag" }, "", { OPENAI_API_KEY: "key" }),
      /AI yazı içeriği boş döndü/
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test("generateSeoArticle treats provider 'openai-low'/'composite' the same as 'openai'/'gemini' instead of rejecting them", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: true, json: async () => ({ output_text: '{"title":"t","metaDescription":"m","intro":"b","sections":[],"faq":[],"ctaSentence":""}' }) });
  try {
    const article = await generateSeoArticle("openai-low", { title: "UltraMag" }, "", { OPENAI_API_KEY: "key" });
    assert.equal(article.title, "t");
  } finally {
    global.fetch = originalFetch;
  }
});

test("generateSeoArticle sends a strict OpenAI json_schema so the response shape can't drift, and flags risky claims the model still produced", async () => {
  const originalFetch = global.fetch;
  let capturedBody = null;
  global.fetch = async (url, options) => {
    capturedBody = JSON.parse(options.body);
    return { ok: true, json: async () => ({ output_text: '{"title":"En İyi Kireç Önleyici","metaDescription":"m","intro":"Bu cihaz garanti eder ki kireç %100 azalır.","sections":[],"faq":[],"ctaSentence":""}' }) };
  };
  try {
    const article = await generateSeoArticle("openai", { title: "UltraMag" }, "", { OPENAI_API_KEY: "key" });
    assert.equal(capturedBody.text.format.type, "json_schema");
    assert.equal(capturedBody.text.format.strict, true);
    assert.ok(article.warnings.length >= 2);
  } finally {
    global.fetch = originalFetch;
  }
});

test("generateSeoArticle includes the real product URL in the prompt so the CTA links to the actual page", async () => {
  const originalFetch = global.fetch;
  let capturedBody = null;
  global.fetch = async (url, options) => {
    capturedBody = JSON.parse(options.body);
    return { ok: true, json: async () => ({ output_text: '{"title":"t","metaDescription":"m","intro":"b","sections":[],"faq":[],"ctaSentence":""}' }) };
  };
  try {
    await generateSeoArticle("openai", { title: "UltraMag", url: "https://www.buzsu.com.tr/urunler/ultramag" }, "", { OPENAI_API_KEY: "key" });
    assert.match(capturedBody.input, /https:\/\/www\.buzsu\.com\.tr\/urunler\/ultramag/);
  } finally {
    global.fetch = originalFetch;
  }
});

test("generateHashtags requires non-empty text before making any network call", async () => {
  await assert.rejects(
    () => generateHashtags("openai", { title: "Code Advantage" }, "   ", { OPENAI_API_KEY: "key" }),
    /önce metin yazın/
  );
});

test("generateHashtags sends the product title and user-written text to the AI and returns the generated hashtags", async () => {
  const originalFetch = global.fetch;
  let capturedBody = null;
  global.fetch = async (url, options) => {
    if (String(url).includes("llms-full.txt")) return { ok: true, text: async () => "eşleşme yok" };
    capturedBody = JSON.parse(options.body);
    return { ok: true, json: async () => ({ output_text: '{"hashtags":"#Buzsu #Code #SuArıtma"}' }) };
  };
  try {
    const hashtags = await generateHashtags("openai", { title: "Code Advantage" }, "Mutfaklar için pratik bir çözüm.", { OPENAI_API_KEY: "key" });
    assert.match(capturedBody.input, /Code Advantage/);
    assert.match(capturedBody.input, /Mutfaklar için pratik bir çözüm\./);
    assert.equal(hashtags, "#Buzsu #Code #SuArıtma");
  } finally {
    global.fetch = originalFetch;
  }
});

// --- generateScenario: yapılandırılmış JSON senaryo akışı ---
const TECHNICAL_PRODUCT = { title: "Daire Girişi Manyetik Kireç Önleyici Set", url: "https://www.buzsu.com.tr/daire-girisi-celik-filtreli-manyetik-kirec-onleyicili-set/" };

function goodTechnicalScenarioJson() {
  return JSON.stringify({
    hook: "Kirece son!",
    sceneDescription: "Cihaz bina giriş noktasında, ana su hattına doğrudan monte edilmiş.",
    subjectAction: "",
    camera: "Yavaş yaklaşma",
    lighting: "Gündüz doğal ışık",
    onScreenText: "",
    captionSuggestion: "Suyunuzu koruyun.",
    installationNotes: "Borunun iki ucu doğrudan cihazın giriş/çıkış ağızlarına bağlı, bina giriş noktasında teknik alanda.",
    usageContext: INSTALLATION_CONTEXTS.TECHNICAL_INSTALLATION,
    negativeConstraints: [],
    aspectRatio: "9:16",
    durationSeconds: 20
  });
}

test("generateScenario rejects an unsupported provider before any network call", async () => {
  await assert.rejects(
    () => generateScenario("anthropic", TECHNICAL_PRODUCT, {}, { usageContext: INSTALLATION_CONTEXTS.TECHNICAL_INSTALLATION }),
    /Desteklenmeyen AI sağlayıcısı/
  );
});

test("generateScenario refuses to run without a pre-determined usageContext (no silent assumption)", async () => {
  await assert.rejects(
    () => generateScenario("openai", TECHNICAL_PRODUCT, { OPENAI_API_KEY: "key" }),
    /kullanım bağlamı/
  );
});

// Ürün girdisi: doğru bağlamla üretilen senaryo, mecburi yasak listesiyle
// birlikte doğrulanmış olarak dönüyor.
test("generateScenario (product input) returns a validated scenario carrying the mandatory forbidden list for its context", async () => {
  const originalFetch = global.fetch;
  global.fetch = async (url, options) => {
    if (String(url).includes("llms-full.txt")) return { ok: true, text: async () => "eşleşme yok" };
    return { ok: true, json: async () => ({ output_text: goodTechnicalScenarioJson() }) };
  };
  try {
    const scenario = await generateScenario("openai", TECHNICAL_PRODUCT, { OPENAI_API_KEY: "key" }, { usageContext: INSTALLATION_CONTEXTS.TECHNICAL_INSTALLATION });
    assert.equal(scenario.usageContext, INSTALLATION_CONTEXTS.TECHNICAL_INSTALLATION);
    assert.match(scenario.installationNotes, /bina giriş/);
    assert.ok(scenario.negativeConstraints.includes("çamaşır odası"));
  } finally {
    global.fetch = originalFetch;
  }
});

// Fotoğraf girdisi: senaryo üretimi metin tabanlıdır, ürünün imageUrl'inin
// kayıtlı bir fotoğraf mı yoksa dashboard'da az önce yüklenmiş (Blob) bir
// fotoğraf mı olduğu senaryo metnini/istemini ETKİLEMEMELİ — kaynak farkı
// yalnızca asıl görsel üretim adımında (src/scene-image.js, değişmedi) önem
// taşır.
test("generateScenario (photo input) produces the same prompt regardless of whether product.imageUrl is a catalog photo or a freshly uploaded one", async () => {
  const originalFetch = global.fetch;
  const capturedInputs = [];
  global.fetch = async (url, options) => {
    if (String(url).includes("llms-full.txt")) return { ok: true, text: async () => "eşleşme yok" };
    capturedInputs.push(JSON.parse(options.body).input);
    return { ok: true, json: async () => ({ output_text: goodTechnicalScenarioJson() }) };
  };
  try {
    await generateScenario("openai", { ...TECHNICAL_PRODUCT, imageUrl: "https://www.buzsu.com.tr/upload/small/katalog-foto.png" }, { OPENAI_API_KEY: "key" }, { usageContext: INSTALLATION_CONTEXTS.TECHNICAL_INSTALLATION });
    await generateScenario("openai", { ...TECHNICAL_PRODUCT, imageUrl: "https://blob.vercel-storage.com/manual-uploads/yeni-foto.png" }, { OPENAI_API_KEY: "key" }, { usageContext: INSTALLATION_CONTEXTS.TECHNICAL_INSTALLATION });
    assert.equal(capturedInputs[0], capturedInputs[1]);
  } finally {
    global.fetch = originalFetch;
  }
});

test("generateScenario throws a clear error when the provider returns invalid JSON", async () => {
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    if (String(url).includes("llms-full.txt")) return { ok: true, text: async () => "eşleşme yok" };
    return { ok: true, json: async () => ({ output_text: "bu bir JSON değil, sadece düz metin" }) };
  };
  try {
    await assert.rejects(
      () => generateScenario("openai", TECHNICAL_PRODUCT, { OPENAI_API_KEY: "key" }, { usageContext: INSTALLATION_CONTEXTS.TECHNICAL_INSTALLATION }),
      /geçerli JSON değil/
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test("generateScenario surfaces the AI provider's own HTTP error message", async () => {
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    if (String(url).includes("llms-full.txt")) return { ok: true, text: async () => "eşleşme yok" };
    return { ok: false, status: 429, json: async () => ({ error: { message: "insufficient_quota" } }) };
  };
  try {
    await assert.rejects(
      () => generateScenario("openai", TECHNICAL_PRODUCT, { OPENAI_API_KEY: "key" }, { usageContext: INSTALLATION_CONTEXTS.TECHNICAL_INSTALLATION }),
      /insufficient_quota/
    );
  } finally {
    global.fetch = originalFetch;
  }
});

// Yeniden üretim: "düzelt ve tekrar üret" akışı, önceki bağlam/yasak listesini
// KORUYARAK yalnızca düzeltme isteğini prompt'a ekler; iki çağrı birbirinden
// bağımsız (önbelleklenmiş/bayat sonuç dönmez).
test("generateScenario (regeneration) includes the fix note in the prompt and returns an independent, fresh result each call", async () => {
  const originalFetch = global.fetch;
  const capturedInputs = [];
  global.fetch = async (url, options) => {
    if (String(url).includes("llms-full.txt")) return { ok: true, text: async () => "eşleşme yok" };
    capturedInputs.push(JSON.parse(options.body).input);
    return { ok: true, json: async () => ({ output_text: goodTechnicalScenarioJson() }) };
  };
  try {
    const first = await generateScenario("openai", TECHNICAL_PRODUCT, { OPENAI_API_KEY: "key" }, { usageContext: INSTALLATION_CONTEXTS.TECHNICAL_INSTALLATION });
    const second = await generateScenario("openai", TECHNICAL_PRODUCT, { OPENAI_API_KEY: "key" }, { usageContext: INSTALLATION_CONTEXTS.TECHNICAL_INSTALLATION, fixNote: "Işık daha sıcak olsun" });
    assert.notEqual(capturedInputs[0], capturedInputs[1]);
    assert.match(capturedInputs[1], /Işık daha sıcak olsun/);
    assert.equal(first.generatedAt <= second.generatedAt, true);
  } finally {
    global.fetch = originalFetch;
  }
});

// --- REGRESYON: bildirilen gerçek hata ---
// Bina girişi/ana hat filtresi iç mekân "çamaşır odası" sahnesinde, yanlış
// boru bağlamıyla gösterilmişti. AI yanlışlıkla böyle bir senaryo üretse
// bile generateScenario görsele gitmeden bunu reddetmeli.
test("REGRESSION: generateScenario rejects an AI response that places a technical_installation product in an indoor laundry room", async () => {
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    if (String(url).includes("llms-full.txt")) return { ok: true, text: async () => "eşleşme yok" };
    return {
      ok: true,
      json: async () => ({
        output_text: JSON.stringify({
          hook: "Modern bir çözüm",
          sceneDescription: "Cihaz evin içindeki çamaşır odasında, dekoratif bir dolabın yanında duruyor.",
          subjectAction: "",
          camera: "Sabit",
          lighting: "Sıcak iç mekân ışığı",
          onScreenText: "",
          captionSuggestion: "İçiniz rahat olsun.",
          installationNotes: "Ev içinde çamaşır makinesinin yanına yerleştirildi.",
          usageContext: INSTALLATION_CONTEXTS.TECHNICAL_INSTALLATION,
          negativeConstraints: [],
          aspectRatio: "9:16",
          durationSeconds: 20
        })
      })
    };
  };
  try {
    await assert.rejects(
      () => generateScenario("openai", TECHNICAL_PRODUCT, { OPENAI_API_KEY: "key" }, { usageContext: INSTALLATION_CONTEXTS.TECHNICAL_INSTALLATION }),
      /çamaşır/
    );
  } finally {
    global.fetch = originalFetch;
  }
});
