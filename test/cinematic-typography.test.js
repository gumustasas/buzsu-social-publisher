import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { renderTitleOverlayPng, buildTitleAnimationFilter, safeBottomMargin } from "../src/cinematic/typography.js";

// tests.required: "Turkish typography" — ç,ğ,ı,İ,ö,ş,ü render edilmeli.
test("renderTitleOverlayPng produces a valid, correctly-sized transparent PNG that actually contains visible (non-empty) pixels for Turkish text", async () => {
  const { buffer, barTop } = await renderTitleOverlayPng({
    title: "Çölyak Güvenli Ürün İçeriği",
    subtitle: "Işıltılı, şeffaf, üstün kalite",
    width: 1080,
    height: 1920
  });
  const meta = await sharp(buffer).metadata();
  assert.equal(meta.width, 1080);
  assert.equal(meta.height, 1920);
  assert.equal(meta.format, "png");
  assert.ok(meta.hasAlpha, "overlay PNG'nin şeffaf bir kanalı olmalı (arka planı GİZLEMEMELİ)");
  assert.ok(barTop > 0 && barTop < 1920, "barTop kanvas içinde olmalı");

  // Bandın çizildiği bölgede gerçekten opak (alpha>0) piksel olduğunu
  // doğrula — yalnızca "hata fırlatmadı" değil, GERÇEKTEN bir şey çizildi.
  const raw = await sharp(buffer).extract({ left: 0, top: barTop, width: 1080, height: 1920 - barTop }).raw().toBuffer();
  let maxAlpha = 0;
  for (let i = 3; i < raw.length; i += 4) maxAlpha = Math.max(maxAlpha, raw[i]);
  assert.ok(maxAlpha > 0, "bant bölgesinde opak piksel bulunamadı — metin/bant hiç çizilmemiş olabilir");
});

test("renderTitleOverlayPng handles a missing subtitle (title-only) without throwing", async () => {
  const { buffer } = await renderTitleOverlayPng({ title: "Sadece Başlık", width: 1080, height: 1920 });
  const meta = await sharp(buffer).metadata();
  assert.equal(meta.width, 1080);
});

test("safeBottomMargin scales proportionally with canvas height (works for 9:16/1:1/16:9, not just a fixed 1920px assumption)", () => {
  assert.equal(safeBottomMargin(1920), Math.round(1920 * 0.12));
  assert.equal(safeBottomMargin(1080), Math.round(1080 * 0.12));
});

// buildTitleAnimationFilter GÜVENLİK: metin ASLA bu fonksiyona parametre
// olarak girmez (yalnızca sayısal barTop/offsetPx/animDurationSeconds) —
// bu yüzden FFmpeg drawtext/filtergraph text injection riski YAPISAL olarak
// yoktur (metin zaten bir PNG'ye rasterize edilmiş durumda).
test("buildTitleAnimationFilter embeds only numeric constants (no free text) and never double-applies the overlay's own baked-in vertical position", () => {
  const filter = buildTitleAnimationFilter({ textInputLabel: "3:v", sceneInputLabel: "swept", outputLabel: "titled" });
  assert.match(filter, /\[3:v\]format=rgba,fade=t=in:st=0:d=0\.45:alpha=1\[3:vfade\]/);
  assert.match(filter, /\[swept\]\[3:vfade\]overlay=x=0:y='20\*\(1-min\(1,t\/0\.45\)\)\^2'/);
  assert.doesNotMatch(filter, /barTop/);
});

test("buildTitleAnimationFilter's y-expression decays the entrance offset to exactly 0 by the end of the animation window (rests exactly on the overlay's own baked-in position)", () => {
  const filter = buildTitleAnimationFilter({ textInputLabel: "2:v", sceneInputLabel: "base", outputLabel: "titled", offsetPx: 24, animDurationSeconds: 0.5 });
  assert.match(filter, /24\*\(1-min\(1,t\/0\.5\)\)\^2/);
});
