import test from "node:test";
import assert from "node:assert/strict";
import { assertPublicHttpsUrl, fetchPublicImage, decodeImageBase64, imageExtensionFor, isPrivateIp } from "../src/lib/upload-media.js";

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

test("assertPublicHttpsUrl rejects a plain HTTP URL", async () => {
  await assert.rejects(() => assertPublicHttpsUrl("http://example.com/photo.png"), /HTTPS/);
});

test("assertPublicHttpsUrl rejects localhost and IP-literal private hosts", async () => {
  await assert.rejects(() => assertPublicHttpsUrl("https://localhost/photo.png"), /engellendi/);
  await assert.rejects(() => assertPublicHttpsUrl("https://127.0.0.1/photo.png"), /engellendi/);
  await assert.rejects(() => assertPublicHttpsUrl("https://169.254.169.254/latest/meta-data/"), /engellendi/);
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
