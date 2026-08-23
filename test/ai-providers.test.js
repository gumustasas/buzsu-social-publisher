import test from "node:test";
import assert from "node:assert/strict";
import { availableProviders, generateScenePlan, generateCaption, generateMotionPlan } from "../src/ai-providers.js";

test("AI provider availability is derived from configured keys", () => {
  assert.deepEqual(availableProviders({ OPENAI_API_KEY: "x", ANTHROPIC_API_KEY: "", GEMINI_API_KEY: "y" }), ["openai", "gemini", "veo"]);
  assert.deepEqual(availableProviders({ FAL_KEY: "fal-test" }), ["fal"]);
});

test("generateScenePlan rejects an unsupported provider before making any network call", async () => {
  await assert.rejects(
    () => generateScenePlan("anthropic", { title: "Code Advantage" }, {}),
    /Desteklenmeyen AI sağlayıcısı/
  );
});

test("generateCaption rejects an unsupported provider before making any network call", async () => {
  await assert.rejects(
    () => generateCaption("fal", { title: "Code Advantage" }, {}),
    /Desteklenmeyen AI sağlayıcısı/
  );
});

// Panelde AI sağlayıcısı dropdown'u sahne GÖRSELİ ve sahne planı/başlık/
// hareket METNİ arasında paylaşılıyor (bkz. dashboard.html #scene-provider).
// "gemini-2.5-flash" yalnızca görsel modeli seçimi içindir (bkz.
// src/scene-image.js) — metin üretim fonksiyonlarına ulaştığında reddedilip
// "Desteklenmeyen AI sağlayıcısı." hatası vermemeli, sıradan "gemini" gibi
// çalışmalı. Bu, panelde "Sahne planı üret (AI)" butonunun gerçek bir bug'ı.
test("generateScenePlan treats provider 'gemini-2.5-flash' the same as 'gemini' instead of rejecting it", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: "test sahne" }] } }] }) });
  try {
    const plan = await generateScenePlan("gemini-2.5-flash", { title: "Code Advantage" }, { GEMINI_API_KEY: "test" });
    assert.equal(plan, "test sahne");
  } finally {
    global.fetch = originalFetch;
  }
});

test("generateCaption treats provider 'gemini-2.5-flash' the same as 'gemini' instead of rejecting it", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"instagramText":"a","facebookText":"b","hashtags":"#Buzsu"}' }] } }] }) });
  try {
    const caption = await generateCaption("gemini-2.5-flash", { title: "Code Advantage" }, { GEMINI_API_KEY: "test" });
    assert.equal(caption.instagramText, "a");
  } finally {
    global.fetch = originalFetch;
  }
});

test("generateMotionPlan treats provider 'gemini-2.5-flash' the same as 'gemini' instead of rejecting it", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: "kamera yavaşça yaklaşır" }] } }] }) });
  try {
    const motion = await generateMotionPlan("gemini-2.5-flash", "mutfak", { GEMINI_API_KEY: "test" });
    assert.equal(motion, "kamera yavaşça yaklaşır");
  } finally {
    global.fetch = originalFetch;
  }
});
