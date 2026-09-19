import { sanitizeUserText } from "../lib/scenario-schema.js";
import { VISUAL_VALIDATION_CHECKS } from "./checks.js";

// TASK-004: reel-script-prompt.js/ai-providers.js'teki AYNI ilke —
// productTitle/sceneDescription kullanıcıdan/üretimden gelen serbest metin
// olabileceği için sanitizeUserText'ten geçirilip bir VERİ bloğu olarak
// çerçevelenir, talimat olarak yorumlanmaz.
export function buildComparisonPrompt({ productTitle, sceneDescription }) {
  const sanitizedTitle = sanitizeUserText(productTitle, { maxLength: 200 }) || "(belirtilmedi)";
  const sanitizedScene = sceneDescription ? sanitizeUserText(sceneDescription, { maxLength: 500 }) : "";
  const sceneBlock = sanitizedScene ? ` Hedeflenen sahne açıklaması: "${sanitizedScene}".` : "";

  return `İLK görsel "${sanitizedTitle}" adlı ürünün GERÇEK referans fotoğrafıdır. İKİNCİ görsel bu üründen AI ile üretilmiş bir sahne görselidir.${sceneBlock}

İKİNCİ görseli İLK görseldeki GERÇEK ürünle karşılaştırıp şu ${VISUAL_VALIDATION_CHECKS.length} kritere göre değerlendir:
- identity: İkinci görseldeki cihaz, ilk görseldeki ÜRÜNLE AYNI temel cihaz mı — başka bir cihaza/markaya dönüşmüş OLMAMALI.
- logo: Ürünün logosu/markası referansla tutarlı mı — uydurma veya değiştirilmiş bir logo OLMAMALI.
- label: Ürün etiketindeki/gövdesindeki yazılar referansla tutarlı mı — uydurma veya değiştirilmiş bir etiket metni OLMAMALI.
- proportions: Ürünün oranları (kalınlık, çap, boy) referansla BİREBİR tutarlı mı — daha kalın/ince/uzun/kısa gösterilmiş OLMAMALI.
- component_count: Referansta görünen tüm parçalar (filtre gövdeleri, kartuşlar, bağlantılar vb.) ikinci görselde de eksiksiz mi — eksik veya fazladan bir parça OLMAMALI.
- installation: Ürün sahnede gerçekçi şekilde kurulu/kullanımda mı — havada asılı, bağlantısız veya fiziksel olarak anlamsız bir yerleşim OLMAMALI.
- fabricated_text: Sahnede referansta olmayan, uydurma bir tabela/pano/etiket/yazı var mı — bu OLMAMALI.

Yanıtı YALNIZCA şu JSON şemasına göre ver, başka açıklama ekleme: {"failedChecks":[${VISUAL_VALIDATION_CHECKS.map((check) => `"${check}"`).join("|")}, ...], "notes":"kısa Türkçe açıklama, hiçbir kriter başarısız değilse boş bırakılabilir"}. Bir kriter net şekilde başarısızsa kodunu failedChecks dizisine ekle; emin değilsen o kriteri EKLEME (belirsizlik başarısızlık sayılmaz, notes'ta belirtebilirsin). Sayısal bir güven puanı/confidence/skor İSTEME ve ÜRETME — yalnızca failedChecks listesi değerlendirilecek, başka hiçbir alan okunmayacak.`;
}
