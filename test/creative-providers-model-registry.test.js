import test from "node:test";
import assert from "node:assert/strict";
import {
  CREATIVE_PROVIDERS,
  CREATIVE_TIERS,
  CREATIVE_TIER_ENV_VARS,
  discoverCreativeModels,
  resolveTier,
  resolveAutoSelection,
  isModelSelectable
} from "../src/creative-providers/model-registry.js";

test("CREATIVE_PROVIDERS/CREATIVE_TIERS sabit ve öngörülebilir", () => {
  assert.deepEqual(CREATIVE_PROVIDERS, ["openai", "google"]);
  assert.deepEqual(CREATIVE_TIERS, ["economy", "balanced", "quality", "premium"]);
});

test("CREATIVE_TIER_ENV_VARS: her provider için 4 tier'ın hepsi ayrı bir env değişkenine sahip", () => {
  for (const provider of CREATIVE_PROVIDERS) {
    for (const tier of CREATIVE_TIERS) {
      assert.ok(typeof CREATIVE_TIER_ENV_VARS[provider][tier] === "string" && CREATIVE_TIER_ENV_VARS[provider][tier].length > 0);
    }
  }
  assert.equal(CREATIVE_TIER_ENV_VARS.openai.quality, "OPENAI_CREATIVE_QUALITY_MODEL");
  assert.equal(CREATIVE_TIER_ENV_VARS.google.economy, "GOOGLE_CREATIVE_ECONOMY_MODEL");
});

// --- discoverCreativeModels --------------------------------------------

test("discoverCreativeModels: iki sağlayıcıyı PARALEL sorgular, biri key'siz olsa da diğerini etkilemez", async () => {
  const env = { GEMINI_API_KEY: "gkey" }; // OPENAI key YOK
  const result = await discoverCreativeModels(env, {
    fetchImpl: async (url) => {
      if (String(url).includes("generativelanguage")) return { ok: true, json: async () => ({ models: [{ name: "models/gemini-3.5-flash", supportedGenerationMethods: ["generateContent"] }] }) };
      throw new Error("openai fetch çağrılmamalıydı (key yok)");
    }
  });
  assert.equal(result.openai.available, false);
  assert.equal(result.openai.reason, "missing_api_key");
  assert.equal(result.google.available, true);
  assert.equal(result.google.models.length, 1);
});

test("discoverCreativeModels: env override'a göre modele tierCandidate etiketi ekler (tahmin değil, doğrudan eşleşme)", async () => {
  const env = { OPENAI_API_KEY: "okey", OPENAI_CREATIVE_QUALITY_MODEL: "gpt-5.6" };
  const result = await discoverCreativeModels(env, {
    fetchImpl: async (url) => {
      if (String(url).includes("api.openai.com")) return { ok: true, json: async () => ({ data: [{ id: "gpt-5.6" }, { id: "gpt-5.4-nano" }] }) };
      return { ok: true, json: async () => ({ models: [] }) };
    }
  });
  const quality = result.openai.models.find((m) => m.model === "gpt-5.6");
  const nano = result.openai.models.find((m) => m.model === "gpt-5.4-nano");
  assert.equal(quality.tierCandidate, "quality");
  assert.equal(nano.tierCandidate, null);
});

// --- resolveTier ---------------------------------------------------------

test("resolveTier: env override yoksa available:false + reason:not_configured (tahmini model ATANMAZ)", () => {
  const discovery = { openai: { available: true, models: [] }, google: { available: true, models: [] } };
  const result = resolveTier("openai", "premium", discovery, {});
  assert.equal(result.available, false);
  assert.equal(result.reason, "not_configured");
  assert.equal(result.model, null);
});

test("resolveTier: provider discovery'si key yoksa başarısızsa o sebep AYNEN yansır", () => {
  const discovery = { openai: { available: false, reason: "missing_api_key", models: [] }, google: { available: true, models: [] } };
  const result = resolveTier("openai", "quality", discovery, { OPENAI_CREATIVE_QUALITY_MODEL: "gpt-5.6" });
  assert.equal(result.available, false);
  assert.equal(result.reason, "missing_api_key");
});

test("resolveTier: override verilmiş model gerçek discovery'de YOKSA available:false + reason:model_not_found — SESSİZCE başka modele geçilmez", () => {
  const discovery = { openai: { available: true, models: [{ provider: "openai", model: "gpt-5.4-nano", displayName: "gpt-5.4-nano", capabilities: ["text"] }] } };
  const result = resolveTier("openai", "quality", discovery, { OPENAI_CREATIVE_QUALITY_MODEL: "gpt-9-does-not-exist" });
  assert.equal(result.available, false);
  assert.equal(result.reason, "model_not_found");
  assert.equal(result.model, "gpt-9-does-not-exist");
});

test("resolveTier: override verilmiş model gerçek discovery'de VARSA available:true + displayName/capabilities döner", () => {
  const discovery = { openai: { available: true, models: [{ provider: "openai", model: "gpt-5.6", displayName: "gpt-5.6", capabilities: ["text"] }] } };
  const result = resolveTier("openai", "quality", discovery, { OPENAI_CREATIVE_QUALITY_MODEL: "gpt-5.6" });
  assert.equal(result.available, true);
  assert.equal(result.model, "gpt-5.6");
  assert.equal(result.displayName, "gpt-5.6");
});

test("resolveTier: geçersiz provider/tier açık bir hata fırlatır", () => {
  assert.throws(() => resolveTier("anthropic", "quality", {}, {}), /Desteklenmeyen provider/);
  assert.throws(() => resolveTier("openai", "ultra", {}, {}), /Desteklenmeyen tier/);
});

// --- resolveAutoSelection --------------------------------------------------

test("resolveAutoSelection: openai yapılandırılmışsa google'a bakmadan onu seçer (öncelik sırası)", () => {
  const discovery = {
    openai: { available: true, models: [{ provider: "openai", model: "gpt-5.6", displayName: "gpt-5.6", capabilities: ["text"] }] },
    google: { available: true, models: [{ provider: "google", model: "gemini-3.5-flash", displayName: "Gemini 3.5 Flash", capabilities: ["text"] }] }
  };
  const env = { OPENAI_CREATIVE_QUALITY_MODEL: "gpt-5.6", GOOGLE_CREATIVE_QUALITY_MODEL: "gemini-3.5-flash" };
  const result = resolveAutoSelection("quality", discovery, env);
  assert.equal(result.provider, "openai");
  assert.equal(result.model, "gpt-5.6");
});

test("resolveAutoSelection: openai bu tier için yapılandırılmamışsa google'a düşer", () => {
  const discovery = {
    openai: { available: true, models: [] },
    google: { available: true, models: [{ provider: "google", model: "gemini-3.5-flash", displayName: "Gemini 3.5 Flash", capabilities: ["text"] }] }
  };
  const env = { GOOGLE_CREATIVE_QUALITY_MODEL: "gemini-3.5-flash" };
  const result = resolveAutoSelection("quality", discovery, env);
  assert.equal(result.provider, "google");
  assert.equal(result.model, "gemini-3.5-flash");
});

test("resolveAutoSelection: hiçbir sağlayıcı bu tier için yapılandırılmamışsa available:false + reason:no_available_provider_for_tier döner (farklı tier'a SESSİZCE düşülmez)", () => {
  const discovery = { openai: { available: true, models: [] }, google: { available: true, models: [] } };
  const result = resolveAutoSelection("premium", discovery, {});
  assert.equal(result.available, false);
  assert.equal(result.provider, null);
  assert.equal(result.reason, "no_available_provider_for_tier");
});

// --- isModelSelectable ("Özel" mod) ----------------------------------------

test("isModelSelectable: gerçekten discovery'de listelenmiş bir model true döner", () => {
  const discovery = { openai: { available: true, models: [{ provider: "openai", model: "gpt-5.6" }] } };
  assert.equal(isModelSelectable("openai", "gpt-5.6", discovery), true);
});

test("isModelSelectable: serbest yazılmış/discovery'de olmayan bir model false döner (uydurma model adı KABUL EDİLMEZ)", () => {
  const discovery = { openai: { available: true, models: [{ provider: "openai", model: "gpt-5.6" }] } };
  assert.equal(isModelSelectable("openai", "gpt-99-hayali", discovery), false);
});

test("isModelSelectable: provider discovery'si başarısızsa (key yok/hata) her zaman false döner", () => {
  const discovery = { openai: { available: false, reason: "missing_api_key", models: [] } };
  assert.equal(isModelSelectable("openai", "gpt-5.6", discovery), false);
});
