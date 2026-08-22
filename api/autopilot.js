import "dotenv/config";
import { getAutopilotEnabled, touchAutopilotRun } from "../src/lib/settings.js";
import { listProducts, listRawRecords, createDraftRecord } from "../src/lib/products.js";
import { pickNextProduct } from "../src/lib/autopilot.js";
import { generateScenePlan, generateCaption } from "../src/ai-providers.js";
import { generateSceneImage, availableSceneProviders } from "../src/scene-image.js";
import { buildDraft } from "../src/content-worker.js";
import { put } from "@vercel/blob";

function authorized(request) {
  const expected = process.env.CRON_SECRET;
  return Boolean(expected && request.headers.authorization === `Bearer ${expected}`);
}

// Otomatik Pilot: günde bir kez tetiklenir (bkz. vercel.json). Açıksa, en
// uzun süredir öne çıkarılmamış ürünü seçer, AI ile sahne + metin üretir ve
// bunu bir Taslak olarak Airtable'a yazar. Onay ve yayın hâlâ elle yapılır —
// bu uç nokta hiçbir zaman Durum'u Onaylandı yapmaz.
export default async function handler(request, response) {
  if (!authorized(request)) return response.status(401).json({ error: "Unauthorized" });
  try {
    const enabled = await getAutopilotEnabled();
    if (!enabled) return response.status(200).json({ ok: true, skipped: "disabled" });

    const [products, records] = await Promise.all([listProducts(), listRawRecords()]);
    const product = pickNextProduct(products, records);
    if (!product) {
      await touchAutopilotRun("Uygun (fotoğraflı) ürün bulunamadı.");
      return response.status(200).json({ ok: true, skipped: "no-product" });
    }

    const providers = availableSceneProviders(process.env);
    const provider = providers[0];
    if (!provider) {
      await touchAutopilotRun("OPENAI_API_KEY veya GEMINI_API_KEY tanımlı değil.");
      return response.status(200).json({ ok: true, skipped: "no-provider" });
    }

    const productRef = { title: product.title, url: product.url };
    const scenePlan = await generateScenePlan(provider, productRef, process.env);
    const caption = await generateCaption(provider, productRef, process.env);
    const scene = await generateSceneImage(product, scenePlan, process.env, { removeFaucet: false, provider });

    let imageUrl = product.imageUrl;
    if (process.env.BLOB_READ_WRITE_TOKEN) {
      const base64 = scene.dataUrl.split(",")[1] || "";
      const blob = await put(`ai-scenes/autopilot-${Date.now()}.png`, Buffer.from(base64, "base64"), { access: "public", contentType: "image/png" });
      imageUrl = blob.url;
    }

    const format = "Gönderi";
    const platforms = ["Instagram", "Facebook"];
    const publishAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const draft = buildDraft({ ...product, imageUrl }, { format, platforms, publishAt, captionOverride: caption });
    if (!draft.valid) {
      await touchAutopilotRun(`${product.title}: taslak geçersiz — ${draft.warnings.join(" ")}`);
      return response.status(200).json({ ok: true, skipped: "invalid-draft", product: product.title, warnings: draft.warnings });
    }

    const note = `Otomatik Pilot tarafından oluşturuldu (AI ile üretilmiş sahne görseli ve gönderi metni); önizleme ve kullanıcı onayı bekleniyor.`;
    const record = await createDraftRecord({ product: { ...product, imageUrl }, draft, format, platforms, publishAt, note });
    await touchAutopilotRun(`${product.title} için taslak oluşturuldu (${record.id}).`);
    return response.status(201).json({ ok: true, created: true, id: record.id, product: product.title });
  } catch (error) {
    console.error(error);
    try { await touchAutopilotRun(`Hata: ${String(error.message).slice(0, 500)}`); } catch {}
    return response.status(500).json({ ok: false, error: error.message });
  }
}
