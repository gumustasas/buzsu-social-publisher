import { getBuzsuProductContext } from "../lib/product-intelligence.js";
import { listProducts } from "../lib/products.js";
import { resolveProductUrl } from "../lib/buzsu-url.js";
import { KNOWLEDGE_PROVIDERS, resolveKnowledgeProvider } from "./provider.js";
import { SOURCE_PRIORITY } from "./prompt.js";
import { searchKnowledgeWithGoogle } from "./google.js";
import { searchKnowledgeWithOpenAi } from "./openai.js";

export { KNOWLEDGE_PROVIDERS, SOURCE_PRIORITY };

const RUNNERS = { google: searchKnowledgeWithGoogle, openai: searchKnowledgeWithOpenAi };

function normalizeQuery(query) {
  const value = String(query || "").trim();
  if (!value) throw new Error('"query" gerekli.');
  if (value.length > 1000) throw new Error('"query" en fazla 1000 karakter olabilir.');
  return value;
}

async function buildAuthoritativeContext(input, deps) {
  const getContext = deps.getBuzsuProductContextImpl || getBuzsuProductContext;
  const listProductsImpl = deps.listProductsImpl || listProducts;
  const context = await getContext({ productId: input.productId, productUrl: input.productUrl }, deps.productContextDeps || {});
  const products = await listProductsImpl();
  const canonical = resolveProductUrl(context.canonicalUrl);
  const match = products.find((item) =>
    (input.productId && item.id === input.productId) ||
    (canonical && resolveProductUrl(item.url) === canonical)
  );

  const airtable = match?.fromAirtable ? {
    productId: match.id,
    productName: match.title || context.productName,
    canonicalUrl: context.canonicalUrl,
    productImageUrls: match.imageUrls?.length ? match.imageUrls : match.imageUrl ? [match.imageUrl] : []
  } : null;

  const buzsuOfficial = {
    productName: context.productName,
    canonicalUrl: context.canonicalUrl,
    category: context.category || "",
    verifiedFacts: Array.isArray(context.verifiedFacts) ? context.verifiedFacts : [],
    technicalFeatures: Array.isArray(context.technicalFeatures) ? context.technicalFeatures : [],
    sellingPoints: Array.isArray(context.sellingPoints) ? context.sellingPoints : [],
    useCases: Array.isArray(context.useCases) ? context.useCases : [],
    targetAudience: Array.isArray(context.targetAudience) ? context.targetAudience : [],
    sourceUrls: Array.isArray(context.sourceUrls) ? context.sourceUrls : []
  };
  return { airtable, buzsuOfficial };
}

export async function searchProductKnowledge(input = {}, env = process.env, deps = {}) {
  if (input.confirmed !== true) {
    throw new Error("Bu işlem File Search/model kredisi kullanabilir. Onaylamak için confirmed:true gönderin.");
  }
  if (!input.productId && !input.productUrl) throw new Error("productId veya productUrl gerekli.");
  const query = normalizeQuery(input.query);
  const requested = input.provider || "auto";
  const resolved = resolveKnowledgeProvider(requested, env);
  if (!resolved.available) {
    const scope = requested === "auto" ? "auto (google/openai)" : requested;
    throw new Error(`Knowledge provider "${scope}" yapılandırılmamış (${resolved.reason}); başka sağlayıcıya sessiz fallback yapılmaz.`);
  }

  const authoritative = await buildAuthoritativeContext(input, deps);
  const runner = deps.runners?.[resolved.provider] || RUNNERS[resolved.provider];
  const raw = await runner({ query, authoritative }, env, deps);

  return {
    provider: resolved.provider,
    query,
    sourcePriority: SOURCE_PRIORITY,
    authoritative,
    answer: raw.answer,
    retrievedFacts: raw.retrievedFacts,
    conflicts: raw.conflicts,
    hasConflicts: raw.conflicts.length > 0,
    citations: raw.citations || [],
    model: raw.model || null
  };
}
