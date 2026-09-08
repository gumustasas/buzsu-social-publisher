import test from "node:test";
import assert from "node:assert/strict";
import { assertPublicHttpsUrl, fetchPublicImage, decodeImageBase64, imageExtensionFor, isPrivateIp, extractDriveFileId, normalizeDriveUrl } from "../src/lib/upload-media.js";

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
