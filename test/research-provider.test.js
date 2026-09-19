import test from "node:test";
import assert from "node:assert/strict";
import { RESEARCH_PROVIDERS, researchProviderAvailability, resolveResearchProvider } from "../src/research/provider.js";

test("RESEARCH_PROVIDERS sabit ve öngörülebilir", () => {
  assert.deepEqual(RESEARCH_PROVIDERS, ["google", "openai"]);
});

test("researchProviderAvailability: yalnız gerçek API key'i olan sağlayıcıları true işaretler", () => {
  assert.deepEqual(researchProviderAvailability({}), { google: false, openai: false });
  assert.deepEqual(researchProviderAvailability({ GEMINI_API_KEY: "g" }), { google: true, openai: false });
  assert.deepEqual(researchProviderAvailability({ OPENAI_API_KEY: "o" }), { google: false, openai: true });
});

test("resolveResearchProvider: açık provider verilip key yoksa available:false + reason:missing_api_key (diğer sağlayıcıya bakılmaz)", () => {
  const result = resolveResearchProvider("google", { OPENAI_API_KEY: "o" });
  assert.equal(result.available, false);
  assert.equal(result.provider, "google");
  assert.equal(result.reason, "missing_api_key");
});

test("resolveResearchProvider: açık provider ve key varsa available:true döner", () => {
  const result = resolveResearchProvider("openai", { OPENAI_API_KEY: "o" });
  assert.deepEqual(result, { available: true, provider: "openai" });
});

test("resolveResearchProvider: desteklenmeyen bir provider adı available:false + reason:unsupported_provider döner", () => {
  const result = resolveResearchProvider("anthropic", { OPENAI_API_KEY: "o" });
  assert.equal(result.available, false);
  assert.equal(result.reason, "unsupported_provider");
});

test("resolveResearchProvider: auto — google yapılandırılmışsa openai'a bakmadan onu seçer (öncelik sırası)", () => {
  const result = resolveResearchProvider("auto", { GEMINI_API_KEY: "g", OPENAI_API_KEY: "o" });
  assert.deepEqual(result, { available: true, provider: "google" });
});

test("resolveResearchProvider: auto — google yoksa openai'a düşer", () => {
  const result = resolveResearchProvider("auto", { OPENAI_API_KEY: "o" });
  assert.deepEqual(result, { available: true, provider: "openai" });
});

test("resolveResearchProvider: auto — hiçbir sağlayıcı yapılandırılmamışsa available:false + reason:no_available_provider döner (SESSİZCE bir şey seçilmez)", () => {
  const result = resolveResearchProvider("auto", {});
  assert.deepEqual(result, { available: false, provider: null, reason: "no_available_provider" });
});

test("resolveResearchProvider: provider verilmezse (undefined) auto ile aynı davranır", () => {
  const result = resolveResearchProvider(undefined, { OPENAI_API_KEY: "o" });
  assert.deepEqual(result, { available: true, provider: "openai" });
});
