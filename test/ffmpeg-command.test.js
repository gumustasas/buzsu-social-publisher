import test from "node:test";
import assert from "node:assert/strict";
import { buildFfmpegArgs, buildTwoPassFfmpegArgs } from "../src/lib/ffmpeg-command.js";

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
  // zoompan performans nedeniyle yarı çözünürlükte (540x960) çalışır, sonucu
  // ayrı bir scale filtresi 1080x1920'ye büyütür (bkz. ffmpeg-command.js'teki
  // ZOOMPAN_INTERNAL_SCALE_DIVISOR açıklaması).
  assert.match(filterComplex, /d=60:s=540x960:fps=30/); // 2s * 30fps
  assert.match(filterComplex, /d=75:s=540x960:fps=30/); // 2.5s * 30fps
  const scaleMatches = filterComplex.match(/scale=1080:1920/g);
  assert.equal(scaleMatches.length, 3);
});

// zoompan'ın "d" parametresi çıkış kare sayısını KENDİSİ sınırlamaz — gerçek
// bir ffmpeg ile doğrulandı (bkz. PR açıklaması): tek gerçek giriş karesi
// beslendiğinde zoompan bu kareyi "fps" hızında SÜRESİZ üretmeye devam eder,
// render hiçbir zaman bitmez. Her klibin kendi "d" kare sayısında sert olarak
// kesilmesi (trim=end_frame + setpts) bu yüzden zorunlu — bu test o kesmenin
// her klip için doğru kare sayısıyla üretildiğini doğrular.
test("buildFfmpegArgs hard-trims each zoompan clip to its exact frame count (zoompan's 'd' alone does not stop output)", () => {
  const { args } = buildFfmpegArgs({
    frames: [{ path: "f1.png" }, { path: "f2.png" }],
    closingFrame: { path: "closing.png" },
    durationPerImageSeconds: 2,
    closingDurationSeconds: 2.5,
    fps: 30,
    outputPath: "out.mp4"
  });
  const filterComplex = args[args.indexOf("-filter_complex") + 1];
  const trimMatches = filterComplex.match(/trim=end_frame=(\d+),setpts=PTS-STARTPTS/g);
  assert.equal(trimMatches.length, 3);
  assert.match(filterComplex, /trim=end_frame=60,setpts=PTS-STARTPTS/); // 2s * 30fps
  assert.match(filterComplex, /trim=end_frame=75,setpts=PTS-STARTPTS/); // 2.5s * 30fps
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

// === buildTwoPassFfmpegArgs ===

test("buildTwoPassFfmpegArgs returns one clip render per frame+closing, each with a single zoompan filter", () => {
  const { clipRenders, mergeSteps, totalDurationSeconds } = buildTwoPassFfmpegArgs({
    frames: [{ path: "f1.png" }, { path: "f2.png" }, { path: "f3.png" }],
    closingFrame: { path: "closing.png" },
    durationPerImageSeconds: 1.5,
    closingDurationSeconds: 2.5,
    transitionDurationSeconds: 0.4,
    clipDir: "/tmp/clips",
    outputPath: "out.mp4"
  });
  assert.equal(clipRenders.length, 4);
  for (const clip of clipRenders) {
    const fc = clip.args[clip.args.indexOf("-filter_complex") + 1];
    assert.equal((fc.match(/zoompan=/g) || []).length, 1);
  }
  assert.equal(totalDurationSeconds, 5.8);
  assert.equal(mergeSteps.length, 3);
  for (const step of mergeSteps) {
    const fc = step.args[step.args.indexOf("-filter_complex") + 1];
    assert.ok(!fc.includes("zoompan"));
    assert.match(fc, /xfade/);
    assert.match(fc, /\[vout\]/);
    const inputs = step.args.filter((a, i) => i > 0 && step.args[i - 1] === "-i");
    assert.equal(inputs.length, 2);
  }
});

test("buildTwoPassFfmpegArgs sequential merge steps produce correct cumulative offsets", () => {
  const { mergeSteps, totalDurationSeconds } = buildTwoPassFfmpegArgs({
    frames: [{ path: "f1.png" }, { path: "f2.png" }, { path: "f3.png" }],
    closingFrame: { path: "closing.png" },
    durationPerImageSeconds: 1.5,
    closingDurationSeconds: 2.5,
    transitionDurationSeconds: 0.4,
    clipDir: "/tmp/clips",
    outputPath: "out.mp4"
  });
  // step 0: clip0(1.5s) + clip1(1.5s) → offset=1.100, duration=2.6
  // step 1: merge1(2.6s) + clip2(1.5s) → offset=2.200, duration=3.7
  // step 2: merge2(3.7s) + closing(2.5s) → offset=3.300, duration=5.8
  const offsets = mergeSteps.map((s) => {
    const fc = s.args[s.args.indexOf("-filter_complex") + 1];
    return fc.match(/offset=(\d+\.\d+)/)[1];
  });
  assert.deepEqual(offsets, ["1.100", "2.200", "3.300"]);
  assert.equal(totalDurationSeconds, 5.8);
});

test("buildTwoPassFfmpegArgs handles music only in the last merge step", () => {
  const { mergeSteps } = buildTwoPassFfmpegArgs({
    frames: [{ path: "f1.png" }],
    closingFrame: { path: "closing.png" },
    durationPerImageSeconds: 1.5,
    musicPath: "music.mp3",
    musicVolume: 0.3,
    clipDir: "/tmp/clips",
    outputPath: "out.mp4"
  });
  assert.equal(mergeSteps.length, 1);
  const lastStep = mergeSteps[mergeSteps.length - 1];
  assert.ok(lastStep.args.includes("music.mp3"));
  assert.ok(lastStep.args.includes("-stream_loop"));
  const filterComplex = lastStep.args[lastStep.args.indexOf("-filter_complex") + 1];
  assert.match(filterComplex, /volume=0\.3/);
  assert.match(filterComplex, /afade=t=out/);
  assert.match(filterComplex, /\[aout\]$/);
  assert.ok(lastStep.args.includes("-c:a"));
  assert.ok(lastStep.args.includes("aac"));
});

test("buildTwoPassFfmpegArgs clip renders use CRF 18, intermediate merges CRF 18, final merge CRF 21", () => {
  const { clipRenders, mergeSteps } = buildTwoPassFfmpegArgs({
    frames: [{ path: "f1.png" }, { path: "f2.png" }],
    closingFrame: { path: "closing.png" },
    durationPerImageSeconds: 1.5,
    clipDir: "/tmp/clips",
    outputPath: "out.mp4"
  });
  for (const clip of clipRenders) {
    const crfIdx = clip.args.indexOf("-crf");
    assert.equal(clip.args[crfIdx + 1], "18");
  }
  for (let i = 0; i < mergeSteps.length - 1; i++) {
    const crfIdx = mergeSteps[i].args.indexOf("-crf");
    assert.equal(mergeSteps[i].args[crfIdx + 1], "18");
  }
  const lastCrfIdx = mergeSteps[mergeSteps.length - 1].args.indexOf("-crf");
  assert.equal(mergeSteps[mergeSteps.length - 1].args[lastCrfIdx + 1], "21");
});
