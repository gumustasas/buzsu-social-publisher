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
