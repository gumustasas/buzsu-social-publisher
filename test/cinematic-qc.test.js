import test from "node:test";
import assert from "node:assert/strict";
import { evaluateCinematicQc, probeCinematicOutput } from "../src/cinematic/qc.js";

const GOOD_PROBE = {
  streams: [{ codec_type: "video", codec_name: "h264", width: 1080, height: 1920, pix_fmt: "yuv420p", r_frame_rate: "30/1" }],
  format: { duration: "9.10" }
};
const EXPECTED = { width: 1080, height: 1920, fps: 30, durationSeconds: 9.1 };

test("evaluateCinematicQc passes when ffprobe output matches the expected output contract exactly", () => {
  const result = evaluateCinematicQc({ ffprobeJson: GOOD_PROBE, fileSizeBytes: 500000, expected: EXPECTED, audioExpected: false });
  assert.equal(result.pass, true);
  assert.ok(result.checks.every((c) => c.pass));
});

// tests.required: "output resolution (1080x1920 default)"
test("evaluateCinematicQc fails resolution_matches when the actual stream resolution differs from expected", () => {
  const badProbe = { ...GOOD_PROBE, streams: [{ ...GOOD_PROBE.streams[0], width: 720, height: 1280 }] };
  const result = evaluateCinematicQc({ ffprobeJson: badProbe, fileSizeBytes: 500000, expected: EXPECTED, audioExpected: false });
  assert.equal(result.pass, false);
  assert.equal(result.checks.find((c) => c.name === "resolution_matches").pass, false);
});

// tests.required: "output codec (H264+yuv420p)"
test("evaluateCinematicQc fails when codec isn't h264 or pixel format isn't yuv420p — QC failure must prevent a 'completed' report", () => {
  const badCodec = { ...GOOD_PROBE, streams: [{ ...GOOD_PROBE.streams[0], codec_name: "vp9" }] };
  assert.equal(evaluateCinematicQc({ ffprobeJson: badCodec, fileSizeBytes: 500000, expected: EXPECTED, audioExpected: false }).pass, false);

  const badPixFmt = { ...GOOD_PROBE, streams: [{ ...GOOD_PROBE.streams[0], pix_fmt: "yuv422p" }] };
  assert.equal(evaluateCinematicQc({ ffprobeJson: badPixFmt, fileSizeBytes: 500000, expected: EXPECTED, audioExpected: false }).pass, false);
});

test("evaluateCinematicQc fails when no video stream is present at all", () => {
  const result = evaluateCinematicQc({ ffprobeJson: { streams: [], format: {} }, fileSizeBytes: 500000, expected: EXPECTED, audioExpected: false });
  assert.equal(result.pass, false);
  assert.equal(result.checks.find((c) => c.name === "video_stream_exists").pass, false);
});

test("evaluateCinematicQc fails when duration is outside tolerance or file size is below the sane minimum", () => {
  const shortDuration = { ...GOOD_PROBE, format: { duration: "2.0" } };
  assert.equal(evaluateCinematicQc({ ffprobeJson: shortDuration, fileSizeBytes: 500000, expected: EXPECTED, audioExpected: false }).pass, false);

  const tinyFile = evaluateCinematicQc({ ffprobeJson: GOOD_PROBE, fileSizeBytes: 100, expected: EXPECTED, audioExpected: false });
  assert.equal(tinyFile.pass, false);
  assert.equal(tinyFile.checks.find((c) => c.name === "file_size_above_minimum").pass, false);
});

test("evaluateCinematicQc requires an audio stream only when audio was actually requested for this render", () => {
  const noAudioStream = GOOD_PROBE;
  assert.equal(evaluateCinematicQc({ ffprobeJson: noAudioStream, fileSizeBytes: 500000, expected: EXPECTED, audioExpected: false }).pass, true, "ses istenmediyse ses akışı eksikliği QC'yi düşürmemeli");

  const failedForAudio = evaluateCinematicQc({ ffprobeJson: noAudioStream, fileSizeBytes: 500000, expected: EXPECTED, audioExpected: true });
  assert.equal(failedForAudio.pass, false, "ses istendiyse ama akış yoksa QC başarısız olmalı");

  const withAudio = { ...GOOD_PROBE, streams: [...GOOD_PROBE.streams, { codec_type: "audio", codec_name: "aac" }] };
  assert.equal(evaluateCinematicQc({ ffprobeJson: withAudio, fileSizeBytes: 500000, expected: EXPECTED, audioExpected: true }).pass, true);
});

test("probeCinematicOutput parses ffprobe's JSON stdout via the injected execFileImpl (no real ffprobe binary needed for this unit test)", async () => {
  const execFileImpl = async (cmd, args) => {
    assert.equal(cmd, "ffprobe");
    assert.ok(args.includes("-show_streams"));
    return { stdout: JSON.stringify(GOOD_PROBE) };
  };
  const result = await probeCinematicOutput("/tmp/out.mp4", { execFileImpl });
  assert.deepEqual(result, GOOD_PROBE);
});
