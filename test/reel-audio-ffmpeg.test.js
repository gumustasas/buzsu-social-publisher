import test from "node:test";
import assert from "node:assert/strict";
import { buildReelAudioFfmpegArgs } from "../src/lib/reel-audio-ffmpeg.js";

test("buildReelAudioFfmpegArgs requires videoPath", () => {
  assert.throws(() => buildReelAudioFfmpegArgs({ voiceoverPath: "v.wav", videoDurationSeconds: 5, outputPath: "o.mp4" }), /videoPath/);
});

test("buildReelAudioFfmpegArgs requires at least one of voiceoverPath/musicPath", () => {
  assert.throws(() => buildReelAudioFfmpegArgs({ videoPath: "in.mp4", videoDurationSeconds: 5, outputPath: "o.mp4" }), /voiceoverPath.*musicPath/);
});

test("buildReelAudioFfmpegArgs requires a positive videoDurationSeconds", () => {
  assert.throws(() => buildReelAudioFfmpegArgs({ videoPath: "in.mp4", voiceoverPath: "v.wav", outputPath: "o.mp4" }), /videoDurationSeconds/);
  assert.throws(() => buildReelAudioFfmpegArgs({ videoPath: "in.mp4", voiceoverPath: "v.wav", videoDurationSeconds: 0, outputPath: "o.mp4" }), /videoDurationSeconds/);
});

test("buildReelAudioFfmpegArgs requires outputPath", () => {
  assert.throws(() => buildReelAudioFfmpegArgs({ videoPath: "in.mp4", voiceoverPath: "v.wav", videoDurationSeconds: 5 }), /outputPath/);
});

test("buildReelAudioFfmpegArgs keeps the video stream copied (-c:v copy), never re-encoded", () => {
  const { args } = buildReelAudioFfmpegArgs({ videoPath: "in.mp4", voiceoverPath: "v.wav", videoDurationSeconds: 5, outputPath: "o.mp4" });
  const idx = args.indexOf("-c:v");
  assert.equal(args[idx + 1], "copy");
});

test("buildReelAudioFfmpegArgs: voice-only applies volume+limiter, no sidechaincompress/amix", () => {
  const { args } = buildReelAudioFfmpegArgs({ videoPath: "in.mp4", voiceoverPath: "v.wav", videoDurationSeconds: 5, outputPath: "o.mp4" });
  const filterIndex = args.indexOf("-filter_complex");
  const filter = args[filterIndex + 1];
  assert.match(filter, /volume=1/);
  assert.doesNotMatch(filter, /sidechaincompress/);
  assert.doesNotMatch(filter, /amix/);
  assert.match(filter, /alimiter/);
  // Yalnızca video + voice input'u olmalı (müzik yok) — -stream_loop hiç geçmemeli.
  assert.ok(!args.includes("-stream_loop"));
});

test("buildReelAudioFfmpegArgs: music-only applies fade-in/out + limiter, loops the music input safely", () => {
  const { args } = buildReelAudioFfmpegArgs({ videoPath: "in.mp4", musicPath: "m.mp3", musicVolume: 0.5, videoDurationSeconds: 10, outputPath: "o.mp4" });
  const filterIndex = args.indexOf("-filter_complex");
  const filter = args[filterIndex + 1];
  assert.match(filter, /afade=t=in/);
  assert.match(filter, /afade=t=out/);
  assert.match(filter, /alimiter/);
  assert.ok(args.includes("-stream_loop")); // videodan kısa kalırsa güvenli döngü
});

test("buildReelAudioFfmpegArgs: voice+music applies ducking (sidechaincompress) then mixes (amix) then limits", () => {
  const { args } = buildReelAudioFfmpegArgs({ videoPath: "in.mp4", voiceoverPath: "v.wav", musicPath: "m.mp3", videoDurationSeconds: 8, outputPath: "o.mp4" });
  const filterIndex = args.indexOf("-filter_complex");
  const filter = args[filterIndex + 1];
  assert.match(filter, /sidechaincompress/);
  assert.match(filter, /amix=inputs=2/);
  assert.match(filter, /alimiter/);
});

test("buildReelAudioFfmpegArgs: musicVolume 0 mutes the music track (gain factor 0)", () => {
  const zero = buildReelAudioFfmpegArgs({ videoPath: "in.mp4", musicPath: "m.mp3", musicVolume: 0, videoDurationSeconds: 5, outputPath: "o.mp4" });
  const filter = zero.args[zero.args.indexOf("-filter_complex") + 1];
  assert.match(filter, /volume=0(?:[^.]|$)/);
});

test("buildReelAudioFfmpegArgs: musicVolume 1 doubles the -16dB baseline gain relative to the 0.5 default", () => {
  const half = buildReelAudioFfmpegArgs({ videoPath: "in.mp4", musicPath: "m.mp3", musicVolume: 0.5, videoDurationSeconds: 5, outputPath: "o.mp4" });
  const full = buildReelAudioFfmpegArgs({ videoPath: "in.mp4", musicPath: "m.mp3", musicVolume: 1, videoDurationSeconds: 5, outputPath: "o.mp4" });
  const gainOf = (result) => Number(result.args[result.args.indexOf("-filter_complex") + 1].match(/volume=([\d.]+)/)[1]);
  assert.ok(Math.abs(gainOf(full) - gainOf(half) * 2) < 1e-6);
});

test("buildReelAudioFfmpegArgs always outputs AAC audio + faststart, -shortest to bound total length", () => {
  const { args } = buildReelAudioFfmpegArgs({ videoPath: "in.mp4", voiceoverPath: "v.wav", videoDurationSeconds: 5, outputPath: "o.mp4" });
  assert.ok(args.includes("-shortest"));
  assert.ok(args.includes("+faststart"));
  const idx = args.indexOf("-c:a");
  assert.equal(args[idx + 1], "aac");
});
