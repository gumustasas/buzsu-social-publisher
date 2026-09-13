import test from "node:test";
import assert from "node:assert/strict";
import { productContextCachePath, writeProductContextCache, readProductContextCache } from "../src/lib/product-context-cache.js";

const URL_A = "https://www.buzsu.com.tr/code-su-aritma-cihazi/";

test("productContextCachePath is deterministic and URL-encodes the canonical URL", () => {
  const path = productContextCachePath(URL_A);
  assert.equal(path, `product-context-cache/${encodeURIComponent(URL_A)}.json`);
  assert.equal(path, productContextCachePath(URL_A));
});

test("writeProductContextCache writes to the deterministic path with addRandomSuffix:false and allowOverwrite:true", async () => {
  let capturedPath, capturedBody, capturedOptions;
  const putImpl = async (path, body, options) => {
    capturedPath = path; capturedBody = body; capturedOptions = options;
    return { url: `https://blob.example.com/${path}` };
  };
  await writeProductContextCache(URL_A, { productName: "Code", fetchedAt: "2026-09-13T00:00:00.000Z" }, { putImpl });
  assert.equal(capturedPath, productContextCachePath(URL_A));
  assert.equal(capturedOptions.addRandomSuffix, false);
  assert.equal(capturedOptions.allowOverwrite, true);
  assert.equal(capturedOptions.contentType, "application/json");
  const parsed = JSON.parse(capturedBody);
  assert.equal(parsed.productName, "Code");
});

test("readProductContextCache returns null when nothing is cached yet", async () => {
  const listImpl = async () => ({ blobs: [] });
  const result = await readProductContextCache(URL_A, { listImpl });
  assert.equal(result, null);
});

test("readProductContextCache fetches the exact matching blob and returns its parsed JSON", async () => {
  const path = productContextCachePath(URL_A);
  const listImpl = async ({ prefix }) => {
    assert.equal(prefix, path);
    return { blobs: [{ pathname: path, url: `https://blob.example.com/${path}` }] };
  };
  const fetchImpl = async (url) => {
    assert.equal(url, `https://blob.example.com/${path}`);
    return { ok: true, json: async () => ({ productName: "Code", fetchedAt: "2026-09-13T00:00:00.000Z" }) };
  };
  const result = await readProductContextCache(URL_A, { listImpl, fetchImpl });
  assert.equal(result.productName, "Code");
});

// Cache read bozuk JSON ise güvenli şekilde ignore edip yeniden üretilmeli —
// get_buzsu_product_context (bkz. product-intelligence.js) burada FAIL
// OLMAMALI, null dönüp taze context üretmeli.
test("readProductContextCache silently returns null when the cached blob body is not valid JSON (corrupted cache)", async () => {
  const path = productContextCachePath(URL_A);
  const listImpl = async () => ({ blobs: [{ pathname: path, url: `https://blob.example.com/${path}` }] });
  const fetchImpl = async () => ({ ok: true, json: async () => { throw new SyntaxError("Unexpected token"); } });
  const result = await readProductContextCache(URL_A, { listImpl, fetchImpl });
  assert.equal(result, null);
});

test("readProductContextCache silently returns null when the blob itself cannot be fetched (network error)", async () => {
  const path = productContextCachePath(URL_A);
  const listImpl = async () => ({ blobs: [{ pathname: path, url: `https://blob.example.com/${path}` }] });
  const fetchImpl = async () => { throw new Error("network down"); };
  const result = await readProductContextCache(URL_A, { listImpl, fetchImpl });
  assert.equal(result, null);
});

test("readProductContextCache silently returns null when list() itself throws", async () => {
  const listImpl = async () => { throw new Error("blob list unavailable"); };
  const result = await readProductContextCache(URL_A, { listImpl });
  assert.equal(result, null);
});
