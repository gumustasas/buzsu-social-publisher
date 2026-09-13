import test from "node:test";
import assert from "node:assert/strict";
import { buildSceneConcatFfmpegArgs } from "../src/lib/reel-scene-concat-ffmpeg.js";

test("buildSceneConcatFfmpegArgs requires at least one scenePath", () => {
  assert.throws(() => buildSceneConcatFfmpegArgs({ scenePaths: [], outputPath: "o.mp4" }), /scenePaths/);
  assert.throws(() => buildSceneConcatFfmpegArgs({ outputPath: "o.mp4" }), /scenePaths/);
});

test("buildSceneConcatFfmpegArgs requires outputPath", () => {
  assert.throws(() => buildSceneConcatFfmpegArgs({ scenePaths: ["a.mp4"] }), /outputPath/);
});

test("buildSceneConcatFfmpegArgs: single scene is stream-copied without concat filter", () => {
  const { args, skippedConcat } = buildSceneConcatFfmpegArgs({ scenePaths: ["scene-0.mp4"], outputPath: "o.mp4" });
  assert.equal(skippedConcat, true);
  assert.doesNotMatch(args.join(" "), /concat=/);
  assert.equal(args.at(-1), "o.mp4");
  const idx = args.indexOf("-c:v");
  assert.equal(args[idx + 1], "copy");
  assert.ok(args.includes("-an"), "tek sahne için de ses akışı dahil edilmemeli");
});

test("buildSceneConcatFfmpegArgs: multiple scenes are joined in the given order via the concat filter, video-only", () => {
  const { args, skippedConcat } = buildSceneConcatFfmpegArgs({ scenePaths: ["scene-0.mp4", "scene-1.mp4", "scene-2.mp4"], outputPath: "o.mp4" });
  assert.equal(skippedConcat, false);
  // Girdi sırası korunmalı — scene-0 her zaman scene-1'den ÖNCE -i olarak eklenmeli.
  assert.ok(args.indexOf("scene-0.mp4") < args.indexOf("scene-1.mp4"));
  assert.ok(args.indexOf("scene-1.mp4") < args.indexOf("scene-2.mp4"));
  const filterIndex = args.indexOf("-filter_complex");
  const filter = args[filterIndex + 1];
  assert.match(filter, /^\[0:v\]\[1:v\]\[2:v\]concat=n=3:v=1:a=0\[outv\]$/);
  assert.doesNotMatch(filter, /:a=1/);
  assert.equal(args.at(-1), "o.mp4");
});

test("buildSceneConcatFfmpegArgs: concat step re-encodes video (concat filter cannot stream-copy)", () => {
  const { args } = buildSceneConcatFfmpegArgs({ scenePaths: ["scene-0.mp4", "scene-1.mp4"], outputPath: "o.mp4" });
  const idx = args.indexOf("-c:v");
  assert.equal(args[idx + 1], "libx264");
});
