import "dotenv/config";
import { fileURLToPath } from "node:url";
import { publicationFormat, selectDueRecords, withUtm } from "./lib/schedule.js";
import { buildLease, canProcess, clearLease } from "./lib/queue.js";
import { AIRTABLE_BASE_ID, AIRTABLE_TABLE_ID, META_GRAPH_VERSION, assertMetaGraphVersionCurrent } from "./lib/config.js";
import { notifyFailure } from "./lib/notify.js";
import { publishTweet } from "./x-publish.js";

const livePostingEnabled = process.env.ENABLE_LIVE_POSTING === "true";
const facebookStoriesEnabled = process.env.ENABLE_FACEBOOK_STORIES === "true";
const graphVersion = META_GRAPH_VERSION;
const postLimit = Number.parseInt(process.env.SOCIAL_POST_LIMIT || "1", 10);
const maxAttempts = Number.parseInt(process.env.MAX_PUBLISH_ATTEMPTS || "3", 10);
const storyImageBaseUrl = process.env.STORY_IMAGE_BASE_URL || "";
const airtableBaseId = AIRTABLE_BASE_ID;
const airtableTableId = AIRTABLE_TABLE_ID;
const required = ["META_ACCESS_TOKEN", "META_FACEBOOK_PAGE_ACCESS_TOKEN", "META_INSTAGRAM_ACCOUNT_ID", "META_FACEBOOK_PAGE_ID", "AIRTABLE_TOKEN"];
const airtableFields = ["Başlık", "Kaynak URL", "Görsel URL", "Video URL", "Instagram Metni", "Facebook Metni", "X Metni", "Hashtagler", "Platform", "Yayın Biçimi", "Yayın Zamanı", "Durum", "Not", "Deneme Sayısı", "Instagram Yayın ID", "Facebook Yayın ID", "X Yayın ID", "Hata Mesajı"];
// X (Twitter) 280 karakter sınırı var; t.co her URL'i uzunluğuna bakmaksızın
// 23 karaktere sarıyor — geri kalan metni buna göre kısaltıyoruz.
const X_MAX_CHARS = 280;
const X_URL_WEIGHT = 23;

function assertConfiguration() {
  if (!Number.isInteger(postLimit) || postLimit < 1) throw new Error("SOCIAL_POST_LIMIT en az 1 olmalı.");
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) throw new Error("MAX_PUBLISH_ATTEMPTS en az 1 olmalı.");
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length) throw new Error(`Eksik ortam değişkenleri: ${missing.join(", ")}`);
  assertMetaGraphVersionCurrent();
}

function requireHttpsUrl(value, label) {
  let url;
  try { url = new URL(value); } catch { throw new Error(`${label} geçerli bir URL olmalı.`); }
  if (url.protocol !== "https:") throw new Error(`${label} herkese açık HTTPS adresi olmalı.`);
}

const joinText = (...values) => values.filter(Boolean).join("\n\n").trim();

function storyImageUrl(source, fields) {
  requireHttpsUrl(source, "Görsel URL");
  if (!storyImageBaseUrl) return source;
  const url = new URL(storyImageBaseUrl);
  url.searchParams.set("src", source);
  const title = (fields["Başlık"] || "Buzsu Su Arıtma")
    .replace(/^DENEME\s*\|\s*/i, "")
    .split("|")[0]
    .trim();
  url.searchParams.set("title", title);
  url.searchParams.set("subtitle", (fields["Instagram Metni"] || "").split("\n")[0].slice(0, 90) || "Ürün bilgileri için inceleyin.");
  url.searchParams.set("footer", "www.buzsu.com.tr");
  return url.toString();
}

async function graphPost(path, params, accessToken = process.env.META_ACCESS_TOKEN) {
  const response = await fetch(`https://graph.facebook.com/${graphVersion}/${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params)
  });
  const data = await response.json();
  if (!response.ok || data.error) throw new Error(`Meta API: ${data.error?.message || `HTTP ${response.status}`}`);
  return data;
}

async function graphGet(path, accessToken = process.env.META_ACCESS_TOKEN) {
  const response = await fetch(`https://graph.facebook.com/${graphVersion}/${path}`, { headers: { Authorization: `Bearer ${accessToken}` } });
  const data = await response.json();
  if (!response.ok || data.error) throw new Error(`Meta API: ${data.error?.message || `HTTP ${response.status}`}`);
  return data;
}

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

// Fotoğraf/hikâye konteynerleri saniyeler içinde hazır olur (varsayılan 12
// deneme × 3sn = 36sn yeterli). Reel videoları Meta'ya göre 30 saniye ile
// birkaç dakika arasında işlenebiliyor; bu yüzden Reel için çok daha uzun
// bir zaman aşımı (60 deneme × 5sn = 5 dakika) kullanılıyor.
async function waitForInstagramContainer(containerId, { attempts = 12, intervalMs = 3000 } = {}) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const state = await graphGet(`${containerId}?fields=status_code,status`);
    if (state.status_code === "FINISHED") return;
    if (state.status_code === "ERROR" || state.status_code === "EXPIRED") {
      throw new Error(`Instagram medya işleme durumu: ${state.status_code}${state.status ? ` (${state.status})` : ""}`);
    }
    await sleep(intervalMs);
  }
  throw new Error(`Instagram medya konteyneri ${Math.round((attempts * intervalMs) / 1000)} saniye içinde hazır olmadı.`);
}

async function airtableGetApproved() {
  const records = [];
  let offset = "";
  do {
    const params = new URLSearchParams({ pageSize: "100" });
    airtableFields.forEach((field) => params.append("fields[]", field));
    if (offset) params.set("offset", offset);
    const response = await fetch(`https://api.airtable.com/v0/${airtableBaseId}/${airtableTableId}?${params}`, { headers: { Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}` } });
    const data = await response.json();
    if (!response.ok) throw new Error(`Airtable okunamadı: ${data.error?.message || `HTTP ${response.status}`}`);
    records.push(...(data.records || []));
    offset = data.offset || "";
  } while (offset);
  return records;
}

async function updateAirtable(recordId, fields) {
  const response = await fetch(`https://api.airtable.com/v0/${airtableBaseId}/${airtableTableId}/${recordId}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ fields })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`Airtable güncellenemedi: ${data.error?.message || `HTTP ${response.status}`}`);
}

async function publishInstagramReel(fields) {
  requireHttpsUrl(fields["Video URL"], "Video URL");
  const caption = joinText(fields["Instagram Metni"], fields["Hashtagler"]);
  if (!caption) throw new Error("Instagram metni boş.");
  // share_to_feed: Reel hem Reels sekmesinde hem ana akışta görünsün —
  // "Gönderi" formatındaki normal paylaşımlarla aynı görünürlük mantığı.
  const container = await graphPost(`${process.env.META_INSTAGRAM_ACCOUNT_ID}/media`, { media_type: "REELS", video_url: fields["Video URL"], caption, share_to_feed: "true" });
  // Video işleme fotoğraftan çok daha uzun sürebiliyor (Meta: 30sn - birkaç
  // dakika); 60 deneme × 5sn = 5 dakikaya kadar bekleniyor.
  await waitForInstagramContainer(container.id, { attempts: 60, intervalMs: 5000 });
  const published = await graphPost(`${process.env.META_INSTAGRAM_ACCOUNT_ID}/media_publish`, { creation_id: container.id });
  return published.id;
}

async function publishInstagram(fields, format) {
  if (format === "Reel") return publishInstagramReel(fields);
  requireHttpsUrl(fields["Görsel URL"], "Görsel URL");
  const params = { image_url: format === "Hikâye" ? storyImageUrl(fields["Görsel URL"], fields) : fields["Görsel URL"] };
  if (format === "Hikâye") params.media_type = "STORIES";
  else {
    const caption = joinText(fields["Instagram Metni"], fields["Hashtagler"]);
    if (!caption) throw new Error("Instagram metni boş.");
    params.caption = caption;
  }
  const container = await graphPost(`${process.env.META_INSTAGRAM_ACCOUNT_ID}/media`, params);
  await waitForInstagramContainer(container.id);
  const published = await graphPost(`${process.env.META_INSTAGRAM_ACCOUNT_ID}/media_publish`, { creation_id: container.id });
  return published.id;
}

// Facebook Reel yayınlama üç adımlı: (1) video_reels?upload_phase=start ile
// bir video_id alınır, (2) rupload.facebook.com'a file_url header'ıyla
// (barındırılan URL'den) video "yüklenir" — Meta bunu kendi tarafında
// indirir, biz bayt göndermiyoruz, (3) upload_phase=finish ile description
// ve video_state=PUBLISHED verilip yayına alınır. Resmi Meta Postman
// koleksiyonundaki akışla birebir aynı.
async function publishFacebookReel(fields) {
  requireHttpsUrl(fields["Video URL"], "Video URL");
  const token = process.env.META_FACEBOOK_PAGE_ACCESS_TOKEN;
  const pageId = process.env.META_FACEBOOK_PAGE_ID;
  const description = joinText(fields["Facebook Metni"], fields["Hashtagler"]);
  if (!description) throw new Error("Facebook metni boş.");

  const started = await graphPost(`${pageId}/video_reels`, { upload_phase: "start" }, token);
  if (!started.video_id) throw new Error("Facebook Reel video_id alınamadı.");

  const uploadResponse = await fetch(`https://rupload.facebook.com/video-upload/${graphVersion}/${started.video_id}`, {
    method: "POST",
    headers: { Authorization: `OAuth ${token}`, file_url: fields["Video URL"], "Content-Type": "application/octet-stream" }
  });
  const uploadData = await uploadResponse.json().catch(() => ({}));
  if (!uploadResponse.ok || uploadData.success === false) throw new Error(`Facebook Reel video yüklenemedi: ${uploadData.error?.message || `HTTP ${uploadResponse.status}`}`);

  const finished = await graphPost(`${pageId}/video_reels`, { upload_phase: "finish", video_id: started.video_id, video_state: "PUBLISHED", description }, token);
  if (finished.success === false) throw new Error("Facebook Reel yayınlanamadı.");
  return started.video_id;
}

async function publishFacebook(fields, format) {
  if (format === "Reel") return publishFacebookReel(fields);
  requireHttpsUrl(fields["Görsel URL"], "Görsel URL");
  const token = process.env.META_FACEBOOK_PAGE_ACCESS_TOKEN;
  if (format === "Hikâye") {
    if (!facebookStoriesEnabled) return null;
    const uploaded = await graphPost(`${process.env.META_FACEBOOK_PAGE_ID}/photos`, { url: storyImageUrl(fields["Görsel URL"], fields), published: "false" }, token);
    const story = await graphPost(`${process.env.META_FACEBOOK_PAGE_ID}/photo_stories`, { photo_id: uploaded.id }, token);
    return story.post_id || story.id;
  }
  const trackedUrl = withUtm(fields["Kaynak URL"], { source: "facebook", title: fields["Başlık"] });
  const message = joinText(fields["Facebook Metni"], fields["Hashtagler"], trackedUrl);
  if (!message) throw new Error("Facebook metni boş.");
  const published = await graphPost(`${process.env.META_FACEBOOK_PAGE_ID}/photos`, { url: fields["Görsel URL"], caption: message }, token);
  return published.post_id || published.id;
}

function buildXText(fields) {
  const trackedUrl = withUtm(fields["Kaynak URL"], { source: "x", title: fields["Başlık"] });
  const base = joinText(fields["X Metni"] || fields["Facebook Metni"], fields["Hashtagler"]);
  if (!base) throw new Error("X metni boş (Facebook Metni de boş).");
  const limit = X_MAX_CHARS - X_URL_WEIGHT - 1; // 1 = URL'den önceki satır sonu
  const truncatedBase = base.length <= limit ? base : `${base.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
  return `${truncatedBase}\n${trackedUrl}`;
}

// Video (Reel) desteklenmiyor — X'te chunked medya yüklemesi gerektiriyor,
// bkz. src/x-publish.js. Bu formatta X sessizce atlanır (hata değil).
async function publishX(fields, format) {
  if (format === "Reel") return null;
  const imageUrl = fields["Görsel URL"] && /^https:\/\//i.test(fields["Görsel URL"]) ? fields["Görsel URL"] : undefined;
  return publishTweet({ text: buildXText(fields), imageUrl });
}

export async function runPublisher() {
  assertConfiguration();
  const allRecords = await airtableGetApproved();
  const now = new Date();
  const eligible = allRecords.filter((record) => {
    const fields = record.fields || {};
    const platforms = Array.isArray(fields.Platform) ? fields.Platform : [];
    const instagramNeeded = platforms.includes("Instagram") && !fields["Instagram Yayın ID"];
    const facebookNeeded = platforms.includes("Facebook") && !fields["Facebook Yayın ID"];
    const xNeeded = platforms.includes("X") && !fields["X Yayın ID"];
    return canProcess(fields, now.getTime()) && (instagramNeeded || facebookNeeded || xNeeded);
  });
  const records = selectDueRecords(eligible, now, postLimit);
  console.log(`Kuyruk: ${allRecords.length}; zamanı gelmiş ve işlenecek: ${records.length}; canlı: ${livePostingEnabled}`);
  const summary = { queued: allRecords.length, approved: eligible.length, due: records.length, published: 0, failed: 0, skipped: 0 };
  for (const record of records) {
    const fields = record.fields || {};
    const format = publicationFormat(fields);
    const platforms = fields["Platform"] || [];
    console.log(`${fields["Başlık"] || record.id} | ${format} | ${platforms.join(", ")} | ${fields["Yayın Zamanı"]}`);
    if (!livePostingEnabled) { summary.skipped += 1; continue; }
    const attempts = Number(fields["Deneme Sayısı"] || 0);
    if (attempts >= maxAttempts) {
      await updateAirtable(record.id, { Durum: "Hata", "Hata Mesajı": `Maksimum deneme sayısına ulaşıldı (${maxAttempts}). Yeniden denemek için Durum alanını Onaylandı yapın.`, "Deneme Sayısı": attempts });
      console.error(`${fields["Başlık"] || record.id}: maksimum deneme sayısı`);
      await notifyFailure(`Buzsu yayın: "${fields["Başlık"] || record.id}" maksimum deneme sayısına (${maxAttempts}) ulaştı, elle onay bekliyor.`);
      summary.failed += 1;
      continue;
    }
    const updates = {
      Not: buildLease(fields, record.id),
      "Hata Mesajı": "",
      "Deneme Sayısı": attempts + 1
    };
    await updateAirtable(record.id, updates);
    try {
      if (platforms.includes("Instagram") && !fields["Instagram Yayın ID"]) updates["Instagram Yayın ID"] = await publishInstagram(fields, format);
      if (platforms.includes("Facebook") && !fields["Facebook Yayın ID"]) {
        const id = await publishFacebook(fields, format);
        if (id) updates["Facebook Yayın ID"] = id;
      }
      if (platforms.includes("X") && !fields["X Yayın ID"]) {
        const id = await publishX(fields, format);
        if (id) updates["X Yayın ID"] = id;
      }
      if (!platforms.some((p) => p === "Instagram" || p === "Facebook" || p === "X")) throw new Error("Geçerli platform seçilmemiş.");
      updates.Durum = "Paylaşıldı";
      updates.Not = clearLease({ ...fields, Not: updates.Not }, { type: "published", platforms, format });
      await updateAirtable(record.id, updates);
      console.log(`${fields["Başlık"] || record.id}: başarılı`);
      summary.published += 1;
    } catch (error) {
      updates.Durum = "Hata";
      updates["Hata Mesajı"] = String(error.message).slice(0, 10000);
      updates.Not = clearLease({ ...fields, Not: updates.Not }, { type: "failed", error: String(error.message).slice(0, 500) });
      await updateAirtable(record.id, updates);
      console.error(`${fields["Başlık"] || record.id}: ${error.message}`);
      await notifyFailure(`Buzsu yayın hatası: "${fields["Başlık"] || record.id}" — ${error.message}`);
      summary.failed += 1;
    }
  }
  return summary;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runPublisher().catch((error) => { console.error(error.message); process.exit(1); });
}
