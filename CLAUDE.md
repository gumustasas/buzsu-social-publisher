# CLAUDE.md

## dashboard.html: bekleyen bir bakım kararı

`dashboard.html` (~110 KB, build'siz, tek dosyada inline CSS+JS) üzerinde birden
fazla PR'da (özellikle sekmelere geçiş PR #67 ve ardından #68) gerçek hatalar
çıktı: Genel Bakış'ın yanlışlıkla görünür kalması, Editor rolünün ekranı
tamamen boşaltması, üst başlığın sekmeyle senkron olmaması, mobil takvim
gezinmesinin taşması. Bunların hepsi merge öncesi/sonrası elle yazılan,
hiç commit edilmeyen (atılan) Playwright testleriyle yakalandı. Backend'in
(`api/*.js`, `src/lib/*.js`) 383 testlik gerçek bir `node --test` paketi var;
`dashboard.html`'in hiç kalıcı testi yok.

**Karar (kullanıcı onaylı):** Bunu şimdi yapmıyoruz — aktif bir dashboard.html
değişikliği planlanmadığı sürece yazılacak testler kimseyi korumadan durur.

**Bir sonraki dashboard.html UI değişikliği istendiğinde**, kodu yazmadan önce:
1. O anki stabil davranışı kapsayan dar bir regresyon test dosyası ekle
   (ör. `test/dashboard-ui.test.js`): sekme geçişinde aynı anda yalnızca bir
   panelin görünür olması + `<h1>` senkronu, Admin/Editor rol tabanlı görünürlük
   (`#admin` gizleme, "Kullanıcılar" nav butonu), sekme değişiminde form
   verisinin (`#manual-text`, `#product-search` vb.) korunması, çapraz
   bağlantılar (Composer'a yönlendiren linkler), kuyruk görünüm-anahtarının
   (Liste/Kanban/Izgara/Takvim) her zaman tam olarak bir görünümü açık tutması
   ve Takvim'in hafta durumunun (`weekOffset`) sekme/görünüm değişince
   korunması.
2. Sonra istenen değişikliği yap.

Bilinçli olarak dar tutulmalı — kapsamlı bir E2E paketi değil, tam bu 4-5
tekrarlayan kontrol. Amaç: testin kendisinin bakım yükü haline gelmemesi.

**Not:** Playwright şu an projenin bağımlılığı değil (`package.json`'da yok);
bu test dosyası eklenirse `devDependency` olarak eklenmeli, prod bundle'ı
etkilememeli.

## Mobil "uygulama gibi" (PWA) taslağı — reddedildi

Alt sabit navigasyon (Üret/Kuyruk/Takvim/Diğer), kompakt başlık, PWA
manifest/standalone açılış ve yeni ikon önerisi kullanıcıya bir önizleme
(artifact mockup) olarak sunuldu ve **kullanıcı tarafından reddedildi**
("mevcut dashboard görünümü daha iyi"). Hiçbir kod uygulanmadı. Bu yön
tekrar istenmedikçe yeniden önerilmemeli.
