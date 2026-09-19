import test from "node:test";
import assert from "node:assert/strict";
import { downloadMediaItemImage, redactUrlForLog } from "../scripts/render-product-video.mjs";
import { InvalidImageInputError } from "../src/lib/upload-media.js";

// TASK-010: scripts/render-product-video.mjs artık import.meta.url ana-modül
// koruması (bkz. src/publish-approved.js İLE AYNI desen) ile korunuyor —
// bu dosyanın import edilmesi JOB_ID/gerçek render/process.exit'i TETİKLEMEZ.
// downloadMediaItemImage/redactUrlForLog testable, dependency-injected
// export'lardır.

test("downloadMediaItemImage: başarılı bir indirmede sadece buffer'ı döner, upscale kapalıysa upscaleImageImpl'e HİÇ gidilmez", async () => {
  const bytes = Buffer.from([1, 2, 3, 4]);
  let upscaleCalled = false;
  const buffer = await downloadMediaItemImage(
    { imageUrl: "https://example.com/photo.png" },
    0, 1,
    { upscaleImages: false, fetchPublicImageImpl: async () => ({ buffer: bytes, mimeType: "image/png" }), upscaleImageImpl: async () => { upscaleCalled = true; return "https://upscaled.example/x.png"; } }
  );
  assert.equal(buffer, bytes);
  assert.equal(upscaleCalled, false);
});

test("downloadMediaItemImage: fetchPublicImage bir INVALID_IMAGE_INPUT hatası fırlatırsa, hata mediaItems[index] bağlamıyla YENİDEN fırlatılır ve .code korunur", async () => {
  const failing = new InvalidImageInputError("INVALID_IMAGE_INPUT: Görsel decode edilemedi (bozuk veya kesilmiş olabilir).", { reason: "undecodable" });
  await assert.rejects(
    () => downloadMediaItemImage(
      { imageUrl: "https://example.com/broken.jpg" },
      2, 5,
      { fetchPublicImageImpl: async () => { throw failing; } }
    ),
    (err) => {
      assert.match(err.message, /mediaItems\[2\]/);
      assert.match(err.message, /INVALID_IMAGE_INPUT/);
      assert.equal(err.code, "INVALID_IMAGE_INPUT");
      assert.equal(err.reason, "undecodable");
      return true;
    }
  );
});

// ROOT/manifest gerekliliği: "signed URL query/hash is not leaked in
// render-worker failure context" — imzalı bir URL'in query string'i (kısa
// ömürlü ama hassas bir erişim token'ı) hata mesajına HİÇ sızmamalı.
test("downloadMediaItemImage: hata mesajı imzalı URL'in query/hash kısmını İÇERMEZ — yalnızca origin+pathname görünür", async () => {
  const signedUrl = "https://cdn.example.com/products/photo.jpg?token=SUPERSECRETSIGNEDTOKEN123&exp=999#fragment-data";
  const failing = new InvalidImageInputError("INVALID_IMAGE_INPUT: dosya imzası tanınmadı.", { reason: "unsupported_bytes" });
  await assert.rejects(
    () => downloadMediaItemImage(
      { imageUrl: signedUrl },
      0, 1,
      { fetchPublicImageImpl: async () => { throw failing; } }
    ),
    (err) => {
      assert.doesNotMatch(err.message, /SUPERSECRETSIGNEDTOKEN123/);
      assert.doesNotMatch(err.message, /token=/);
      assert.doesNotMatch(err.message, /fragment-data/);
      assert.match(err.message, /https:\/\/cdn\.example\.com\/products\/photo\.jpg/);
      return true;
    }
  );
});

test("downloadMediaItemImage: bilinen bir mediaItems indeksi, birden çok girdi içinde doğru şekilde raporlanır", async () => {
  await assert.rejects(
    () => downloadMediaItemImage(
      { imageUrl: "https://example.com/item-4.png" },
      3, 6,
      { fetchPublicImageImpl: async () => { throw new Error("boom"); } }
    ),
    /mediaItems\[3\]/
  );
});

test("downloadMediaItemImage: geçersiz görsel hatası (INVALID_IMAGE_INPUT), bir kare/FFmpeg adımı ÇALIŞMADAN önce fırlar — hiçbir buffer döndürülmez", async () => {
  let reachedAfterThrow = false;
  await assert.rejects(
    () => downloadMediaItemImage(
      { imageUrl: "https://example.com/corrupt.png" },
      0, 1,
      { fetchPublicImageImpl: async () => { throw new InvalidImageInputError("INVALID_IMAGE_INPUT: bozuk.", { reason: "undecodable" }); } }
    ).then((buffer) => { reachedAfterThrow = true; return buffer; }),
    /INVALID_IMAGE_INPUT/
  );
  assert.equal(reachedAfterThrow, false, "downloadMediaItemImage başarısız olduğunda hiçbir buffer üretilmemeli — bu, FFmpeg pipeline'ının (frames.push/buildFfmpegArgs/execFileAsync) bu mediaItem için ASLA çalışmayacağını garanti eder");
});

test("downloadMediaItemImage: upscale açıksa ve görsel eşiğin altındaysa upscaleImageImpl + ikinci fetchPublicImageImpl çağrılır", async () => {
  const rawBytes = Buffer.from([1, 2, 3]);
  const upscaledBytes = Buffer.from([9, 9, 9]);
  let upscaleArgs, secondFetchUrl;
  const buffer = await downloadMediaItemImage(
    { imageUrl: "https://example.com/small.png" },
    0, 1,
    {
      upscaleImages: true,
      fetchPublicImageImpl: async (url) => (url === "https://example.com/small.png" ? { buffer: rawBytes, mimeType: "image/png" } : (secondFetchUrl = url, { buffer: upscaledBytes, mimeType: "image/png" })),
      sharpImpl: () => ({ metadata: async () => ({ width: 100, height: 100 }) }),
      upscaleImageImpl: async (buf, mimeType) => { upscaleArgs = { buf, mimeType }; return "https://upscaled.example/big.png"; }
    }
  );
  assert.equal(upscaleArgs.buf, rawBytes);
  assert.equal(secondFetchUrl, "https://upscaled.example/big.png");
  assert.equal(buffer, upscaledBytes);
});

test("downloadMediaItemImage: upscale açık ama görsel zaten yeterli çözünürlükteyse upscaleImageImpl HİÇ çağrılmaz", async () => {
  const rawBytes = Buffer.from([1, 2, 3]);
  let upscaleCalled = false;
  const buffer = await downloadMediaItemImage(
    { imageUrl: "https://example.com/large.png" },
    0, 1,
    {
      upscaleImages: true,
      fetchPublicImageImpl: async () => ({ buffer: rawBytes, mimeType: "image/png" }),
      sharpImpl: () => ({ metadata: async () => ({ width: 2000, height: 2000 }) }),
      upscaleImageImpl: async () => { upscaleCalled = true; return "https://upscaled.example/x.png"; }
    }
  );
  assert.equal(buffer, rawBytes);
  assert.equal(upscaleCalled, false);
});

test("redactUrlForLog: origin+pathname döner, query/hash asla içermez", () => {
  assert.equal(redactUrlForLog("https://cdn.example.com/a/b.jpg?token=SECRET&x=1#frag"), "https://cdn.example.com/a/b.jpg");
  assert.equal(redactUrlForLog("not a url"), "[geçersiz URL]");
});
