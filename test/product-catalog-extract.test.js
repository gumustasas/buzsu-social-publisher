import test from "node:test";
import assert from "node:assert/strict";
import { extractCatalog } from "../src/lib/product-catalog.js";

// llms-full.txt'in canlı yayındaki gerçek biçimini yansıtan bir örnek —
// kategori başlıkları, "Ana Ürün" kalıbı, ürün tabloları, alt-kategori
// tabloları ve URL'siz bilgi tabloları bir arada.
const SAMPLE = `
### İletişim
**URL:** https://www.buzsu.com.tr/iletisim/

| Bilgi | Detay |
|---|---|
| Merkez Adres | Kavallar Cad. No:42/1 Merkez / Bartın |
| Mobil (7/24) | 0552 789 6905 |

---

### Ev Tipi Su Arıtma Cihazları
**URL:** https://www.buzsu.com.tr/ev-tipi-su-aritma-cihazlari/
**Açıklama:** Mutfak tezgahı altına kurulan sistemler.

#### ⭐ Ana Ürün: Code Su Arıtma Cihazı
**URL:** https://www.buzsu.com.tr/code-su-aritma-cihazi/

En çok tercih edilen flagship modeli.

---

#### Diğer Ev Tipi Ürünler

| Ürün | URL |
|---|---|
| Naturalsnet 11 Aşama Alkali (Alman KRAFT Membran) | /naturalsnet-11-asama-alkali-su-aritma-cihazi/ |
| Buzsu Slim Kasa Tezgah Altı (Made in Korea) | /buzsu-slim-kasa-tezgah-alti-su-aritma-cihazi-made-in-korea/ |

---

### Endüstriyel Kireç Önleyiciler
**URL:** https://www.buzsu.com.tr/endustriyel-kirec-onleyiciler/

| Ürün | URL |
|---|---|
| 1 İnç Manyetik Kireç Önleyici — Apartman Tipi | /1-inch-manyetik-kirec-onleyici-apartman-tipi/ |
| 3 İnç Manyetik Kireç Önleyici DN-80 | /3-inc-manyetik-kirec-onleyici-dn-80/ |

---

## Su Arıtma Yedek Parçaları

**Ana Kategori URL:** https://www.buzsu.com.tr/su-aritma-yedek-parcalari/

| Alt Kategori | URL | Açıklama |
|---|---|---|
| Su Arıtma Tankları | /su-aritma-tanklari/ | Basınçlı depolama tankları |

---

### Ters Osmoz (RO) vs Ultrafiltrasyon (UF)

| Özellik | Ters Osmoz (RO) | Ultrafiltrasyon (UF) |
|---|---|---|
| Gözenek büyüklüğü | ~0,0001 mikron | ~0,01–0,1 mikron |
`;

test("extractCatalog captures the flagship 'Ana Ürün' product with its exact title and absolute URL", () => {
  const catalog = extractCatalog(SAMPLE);
  const flagship = catalog.find((p) => p.url === "https://www.buzsu.com.tr/code-su-aritma-cihazi/");
  assert.ok(flagship);
  assert.equal(flagship.title, "Code Su Arıtma Cihazı");
});

test("extractCatalog captures product-table rows and resolves relative URLs to absolute", () => {
  const catalog = extractCatalog(SAMPLE);
  const naturalsnet = catalog.find((p) => p.url === "https://www.buzsu.com.tr/naturalsnet-11-asama-alkali-su-aritma-cihazi/");
  assert.ok(naturalsnet);
  assert.equal(naturalsnet.title, "Naturalsnet 11 Aşama Alkali (Alman KRAFT Membran)");
});

test("extractCatalog never emits a markdown table separator or category name as a product title", () => {
  const catalog = extractCatalog(SAMPLE);
  const titles = catalog.map((p) => p.title);
  assert.ok(!titles.some((t) => /^\|?-+\|?-*$/.test(t)), `garbage separator title leaked: ${JSON.stringify(titles)}`);
  assert.ok(!titles.includes("İletişim"));
  assert.ok(!titles.includes("Ev Tipi Su Arıtma Cihazları"));
  assert.ok(!titles.includes("Endüstriyel Kireç Önleyiciler"));
});

test("extractCatalog excludes 'Alt Kategori' tables (sub-category links, not individual products)", () => {
  const catalog = extractCatalog(SAMPLE);
  assert.ok(!catalog.some((p) => p.url.includes("su-aritma-tanklari")));
});

test("extractCatalog excludes plain info tables that have no URL column", () => {
  const catalog = extractCatalog(SAMPLE);
  assert.ok(!catalog.some((p) => /Ters Osmoz|Ultrafiltrasyon|Gözenek/.test(p.title)));
  assert.ok(!catalog.some((p) => /Merkez Adres|Mobil/.test(p.title)));
});

test("extractCatalog returns exactly the 5 real products in the sample, no more", () => {
  const catalog = extractCatalog(SAMPLE);
  const urls = catalog.map((p) => p.url).sort();
  assert.deepEqual(urls, [
    "https://www.buzsu.com.tr/1-inch-manyetik-kirec-onleyici-apartman-tipi/",
    "https://www.buzsu.com.tr/3-inc-manyetik-kirec-onleyici-dn-80/",
    "https://www.buzsu.com.tr/buzsu-slim-kasa-tezgah-alti-su-aritma-cihazi-made-in-korea/",
    "https://www.buzsu.com.tr/code-su-aritma-cihazi/",
    "https://www.buzsu.com.tr/naturalsnet-11-asama-alkali-su-aritma-cihazi/"
  ].sort());
});
