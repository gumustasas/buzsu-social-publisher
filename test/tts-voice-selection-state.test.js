import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const client = await readFile(new URL("../dashboard-reels-v2.js", import.meta.url), "utf8");

test("AI Reels V2 voice gender change persists the selected value before rerender", () => {
  const listener = client.match(/byId\("reels-v2-voice-gender"\)\.addEventListener\("change",[\s\S]*?\n\s*\}\);/);
  assert.ok(listener, "voice gender change listener bulunamadı");
  const source = listener[0];
  const assignIndex = source.indexOf("state.narration.gender = event.target.value");
  const renderIndex = source.indexOf("renderAudioStage()");
  assert.ok(assignIndex >= 0, "seçilen gender state'e yazılmalı");
  assert.ok(renderIndex > assignIndex, "state güncellemesi renderAudioStage öncesinde yapılmalı");
});

test("TTS request uses the persisted narration gender", () => {
  const start = client.indexOf("async function generateNarrationVoiceover()");
  const end = client.indexOf("async function pollMusic()", start);
  assert.ok(start >= 0 && end > start, "generateNarrationVoiceover fonksiyon aralığı bulunamadı");
  const source = client.slice(start, end);
  assert.match(source, /gender:\s*state\.narration\.gender/);
});
