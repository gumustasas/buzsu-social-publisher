import { createContentVariant } from "./content-variants.js";
import { baseProductTitle } from "./lib/product-title.js";

const riskyClaims = [/en iyi/gi, /kesinlikle sağlıklı/gi, /tedavi/gi, /hastalığı/gi, /garanti eder/gi, /%100/gi];

export function buildDraft(product, { format = "Gönderi", platforms = ["Instagram", "Facebook"], variant = 0, publishAt, captionOverride } = {}) {
  const url = String(product.url || "").trim();
  const content = captionOverride
    ? {
        title: baseProductTitle(product.title) || "Buzsu ürünü",
        sourceUrl: url,
        instagramText: `${captionOverride.instagramText}\n\nDetaylar: ${url}`,
        facebookText: `${captionOverride.facebookText}\n\nÜrünü inceleyin: ${url}`,
        hashtags: captionOverride.hashtags || "#Buzsu",
        format,
        platform: platforms
      }
    : createContentVariant({ ...product, format, platform: platforms }, variant);
  const allText = `${content.instagramText}\n${content.facebookText}`;
  const warnings = [];
  if (!product.url || !isHttps(product.url)) warnings.push("Kaynak URL herkese açık HTTPS olmalı.");
  if (!product.imageUrl || !isHttps(product.imageUrl)) warnings.push("Görsel URL herkese açık HTTPS olmalı.");
  if (!platforms.length) warnings.push("En az bir platform seçilmeli.");
  if (riskyClaims.some((pattern) => pattern.test(allText))) warnings.push("Kanıtsız sağlık veya üstünlük iddiası bulundu.");
  if (format === "Hikâye" && platforms.includes("Instagram")) warnings.push("Instagram hikâyesinde ürün bağlantı etiketi API tarafından otomatik eklenmez.");
  return { ...content, title: `${content.title} | ${format}`, publishAt, warnings, valid: warnings.filter((warning) => !warning.startsWith("Instagram hikâyesi")).length === 0 };
}

function isHttps(value) { try { return new URL(value).protocol === "https:"; } catch { return false; } }
