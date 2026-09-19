import test from "node:test";
import assert from "node:assert/strict";
import { fetchMediaBytes, MAX_MEDIA_BYTES } from "../src/transcription/media-fetch.js";

test("fetchMediaBytes: geçersiz URL hiçbir fetch atmadan hata fırlatır", async () => {
  let called = false;
  await assert.rejects(
    () => fetchMediaBytes("not a url", { fetchImpl: async () => { called = true; throw new Error("çağrılmamalıydı"); } }),
    /geçerli bir URL/
  );
  assert.equal(called, false);
});

test("fetchMediaBytes: http:// (HTTPS olmayan) reddedilir", async () => {
  await assert.rejects(() => fetchMediaBytes("http://example.com/a.mp4"), /HTTPS/);
});

test("fetchMediaBytes: HTTP hata durumunda açık bir hata fırlatır", async () => {
  await assert.rejects(
    () => fetchMediaBytes("https://example.com/a.mp4", { fetchImpl: async () => ({ ok: false, status: 404 }) }),
    /HTTP 404/
  );
});

test("fetchMediaBytes: content-type header'ı varsa onu kullanır", async () => {
  const result = await fetchMediaBytes("https://example.com/a.bin", {
    fetchImpl: async () => ({ ok: true, headers: { get: () => "audio/wav" }, arrayBuffer: async () => new ArrayBuffer(4) })
  });
  assert.equal(result.mimeType, "audio/wav");
  assert.equal(result.buffer.length, 4);
});

test("fetchMediaBytes: content-type yoksa/generic ise dosya uzantısından tahmin eder", () => {
  return (async () => {
    const result = await fetchMediaBytes("https://example.com/video.mp4", {
      fetchImpl: async () => ({ ok: true, headers: { get: () => "application/octet-stream" }, arrayBuffer: async () => new ArrayBuffer(4) })
    });
    assert.equal(result.mimeType, "video/mp4");
  })();
});

test("fetchMediaBytes: MAX_MEDIA_BYTES aşan bir dosya SESSİZCE küçültülmez, açık bir hata fırlatır", async () => {
  const bigSize = MAX_MEDIA_BYTES + 1024;
  await assert.rejects(
    () => fetchMediaBytes("https://example.com/big.mp4", {
      fetchImpl: async () => ({ ok: true, headers: { get: () => "video/mp4" }, arrayBuffer: async () => new ArrayBuffer(bigSize) })
    }),
    /çok büyük/
  );
});

test("fetchMediaBytes: maxBytes override edilebilir", async () => {
  await assert.rejects(
    () => fetchMediaBytes("https://example.com/small.mp4", {
      maxBytes: 10,
      fetchImpl: async () => ({ ok: true, headers: { get: () => "video/mp4" }, arrayBuffer: async () => new ArrayBuffer(20) })
    }),
    /çok büyük/
  );
});
