import test from "node:test";
import assert from "node:assert/strict";
import handler from "../api/reels.js";
import { setSession } from "../src/auth.js";
import { hashVideoPrompt } from "../src/lib/video-prompt.js";

process.env.SESSION_SECRET = process.env.SESSION_SECRET || "test-secret-for-reels-handler";
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || "test-gemini-key";
process.env.AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN || "test-airtable-token";

const PRODUCT_ID = "recVeoTest1";
const PRODUCT_RECORD = { id: PRODUCT_ID, fields: { Başlık: "Test Ürünü", "Kaynak URL": "https://example.com/p", "Görsel URL": "https://example.com/p.jpg" } };

function sessionCookie(user = { id: "u1", username: "test", role: "Admin" }) {
  const headers = {};
  const fakeResponse = { setHeader: (key, value) => { headers[key] = value; } };
  setSession(fakeResponse, user);
  return String(headers["Set-Cookie"]).split(";")[0];
}

function makeRequest(body) {
  return { method: "POST", headers: { cookie: sessionCookie() }, body: JSON.stringify(body) };
}

function makeResponse() {
  const res = { statusCode: null, payload: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => { res.payload = payload; return res; };
  return res;
}

function withMockedFetch(veoResponder, run) {
  const originalFetch = global.fetch;
  const veoCalls = [];
  global.fetch = async (url, options) => {
    const urlStr = String(url);
    if (urlStr.includes("api.airtable.com")) return { ok: true, json: async () => ({ records: [PRODUCT_RECORD] }) };
    if (urlStr === "https://example.com/p.jpg") return { ok: true, headers: { get: () => "image/jpeg" }, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
    veoCalls.push({ url: urlStr, options });
    return veoResponder(urlStr, options);
  };
  return run(veoCalls).finally(() => { global.fetch = originalFetch; });
}

test("reels handler: yetkisiz istek 401 döner", async () => {
  const res = makeResponse();
  await handler({ method: "POST", headers: {}, body: JSON.stringify({ provider: "veo" }) }, res);
  assert.equal(res.statusCode, 401);
});

test("reels handler: body.model seçilen tier'ı submitVeoVideo'ya aktarır (Veo isteğinin URL'sinde doğrulanır)", async () => {
  await withMockedFetch(
    (url) => ({ ok: true, json: async () => ({ name: "operations/test" }) }),
    async (veoCalls) => {
      const prompt = "REFERENCE:\ntest\n\nMOTION:\ntest";
      const req = makeRequest({ provider: "veo", productId: PRODUCT_ID, finalizedPrompt: prompt, promptId: hashVideoPrompt(prompt), model: "economy" });
      const res = makeResponse();
      await handler(req, res);
      assert.equal(res.statusCode, 200);
      assert.equal(res.payload.ok, true);
      assert.equal(res.payload.veo.model, "veo-3.1-lite-generate-preview");
      const veoRequestUrl = veoCalls.find((c) => c.url.includes("predictLongRunning"))?.url;
      assert.match(veoRequestUrl, /veo-3\.1-lite-generate-preview/);
    }
  );
});

test("reels handler: body.profile, body.model'in eşanlamlısı olarak kabul edilir", async () => {
  await withMockedFetch(
    () => ({ ok: true, json: async () => ({ name: "operations/test" }) }),
    async () => {
      const prompt = "REFERENCE:\ntest\n\nMOTION:\ntest";
      const req = makeRequest({ provider: "veo", productId: PRODUCT_ID, finalizedPrompt: prompt, promptId: hashVideoPrompt(prompt), profile: "quality" });
      const res = makeResponse();
      await handler(req, res);
      assert.equal(res.statusCode, 200);
      assert.equal(res.payload.veo.model, "veo-3.1-generate-preview");
    }
  );
});

test("reels handler: body.resolution ('720p'/'1080p') Veo isteğinin parameters alanına aktarılır", async () => {
  await withMockedFetch(
    () => ({ ok: true, json: async () => ({ name: "operations/test" }) }),
    async (veoCalls) => {
      const prompt = "REFERENCE:\ntest\n\nMOTION:\ntest";
      const req = makeRequest({ provider: "veo", productId: PRODUCT_ID, finalizedPrompt: prompt, promptId: hashVideoPrompt(prompt), model: "economy", resolution: "1080p" });
      const res = makeResponse();
      await handler(req, res);
      assert.equal(res.statusCode, 200);
      const predictCall = veoCalls.find((c) => c.url.includes("predictLongRunning"));
      const body = JSON.parse(predictCall.options.body);
      assert.equal(body.parameters.resolution, "1080p");
    }
  );
});

test("reels handler: geçersiz/beklenmeyen bir body.resolution değeri (allowlist dışı) sessizce yok sayılır, model varsayılanına düşülür", async () => {
  await withMockedFetch(
    () => ({ ok: true, json: async () => ({ name: "operations/test" }) }),
    async (veoCalls) => {
      const prompt = "REFERENCE:\ntest\n\nMOTION:\ntest";
      const req = makeRequest({ provider: "veo", productId: PRODUCT_ID, finalizedPrompt: prompt, promptId: hashVideoPrompt(prompt), model: "economy", resolution: "4k" });
      const res = makeResponse();
      await handler(req, res);
      assert.equal(res.statusCode, 200);
      const predictCall = veoCalls.find((c) => c.url.includes("predictLongRunning"));
      const body = JSON.parse(predictCall.options.body);
      assert.equal("resolution" in body.parameters, false);
    }
  );
});

test("reels handler: model belirtilmezse (undefined) resolver zincirine düşer — economy varsayılanı kullanılır", async () => {
  await withMockedFetch(
    () => ({ ok: true, json: async () => ({ name: "operations/test" }) }),
    async () => {
      const prompt = "REFERENCE:\ntest\n\nMOTION:\ntest";
      const req = makeRequest({ provider: "veo", productId: PRODUCT_ID, finalizedPrompt: prompt, promptId: hashVideoPrompt(prompt) });
      const res = makeResponse();
      await handler(req, res);
      assert.equal(res.payload.veo.model, "veo-3.1-lite-generate-preview");
    }
  );
});

test("reels handler: geçersiz model (allowlist dışı) hiçbir Veo/görsel ağ isteği atmadan 500 ile reddedilir", async () => {
  await withMockedFetch(
    () => { throw new Error("Veo'ya hiç istek atılmamalıydı"); },
    async (veoCalls) => {
      const prompt = "REFERENCE:\ntest\n\nMOTION:\ntest";
      const req = makeRequest({ provider: "veo", productId: PRODUCT_ID, finalizedPrompt: prompt, promptId: hashVideoPrompt(prompt), model: "bogus" });
      const res = makeResponse();
      await handler(req, res);
      assert.equal(res.statusCode, 500);
      assert.match(res.payload.error, /Desteklenmeyen Veo modeli/);
      assert.equal(veoCalls.length, 0);
    }
  );
});

test("reels handler: Veo 429 döndürürse HTTP 429 + yapılandırılmış JSON (code/model/alternatives) döner, 500'e düşmez", async () => {
  await withMockedFetch(
    () => ({
      ok: false,
      status: 429,
      headers: { get: (name) => (name.toLowerCase() === "retry-after" ? "5" : null) },
      json: async () => ({ error: { message: "quota exceeded", status: "RESOURCE_EXHAUSTED", details: [] } })
    }),
    async () => {
      const prompt = "REFERENCE:\ntest\n\nMOTION:\ntest";
      const req = makeRequest({ provider: "veo", productId: PRODUCT_ID, finalizedPrompt: prompt, promptId: hashVideoPrompt(prompt), model: "fast" });
      const res = makeResponse();
      await handler(req, res);
      assert.equal(res.statusCode, 429);
      assert.equal(res.payload.ok, false);
      assert.equal(res.payload.code, "RATE_LIMITED");
      assert.equal(res.payload.model, "veo-3.1-fast-generate-preview");
      assert.equal(res.payload.retryAfter, 5);
      assert.deepEqual(res.payload.alternatives.map((a) => a.tier), ["economy", "quality"]);
    }
  );
});

// Bulunan bug: Omni sıfırdan (zero-shot) üretiminde productId koşulsuz
// zorunlu tutuluyordu ("Ürün seçin." hatası) — hem dashboard.html'de hem
// burada, api/reels.js'de. Bu, Omni'nin fal.ai/Veo'dan farklı olarak
// image-to-video DEĞİL, salt metinden video üretebilmesini (bkz.
// src/omni-video.js:submitOmniVideoGeneration) tamamen engelliyordu.
// Aşağıdaki testler düzeltmeyi (skipProductForOmni) doğruluyor.
const OMNI_INTERACTIONS_URL = "https://generativelanguage.googleapis.com/v1beta/interactions";

test("reels handler: Omni zero-shot (freePrompt + productId yok) → preview action, Airtable'a HİÇ dokunmadan promptu birebir döner", async () => {
  const originalFetch = global.fetch;
  let airtableCalled = false;
  global.fetch = async (url) => {
    const href = String(url);
    if (href.includes("api.airtable.com")) { airtableCalled = true; return { ok: true, json: async () => ({ records: [] }) }; }
    throw new Error(`Beklenmeyen fetch: ${href}`);
  };
  try {
    const req = makeRequest({ action: "preview", provider: "omni", productId: "", freePrompt: "a glass of water on a counter" });
    const res = makeResponse();
    await handler(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.ok, true);
    assert.equal(res.payload.preview.prompt, "a glass of water on a counter");
    assert.equal(res.payload.preview.motionSource, "free");
    assert.equal(airtableCalled, false, "productId olmadan Omni zero-shot Airtable'a hiç istek atmamalı");
  } finally {
    global.fetch = originalFetch;
  }
});

test("reels handler: Omni zero-shot (freePrompt + productId yok, sahne görseli yok) → generation isteği Airtable'a dokunmadan gönderilir, submitOmniVideoGeneration'a referenceImageUrl:undefined gider", async () => {
  const originalFetch = global.fetch;
  let airtableCalled = false;
  let interactionsCallCount = 0;
  let capturedBody = null;
  global.fetch = async (url, options) => {
    const href = String(url);
    if (href.includes("api.airtable.com")) { airtableCalled = true; return { ok: true, json: async () => ({ records: [] }) }; }
    if (href === OMNI_INTERACTIONS_URL) {
      interactionsCallCount++;
      capturedBody = JSON.parse(options.body);
      return { ok: true, json: async () => ({ id: "v1_zeroshot", steps: [{ type: "model_output", content: [{ type: "video", uri: `${OMNI_INTERACTIONS_URL.replace("/interactions", "/files/out1")}:download?alt=media`, mime_type: "video/mp4" }] }] }) };
    }
    if (href.includes("/v1beta/files/out1")) return { ok: true, json: async () => ({ name: "files/out1", state: "ACTIVE" }) };
    throw new Error(`Beklenmeyen fetch: ${href}`);
  };
  try {
    const prompt = "a glass of water on a counter";
    const req = makeRequest({ provider: "omni", productId: "", finalizedPrompt: prompt, promptId: hashVideoPrompt(prompt) });
    const res = makeResponse();
    await handler(req, res);
    assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
    assert.equal(res.payload.ok, true);
    assert.equal(res.payload.omni.interactionId, "v1_zeroshot");
    assert.equal(airtableCalled, false, "productId olmadan Omni zero-shot Airtable'a hiç istek atmamalı — ürün zorunlu OLMAMALI");
    assert.equal(interactionsCallCount, 1, "tam olarak bir generation isteği gönderilmeli, tekrar/fallback yok");
    assert.deepEqual(capturedBody.input.map((p) => p.type), ["text"], "referenceImageUrl verilmediği için input yalnızca text içermeli (image parçası yok)");
  } finally {
    global.fetch = originalFetch;
  }
});

// Ürün tabanlı/referans görselli akışlar (fal.ai, Veo, ve productId VERİLEN
// Omni çağrıları) eski validasyonu AYNEN korumalı — bu istisna yalnızca
// "Omni + productId yok" kombinasyonuna özgü.
test("reels handler: Veo (ürün tabanlı akış) productId olmadan hâlâ eski validasyonla reddedilir — istisna Omni'ye özgü, Veo'ya sızmıyor", async () => {
  await withMockedFetch(
    () => { throw new Error("Veo'ya hiç istek atılmamalıydı — ürün doğrulaması önce başarısız olmalı"); },
    async () => {
      // productId boş → resolveProduct(Airtable'da "" id'li kayıt bulamaz) → null.
      const req = makeRequest({ provider: "veo", productId: "", finalizedPrompt: "p", promptId: hashVideoPrompt("p") });
      const res = makeResponse();
      await handler(req, res);
      assert.equal(res.statusCode, 400);
      assert.match(res.payload.error, /Ürün URL bilgisi eksik/);
    }
  );
});

test("reels handler: Omni + productId VERİLDİYSE (ürün tabanlı Omni akışı) eski validasyon aynen çalışır — ürün bulunamazsa 400 döner", async () => {
  await withMockedFetch(
    () => { throw new Error("Omni'ye hiç istek atılmamalıydı — ürün doğrulaması önce başarısız olmalı"); },
    async () => {
      const req = makeRequest({ provider: "omni", productId: "recBogusDoesNotExist", finalizedPrompt: "p", promptId: hashVideoPrompt("p") });
      const res = makeResponse();
      await handler(req, res);
      assert.equal(res.statusCode, 400);
      assert.match(res.payload.error, /Ürün URL bilgisi eksik/);
    }
  );
});

test("reels handler: Omni + productId VERİLDİYSE referenceImageUrl olarak ürün görseli kullanılır (image-to-video referansı korunuyor)", async () => {
  const originalFetch = global.fetch;
  let capturedBody = null;
  global.fetch = async (url, options) => {
    const href = String(url);
    if (href.includes("api.airtable.com")) return { ok: true, json: async () => ({ records: [PRODUCT_RECORD] }) };
    if (href === "https://example.com/p.jpg") return { ok: true, headers: { get: () => "image/jpeg" }, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
    if (href.includes("/upload/v1beta/files") && options?.headers?.["X-Goog-Upload-Command"] === "start") return { ok: true, headers: { get: (name) => (name === "x-goog-upload-url" ? "https://example.com/upload-session" : null) } };
    if (href === "https://example.com/upload-session") return { ok: true, json: async () => ({ file: { uri: "https://example.com/files/img1", name: "files/img1", mimeType: "image/jpeg" } }) };
    if (href.includes("/v1beta/files/img1")) return { ok: true, json: async () => ({ name: "files/img1", uri: "https://example.com/files/img1", mimeType: "image/jpeg", state: "ACTIVE" }) };
    if (href === OMNI_INTERACTIONS_URL) { capturedBody = JSON.parse(options.body); return { ok: true, json: async () => ({ id: "v1_withproduct", steps: [] }) }; }
    throw new Error(`Beklenmeyen fetch: ${href}`);
  };
  try {
    const prompt = "p";
    const req = makeRequest({ provider: "omni", productId: PRODUCT_ID, finalizedPrompt: prompt, promptId: hashVideoPrompt(prompt) });
    const res = makeResponse();
    await handler(req, res);
    assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
    assert.deepEqual(capturedBody.input.map((p) => p.type), ["image", "text"]);
  } finally {
    global.fetch = originalFetch;
  }
});

// Nano Banana 2 (veya başka bir dış kaynaktan) üretilip "Bu görseli kullan"
// ile seçilmiş bir sceneImageUrl varsa, Veo için artık productId ZORUNLU
// DEĞİLDİR — bkz. api/reels.js:skipProductForExternalScene. Önceki hâlde bu
// akış, hiçbir ağ isteği atılmadan "Ürün bulunamadı."/"Ürün URL bilgisi
// eksik." ile 400/500 dönüyordu.
const NANO_BANANA_SCENE_URL = "https://blob.example.com/nano-banana-scene.png";

function withMockedFetchNoProduct(veoResponder, run) {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, options) => {
    const urlStr = String(url);
    calls.push({ url: urlStr, options });
    if (urlStr.includes("api.airtable.com")) throw new Error("Airtable'a hiç dokunulmamalıydı (ürün yok, sceneImageUrl var)");
    if (urlStr === NANO_BANANA_SCENE_URL) return { ok: true, headers: { get: () => "image/png" }, arrayBuffer: async () => new Uint8Array([9, 9, 9]).buffer };
    return veoResponder(urlStr, options);
  };
  return run(calls).finally(() => { global.fetch = originalFetch; });
}

test("reels handler: Veo + seçilmiş Nano Banana sceneImageUrl + productId YOK → istek gönderilir, Ürün seçin/bulunamadı hatası vermez", async () => {
  await withMockedFetchNoProduct(
    () => ({ ok: true, json: async () => ({ name: "operations/nano-banana" }) }),
    async (calls) => {
      const prompt = "REFERENCE:\ntest\n\nMOTION:\ntest";
      const req = makeRequest({ provider: "veo", productId: undefined, sceneImageUrl: NANO_BANANA_SCENE_URL, finalizedPrompt: prompt, promptId: hashVideoPrompt(prompt), model: "economy" });
      const res = makeResponse();
      await handler(req, res);
      assert.equal(res.statusCode, 200);
      assert.equal(res.payload.ok, true);
      assert.ok(res.payload.veo);
      // imageUrl olarak birebir seçilen Nano Banana sahnesi kullanıldı —
      // ürünün (olmayan) kayıtlı görseline asla düşülmedi.
      assert.equal(res.payload.veo.imageUrl, NANO_BANANA_SCENE_URL);
      assert.ok(calls.some((c) => c.url === NANO_BANANA_SCENE_URL));
    }
  );
});

test("reels handler: Veo + seçilmiş Nano Banana sceneImageUrl akışında image-to-video referansı gerçekten seçilen sceneImageUrl'den indirilir", async () => {
  await withMockedFetchNoProduct(
    () => ({ ok: true, json: async () => ({ name: "operations/nano-banana" }) }),
    async (calls) => {
      const prompt = "REFERENCE:\ntest\n\nMOTION:\ntest";
      const req = makeRequest({ provider: "veo", sceneImageUrl: NANO_BANANA_SCENE_URL, finalizedPrompt: prompt, promptId: hashVideoPrompt(prompt) });
      const res = makeResponse();
      await handler(req, res);
      assert.equal(res.statusCode, 200);
      const imageDownloadCall = calls.find((c) => c.url === NANO_BANANA_SCENE_URL);
      assert.ok(imageDownloadCall, "sceneImageUrl indirilmedi");
      const predictCall = calls.find((c) => c.url.includes("predictLongRunning"));
      assert.ok(predictCall);
    }
  );
});

test("reels handler: action:'preview', provider:'veo', sceneImageUrl var + productId YOK → Ürün bulunamadı hatası vermeden bir prompt önizlemesi döner", async () => {
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    if (String(url).includes("api.airtable.com")) throw new Error("Airtable'a hiç dokunulmamalıydı");
    throw new Error(`Beklenmeyen fetch: ${url}`);
  };
  try {
    const req = makeRequest({ action: "preview", provider: "veo", sceneImageUrl: NANO_BANANA_SCENE_URL, motion: "kamera yavaşça yaklaşsın" });
    const res = makeResponse();
    await handler(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.ok, true);
    assert.ok(res.payload.preview.promptId);
  } finally {
    global.fetch = originalFetch;
  }
});

test("reels handler: sceneImageUrl YOK ve productId de YOK ise Veo hâlâ eski validasyonla reddedilir (regresyon yok)", async () => {
  await withMockedFetchNoProduct(
    () => { throw new Error("Veo'ya hiç istek atılmamalıydı"); },
    async (calls) => {
      const prompt = "REFERENCE:\ntest\n\nMOTION:\ntest";
      const req = makeRequest({ provider: "veo", finalizedPrompt: prompt, promptId: hashVideoPrompt(prompt) });
      const res = makeResponse();
      global.fetch = async (url) => {
        // Bu testte Airtable'a dokunulması BEKLENİR (productId yok ama
        // resolveProduct(undefined) yine de çağrılır, kayıt bulunamaz).
        if (String(url).includes("api.airtable.com")) return { ok: true, json: async () => ({ records: [] }) };
        throw new Error(`Beklenmeyen fetch: ${url}`);
      };
      await handler(req, res);
      assert.equal(res.statusCode, 400);
      assert.match(res.payload.error, /Ürün URL bilgisi eksik/);
    }
  );
});

test("reels handler: prompt hash doğrulaması model parametresinden etkilenmiyor — model değişse de aynı prompt/promptId kabul edilir", async () => {
  await withMockedFetch(
    () => ({ ok: true, json: async () => ({ name: "operations/test" }) }),
    async () => {
      const prompt = "REFERENCE:\nsame\n\nMOTION:\nsame";
      const promptId = hashVideoPrompt(prompt);
      for (const model of ["economy", "fast", "quality"]) {
        const req = makeRequest({ provider: "veo", productId: PRODUCT_ID, finalizedPrompt: prompt, promptId, model });
        const res = makeResponse();
        await handler(req, res);
        assert.equal(res.statusCode, 200, `model=${model} için beklenmedik durum: ${JSON.stringify(res.payload)}`);
      }
    }
  );
});
