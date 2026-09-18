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

test("Yalnız bilinen /api/meta-ads/* uçları ve /api/auth çağrılır; başka bir Meta/MCP ucuna dokunulmaz", () => {
  const apiPaths = [...client.matchAll(/mAdsApi\(`?"?(\/api\/[a-z-]+(?:\/[a-z-]+)?)/g)].map((match) => match[1]);
  assert.deepEqual(
    [...new Set(apiPaths)].sort(),
    ["/api/auth", "/api/meta-ads/ad-creative", "/api/meta-ads/ad-status", "/api/meta-ads/ads", "/api/meta-ads/adset-budget", "/api/meta-ads/overview"]
  );
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

test("low_volume rozeti sunucunun genel flagged'ına değil, HER sinyalin kendi eşiğine bakar — results:null bir sinyali flagged saymaz", () => {
  const fn = client.match(/function isLowVolumeSignalFlagged\([\s\S]*?\n  \}/)[0];
  assert.match(fn, /signal\.value !== null && signal\.value < signal\.threshold/);
  // renderOverview artık lowVolume.flagged'ı DOĞRUDAN göstermiyor; her sinyali kendi
  // filtresinden geçiriyor — aksi halde results:null+impressions-flagged durumunda
  // "Sonuç hacmi düşük" gibi yanlış bir başlık çıkardı (önceki production hatası).
  assert.match(client, /flaggedSignals = lowVolume \? lowVolume\.signals\.filter\(isLowVolumeSignalFlagged\) : \[\]/);
  assert.doesNotMatch(client, /lowVolume\?\.flagged\s*\n?\s*\?/);
});

test("low_volume metni sinyale özgü: results için 'Sonuç hacmi düşük (<metrik>)', impressions için 'Gösterim hacmi düşük' — birbirine karışmaz", () => {
  const fn = client.match(/function renderLowVolumeSignal\([\s\S]*?\n  \}/)[0];
  assert.match(fn, /"Gösterim hacmi düşük"/);
  assert.match(fn, /Sonuç hacmi düşük \(/);
});

test("purchase_roas === 0, null'dan ayrı: formatNullable yalnız null/undefined'ı 'Veri yok' sayar, 0'ı formatter'a geçirir (!value gibi 0'ı da yakalayan gevşek bir kontrol DEĞİL)", () => {
  const fn = client.match(/const formatNullable = \([\s\S]*?\);/)[0];
  assert.match(fn, /value === null \|\| value === undefined \? "Veri yok" : formatter\(value\)/);
});

test("Reklamlar tablosu artık campaign_name/adset_name gösterir (ID'yi tamamen basmaz)", () => {
  assert.match(client, /ad\.campaign_name \|\| ad\.campaign_id/);
  assert.match(client, /ad\.adset_name \|\| ad\.adset_id/);
});

test("Reklamlar listesi Genel Bakış'tan bağımsız olarak lazy — ancak 'Reklamlar' sekmesine ilk geçişte yüklenir", () => {
  assert.match(client, /if \(!state\.adsLoaded\) \{\s*state\.adsLoaded = true;\s*loadAds\(\);/);
});

test("PR-3: silme/oluşturma/katalog/kreatif-güncelleme gibi kapsam dışı write işlemleri yok — yalnız durum + bütçe", () => {
  assert.doesNotMatch(client, /delete|create|catalog|creative.{0,20}update/i);
});

test("PR-3: 'confirmed' alanı istemciden ASLA gönderilmez — sunucu her zaman kendi confirmed:true'sunu ekler", () => {
  // Client, MCP'nin confirmed şartını taklit edip kendi body'sine confirmed koymamalı;
  // bu sadece backend'in (meta-connect.js) sorumluluğu — bir tasarım-notu yorumunda
  // "confirmed" kelimesi geçebilir, ama hiçbir JSON.stringify(...) request body'sinde
  // bu alan olmamalı.
  const requestBodies = [...client.matchAll(/JSON\.stringify\((\{[^}]*\})\)/g)].map((match) => match[1]);
  assert.ok(requestBodies.length >= 2, "beklenen POST body'leri bulunamadı");
  requestBodies.forEach((body) => assert.doesNotMatch(body, /confirmed/i));
});

test("PR-3: Admin-only kontrolü var — write kontrolleri isAdmin false ise gösterilmez", () => {
  assert.match(client, /state\.isAdmin/);
  assert.match(client, /if \(!state\.isAdmin\) \{/);
  assert.match(client, /data\?\.user\?\.role === "Admin"/);
});

test("PR-3: durum değişikliği ve bütçe güncellemesi iki tıklamalı onay ister (ilk tık arm eder, süresi dolunca sıfırlanır)", () => {
  assert.match(client, /function handleStatusToggleClick/);
  assert.match(client, /function handleBudgetSubmitClick/);
  assert.match(client, /statusConfirmArmed = true/);
  assert.match(client, /budgetConfirmArmed = true/);
  assert.match(client, /CONFIRM_ARM_MS/);
});

test("PR-3: bütçe girdisi 1-100000 TRY dışında bir değerle onay akışına hiç girmeden reddedilir", () => {
  const fn = client.match(/function handleBudgetSubmitClick\(\) \{[\s\S]*?\n  \}/)[0];
  assert.match(fn, /value < 1 \|\| value > 100000/);
});

test("PR-3: bütçe değeri değişince (onaylanmışsa) onay sıfırlanır — eski onay yeni bir değere sirayet etmez", () => {
  assert.match(client, /if \(writeState\.budgetConfirmArmed\) \{\s*resetBudgetConfirm\(\);/);
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
