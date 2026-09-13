import test from "node:test";
import assert from "node:assert/strict";
import { buildVideoPromptSections, renderVideoPrompt, hashVideoPrompt, buildVideoPrompt } from "../src/lib/video-prompt.js";

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

// Türkçe seslendirme + Lyria müzik + FFmpeg mix mimarisi eklenince Veo/fal'ın
// kendi sesi (varsa) bu katmanlarla çakışır — bu yüzden varsayılan olarak
// "sessiz video" kısıtı eklenir; kullanıcı allowNativeAudio:true ile bunu
// kaldırabilir (bkz. api/reels.js).
test("buildVideoPromptSections adds a 'no audio' constraint by default (Veo/fal native audio would collide with the TTS+Lyria+FFmpeg mix pipeline)", () => {
  const sections = buildVideoPromptSections({ productTitle: "Code Advantage" });
  assert.match(sections.constraints, /Sessiz video/);
});

test("buildVideoPromptSections omits the 'no audio' constraint when allowNativeAudio:true is explicitly given", () => {
  const sections = buildVideoPromptSections({ productTitle: "Code Advantage", allowNativeAudio: true });
  assert.doesNotMatch(sections.constraints, /Sessiz video/);
});

test("buildVideoPrompt forwards its third argument as allowNativeAudio", () => {
  const promptDefault = buildVideoPrompt("Code Advantage", "hareket metni");
  const promptWithAudio = buildVideoPrompt("Code Advantage", "hareket metni", true);
  assert.match(promptDefault, /Sessiz video/);
  assert.doesNotMatch(promptWithAudio, /Sessiz video/);
});
