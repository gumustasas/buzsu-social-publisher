const ACTIVE_STATUSES = new Set(["Taslak", "Kontrol Edilecek", "Onaylandı", "Yayınlanıyor", "Hata", "Durduruldu", "Paylaşıldı"]);

export function parseJsonNote(value) {
  if (!value) return { note: "", state: {} };
  const text = String(value);
  const marker = "\n\n[BUZSU_SOCIAL_STATE]\n";
  const index = text.indexOf(marker);
  if (index < 0) return { note: text, state: {} };
  try {
    return { note: text.slice(0, index), state: JSON.parse(text.slice(index + marker.length)) };
  } catch {
    return { note: text, state: {} };
  }
}

export function serializeJsonNote(note, state) {
  const cleanNote = String(note || "").replace(/\n\n\[BUZSU_SOCIAL_STATE\]\n[\s\S]*$/, "").trim();
  return `${cleanNote}\n\n[BUZSU_SOCIAL_STATE]\n${JSON.stringify(state)}`;
}

export function appendEvent(fields, event) {
  const parsed = parseJsonNote(fields.Not);
  const events = Array.isArray(parsed.state.events) ? parsed.state.events : [];
  const next = {
    ...parsed.state,
    events: [...events, { at: new Date().toISOString(), ...event }].slice(-30)
  };
  return serializeJsonNote(parsed.note, next);
}

export function leaseIsStale(fields, now = Date.now()) {
  const { state } = parseJsonNote(fields.Not);
  return Boolean(state.leaseUntil && Date.parse(state.leaseUntil) <= now);
}

export function canProcess(fields, now = Date.now()) {
  const status = fields.Durum || "Taslak";
  if (status === "Onaylandı") return !parseJsonNote(fields.Not).state.leaseUntil || leaseIsStale(fields, now);
  return status === "Yayınlanıyor" && leaseIsStale(fields, now);
}

export function buildLease(fields, recordId, leaseMinutes = 10) {
  const parsed = parseJsonNote(fields.Not);
  const state = {
    ...parsed.state,
    recordId,
    leaseUntil: new Date(Date.now() + leaseMinutes * 60 * 1000).toISOString()
  };
  return serializeJsonNote(parsed.note, state);
}

export function clearLease(fields, event) {
  const parsed = parseJsonNote(fields.Not);
  const state = { ...parsed.state };
  delete state.leaseUntil;
  delete state.recordId;
  const events = Array.isArray(state.events) ? state.events : [];
  state.events = [...events, { at: new Date().toISOString(), ...event }].slice(-30);
  return serializeJsonNote(parsed.note, state);
}

export function isKnownStatus(value) {
  return ACTIVE_STATUSES.has(value);
}

const MEDIA_ITEM_TYPES = new Set(["image", "video"]);

// Airtable "Media Items" alanı bir JSON string'dir (bkz. src/lib/products.js
// createDraftRecord, src/publish-approved.js parseMediaItems). O parser
// YAYIN ANINDA bilinçli olarak throw ediyor (bozuk kayıt yayını durdurmalı).
// Burada tam tersi gerekiyor: panel kuyruğu (api/queue.js) ve get_draft
// (api/mcp.js) SALT-OKUNUR yollar — tek bir bozuk/eski kayıt yüzünden tüm
// kuyruk listesi veya bir get_draft çağrısı asla çökmemeli. Bu yüzden ayrı,
// hiçbir zaman throw etmeyen bir parser: geçersiz JSON/dizi/öğe sessizce
// filtrelenir, kısa bir `warning` ile birlikte döner.
export function parseMediaItemsSafe(raw) {
  if (!raw) return { mediaItems: [], warning: null };
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { mediaItems: [], warning: "Media Items alanı geçerli bir JSON dizisi değil." };
  }
  if (!Array.isArray(parsed)) return { mediaItems: [], warning: "Media Items alanı bir dizi değil." };
  const mediaItems = parsed.filter((item) => item && MEDIA_ITEM_TYPES.has(item.type) && typeof item.url === "string" && item.url);
  const warning = mediaItems.length !== parsed.length ? "Media Items içinde bazı öğeler eksik/geçersiz biçimde, atlandı." : null;
  return { mediaItems, warning };
}

// api/queue.js (panel) ve api/mcp.js (get_draft MCP aracı) aynı Airtable
// kaydını iki farklı şekle çeviriyordu — bu, ikisinin de ihtiyaç duyduğu
// çekirdek alanları (Carousel dahil) tek bir yerden üretir; her çağıran
// kendi ek alanlarını (events, isArchived, vb.) üstüne ekleyebilir.
export function normalizeDraftFields(fields) {
  const { mediaItems, warning } = parseMediaItemsSafe(fields["Media Items"]);
  return {
    title: fields["Başlık"] || "Başlıksız içerik",
    status: fields.Durum || "Taslak",
    format: fields["Yayın Biçimi"] || "Gönderi",
    platforms: fields.Platform || [],
    publishAt: fields["Yayın Zamanı"] || null,
    instagramText: fields["Instagram Metni"] || "",
    facebookText: fields["Facebook Metni"] || "",
    hashtags: fields.Hashtagler || "",
    imageUrl: fields["Görsel URL"] || "",
    videoUrl: fields["Video URL"] || "",
    mediaItems,
    mediaCount: mediaItems.length,
    ...(warning ? { mediaItemsWarning: warning } : {})
  };
}
