import test from "node:test";
import assert from "node:assert/strict";
import { buildVideoPromptSections, renderVideoPrompt, hashVideoPrompt, buildVideoPrompt, MAX_VIDEO_PROMPT_LENGTH } from "../src/lib/video-prompt.js";

test("buildVideoPromptSections falls back to a generic MOTION when none is given", () => {
  const sections = buildVideoPromptSections({ productTitle: "Code Advantage" });
  assert.match(sections.motion, /Kamera hafifçe yaklaşsın/);
});

test("buildVideoPromptSections uses the given motion verbatim", () => {
  const sections = buildVideoPromptSections({ productTitle: "Code Advantage", motion: "Baba sürahiye su doldursun, kamera yavaşça yaklaşsın." });
  assert.equal(sections.motion, "Baba sürahiye su doldursun, kamera yavaşça yaklaşsın.");
});

test("buildVideoPromptSections does not hardcode scene-specific nouns (dolap/musluk/aile) — only the product title is a variable", () => {
  const sections = buildVideoPromptSections({ productTitle: "Kartuşlu Filtre" });
  assert.match(sections.preserve, /Kartuşlu Filtre/);
  assert.doesNotMatch(sections.preserve, /dolap|musluk|aile/i);
  assert.doesNotMatch(sections.constraints, /dolap|musluk|aile/i);
});

test("renderVideoPrompt produces labeled REFERENCE/PRESERVE/MOTION/CAMERA/CONSTRAINTS blocks", () => {
  const sections = buildVideoPromptSections({ productTitle: "Code Advantage", motion: "test hareketi" });
  const prompt = renderVideoPrompt(sections);
  for (const label of ["REFERENCE:", "PRESERVE:", "MOTION:", "CAMERA:", "CONSTRAINTS:"]) {
    assert.match(prompt, new RegExp(label));
  }
  assert.match(prompt, /test hareketi/);
});

test("hashVideoPrompt is deterministic for identical input and changes when the prompt changes", () => {
  const a = renderVideoPrompt(buildVideoPromptSections({ productTitle: "Code Advantage", motion: "A" }));
  const b = renderVideoPrompt(buildVideoPromptSections({ productTitle: "Code Advantage", motion: "A" }));
  const c = renderVideoPrompt(buildVideoPromptSections({ productTitle: "Code Advantage", motion: "B" }));
  assert.equal(hashVideoPrompt(a), hashVideoPrompt(b));
  assert.notEqual(hashVideoPrompt(a), hashVideoPrompt(c));
});

test("buildVideoPrompt is a thin convenience wrapper around sections+render", () => {
  const prompt = buildVideoPrompt("Code Advantage", "hareket metni");
  assert.equal(prompt, renderVideoPrompt(buildVideoPromptSections({ productTitle: "Code Advantage", motion: "hareket metni" })));
});

test("a 1200-character motion (the dashboard textarea's maxlength) stays under fal.ai's MAX_VIDEO_PROMPT_LENGTH", () => {
  const motion = "a".repeat(1200);
  const prompt = renderVideoPrompt(buildVideoPromptSections({ productTitle: "Code Su Arıtma Cihazı", motion }));
  assert.ok(prompt.length <= MAX_VIDEO_PROMPT_LENGTH, `prompt was ${prompt.length} chars, expected <= ${MAX_VIDEO_PROMPT_LENGTH}`);
});

test("an excessively long motion pushes the rendered prompt past MAX_VIDEO_PROMPT_LENGTH (api/reels.js rejects this before calling fal.ai/Veo)", () => {
  const motion = "a".repeat(2000);
  const prompt = renderVideoPrompt(buildVideoPromptSections({ productTitle: "Code Advantage", motion }));
  assert.ok(prompt.length > MAX_VIDEO_PROMPT_LENGTH);
});
