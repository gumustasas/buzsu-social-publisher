import test from "node:test";
import assert from "node:assert/strict";
import { getVideoProviderCapabilities } from "../src/lib/video-provider-capabilities.js";
import { OMNI_MODEL } from "../src/omni-video.js";
import { VEO_3_1_MODEL_TIERS, VEO_3_0_MODEL_TIERS } from "../src/veo-video.js";

test("getVideoProviderCapabilities reports everything unavailable when no keys are configured", async () => {
  const capabilities = await getVideoProviderCapabilities({});
  assert.deepEqual(capabilities, {
    google: {
      omni: { available: false, models: [] },
      veo: {
        "3.0": { available: false, models: { generate: null, fast: null, lite: null } },
        "3.1": { available: false, models: { generate: null, fast: null, lite: null } }
      }
    },
    fal: { available: false }
  });
});

test("getVideoProviderCapabilities: fal availability is derived purely from FAL_KEY presence", async () => {
  const capabilities = await getVideoProviderCapabilities({ FAL_KEY: "test" });
  assert.equal(capabilities.fal.available, true);
});

// GEMINI_API_KEY var ama discovery isteği (GET /v1beta/models) herhangi bir
// sebeple başarısız/erişilemezse (örn. ağ kısıtlı bir ortam) capability
// SESSİZCE "unavailable" görünmemeli — ama YALNIZCA Veo 3.1 (bu depodaki
// önceden entegre/varsayılan aile) için anahtar varlığına düşülür. Veo 3
// (GA) bu varsayıma DAHİL EDİLMEZ (bkz. src/lib/video-provider-capabilities.js)
// — hangi hesapların erişimi olduğu değişken olduğu için doğrulanmadan
// "available" denmez.
test("getVideoProviderCapabilities falls back to key-presence ONLY for Veo 3.1 when discovery fails — Veo 3 (GA) stays unavailable without confirmation", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => { throw new Error("network unreachable"); };
  try {
    const capabilities = await getVideoProviderCapabilities({ GEMINI_API_KEY: "test" });
    assert.equal(capabilities.google.omni.available, true);
    assert.deepEqual(capabilities.google.omni.models, [OMNI_MODEL]);
    assert.equal(capabilities.google.veo["3.1"].available, true);
    assert.deepEqual(capabilities.google.veo["3.1"].models, {
      generate: VEO_3_1_MODEL_TIERS.quality,
      fast: VEO_3_1_MODEL_TIERS.fast,
      lite: VEO_3_1_MODEL_TIERS.economy
    });
    assert.equal(capabilities.google.veo["3.0"].available, false);
    assert.deepEqual(capabilities.google.veo["3.0"].models, { generate: null, fast: null, lite: null });
  } finally {
    global.fetch = originalFetch;
  }
});

// Gerçek bir GET /v1beta/models yanıtında Veo 3 (GA) ve Veo 3.1 (Preview)
// ID'leri BİRLİKTE dönerse, ikisi ayrı ailelere (families) yerleşmeli —
// hiçbir zaman karışmamalı veya birbirinin yerine geçmemeli.
test("getVideoProviderCapabilities classifies real Veo 3 (GA) and Veo 3.1 (Preview) model IDs into separate families, never mixed", async () => {
  const originalFetch = global.fetch;
  let requestedUrl = null;
  let requestHeaders = null;
  global.fetch = async (url, options) => {
    requestedUrl = String(url);
    requestHeaders = options?.headers || {};
    return {
      ok: true,
      json: async () => ({
        models: [
          { name: `models/${OMNI_MODEL}` },
          { name: `models/${VEO_3_0_MODEL_TIERS.generate}` },
          { name: `models/${VEO_3_0_MODEL_TIERS.fast}` },
          { name: `models/${VEO_3_1_MODEL_TIERS.fast}` }
          // Veo 3.1 quality/economy ve Veo 3 lite deliberately absent — no access on this account.
        ]
      })
    };
  };
  try {
    const capabilities = await getVideoProviderCapabilities({ GEMINI_API_KEY: "secret-key-value" });
    assert.equal(requestedUrl, "https://generativelanguage.googleapis.com/v1beta/models");
    assert.equal(capabilities.google.omni.available, true);

    assert.equal(capabilities.google.veo["3.0"].available, true);
    assert.deepEqual(capabilities.google.veo["3.0"].models, {
      generate: VEO_3_0_MODEL_TIERS.generate,
      fast: VEO_3_0_MODEL_TIERS.fast,
      lite: null
    });

    assert.equal(capabilities.google.veo["3.1"].available, true);
    assert.deepEqual(capabilities.google.veo["3.1"].models, { generate: null, fast: VEO_3_1_MODEL_TIERS.fast, lite: null });

    // Aileler birbirine sızmıyor: 3.0'ın "generate" alanı ASLA 3.1'in ID'sini taşımıyor ve tersi.
    assert.notEqual(capabilities.google.veo["3.0"].models.fast, capabilities.google.veo["3.1"].models.fast);

    // API anahtarı isteğin header'ında olabilir (Google'ın gerektirdiği şekilde)
    // ama YANITTA/capabilities objesinde ASLA görünmemeli.
    assert.equal(requestHeaders["x-goog-api-key"], "secret-key-value");
    assert.equal(JSON.stringify(capabilities).includes("secret-key-value"), false);
  } finally {
    global.fetch = originalFetch;
  }
});

test("getVideoProviderCapabilities reports Omni unavailable if GET /v1beta/models discovery does not list it, even with a key present", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: true, json: async () => ({ models: [{ name: `models/${VEO_3_1_MODEL_TIERS.economy}` }] }) });
  try {
    const capabilities = await getVideoProviderCapabilities({ GEMINI_API_KEY: "test" });
    assert.equal(capabilities.google.omni.available, false);
    assert.deepEqual(capabilities.google.omni.models, []);
  } finally {
    global.fetch = originalFetch;
  }
});

// HEDEF: "discovery'de olmayan model UI'da disabled" — bu testin backend
// karşılığı: discovery'de listelenmeyen bir tier, capabilities çıktısında
// null (yani "yok/erişilemez") olarak işaretlenmeli, UI bunu kullanarak
// ilgili <option>'ı disabled gösterir (bkz. dashboard.html).
test("getVideoProviderCapabilities marks a tier not present in discovery as null (not available), enabling the UI to disable it", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: true, json: async () => ({ models: [{ name: `models/${VEO_3_1_MODEL_TIERS.quality}` }] }) });
  try {
    const capabilities = await getVideoProviderCapabilities({ GEMINI_API_KEY: "test" });
    assert.equal(capabilities.google.veo["3.1"].models.generate, VEO_3_1_MODEL_TIERS.quality);
    assert.equal(capabilities.google.veo["3.1"].models.fast, null);
    assert.equal(capabilities.google.veo["3.1"].models.lite, null);
  } finally {
    global.fetch = originalFetch;
  }
});

// HEDEF 7 / 8: API key hiçbir response içinde görünmüyor — env'in tamamı
// olduğu gibi bir provider'a "confused" bir yolla geçirilse bile capabilities
// çıktısı yalnızca available/models alanları taşımalı.
test("getVideoProviderCapabilities never leaks any secret value from env, even when discovery fails", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => { throw new Error("boom"); };
  try {
    const capabilities = await getVideoProviderCapabilities({
      GEMINI_API_KEY: "super-secret-gemini-key",
      FAL_KEY: "super-secret-fal-key",
      OPENAI_API_KEY: "super-secret-openai-key"
    });
    const serialized = JSON.stringify(capabilities);
    assert.equal(serialized.includes("super-secret"), false);
  } finally {
    global.fetch = originalFetch;
  }
});
