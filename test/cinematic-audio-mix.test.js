import test from "node:test";
import assert from "node:assert/strict";
import { buildCinematicAudioMixArgs, resolveSoundDesignFallback } from "../src/cinematic/audio-mix.js";

test("buildCinematicAudioMixArgs requires at least one of voiceoverPath/musicPath", () => {
  assert.throws(() => buildCinematicAudioMixArgs({ videoPath: "v.mp4", videoDurationSeconds: 5, outputPath: "o.mp4" }), /voiceoverPath veya musicPath/);
});

// tests.required: "audio ducking configuration"
test("buildCinematicAudioMixArgs applies sidechaincompress ducking when both voice+music are present and autoDuck=true, with duckDb mapped deterministically to the compressor ratio", () => {
  const low = buildCinematicAudioMixArgs({ videoPath: "v.mp4", voiceoverPath: "voice.mp3", musicPath: "music.mp3", duckDb: 6, autoDuck: true, videoDurationSeconds: 10, outputPath: "o.mp4" });
  const high = buildCinematicAudioMixArgs({ videoPath: "v.mp4", voiceoverPath: "voice.mp3", musicPath: "music.mp3", duckDb: 10, autoDuck: true, videoDurationSeconds: 10, outputPath: "o.mp4" });
  const lowFilter = low.args[low.args.indexOf("-filter_complex") + 1];
  const highFilter = high.args[high.args.indexOf("-filter_complex") + 1];
  assert.match(lowFilter, /sidechaincompress=threshold=0\.05:ratio=4\.00/);
  assert.match(highFilter, /sidechaincompress=threshold=0\.05:ratio=12\.00/, "duckDb=10 (maksimum) en agresif ratio'ya eşlenmeli");
  assert.match(lowFilter, /asplit=2/, "voice sinyali sidechaincompress kontrolü ve amix için AYRI kopyalara bölünmeli");
});

test("buildCinematicAudioMixArgs skips ducking (plain amix) when autoDuck=false even with both tracks present", () => {
  const result = buildCinematicAudioMixArgs({ videoPath: "v.mp4", voiceoverPath: "voice.mp3", musicPath: "music.mp3", autoDuck: false, videoDurationSeconds: 10, outputPath: "o.mp4" });
  const filter = result.args[result.args.indexOf("-filter_complex") + 1];
  assert.doesNotMatch(filter, /sidechaincompress/);
  assert.match(filter, /amix=inputs=2/);
});

test("buildCinematicAudioMixArgs voice-only / music-only single-track paths never invoke amix/sidechaincompress", () => {
  const voiceOnly = buildCinematicAudioMixArgs({ videoPath: "v.mp4", voiceoverPath: "voice.mp3", videoDurationSeconds: 10, outputPath: "o.mp4" });
  const voiceFilter = voiceOnly.args[voiceOnly.args.indexOf("-filter_complex") + 1];
  assert.doesNotMatch(voiceFilter, /amix|sidechaincompress/);

  const musicOnly = buildCinematicAudioMixArgs({ videoPath: "v.mp4", musicPath: "music.mp3", videoDurationSeconds: 10, outputPath: "o.mp4" });
  const musicFilter = musicOnly.args[musicOnly.args.indexOf("-filter_complex") + 1];
  assert.doesNotMatch(musicFilter, /amix|sidechaincompress/);
});

test("buildCinematicAudioMixArgs output is always 48kHz AAC with the video stream copied (never re-encoded)", () => {
  const result = buildCinematicAudioMixArgs({ videoPath: "v.mp4", musicPath: "music.mp3", videoDurationSeconds: 10, outputPath: "o.mp4" });
  assert.deepEqual(result.args.slice(result.args.indexOf("-c:v"), result.args.indexOf("-c:v") + 2), ["-c:v", "copy"]);
  assert.ok(result.args.includes("-ar"));
  assert.equal(result.args[result.args.indexOf("-ar") + 1], "48000");
  assert.ok(result.args.includes("-c:a"));
  assert.equal(result.args[result.args.indexOf("-c:a") + 1], "aac");
});

// manifest fallback: "if deterministic local SFX unavailable, skip without failing the render"
test("resolveSoundDesignFallback always reports the deterministic skip fallback when requested (never a hard failure), and no-op when not requested", () => {
  assert.deepEqual(resolveSoundDesignFallback(true), { applied: false, fallback: "sound_design_unavailable" });
  assert.deepEqual(resolveSoundDesignFallback(false), { applied: false, fallback: null });
});
