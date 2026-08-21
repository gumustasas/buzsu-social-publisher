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
