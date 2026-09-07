// Ürünün GERÇEK kullanım/montaj bağlamını (iç mekân tezgah altı cihaz mı,
// yoksa bina girişi/ana su hattı/teknik tesisat ürünü mü) ürün başlığından ve
// buzsu.com.tr grounding metninden çıkarır. Bu modül saf/deterministiktir —
// hiçbir AI çağrısı yapmaz — çünkü bağlamı YANLIŞ tahmin etmenin bedeli
// (bkz. gerçek hata: bina girişi filtresi iç mekân çamaşır odası sahnesinde
// gösterildi, borular yanlış bağlamda) bir LLM'in "yaratıcı" yorumuna
// bırakılamayacak kadar yüksek. AI yalnızca BU modülün belirlediği bağlam
// içinde sahne yazar (bkz. src/ai-providers.js generateScenario).
export const INSTALLATION_CONTEXTS = {
  INDOOR_COUNTERTOP: "indoor_countertop",
  TECHNICAL_INSTALLATION: "technical_installation",
  AMBIGUOUS: "ambiguous"
};

export const INSTALLATION_CONTEXT_LABELS = {
  [INSTALLATION_CONTEXTS.INDOOR_COUNTERTOP]: "Ev/ofis içi tezgah altı-üstü cihaz (mutfak)",
  [INSTALLATION_CONTEXTS.TECHNICAL_INSTALLATION]: "Bina girişi / ana su hattı / teknik tesisat (boru, dış mekân, teknik oda)"
};

// Sırayla kontrol edilir — bina girişi/tesisat kalıpları önce, çünkü bazı
// başlıklar iki grubun kelimelerini de içerebilir (ör. "Daire Girişi ...
// Filtre Seti"); tesisat bağlamı daha spesifik ve hata bedeli daha yüksek
// olduğu için önceliklidir.
const TECHNICAL_INSTALLATION_PATTERNS = [
  /daire girişi/i, /apartman tipi/i, /bina girişi/i, /ana su hattı/i, /ana hat/i,
  /manyetik kireç önleyici/i, /kireç önleyici/i, /endüstriyel/i, /kombi filtresi/i,
  /\d\s*inç/i, /\bdn\s*\d/i, /villa\b/i, /müstakil ev/i, /su sayacı/i, /membran filtre/i
];
const INDOOR_COUNTERTOP_PATTERNS = [
  /tezgah altı/i, /tezgah üstü/i, /mutfak/i, /sebil/i, /alkali/i, /ofis/i, /masa üstü/i
];

// Bağlam başına, sahnede KESİNLİKLE bulunmaması gereken öğeler. Senaryo
// doğrulaması (validateScenarioAgainstContext, bkz. scenario-schema.js) bu
// listeyi üretilen sahne metnine karşı tarar.
export const FORBIDDEN_ELEMENTS_BY_CONTEXT = {
  [INSTALLATION_CONTEXTS.TECHNICAL_INSTALLATION]: [
    "çamaşır makinesi", "çamaşır odası", "ev içi dekoratif", "salon", "oturma odası",
    "yatak odası", "banyo lavabosu", "mutfak tezgahı", "mutfak dolabı", "vazo", "dekoratif raf",
    "halı", "perde", "kanepe"
  ],
  [INSTALLATION_CONTEXTS.INDOOR_COUNTERTOP]: [
    "bina dışı boru hattı", "dış cephe", "kaldırım", "sokak"
  ]
};

// Kullanıcının serbest metin isteğinin ("evin içine koy" gibi) ürünün gerçek
// bağlamıyla ÇELİŞİP çelişmediğini kaba bir anahtar kelime taramasıyla tespit
// eder. Kesin bir NLP çözümü değildir — amaç, en bariz çelişkileri sessizce
// uygulamak yerine kullanıcıya onay/bağlam seçimi sorabilmektir (bkz.
// api/scene-scenario.js).
const INDOOR_REQUEST_PATTERNS = [/evin içi/i, /ev içine/i, /içeri koy/i, /salon/i, /mutfağa koy/i, /çamaşır odası/i];

export function detectsContextConflict(userNotes, usageContext) {
  if (usageContext !== INSTALLATION_CONTEXTS.TECHNICAL_INSTALLATION) return false;
  const text = String(userNotes || "");
  return INDOOR_REQUEST_PATTERNS.some((pattern) => pattern.test(text));
}

function matchesAny(text, patterns) {
  return patterns.filter((pattern) => pattern.test(text)).map((pattern) => pattern.source);
}

// product: { title, url }, context: fetchProductContext() çıktısı (boş olabilir).
export function classifyInstallationContext(product, context = "") {
  const haystack = `${product?.title || ""} ${context || ""}`;
  const technicalMatches = matchesAny(haystack, TECHNICAL_INSTALLATION_PATTERNS);
  const countertopMatches = matchesAny(haystack, INDOOR_COUNTERTOP_PATTERNS);

  if (technicalMatches.length && !countertopMatches.length) {
    return { context: INSTALLATION_CONTEXTS.TECHNICAL_INSTALLATION, matchedKeywords: technicalMatches, confident: true };
  }
  if (countertopMatches.length && !technicalMatches.length) {
    return { context: INSTALLATION_CONTEXTS.INDOOR_COUNTERTOP, matchedKeywords: countertopMatches, confident: true };
  }
  // Her iki tarafın da eşleşmesi (ör. hem "mutfak" hem "endüstriyel" geçmesi)
  // ya da hiçbirinin eşleşmemesi durumunda varsayım YAPILMAZ — kullanıcıya
  // sorulmalı (bkz. api/scene-scenario.js needsContextSelection).
  return { context: INSTALLATION_CONTEXTS.AMBIGUOUS, matchedKeywords: [...technicalMatches, ...countertopMatches], confident: false };
}
