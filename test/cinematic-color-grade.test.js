import test from "node:test";
import assert from "node:assert/strict";
import { buildColorGradeChain } from "../src/cinematic/color-grade.js";

test("buildColorGradeChain produces a distinct, fixed filter chain for each of the 4 visual profiles", () => {
  const profiles = ["clean-tech", "premium-soft", "commercial", "natural"];
  const chains = profiles.map((p) => buildColorGradeChain(p));
  assert.equal(new Set(chains).size, 4, "her profil farklı bir filtre zinciri üretmeli");
  for (const chain of chains) assert.match(chain, /^eq=/);
});

// manifest: "do not materially change true product color; clamp aggressive filter values"
test("buildColorGradeChain keeps saturation/contrast within a small, restrained range for every profile (no aggressive color shift)", () => {
  for (const profile of ["clean-tech", "premium-soft", "commercial", "natural"]) {
    const chain = buildColorGradeChain(profile);
    const saturation = Number(chain.match(/saturation=([\d.]+)/)[1]);
    const contrast = Number(chain.match(/contrast=([\d.]+)/)[1]);
    assert.ok(saturation >= 0.9 && saturation <= 1.2, `${profile} saturation aşırı: ${saturation}`);
    assert.ok(contrast >= 0.9 && contrast <= 1.15, `${profile} contrast aşırı: ${contrast}`);
  }
});

test("buildColorGradeChain adds vignette/grain filters only when explicitly requested", () => {
  const off = buildColorGradeChain("clean-tech", { vignette: "off", grain: "off" });
  assert.doesNotMatch(off, /vignette|noise/);
  const on = buildColorGradeChain("clean-tech", { vignette: "subtle", grain: "very-low" });
  assert.match(on, /vignette=angle=PI\/5/);
  assert.match(on, /noise=alls=4/);
});

test("buildColorGradeChain rejects an unknown profile/vignette/grain (fail-closed)", () => {
  assert.throws(() => buildColorGradeChain("vintage"), /Bilinmeyen visualProfile/);
  assert.throws(() => buildColorGradeChain("clean-tech", { vignette: "heavy" }), /Bilinmeyen vignette/);
  assert.throws(() => buildColorGradeChain("clean-tech", { grain: "high" }), /Bilinmeyen grain/);
});
