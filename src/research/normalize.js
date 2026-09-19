const MAX_SOURCES = 20;

function cleanText(value, maxLength) {
  const text = String(value || "").trim();
  return text.length > maxLength ? `${text.slice(0, maxLength).trimEnd()}…` : text;
}

// google-search.js/openai-search.js'ten gelen ham kaynakları (grounding
// chunk/url_citation, sağlayıcıya göre farklı şekilli) TEK bir ortak şekle
// indirger: {url, title, snippet, provider}. Aynı URL birden fazla kez
// gelirse (ör. hem arama sonucu hem url_context aynı sayfayı döndürürse)
// yalnız İLK görülen tutulur — provider'ın kendi sırası (relevans) korunur.
export function normalizeSources(rawSources = []) {
  const seen = new Set();
  const normalized = [];
  for (const raw of Array.isArray(rawSources) ? rawSources : []) {
    const url = String(raw?.url || "").trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    normalized.push({
      url,
      title: cleanText(raw?.title, 200) || url,
      snippet: cleanText(raw?.snippet, 400),
      provider: raw?.provider || null
    });
    if (normalized.length >= MAX_SOURCES) break;
  }
  return normalized;
}
