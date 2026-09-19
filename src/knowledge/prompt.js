export const SOURCE_PRIORITY = ["airtable", "buzsu_official", "file_search"];

export const KNOWLEDGE_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    answer: { type: "string" },
    retrievedFacts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          fact: { type: "string" },
          source: { type: "string" }
        },
        required: ["fact", "source"]
      }
    },
    conflicts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          topic: { type: "string" },
          authoritativeFact: { type: "string" },
          retrievedFact: { type: "string" },
          retrievedSource: { type: "string" }
        },
        required: ["topic", "authoritativeFact", "retrievedFact", "retrievedSource"]
      }
    }
  },
  required: ["answer", "retrievedFacts", "conflicts"]
};

function safe(value, max = 12000) {
  return String(value || "").slice(0, max);
}

export function buildKnowledgePrompt({ query, authoritative }) {
  const authorityJson = JSON.stringify(authoritative, null, 2);
  return `Buzsu ürün bilgi tabanında şu soruyu araştır:

SORU:
${safe(query, 1000)}

KAYNAK ÖNCELİĞİ (değiştirilemez):
1. Airtable ürün kimliği/operasyonel kayıtları
2. Buzsu'nun resmi feed/canonical ürün sayfasından doğrulanmış gerçekler
3. File Search deposundan alınan ek belgeler

Aşağıdaki AUTHORITATIVE_CONTEXT daha yüksek otoritedir. File Search belgesi bununla çelişirse:
- yüksek otoriteli bilgiyi sessizce değiştirme,
- çatışmayı conflicts dizisine açıkça ekle,
- answer içinde çelişkili düşük öncelikli bilgiyi kesin gerçek gibi sunma.
File Search'te bulunan ve yüksek otoriteyle çelişmeyen ek bilgiyi retrievedFacts içine ekleyebilirsin.
Kaynakta bulunmayan ürün özelliğini uydurma.

AUTHORITATIVE_CONTEXT:
${safe(authorityJson)}

Yanıtı yalnız tanımlanan JSON şemasında döndür.`;
}
