import { INSTALLATION_CONTEXT_LABELS } from "./product-installation-context.js";

// "Faz 1" üretim-sonrası görsel kontrolü: AI ile üretilen sahne görselini,
// sahneyi üreten AI'dan BAĞIMSIZ bir vision çağrısıyla somut, sabit bir
// kontrol listesine karşı denetler. Bilinçli olarak SADECE RAPORLAMA
// yapar — hiçbir zaman otomatik yeniden üretim tetiklemez veya yayını
// engellemez; needsReview/failedChecks yalnızca ilgili çağıranın (dashboard,
// MCP aracı) kararına bilgi sağlar. Bu, gerçek üretim hatalarından (sahte
// tabela, kopuk/eksik parça, yanlış bağlam) sonra eklenen ikinci bir
// güvenlik ağıdır — mevcut deterministik context/identity mimarisinin
// (bkz. product-installation-context.js, scenario-schema.js) YERİNE geçmez,
// onu değiştirmez.
const DEFAULT_MODEL = "gemini-3.5-flash";
const API_BASE = "https://generativelanguage.googleapis.com/v1beta";

// needsReview, modelin kendi verdiği bir "confidence" puanından DEĞİL, bu
// sabit listedeki somut kontrol kodlarından türetilir — LLM'lerin kendi
// güven puanları genelde kalibrasyonsuzdur, oysa "hangi kontrol başarısız
// oldu" denetlenebilir ve panelde/MCP yanıtında doğrudan gösterilebilir.
export const SCENE_VALIDATION_CHECKS = new Set(["product_identity", "part_integrity", "context_match", "fabricated_signage"]);

function validationPrompt({ usageContext, sceneDescription, productTitle }) {
  const contextLabel = usageContext ? (INSTALLATION_CONTEXT_LABELS[usageContext] || usageContext) : null;
  const contextCriterion = contextLabel
    ? `- context_match: Sahne "${contextLabel}" bağlamıyla tutarlı mı (${usageContext === "technical_installation" ? "mutfak/salon/çamaşır odası gibi bir İÇ MEKÂN ev ortamı GÖRÜNMEMELİ" : "bina girişi/teknik tesisat/dış cephe gibi bir ortam GÖRÜNMEMELİ"})?`
    : `- context_match: (Bu üretim için hedef bağlam belirtilmedi, bu kriteri değerlendirme.)`;
  return `Aşağıdaki görsel, "${productTitle}" adlı su arıtma ürününün sosyal medya paylaşımı için AI ile üretilmiş bir sahne görselidir. Hedeflenen sahne açıklaması: "${sceneDescription || "(belirtilmedi)"}".

Görseli şu 4 kritere göre değerlendir:
- product_identity: Görseldeki ürün, açıklanan ürünle aynı temel cihaz mı — başka bir cihaza/markaya dönüşmüş, tamamen farklı bir şekle bürünmüş OLMAMALI.
- part_integrity: Ürünün parçaları (varsa filtre gövdeleri, kartuşlar, bağlantılar) eksiksiz ve fiziksel olarak makul şekilde bağlı görünüyor mu — havada asılı, kopuk veya eksik parça OLMAMALI.
${contextCriterion}
- fabricated_signage: Sahnede gerçek olmayan, üzerinde yazı/marka adı bulunan bir tabela, pano veya etiket var mı — bu OLMAMALI.

Yanıtı YALNIZCA şu JSON şemasına göre ver, başka açıklama ekleme: {"failedChecks":["product_identity"|"part_integrity"|"context_match"|"fabricated_signage", ...], "notes":"kısa Türkçe açıklama, hiçbir kriter başarısız değilse boş bırakılabilir"}. Bir kriter net şekilde başarısızsa kodunu failedChecks dizisine ekle; emin değilsen veya kriter uygulanamıyorsa (ör. context belirtilmediyse) dizide o kriteri ekleme.`;
}

// buffer: PNG/JPEG görsel baytları (branding/logo bindirilmeden ÖNCEKİ, AI'nın
// ham çıktısı — branding bizim kendi deterministik kodumuz, AI hatası değil).
export async function validateSceneImage(buffer, { usageContext, sceneDescription, productTitle } = {}, env = process.env) {
  if (!env.GEMINI_API_KEY) {
    return { checked: false, needsReview: false, failedChecks: [], notes: "GEMINI_API_KEY tanımlı değil, otomatik görsel kontrolü atlandı." };
  }
  try {
    const model = env.GEMINI_SCENE_VALIDATION_MODEL || DEFAULT_MODEL;
    const prompt = validationPrompt({ usageContext, sceneDescription, productTitle });
    const response = await fetch(`${API_BASE}/models/${model}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": env.GEMINI_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }, { inlineData: { mimeType: "image/png", data: buffer.toString("base64") } }] }],
        generationConfig: { responseMimeType: "application/json" }
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || `Gemini HTTP ${response.status}`);
    const text = data.candidates?.[0]?.content?.parts?.find((part) => typeof part.text === "string")?.text || "{}";
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = {}; }
    const failedChecks = Array.isArray(parsed.failedChecks) ? parsed.failedChecks.filter((check) => SCENE_VALIDATION_CHECKS.has(check)) : [];
    return { checked: true, needsReview: failedChecks.length > 0, failedChecks, notes: typeof parsed.notes === "string" ? parsed.notes : "" };
  } catch (error) {
    // Doğrulama çağrısının kendisi başarısız olursa (ağ, kota, geçersiz yanıt)
    // ana sahne üretimi akışı BUNUN YÜZÜNDEN asla engellenmemeli — rapor
    // edilemedi diye sessizce "kontrol edilemedi" dönülür, hata fırlatılmaz.
    return { checked: false, needsReview: false, failedChecks: [], notes: `Doğrulama başarısız: ${error.message}` };
  }
}
