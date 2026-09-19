import test from "node:test";
import assert from "node:assert/strict";
import { listGeminiModels } from "../src/lib/gemini-model-discovery.js";

test("listGeminiModels: GEMINI_API_KEY yoksa hiçbir fetch atmadan null döner", async () => {
  let called = false;
  const result = await listGeminiModels({}, { fetchImpl: async () => { called = true; throw new Error("çağrılmamalıydı"); } });
  assert.equal(result, null);
  assert.equal(called, false);
});

test("listGeminiModels: x-goog-api-key header ile çağırır, 'models/' önekini soyup bir Set döner", async () => {
  const result = await listGeminiModels({ GEMINI_API_KEY: "gkey" }, {
    fetchImpl: async (url, options) => {
      assert.equal(url, "https://generativelanguage.googleapis.com/v1beta/models");
      assert.equal(options.headers["x-goog-api-key"], "gkey");
      return { ok: true, json: async () => ({ models: [{ name: "models/gemini-3-pro-image" }, { name: "models/gemini-3.1-flash-image" }] }) };
    }
  });
  assert.ok(result instanceof Set);
  assert.deepEqual([...result].sort(), ["gemini-3.1-flash-image", "gemini-3-pro-image"].sort());
});

test("listGeminiModels: HTTP hatası SESSİZCE null döner (throw etmez)", async () => {
  const result = await listGeminiModels({ GEMINI_API_KEY: "gkey" }, { fetchImpl: async () => ({ ok: false, status: 403 }) });
  assert.equal(result, null);
});

test("listGeminiModels: ağ hatası (fetch throw) SESSİZCE null döner (throw etmez)", async () => {
  const result = await listGeminiModels({ GEMINI_API_KEY: "gkey" }, { fetchImpl: async () => { throw new Error("network down"); } });
  assert.equal(result, null);
});

test("listGeminiModels: models alanı dizi değilse null döner", async () => {
  const result = await listGeminiModels({ GEMINI_API_KEY: "gkey" }, { fetchImpl: async () => ({ ok: true, json: async () => ({}) }) });
  assert.equal(result, null);
});
