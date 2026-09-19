// TASK-001 (research_web) — Google adapter. Gemini'nin googleSearch tool'u
// (Search Grounding) ve urlContext tool'u (verilen URL'lerin içeriğini
// modele okutur) AYNI generateContent çağrısında birleştirilebilir — bu
// creative-providers/google.js'teki generateReelScriptGoogle'ın (AYNI
// GEMINI_API_KEY, aynı generateContent uç noktası) GERÇEK ARAMA/URL OKUMA
// tool'larıyla genişletilmiş halidir; yeni bir HTTP taşıması icat edilmedi.
// GERÇEK PARA HARCAR (bu bir inference çağrısıdır) — confirmed kontrolü
// çağıran tarafta (bkz. api/mcp.js research_web, src/reel-script.js) yapılır.

export async function researchWithGoogle({ query, urls = [] }, env = process.env, { fetchImpl = fetch } = {}) {
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY tanımlı değil.");

  const model = env.GOOGLE_RESEARCH_MODEL || env.GEMINI_REEL_MODEL || "gemini-3.5-flash";
  const tools = [{ googleSearch: {} }];
  const promptText = urls.length
    ? `${query}\n\nAşağıdaki URL'lerin güncel içeriğini de dikkate al:\n${urls.join("\n")}`
    : query;
  if (urls.length) tools.push({ urlContext: {} });

  const response = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ parts: [{ text: promptText }] }], tools })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message || `Gemini HTTP ${response.status}`);

  const candidate = (data.candidates || [])[0] || {};
  const answer = (candidate.content?.parts || []).map((part) => part.text || "").join("").trim();
  const grounding = candidate.groundingMetadata || {};

  // groundingChunks: googleSearch'ün bulduğu sayfalar. urlContextMetadata:
  // urlContext tool'unun GERÇEKTEN okuyabildiği (urlRetrievalStatus) girilen
  // URL'ler — ikisi de birer "kaynak" olarak normalize.js'e verilir, hangisinin
  // hangi tool'dan geldiği provider seviyesinde AYRIŞTIRILMAZ (task kapsamı
  // yalnızca normalize edilmiş {url,title} listesidir).
  const chunkSources = (grounding.groundingChunks || [])
    .map((chunk) => chunk?.web)
    .filter(Boolean)
    .map((web) => ({ url: web.uri, title: web.title, provider: "google" }));
  // URL Context metadata is a top-level Candidate field in generateContent,
  // not nested inside groundingMetadata.
  const urlContextSources = (candidate.urlContextMetadata?.urlMetadata || [])
    .filter((entry) => entry?.retrievedUrl && entry?.urlRetrievalStatus === "URL_RETRIEVAL_STATUS_SUCCESS")
    .map((entry) => ({ url: entry.retrievedUrl, title: entry.retrievedUrl, provider: "google" }));

  return {
    answer,
    sources: [...chunkSources, ...urlContextSources],
    searchQueries: grounding.webSearchQueries || []
  };
}
