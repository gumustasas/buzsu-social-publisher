import test from "node:test";
import assert from "node:assert/strict";
import { preflightSceneImages, renderSceneClips } from "../src/cinematic/scene-pipeline.js";
import { InvalidSceneImageError } from "../src/cinematic/scene-image.js";

const SCENE = (n) => ({
  imageUrl: `https://example.com/p${n}.png`,
  durationSeconds: 3,
  camera: { type: "push-in", intensity: 0.35, easing: "ease-in-out" },
  transition: { type: "crossfade", durationSeconds: 0.4 }
});
const OPTS = { width: 1080, height: 1920, fps: 30, visualProfile: "clean-tech", cinematicOptions: { depthParallax: false, contactShadow: false, lightSweep: false, motionBlur: false, depthOfField: false, vignette: "off", grain: "off" }, workDir: "/tmp" };

// ROOT REVIEW blocker 1 (PR #110, review 5257372536): "Invalid images must
// fail before cinematic processing begins." This is the central regression
// test proving it: when a LATER scene (index 2 of 3) is invalid, ZERO
// FFmpeg/execFile executions ever happen — not even for the earlier scenes
// that were successfully downloaded/validated before the failure.
test("preflightSceneImages + renderSceneClips: an invalid LATER scene causes ZERO ffmpeg/execFile executions for ANY scene, including earlier already-validated ones", async () => {
  const scenes = [SCENE(0), SCENE(1), SCENE(2)];
  const downloadCalls = [];
  const downloadAndNormalizeSceneImageImpl = async (scene, index) => {
    downloadCalls.push(index);
    if (index === 2) {
      throw new InvalidSceneImageError("scenes[2]: INVALID_SCENE_IMAGE — bozuk görsel.", {
        scene_index: 2, original_url: "https://example.com/p2.png", failure_stage: "validate"
      });
    }
    return Buffer.from(`fake-png-${index}`);
  };
  const writeFileCalls = [];
  const writeFileImpl = async (path, buffer) => { writeFileCalls.push({ path, buffer }); };
  let execFileCallCount = 0;
  const execFileImpl = async () => { execFileCallCount++; };
  const buildScenePlanCallCount = { n: 0 };
  const buildScenePlanImpl = async () => { buildScenePlanCallCount.n++; return { args: [], outputPath: "/tmp/x.mp4", filesToWrite: [], exactDurationSeconds: 3, appliedEffects: [], fallbacks: [], warnings: [] }; };

  // Aşama 1 (preflight) sahne 2'de throw etmeli.
  await assert.rejects(
    () => preflightSceneImages(scenes, { width: OPTS.width, height: OPTS.height, workDir: OPTS.workDir, downloadAndNormalizeSceneImageImpl, writeFileImpl }),
    (err) => {
      assert.ok(err instanceof InvalidSceneImageError);
      assert.equal(err.scene_index, 2);
      return true;
    }
  );

  // Sahne 0 ve 1 preflight'ta BAŞARIYLA indirilmiş olsa bile (downloadCalls
  // bunu kanıtlar), renderSceneClips (ve dolayısıyla execFileImpl/
  // buildScenePlanImpl) HİÇ ÇAĞRILMAMALIDIR — worker'ın gerçek run()
  // akışında renderSceneClips, preflightSceneImages'ın reddettiği bir
  // Promise'ten sonra hiçbir zaman çağrılmaz (bkz. scripts/render-cinematic-
  // reel.mjs run()).
  assert.deepEqual(downloadCalls, [0, 1, 2], "sahne 0/1 indirilmiş olmalı (preflight sırasıyla ilerler), ama sahne 2'de durmalı");
  assert.equal(execFileCallCount, 0, "TEK BİR FFmpeg süreci dahi başlatılmamalı");
  assert.equal(buildScenePlanCallCount.n, 0, "renderSceneClips'in kendisi hiç çağrılmamalı — sahne planı bile üretilmemeli");
  assert.equal(writeFileCalls.length, 2, "yalnızca başarıyla doğrulanan 2 sahnenin normalize edilmiş PNG'si diske yazılmış olmalı");
});

test("preflightSceneImages succeeds and returns one source path per scene when all scenes are valid", async () => {
  const scenes = [SCENE(0), SCENE(1)];
  const downloadAndNormalizeSceneImageImpl = async (scene, index) => Buffer.from(`png-${index}`);
  const writeFileImpl = async () => {};
  const sourcePaths = await preflightSceneImages(scenes, { width: OPTS.width, height: OPTS.height, workDir: OPTS.workDir, downloadAndNormalizeSceneImageImpl, writeFileImpl });
  assert.equal(sourcePaths.length, 2);
  assert.match(sourcePaths[0], /cinematic-scene-0-source\.png$/);
  assert.match(sourcePaths[1], /cinematic-scene-1-source\.png$/);
});

test("renderSceneClips only runs after preflight succeeds, and invokes execFileImpl exactly once per scene when all sources are already valid", async () => {
  const scenes = [SCENE(0), SCENE(1)];
  const sourcePaths = ["/tmp/s0.png", "/tmp/s1.png"];
  let execFileCallCount = 0;
  const execFileImpl = async (cmd) => { assert.equal(cmd, "ffmpeg"); execFileCallCount++; };
  const buildScenePlanImpl = async ({ sceneIndex }) => ({
    args: ["-y"], outputPath: `/tmp/clip-${sceneIndex}.mp4`, filesToWrite: [],
    exactDurationSeconds: 3, appliedEffects: [`camera_scene_${sceneIndex}`], fallbacks: [], warnings: []
  });
  const writeFileImpl = async () => {};

  const result = await renderSceneClips(scenes, sourcePaths, { ...OPTS, buildScenePlanImpl, writeFileImpl, execFileImpl });
  assert.equal(execFileCallCount, 2);
  assert.equal(result.scenePlans.length, 2);
  assert.ok(result.appliedEffects.has("camera_scene_0"));
  assert.ok(result.appliedEffects.has("camera_scene_1"));
});
