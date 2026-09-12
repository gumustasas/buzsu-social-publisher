import test from "node:test";
import assert from "node:assert/strict";
import { appendEvent, buildLease, canProcess, clearLease, leaseIsStale, parseJsonNote, parseMediaItemsSafe, normalizeDraftFields, buildRecentQueueFilter } from "../src/lib/queue.js";

test("queue state is stored without destroying the user note", () => {
  const note = buildLease({ Not: "Müşteri için hazırlandı" }, "rec123", 10);
  const parsed = parseJsonNote(note);
  assert.equal(parsed.note, "Müşteri için hazırlandı");
  assert.equal(parsed.state.recordId, "rec123");
  assert.equal(leaseIsStale({ Not: note }), false);
  assert.equal(parseJsonNote(buildLease({}, "rec-empty")).state.recordId, "rec-empty");
});

test("stale publishing records can be recovered", () => {
  const stale = { Not: "Kayıt\n\n[BUZSU_SOCIAL_STATE]\n{\"leaseUntil\":\"2000-01-01T00:00:00.000Z\"}" };
  assert.equal(leaseIsStale(stale), true);
  assert.equal(canProcess({ Durum: "Yayınlanıyor", Not: stale.Not }), true);
});

test("active lease blocks a second run while keeping the approved status", () => {
  const leased = buildLease({ Not: "Onaylı kayıt" }, "rec-approved", 10);
  assert.equal(canProcess({ Durum: "Onaylandı", Not: leased }), false);
  assert.equal(canProcess({ Durum: "Onaylandı", Not: leased }, Date.now() + 11 * 60 * 1000), true);
});

test("events are bounded and clear lease", () => {
  let note = "";
  for (let i = 0; i < 40; i += 1) note = appendEvent({ Not: note }, { type: "test", index: i });
  const cleared = clearLease({ Not: note }, { type: "published" });
  const parsed = parseJsonNote(cleared);
  assert.equal(parsed.state.leaseUntil, undefined);
  assert.equal(parsed.state.events.length, 30);
  assert.equal(parsed.state.events.at(-1).type, "published");
});

test("parseMediaItemsSafe returns an empty array (no warning) for an empty/undefined Media Items field", () => {
  assert.deepEqual(parseMediaItemsSafe(""), { mediaItems: [], warning: null });
  assert.deepEqual(parseMediaItemsSafe(undefined), { mediaItems: [], warning: null });
  assert.deepEqual(parseMediaItemsSafe(null), { mediaItems: [], warning: null });
});

test("parseMediaItemsSafe never throws on malformed JSON or a non-array — it returns [] with a warning instead", () => {
  const malformed = parseMediaItemsSafe("bu json değil {{{");
  assert.deepEqual(malformed.mediaItems, []);
  assert.match(malformed.warning, /JSON dizisi değil/);
  const notArray = parseMediaItemsSafe(JSON.stringify({ type: "image", url: "https://a" }));
  assert.deepEqual(notArray.mediaItems, []);
  assert.match(notArray.warning, /bir dizi değil/);
});

test("parseMediaItemsSafe preserves image and video types, in order, for a valid array", () => {
  const raw = JSON.stringify([
    { type: "image", url: "https://a.example/1.jpg" },
    { type: "video", url: "https://a.example/2.mp4" },
    { type: "image", url: "https://a.example/3.jpg" }
  ]);
  const { mediaItems, warning } = parseMediaItemsSafe(raw);
  assert.equal(warning, null);
  assert.deepEqual(mediaItems.map((item) => item.type), ["image", "video", "image"]);
  assert.equal(mediaItems[1].url, "https://a.example/2.mp4");
});

test("parseMediaItemsSafe silently filters out individually invalid entries and flags a warning, instead of discarding the whole array", () => {
  const raw = JSON.stringify([
    { type: "image", url: "https://a.example/1.jpg" },
    { type: "audio", url: "https://a.example/bad.mp3" },
    { type: "image" },
    { type: "video", url: "https://a.example/2.mp4" }
  ]);
  const { mediaItems, warning } = parseMediaItemsSafe(raw);
  assert.equal(mediaItems.length, 2);
  assert.deepEqual(mediaItems.map((item) => item.type), ["image", "video"]);
  assert.match(warning, /eksik\/geçersiz/);
});

test("normalizeDraftFields reads a plain Gönderi record exactly as before — mediaItems is an empty array, no mediaItemsWarning key", () => {
  const fields = {
    "Başlık": "Code Su Arıtma Cihazı | Gönderi",
    "Durum": "Taslak",
    "Yayın Biçimi": "Gönderi",
    "Platform": ["Instagram", "Facebook"],
    "Yayın Zamanı": "2026-08-20T10:00:00.000Z",
    "Instagram Metni": "Merhaba IG",
    "Facebook Metni": "Merhaba FB",
    "Hashtagler": "#Buzsu",
    "Görsel URL": "https://example.com/photo.jpg"
  };
  const normalized = normalizeDraftFields(fields);
  assert.equal(normalized.format, "Gönderi");
  assert.equal(normalized.imageUrl, "https://example.com/photo.jpg");
  assert.equal(normalized.videoUrl, "");
  assert.deepEqual(normalized.mediaItems, []);
  assert.equal(normalized.mediaCount, 0);
  assert.ok(!("mediaItemsWarning" in normalized));
});

test("normalizeDraftFields returns exactly 10 mediaItems for a Carousel record, preserving image/video types", () => {
  const mediaItems = Array.from({ length: 10 }, (_, index) => ({
    type: index % 3 === 0 ? "video" : "image",
    url: `https://example.com/media${index}.${index % 3 === 0 ? "mp4" : "jpg"}`
  }));
  const fields = {
    "Başlık": "Code Su Arıtma Cihazı | Carousel",
    "Durum": "Taslak",
    "Yayın Biçimi": "Carousel",
    "Platform": ["Instagram"],
    "Media Items": JSON.stringify(mediaItems)
  };
  const normalized = normalizeDraftFields(fields);
  assert.equal(normalized.format, "Carousel");
  assert.equal(normalized.mediaCount, 10);
  assert.equal(normalized.mediaItems.length, 10);
  assert.deepEqual(normalized.mediaItems.map((item) => item.type), mediaItems.map((item) => item.type));
  assert.deepEqual(normalized.mediaItems.map((item) => item.url), mediaItems.map((item) => item.url));
});

test("normalizeDraftFields never throws on a corrupt/broken Media Items field — it degrades to an empty mediaItems array with a warning", () => {
  const fields = { "Başlık": "Bozuk kayıt", "Yayın Biçimi": "Carousel", "Media Items": "{not valid json" };
  const normalized = normalizeDraftFields(fields);
  assert.deepEqual(normalized.mediaItems, []);
  assert.equal(normalized.mediaCount, 0);
  assert.match(normalized.mediaItemsWarning, /JSON dizisi değil/);
});

test("buildRecentQueueFilter keeps every non-published record and only recently-published archive records", () => {
  const formula = buildRecentQueueFilter(90);
  assert.equal(formula, "OR({Durum}!='Paylaşıldı',{Yayın Zamanı}=BLANK(),IS_AFTER({Yayın Zamanı},DATEADD(TODAY(),-90,'days')))");
});

test("buildRecentQueueFilter interpolates the requested day window", () => {
  assert.match(buildRecentQueueFilter(30), /DATEADD\(TODAY\(\),-30,'days'\)/);
  assert.match(buildRecentQueueFilter(365), /DATEADD\(TODAY\(\),-365,'days'\)/);
});
