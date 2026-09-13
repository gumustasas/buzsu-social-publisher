import test from "node:test";
import assert from "node:assert/strict";
import { generateReelScript } from "../src/reel-script.js";
import { ReelScriptError } from "../src/lib/reel-script-schema.js";

const CANONICAL_URL = "https://www.buzsu.com.tr/code-su-aritma-cihazi/";

function baseInput(overrides = {}) {
  return {
    productUrl: CANONICAL_URL,
    userBrief: "Modern mutfakta geçen premium reklam.",
    durationSeconds: 8,
    objective: "sales",
    aspectRatio: "9:16",
    provider: "auto",
    modelTier: "balanced",
    model: null,
    confirmed: true,
    ...overrides
  };
}

function validReelScriptJson() {
  return JSON.stringify({
    title: "Başlık", concept: "Konsept", hook: "Hook", creativeDirection: "Not",
    scenes: [
      { sceneId: "scene-1", startSeconds: 0, endSeconds: 4, purpose: "hero", visualDescription: "v", action: "a", camera: "c", productVisibility: "hero", referenceImageRequired: true, veoPrompt: "A kitchen scene.", narrationText: "Code ile temiz su.", onScreenText: "", transition: "cut" },
      { sceneId: "scene-2", startSeconds: 4, endSeconds: 8, purpose: "cta", visualDescription: "v", action: "a", camera: "c", productVisibility: "visible", referenceImageRequired: false, veoPrompt: "A family scene.", narrationText: "Hemen deneyin.", onScreenText: "", transition: "fade" }
    ],
    fullNarrationText: "Code ile temiz su. Hemen deneyin.",
    musicBrief: { mood: "premium", energy: "orta", tempo: "orta", instruments: ["piano"], lyriaPrompt: "Premium soundtrack" },
    claimsUsed: [{ claim: "3 kademeli filtre sistemi", sourceUrl: "https://www.buzsu.com.tr/llms-full.txt" }],
    negativeConstraints: [], warnings: []
  });
}

function baseProductContextDeps() {
  return {
    listProductsImpl: async () => [{ id: "llms:code", title: "Code Su Arıtma Cihazı", url: CANONICAL_URL, imageUrl: "", imageUrls: [] }],
    fetchProductContextImpl: async () => "Code Su Arıtma Cihazı 3 kademeli filtre sistemi ile mutfağınıza kurulur.",
    fetchImpl: async () => { throw new Error("çağrılmamalıydı (grounding bulundu, destekleyici fetch gerekmez)"); },
    putImpl: async () => ({ url: "https://blob.example.com/x" }),
    listImpl: async () => ({ blobs: [] })
  };
}

function discoveryDepsWithOpenAiModel(model = "gpt-5.6") {
  return { fetchImpl: async (url) => (String(url).includes("api.openai.com") ? { ok: true, json: async () => ({ data: [{ id: model }] }) } : { ok: true, json: async () => ({ models: [] }) }) };
}

function discoveryDepsWithGoogleModel(model = "gemini-3.5-flash") {
  return {
    fetchImpl: async (url) => (String(url).includes("generativelanguage")
      ? { ok: true, json: async () => ({ models: [{ name: `models/${model}`, displayName: model, supportedGenerationMethods: ["generateContent"] }] }) }
      : { ok: true, json: async () => ({ data: [] }) })
  };
}

// --- confirmed:false ------------------------------------------------------

test("generateReelScript: confirmed:false ile HİÇ BİR provider'a/discovery'ye istek atmadan reddeder", async () => {
  let anyCall = false;
  const throwIfCalled = async () => { anyCall = true; throw new Error("çağrılmamalıydı"); };
  const deps = {
    productContextDeps: { listProductsImpl: throwIfCalled, fetchProductContextImpl: throwIfCalled, fetchImpl: throwIfCalled },
    discoveryDeps: { fetchImpl: throwIfCalled },
    generationDeps: { fetchImpl: throwIfCalled }
  };
  await assert.rejects(() => generateReelScript(baseInput({ confirmed: false }), { OPENAI_API_KEY: "k" }, deps), /confirmed:true/);
  assert.equal(anyCall, false);
});

// --- productId / productUrl -----------------------------------------------

test("generateReelScript: productUrl ile çalışır, OpenAI provider ile balanced tier'ı çözer", async () => {
  const env = { OPENAI_API_KEY: "okey", OPENAI_CREATIVE_BALANCED_MODEL: "gpt-5.6" };
  const generationCalls = [];
  const deps = {
    productContextDeps: baseProductContextDeps(),
    discoveryDeps: discoveryDepsWithOpenAiModel("gpt-5.6"),
    generationDeps: { fetchImpl: async (url) => { generationCalls.push(String(url)); return { ok: true, json: async () => ({ output_text: validReelScriptJson() }) }; } }
  };
  const result = await generateReelScript(baseInput({ productUrl: CANONICAL_URL, productId: undefined }), env, deps);
  assert.equal(result.provider, "openai");
  assert.equal(result.modelUsed, "gpt-5.6");
  assert.equal(result.modelTier, "balanced");
  assert.equal(result.product.name, "Code Su Arıtma Cihazı");
  assert.equal(result.product.url, CANONICAL_URL);
  assert.ok(result.scriptId);
  assert.equal(generationCalls.length, 1);
  assert.match(generationCalls[0], /api\.openai\.com/);
});

test("generateReelScript: productId ile çalışır (getBuzsuProductContext'e AYNEN forward edilir)", async () => {
  const env = { GEMINI_API_KEY: "gkey", GOOGLE_CREATIVE_BALANCED_MODEL: "gemini-3.5-flash" };
  const productContextDeps = baseProductContextDeps();
  let receivedProductId = null;
  productContextDeps.listProductsImpl = async () => { return [{ id: "rec1", title: "Code Su Arıtma Cihazı", url: CANONICAL_URL, imageUrl: "", imageUrls: [] }]; };
  const deps = {
    productContextDeps,
    discoveryDeps: discoveryDepsWithGoogleModel("gemini-3.5-flash"),
    generationDeps: { fetchImpl: async () => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: validReelScriptJson() }] } }] }) }) }
  };
  const result = await generateReelScript(baseInput({ productId: "rec1", productUrl: undefined, provider: "auto" }), env, deps);
  assert.equal(result.provider, "google");
  assert.equal(result.product.id, "rec1");
});

// --- missing product --------------------------------------------------

test("generateReelScript: ürün bulunamazsa getBuzsuProductContext'in hatası olduğu gibi yansır", async () => {
  const deps = { productContextDeps: { listProductsImpl: async () => [] } };
  await assert.rejects(() => generateReelScript(baseInput({ productId: "rec-yok", productUrl: undefined }), {}, deps), /Ürün bulunamadı/);
});

// --- invalid provider ----------------------------------------------------

test("generateReelScript: geçersiz provider hiçbir productContext/discovery çağrısı yapmadan reddedilir", async () => {
  let called = false;
  const deps = { productContextDeps: { listProductsImpl: async () => { called = true; return []; } } };
  await assert.rejects(() => generateReelScript(baseInput({ provider: "anthropic" }), {}, deps), (e) => e instanceof ReelScriptError && e.code === "INVALID_INPUT");
  assert.equal(called, false);
});

test("generateReelScript: model verilmişse provider 'auto' OLAMAZ", async () => {
  const deps = { productContextDeps: baseProductContextDeps(), discoveryDeps: discoveryDepsWithOpenAiModel("gpt-5.6") };
  await assert.rejects(
    () => generateReelScript(baseInput({ provider: "auto", model: "gpt-5.6" }), { OPENAI_API_KEY: "k" }, deps),
    (e) => e instanceof ReelScriptError && e.code === "INVALID_INPUT"
  );
});

// --- unavailable model ----------------------------------------------------

test("generateReelScript: modelTier için hiçbir sağlayıcı yapılandırılmamışsa MODEL_UNAVAILABLE ile reddeder (farklı tier'a düşülmez)", async () => {
  const deps = { productContextDeps: baseProductContextDeps(), discoveryDeps: { fetchImpl: async () => ({ ok: true, json: async () => ({ data: [], models: [] }) }) } };
  await assert.rejects(
    () => generateReelScript(baseInput({ provider: "auto", modelTier: "premium" }), {}, deps),
    (e) => e instanceof ReelScriptError && e.code === "MODEL_UNAVAILABLE" && e.details.reason === "no_available_provider_for_tier"
  );
});

test("generateReelScript: 'Özel' modda serbest yazılmış (discovery'de olmayan) bir model kabul edilmez", async () => {
  const deps = { productContextDeps: baseProductContextDeps(), discoveryDeps: discoveryDepsWithOpenAiModel("gpt-5.6") };
  await assert.rejects(
    () => generateReelScript(baseInput({ provider: "openai", model: "gpt-99-hayali" }), { OPENAI_API_KEY: "k" }, deps),
    (e) => e instanceof ReelScriptError && e.code === "MODEL_UNAVAILABLE" && e.details.reason === "model_not_selectable"
  );
});

test("generateReelScript: 'Özel' modda discovery'de GERÇEKTEN listelenmiş bir model kabul edilir", async () => {
  const deps = {
    productContextDeps: baseProductContextDeps(),
    discoveryDeps: discoveryDepsWithOpenAiModel("gpt-5.4-nano"),
    generationDeps: { fetchImpl: async () => ({ ok: true, json: async () => ({ output_text: validReelScriptJson() }) }) }
  };
  const result = await generateReelScript(baseInput({ provider: "openai", model: "gpt-5.4-nano", modelTier: undefined }), { OPENAI_API_KEY: "k" }, deps);
  assert.equal(result.modelUsed, "gpt-5.4-nano");
  assert.equal(result.modelTier, null); // Özel mod: tier kullanılmadı
});

// --- structured JSON / claims / scene validation (uçtan uca) ---------------

test("generateReelScript: doğrulanamayan bir claimsUsed kaydı TÜM üretimi reddeder (uçtan uca)", async () => {
  const badJson = JSON.stringify({
    title: "t", concept: "c", hook: "h",
    scenes: [{ sceneId: "s1", startSeconds: 0, endSeconds: 8, veoPrompt: "x", narrationText: "x" }],
    fullNarrationText: "Kısa metin.",
    musicBrief: {},
    claimsUsed: [{ claim: "TSE sertifikalıdır", sourceUrl: "https://www.buzsu.com.tr/llms-full.txt" }]
  });
  const deps = {
    productContextDeps: baseProductContextDeps(),
    discoveryDeps: discoveryDepsWithOpenAiModel("gpt-5.6"),
    generationDeps: { fetchImpl: async () => ({ ok: true, json: async () => ({ output_text: badJson }) }) }
  };
  await assert.rejects(
    () => generateReelScript(baseInput({ provider: "openai", modelTier: "balanced" }), { OPENAI_API_KEY: "k", OPENAI_CREATIVE_BALANCED_MODEL: "gpt-5.6" }, deps),
    (e) => e instanceof ReelScriptError && e.code === "UNVERIFIED_PRODUCT_CLAIM"
  );
});

test("generateReelScript: gerçek input userBrief desteğini server validator'a taşır", async () => {
  const generated = JSON.parse(validReelScriptJson());
  generated.claimsUsed = [{ claim: "Paslanmaz çelik gövde", provenance: "user_provided" }];
  generated.creativeDirection = "Paslanmaz çelik gövde yakın planda gösterilir.";
  const deps = {
    productContextDeps: baseProductContextDeps(),
    discoveryDeps: discoveryDepsWithOpenAiModel("gpt-5.6"),
    generationDeps: { fetchImpl: async () => ({ ok: true, json: async () => ({ output_text: JSON.stringify(generated) }) }) }
  };
  const result = await generateReelScript(
    baseInput({ provider: "openai", modelTier: "balanced", userBrief: "Paslanmaz çelik gövde" }),
    { OPENAI_API_KEY: "k", OPENAI_CREATIVE_BALANCED_MODEL: "gpt-5.6" },
    deps
  );
  assert.deepEqual(result.claimsUsed, [{ claim: "Paslanmaz çelik gövde", provenance: "user_provided" }]);
});

test("generateReelScript: provider'ın döndürdüğü geçersiz JSON açık bir hata olarak yansır", async () => {
  const deps = {
    productContextDeps: baseProductContextDeps(),
    discoveryDeps: discoveryDepsWithOpenAiModel("gpt-5.6"),
    generationDeps: { fetchImpl: async () => ({ ok: true, json: async () => ({ output_text: "bu json değil" }) }) }
  };
  await assert.rejects(
    () => generateReelScript(baseInput({ provider: "openai", modelTier: "balanced" }), { OPENAI_API_KEY: "k", OPENAI_CREATIVE_BALANCED_MODEL: "gpt-5.6" }, deps),
    /geçerli JSON değil/
  );
});

// --- provider failure / no auto fallback -----------------------------------

test("generateReelScript: OpenAI çağrısı başarısız olursa Google'a OTOMATİK geçilmez — hata olduğu gibi yansır", async () => {
  let googleCalled = false;
  const deps = {
    productContextDeps: baseProductContextDeps(),
    discoveryDeps: discoveryDepsWithOpenAiModel("gpt-5.6"),
    generationDeps: {
      fetchImpl: async (url) => {
        if (String(url).includes("generativelanguage")) { googleCalled = true; throw new Error("google çağrılmamalıydı"); }
        return { ok: false, status: 500, json: async () => ({ error: { message: "internal error" } }) };
      }
    }
  };
  await assert.rejects(
    () => generateReelScript(baseInput({ provider: "openai", modelTier: "balanced" }), { OPENAI_API_KEY: "k", OPENAI_CREATIVE_BALANCED_MODEL: "gpt-5.6" }, deps),
    /internal error/
  );
  assert.equal(googleCalled, false);
});

// --- Veo constraints / Product Identity Lock / Lyria brief (uçtan uca) ----

test("generateReelScript: sonuçtaki her sahnenin veoPrompt'u sessiz-video kısıtını, referans gereken sahne Product Identity Lock'u taşır", async () => {
  const deps = {
    productContextDeps: baseProductContextDeps(),
    discoveryDeps: discoveryDepsWithOpenAiModel("gpt-5.6"),
    generationDeps: { fetchImpl: async () => ({ ok: true, json: async () => ({ output_text: validReelScriptJson() }) }) }
  };
  const result = await generateReelScript(baseInput({ provider: "openai", modelTier: "balanced" }), { OPENAI_API_KEY: "k", OPENAI_CREATIVE_BALANCED_MODEL: "gpt-5.6" }, deps);
  assert.ok(result.scenes.every((scene) => /no spoken dialogue/i.test(scene.veoPrompt)));
  assert.ok(/preserve the exact physical product/i.test(result.scenes[0].veoPrompt));
  assert.match(result.musicBrief.lyriaPrompt, /instrumental/i);
});
