import test from "node:test";
import assert from "node:assert/strict";
import { validateProductVisual, VISUAL_VALIDATION_CHECKS } from "../src/visual-validation/index.js";

function fakeFetchPublicImageImpl(buffer = Buffer.from("bytes"), mimeType = "image/png") {
  return async () => ({ buffer, mimeType });
}

test("validateProductVisual: referenceImageUrl boşsa hiçbir görsel indirmeden reddedilir", async () => {
  let called = false;
  await assert.rejects(
    () => validateProductVisual({ generatedImageUrl: "https://example.com/gen.png" }, {}, { fetchPublicImageImpl: async () => { called = true; throw new Error("çağrılmamalıydı"); } }),
    /referenceImageUrl/
  );
  assert.equal(called, false);
});

test("validateProductVisual: generatedImageUrl ve generatedImageBase64'ten hiçbiri verilmezse reddedilir", async () => {
  await assert.rejects(
    () => validateProductVisual({ referenceImageUrl: "https://example.com/ref.png" }, {}, {}),
    /generatedImageUrl.*generatedImageBase64/
  );
});

test("validateProductVisual: generatedImageUrl VE generatedImageBase64 birlikte verilirse reddedilir", async () => {
  await assert.rejects(
    () => validateProductVisual({ referenceImageUrl: "https://example.com/ref.png", generatedImageUrl: "https://example.com/gen.png", generatedImageBase64: "QQ==" }, {}, {}),
    /birlikte verilemez/
  );
});

test("validateProductVisual: generatedImageUrl ile çalışır — passed:true + boş failedChecks, checks her zaman tam liste", async () => {
  const result = await validateProductVisual(
    { referenceImageUrl: "https://example.com/ref.png", generatedImageUrl: "https://example.com/gen.png", productTitle: "UltraMag" },
    { GEMINI_API_KEY: "gkey" },
    {
      fetchPublicImageImpl: fakeFetchPublicImageImpl(),
      compareImpl: async () => ({ failedChecks: [], notes: "" })
    }
  );
  assert.equal(result.passed, true);
  assert.equal(result.needsReview, false);
  assert.deepEqual(result.checks, VISUAL_VALIDATION_CHECKS);
  assert.deepEqual(result.failedChecks, []);
});

test("validateProductVisual: generatedImageBase64 ile çalışır (decodeImageBase64Impl reuse edilir)", async () => {
  let decodedArgs;
  const result = await validateProductVisual(
    { referenceImageUrl: "https://example.com/ref.png", generatedImageBase64: "QQ==", generatedImageMimeType: "image/jpeg", productTitle: "UltraMag" },
    { GEMINI_API_KEY: "gkey" },
    {
      fetchPublicImageImpl: fakeFetchPublicImageImpl(),
      decodeImageBase64Impl: (base64, mimeType) => { decodedArgs = { base64, mimeType }; return Buffer.from("decoded"); },
      compareImpl: async ({ generatedBuffer, generatedMimeType }) => {
        assert.equal(generatedBuffer.toString(), "decoded");
        assert.equal(generatedMimeType, "image/jpeg");
        return { failedChecks: [], notes: "" };
      }
    }
  );
  assert.deepEqual(decodedArgs, { base64: "QQ==", mimeType: "image/jpeg" });
  assert.equal(result.passed, true);
});

test("validateProductVisual: en az bir kontrol başarısız olursa passed:false + needsReview:true döner, arbitrary bir skor kullanılmaz", async () => {
  const result = await validateProductVisual(
    { referenceImageUrl: "https://example.com/ref.png", generatedImageUrl: "https://example.com/gen.png" },
    { GEMINI_API_KEY: "gkey" },
    {
      fetchPublicImageImpl: fakeFetchPublicImageImpl(),
      compareImpl: async () => ({ failedChecks: ["logo", "proportions"], notes: "Logo ve oranlar farklı." })
    }
  );
  assert.equal(result.passed, false);
  assert.equal(result.needsReview, true);
  assert.deepEqual(result.failedChecks, ["logo", "proportions"]);
  assert.equal(result.notes, "Logo ve oranlar farklı.");
});

test("validateProductVisual: modelin uydurma/bilinmeyen bir kontrol kodu döndürmesi SESSİZCE eleniyor (normalizeFailedChecks reuse edilir)", async () => {
  const result = await validateProductVisual(
    { referenceImageUrl: "https://example.com/ref.png", generatedImageUrl: "https://example.com/gen.png" },
    { GEMINI_API_KEY: "gkey" },
    {
      fetchPublicImageImpl: fakeFetchPublicImageImpl(),
      compareImpl: async () => ({ failedChecks: ["identity", "made_up_check"], notes: "" })
    }
  );
  assert.deepEqual(result.failedChecks, ["identity"]);
});

test("validateProductVisual: karşılaştırma çağrısı başarısız olursa hata olduğu gibi yansır (sessizce 'geçti' denmez)", async () => {
  await assert.rejects(
    () => validateProductVisual(
      { referenceImageUrl: "https://example.com/ref.png", generatedImageUrl: "https://example.com/gen.png" },
      { GEMINI_API_KEY: "gkey" },
      { fetchPublicImageImpl: fakeFetchPublicImageImpl(), compareImpl: async () => { throw new Error("quota exceeded"); } }
    ),
    /quota exceeded/
  );
});

test("validateProductVisual: referans görseli indirilemezse (SSRF/format reddi dahil) hata olduğu gibi yansır", async () => {
  await assert.rejects(
    () => validateProductVisual(
      { referenceImageUrl: "https://example.com/ref.png", generatedImageUrl: "https://example.com/gen.png" },
      { GEMINI_API_KEY: "gkey" },
      { fetchPublicImageImpl: async () => { throw new Error("Özel/yerel IP adreslerine erişim engellendi."); } }
    ),
    /engellendi/
  );
});
