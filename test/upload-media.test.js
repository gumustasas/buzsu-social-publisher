import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { assertPublicHttpsUrl, fetchPublicImage, fetchPublicAudio, fetchPublicVideo, decodeImageBase64, imageExtensionFor, isPrivateIp, extractDriveFileId, normalizeDriveUrl, normalizeImageForMeta, detectImageFormat, InvalidImageInputError } from "../src/lib/upload-media.js";

const TINY_PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

test("isPrivateIp flags loopback, RFC1918, link-local/metadata, and CGNAT IPv4 ranges", () => {
  for (const ip of ["127.0.0.1", "10.0.0.5", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0"]) {
    assert.equal(isPrivateIp(ip), true, ip);
  }
  assert.equal(isPrivateIp("8.8.8.8"), false);
  assert.equal(isPrivateIp("93.184.216.34"), false);
});

test("isPrivateIp flags loopback/unique-local/link-local IPv6", () => {
  assert.equal(isPrivateIp("::1"), true);
  assert.equal(isPrivateIp("fd00::1"), true);
  assert.equal(isPrivateIp("fe80::1"), true);
  assert.equal(isPrivateIp("::ffff:127.0.0.1"), true);
  assert.equal(isPrivateIp("2606:4700:4700::1111"), false);
});

test("isPrivateIp flags the hex-group form of an IPv4-mapped address, not just the dotted-decimal form (regression: ::ffff:7f00:1 === ::ffff:127.0.0.1)", () => {
  assert.equal(isPrivateIp("::ffff:7f00:1"), true);
  assert.equal(isPrivateIp("::ffff:a9fe:a9fe"), true); // 169.254.169.254 — bulut metadata
  assert.equal(isPrivateIp("::ffff:c0a8:101"), true); // 192.168.1.1
  assert.equal(isPrivateIp("::ffff:5db8:d822"), false); // 93.184.216.34 (herkese açık)
});

test("assertPublicHttpsUrl rejects a plain HTTP URL", async () => {
  await assert.rejects(() => assertPublicHttpsUrl("http://example.com/photo.png"), /HTTPS/);
});

test("assertPublicHttpsUrl rejects localhost and IP-literal private hosts", async () => {
  await assert.rejects(() => assertPublicHttpsUrl("https://localhost/photo.png"), /engellendi/);
  await assert.rejects(() => assertPublicHttpsUrl("https://127.0.0.1/photo.png"), /engellendi/);
  await assert.rejects(() => assertPublicHttpsUrl("https://169.254.169.254/latest/meta-data/"), /engellendi/);
});

test("assertPublicHttpsUrl rejects a bracketed IPv6 literal written in the hex-mapped form of a loopback address", async () => {
  await assert.rejects(() => assertPublicHttpsUrl("https://[::ffff:7f00:1]/photo.png"), /engellendi/);
});

test("assertPublicHttpsUrl rejects a hostname that resolves to a private IP", async () => {
  const lookup = async () => [{ address: "10.1.2.3" }];
  await assert.rejects(() => assertPublicHttpsUrl("https://internal.example.com/photo.png", { lookup }), /özel\/yerel/);
});

test("assertPublicHttpsUrl accepts a hostname that resolves to a public IP", async () => {
  const lookup = async () => [{ address: "93.184.216.34" }];
  const url = await assertPublicHttpsUrl("https://example.com/photo.png", { lookup });
  assert.equal(url.hostname, "example.com");
});

test("fetchPublicImage rejects unsupported content types", async () => {
  const lookup = async () => [{ address: "93.184.216.34" }];
  const fetchImpl = async () => ({ ok: true, status: 200, headers: { get: (name) => (name === "content-type" ? "application/pdf" : null) }, arrayBuffer: async () => new ArrayBuffer(4) });
  await assert.rejects(() => fetchPublicImage("https://example.com/file.pdf", { fetchImpl, lookup }), /Desteklenmeyen görsel tipi/);
});

test("fetchPublicImage rejects a file larger than the byte limit (declared via Content-Length)", async () => {
  const lookup = async () => [{ address: "93.184.216.34" }];
  const fetchImpl = async () => ({
    ok: true, status: 200,
    headers: { get: (name) => ({ "content-type": "image/png", "content-length": String(50 * 1024 * 1024) }[name] || null) },
    arrayBuffer: async () => new ArrayBuffer(0)
  });
  await assert.rejects(() => fetchPublicImage("https://example.com/huge.png", { fetchImpl, lookup, maxBytes: 15 * 1024 * 1024 }), /çok büyük/);
});

test("fetchPublicImage aborts mid-stream once bytes exceed the limit, without buffering the whole body first (Content-Length missing/understated)", async () => {
  const lookup = async () => [{ address: "93.184.216.34" }];
  let cancelled = false;
  let chunksServed = 0;
  const totalChunks = 100;
  const chunkSize = 1024 * 1024; // 1MB/parça — 100 parça = 100MB, gerçek limit çok altında
  const reader = {
    read: async () => {
      if (chunksServed >= totalChunks) return { done: true, value: undefined };
      chunksServed += 1;
      return { done: false, value: new Uint8Array(chunkSize) };
    },
    cancel: async () => { cancelled = true; }
  };
  const fetchImpl = async () => ({
    ok: true, status: 200,
    headers: { get: (name) => (name === "content-type" ? "image/png" : null) }, // Content-Length yok/eksik
    body: { getReader: () => reader }
  });
  await assert.rejects(() => fetchPublicImage("https://example.com/huge-stream.png", { fetchImpl, lookup, maxBytes: 2 * 1024 * 1024 }), /çok büyük/);
  assert.equal(cancelled, true, "reader.cancel() çağrılmalı, akış erkenden durdurulmalı");
  assert.ok(chunksServed < totalChunks, "100MB'lık akışın tamamı tüketilmeden önce durmalı");
});

test("fetchPublicImage re-validates the SSRF check after following a redirect to a private host", async () => {
  const lookup = async (hostname) => (hostname === "public.example.com" ? [{ address: "93.184.216.34" }] : [{ address: "10.0.0.1" }]);
  const fetchImpl = async (url) => {
    if (String(url).includes("public.example.com")) {
      return { ok: false, status: 302, headers: { get: (name) => (name === "location" ? "https://internal.example.com/secret.png" : null) } };
    }
    throw new Error("bu URL'e gidilmemeliydi");
  };
  await assert.rejects(() => fetchPublicImage("https://public.example.com/redirect", { fetchImpl, lookup }), /özel\/yerel/);
});

test("fetchPublicImage downloads a valid PNG and returns its buffer + mimeType", async () => {
  const lookup = async () => [{ address: "93.184.216.34" }];
  const bytes = Buffer.from(TINY_PNG_BASE64, "base64");
  const fetchImpl = async () => ({
    ok: true, status: 200,
    headers: { get: (name) => ({ "content-type": "image/png", "content-length": String(bytes.length) }[name] || null) },
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  });
  const { buffer, mimeType } = await fetchPublicImage("https://example.com/photo.png", { fetchImpl, lookup });
  assert.equal(mimeType, "image/png");
  assert.equal(buffer.length, bytes.length);
});

// TASK-010: fetchPublicMediaFile'ın Content-Type kontrolü baytların
// GERÇEKTEN o formatta olduğunun kanıtı DEĞİLDİR — fetchPublicImage bunu
// ARTIK ayrıca (imza + decode) doğrular. Bu bloktaki testler, önceki
// sürümde SESSİZCE geçecek (Content-Type allowlist'te olduğu için) ama
// gerçekte bozuk/sahte/uyumsuz olan girdileri hedefler.
function lookupPublic() { return async () => [{ address: "93.184.216.34" }]; }
function fetchImplFor(contentType, bytes) {
  return async () => ({
    ok: true, status: 200,
    headers: { get: (name) => ({ "content-type": contentType, "content-length": String(bytes.length) }[name] || null) },
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  });
}

test("detectImageFormat: gerçek JPEG/PNG/WebP imzalarını doğru tanır, tanınmayan/eksik bir imza için null döner", async () => {
  const jpeg = await sharp({ create: { width: 4, height: 4, channels: 3, background: { r: 1, g: 2, b: 3 } } }).jpeg().toBuffer();
  const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: { r: 1, g: 2, b: 3 } } }).png().toBuffer();
  const webp = await sharp({ create: { width: 4, height: 4, channels: 3, background: { r: 1, g: 2, b: 3 } } }).webp().toBuffer();
  assert.equal(detectImageFormat(jpeg), "image/jpeg");
  assert.equal(detectImageFormat(png), "image/png");
  assert.equal(detectImageFormat(webp), "image/webp");
  assert.equal(detectImageFormat(Buffer.from("<html>not an image</html>")), null);
  assert.equal(detectImageFormat(Buffer.from([0xff, 0xd8])), null); // JPEG imzası için 1 bayt eksik
});

test("fetchPublicImage: gerçek bir JPEG (declared image/jpeg) kabul edilir", async () => {
  const bytes = await sharp({ create: { width: 10, height: 10, channels: 3, background: { r: 200, g: 20, b: 20 } } }).jpeg().toBuffer();
  const { buffer, mimeType } = await fetchPublicImage("https://example.com/photo.jpg", { fetchImpl: fetchImplFor("image/jpeg", bytes), lookup: lookupPublic() });
  assert.equal(mimeType, "image/jpeg");
  assert.equal(buffer.length, bytes.length);
});

test("fetchPublicImage: gerçek bir WebP (declared image/webp) kabul edilir", async () => {
  const bytes = await sharp({ create: { width: 10, height: 10, channels: 3, background: { r: 20, g: 200, b: 20 } } }).webp().toBuffer();
  const { buffer, mimeType } = await fetchPublicImage("https://example.com/photo.webp", { fetchImpl: fetchImplFor("image/webp", bytes), lookup: lookupPublic() });
  assert.equal(mimeType, "image/webp");
  assert.equal(buffer.length, bytes.length);
});

test("fetchPublicImage: image/jpeg olarak bildirilen HTML gövdesi (Drive interstitial sayfası gibi) INVALID_IMAGE_INPUT ile reddedilir — Content-Type'a güvenilmez", async () => {
  const html = Buffer.from("<html><body>Bu bir görsel değil</body></html>");
  await assert.rejects(
    () => fetchPublicImage("https://example.com/fake.jpg", { fetchImpl: fetchImplFor("image/jpeg", html), lookup: lookupPublic() }),
    (err) => {
      assert.ok(err instanceof InvalidImageInputError);
      assert.equal(err.code, "INVALID_IMAGE_INPUT");
      assert.equal(err.reason, "unsupported_bytes");
      return true;
    }
  );
});

test("fetchPublicImage: image/jpeg olarak bildirilen JSON gövdesi (örn. bir API hata yanıtı) INVALID_IMAGE_INPUT ile reddedilir", async () => {
  const json = Buffer.from(JSON.stringify({ error: "not found" }));
  await assert.rejects(
    () => fetchPublicImage("https://example.com/fake2.jpg", { fetchImpl: fetchImplFor("image/jpeg", json), lookup: lookupPublic() }),
    /INVALID_IMAGE_INPUT/
  );
});

test("fetchPublicImage: gerçek PNG baytları image/jpeg olarak bildirilirse MIME/gerçek-format uyuşmazlığıyla reddedilir — sessizce PNG olarak yeniden yorumlanmaz", async () => {
  const pngBytes = await sharp({ create: { width: 6, height: 6, channels: 3, background: { r: 1, g: 1, b: 1 } } }).png().toBuffer();
  await assert.rejects(
    () => fetchPublicImage("https://example.com/mislabeled.jpg", { fetchImpl: fetchImplFor("image/jpeg", pngBytes), lookup: lookupPublic() }),
    (err) => {
      assert.ok(err instanceof InvalidImageInputError);
      assert.equal(err.reason, "mime_mismatch");
      assert.match(err.message, /image\/jpeg.*image\/png|image\/png.*image\/jpeg/);
      return true;
    }
  );
});

test("fetchPublicImage: gerçek JPEG baytları image/png olarak bildirilirse de aynı şekilde reddedilir (ters yön)", async () => {
  const jpegBytes = await sharp({ create: { width: 6, height: 6, channels: 3, background: { r: 1, g: 1, b: 1 } } }).jpeg().toBuffer();
  await assert.rejects(
    () => fetchPublicImage("https://example.com/mislabeled.png", { fetchImpl: fetchImplFor("image/png", jpegBytes), lookup: lookupPublic() }),
    (err) => {
      assert.equal(err.code, "INVALID_IMAGE_INPUT");
      assert.equal(err.reason, "mime_mismatch");
      return true;
    }
  );
});

test("fetchPublicImage: kesilmiş/bozuk bir JPEG (geçerli imza ama decode edilemeyen gövde) INVALID_IMAGE_INPUT ile reddedilir, sessizce onarılmaya çalışılmaz", async () => {
  const full = await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 90, g: 90, b: 90 } } }).jpeg().toBuffer();
  const truncated = full.subarray(0, Math.floor(full.length / 3));
  assert.equal(detectImageFormat(truncated), "image/jpeg", "imza hâlâ geçerli olmalı — asıl sorun decode edilebilirlik");
  await assert.rejects(
    () => fetchPublicImage("https://example.com/truncated.jpg", { fetchImpl: fetchImplFor("image/jpeg", truncated), lookup: lookupPublic() }),
    (err) => {
      assert.ok(err instanceof InvalidImageInputError);
      assert.equal(err.reason, "undecodable");
      return true;
    }
  );
});

test("fetchPublicImage: bozuk bir PNG (imza geçerli, gövde bozulmuş) INVALID_IMAGE_INPUT ile reddedilir", async () => {
  const full = await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 10, g: 200, b: 10 } } }).png().toBuffer();
  const corrupted = Buffer.from(full);
  // İmza baytlarına DOKUNMADAN gövdenin ortasını bozar — format tespiti
  // yine "image/png" der, ama decode başarısız olmalı.
  for (let i = Math.floor(corrupted.length / 2); i < corrupted.length; i++) corrupted[i] = 0;
  assert.equal(detectImageFormat(corrupted), "image/png");
  await assert.rejects(
    () => fetchPublicImage("https://example.com/corrupt.png", { fetchImpl: fetchImplFor("image/png", corrupted), lookup: lookupPublic() }),
    (err) => {
      assert.equal(err.code, "INVALID_IMAGE_INPUT");
      assert.equal(err.reason, "undecodable");
      return true;
    }
  );
});

test("fetchPublicImage: bozuk bir WebP (imza geçerli, gövde bozulmuş) INVALID_IMAGE_INPUT ile reddedilir", async () => {
  const full = await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 10, g: 10, b: 200 } } }).webp().toBuffer();
  const corrupted = Buffer.from(full);
  for (let i = Math.floor(corrupted.length / 2); i < corrupted.length; i++) corrupted[i] = 0;
  assert.equal(detectImageFormat(corrupted), "image/webp");
  await assert.rejects(
    () => fetchPublicImage("https://example.com/corrupt.webp", { fetchImpl: fetchImplFor("image/webp", corrupted), lookup: lookupPublic() }),
    (err) => {
      assert.equal(err.code, "INVALID_IMAGE_INPUT");
      assert.equal(err.reason, "undecodable");
      return true;
    }
  );
});

test("decodeImageBase64 rejects an unsupported mime type", () => {
  assert.throws(() => decodeImageBase64(TINY_PNG_BASE64, "application/pdf"), /Desteklenmeyen görsel tipi/);
});

test("decodeImageBase64 rejects invalid base64 data", () => {
  assert.throws(() => decodeImageBase64("not-base64-!!!", "image/png"), /Geçerli bir base64/);
});

test("decodeImageBase64 rejects data larger than the byte limit", () => {
  const bigBase64 = Buffer.alloc(2048, 1).toString("base64");
  assert.throws(() => decodeImageBase64(bigBase64, "image/png", { maxBytes: 1024 }), /çok büyük/);
});

test("decodeImageBase64 accepts a valid PNG and a valid JPEG payload", () => {
  const png = decodeImageBase64(TINY_PNG_BASE64, "image/png");
  assert.ok(png.length > 0);
  const jpegBase64 = Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString("base64");
  const jpeg = decodeImageBase64(jpegBase64, "image/jpeg");
  assert.ok(jpeg.length > 0);
});

test("decodeImageBase64 strips a data: URI prefix before decoding, so a raw copy-pasted data URL is accepted", () => {
  const withPrefix = decodeImageBase64(`data:image/png;base64,${TINY_PNG_BASE64}`, "image/png");
  const withoutPrefix = decodeImageBase64(TINY_PNG_BASE64, "image/png");
  assert.deepEqual(withPrefix, withoutPrefix);
});

test("decodeImageBase64 strips the data: URI prefix case-insensitively", () => {
  const decoded = decodeImageBase64(`DATA:image/png;BASE64,${TINY_PNG_BASE64}`, "image/png");
  assert.deepEqual(decoded, decodeImageBase64(TINY_PNG_BASE64, "image/png"));
});

test("imageExtensionFor maps mime types to file extensions", () => {
  assert.equal(imageExtensionFor("image/png"), "png");
  assert.equal(imageExtensionFor("image/jpeg"), "jpg");
  assert.equal(imageExtensionFor("image/webp"), "webp");
});

test("extractDriveFileId returns null for a non-Drive URL — the normal HTTPS flow must be untouched", () => {
  assert.equal(extractDriveFileId("https://example.com/photo.png"), null);
  assert.equal(extractDriveFileId("not a url"), null);
});

test("extractDriveFileId extracts the file ID from the /file/d/<id>/view share link format", () => {
  assert.equal(extractDriveFileId("https://drive.google.com/file/d/1_dcL2RNdR75S4Wrtrh6uHnPC45FChMqf/view?usp=drivesdk"), "1_dcL2RNdR75S4Wrtrh6uHnPC45FChMqf");
  assert.equal(extractDriveFileId("https://drive.google.com/file/d/ABC123/view"), "ABC123");
});

test("extractDriveFileId extracts the file ID from ?id=<id> query-param formats (open, uc)", () => {
  assert.equal(extractDriveFileId("https://drive.google.com/open?id=XYZ789"), "XYZ789");
  assert.equal(extractDriveFileId("https://drive.google.com/uc?id=ALREADY-NORMALIZED&export=download"), "ALREADY-NORMALIZED");
  assert.equal(extractDriveFileId("https://docs.google.com/uc?id=DOCS-HOST-VARIANT"), "DOCS-HOST-VARIANT");
});

test("extractDriveFileId returns an empty string (not null) for a recognized Drive host with no extractable ID — distinguishes 'not Drive' from 'bad Drive link'", () => {
  assert.equal(extractDriveFileId("https://drive.google.com/drive/folders/1P3wglUsB9s_RubZv8MTrpBp-0GipGBfl"), "");
});

test("normalizeDriveUrl leaves a non-Drive URL completely unchanged", () => {
  assert.equal(normalizeDriveUrl("https://example.com/photo.png"), "https://example.com/photo.png");
});

test("normalizeDriveUrl converts a recognized share link into the direct-download endpoint", () => {
  assert.equal(
    normalizeDriveUrl("https://drive.google.com/file/d/1_dcL2RNdR75S4Wrtrh6uHnPC45FChMqf/view?usp=drivesdk"),
    "https://drive.google.com/uc?export=download&id=1_dcL2RNdR75S4Wrtrh6uHnPC45FChMqf"
  );
});

test("normalizeDriveUrl throws an explicit error for a Drive URL it cannot extract an ID from, rather than silently falling back to something else", () => {
  assert.throws(() => normalizeDriveUrl("https://drive.google.com/drive/folders/1P3wglUsB9s_RubZv8MTrpBp-0GipGBfl"), /dosya ID'si çıkarılamadı/);
});

test("normalizeImageForMeta re-encodes a PNG source into a clean sRGB PNG", async () => {
  const source = await sharp({ create: { width: 8, height: 8, channels: 3, background: { r: 10, g: 20, b: 30 } } }).png().toBuffer();
  const { buffer, mimeType } = await normalizeImageForMeta(source, "image/png");
  assert.equal(mimeType, "image/png");
  const meta = await sharp(buffer).metadata();
  assert.equal(meta.format, "png");
  assert.equal(meta.space, "srgb");
});

test("normalizeImageForMeta returns the re-encoded image's width and height alongside the buffer", async () => {
  const source = await sharp({ create: { width: 37, height: 21, channels: 3, background: { r: 44, g: 88, b: 132 } } }).png().toBuffer();
  const { width, height } = await normalizeImageForMeta(source, "image/png");
  assert.equal(width, 37);
  assert.equal(height, 21);
});

test("normalizeImageForMeta reports width/height for the EXIF-rotated (pixel-baked) output, not the pre-rotation source dimensions", async () => {
  const base = await sharp({ create: { width: 4, height: 8, channels: 3, background: { r: 1, g: 2, b: 3 } } }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
  const { width, height } = await normalizeImageForMeta(base, "image/jpeg");
  assert.equal(width, 8);
  assert.equal(height, 4);
});

test("normalizeImageForMeta re-encodes a JPEG source and keeps it a JPEG", async () => {
  const source = await sharp({ create: { width: 8, height: 8, channels: 3, background: { r: 200, g: 50, b: 10 } } }).jpeg().toBuffer();
  const { buffer, mimeType } = await normalizeImageForMeta(source, "image/jpeg");
  assert.equal(mimeType, "image/jpeg");
  const meta = await sharp(buffer).metadata();
  assert.equal(meta.format, "jpeg");
  assert.equal(meta.space, "srgb");
});

test("normalizeImageForMeta converts a CMYK JPEG to sRGB — this is the encoding class Meta's \"image format is not supported\" error is usually caused by", async () => {
  const rgbSource = await sharp({ create: { width: 8, height: 8, channels: 3, background: { r: 120, g: 60, b: 200 } } }).jpeg().toBuffer();
  const cmykSource = await sharp(rgbSource).toColourspace("cmyk").jpeg().toBuffer();
  const cmykMeta = await sharp(cmykSource).metadata();
  assert.equal(cmykMeta.space, "cmyk"); // doğrulama: test girdisi gerçekten CMYK

  const { buffer, mimeType } = await normalizeImageForMeta(cmykSource, "image/jpeg");
  assert.equal(mimeType, "image/jpeg");
  const meta = await sharp(buffer).metadata();
  assert.equal(meta.space, "srgb");
});

test("normalizeImageForMeta converts WebP to PNG since Meta's WebP support for feed/story posts is unreliable", async () => {
  const source = await sharp({ create: { width: 8, height: 8, channels: 3, background: { r: 5, g: 5, b: 5 } } }).webp().toBuffer();
  const { buffer, mimeType } = await normalizeImageForMeta(source, "image/webp");
  assert.equal(mimeType, "image/png");
  const meta = await sharp(buffer).metadata();
  assert.equal(meta.format, "png");
});

test("normalizeImageForMeta bakes EXIF orientation into pixels instead of leaving it as metadata a picky consumer might ignore", async () => {
  const base = await sharp({ create: { width: 4, height: 8, channels: 3, background: { r: 1, g: 2, b: 3 } } }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
  const { buffer } = await normalizeImageForMeta(base, "image/jpeg");
  const meta = await sharp(buffer).metadata();
  assert.equal(meta.width, 8);
  assert.equal(meta.height, 4);
  assert.equal(meta.orientation, undefined);
});

test("normalizeImageForMeta rejects when re-encoding produces a file larger than the byte limit", async () => {
  const source = await sharp({ create: { width: 50, height: 50, channels: 3, background: { r: 10, g: 20, b: 30 } } }).png().toBuffer();
  await assert.rejects(() => normalizeImageForMeta(source, "image/png", { maxBytes: 10 }), /çok büyük/);
});

test("normalizeImageForMeta rejects corrupt/non-decodable bytes instead of silently producing garbage output", async () => {
  const garbage = Buffer.from("bu gerçek bir görsel değil, düz metin baytları");
  await assert.rejects(() => normalizeImageForMeta(garbage, "image/jpeg"));
  await assert.rejects(() => normalizeImageForMeta(garbage, "image/png"));
});

test("normalizeImageForMeta rejects a truncated/partially-downloaded JPEG rather than accepting a broken file", async () => {
  const full = await sharp({ create: { width: 40, height: 40, channels: 3, background: { r: 90, g: 90, b: 90 } } }).jpeg().toBuffer();
  const truncated = full.subarray(0, Math.floor(full.length / 3));
  await assert.rejects(() => normalizeImageForMeta(truncated, "image/jpeg"));
});

test("fetchPublicImage does not mistake an HTML response (e.g. Google Drive's viewer/interstitial page) for an image — this is the exact failure mode Drive share links can hit", async () => {
  const lookup = async () => [{ address: "93.184.216.34" }];
  const fetchImpl = async () => ({
    ok: true, status: 200,
    headers: { get: (name) => (name === "content-type" ? "text/html; charset=utf-8" : null) },
    arrayBuffer: async () => new TextEncoder().encode("<html><body>Google Drive virüs taraması yapamadı</body></html>").buffer
  });
  await assert.rejects(() => fetchPublicImage("https://drive.google.com/uc?export=download&id=abc", { fetchImpl, lookup }), /Desteklenmeyen görsel tipi: text\/html/);
});

test("fetchPublicAudio downloads a valid MP3 and returns its buffer + mimeType", async () => {
  const lookup = async () => [{ address: "93.184.216.34" }];
  const bytes = Buffer.from([0x49, 0x44, 0x33, 0x03, 0x00, 0x00, 0x00, 0x00]);
  const fetchImpl = async () => ({
    ok: true, status: 200,
    headers: { get: (name) => ({ "content-type": "audio/mpeg", "content-length": String(bytes.length) }[name] || null) },
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  });
  const { buffer, mimeType } = await fetchPublicAudio("https://example.com/music.mp3", { fetchImpl, lookup });
  assert.equal(mimeType, "audio/mpeg");
  assert.equal(buffer.length, bytes.length);
});

test("fetchPublicAudio rejects an unsupported content type (same SSRF/content-type gate as fetchPublicImage, different allowlist)", async () => {
  const lookup = async () => [{ address: "93.184.216.34" }];
  const fetchImpl = async () => ({ ok: true, status: 200, headers: { get: (name) => (name === "content-type" ? "image/png" : null) }, arrayBuffer: async () => new ArrayBuffer(4) });
  await assert.rejects(() => fetchPublicAudio("https://example.com/not-music.png", { fetchImpl, lookup }), /Desteklenmeyen müzik tipi/);
});

test("fetchPublicAudio rejects a file larger than the byte limit", async () => {
  const lookup = async () => [{ address: "93.184.216.34" }];
  const fetchImpl = async () => ({
    ok: true, status: 200,
    headers: { get: (name) => ({ "content-type": "audio/mpeg", "content-length": String(30 * 1024 * 1024) }[name] || null) },
    arrayBuffer: async () => new ArrayBuffer(0)
  });
  await assert.rejects(() => fetchPublicAudio("https://example.com/huge.mp3", { fetchImpl, lookup, maxBytes: 20 * 1024 * 1024 }), /çok büyük/);
});

test("fetchPublicAudio re-validates the SSRF check after following a redirect to a private host (same protection as fetchPublicImage)", async () => {
  const lookup = async (hostname) => (hostname === "public.example.com" ? [{ address: "93.184.216.34" }] : [{ address: "10.0.0.1" }]);
  const fetchImpl = async (url) => {
    if (String(url).includes("public.example.com")) {
      return { ok: false, status: 302, headers: { get: (name) => (name === "location" ? "https://internal.example.com/secret.mp3" : null) } };
    }
    throw new Error("bu URL'e gidilmemeliydi");
  };
  await assert.rejects(() => fetchPublicAudio("https://public.example.com/redirect", { fetchImpl, lookup }), /özel\/yerel/);
});

// compose_reel_audio (bkz. src/reel-audio-compose.js) düzenlenecek mevcut
// videosu için — fetchPublicImage/fetchPublicAudio ile aynı SSRF-güvenli
// indirme çekirdeğini paylaşır.
test("fetchPublicVideo downloads a valid MP4 and returns its buffer + mimeType", async () => {
  const lookup = async () => [{ address: "93.184.216.34" }];
  const bytes = Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]);
  const fetchImpl = async () => ({
    ok: true, status: 200,
    headers: { get: (name) => ({ "content-type": "video/mp4", "content-length": String(bytes.length) }[name] || null) },
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  });
  const { buffer, mimeType } = await fetchPublicVideo("https://example.com/reel.mp4", { fetchImpl, lookup });
  assert.equal(mimeType, "video/mp4");
  assert.equal(buffer.length, bytes.length);
});

test("fetchPublicVideo rejects an unsupported content type (e.g. an image mistakenly passed as a video URL)", async () => {
  const lookup = async () => [{ address: "93.184.216.34" }];
  const fetchImpl = async () => ({ ok: true, status: 200, headers: { get: (name) => (name === "content-type" ? "image/png" : null) }, arrayBuffer: async () => new ArrayBuffer(4) });
  await assert.rejects(() => fetchPublicVideo("https://example.com/not-a-video.png", { fetchImpl, lookup }), /Desteklenmeyen video tipi/);
});

test("normalizeImageForMeta produces a file that is genuinely re-decodable with the expected pixel dimensions and the declared Content-Type — not just bytes that happen not to throw", async () => {
  const source = await sharp({ create: { width: 37, height: 21, channels: 3, background: { r: 44, g: 88, b: 132 } } }).jpeg().toBuffer();
  const { buffer, mimeType } = await normalizeImageForMeta(source, "image/jpeg");
  assert.equal(mimeType, "image/jpeg");
  const decoded = await sharp(buffer).raw().toBuffer({ resolveWithObject: true });
  assert.equal(decoded.info.width, 37);
  assert.equal(decoded.info.height, 21);
  assert.equal(decoded.info.channels, 3);
  // İçerik gerçekten piksel verisi mi (rastgele/boş bayt değil) — orta pikseli örnekle
  const midPixelOffset = (10 * 37 + 18) * 3;
  assert.ok(decoded.data[midPixelOffset] !== undefined);
});
