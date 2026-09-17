import test from "node:test";
import assert from "node:assert/strict";
import { getVideoProviderCapabilities } from "../src/lib/video-provider-capabilities.js";
import { OMNI_MODEL } from "../src/omni-video.js";
import { VEO_MODEL_TIERS } from "../src/veo-video.js";

test("getVideoProviderCapabilities reports everything unavailable when no keys are configured", async () => {
  const capabilities = await getVideoProviderCapabilities({});
  assert.deepEqual(capabilities, {
    google: { omni: { available: false, models: [] }, veo: { available: false, models: [] } },
    fal: { available: false }
  });
});

test("getVideoProviderCapabilities: fal availability is derived purely from FAL_KEY presence", async () => {
  const capabilities = await getVideoProviderCapabilities({ FAL_KEY: "test" });
  assert.equal(capabilities.fal.available, true);
});

// GEMINI_API_KEY var ama discovery isteği (GET /v1beta/models) herhangi bir
// sebeple başarısız/erişilemezse (örn. ağ kısıtlı bir ortam) capability
// SESSİZCE "unavailable" görünmemeli — bu durumda yalnızca anahtar varlığına
// düşülür (bkz. src/lib/video-provider-capabilities.js).
test("getVideoProviderCapabilities falls back to key-presence when the discovery request itself fails (e.g. blocked network)", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => { throw new Error("network unreachable"); };
  try {
    const capabilities = await getVideoProviderCapabilities({ GEMINI_API_KEY: "test" });
    assert.equal(capabilities.google.omni.available, true);
    assert.deepEqual(capabilities.google.omni.models, [OMNI_MODEL]);
    assert.equal(capabilities.google.veo.available, true);
    assert.deepEqual(capabilities.google.veo.models, Object.values(VEO_MODEL_TIERS));
  } finally {
    global.fetch = originalFetch;
  }
});

test("getVideoProviderCapabilities only reports the Veo/Omni models actually present in a real GET /v1beta/models discovery response", async () => {
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
          { name: `models/${VEO_MODEL_TIERS.fast}` },
          { name: `models/${VEO_MODEL_TIERS.quality}` }
          // economy (veo-3.1-lite-generate-preview) deliberately absent — no access to it on this account.
        ]
      })
    };
  };
  try {
    const capabilities = await getVideoProviderCapabilities({ GEMINI_API_KEY: "secret-key-value" });
    assert.equal(requestedUrl, "https://generativelanguage.googleapis.com/v1beta/models");
    assert.equal(capabilities.google.omni.available, true);
    assert.equal(capabilities.google.veo.available, true);
    assert.deepEqual(new Set(capabilities.google.veo.models), new Set([VEO_MODEL_TIERS.fast, VEO_MODEL_TIERS.quality]));
    assert.ok(!capabilities.google.veo.models.includes(VEO_MODEL_TIERS.economy));
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
  global.fetch = async () => ({ ok: true, json: async () => ({ models: [{ name: `models/${VEO_MODEL_TIERS.economy}` }] }) });
  try {
    const capabilities = await getVideoProviderCapabilities({ GEMINI_API_KEY: "test" });
    assert.equal(capabilities.google.omni.available, false);
    assert.deepEqual(capabilities.google.omni.models, []);
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
