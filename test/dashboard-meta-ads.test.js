import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const dashboard = await readFile(new URL("../dashboard.html", import.meta.url), "utf8");
const client = await readFile(new URL("../dashboard-meta-ads.js", import.meta.url), "utf8");

test("Meta Reklamlar modülü ayrı dosyada kalır, dashboard.html'e doğru sırayla eklenir", () => {
  assert.match(dashboard, /<script src="\/dashboard-reels-v2\.js"><\/script>\s*<script src="\/dashboard-meta-ads\.js"><\/script>/);
  assert.match(dashboard, /<button type="button" data-tab="meta-ads">Meta Reklamlar<\/button>/);
  assert.match(dashboard, /<section id="meta-ads" class="panel tab-panel tab-hidden" data-tab="meta-ads">/);
  assert.match(client, /const mAdsApi = /);
});

test("Modül credentials: same-origin ile mevcut oturum cookie'sini kullanır; kendi token/secret mantığı yok", () => {
  assert.match(client, /credentials:\s*"same-origin"/);
  assert.doesNotMatch(client, /Authorization/);
  assert.doesNotMatch(client, /META_CONNECT/);
  assert.doesNotMatch(client, /mcp-session-id/i);
});

test("Yalnız /api/meta-ads/ads ve /api/meta-ads/ad-creative çağrılır; başka bir Meta/MCP ucuna dokunulmaz", () => {
  const apiPaths = [...client.matchAll(/mAdsApi\(`?"?(\/api\/meta-ads\/[a-z-]+)/g)].map((match) => match[1]);
  assert.deepEqual([...new Set(apiPaths)].sort(), ["/api/meta-ads/ad-creative", "/api/meta-ads/ads"]);
});

test("Bu PR'da hiçbir yazma/onay butonu yok — pause/resume/delete/budget/confirmed ifadesi geçmez", () => {
  assert.doesNotMatch(client, /pause|resume|delete|budget|confirmed\s*:\s*true/i);
});

test("Reklam listesi lazy-init ile yüklenir: nav tıklaması ve #workspace görünürlüğü initialize'ı tetikler", () => {
  assert.match(client, /document\.querySelectorAll\('\.brand-rail \[data-tab="meta-ads"\]'\)\.forEach/);
  assert.match(client, /new MutationObserver/);
});

test("Görsellerde referrerpolicy=\"no-referrer\" kullanılır (Meta CDN görseli için)", () => {
  assert.match(client, /referrerpolicy="no-referrer"/);
});

test("Kreatif detayında duplicate_image_hashes doluysa uyarı gösterilir", () => {
  assert.match(client, /duplicate_image_hashes/);
  assert.match(client, /Aynı görsel birden fazla kartta kullanılıyor/);
});
