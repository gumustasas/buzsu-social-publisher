// Kullanıcıya gösterilen model etiketleri — backend'de her zaman gerçek
// canonical Google model ID'leri kullanılmaya devam eder (bkz. src/veo-video.js
// VEO_MODEL_TIERS, src/omni-video.js OMNI_MODEL, src/scene-image.js
// NANO_BANANA_2_MODEL). Bu dosya SADECE görüntüleme metnidir; hiçbir tier'ı
// başka birine eşlemez/değiştirmez — "Quality" etiketi hâlâ aynı
// "veo-3.1-generate-preview" ID'sine gider, sadece UI'da "Generate" yerine
// "Quality" yazılır.
export const VEO_TIER_UI_LABELS = {
  economy: "Veo 3.1 Lite",
  fast: "Veo 3.1 Fast",
  quality: "Veo 3.1 Quality"
};

export const OMNI_UI_LABEL = "Gemini Omni 1.1 Flash";
export const NANO_BANANA_2_UI_LABEL = "Nano Banana 2";
export const NANO_BANANA_2_LITE_UI_LABEL = "Nano Banana 2 Lite";
export const NANO_BANANA_PRO_UI_LABEL = "Nano Banana Pro";
