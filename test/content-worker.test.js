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
