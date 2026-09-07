import "dotenv/config";
import { put } from "@vercel/blob";
import { listProducts, createDraftRecord } from "../src/lib/products.js";
import { generateCaption, generateHashtags, generateScenePlan, generateSeoArticle } from "../src/ai-providers.js";
import { baseProductTitle } from "../src/lib/product-title.js";
import { findCatalogProduct, isCatalogProductId } from "../src/lib/product-catalog.js";
import { buildDraft } from "../src/content-worker.js";
import { availableSceneProviders, generateSceneImage } from "../src/scene-image.js";
import { composeBrandedPost } from "../src/post-branding.js";
import { runPublisher } from "../src/publish-approved.js";
import { submitVeoVideo, veoVideoStatus, downloadVeoVideo } from "../src/veo-video.js";
import { getAutopilotEnabled, setAutopilotEnabled } from "../src/lib/settings.js";
import { AIRTABLE_BASE_ID as baseId, AIRTABLE_TABLE_ID as tableId } from "../src/lib/config.js";
import { fetchPublicImage, decodeImageBase64, imageExtensionFor } from "../src/lib/upload-media.js";

const MCP_API_KEY = process.env.MCP_API_KEY || "";
const SERVER_INFO = { name: "buzsu-social-publisher", version: "1.0.0" };

function authorized(request) {
  if (!MCP_API_KEY) return false;
  const header = request.headers.authorization || "";
  if (header === `Bearer ${MCP_API_KEY}`) return true;
  // ChatGPT/Codex bağlayıcı arayüzü OAuth dışında özel header eklemeye izin
  // vermiyor; bu istemciler için token'ı URL sorgu parametresinden de kabul
  // ediyoruz (?token=... veya ?api_key=...).
  const queryToken = request.query?.token || request.query?.api_key;
  return typeof queryToken === "string" && queryToken === MCP_API_KEY;
}

async function airtableGet(path = "") {
  const response = await fetch(`https://api.airtable.com/v0/${baseId}/${tableId}${path}?pageSize=100`, {
    headers: { Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}` }
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || `Airtable HTTP ${response.status}`);
  return data;
}

async function resolveProduct(productId) {
  if (isCatalogProductId(productId)) {
    const catalogProduct = await findCatalogProduct(productId);
    if (!catalogProduct) throw new Error("Ürün bulunamadı.");
    return { title: baseProductTitle(catalogProduct.title) || "Buzsu ürünü", url: catalogProduct.url, imageUrl: catalogProduct.imageUrl || "" };
  }
  const data = await airtableGet();
  const record = (data.records || []).find((item) => item.id === productId);
  if (!record) throw new Error("Ürün bulunamadı.");
  const fields = record.fields || {};
  return { title: baseProductTitle(fields.Başlık) || "Buzsu ürünü", url: fields["Kaynak URL"] || "", imageUrl: fields["Görsel URL"] || "" };
}

function pickProvider() {
  if (process.env.GEMINI_API_KEY) return "gemini";
  if (process.env.OPENAI_API_KEY || process.env.OPENAI_IMAGE_API_KEY) return "openai";
  throw new Error("AI sağlayıcı anahtarı (GEMINI_API_KEY veya OPENAI_API_KEY) tanımlı değil.");
}

const TOOLS = [
  {
    name: "list_products",
    description: "Airtable ve buzsu.com.tr katalogundaki tüm ürünleri listeler. Her ürünün id, title, url, imageUrl alanları döner.",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "list_queue",
    description: "Yayın kuyruğundaki tüm içerikleri listeler (taslak, onaylı, paylaşılmış). Her kaydın id, title, status, format, platforms, publishAt, imageUrl, instagramText, facebookText alanları döner.",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "generate_caption",
    description: "Seçilen ürün için Instagram ve Facebook gönderi metni (SEO odaklı, samimi Türkçe) ve hashtag üretir. instagramText, facebookText, hashtags döner.",
    inputSchema: {
      type: "object",
      properties: { productId: { type: "string", description: "Ürün ID'si (Airtable rec... veya llms:... formatında). list_products ile alınır." } },
      required: ["productId"]
    }
  },
  {
    name: "generate_hashtags",
    description: "Verilen metin, ürün ve Buzsu markasına göre 4-6 adet ilgili Türkçe hashtag üretir.",
    inputSchema: {
      type: "object",
      properties: {
        productId: { type: "string", description: "Ürün ID'si" },
        text: { type: "string", description: "Hashtag üretilecek paylaşım metni" }
      },
      required: ["productId", "text"]
    }
  },
  {
    name: "generate_scene_plan",
    description: "Ürünün sosyal medya sahne görseli için AI sahne açıklaması yazar (mutfak, aile, ortam tarifi gibi 2-4 cümlelik Türkçe paragraf).",
    inputSchema: {
      type: "object",
      properties: { productId: { type: "string", description: "Ürün ID'si" } },
      required: ["productId"]
    }
  },
  {
    name: "generate_seo_article",
    description: "Ürün veya konu için SEO uyumlu, uzun formatlı bir Türkçe makale üretir (title + body). LinkedIn, Medium, blog paylaşımları için.",
    inputSchema: {
      type: "object",
      properties: {
        productId: { type: "string", description: "Ürün ID'si" },
        topic: { type: "string", description: "İsteğe bağlı konu/anahtar kelime (boş bırakılırsa ürün adından türetilir)" }
      },
      required: ["productId"]
    }
  },
  {
    name: "generate_scene_image",
    description: "Ürünün gerçek fotoğrafını, verilen sahne açıklamasına göre AI ile yeni bir ortam/arka plana yerleştirir (ör. dış mekan boru montajı, mutfak tezgahı). Sonuca isteğe bağlı olarak alt kısımda ürün adı ve Buzsu logosu bindirilir. Üretilen görselin URL'sini döner ve (Airtable ürünüyse) kaydın Görsel URL alanını otomatik günceller — bu sayede create_draft bu görseli otomatik kullanır.",
    inputSchema: {
      type: "object",
      properties: {
        productId: { type: "string", description: "Ürün ID'si (gerçek bir ürün fotoğrafı olmalı)" },
        sceneDescription: { type: "string", description: "Sahnenin Türkçe açıklaması (ör. 'apartman girişinde dış mekanda, sıvalı duvara monte ana su borusu üzerinde, mavi gökyüzü altında profesyonel bir kurulum')" },
        removeFaucet: { type: "boolean", description: "Üründeki musluğu kaldırıp sahnede ayrı bir musluk mu gösterilsin (varsayılan false)" },
        brand: { type: "boolean", description: "Görselin altına ürün adı + Buzsu logosu bindirilsin mi (varsayılan true)" },
        provider: { type: "string", enum: ["gemini", "openai", "openai-low"], description: "AI görsel sağlayıcısı (varsayılan: mevcut olanlardan ilki, genelde gemini). Bir sağlayıcı sahnede istenmeyen bir öğeyi (ör. fazladan gösterge/panel) ısrarla üretmeye devam ederse diğerini deneyin." }
      },
      required: ["productId", "sceneDescription"]
    }
  },
  {
    name: "create_draft",
    description: "Yeni bir taslak içerik oluşturup yayın kuyruğuna ekler. Oluşturulan taslak 'Taslak' durumundadır, onaylanması gerekir.",
    inputSchema: {
      type: "object",
      properties: {
        productId: { type: "string", description: "Ürün ID'si" },
        format: { type: "string", enum: ["Gönderi", "Hikâye", "Reel"], description: "Yayın biçimi" },
        platforms: { type: "array", items: { type: "string", enum: ["Instagram", "Facebook", "X", "YouTube"] }, description: "Hedef platformlar — X metni verilmezse Facebook metni 280 karaktere kısaltılıp kullanılır; YouTube yalnızca format 'Reel' iken (video gerektirir) çalışır." },
        publishAt: { type: "string", description: "Yayın zamanı (ISO 8601, örn. 2026-09-05T10:00:00Z)" },
        instagramText: { type: "string", description: "Instagram gönderi metni (isteğe bağlı — verilmezse otomatik üretilir)" },
        facebookText: { type: "string", description: "Facebook gönderi metni (isteğe bağlı)" },
        hashtags: { type: "string", description: "Hashtagler (isteğe bağlı, örn. #Buzsu #SuArıtma)" },
        imageUrl: { type: "string", description: "İsteğe bağlı — verilirse ürünün kayıtlı ana görseli yerine SADECE bu taslak için bu HTTPS görsel URL'i kullanılır (ör. upload_media çıktısı). Ürünün Airtable'daki ana Görsel URL alanı değişmez." }
      },
      required: ["productId", "format", "platforms", "publishAt"]
    }
  },
  {
    name: "upload_media",
    description: "ChatGPT'de oluşturulmuş veya kullanıcının yüklediği hazır bir PNG/JPEG/WebP görselini Vercel Blob'a yükleyip herkese açık bir HTTPS URL döner — bu URL create_draft'a imageUrl olarak verilebilir. imageUrl (herkese açık HTTPS, sunucu indirir) veya imageBase64 (+ mimeType) alanlarından tam olarak biri verilmelidir. confirmed:true olmadan hiçbir yükleme/kayıt yapılmaz, yalnızca doğrulama sonucu döner.",
    inputSchema: {
      type: "object",
      properties: {
        imageUrl: { type: "string", description: "İndirilecek görselin herkese açık HTTPS URL'i (yalnızca biri: imageUrl veya imageBase64)" },
        imageBase64: { type: "string", description: "Görselin ham base64 verisi (data: öneki OLMADAN). mimeType ile birlikte verilmelidir." },
        mimeType: { type: "string", enum: ["image/png", "image/jpeg", "image/webp"], description: "imageBase64 kullanılıyorsa zorunlu" },
        filename: { type: "string", description: "İsteğe bağlı dosya adı ipucu (uzantı mimeType'tan belirlenir)" },
        productId: { type: "string", description: "İsteğe bağlı — updateProductImage:true ile birlikte hangi ürünün ana görselinin güncelleneceğini belirtir" },
        updateProductImage: { type: "boolean", description: "true ise ve productId bir Airtable kaydıysa, o ürünün ana Görsel URL alanı bu yüklenen görselle güncellenir (varsayılan false — yalnızca URL döner, katalog görseli değişmez)" },
        confirmed: { type: "boolean", description: "true olmadan Blob'a yükleme veya Airtable güncellemesi yapılmaz — yalnızca doğrulama/preview sonucu döner" }
      },
      required: ["confirmed"]
    }
  },
  {
    name: "update_draft",
    description: "Kuyruktaki mevcut bir taslağın Instagram/Facebook metnini, hashtag'lerini veya yayın zamanını günceller (ör. WhatsApp numarası veya ek bilgi eklemek için). Yalnızca verilen alanlar değiştirilir, diğerleri olduğu gibi kalır.",
    inputSchema: {
      type: "object",
      properties: {
        recordId: { type: "string", description: "Airtable kayıt ID'si (rec...)" },
        instagramText: { type: "string", description: "Yeni Instagram gönderi metni (isteğe bağlı)" },
        facebookText: { type: "string", description: "Yeni Facebook gönderi metni (isteğe bağlı)" },
        hashtags: { type: "string", description: "Yeni hashtagler (isteğe bağlı)" },
        publishAt: { type: "string", description: "Yeni yayın zamanı, ISO 8601 (isteğe bağlı)" }
      },
      required: ["recordId"]
    }
  },
  {
    name: "update_status",
    description: "Kuyruktaki bir içeriğin durumunu günceller. Akış: Taslak → Kontrol Edilecek → Onaylandı. Onaylanmış ve zamanı gelen içerikler otomatik yayınlanır.",
    inputSchema: {
      type: "object",
      properties: {
        recordId: { type: "string", description: "Airtable kayıt ID'si (rec...)" },
        status: { type: "string", enum: ["Taslak", "Kontrol Edilecek", "Onaylandı", "Durduruldu"], description: "Yeni durum" }
      },
      required: ["recordId", "status"]
    }
  },
  {
    name: "publish_now",
    description: "Onaylandı durumundaki ve yayın zamanı gelmiş (Yayın Zamanı <= şu an) içerikleri hemen yayınlar; normalde bu her 2 saatte bir otomatik çalışır. Belirli bir kaydı hemen yayınlamak için önce update_draft ile yayın zamanını geçmişe/şimdiye çekin, sonra bu tool'u çağırın.",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "generate_video_clip",
    description: "Bir referans görseli (örn. generate_scene_image çıktısı, markasız hali) verilen sinematik prompt'a göre Google Veo 3.1 ile kısa bir video klibe dönüştürür (image-to-video). GERÇEK PARA HARCAR — maliyet çözünürlük/süreye göre değişir (Fast/720p ~$0.08-0.10/sn, Fast/1080p ve tam Veo modelleri daha yüksek). Üretim uzun sürdüğü için (dakikalar) bu tool işi başlatıp hemen bir operationName döner — sonucu almak için get_video_clip_status ile bu operationName'i sorgulayın. confirmed:true verilmezse hiçbir API çağrısı/harcama yapılmaz.",
    inputSchema: {
      type: "object",
      properties: {
        imageUrl: { type: "string", description: "Referans görselin herkese açık HTTPS URL'si (markasız/logosuz sahne görseli önerilir — logo/yazı da animasyona karışabilir)" },
        prompt: { type: "string", description: "Sinematik video prompt'u (İngilizce önerilir; kamera hareketi, negatif kısıtlar vb. dahil)" },
        aspectRatio: { type: "string", description: "En-boy oranı (varsayılan '9:16', Reels için)" },
        durationSeconds: { type: "number", description: "Video süresi, saniye (isteğe bağlı — verilmezse modelin varsayılanı kullanılır; Google'ın kabul ettiği değerler modele göre değişir, örn. 4/6/8)" },
        resolution: { type: "string", enum: ["720p", "1080p"], description: "Çözünürlük (isteğe bağlı, varsayılan model varsayılanı — genelde 720p). 1080p daha yüksek maliyetlidir." },
        model: { type: "string", description: "Veo model adı (isteğe bağlı, varsayılan 'veo-3.1-fast-generate-preview'). Örn. tam kaliteli 'veo-3.1-generate-preview' — daha yavaş ve pahalı." },
        title: { type: "string", description: "Görüntüleme amaçlı ürün/klip adı (isteğe bağlı)" },
        confirmed: { type: "boolean", description: "true olmadan hiçbir API çağrısı yapılmaz/ücret alınmaz — gerçek harcamayı bilerek onayladığınızı belirtir" }
      },
      required: ["imageUrl", "prompt", "confirmed"]
    }
  },
  {
    name: "get_video_clip_status",
    description: "generate_video_clip ile başlatılmış bir Veo işinin durumunu sorgular. Tamamlandıysa videoyu indirip Vercel Blob'a yükler ve herkese açık videoUrl döner; henüz bitmediyse IN_PROGRESS döner (birkaç dakika sonra tekrar deneyin).",
    inputSchema: {
      type: "object",
      properties: {
        operationName: { type: "string", description: "generate_video_clip yanıtındaki operationName" }
      },
      required: ["operationName"]
    }
  },
  {
    name: "get_autopilot_status",
    description: "Otomatik Pilot'un açık mı kapalı mı olduğunu döner. Açıksa günde bir kez (Vercel cron) en uzun süredir öne çıkarılmamış ürün için otomatik sahne görseli + metin üretip Taslak olarak kuyruğa ekler; onay hâlâ elle yapılır, hiçbir zaman otomatik yayınlanmaz.",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "set_autopilot",
    description: "Otomatik Pilot'u açar veya kapatır. Açıksa günde bir kez otomatik taslak oluşturmaya başlar (yayın değil, yalnızca taslak — onay hâlâ elle yapılır).",
    inputSchema: {
      type: "object",
      properties: {
        enabled: { type: "boolean", description: "true: aç, false: kapat" }
      },
      required: ["enabled"]
    }
  }
];

async function callTool(name, args) {
  switch (name) {
    case "list_products": {
      const products = await listProducts();
      return JSON.stringify(products, null, 2);
    }
    case "list_queue": {
      const data = await airtableGet("?pageSize=100");
      const records = (data.records || []).map((record) => {
        const fields = record.fields || {};
        return {
          id: record.id, title: fields["Başlık"] || "Başlıksız", status: fields.Durum || "Taslak",
          format: fields["Yayın Biçimi"] || "Gönderi", platforms: fields.Platform || [],
          publishAt: fields["Yayın Zamanı"] || null, imageUrl: fields["Görsel URL"] || "",
          instagramText: fields["Instagram Metni"] || "", facebookText: fields["Facebook Metni"] || ""
        };
      });
      return JSON.stringify(records, null, 2);
    }
    case "generate_caption": {
      const product = await resolveProduct(args.productId);
      const caption = await generateCaption(pickProvider(), product, process.env);
      return JSON.stringify(caption, null, 2);
    }
    case "generate_hashtags": {
      const product = await resolveProduct(args.productId);
      const hashtags = await generateHashtags(pickProvider(), product, args.text, process.env);
      return hashtags;
    }
    case "generate_scene_plan": {
      const product = await resolveProduct(args.productId);
      const plan = await generateScenePlan(pickProvider(), product, process.env);
      return plan;
    }
    case "generate_seo_article": {
      const product = await resolveProduct(args.productId);
      const article = await generateSeoArticle(pickProvider(), product, args.topic, process.env);
      return JSON.stringify(article, null, 2);
    }
    case "generate_scene_image": {
      const product = await resolveProduct(args.productId);
      if (!product.imageUrl) throw new Error("Bu ürünün bilinen bir fotoğrafı yok; önce Görsel URL alanını doldurun.");
      const providers = availableSceneProviders(process.env);
      if (!providers.length) throw new Error("AI görsel sağlayıcı anahtarı (GEMINI_API_KEY veya OPENAI_API_KEY) tanımlı değil.");
      const provider = providers.includes(args.provider) ? args.provider : providers[0];
      const scene = await generateSceneImage(product, args.sceneDescription, process.env, {
        removeFaucet: Boolean(args.removeFaucet),
        provider
      });
      let finalBuffer = Buffer.from(scene.dataUrl.split(",")[1], "base64");
      if (args.brand !== false) finalBuffer = await composeBrandedPost(finalBuffer, { title: product.title });

      let imageUrl = `data:image/png;base64,${finalBuffer.toString("base64")}`;
      let uploaded = false;
      if (process.env.BLOB_READ_WRITE_TOKEN) {
        const safeId = String(args.productId).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80);
        const blob = await put(`ai-scenes/${safeId}-${Date.now()}.png`, finalBuffer, { access: "public", contentType: "image/png" });
        imageUrl = blob.url;
        uploaded = true;
      }

      if (!isCatalogProductId(args.productId) && uploaded) {
        const patchResponse = await fetch(`https://api.airtable.com/v0/${baseId}/${tableId}/${encodeURIComponent(args.productId)}`, {
          method: "PATCH",
          headers: { Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}`, "Content-Type": "application/json" },
          body: JSON.stringify({ fields: { "Görsel URL": imageUrl } })
        });
        const patchData = await patchResponse.json();
        if (!patchResponse.ok) throw new Error(patchData.error?.message || `Airtable HTTP ${patchResponse.status}`);
      }

      return JSON.stringify({ ok: true, imageUrl, provider: scene.provider, prompt: scene.prompt }, null, 2);
    }
    case "create_draft": {
      const allProducts = await listProducts();
      const product = allProducts.find((item) => item.id === args.productId);
      if (!product) throw new Error("Ürün bulunamadı.");
      // imageUrl verilirse ürünün Airtable kaydındaki ana görseli DEĞİŞTİRMEDEN,
      // yalnızca bu yeni taslak kaydı için geçerli olacak şekilde kullanılır —
      // createDraftRecord her zaman yeni bir kayıt oluşturur (PATCH değil POST),
      // bu yüzden orijinal ürün kaydına dokunulmaz.
      const draftProduct = typeof args.imageUrl === "string" && args.imageUrl.trim()
        ? { ...product, imageUrl: args.imageUrl.trim() }
        : product;
      const aiCaption = args.instagramText || args.facebookText
        ? { instagramText: args.instagramText || args.facebookText, facebookText: args.facebookText || args.instagramText, hashtags: args.hashtags || "#Buzsu" }
        : null;
      const draft = buildDraft(draftProduct, { format: args.format, platforms: args.platforms, variant: 0, publishAt: args.publishAt, captionOverride: aiCaption });
      if (!draft.valid) throw new Error(draft.warnings.join(" "));
      const record = await createDraftRecord({ product: draftProduct, draft, format: args.format, platforms: args.platforms, publishAt: args.publishAt, note: "MCP üzerinden oluşturuldu." });
      return JSON.stringify({ ok: true, id: record.id, status: "Taslak" }, null, 2);
    }
    case "upload_media": {
      const hasUrl = typeof args.imageUrl === "string" && args.imageUrl.trim().length > 0;
      const hasBase64 = typeof args.imageBase64 === "string" && args.imageBase64.trim().length > 0;
      if (hasUrl === hasBase64) throw new Error("imageUrl veya imageBase64 alanlarından tam olarak biri verilmelidir.");

      let buffer, mimeType;
      if (hasUrl) {
        ({ buffer, mimeType } = await fetchPublicImage(args.imageUrl));
      } else {
        if (!args.mimeType) throw new Error("imageBase64 kullanılıyorsa mimeType zorunludur.");
        mimeType = String(args.mimeType).toLowerCase();
        buffer = decodeImageBase64(args.imageBase64, mimeType);
      }

      if (args.confirmed !== true) {
        return JSON.stringify({ ok: true, confirmed: false, preview: true, mimeType, size: buffer.length, message: "Doğrulama başarılı, henüz yüklenmedi. Gerçekten yüklemek için confirmed:true gönderin." }, null, 2);
      }

      if (!process.env.BLOB_READ_WRITE_TOKEN) throw new Error("BLOB_READ_WRITE_TOKEN Vercel Production ortamında tanımlı değil.");
      const safeName = String(args.filename || "gorsel").replace(/\.[a-zA-Z0-9]+$/, "").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80) || "gorsel";
      const blob = await put(`manual-uploads/${Date.now()}-${safeName}.${imageExtensionFor(mimeType)}`, buffer, { access: "public", contentType: mimeType });

      let productImageUpdated = false;
      if (args.productId && args.updateProductImage === true) {
        if (isCatalogProductId(args.productId)) throw new Error("Katalog ürünlerinin (Airtable kaydı olmayan) ana görseli MCP üzerinden güncellenemez.");
        const patchResponse = await fetch(`https://api.airtable.com/v0/${baseId}/${tableId}/${encodeURIComponent(args.productId)}`, {
          method: "PATCH",
          headers: { Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}`, "Content-Type": "application/json" },
          body: JSON.stringify({ fields: { "Görsel URL": blob.url } })
        });
        const patchData = await patchResponse.json();
        if (!patchResponse.ok) throw new Error(patchData.error?.message || `Airtable HTTP ${patchResponse.status}`);
        productImageUpdated = true;
      }

      return JSON.stringify({ ok: true, imageUrl: blob.url, mimeType, size: buffer.length, productId: args.productId || null, productImageUpdated }, null, 2);
    }
    case "update_draft": {
      const fields = {};
      if (typeof args.instagramText === "string") fields["Instagram Metni"] = args.instagramText;
      if (typeof args.facebookText === "string") fields["Facebook Metni"] = args.facebookText;
      if (typeof args.hashtags === "string") fields["Hashtagler"] = args.hashtags;
      if (typeof args.publishAt === "string") fields["Yayın Zamanı"] = args.publishAt;
      if (!Object.keys(fields).length) throw new Error("Güncellenecek en az bir alan belirtmelisiniz.");
      const response = await fetch(`https://api.airtable.com/v0/${baseId}/${tableId}/${encodeURIComponent(args.recordId)}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({ fields })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message || `Airtable HTTP ${response.status}`);
      return JSON.stringify({ ok: true, id: args.recordId, updated: Object.keys(fields) }, null, 2);
    }
    case "update_status": {
      const nextStatus = args.status === "Durduruldu" ? "Taslak" : args.status;
      const response = await fetch(`https://api.airtable.com/v0/${baseId}/${tableId}/${encodeURIComponent(args.recordId)}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({ fields: { Durum: nextStatus, ...(nextStatus === "Onaylandı" ? { "Hata Mesajı": "" } : {}) } })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message || `Airtable HTTP ${response.status}`);
      return JSON.stringify({ ok: true, id: args.recordId, status: nextStatus }, null, 2);
    }
    case "publish_now": {
      const summary = await runPublisher();
      return JSON.stringify({ ok: true, ...summary }, null, 2);
    }
    case "generate_video_clip": {
      if (args.confirmed !== true) throw new Error("Bu işlem gerçek API kredisi harcar (süre/çözünürlüğe göre değişir). Onaylamak için confirmed:true gönderin.");
      if (!/^https:\/\//i.test(String(args.imageUrl || ""))) throw new Error("imageUrl herkese açık HTTPS URL olmalı.");
      if (!String(args.prompt || "").trim()) throw new Error("prompt boş olamaz.");
      const job = await submitVeoVideo(
        { imageUrl: args.imageUrl, title: args.title || "" },
        process.env,
        {
          finalizedPrompt: args.prompt,
          aspectRatio: args.aspectRatio || "9:16",
          durationSeconds: args.durationSeconds,
          resolution: args.resolution,
          model: args.model
        }
      );
      return JSON.stringify({ ok: true, ...job }, null, 2);
    }
    case "get_video_clip_status": {
      if (!String(args.operationName || "").trim()) throw new Error("operationName gerekli.");
      const status = await veoVideoStatus({ operationName: args.operationName }, process.env);
      if (status.status !== "COMPLETED") return JSON.stringify({ ok: true, status: status.status }, null, 2);
      const videoBuffer = await downloadVeoVideo(status.fileUri, process.env);
      let videoUrl = null;
      if (process.env.BLOB_READ_WRITE_TOKEN) {
        const safeName = String(args.operationName).replace(/[^a-zA-Z0-9_-]/g, "_").slice(-80);
        const blob = await put(`ai-videos/${safeName}-${Date.now()}.mp4`, videoBuffer, { access: "public", contentType: "video/mp4" });
        videoUrl = blob.url;
      }
      return JSON.stringify({ ok: true, status: "COMPLETED", videoUrl }, null, 2);
    }
    case "get_autopilot_status": {
      const enabled = await getAutopilotEnabled();
      return JSON.stringify({ ok: true, enabled }, null, 2);
    }
    case "set_autopilot": {
      if (typeof args.enabled !== "boolean") throw new Error("enabled (true/false) gerekli.");
      await setAutopilotEnabled(args.enabled);
      return JSON.stringify({ ok: true, enabled: args.enabled }, null, 2);
    }
    default:
      throw new Error(`Bilinmeyen tool: ${name}`);
  }
}

function jsonRpcResponse(id, result) {
  return { jsonrpc: "2.0", id, result };
}
function jsonRpcError(id, code, message) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

async function handleMessage(msg) {
  const { id, method, params } = msg;
  switch (method) {
    case "initialize":
      return jsonRpcResponse(id, {
        protocolVersion: "2025-03-26",
        serverInfo: SERVER_INFO,
        capabilities: { tools: {} }
      });
    case "notifications/initialized":
      return null;
    case "tools/list":
      return jsonRpcResponse(id, { tools: TOOLS });
    case "tools/call": {
      const toolName = params?.name;
      const toolArgs = params?.arguments || {};
      try {
        const text = await callTool(toolName, toolArgs);
        return jsonRpcResponse(id, { content: [{ type: "text", text }] });
      } catch (error) {
        return jsonRpcResponse(id, { content: [{ type: "text", text: `Hata: ${error.message}` }], isError: true });
      }
    }
    case "ping":
      return jsonRpcResponse(id, {});
    default:
      return jsonRpcError(id, -32601, `Method not found: ${method}`);
  }
}

export default async function handler(request, response) {
  if (request.method === "GET") {
    return response.status(200).json({
      ...SERVER_INFO,
      description: "Buzsu sosyal medya yayın yönetim MCP sunucusu. POST ile JSON-RPC 2.0 mesajı gönderin.",
      tools: TOOLS.map((tool) => tool.name)
    });
  }

  if (request.method !== "POST") {
    response.setHeader("Allow", "GET, POST");
    return response.status(405).json({ error: "Method not allowed" });
  }

  if (!authorized(request)) {
    return response.status(401).json({
      jsonrpc: "2.0", id: null,
      error: { code: -32000, message: "MCP_API_KEY gerekli. Authorization: Bearer <key> header'ı gönderin." }
    });
  }

  try {
    const body = typeof request.body === "string" ? JSON.parse(request.body) : request.body;

    if (Array.isArray(body)) {
      const results = [];
      for (const msg of body) {
        const result = await handleMessage(msg);
        if (result) results.push(result);
      }
      return response.status(200).json(results);
    }

    const result = await handleMessage(body);
    if (!result) return response.status(204).end();
    return response.status(200).json(result);
  } catch (error) {
    console.error("MCP handler error:", error);
    return response.status(200).json(jsonRpcError(null, -32603, error.message));
  }
}
