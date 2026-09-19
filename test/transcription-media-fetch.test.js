import test from "node:test";
import assert from "node:assert/strict";
import { fetchMediaBytes, MAX_MEDIA_BYTES, ALLOWED_TRANSCRIPTION_MIME_TYPES } from "../src/transcription/media-fetch.js";

// PR #101 ROOT review: fetchMediaBytes artık upload-media.js'in GERÇEK
// SSRF-güvenli çekirdeğini (fetchPublicMediaFile) reuse ediyor — bu testler
// o reuse'un GERÇEKTEN devrede olduğunu (private IP/redirect reddi, akış
// hâlinde boyut limiti) doğrular. Çekirdeğin kendi ayrıntılı testleri zaten
// test/upload-media.test.js'te var; burada tekrar edilmiyor.

test("fetchMediaBytes: http:// (HTTPS olmayan) reddedilir", async () => {
  await assert.rejects(() => fetchMediaBytes("http://example.com/a.mp3"), /HTTPS/);
});

test("fetchMediaBytes: localhost/IP-literal private host reddedilir", async () => {
  await assert.rejects(() => fetchMediaBytes("https://127.0.0.1/a.mp3"), /engellendi/);
});

test("fetchMediaBytes: hostname özel bir IP'ye çözümlenirse reddedilir (DNS rebinding koruması)", async () => {
  const lookup = async () => [{ address: "10.1.2.3" }];
  await assert.rejects(() => fetchMediaBytes("https://internal.example.com/a.mp3", { lookup }), /özel\/yerel/);
});

test("fetchMediaBytes: HTTPS'ten özel bir host'a yönlendiren bir URL, yönlendirme hedefi de yeniden doğrulanarak reddedilir (SSRF)", async () => {
  const lookup = async (hostname) => (hostname === "public.example.com" ? [{ address: "93.184.216.34" }] : [{ address: "10.0.0.1" }]);
  const fetchImpl = async (url) => {
    if (String(url).includes("public.example.com")) {
      return { ok: false, status: 302, headers: { get: (name) => (name === "location" ? "https://internal.example.com/secret.mp3" : null) } };
    }
    throw new Error("bu URL'e gidilmemeliydi");
  };
  await assert.rejects(() => fetchMediaBytes("https://public.example.com/redirect", { fetchImpl, lookup }), /özel\/yerel/);
});

test("fetchMediaBytes: HTTP hata durumunda açık bir hata fırlatır", async () => {
  const lookup = async () => [{ address: "93.184.216.34" }];
  await assert.rejects(
    () => fetchMediaBytes("https://example.com/a.mp3", { lookup, fetchImpl: async () => ({ ok: false, status: 404, headers: { get: () => null } }) }),
    /HTTP 404/
  );
});

test("fetchMediaBytes: desteklenmeyen bir Content-Type (ör. bir HTML sayfası) reddedilir", async () => {
  const lookup = async () => [{ address: "93.184.216.34" }];
  const fetchImpl = async () => ({ ok: true, status: 200, headers: { get: (name) => (name === "content-type" ? "text/html" : null) }, arrayBuffer: async () => new ArrayBuffer(4) });
  await assert.rejects(() => fetchMediaBytes("https://example.com/a.mp3", { fetchImpl, lookup }), /Desteklenmeyen medya tipi/);
});

test("fetchMediaBytes: MAX_MEDIA_BYTES'ı aşan bir dosya Content-Length ile ERKEN reddedilir (gövde hiç okunmaz)", async () => {
  const lookup = async () => [{ address: "93.184.216.34" }];
  let bodyRead = false;
  const fetchImpl = async () => ({
    ok: true, status: 200,
    headers: { get: (name) => ({ "content-type": "audio/mpeg", "content-length": String(MAX_MEDIA_BYTES + 1024) }[name] || null) },
    arrayBuffer: async () => { bodyRead = true; return new ArrayBuffer(0); }
  });
  await assert.rejects(() => fetchMediaBytes("https://example.com/big.mp3", { fetchImpl, lookup }), /çok büyük/);
  assert.equal(bodyRead, false, "Content-Length zaten limiti aştığı için gövde hiç okunmamalı");
});

test("fetchMediaBytes: Content-Length eksik/yanlış olsa da akış hâlinde okuyup limiti aşınca DURUR, tüm gövdeyi belleğe almaz", async () => {
  const lookup = async () => [{ address: "93.184.216.34" }];
  let cancelled = false;
  let chunksServed = 0;
  const totalChunks = 100;
  const chunkSize = 1024 * 1024; // 1MB/parça — 100MB toplam, limitin çok üstünde
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
    headers: { get: (name) => (name === "content-type" ? "audio/mpeg" : null) }, // Content-Length yok
    body: { getReader: () => reader }
  });
  await assert.rejects(() => fetchMediaBytes("https://example.com/huge-stream.mp3", { fetchImpl, lookup, maxBytes: 2 * 1024 * 1024 }), /çok büyük/);
  assert.equal(cancelled, true, "reader.cancel() çağrılmalı, akış erkenden durdurulmalı");
  assert.ok(chunksServed < totalChunks, "100MB'lık akışın tamamı tüketilmeden önce durmalı");
});

test("fetchMediaBytes: geçerli bir ses dosyasını indirir, buffer + mimeType döner", async () => {
  const lookup = async () => [{ address: "93.184.216.34" }];
  const bytes = Buffer.from("fake-audio-bytes");
  const fetchImpl = async () => ({
    ok: true, status: 200,
    headers: { get: (name) => ({ "content-type": "audio/mpeg", "content-length": String(bytes.length) }[name] || null) },
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  });
  const result = await fetchMediaBytes("https://example.com/a.mp3", { fetchImpl, lookup });
  assert.equal(result.mimeType, "audio/mpeg");
  assert.equal(result.buffer.length, bytes.length);
});

test("fetchMediaBytes: video/quicktime (MOV) genel MIME güvenlik ağından geçer (adapter seviyesinde reddedilir, burada değil)", async () => {
  const lookup = async () => [{ address: "93.184.216.34" }];
  assert.ok(ALLOWED_TRANSCRIPTION_MIME_TYPES.has("video/quicktime"), "media-fetch katmanı MOV'u genel güvenlik ağında engellememeli — spesifik reddetme openai-transcribe.js'te olur");
  const fetchImpl = async () => ({
    ok: true, status: 200,
    headers: { get: (name) => (name === "content-type" ? "video/quicktime" : null) },
    arrayBuffer: async () => new ArrayBuffer(4)
  });
  const result = await fetchMediaBytes("https://example.com/a.mov", { fetchImpl, lookup });
  assert.equal(result.mimeType, "video/quicktime");
});
