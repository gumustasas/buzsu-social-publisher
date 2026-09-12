import test from "node:test";
import assert from "node:assert/strict";
import { wrapLines, computeStoryLayout, font, MAX_TEXT_WIDTH } from "../api/story-image.js";

const CANVAS_HEIGHT = 1920;
const BOX_BOTTOM_MARGIN = 130;
const BOX_BOTTOM_Y = CANVAS_HEIGHT - BOX_BOTTOM_MARGIN;

test("wrapLines never exceeds maxLines even when the text is far too long to fit", () => {
  const font = { getAdvanceWidth: (text) => text.length * 20 };
  const lines = wrapLines("bir iki üç dört beş altı yedi sekiz dokuz on", font, 30, 100, 2);
  assert.equal(lines.length, 2);
});

test("wrapLines truncates the final line with an ellipsis instead of letting it overflow maxWidth once maxLines is reached", () => {
  const font = { getAdvanceWidth: (text) => text.length * 20 };
  const lines = wrapLines("bir iki üç dört beş altı yedi sekiz dokuz on", font, 30, 100, 2);
  for (const line of lines) {
    assert.ok(font.getAdvanceWidth(line, 30) <= 100, `satır maxWidth'i aşmamalı: "${line}"`);
  }
  assert.match(lines[1], /…$/);
});

test("computeStoryLayout never lets a title line's rendered width exceed the text column, even for a title far too long to fit in 2 lines", () => {
  const layout = computeStoryLayout({
    title: "Bu başlık gerçekten çok fazla kelimeden oluşuyor ve normal koşullarda iki satıra sığmayacak kadar uzun bir ürün adı taşıyor kesinlikle",
    subtitle: "Kısa."
  });
  for (const line of layout.titleLines) {
    assert.ok(font.getAdvanceWidth(line, layout.titleSize) <= MAX_TEXT_WIDTH, `başlık satırı taşmamalı: "${line}"`);
  }
});

test("computeStoryLayout keeps the card's bottom edge fixed regardless of content length (only the top moves)", () => {
  const short = computeStoryLayout({ title: "Kısa", subtitle: "Kısa." });
  const long = computeStoryLayout({
    title: "Çok uzun ve pek çok kelimeden oluşan bir ürün başlığı burada yer alıyor",
    subtitle: "Bu da oldukça uzun ve birden fazla satıra sarılması gereken bir alt başlık metnidir, ürün bilgileri için inceleyiniz lütfen."
  });
  assert.equal(short.boxY + short.boxHeight, BOX_BOTTOM_Y);
  assert.equal(long.boxY + long.boxHeight, BOX_BOTTOM_Y);
});

test("computeStoryLayout shrinks the card and moves it down (closer to the canvas bottom) for short content", () => {
  const short = computeStoryLayout({ title: "Kısa Başlık", subtitle: "Kısa açıklama." });
  const long = computeStoryLayout({
    title: "Çok uzun ve pek çok kelimeden oluşan bir ürün başlığı burada yer alıyor",
    subtitle: "Bu da oldukça uzun ve birden fazla satıra sarılması gereken bir alt başlık metnidir, ürün bilgileri için inceleyiniz lütfen."
  });
  assert.ok(short.boxHeight < long.boxHeight, "kısa içerikte kart daha kısa olmalı");
  assert.ok(short.boxY > long.boxY, "kısa içerikte kart daha aşağıda başlamalı");
});

test("computeStoryLayout falls back to a smaller title size and wraps to 2 lines when the title doesn't fit at the default size", () => {
  const layout = computeStoryLayout({
    title: "Çok uzun ve pek çok kelimeden oluşan bir ürün başlığı burada yer alıyor",
    subtitle: "Kısa."
  });
  assert.equal(layout.titleSize, 32);
  assert.equal(layout.titleLines.length, 2);
});

test("computeStoryLayout keeps the default title size on a single line for short titles", () => {
  const layout = computeStoryLayout({ title: "Buzsu Su Arıtma", subtitle: "Kısa." });
  assert.equal(layout.titleSize, 42);
  assert.equal(layout.titleLines.length, 1);
});

// Alt metin artık en fazla 2 satıra sarılıyor (eskiden 3'tü) — kart, uzun
// bir Instagram metninde bile fotoğrafın giderek daha büyük bir kısmını
// kaplamasın diye bu tavan kasıtlı olarak düşürüldü (bkz. src/publish-approved.js
// storyImageUrl: artık ilk satırı sabit bir karakterde kesmiyor, tamamını
// buraya devrediyor — kartın büyümesini sınırlayan tek yer burası).
test("computeStoryLayout caps the subtitle at 2 lines, ending with an ellipsis when the content needs more", () => {
  const layout = computeStoryLayout({
    title: "Kısa",
    subtitle: "Bu alt başlık pek çok kelimeden oluşuyor ve normalde dört ya da beş satıra sarılması gerekecek kadar uzun bir metin içeriyor ama iki satırda durdurulmalı."
  });
  assert.equal(layout.subtitleLines.length, 2);
  assert.match(layout.subtitleLines[1], /…$/);
});

test("computeStoryLayout's worst-case content (1-line title, 2-line subtitle) keeps the card noticeably shorter than the old 3-line design", () => {
  const layout = computeStoryLayout({
    title: "Kısa Başlık",
    subtitle: "Bu alt başlık pek çok kelimeden oluşuyor ve normalde dört ya da beş satıra sarılması gerekecek kadar uzun bir metin içeriyor ama iki satırda durdurulmalı."
  });
  assert.equal(layout.subtitleLines.length, 2);
  // Eski (3 satırlı) tasarımın en kötü durumu boxHeight=390 üretiyordu; yeni
  // 2 satırlık tavan bundan en az bir satır yüksekliği (~52px) kısa olmalı.
  assert.ok(layout.boxHeight <= 390 - 40, `yeni tavan eskisinden belirgin şekilde kısa olmalı, boxHeight=${layout.boxHeight}`);
});

test("computeStoryLayout produces strictly increasing baselines with no overlap between title, subtitle and footer", () => {
  const layout = computeStoryLayout({
    title: "Çok uzun ve pek çok kelimeden oluşan bir ürün başlığı burada yer alıyor",
    subtitle: "Bu da oldukça uzun ve birden fazla satıra sarılması gereken bir alt başlık metnidir, ürün bilgileri için inceleyiniz lütfen."
  });
  const allBaselines = [...layout.titleBaselines, ...layout.subtitleBaselines, layout.footerBaseline];
  for (let i = 1; i < allBaselines.length; i++) {
    assert.ok(allBaselines[i] > allBaselines[i - 1], `baseline ${i} önceki satırdan sonra gelmeli`);
  }
});
