import test from "node:test";
import assert from "node:assert/strict";
import { buildScenePlan, buildMergePlan } from "../src/cinematic/render-plan.js";
import { buildSceneFilterGraph } from "../src/cinematic/scene-render.js";

const BASE_SCENE = {
  imageUrl: "https://example.com/p.png",
  durationSeconds: 4,
  camera: { type: "push-in", intensity: 0.35, easing: "ease-in-out" },
  depthEffect: false,
  subjectLock: true,
  transition: { type: "crossfade", durationSeconds: 0.4 },
  transitionAnchor: { x: 0.5, y: 0.5 }
};
const NO_EFFECTS = { depthParallax: false, contactShadow: false, lightSweep: false, motionBlur: false, depthOfField: false, vignette: "off", grain: "off" };

// tests.required: "depth fallback (missing depth provider doesn't fail render)"
test("buildSceneFilterGraph: depthEffect=true never throws even though no real depth provider is installed — it records a fallback and continues (manifest: render MUST continue)", async () => {
  const graph = await buildSceneFilterGraph({ ...BASE_SCENE, depthEffect: true }, { width: 1080, height: 1920, fps: 30, visualProfile: "clean-tech", cinematicOptions: NO_EFFECTS });
  assert.ok(graph.fallbacks.includes("depth_parallax_unavailable"));
  assert.ok(graph.warnings.length > 0);
  assert.ok(!graph.appliedEffects.includes("depth_parallax"), "gerçek bir derinlik sağlayıcısı yokken depth_parallax UYGULANDI diye raporlanmamalı");
});

test("buildSceneFilterGraph: depthEffect=false never mentions depth at all (no spurious fallback noise)", async () => {
  const graph = await buildSceneFilterGraph(BASE_SCENE, { width: 1080, height: 1920, fps: 30, visualProfile: "clean-tech", cinematicOptions: NO_EFFECTS });
  assert.ok(!graph.fallbacks.includes("depth_parallax_unavailable"));
});

// subjectLock: yapısal garanti — filter graph'ta HİÇBİR ürün-warp/generative-fill filtresi yok, yalnızca kamera + post-processing.
test("subjectLock structural guarantee: the generated filter graph never contains a destructive per-pixel product transform — only zoompan (whole-frame camera) and standard color/blur post-processing filters", async () => {
  const graph = await buildSceneFilterGraph(
    { ...BASE_SCENE, title: "Ürün" },
    { width: 1080, height: 1920, fps: 30, visualProfile: "commercial", cinematicOptions: { ...NO_EFFECTS, contactShadow: true, lightSweep: true, depthOfField: true, motionBlur: true } }
  );
  for (const forbidden of ["perspective", "warp", "distort", "inpaint", "generative"]) {
    assert.doesNotMatch(graph.filter, new RegExp(forbidden, "i"));
  }
  assert.match(graph.filter, /zoompan=/);
});

test("buildScenePlan: ffmpeg args always encode h264/yuv420p for the per-scene clip, with the source image as a looped single-frame input", async () => {
  const plan = await buildScenePlan({
    scene: BASE_SCENE, sceneIndex: 0, sourceImagePath: "/tmp/source-0.png",
    fps: 30, width: 1080, height: 1920, visualProfile: "clean-tech", cinematicOptions: NO_EFFECTS, workDir: "/tmp"
  });
  assert.deepEqual(plan.args.slice(0, 8), ["-y", "-loop", "1", "-framerate", "0.1", "-t", "4", "-i"]);
  assert.equal(plan.args[8], "/tmp/source-0.png");
  assert.ok(plan.args.includes("-c:v"));
  assert.equal(plan.args[plan.args.indexOf("-c:v") + 1], "libx264");
  assert.equal(plan.args[plan.args.indexOf("-pix_fmt") + 1], "yuv420p");
  assert.ok(plan.args.includes("-an"), "sahne klipleri KENDİ sesini taşımaz — ses mix'i ayrı, final bir geçiştir");
  assert.equal(plan.filesToWrite.length, 0, "hiçbir opsiyonel efekt/başlık istenmediyse fazladan overlay girişi olmamalı");
});

test("buildScenePlan writes one overlay file per requested visual extra (contact shadow + title), each fed to ffmpeg as its own '-loop 1' input", async () => {
  const plan = await buildScenePlan({
    scene: { ...BASE_SCENE, title: "Test Ürünü" }, sceneIndex: 1, sourceImagePath: "/tmp/source-1.png",
    fps: 30, width: 1080, height: 1920, visualProfile: "clean-tech",
    cinematicOptions: { ...NO_EFFECTS, contactShadow: true }, workDir: "/tmp"
  });
  assert.equal(plan.filesToWrite.length, 2);
  const loopCount = plan.args.filter((a) => a === "1").length;
  // 1 ana giriş (-loop 1) + 2 overlay girişi (-loop 1) = toplam 3 kez "1" (framerate 0.1 hariç, o "0.1" string'i farklı).
  assert.ok(loopCount >= 3);
});

// tests.required: "transition validation (invalid duration rejected)" — render-plan katmanında da (şemadan bağımsız ikinci savunma).
test("buildMergePlan throws if a transition's durationSeconds exceeds the actual rendered duration of the preceding clip", () => {
  const scenePlans = [
    { outputPath: "/tmp/clip-0.mp4", exactDurationSeconds: 0.3 },
    { outputPath: "/tmp/clip-1.mp4", exactDurationSeconds: 4 }
  ];
  const scenes = [{ ...BASE_SCENE, transition: { type: "crossfade", durationSeconds: 0.4 } }, BASE_SCENE];
  assert.throws(
    () => buildMergePlan({ scenePlans, scenes, width: 1080, height: 1920, fps: 30, workDir: "/tmp", finalOutputPath: "/tmp/final.mp4" }),
    /transition\.durationSeconds/
  );
});

test("buildMergePlan chains scenes pairwise with xfade, computing correct cumulative duration (each merge subtracts the transition overlap)", () => {
  const scenePlans = [
    { outputPath: "/tmp/clip-0.mp4", exactDurationSeconds: 4 },
    { outputPath: "/tmp/clip-1.mp4", exactDurationSeconds: 5 },
    { outputPath: "/tmp/clip-2.mp4", exactDurationSeconds: 3 }
  ];
  const scenes = [
    { ...BASE_SCENE, transition: { type: "crossfade", durationSeconds: 0.4 } },
    { ...BASE_SCENE, transition: { type: "whip", durationSeconds: 0.3 } },
    BASE_SCENE
  ];
  const { mergeSteps, totalDurationSeconds } = buildMergePlan({ scenePlans, scenes, width: 1080, height: 1920, fps: 30, workDir: "/tmp", finalOutputPath: "/tmp/final.mp4" });
  assert.equal(mergeSteps.length, 2);
  assert.equal(mergeSteps[0].xfadeName, "fade");
  assert.equal(mergeSteps[1].xfadeName, "slideright", "whip, sahne indeksine göre deterministik yön seçmeli (scenes[1] -> indeks 1 -> slideright)");
  assert.ok(Math.abs(totalDurationSeconds - (4 + 5 + 3 - 0.4 - 0.3)) < 1e-6);
  assert.equal(mergeSteps[1].outputPath, "/tmp/final.mp4", "son birleştirme adımı doğrudan finalOutputPath'e yazmalı");
});
