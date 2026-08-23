// buzsu.com.tr ana sayfasından, kullanıcı tarafından HTTP durumu doğrulanmış
// ürün adı → gerçek ürün fotoğrafı URL eşlemesi (23.08.2026 tarihli liste).
// Bu, yalnızca llms-full.txt kataloğundan gelen (henüz Airtable kaydı
// olmayan) ürünlerin "Yeni içerik oluştur" ekranında otomatik bir fotoğraf
// referansıyla gelmesi içindir — Airtable'a hiçbir yazma yapılmaz. Kullanıcı
// panelden farklı bir URL yapıştırır/yüklerse (bkz. dashboard.html
// #product-imageurl, /api/upload-image) o değer bunun önüne geçer.
//
// Zaten bir Airtable kaydında doğru "Görsel URL" alanı olan ürünler
// (Code, UltraMag Daire Girişi, UltraMag Apartman Tipi 1", Atıksız Watercare,
// Code 5'li Set) bilerek buraya eklenmedi — o kayıtlar zaten kendi
// fotoğrafını taşıyor, burada tekrarlanmaz.
//
// Anahtarlar sondaki "/" ile normalize edilmiş ürün sayfası URL'leridir.
export const KNOWN_PRODUCT_PHOTOS = {
  "https://www.buzsu.com.tr/buzsu-code-tam-koruma-evim-avantajli-paket-kampanyasi/": "https://www.buzsu.com.tr/upload/small/evimpakettamkorumabuzsu.png",
  "https://www.buzsu.com.tr/buzsu-slim-kasa-tezgah-alti-su-aritma-cihazi-made-in-korea/": "https://www.buzsu.com.tr/upload/small/atiklirokore-membranli.png",
  "https://www.buzsu.com.tr/naturalsnet-11-asama-alkali-su-aritma-cihazi/": "https://www.buzsu.com.tr/upload/small/naturalsnet.png",
  "https://www.buzsu.com.tr/buzsu-sicak-soguk-su-sebili-dwp-817-s/": "https://www.buzsu.com.tr/upload/small/ayakli-sebil-aritmali.jpg",
  "https://www.buzsu.com.tr/filmtec-usa-membran-filtre-orjinal/": "https://www.buzsu.com.tr/upload/small/dow-filmtec-75-gpd-membran-filtre-1000x1000.jpg",
  "https://www.buzsu.com.tr/alkalix-5-asama-filtre-seti-cift-gac/": "https://www.buzsu.com.tr/upload/small/buzsualkalixhd5li.png",
  "https://www.buzsu.com.tr/conax-gold-8-asama-filtre-seti-orjinal/": "https://www.buzsu.com.tr/upload/small/conax-gold-yeni-seri-2023-8-li-set-.png",
  "https://www.buzsu.com.tr/watercare-atiksiz-su-aritma-cihazi-filtre-seti/": "https://www.buzsu.com.tr/upload/small/atiksiz-su-aritma-filtresiwatercare.png",
  "https://www.buzsu.com.tr/tds-metre/": "https://www.buzsu.com.tr/upload/small/tds-myr.jpg",
  "https://www.buzsu.com.tr/silifozlu-ev-ana-giris-su-aritma-sistemi/": "https://www.buzsu.com.tr/upload/small/daire-girisi-yeni-3-lu-sistem-.png",
  "https://www.buzsu.com.tr/villa-mustakil-ev-3-lu-tam-koruma-paketi-20-inc/": "https://www.buzsu.com.tr/upload/small/lu-85-mikron-pp-filtre--2-.png",
  "https://www.buzsu.com.tr/daire-girisi-celik-filtreli-manyetik-kirec-onleyicili-set/": "https://www.buzsu.com.tr/upload/small/ultramag-daire-girisi.png",
  "https://www.buzsu.com.tr/3-inc-manyetik-kirec-onleyici-dn-80/": "https://www.buzsu.com.tr/upload/small/manyetik-k-onleyici-buzsu-aritma-2026.png",
  "https://www.buzsu.com.tr/endustriyel-manyetik-kirec-onleyici/": "https://www.buzsu.com.tr/upload/small/4-inc-manyetik-filtre.webp",
  "https://www.buzsu.com.tr/apartman-tipi-manyetik-kirec-onleyici-32/": "https://www.buzsu.com.tr/upload/small/manyetik-k-onleyici-buzsu-aritma-2026.png",
  "https://www.buzsu.com.tr/apartman-tipi-manyetik-kirec-onleyici/": "https://www.buzsu.com.tr/upload/small/manyetik-k-onleyici-buzsu-aritma-2026.png",
  "https://www.buzsu.com.tr/buzsu-endustriyel-aritma-cihazi-500lt-1000-lt-1500-lt-gun-uretim/": "https://www.buzsu.com.tr/upload/small/buzsu-small-endustriyellerden-2024.png",
  "https://www.buzsu.com.tr/luxury-maxi-kabinet-su-yumusatma-cihazi/": "https://www.buzsu.com.tr/upload/small/adsiz-tasarim---2024-08-15t121347-126.png",
  "https://www.buzsu.com.tr/50-litre-krom-aritmali-endustriyel-su-sebili-cift-musluk/": "https://www.buzsu.com.tr/upload/small/50-litre-kapasiteli-su-sebili-cift-musluklu.png",
  "https://www.buzsu.com.tr/manyetik-kombi-filtresi/": "https://www.buzsu.com.tr/upload/small/rivermag-1-inc-manyetik-kombi-filtresi-endustriyel-kombi-filtresi-buzsu.jpg"
};

function normalize(url) {
  return String(url || "").replace(/\/+$/, "") + "/";
}

export function findKnownProductPhoto(url) {
  return KNOWN_PRODUCT_PHOTOS[normalize(url)] || "";
}
