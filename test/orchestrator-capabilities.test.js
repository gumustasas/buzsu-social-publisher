import test from "node:test";
import assert from "node:assert/strict";
import { createCapabilityRegistry, ORCHESTRATOR_CAPABILITIES } from "../src/orchestrator/capabilities.js";

test("ORCHESTRATOR_CAPABILITIES yalnız TASK-001..006 GENERATE + genel READ tool'larını içerir — publish/delete/update/upload/autopilot AYRIK tutulur", () => {
  assert.deepEqual(ORCHESTRATOR_CAPABILITIES, [
    "list_products",
    "get_buzsu_product_context",
    "research_web",
    "transcribe_media",
    "generate_scene_image",
    "validate_product_visual",
    "generate_image_from_video",
    "search_product_knowledge"
  ]);
  const registry = createCapabilityRegistry({});
  for (const forbidden of ["publish_now", "create_draft", "update_draft", "update_status", "set_autopilot", "upload_media"]) {
    assert.equal(registry[forbidden], undefined);
  }
});

test("registry: her READ capability requiresConfirmation:false, her GENERATE capability requiresConfirmation:true'dur", () => {
  const registry = createCapabilityRegistry({});
  assert.equal(registry.list_products.requiresConfirmation, false);
  assert.equal(registry.get_buzsu_product_context.requiresConfirmation, false);
  for (const name of ["research_web", "transcribe_media", "generate_scene_image", "validate_product_visual", "generate_image_from_video", "search_product_knowledge"]) {
    assert.equal(registry[name].requiresConfirmation, true, `${name} requiresConfirmation:true olmalı`);
  }
});

test("generate_scene_image: ürünün bilinen bir fotoğrafı yoksa hiçbir üretim çağrısı yapılmadan reddedilir", async () => {
  let generateCalled = false;
  const registry = createCapabilityRegistry({
    resolveOrchestratorProductImpl: async () => ({ title: "x", imageUrl: "" }),
    generateSceneImageImpl: async () => { generateCalled = true; return {}; }
  });
  await assert.rejects(
    () => registry.generate_scene_image.run({ productId: "p1", sceneDescription: "mutfak", confirmed: true }, {}),
    /bilinen bir fotoğrafı yok/
  );
  assert.equal(generateCalled, false);
});

test("generate_scene_image: provider='composite' generateCompositeSceneImageImpl'e yönlendirilir, generateSceneImageImpl'e HİÇ gidilmez, availableSceneProvidersImpl HİÇ çağrılmaz", async () => {
  let compositeCalled = false;
  let normalCalled = false;
  let availableCalled = false;
  const registry = createCapabilityRegistry({
    resolveOrchestratorProductImpl: async () => ({ title: "x", imageUrl: "https://example.com/p.png" }),
    availableSceneProvidersImpl: () => { availableCalled = true; return ["gemini", "composite"]; },
    generateCompositeSceneImageImpl: async () => { compositeCalled = true; return { dataUrl: "data:image/png;base64,AA==", provider: "composite" }; },
    generateSceneImageImpl: async () => { normalCalled = true; return {}; }
  });
  const result = await registry.generate_scene_image.run({ productId: "p1", sceneDescription: "mutfak", provider: "composite", confirmed: true }, {});
  assert.equal(compositeCalled, true);
  assert.equal(normalCalled, false);
  assert.equal(availableCalled, false, "composite özel rotası availableSceneProviders'ı hiç sormamalı");
  assert.equal(result.provider, "composite");
});

// ROOT review (PR #106): "composite" generateSceneImage'ın normal provider
// switch'inde YOKTUR ve availableSceneProviders(env)'in listelediği
// "normal" bir provider GİBİ davranılmamalı — orada YOKSA (örn.
// GEMINI_API_KEY tanımsız, sadece OPENAI_API_KEY varken) bu onu reddetmek
// için bir sebep DEĞİLDİR; composite kendi GERÇEK ön koşulunu (GEMINI_API_KEY)
// KENDİSİ uygular.
test("generate_scene_image: provider='composite', availableSceneProviders(env) listesinde HİÇ YOKSA (örn. sadece OPENAI_API_KEY varken) bile reddedilmez — composite'e yönlendirilir", async () => {
  let compositeCalled = false;
  const registry = createCapabilityRegistry({
    resolveOrchestratorProductImpl: async () => ({ title: "x", imageUrl: "https://example.com/p.png" }),
    availableSceneProvidersImpl: () => ["openai", "openai-low", "openai-high"], // composite YOK
    generateCompositeSceneImageImpl: async () => { compositeCalled = true; return { dataUrl: "data:image/png;base64,AA==", provider: "composite" }; }
  });
  const result = await registry.generate_scene_image.run({ productId: "p1", sceneDescription: "mutfak", provider: "composite", confirmed: true }, {});
  assert.equal(compositeCalled, true);
  assert.equal(result.provider, "composite");
});

test("generate_scene_image: provider='composite'nin GERÇEK ön koşulu (örn. GEMINI_API_KEY eksikliği) composite'in KENDİ implementasyonu tarafından uygulanır — orkestratör bunu bypass ETMEZ", async () => {
  const registry = createCapabilityRegistry({
    resolveOrchestratorProductImpl: async () => ({ title: "x", imageUrl: "https://example.com/p.png" }),
    generateCompositeSceneImageImpl: async () => { throw new Error("GEMINI_API_KEY Vercel Production ortamında tanımlı değil."); }
  });
  await assert.rejects(
    () => registry.generate_scene_image.run({ productId: "p1", sceneDescription: "mutfak", provider: "composite", confirmed: true }, {}),
    /GEMINI_API_KEY/
  );
});

test("generate_scene_image: açıkça istenen NORMAL bir provider kullanılabilirse tam olarak O provider ile çağrılır", async () => {
  let seenProvider;
  const registry = createCapabilityRegistry({
    resolveOrchestratorProductImpl: async () => ({ title: "x", imageUrl: "https://example.com/p.png" }),
    availableSceneProvidersImpl: () => ["gemini", "nano-banana-2", "openai"],
    generateSceneImageImpl: async (product, sceneDescription, env, opts) => { seenProvider = opts.provider; return {}; }
  });
  await registry.generate_scene_image.run({ productId: "p1", sceneDescription: "mutfak", provider: "nano-banana-2", confirmed: true }, {});
  assert.equal(seenProvider, "nano-banana-2");
});

test("generate_scene_image: açıkça istenen NORMAL bir provider kullanılamıyorsa FAIL CLOSED reddedilir — providers[0]'a SESSİZCE düşülmez, hiçbir üretim çağrısı yapılmaz", async () => {
  let generateCalled = false;
  const registry = createCapabilityRegistry({
    resolveOrchestratorProductImpl: async () => ({ title: "x", imageUrl: "https://example.com/p.png" }),
    availableSceneProvidersImpl: () => ["nano-banana-2", "openai"],
    generateSceneImageImpl: async () => { generateCalled = true; return {}; }
  });
  await assert.rejects(
    () => registry.generate_scene_image.run({ productId: "p1", sceneDescription: "mutfak", provider: "made-up-provider", confirmed: true }, {}),
    /Desteklenmeyen veya şu anda kullanılamayan sahne üretim sağlayıcısı/
  );
  assert.equal(generateCalled, false, "sağlayıcı doğrulaması başarısız olduktan sonra HİÇBİR üretim çağrısı yapılmamalı");
});

test("generate_scene_image: provider hiç verilmezse dokümante edilmiş varsayılan (ilk kullanılabilir provider) seçilir — bu bir silent fallback DEĞİLDİR, caller başka bir şey istemedi", async () => {
  let seenProvider;
  const registry = createCapabilityRegistry({
    resolveOrchestratorProductImpl: async () => ({ title: "x", imageUrl: "https://example.com/p.png" }),
    availableSceneProvidersImpl: () => ["openai", "openai-low", "openai-high"],
    generateSceneImageImpl: async (product, sceneDescription, env, opts) => { seenProvider = opts.provider; return {}; }
  });
  await registry.generate_scene_image.run({ productId: "p1", sceneDescription: "mutfak", confirmed: true }, {});
  assert.equal(seenProvider, "openai");
});

test("get_buzsu_product_context: productId ve productUrl'den hiçbiri verilmezse hiçbir çağrı yapılmadan reddedilir", async () => {
  let called = false;
  const registry = createCapabilityRegistry({ getBuzsuProductContextImpl: async () => { called = true; return {}; } });
  await assert.rejects(() => registry.get_buzsu_product_context.run({}, {}), /productId. veya .productUrl. gerekli/);
  assert.equal(called, false);
});
