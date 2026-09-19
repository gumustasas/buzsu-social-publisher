// SubjectExtractor arayüzü (manifest: "subjectExtractor.extract(...)").
// subjectLock'un GERÇEK garantisi, gelişmiş bir segmentasyon modeli
// KURULMASINDAN değil, motorun HİÇBİR ZAMAN ürün pikselleri üzerinde
// üretken/deforme edici bir dönüşüm UYGULAMAMASINDAN gelir: camera.js
// yalnızca zoompan (tüm kare kırpma/ölçekleme) kullanır, hiçbir katman
// ürünü/logoyu/etiketi ayrı bir katman olarak yeniden çizmez, warp etmez
// veya generative fill uygulamaz (bkz. renderer'da tek bir subject-warp
// filtresi dahi YOK). Bu yüzden extract() de depth.getDepth() ile aynı
// dürüst fallback'i izler: her zaman null döner — "gelişmiş subject
// extraction mevcut değil, ama render bu YÜZDEN durmaz" (manifest: "never
// fail the whole render solely because advanced subject extraction is
// unavailable").
export async function extract(_image) {
  return null;
}

// Çağıran tarafın (scene-render.js) subjectLock=true olduğunda HER ZAMAN
// doğrulayabileceği yapısal garanti — bu bir "algılama" değil, motorun
// yalnızca kamera/arka plan hareketi uyguladığının (destructive product
// transform olmadığının) belgelenmiş açıklamasıdır.
export const STRUCTURAL_GUARANTEE =
  "subjectLock: motor yalnızca kamera (zoompan) ve renk/ışık post-processing filtreleri uygular; " +
  "hiçbir aşamada ürün/logo/etiket piksellerini ayrı bir katman olarak yeniden çizmez, warp etmez veya generative fill uygulamaz.";
