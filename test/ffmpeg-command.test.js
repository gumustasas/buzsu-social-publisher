import test from "node:test";
import assert from "node:assert/strict";
import { buildFfmpegArgs } from "../src/lib/ffmpeg-command.js";

test("buildFfmpegArgs computes correct chained xfade offsets and total duration for 3 images + closing", () => {
  const { args, totalDurationSeconds } = buildFfmpegArgs({
    frames: [{ path: "f1.png" }, { path: "f2.png" }, { path: "f3.png" }],
    closingFrame: { path: "closing.png" },
    durationPerImageSeconds: 1.5,
    closingDurationSeconds: 2.5,
    transitionDurationSeconds: 0.4,
    outputPath: "out.mp4"
  });
  // total = (1.5*3 + 2.5) - 3*0.4 = 7.0 - 1.2 = 5.8
  assert.equal(totalDurationSeconds, 5.8);
  const filterComplexIndex = args.indexOf("-filter_complex");
  const filterComplex = args[filterComplexIndex + 1];
  assert.match(filterComplex, /offset=1\.100/);
  assert.match(filterComplex, /offset=2\.200/);
  assert.match(filterComplex, /offset=3\.300/);
  assert.match(filterComplex, /\[vout\]$/);
});

test("buildFfmpegArgs keeps each looped-image input's -t safely below the zoompan frame-accumulator reset boundary", () => {
  const { args } = buildFfmpegArgs({
    frames: [{ path: "f1.png" }],
    closingFrame: { path: "closing.png" },
    durationPerImageSeconds: 1.8,
    outputPath: "out.mp4"
  });
  // Girişteki framerate (0.1 = 10 saniyede 1 kare) o kadar düşük tutuluyor ki
  // -t bu projedeki hiçbir klip süresinde (en fazla birkaç saniye) ikinci bir
  // gerçek kare beslenmesine yol açmaz; zoompan'ın "d" parametresi klip
  // süresini tek başına ve kesintisiz biçimde belirler.
  const framerateIndices = args.reduce((acc, val, i) => (val === "-framerate" ? [...acc, i] : acc), []);
  assert.ok(framerateIndices.length >= 1);
  for (const idx of framerateIndices) {
    assert.equal(args[idx + 1], "0.1");
  }
});

test("buildFfmpegArgs produces exactly one zoompan filter per clip (frames + closing) with a matching frame count", () => {
  const { args } = buildFfmpegArgs({
    frames: [{ path: "f1.png" }, { path: "f2.png" }],
    closingFrame: { path: "closing.png" },
    durationPerImageSeconds: 2,
    closingDurationSeconds: 2.5,
    fps: 30,
    outputPath: "out.mp4"
  });
  const filterComplex = args[args.indexOf("-filter_complex") + 1];
  const zoompanMatches = filterComplex.match(/zoompan=/g);
  assert.equal(zoompanMatches.length, 3);
  assert.match(filterComplex, /d=60:s=1080x1920:fps=30/); // 2s * 30fps
  assert.match(filterComplex, /d=75:s=1080x1920:fps=30/); // 2.5s * 30fps
});

test("buildFfmpegArgs uses the wipe transition name when transition:'wipe' is requested", () => {
  const { args } = buildFfmpegArgs({
    frames: [{ path: "f1.png" }],
    closingFrame: { path: "closing.png" },
    durationPerImageSeconds: 1.5,
    transition: "wipe",
    outputPath: "out.mp4"
  });
  const filterComplex = args[args.indexOf("-filter_complex") + 1];
  assert.match(filterComplex, /xfade=transition=wiperight/);
});

test("buildFfmpegArgs falls back to fade for an unknown transition name", () => {
  const { args } = buildFfmpegArgs({
    frames: [{ path: "f1.png" }],
    closingFrame: { path: "closing.png" },
    durationPerImageSeconds: 1.5,
    transition: "nonexistent",
    outputPath: "out.mp4"
  });
  const filterComplex = args[args.indexOf("-filter_complex") + 1];
  assert.match(filterComplex, /xfade=transition=fade/);
});

test("buildFfmpegArgs adds an audio input, volume/afade filter and -c:a aac when musicPath is given", () => {
  const { args } = buildFfmpegArgs({
    frames: [{ path: "f1.png" }],
    closingFrame: { path: "closing.png" },
    durationPerImageSeconds: 1.5,
    musicPath: "music.mp3",
    musicVolume: 0.3,
    outputPath: "out.mp4"
  });
  assert.ok(args.includes("music.mp3"));
  assert.ok(args.includes("-stream_loop"));
  const filterComplex = args[args.indexOf("-filter_complex") + 1];
  assert.match(filterComplex, /volume=0\.3/);
  assert.match(filterComplex, /afade=t=out/);
  assert.match(filterComplex, /\[aout\]$/);
  assert.ok(args.includes("-c:a"));
  assert.ok(args.includes("aac"));
  assert.ok(!args.includes("-an"));
  const mapIndices = args.reduce((acc, val, i) => (val === "-map" ? [...acc, args[i + 1]] : acc), []);
  assert.deepEqual(mapIndices, ["[vout]", "[aout]"]);
});

test("buildFfmpegArgs omits audio mapping and adds -an when no musicPath is given", () => {
  const { args } = buildFfmpegArgs({
    frames: [{ path: "f1.png" }],
    closingFrame: { path: "closing.png" },
    durationPerImageSeconds: 1.5,
    outputPath: "out.mp4"
  });
  assert.ok(args.includes("-an"));
  assert.ok(!args.includes("-stream_loop"));
  const mapIndices = args.reduce((acc, val, i) => (val === "-map" ? [...acc, args[i + 1]] : acc), []);
  assert.deepEqual(mapIndices, ["[vout]"]);
});

test("buildFfmpegArgs throws for missing frames, closingFrame, outputPath, or non-positive durationPerImageSeconds", () => {
  const base = {
    frames: [{ path: "f1.png" }],
    closingFrame: { path: "closing.png" },
    durationPerImageSeconds: 1.5,
    outputPath: "out.mp4"
  };
  assert.throws(() => buildFfmpegArgs({ ...base, frames: [] }));
  assert.throws(() => buildFfmpegArgs({ ...base, closingFrame: null }));
  assert.throws(() => buildFfmpegArgs({ ...base, outputPath: undefined }));
  assert.throws(() => buildFfmpegArgs({ ...base, durationPerImageSeconds: 0 }));
});

test("buildFfmpegArgs scales total duration correctly for the maximum of 10 product images", () => {
  const frames = Array.from({ length: 10 }, (_, i) => ({ path: `f${i}.png` }));
  const { totalDurationSeconds } = buildFfmpegArgs({
    frames,
    closingFrame: { path: "closing.png" },
    durationPerImageSeconds: 1.5,
    closingDurationSeconds: 2.5,
    transitionDurationSeconds: 0.4,
    outputPath: "out.mp4"
  });
  // total = (1.5*10 + 2.5) - 10*0.4 = 17.5 - 4.0 = 13.5
  assert.equal(totalDurationSeconds, 13.5);
});
