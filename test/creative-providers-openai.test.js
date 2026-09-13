import test from "node:test";
import assert from "node:assert/strict";
import { isOpenAiTextModel, listOpenAiModels } from "../src/creative-providers/openai.js";

test("isOpenAiTextModel keeps plausible text/reasoning model ids", () => {
  assert.equal(isOpenAiTextModel("gpt-5.6"), true);
  assert.equal(isOpenAiTextModel("gpt-5.4-nano"), true);
  assert.equal(isOpenAiTextModel("o4-mini"), true);
});

test("isOpenAiTextModel excludes known non-text families (image/tts/embedding/moderation/etc.)", () => {
  assert.equal(isOpenAiTextModel("dall-e-3"), false);
  assert.equal(isOpenAiTextModel("gpt-image-2"), false);
  assert.equal(isOpenAiTextModel("whisper-1"), false);
  assert.equal(isOpenAiTextModel("tts-1"), false);
  assert.equal(isOpenAiTextModel("gpt-4o-mini-tts"), false);
  assert.equal(isOpenAiTextModel("text-embedding-3-large"), false);
  assert.equal(isOpenAiTextModel("omni-moderation-latest"), false);
  assert.equal(isOpenAiTextModel("gpt-4o-realtime-preview"), false);
  assert.equal(isOpenAiTextModel("gpt-4o-transcribe"), false);
  assert.equal(isOpenAiTextModel("sora-1"), false);
  assert.equal(isOpenAiTextModel("davinci-002"), false);
});

test("listOpenAiModels: API key yoksa hiçbir fetch atmadan available:false + reason:missing_api_key döner", async () => {
  let fetchCalled = false;
  const result = await listOpenAiModels({}, { fetchImpl: async () => { fetchCalled = true; throw new Error("çağrılmamalıydı"); } });
  assert.equal(result.available, false);
  assert.equal(result.reason, "missing_api_key");
  assert.deepEqual(result.models, []);
  assert.equal(fetchCalled, false);
});

test("listOpenAiModels: OPENAI_IMAGE_API_KEY (kredili anahtar) OPENAI_API_KEY yerine kullanılabilir — ai-providers.js ile AYNI öncelik", async () => {
  const result = await listOpenAiModels(
    { OPENAI_IMAGE_API_KEY: "img-key" },
    { fetchImpl: async (url, options) => { assert.equal(options.headers.Authorization, "Bearer img-key"); return { ok: true, json: async () => ({ data: [] }) }; } }
  );
  assert.equal(result.available, true);
});

test("listOpenAiModels: ham listeyi capability-filtresinden geçirir, sadece text ailesi normalize edilmiş şekilde döner", async () => {
  const raw = { data: [
    { id: "gpt-5.6", object: "model", owned_by: "openai" },
    { id: "dall-e-3", object: "model", owned_by: "openai" },
    { id: "text-embedding-3-large", object: "model", owned_by: "openai" }
  ] };
  const result = await listOpenAiModels({ OPENAI_API_KEY: "key" }, { fetchImpl: async () => ({ ok: true, json: async () => raw }) });
  assert.equal(result.available, true);
  assert.equal(result.models.length, 1);
  assert.deepEqual(result.models[0], { provider: "openai", model: "gpt-5.6", displayName: "gpt-5.6", capabilities: ["text"], available: true });
});

test("listOpenAiModels: HTTP hatası (ör. 401 geçersiz anahtar) available:false + reason:list_models_failed döner, throw etmez", async () => {
  const result = await listOpenAiModels(
    { OPENAI_API_KEY: "bad-key" },
    { fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({ error: { message: "Incorrect API key provided." } }) }) }
  );
  assert.equal(result.available, false);
  assert.equal(result.reason, "list_models_failed");
  assert.match(result.error, /Incorrect API key/);
  assert.deepEqual(result.models, []);
});

test("listOpenAiModels: ağ hatası (fetch throw) available:false + reason:list_models_failed döner, throw etmez", async () => {
  const result = await listOpenAiModels({ OPENAI_API_KEY: "key" }, { fetchImpl: async () => { throw new Error("network down"); } });
  assert.equal(result.available, false);
  assert.equal(result.reason, "list_models_failed");
  assert.equal(result.error, "network down");
});
