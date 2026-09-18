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
    [
      "/api/auth",
      "/api/meta-ads/ad-creative",
      "/api/meta-ads/ad-creative-update",
      "/api/meta-ads/ad-delete",
      "/api/meta-ads/ad-status",
      "/api/meta-ads/ads",
      "/api/meta-ads/adset-budget",
      "/api/meta-ads/overview"
    ]
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

// PR-4: silme/kreatif oluşturma-bağlama artık kapsam İÇİNDE — eski
// "delete|create|catalog|creative-update yok" testi bu yüzden kaldırıldı,
// yerine bu write akışlarının da (durum/bütçe ile BİREBİR AYNI) güvenlik
// sözleşmesine uyduğunu doğrulayan testler geldi (aşağıda). Katalog/WhatsApp/
// kampanya/reklam-seti oluşturma gibi kapsam dışı Meta TOOL'larının hiç
// çağrılmadığı zaten test/meta-connect.test.js + test/meta-ads-routes.test.js'te
// (allowlist testi) doğrulanıyor — bu dosya (dashboard-meta-ads.js) hiçbir MCP
// tool adına doğrudan referans vermiyor, yalnız /api/meta-ads/* route'larını
// çağırıyor (bkz. yukarıdaki "Yalnız bilinen /api/meta-ads/* uçları..." testi).

test("PR-4: 'confirmed' alanı istemciden ASLA gönderilmez — sunucu her zaman kendi confirmed:true'sunu ekler (durum/bütçe/silme/kreatif dahil TÜM write'lar)", () => {
  // Client, MCP'nin confirmed şartını taklit edip kendi body'sine confirmed koymamalı;
  // bu sadece backend'in (meta-connect.js) sorumluluğu — bir tasarım-notu yorumunda
  // "confirmed" kelimesi geçebilir, ama hiçbir JSON.stringify(...) request body'sinde
  // bu alan olmamalı.
  const requestBodies = [...client.matchAll(/JSON\.stringify\((\{[^}]*\})\)/g)].map((match) => match[1]);
  assert.ok(requestBodies.length >= 4, "beklenen POST body'leri (status/bütçe/silme/kreatif) bulunamadı");
  requestBodies.forEach((body) => assert.doesNotMatch(body, /confirmed/i));
});

test("PR-4: iki tıklamalı onay sonrası GERÇEK gönderilen istek, Social Publisher'ın kendi 'confirm:true' niyet sinyalini taşır — silme ve kreatif dahil", () => {
  // Bu 'confirm' (MCP'nin 'confirmed'inden farklı) — backend'de body.confirm !== true
  // ise 400 döner; route'a doğrudan curl ile confirm göndermeden gidilirse artık
  // sessizce yazma yapılmaz.
  const requestBodies = [...client.matchAll(/JSON\.stringify\((\{[^}]*\})\)/g)].map((match) => match[1]);
  const writeBodies = requestBodies.filter((body) => /ad_id|adset_id/.test(body));
  assert.ok(writeBodies.length >= 4, "ad-status, adset-budget, ad-delete ve ad-creative-update body'leri bulunamadı");
  writeBodies.forEach((body) => assert.match(body, /confirm:\s*true/));
});

test("PR-4: Admin-only kontrolü var — write kontrolleri (durum/bütçe/silme/kreatif) isAdmin false ise gösterilmez", () => {
  assert.match(client, /state\.isAdmin/);
  assert.match(client, /if \(!state\.isAdmin\) \{/);
  assert.match(client, /data\?\.user\?\.role === "Admin"/);
});

test("PR-4: silme butonu YALNIZ reklam PAUSED ise render edilir — asıl guard MCP'de olsa da UI da bunu tekrarlar", () => {
  assert.match(client, /function renderDeleteCard\(\)/);
  const fn = client.match(/function renderDeleteCard\(\) \{[\s\S]*?\n  \}/)[0];
  assert.match(fn, /writeState\.adStatus !== "PAUSED"/);
  assert.match(fn, /meta-ads-delete-submit/);
});

test("PR-4: silme onay metninde reklam adı + ID + durum birlikte gösterilir", () => {
  const fn = client.match(/function renderDeleteCard\(\) \{[\s\S]*?\n  \}/)[0];
  assert.match(fn, /writeState\.adName/);
  assert.match(fn, /writeState\.adId/);
  assert.match(fn, /PAUSED/);
});

test("PR-4: silme iki tıklamalı onay ister (ilk tık arm eder, süresi dolunca sıfırlanır) ve PAUSED değilken hiç tetiklenmez", () => {
  assert.match(client, /function handleDeleteClick/);
  assert.match(client, /deleteConfirmArmed = true/);
  const fn = client.match(/function handleDeleteClick\(\) \{[\s\S]*?\n  \}/)[0];
  assert.match(fn, /writeState\.adStatus !== "PAUSED"/);
});

test("PR-4: silme sonrası deletion_semantics/deleted alanları uydurulmadan (olduğu gibi) kullanıcıya gösterilir ve liste yenilenir", () => {
  const fn = client.match(/async function performDelete\(\) \{[\s\S]*?\n  \}/)[0];
  assert.match(fn, /deletion_semantics/);
  assert.match(fn, /data\.deleted === true/);
  assert.match(fn, /data\.deleted === false/);
  assert.match(fn, /state\.ads = state\.ads\.filter/);
});

test("PR-4: kreatif oluştur+bağla akışı yalnız MEVCUT bir image_hash'i yeniden kullanır — yeni görsel/URL alanı istemciden hiç toplanmaz veya gönderilmez", () => {
  assert.match(client, /creativeImageHash/);
  assert.doesNotMatch(client, /creative.{0,15}image_url/i);
  const performFn = client.match(/async function performCreativeUpdate\(\) \{[\s\S]*?\n  \}/)[0];
  assert.doesNotMatch(performFn, /image_url/);
  assert.match(performFn, /image_hash:\s*writeState\.creativeImageHash/);
});

test("PR-4: kreatif oluştur+bağla iki tıklamalı onay ister ve zorunlu alanlar (metin/başlık/link/image_hash) boşsa onay akışına hiç girmeden reddedilir", () => {
  assert.match(client, /function handleCreativeSubmitClick/);
  const fn = client.match(/function handleCreativeSubmitClick\(\) \{[\s\S]*?\n  \}/)[0];
  assert.match(fn, /creativeMessage\.trim\(\)/);
  assert.match(fn, /creativeHeadline\.trim\(\)/);
  assert.match(fn, /creativeLink\.trim\(\)/);
  assert.match(fn, /creativeImageHash/);
  assert.match(fn, /creativeConfirmArmed = true/);
});

test("PR-4: kreatif bağlama sonrası previous_creative_id ve new_creative_id (rollback bilgisi) kullanıcıya gösterilir", () => {
  const fn = client.match(/async function performCreativeUpdate\(\) \{[\s\S]*?\n  \}/)[0];
  assert.match(fn, /previous_creative_id/);
  assert.match(fn, /new_creative_id/);
});

// İncelemede istenen ek kapsam: create başarılı/bind başarısız (partial success)
// senaryosu genel bir "başarısız" mesajına yutulmamalı — client, hata yanıtındaki
// error.new_creative_id'yi OKUYUP kullanıcıya "oluşturuldu ama bağlanamadı" gibi
// AYRI bir bilgi olarak göstermeli (bkz. api/meta-ads/ad-creative-update.js +
// src/lib/meta-connect.js:createAndBindAdCreative → error.new_creative_id).
test("PR-4: create başarılı/bind başarısız (partial success) durumu client'ta genel hataya yutulmaz — error.new_creative_id okunup ayrıca gösterilir", () => {
  const fn = client.match(/async function performCreativeUpdate\(\) \{[\s\S]*?\n  \}/)[0];
  assert.match(fn, /data\?\.error\?\.new_creative_id/);
  assert.match(fn, /oluşturuldu ama bağlanamadı/);
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
