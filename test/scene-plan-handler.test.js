import test from "node:test";
import assert from "node:assert/strict";
import handler from "../api/scene-plan.js";
import { setSession } from "../src/auth.js";

process.env.SESSION_SECRET = process.env.SESSION_SECRET || "test-secret-for-scene-plan-handler";
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || "test-openai-key";

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

// "Manyetik kireç önleyici" -> TECHNICAL_INSTALLATION (net/confident sınıflandırma).
// "Belirsiz Su Ürünü" gibi hiçbir kalıba uymayan bir başlık -> AMBIGUOUS.
const TECHNICAL_PRODUCT_ID = "recTechnical1";
const AMBIGUOUS_PRODUCT_ID = "recAmbiguous1";

function airtableRecords() {
  return {
    records: [
      { id: TECHNICAL_PRODUCT_ID, fields: { Başlık: "UltraMag Manyetik Kireç Önleyici", "Kaynak URL": "" } },
      { id: AMBIGUOUS_PRODUCT_ID, fields: { Başlık: "Belirsiz Genel Su Ürünü", "Kaynak URL": "" } }
    ]
  };
}

function withMockedFetch(aiResponder, run) {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, options) => {
    const urlStr = String(url);
    calls.push({ url: urlStr, options });
    if (urlStr.includes("api.airtable.com")) return { ok: true, json: async () => airtableRecords() };
    if (urlStr.includes("llms-full.txt")) return { ok: false, status: 404 };
    if (urlStr.includes("api.openai.com") || urlStr.includes("generativelanguage.googleapis.com")) return aiResponder(options);
    throw new Error(`Unexpected fetch in test: ${urlStr}`);
  };
  return run(calls).finally(() => { global.fetch = originalFetch; });
}

const aiCallCount = (calls) => calls.filter((c) => c.url.includes("api.openai.com") || c.url.includes("generativelanguage.googleapis.com")).length;

// Gerçek bir AI, prompt'ta SADECE "bunu üretme" diye YASAKLANAN kelimeleri
// (bkz. FORBIDDEN_ELEMENTS_BY_CONTEXT) kendiliğinden metne kopyalamaz — bu
// yüzden mock burada prompt'u OLDUĞU GİBİ yankılamak yerine, gerçekçi bir
// çıktı gibi yalnızca bağlam ipucunu ve kullanıcı notunu içeren temiz bir
// metin kurar. Prompt'un tamamını yankılamak (yasaklı-öğe listesi dahil)
// generateScenePlan'in kendi üretim-sonrası güvenlik taramasını her zaman
// tetikler — bu, gerçek bir AI hatasını değil, mock'un kendisini test eder.
function cleanPlanFromPrompt(options) {
  const input = JSON.parse(options.body).input;
  const hasContext = /ZORUNLU KULLANIM BAĞLAMI/.test(input);
  const noteMatch = input.match(/---KULLANICI NOTU---\n([\s\S]*?)\n---/);
  const note = noteMatch ? noteMatch[1] : "";
  const scene = hasContext ? "Ürün, bina girişinde ana su hattına monte edilmiş teknik bir alanda gösteriliyor." : "Genel bir sahne tarifi.";
  return { ok: true, json: async () => ({ output_text: `${scene} ${note}`.trim() }) };
}

test("scene-plan handler: belirsiz bağlamda (allowContextQuestion) AI'ya hiç gidilmeden kısa bir soru döner", async () => {
  await withMockedFetch(
    () => ({ ok: true, json: async () => ({ output_text: "should not be called" }) }),
    async (calls) => {
      const req = makeRequest({ productId: AMBIGUOUS_PRODUCT_ID, provider: "openai", allowContextQuestion: true });
      const res = makeResponse();
      await handler(req, res);
      assert.equal(res.statusCode, 200);
      assert.equal(res.payload.needsContextSelection, true);
      assert.ok(Array.isArray(res.payload.options) && res.payload.options.length > 0);
      assert.equal(aiCallCount(calls), 0, "belirsiz bağlamda AI çağrısı yapılmamalı");
    }
  );
});

test("scene-plan handler: kullanıcı notu montaj bağlamıyla çelişiyorsa (allowContextQuestion) AI'ya hiç gidilmeden onay istenir", async () => {
  await withMockedFetch(
    () => ({ ok: true, json: async () => ({ output_text: "should not be called" }) }),
    async (calls) => {
      const req = makeRequest({
        productId: TECHNICAL_PRODUCT_ID,
        provider: "openai",
        allowContextQuestion: true,
        userNotes: "bu ürünü evin içine koy, çamaşır odasında göster"
      });
      const res = makeResponse();
      await handler(req, res);
      assert.equal(res.statusCode, 200);
      assert.equal(res.payload.needsContextConfirmation, true);
      assert.ok(res.payload.usageContext);
      assert.equal(aiCallCount(calls), 0, "çelişki onaylanmadan AI çağrısı yapılmamalı");
    }
  );
});

test("scene-plan handler: kullanıcı çelişkiyi onaylayınca (confirmContextOverride) üretim devam eder ve notu prompt'a taşır", async () => {
  await withMockedFetch(
    cleanPlanFromPrompt,
    async (calls) => {
      // "evin içine koy" otomatik sınıflandırmayla çelişir (detectsContextConflict)
      // ama kendisi FORBIDDEN_ELEMENTS_BY_CONTEXT'te YOK — yani onay sonrası
      // üretimin gerçekten BAŞARIYLA tamamlandığını test eder (hard-forbidden
      // bir kelime içeren notların onay sonrası bile engellenmesi — kasıtlı,
      // ayrı bir davranış — src/ai-providers.test.js'te ayrıca test edilir).
      const req = makeRequest({
        productId: TECHNICAL_PRODUCT_ID,
        provider: "openai",
        allowContextQuestion: true,
        userNotes: "bu ürünü evin içine koy, sıcak bir atmosfer olsun",
        usageContextOverride: "technical_installation",
        confirmContextOverride: true
      });
      const res = makeResponse();
      await handler(req, res);
      assert.equal(res.statusCode, 200);
      assert.equal(res.payload.ok, true);
      assert.ok(res.payload.plan, "onay sonrası bir plan dönmeli");
      assert.equal(aiCallCount(calls), 1, "onay sonrası tam olarak bir AI çağrısı yapılmalı");
      // Parametre aktarımı: bağlam etiketi ve kullanıcı notu prompt'a ulaşmış olmalı.
      assert.match(res.payload.plan, /bina girişi|ana su hattı|teknik tesisat/i);
      assert.match(res.payload.plan, /evin içine koy/i);
    }
  );
});

test("scene-plan handler: net bağlamda (belirsizlik yok) hiç soru sormadan tek AI çağrısıyla üretir ve bağlamı prompt'a geçirir", async () => {
  await withMockedFetch(
    cleanPlanFromPrompt,
    async (calls) => {
      const req = makeRequest({ productId: TECHNICAL_PRODUCT_ID, provider: "openai", allowContextQuestion: true, userNotes: "3 filtre gövdesi solda, Ultramag sağda" });
      const res = makeResponse();
      await handler(req, res);
      assert.equal(res.statusCode, 200);
      assert.equal(res.payload.ok, true);
      assert.equal(aiCallCount(calls), 1);
      assert.match(res.payload.plan, /bina girişi|ana su hattı|teknik tesisat/i);
      assert.match(res.payload.plan, /3 filtre gövdesi solda, Ultramag sağda/);
    }
  );
});

// Geriye uyumluluk: allowContextQuestion GÖNDERİLMEDEN (bkz. dashboard.html
// #seo-generate-image, eski çağıran) yapılan bir istek, ürün belirsiz
// bağlamlı olsa bile HİÇBİR ZAMAN needsContextSelection/needsContextConfirmation
// döndürmemeli — eski çağıranlar bu yeni yanıt şekillerini hiç ele almıyor.
test("scene-plan handler: allowContextQuestion gönderilmeyen eski-tarz çağrılar belirsiz üründe bile soru sormadan direkt plan döner (geriye uyumluluk)", async () => {
  await withMockedFetch(
    () => ({ ok: true, json: async () => ({ output_text: "eski tarz plan metni" }) }),
    async (calls) => {
      const req = makeRequest({ productId: AMBIGUOUS_PRODUCT_ID, provider: "openai" });
      const res = makeResponse();
      await handler(req, res);
      assert.equal(res.statusCode, 200);
      assert.equal(res.payload.ok, true);
      assert.equal(res.payload.needsContextSelection, undefined);
      assert.equal(res.payload.plan, "eski tarz plan metni");
      assert.equal(aiCallCount(calls), 1);
    }
  );
});

test("scene-plan handler: yetkisiz istek 401 döner", async () => {
  const res = makeResponse();
  await handler({ method: "POST", headers: {}, body: JSON.stringify({ productId: TECHNICAL_PRODUCT_ID }) }, res);
  assert.equal(res.statusCode, 401);
});
