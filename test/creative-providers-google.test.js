import test from "node:test";
import assert from "node:assert/strict";
import { isGoogleTextModel, stripModelsPrefix, listGoogleModels } from "../src/creative-providers/google.js";

test("stripModelsPrefix removes the leading 'models/' segment, leaves a bare id unchanged", () => {
  assert.equal(stripModelsPrefix("models/gemini-3.5-flash"), "gemini-3.5-flash");
  assert.equal(stripModelsPrefix("gemini-3.5-flash"), "gemini-3.5-flash");
  assert.equal(stripModelsPrefix(""), "");
});

test("isGoogleTextModel requires generateContent support — models without it (ör. sadece embedContent) elenir", () => {
  assert.equal(isGoogleTextModel({ name: "models/text-embedding-004", supportedGenerationMethods: ["embedContent"] }), false);
  assert.equal(isGoogleTextModel({ name: "models/gemini-3.5-flash", supportedGenerationMethods: [] }), false);
  assert.equal(isGoogleTextModel({ name: "models/gemini-3.5-flash" }), false);
});

test("isGoogleTextModel: generateContent destekleyen ama görsel/TTS/Veo/Lyria ailesi olan modeller elenir", () => {
  assert.equal(isGoogleTextModel({ name: "models/gemini-3.1-flash-lite-image", supportedGenerationMethods: ["generateContent"] }), false);
  assert.equal(isGoogleTextModel({ name: "models/imagen-4", supportedGenerationMethods: ["generateContent"] }), false);
  assert.equal(isGoogleTextModel({ name: "models/veo-3.1-generate-preview", supportedGenerationMethods: ["generateContent"] }), false);
  assert.equal(isGoogleTextModel({ name: "models/lyria-3-clip-preview", supportedGenerationMethods: ["generateContent"] }), false);
  assert.equal(isGoogleTextModel({ name: "models/gemini-3.1-flash-tts-preview", supportedGenerationMethods: ["generateContent"] }), false);
});

test("isGoogleTextModel: generateContent destekleyen sade bir metin modeli kabul edilir", () => {
  assert.equal(isGoogleTextModel({ name: "models/gemini-3.5-flash", supportedGenerationMethods: ["generateContent", "countTokens"] }), true);
});

test("listGoogleModels: GEMINI_API_KEY yoksa hiçbir fetch atmadan available:false + reason:missing_api_key döner", async () => {
  let fetchCalled = false;
  const result = await listGoogleModels({}, { fetchImpl: async () => { fetchCalled = true; throw new Error("çağrılmamalıydı"); } });
  assert.equal(result.available, false);
  assert.equal(result.reason, "missing_api_key");
  assert.equal(fetchCalled, false);
});

test("listGoogleModels: x-goog-api-key header ile çağırır, ham listeyi filtreler ve models/ önekini soyar", async () => {
  const raw = { models: [
    { name: "models/gemini-3.5-flash", displayName: "Gemini 3.5 Flash", supportedGenerationMethods: ["generateContent"] },
    { name: "models/gemini-3.1-flash-lite-image", displayName: "Gemini Image", supportedGenerationMethods: ["generateContent"] },
    { name: "models/text-embedding-004", displayName: "Embedding", supportedGenerationMethods: ["embedContent"] }
  ] };
  const result = await listGoogleModels(
    { GEMINI_API_KEY: "gkey" },
    { fetchImpl: async (url, options) => { assert.equal(options.headers["x-goog-api-key"], "gkey"); return { ok: true, json: async () => raw }; } }
  );
  assert.equal(result.available, true);
  assert.equal(result.models.length, 1);
  assert.deepEqual(result.models[0], { provider: "google", model: "gemini-3.5-flash", displayName: "Gemini 3.5 Flash", capabilities: ["text"], available: true });
});

test("listGoogleModels: displayName yoksa bare model id'ye düşer, uydurma bir isim üretmez", async () => {
  const raw = { models: [{ name: "models/gemini-9-preview", supportedGenerationMethods: ["generateContent"] }] };
  const result = await listGoogleModels({ GEMINI_API_KEY: "gkey" }, { fetchImpl: async () => ({ ok: true, json: async () => raw }) });
  assert.equal(result.models[0].displayName, "gemini-9-preview");
});

test("listGoogleModels: nextPageToken varsa ikinci sayfayı da çeker ve iki sayfanın modellerini birleştirir", async () => {
  let calls = 0;
  const result = await listGoogleModels({ GEMINI_API_KEY: "gkey" }, {
    fetchImpl: async (url) => {
      calls++;
      const parsed = new URL(url);
      if (calls === 1) {
        assert.equal(parsed.searchParams.get("pageToken"), null);
        return { ok: true, json: async () => ({ models: [{ name: "models/gemini-a", supportedGenerationMethods: ["generateContent"] }], nextPageToken: "page2" }) };
      }
      assert.equal(parsed.searchParams.get("pageToken"), "page2");
      return { ok: true, json: async () => ({ models: [{ name: "models/gemini-b", supportedGenerationMethods: ["generateContent"] }] }) };
    }
  });
  assert.equal(calls, 2);
  assert.deepEqual(result.models.map((m) => m.model), ["gemini-a", "gemini-b"]);
});

test("listGoogleModels: HTTP hatası available:false + reason:list_models_failed döner, throw etmez", async () => {
  const result = await listGoogleModels({ GEMINI_API_KEY: "bad" }, { fetchImpl: async () => ({ ok: false, status: 403, json: async () => ({ error: { message: "API key not valid." } }) }) });
  assert.equal(result.available, false);
  assert.equal(result.reason, "list_models_failed");
  assert.match(result.error, /API key not valid/);
});

test("listGoogleModels: ağ hatası (fetch throw) available:false + reason:list_models_failed döner, throw etmez", async () => {
  const result = await listGoogleModels({ GEMINI_API_KEY: "gkey" }, { fetchImpl: async () => { throw new Error("network down"); } });
  assert.equal(result.available, false);
  assert.equal(result.reason, "list_models_failed");
  assert.equal(result.error, "network down");
});
