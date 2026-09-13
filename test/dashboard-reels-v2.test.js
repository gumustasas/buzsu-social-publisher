import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const dashboard = await readFile(new URL("../dashboard.html", import.meta.url), "utf8");
const client = await readFile(new URL("../dashboard-reels-v2.js", import.meta.url), "utf8");

test("AI Reels V2 client ayrı dosyada kalır ve eski dashboard JS global'lerine bağlanmaz", () => {
  assert.match(dashboard, /<script src="\/dashboard-reels-v2\.js"><\/script>/);
  assert.match(client, /const v2Api = /);
  assert.doesNotMatch(client, /\bapi\(/);
  assert.doesNotMatch(client, /\brenderProductSelect\b/);
  assert.doesNotMatch(client, /\bproducts\./);
});

test("validate yanıtındaki normalize ReelScript client state'inin kaynağı olur", () => {
  assert.match(client, /state\.reelScript = data\.reelScript;/);
  assert.match(client, /autofillAudio\(state\.reelScript\);\s*renderScript\(\);/);
});

test("PR-D client yalnız options/product-context/generate/validate çağırır; medya üretim uçlarına dokunmaz", () => {
  const actions = [...client.matchAll(/action=([a-z-]+)/g)].map((match) => match[1]);
  assert.deepEqual([...new Set(actions)].sort(), ["generate", "options", "product-context", "validate"]);
  assert.doesNotMatch(client, /\/api\/(?:veo|omni|turkish|lyria|reel-audio|compose)/i);
  assert.match(client, /const passive = step > 4;/);
  assert.match(client, /passive \? " disabled"/);
});

test("mevcut ses paneli otomatik doldurulur ama alanlar readonly yapılmaz", () => {
  for (const id of ["reel-audio-narration-text", "reel-audio-music-prompt", "reel-audio-duration", "reel-audio-product-name"]) {
    assert.match(client, new RegExp(`byId\\("${id}"\\)\\.value`));
  }
  assert.match(dashboard, /Video süresi \(saniye\)<input id="reel-audio-duration"/);
  assert.doesNotMatch(dashboard, /id="reel-audio-(?:narration-text|music-prompt|duration|product-name)"[^>]*readonly/);
});
