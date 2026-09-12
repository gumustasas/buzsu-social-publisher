import test from "node:test";
import assert from "node:assert/strict";
import { extractFeedCatalog } from "../src/lib/feed-catalog.js";

// Google Merchant/Shopping ürün feed'inin standart RSS 2.0 + "g:" ad alanı
// şeması (https://support.google.com/merchants/answer/7052112). Gerçek
// buzsu.com.tr/feed.xml'in ham XML'ine bu ortamdan erişilemediği için (ağ
// kısıtı), bu sabit/iyi bilinen şemaya göre elle hazırlanmış bir örnek
// kullanılıyor — canlı feed'in görsel/link alanları (Google Drive'daki
// düz-metne dönüşmüş kopyasından) bu yapıyla doğrulandı.
const SAMPLE_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<rss xmlns:g="http://base.google.com/ns/1.0" version="2.0">
<channel>
<item>
  <g:id>319</g:id>
  <title>Code Su Arıtma Cihazı - En Çok Tercih Edilen Su Arıtma Cihazı</title>
  <description><![CDATA[Buzsu Code su arıtma cihazı]]></description>
  <link>https://www.buzsu.com.tr/code-su-aritma-cihazi/</link>
  <g:image_link>https://www.buzsu.com.tr/code-siyah-2025-2.png</g:image_link>
  <g:additional_image_link>https://www.buzsu.com.tr/upload/big/code-kirmizi-2025.png</g:additional_image_link>
  <g:additional_image_link>https://www.buzsu.com.tr/upload/big/codeolculerimusluk.png</g:additional_image_link>
  <g:availability>in stock</g:availability>
  <g:price>13.749,00 TRY</g:price>
  <g:gtin>0644100878376</g:gtin>
  <g:brand>Buzsu</g:brand>
</item>
<item>
  <g:id>681</g:id>
  <title>Sebil Aparatı Hazneli Tip</title>
  <link>https://www.buzsu.com.tr/sebil-aparati-hazneli-tip/</link>
  <g:image_link>https://www.buzsu.com.tr/sebil-aparati-hazneli-itp.png</g:image_link>
  <g:availability>in stock</g:availability>
  <g:price>750,00 TRY</g:price>
</item>
<item>
  <g:id>999</g:id>
  <title>Görselsiz Ürün</title>
  <link>https://www.buzsu.com.tr/gorselsiz-urun/</link>
  <g:availability>in stock</g:availability>
</item>
<item>
  <g:id>1000</g:id>
  <title>Yabancı Site Ürünü</title>
  <link>https://baska-site.com/urun/</link>
  <g:image_link>https://baska-site.com/urun.png</g:image_link>
</item>
<item>
  <g:id>319</g:id>
  <title>Code Su Arıtma Cihazı (yinelenen)</title>
  <link>https://www.buzsu.com.tr/code-su-aritma-cihazi/</link>
  <g:image_link>https://www.buzsu.com.tr/farkli-gorsel.png</g:image_link>
</item>
</channel>
</rss>`;

test("extractFeedCatalog parses title, link and image gallery (main + additional) for a normal item", () => {
  const catalog = extractFeedCatalog(SAMPLE_FEED);
  const code = catalog.find((item) => item.url === "https://www.buzsu.com.tr/code-su-aritma-cihazi/");
  assert.equal(code.title, "Code Su Arıtma Cihazı - En Çok Tercih Edilen Su Arıtma Cihazı");
  assert.equal(code.imageUrl, "https://www.buzsu.com.tr/code-siyah-2025-2.png");
  assert.deepEqual(code.imageUrls, [
    "https://www.buzsu.com.tr/code-siyah-2025-2.png",
    "https://www.buzsu.com.tr/upload/big/code-kirmizi-2025.png",
    "https://www.buzsu.com.tr/upload/big/codeolculerimusluk.png"
  ]);
});

test("extractFeedCatalog handles a single-image item (imageUrls has exactly one entry)", () => {
  const catalog = extractFeedCatalog(SAMPLE_FEED);
  const sebil = catalog.find((item) => item.url === "https://www.buzsu.com.tr/sebil-aparati-hazneli-tip/");
  assert.equal(sebil.imageUrl, "https://www.buzsu.com.tr/sebil-aparati-hazneli-itp.png");
  assert.deepEqual(sebil.imageUrls, ["https://www.buzsu.com.tr/sebil-aparati-hazneli-itp.png"]);
});

test("extractFeedCatalog skips items with no image at all", () => {
  const catalog = extractFeedCatalog(SAMPLE_FEED);
  assert.equal(catalog.some((item) => item.url === "https://www.buzsu.com.tr/gorselsiz-urun/"), false);
});

test("extractFeedCatalog rejects items whose link is not on www.buzsu.com.tr", () => {
  const catalog = extractFeedCatalog(SAMPLE_FEED);
  assert.equal(catalog.some((item) => item.title === "Yabancı Site Ürünü"), false);
});

test("extractFeedCatalog keeps only the first occurrence of a duplicate product URL", () => {
  const catalog = extractFeedCatalog(SAMPLE_FEED);
  const matches = catalog.filter((item) => item.url === "https://www.buzsu.com.tr/code-su-aritma-cihazi/");
  assert.equal(matches.length, 1);
  assert.equal(matches[0].title, "Code Su Arıtma Cihazı - En Çok Tercih Edilen Su Arıtma Cihazı");
});

test("extractFeedCatalog returns an empty array for empty/malformed input", () => {
  assert.deepEqual(extractFeedCatalog(""), []);
  assert.deepEqual(extractFeedCatalog("bu xml değil"), []);
  assert.deepEqual(extractFeedCatalog(undefined), []);
});

test("extractFeedCatalog tolerates a missing g: namespace prefix on tags", () => {
  const noNamespace = `<rss><channel><item>
    <title>Ad alanısız Ürün</title>
    <link>https://www.buzsu.com.tr/ad-alanisiz-urun/</link>
    <image_link>https://www.buzsu.com.tr/gorsel.png</image_link>
  </item></channel></rss>`;
  const catalog = extractFeedCatalog(noNamespace);
  assert.equal(catalog.length, 1);
  assert.equal(catalog[0].imageUrl, "https://www.buzsu.com.tr/gorsel.png");
});
