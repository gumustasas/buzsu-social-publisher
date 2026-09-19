import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const dashboard = await readFile(new URL("../dashboard.html", import.meta.url), "utf8");

// PR #102 ROOT review (blocker 4): loadSceneAvailability()'in provider→label
// eşlemesi TASK-003'ün eklediği "nano-banana-pro"/"openai-high" için AYRI bir
// dal içermiyordu — ikisi de son "else" dalına düşüp kullanıcıya "OpenAI"
// olarak gösteriliyordu (Gemini anahtarıyla gelen bir Google modeli "OpenAI"
// diye etiketlenmiş oluyordu). Bu test, o fonksiyonun ham kaynağında her iki
// değer için AÇIK ve BİRBİRİNDEN AYRI bir dal olduğunu doğrular.
function loadSceneAvailabilitySource() {
  // dashboard.html tek satır/minified JS içerir — fonksiyon gövdesi ayrı
  // satırlara yayılmaz, bu yüzden "balanced brace" ayrıştırma yerine bu
  // dosyada TEK olan provider→label ternary zincirini doğrudan arıyoruz.
  const startIndex = dashboard.indexOf("async function loadSceneAvailability");
  assert.ok(startIndex > -1, "loadSceneAvailability fonksiyonu dashboard.html'de bulunamadı");
  const endIndex = dashboard.indexOf(";}", startIndex);
  assert.ok(endIndex > -1, "loadSceneAvailability fonksiyonunun sonu bulunamadı");
  return dashboard.slice(startIndex, endIndex);
}

test("loadSceneAvailability: 'nano-banana-pro' için ayrı, açık bir etiket dalı vardır ve düz 'OpenAI' fallback'ine düşmez", () => {
  const fn = loadSceneAvailabilitySource();
  assert.match(fn, /p===['"]nano-banana-pro['"]\?['"][^'"]*Nano Banana Pro[^'"]*['"]/);
});

test("loadSceneAvailability: 'openai-high' için ayrı, açık bir etiket dalı vardır ve düz 'OpenAI' fallback'ine düşmez", () => {
  const fn = loadSceneAvailabilitySource();
  assert.match(fn, /p===['"]openai-high['"]\?['"][^'"]*OpenAI[^'"]*['"]/);
});

test("loadSceneAvailability: nano-banana-pro/openai-high dalları, düz 'OpenAI' fallback'inden ÖNCE gelir (ternary sırası doğru)", () => {
  const fn = loadSceneAvailabilitySource();
  const nanoBananaProIndex = fn.indexOf("nano-banana-pro");
  const openaiHighIndex = fn.indexOf("openai-high");
  const fallbackIndex = fn.lastIndexOf(":'OpenAI'");
  assert.ok(nanoBananaProIndex > -1 && nanoBananaProIndex < fallbackIndex);
  assert.ok(openaiHighIndex > -1 && openaiHighIndex < fallbackIndex);
});
