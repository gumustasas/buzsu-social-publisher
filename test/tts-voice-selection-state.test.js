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
  const fn = client.match(/async function generateNarrationVoiceover\(\) \{[\s\S]*?\n\s*\}/);
  assert.ok(fn, "generateNarrationVoiceover bulunamadı");
  assert.match(fn[0], /gender:\s*state\.narration\.gender/);
});
