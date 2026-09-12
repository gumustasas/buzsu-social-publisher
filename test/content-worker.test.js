import test from "node:test";
import assert from "node:assert/strict";
import { buildDraft } from "../src/content-worker.js";

const product = { title: "Code Su Arıtma Cihazı", url: "https://www.buzsu.com.tr/code-su-aritma-cihazi/", imageUrl: "https://www.buzsu.com.tr/code.png" };

test("content worker builds a safe draft with platform text", () => {
  const draft = buildDraft(product, { format: "Gönderi", platforms: ["Instagram", "Facebook"], publishAt: "2026-08-20T10:00:00.000Z" });
  assert.equal(draft.valid, true);
  assert.match(draft.instagramText, /code-su-aritma-cihazi/);
  assert.match(draft.facebookText, /Code/);
  assert.equal(draft.warnings.length, 0);
});

test("content worker warns about the Instagram story link limitation", () => {
  const draft = buildDraft(product, { format: "Hikâye", platforms: ["Instagram"] });
  assert.equal(draft.valid, true);
  assert.match(draft.warnings.join(" "), /bağlantı etiketi/);
});

test("content worker uses the AI caption override instead of the canned template, and still appends the product link", () => {
  const draft = buildDraft(product, {
    format: "Gönderi",
    platforms: ["Instagram", "Facebook"],
    publishAt: "2026-08-20T10:00:00.000Z",
    captionOverride: { instagramText: "AI Instagram metni", facebookText: "AI Facebook metni", hashtags: "#Buzsu #Test" }
  });
  assert.equal(draft.valid, true);
  assert.match(draft.instagramText, /^AI Instagram metni/);
  assert.match(draft.instagramText, /code-su-aritma-cihazi/);
  assert.match(draft.facebookText, /^AI Facebook metni/);
  assert.equal(draft.hashtags, "#Buzsu #Test");
});

test("content worker uses the product's existing catalog text (Airtable Instagram/Facebook Metni) as-is, with no extra link appended, when allowCatalogCaption is set and no captionOverride is given", () => {
  const productWithCatalogText = {
    ...product,
    // Gerçek katalog metinleri her zaman kendi "Detaylar:"/"Ürünü inceleyin:"
    // linkini zaten içerir (bkz. src/lib/products.js) — burada da öyle.
    instagramText: "Evde taze, temiz ve alkali suya ulaşmak artık çok kolay!\n\nDetaylar: https://www.buzsu.com.tr/code-su-aritma-cihazi/",
    facebookText: "Mutfakta konforu ve temiz suyu bir arada yaşamak isteyenler için harika bir öneri.\n\nÜrünü inceleyin: https://www.buzsu.com.tr/code-su-aritma-cihazi/"
  };
  const draft = buildDraft(productWithCatalogText, { format: "Gönderi", platforms: ["Instagram", "Facebook"], publishAt: "2026-08-20T10:00:00.000Z", allowCatalogCaption: true });
  assert.equal(draft.instagramText, productWithCatalogText.instagramText, "must be used verbatim — the catalog text already ends with its own link, appending another would duplicate it");
  assert.equal(draft.facebookText, productWithCatalogText.facebookText);
  assert.equal((draft.instagramText.match(/https:\/\//g) || []).length, 1, "must not contain a duplicated link");
  assert.equal(draft.hashtags, "#Buzsu #SuArıtma #SuArıtmaCihazı");
});

test("content worker ignores the product's catalog text when allowCatalogCaption is not set (dashboard composer path — variant selection must keep working)", () => {
  const productWithCatalogText = { ...product, instagramText: "Katalogdaki metin", facebookText: "Katalogdaki metin" };
  const draft = buildDraft(productWithCatalogText, { format: "Gönderi", platforms: ["Instagram", "Facebook"], publishAt: "2026-08-20T10:00:00.000Z", variant: 1 });
  assert.doesNotMatch(draft.instagramText, /Katalogdaki metin/, "without allowCatalogCaption the generic, variant-driven template must be used, exactly as before this feature existed");
});

test("content worker still falls back to the generic template when the product has no catalog text at all, even with allowCatalogCaption:true", () => {
  const draft = buildDraft({ ...product, instagramText: "", facebookText: "" }, { format: "Gönderi", platforms: ["Instagram", "Facebook"], publishAt: "2026-08-20T10:00:00.000Z", allowCatalogCaption: true });
  assert.match(draft.instagramText, /Code kapalı kasa su arıtma cihazı|filtre yapısını ve seçeneklerini|Günlük kullanım için Code/);
});

test("content worker prefers an explicit captionOverride over the product's own catalog text", () => {
  const productWithCatalogText = { ...product, instagramText: "Katalogdaki eski metin", facebookText: "Katalogdaki eski metin" };
  const draft = buildDraft(productWithCatalogText, {
    format: "Gönderi",
    platforms: ["Instagram", "Facebook"],
    publishAt: "2026-08-20T10:00:00.000Z",
    allowCatalogCaption: true,
    captionOverride: { instagramText: "Yeni AI metni", facebookText: "Yeni AI metni", hashtags: "#Buzsu #Test" }
  });
  assert.match(draft.instagramText, /^Yeni AI metni/);
});

test("content worker does not compound an already-suffixed product title (regression for the accumulating-title bug)", () => {
  const polluted = { ...product, title: "Code Su Arıtma Cihazı | Hikâye 1 | Hikâye | Hikâye" };
  const draft = buildDraft(polluted, { format: "Gönderi", platforms: ["Instagram", "Facebook"], publishAt: "2026-08-20T10:00:00.000Z" });
  assert.equal(draft.title, "Code Su Arıtma Cihazı | Gönderi");
});

test("content worker requires an HTTPS video URL for the Reel format", () => {
  const draft = buildDraft(product, { format: "Reel", platforms: ["Instagram", "Facebook"], publishAt: "2026-08-20T10:00:00.000Z" });
  assert.equal(draft.valid, false);
  assert.match(draft.warnings.join(" "), /Reel için herkese açık HTTPS video URL/);
});

test("content worker accepts a Reel draft once a valid video URL is provided", () => {
  const draft = buildDraft({ ...product, videoUrl: "https://blob.vercel-storage.com/video.mp4" }, { format: "Reel", platforms: ["Instagram", "Facebook"], publishAt: "2026-08-20T10:00:00.000Z" });
  assert.equal(draft.valid, true);
});

test("content worker accepts a Carousel draft with 2 image mediaItems and does not require imageUrl/videoUrl", () => {
  const carouselProduct = { title: "Code Su Arıtma Cihazı", url: product.url, mediaItems: [
    { type: "image", url: "https://blob.vercel-storage.com/img1.jpg" },
    { type: "image", url: "https://blob.vercel-storage.com/img2.jpg" }
  ] };
  const draft = buildDraft(carouselProduct, { format: "Carousel", platforms: ["Instagram"], publishAt: "2026-08-20T10:00:00.000Z" });
  assert.equal(draft.valid, true);
  assert.equal(draft.warnings.length, 0);
});

test("content worker accepts a Carousel draft mixing images and a video for Instagram", () => {
  const carouselProduct = { title: "Code Su Arıtma Cihazı", url: product.url, mediaItems: [
    { type: "image", url: "https://blob.vercel-storage.com/img1.jpg" },
    { type: "image", url: "https://blob.vercel-storage.com/img2.jpg" },
    { type: "video", url: "https://blob.vercel-storage.com/video.mp4" }
  ] };
  const draft = buildDraft(carouselProduct, { format: "Carousel", platforms: ["Instagram"], publishAt: "2026-08-20T10:00:00.000Z" });
  assert.equal(draft.valid, true);
});

test("content worker rejects a Carousel draft with fewer than 2 mediaItems", () => {
  const carouselProduct = { title: "Code Su Arıtma Cihazı", url: product.url, mediaItems: [{ type: "image", url: "https://blob.vercel-storage.com/img1.jpg" }] };
  const draft = buildDraft(carouselProduct, { format: "Carousel", platforms: ["Instagram"], publishAt: "2026-08-20T10:00:00.000Z" });
  assert.equal(draft.valid, false);
  assert.match(draft.warnings.join(" "), /en az 2 medya öğesi/);
});

test("content worker rejects a Carousel draft with more than 10 mediaItems (Instagram limit)", () => {
  const mediaItems = Array.from({ length: 11 }, (_, index) => ({ type: "image", url: `https://blob.vercel-storage.com/img${index}.jpg` }));
  const carouselProduct = { title: "Code Su Arıtma Cihazı", url: product.url, mediaItems };
  const draft = buildDraft(carouselProduct, { format: "Carousel", platforms: ["Instagram"], publishAt: "2026-08-20T10:00:00.000Z" });
  assert.equal(draft.valid, false);
  assert.match(draft.warnings.join(" "), /en fazla 10 medya öğesi/);
});

test("content worker rejects a Carousel draft with an invalid mediaItems entry (missing type / non-HTTPS url)", () => {
  const carouselProduct = { title: "Code Su Arıtma Cihazı", url: product.url, mediaItems: [
    { type: "image", url: "https://blob.vercel-storage.com/img1.jpg" },
    { type: "audio", url: "https://blob.vercel-storage.com/clip.mp3" }
  ] };
  const draft = buildDraft(carouselProduct, { format: "Carousel", platforms: ["Instagram"], publishAt: "2026-08-20T10:00:00.000Z" });
  assert.equal(draft.valid, false);
  assert.match(draft.warnings.join(" "), /mediaItems içindeki her öğe/);
});

test("content worker rejects a Facebook Carousel that mixes image and video (UNSUPPORTED_FACEBOOK_MEDIA_COMBINATION) but allows the same mediaItems for Instagram-only", () => {
  const mediaItems = [
    { type: "image", url: "https://blob.vercel-storage.com/img1.jpg" },
    { type: "video", url: "https://blob.vercel-storage.com/video.mp4" }
  ];
  const carouselProduct = { title: "Code Su Arıtma Cihazı", url: product.url, mediaItems };
  const facebookDraft = buildDraft(carouselProduct, { format: "Carousel", platforms: ["Instagram", "Facebook"], publishAt: "2026-08-20T10:00:00.000Z" });
  assert.equal(facebookDraft.valid, false);
  assert.match(facebookDraft.warnings.join(" "), /UNSUPPORTED_FACEBOOK_MEDIA_COMBINATION/);
  const instagramOnlyDraft = buildDraft(carouselProduct, { format: "Carousel", platforms: ["Instagram"], publishAt: "2026-08-20T10:00:00.000Z" });
  assert.equal(instagramOnlyDraft.valid, true);
});

test("content worker allows a Facebook Carousel when mediaItems are image-only", () => {
  const mediaItems = [
    { type: "image", url: "https://blob.vercel-storage.com/img1.jpg" },
    { type: "image", url: "https://blob.vercel-storage.com/img2.jpg" },
    { type: "image", url: "https://blob.vercel-storage.com/img3.jpg" }
  ];
  const carouselProduct = { title: "Code Su Arıtma Cihazı", url: product.url, mediaItems };
  const draft = buildDraft(carouselProduct, { format: "Carousel", platforms: ["Instagram", "Facebook"], publishAt: "2026-08-20T10:00:00.000Z" });
  assert.equal(draft.valid, true);
});

test("content worker still flags risky claims coming from an AI caption override", () => {
  const draft = buildDraft(product, {
    format: "Gönderi",
    platforms: ["Instagram", "Facebook"],
    publishAt: "2026-08-20T10:00:00.000Z",
    captionOverride: { instagramText: "Bu ürün hastalığı tedavi eder", facebookText: "AI Facebook metni" }
  });
  assert.equal(draft.valid, false);
  assert.match(draft.warnings.join(" "), /Kanıtsız sağlık/);
});
