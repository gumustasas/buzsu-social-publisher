import test from "node:test";
import assert from "node:assert/strict";
import { getVideoProviderCapabilities } from "../src/lib/video-provider-capabilities.js";
import { OMNI_MODEL } from "../src/omni-video.js";
import { VEO_MODEL_TIERS } from "../src/veo-video.js";

const DEPRECATED_VEO_3_0_IDS = ["veo-3.0-generate-001", "veo-3.0-fast-generate-001"];

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
// düşülür. VEO_MODEL_TIERS artık YALNIZCA aktif Veo 3.1 tier'larını içeriyor
// (bkz. src/veo-video.js) — kapanmış Veo 3.0 ID'leri bu fallback'e hiç dahil
// değil, çünkü zaten VEO_MODEL_TIERS'ta yer almıyorlar.
test("getVideoProviderCapabilities falls back to key-presence when the discovery request itself fails (e.g. blocked network)", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => { throw new Error("network unreachable"); };
  try {
    const capabilities = await getVideoProviderCapabilities({ GEMINI_API_KEY: "test" });
    assert.equal(capabilities.google.omni.available, true);
    assert.deepEqual(capabilities.google.omni.models, [OMNI_MODEL]);
    assert.equal(capabilities.google.veo.available, true);
    assert.deepEqual(new Set(capabilities.google.veo.models), new Set(Object.values(VEO_MODEL_TIERS)));
    // Kapanmış Veo 3.0 ID'leri hiçbir koşulda listede olamaz.
    for (const deadId of DEPRECATED_VEO_3_0_IDS) assert.ok(!capabilities.google.veo.models.includes(deadId));
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

// DÜZELTME (2. tur): Google gerçekten kapanmış Veo 3.0 ID'lerini bir
// discovery yanıtında döndürse bile (beklenmez, ama savunmacı olarak test
// edilir) capabilities bunları ASLA "available" olarak raporlamaz — çünkü
// VEO_MODEL_TIERS (kaynak listesi) bu ID'leri hiç içermiyor; hard-coded bir
// "deprecated ama yine de available" durumu mümkün değil.
test("getVideoProviderCapabilities never reports the deprecated Veo 3.0 IDs as available, even if a stale discovery response still lists them", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    json: async () => ({ models: [{ name: `models/${DEPRECATED_VEO_3_0_IDS[0]}` }, { name: `models/${DEPRECATED_VEO_3_0_IDS[1]}` }] })
  });
  try {
    const capabilities = await getVideoProviderCapabilities({ GEMINI_API_KEY: "test" });
    assert.equal(capabilities.google.veo.available, false);
    assert.deepEqual(capabilities.google.veo.models, []);
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

// HEDEF: "discovery'de olmayan model UI'da disabled" — backend karşılığı:
// discovery'de listelenmeyen bir tier, capabilities.google.veo.models
// dizisinde bulunmaz; UI bunu kullanarak ilgili <option>'ı disabled gösterir
// (bkz. dashboard.html).
test("getVideoProviderCapabilities excludes a tier not present in discovery from google.veo.models, enabling the UI to disable it", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: true, json: async () => ({ models: [{ name: `models/${VEO_MODEL_TIERS.quality}` }] }) });
  try {
    const capabilities = await getVideoProviderCapabilities({ GEMINI_API_KEY: "test" });
    assert.ok(capabilities.google.veo.models.includes(VEO_MODEL_TIERS.quality));
    assert.ok(!capabilities.google.veo.models.includes(VEO_MODEL_TIERS.fast));
    assert.ok(!capabilities.google.veo.models.includes(VEO_MODEL_TIERS.economy));
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
