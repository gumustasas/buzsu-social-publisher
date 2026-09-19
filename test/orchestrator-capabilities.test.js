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

test("generate_scene_image: provider='composite' generateCompositeSceneImageImpl'e yönlendirilir, generateSceneImageImpl'e HİÇ gidilmez", async () => {
  let compositeCalled = false;
  let normalCalled = false;
  const registry = createCapabilityRegistry({
    resolveOrchestratorProductImpl: async () => ({ title: "x", imageUrl: "https://example.com/p.png" }),
    availableSceneProvidersImpl: () => ["gemini", "composite"],
    generateCompositeSceneImageImpl: async () => { compositeCalled = true; return { dataUrl: "data:image/png;base64,AA==", provider: "composite" }; },
    generateSceneImageImpl: async () => { normalCalled = true; return {}; }
  });
  const result = await registry.generate_scene_image.run({ productId: "p1", sceneDescription: "mutfak", provider: "composite", confirmed: true }, {});
  assert.equal(compositeCalled, true);
  assert.equal(normalCalled, false);
  assert.equal(result.provider, "composite");
});

test("generate_scene_image: geçersiz/desteklenmeyen bir provider istenirse SESSİZCE yok sayılmaz, mevcut providers listesinin ilkine düşer (generateSceneImage'ın kendi ilkesiyle AYNI)", async () => {
  let seenProvider;
  const registry = createCapabilityRegistry({
    resolveOrchestratorProductImpl: async () => ({ title: "x", imageUrl: "https://example.com/p.png" }),
    availableSceneProvidersImpl: () => ["nano-banana-2", "openai"],
    generateSceneImageImpl: async (product, sceneDescription, env, opts) => { seenProvider = opts.provider; return {}; }
  });
  await registry.generate_scene_image.run({ productId: "p1", sceneDescription: "mutfak", provider: "made-up-provider", confirmed: true }, {});
  assert.equal(seenProvider, "nano-banana-2");
});

test("get_buzsu_product_context: productId ve productUrl'den hiçbiri verilmezse hiçbir çağrı yapılmadan reddedilir", async () => {
  let called = false;
  const registry = createCapabilityRegistry({ getBuzsuProductContextImpl: async () => { called = true; return {}; } });
  await assert.rejects(() => registry.get_buzsu_product_context.run({}, {}), /productId. veya .productUrl. gerekli/);
  assert.equal(called, false);
});
