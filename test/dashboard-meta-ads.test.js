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

test("Yalnız /api/meta-ads/ads, /api/meta-ads/ad-creative ve /api/meta-ads/overview çağrılır; başka bir Meta/MCP ucuna dokunulmaz", () => {
  const apiPaths = [...client.matchAll(/mAdsApi\(`?"?(\/api\/meta-ads\/[a-z-]+)/g)].map((match) => match[1]);
  assert.deepEqual([...new Set(apiPaths)].sort(), ["/api/meta-ads/ad-creative", "/api/meta-ads/ads", "/api/meta-ads/overview"]);
});

test("Genel Bakış varsayılan sekme, Reklamlar ikinci sekme olarak sub-nav'da yer alır", () => {
  assert.match(dashboard, /data-meta-ads-view="overview">Genel Bakış<\/button>/);
  assert.match(dashboard, /data-meta-ads-view="list">Reklamlar<\/button>/);
  assert.match(client, /async function initialize\(\) \{[\s\S]*?await loadOverview\(\);/);
});

test("null (ölçülmedi) ile 0 (ölçüldü ve sıfır) UI'da ayrı gösterilir — null her zaman 'Veri yok' render eder", () => {
  assert.match(client, /formatNullable/);
  const fn = client.match(/const formatNullable = \([\s\S]*?\);/)[0];
  assert.match(fn, /"Veri yok"/);
});

test("low_volume.signals[] gösterilir; value null ise 'Veri yok', threshold her zaman gösterilir", () => {
  assert.match(client, /function renderLowVolumeSignal/);
  assert.match(client, /Sonuç hacmi düşük/);
  assert.match(client, /lowVolume\?\.flagged/);
});

test("Reklamlar tablosu artık campaign_name/adset_name gösterir (ID'yi tamamen basmaz)", () => {
  assert.match(client, /ad\.campaign_name \|\| ad\.campaign_id/);
  assert.match(client, /ad\.adset_name \|\| ad\.adset_id/);
});

test("Reklamlar listesi Genel Bakış'tan bağımsız olarak lazy — ancak 'Reklamlar' sekmesine ilk geçişte yüklenir", () => {
  assert.match(client, /if \(!state\.adsLoaded\) \{\s*state\.adsLoaded = true;\s*loadAds\(\);/);
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
