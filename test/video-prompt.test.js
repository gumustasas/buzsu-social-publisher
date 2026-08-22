import test from "node:test";
import assert from "node:assert/strict";
import { buildVideoPrompt } from "../src/lib/video-prompt.js";

test("buildVideoPrompt uses a generic scene when no sceneDescription is given", () => {
  const prompt = buildVideoPrompt("Code Advantage", undefined);
  assert.match(prompt, /^Buzsu Code Advantage ürünü için 9:16 sosyal medya Reels videosu\. Ürünün şeklini/);
  assert.doesNotMatch(prompt, /Sahne:/);
});

test("buildVideoPrompt folds in the AI scene description when given", () => {
  const prompt = buildVideoPrompt("Code Advantage", "modern bir mutfak tezgahı, sabah gün ışığı");
  assert.match(prompt, /Sahne: modern bir mutfak tezgahı, sabah gün ışığı\./);
});

test("buildVideoPrompt ignores blank/whitespace-only scene descriptions", () => {
  const prompt = buildVideoPrompt("Code Advantage", "   ");
  assert.doesNotMatch(prompt, /Sahne:/);
});
