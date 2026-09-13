import test from "node:test";
import assert from "node:assert/strict";
import { createReelScriptHandler, resetReelScriptDiscoveryCache } from "../api/reel-script.js";
import { VEO_SILENT_CONSTRAINT } from "../src/lib/reel-script-schema.js";

function request(method, action, body, query = {}) {
  return { method, query: { action, ...query }, body: body === undefined ? undefined : JSON.stringify(body), headers: {} };
}

function response() {
  const result = { statusCode: null, payload: null };
  result.status = (statusCode) => { result.statusCode = statusCode; return result; };
  result.json = (payload) => { result.payload = payload; return result; };
  return result;
}

function context() {
  return {
    productId: "rec1",
    productName: "Code Advantage",
    canonicalUrl: "https://www.buzsu.com.tr/code-advantage/",
    productImageUrls: ["https://www.buzsu.com.tr/code.jpg"],
    verifiedFacts: [{ fact: "Beş aşamalı filtre sistemi.", sourceUrl: "https://www.buzsu.com.tr/code-advantage/" }],
    sourceUrls: ["https://www.buzsu.com.tr/code-advantage/"],
    prohibitedClaims: []
  };
}

function candidate() {
  return {
    scriptId: "script-1",
    product: { id: "forged", name: "Forged", url: "https://evil.example/" },
    provider: "openai",
    modelUsed: "gpt-test",
    modelTier: "balanced",
    objective: "sales",
    durationSeconds: 8,
    aspectRatio: "9:16",
    title: "Temiz su",
    concept: "Ürün demosu",
    hook: "Suyunu tanı",
    creativeDirection: "Premium",
    scenes: [{
      sceneId: "scene-1", startSeconds: 0, endSeconds: 8, purpose: "Tanıtım",
      visualDescription: "Ürün mutfakta", action: "Kamera yaklaşır", camera: "Slow push",
      productVisibility: "hero", referenceImageRequired: false, veoPrompt: "Product in kitchen",
      narrationText: "Temiz su evinizde.", onScreenText: "Buzsu", transition: "cut"
    }],
    fullNarrationText: "Temiz su evinizde.",
    musicBrief: { mood: "modern", energy: "medium", tempo: "medium", instruments: [], lyriaPrompt: "Modern instrumental" },
    claimsUsed: [], negativeConstraints: [], warnings: []
  };
}

test("reel-script handler: yetkisiz istek 401 döner", async () => {
  const handler = createReelScriptHandler({ getSessionImpl: () => null });
  const res = response();
  await handler(request("GET", "options"), res);
  assert.equal(res.statusCode, 401);
});

test("options: sabit seçenekleri server'dan ve yalnız güvenli model metadata'sını döndürür; discovery 10 dk cache'lenir", async () => {
  resetReelScriptDiscoveryCache();
  let calls = 0;
  let time = 1000;
  const handler = createReelScriptHandler({
    getSessionImpl: () => ({ id: "u1" }), now: () => time,
    discoverCreativeModelsImpl: async () => {
      calls++;
      return {
        openai: { available: true, secretReason: "hide", models: [{ provider: "openai", model: "gpt-test", displayName: "GPT Test", capabilities: ["text"], available: true, tierCandidate: "balanced", envName: "HIDE_ME" }] },
        google: { available: false, reason: "missing_api_key", models: [] }
      };
    }
  });
  const first = response();
  await handler(request("GET", "options"), first);
  time += 9 * 60 * 1000;
  const second = response();
  await handler(request("GET", "options"), second);
  assert.equal(first.statusCode, 200);
  assert.deepEqual(first.payload.durations, [8, 15, 20, 30]);
  assert.deepEqual(first.payload.aspectRatios, ["9:16", "1:1", "16:9"]);
  assert.deepEqual(first.payload.objectives, ["sales", "awareness", "product_demo", "educational"]);
  assert.deepEqual(first.payload.tiers, ["economy", "balanced", "quality", "premium"]);
  assert.deepEqual(first.payload.providers, ["auto", "openai", "google"]);
  assert.deepEqual(Object.keys(first.payload.models[0]), ["provider", "model", "displayName", "capabilities", "available", "tierCandidate"]);
  assert.equal(JSON.stringify(first.payload).includes("HIDE_ME"), false);
  assert.equal(calls, 1);
});

test("product-context: ürün referansını mevcut Product Intelligence'a aktarır", async () => {
  let received;
  const handler = createReelScriptHandler({ getSessionImpl: () => ({}), getProductContextImpl: async (ref) => { received = ref; return context(); } });
  const res = response();
  await handler(request("GET", "product-context", undefined, { productId: "rec1" }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(received, { productId: "rec1", productUrl: undefined });
  assert.equal(res.payload.productContext.productName, "Code Advantage");
});

test("generate: confirmed yalnız açıkça true ise aktarılır ve tüm seçimler mevcut generateReelScript'e forward edilir", async () => {
  let received;
  const handler = createReelScriptHandler({
    getSessionImpl: () => ({}), env: { SAFE: "yes" },
    generateReelScriptImpl: async (input, env) => { received = { input, env }; return candidate(); }
  });
  const res = response();
  await handler(request("POST", "generate", { productId: "rec1", provider: "openai", modelTier: "balanced", objective: "sales", durationSeconds: 8, aspectRatio: "9:16", userBrief: "Premium", confirmed: "true" }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(received.input.confirmed, false);
  assert.equal(received.input.provider, "openai");
  assert.equal(received.input.modelTier, "balanced");
  assert.equal(received.env.SAFE, "yes");
});

test("validate: client productContext'ini yok sayar, context'i server'da yeniden çözer ve mevcut validator'ı kullanır", async () => {
  let productRef;
  let validation;
  const normalized = { ...candidate(), scenes: [{ ...candidate().scenes[0], veoPrompt: `Product in kitchen ${VEO_SILENT_CONSTRAINT}` }] };
  const handler = createReelScriptHandler({
    getSessionImpl: () => ({}),
    getProductContextImpl: async (ref) => { productRef = ref; return context(); },
    validateReelScriptImpl: (value, options) => { validation = { value, options }; return normalized; }
  });
  const res = response();
  await handler(request("POST", "validate", { productId: "rec1", productContext: { productName: "Forged" }, reelScript: candidate() }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(productRef, { productId: "rec1", productUrl: undefined });
  assert.equal(validation.options.productContext.productName, "Code Advantage");
  assert.equal(res.payload.reelScript.product.name, "Code Advantage");
});

test("validate: geçersiz süre inference veya product fetch başlatmadan reddedilir", async () => {
  let productCalls = 0;
  const bad = { ...candidate(), durationSeconds: 9 };
  const handler = createReelScriptHandler({ getSessionImpl: () => ({}), getProductContextImpl: async () => { productCalls++; return context(); } });
  const res = response();
  await handler(request("POST", "validate", { productId: "rec1", reelScript: bad }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.payload.code, "INVALID_INPUT");
  assert.equal(productCalls, 0);
});

test("adapter bilinmeyen action ve methodları açıkça reddeder", async () => {
  const handler = createReelScriptHandler({ getSessionImpl: () => ({}) });
  const badAction = response();
  await handler(request("GET", "unknown"), badAction);
  assert.equal(badAction.statusCode, 400);
  const badMethod = response();
  await handler(request("DELETE", "options"), badMethod);
  assert.equal(badMethod.statusCode, 405);
});
