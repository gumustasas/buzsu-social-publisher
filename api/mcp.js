import "dotenv/config";
import { put, del } from "@vercel/blob";
import { listProducts, createDraftRecord } from "../src/lib/products.js";
import { generateCaption, generateHashtags, generateScenePlan, generateSeoArticle } from "../src/ai-providers.js";
import { baseProductTitle } from "../src/lib/product-title.js";
import { findCatalogProduct, isCatalogProductId } from "../src/lib/product-catalog.js";
import { buildDraft } from "../src/content-worker.js";
import { availableSceneProviders, generateSceneImage, NANO_BANANA_2_MODEL } from "../src/scene-image.js";
import { generateCompositeSceneImage } from "../src/scene-composite.js";
import { generateNanoBananaScene } from "../src/nano-banana-scene.js";
import { composeBrandedPost } from "../src/post-branding.js";
import { runPublisher } from "../src/publish-approved.js";
import { MUSIC_CATEGORIES } from "../src/lib/music-catalog.js";
import { submitVeoVideo, veoVideoStatus, downloadVeoVideo } from "../src/veo-video.js";
import { submitOmniVideoEdit, submitOmniVideoGeneration, omniInteractionStatus, downloadOmniVideo, OMNI_MODEL } from "../src/omni-video.js";
import { getAutopilotEnabled, setAutopilotEnabled } from "../src/lib/settings.js";
import { AIRTABLE_BASE_ID as baseId, AIRTABLE_TABLE_ID as tableId } from "../src/lib/config.js";
import { fetchPublicImage, decodeImageBase64, imageExtensionFor, extractDriveFileId, normalizeDriveUrl, normalizeImageForMeta } from "../src/lib/upload-media.js";
import { validateSceneImage } from "../src/lib/scene-validation.js";
import { normalizeDraftFields } from "../src/lib/queue.js";
import { composeProductVideo, getVideoRenderStatus } from "../src/video-compose.js";
import { generateVideoNarration, NARRATION_STYLES } from "../src/video-narration.js";
import { generateTurkishVoiceover, turkishVoiceoverStatus, TTS_STYLES } from "../src/turkish-tts.js";
import { generateLyriaMusic, lyriaMusicStatus, LYRIA_TIERS } from "../src/lyria-music.js";
import { composeReelAudio, getReelAudioStatus } from "../src/reel-audio-compose.js";
import { getBuzsuProductContext } from "../src/lib/product-intelligence.js";
import { generateReelScript } from "../src/reel-script.js";
import { REEL_OBJECTIVES, REEL_ASPECT_RATIOS, REEL_DURATIONS } from "../src/lib/reel-script-schema.js";
import { researchWeb, RESEARCH_PROVIDERS } from "../src/research/index.js";
import { transcribeMedia, TRANSCRIPTION_PROVIDERS } from "../src/transcription/index.js";
import { validateProductVisual, VISUAL_VALIDATION_CHECKS } from "../src/visual-validation/index.js";
import { generateImageFromVideo, VIDEO_TO_IMAGE_MODELS, VIDEO_TO_IMAGE_ASPECT_RATIOS } from "../src/video-to-image/index.js";
import { CREATIVE_TIERS } from "../src/creative-providers/model-registry.js";
import { searchProductKnowledge, KNOWLEDGE_PROVIDERS, SOURCE_PRIORITY } from "../src/knowledge/index.js";
import { runOrchestration, ORCHESTRATOR_CAPABILITIES } from "../src/orchestrator/index.js";
import { MAX_STEPS as MAX_ORCHESTRATOR_STEPS, MAX_RETRY_ATTEMPTS as MAX_ORCHESTRATOR_RETRY_ATTEMPTS } from "../src/orchestrator/validate.js";

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

// Airtable her sayfada en fazla 100 kayıt döner; kuyruk 100'ü geçtiğinde
// tek sayfalık bir istek sessizce eksik/kesik veri döner (bkz. list_queue,
// resolveProduct). Bu yüzden burada offset kürsörünü takip edip tüm
// sayfaları birleştiriyoruz.
async function airtableGet() {
  const records = [];
  let offset = "";
  do {
    const params = new URLSearchParams({ pageSize: "100" });
    if (offset) params.set("offset", offset);
    const response = await fetch(`https://api.airtable.com/v0/${baseId}/${tableId}?${params}`, {
      headers: { Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}` }
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || `Airtable HTTP ${response.status}`);
    records.push(...(data.records || []));
    offset = data.offset || "";
  } while (offset);
  return { records };
}

// list_queue bir genel-bakış/indeks aracıdır (tek kaydın tam metni için
// get_draft var) — instagramText/facebookText'i tam haliyle taşımak
// (özellikle çok kayıtlı kuyruklarda) yanıtı MCP istemcilerinin token
// limitini aşacak kadar şişiriyordu. Burada kısa bir önizlemeye indiriyoruz.
function truncatePreview(text, maxLength = 80) {
  const value = String(text || "");
  // Üretilen metinler emoji içerebiliyor; string.slice UTF-16 kod birimine
  // göre kestiği için bir emoji'nin surrogate pair'ini ortadan bölüp bozuk
  // bir karakter üretebilir. Array.from kod noktasına (code point) göre
  // yineliyor, bu yüzden kesim her zaman bir karakterin tam sınırında olur.
  const chars = Array.from(value);
  return chars.length > maxLength ? `${chars.slice(0, maxLength).join("").trimEnd()}…` : value;
}

async function resolveProduct(productId) {
  if (isCatalogProductId(productId)) {
    const catalogProduct = await findCatalogProduct(productId);
    if (!catalogProduct) throw new Error("Ürün bulunamadı.");
    return { title: baseProductTitle(catalogProduct.title) || "Buzsu ürünü", url: catalogProduct.url, imageUrl: catalogProduct.imageUrl || "", imageUrls: catalogProduct.imageUrls || [] };
  }
  const data = await airtableGet();
  const record = (data.records || []).find((item) => item.id === productId);
  if (!record) throw new Error("Ürün bulunamadı.");
  const fields = record.fields || {};
  return { title: baseProductTitle(fields.Başlık) || "Buzsu ürünü", url: fields["Kaynak URL"] || "", imageUrl: fields["Görsel URL"] || "", imageUrls: fields["Görsel URL"] ? [fields["Görsel URL"]] : [] };
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
    description: "Yayın kuyruğunu kapsam seçerek listeler. Varsayılan 'recent': aktif kayıtlar ve son 90 günde paylaşılmış kayıtlar. 'active' yalnızca yayınlanmamış aktif kayıtları, 'archive' paylaşılmış kayıtları, 'all' ise çöp kutusu dahil tüm kayıtları döner. Her kaydın id, title, status, format, platforms, publishAt, imageUrl, instagramText, facebookText ve yayın ID alanları bulunur — instagramText/facebookText burada kısa bir önizlemedir (ilk ~80 karakter), bir kaydın tam metnini görmek için get_draft(recordId) kullanın.",
    inputSchema: {
      type: "object",
      properties: {
        scope: { type: "string", enum: ["recent", "active", "archive", "all"], default: "recent", description: "Kuyruk kapsamı. Eski davranışın tamamı için 'all' kullanın." },
        publishedWithinDays: { type: "integer", minimum: 1, maximum: 365, default: 90, description: "scope='recent' iken kaç günlük paylaşılmış kayıt döndürülecek." }
      }
    }
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
    description: "Ürünün gerçek fotoğrafını, verilen sahne açıklamasına göre AI ile yeni bir ortam/arka plana yerleştirir (ör. dış mekan boru montajı, mutfak tezgahı). Sonuca isteğe bağlı olarak alt kısımda ürün adı ve Buzsu logosu bindirilir. Üretilen görselin URL'sini döner ve (Airtable ürünüyse) kaydın Görsel URL alanını otomatik günceller — bu sayede create_draft bu görseli otomatik kullanır. Ayrıca ayrı bir AI çağrısıyla ürün kimliği/parça bütünlüğü/uydurma tabela gibi kriterlere karşı OTOMATİK bir kontrol yapıp needsReview/failedChecks/reviewNotes döner — bu YALNIZCA bir rapordur, görseli asla otomatik reddetmez veya yeniden üretmez; needsReview=true dönerse görseli onaylamadan önce özellikle dikkatli incele. Kalite tier'ları AÇIKTIR (economy/balanced/quality, Google ve OpenAI'de birleştirilmiş): Google economy='gemini' (Nano Banana 2 Lite), balanced='nano-banana-2' (Nano Banana 2), quality='nano-banana-pro' (Nano Banana Pro — GERÇEK discovery'de bu hesapta listelenmediği sürece SESSİZCE Nano Banana 2'ye düşülmez, açık bir hata döner); OpenAI economy='openai-low', balanced='openai', quality='openai-high' (hepsi aynı gpt-image-2 modeli, yalnızca quality parametresi farklı).",
    inputSchema: {
      type: "object",
      properties: {
        productId: { type: "string", description: "Ürün ID'si (gerçek bir ürün fotoğrafı olmalı)" },
        sceneDescription: { type: "string", description: "Sahnenin Türkçe açıklaması (ör. 'apartman girişinde dış mekanda, sıvalı duvara monte ana su borusu üzerinde, mavi gökyüzü altında profesyonel bir kurulum')" },
        removeFaucet: { type: "boolean", description: "Üründeki musluğu kaldırıp sahnede ayrı bir musluk mu gösterilsin (varsayılan false)" },
        brand: { type: "boolean", description: "Görselin altına ürün adı + Buzsu logosu bindirilsin mi (varsayılan true)" },
        provider: { type: "string", enum: ["gemini", "nano-banana-2", "nano-banana-pro", "openai", "openai-low", "openai-high", "composite"], description: "AI görsel sağlayıcısı/kalite tier'ı (varsayılan: mevcut olanlardan ilki, genelde 'gemini' = economy). Tier eşlemesi: gemini=economy, nano-banana-2=balanced, nano-banana-pro=quality (Google); openai-low=economy, openai=balanced, openai-high=quality (OpenAI). 'nano-banana-pro' bu hesapta gerçek discovery'de bulunamazsa açık bir hata döner (sessizce nano-banana-2'ye düşülmez). Bir sağlayıcı sahnede istenmeyen bir öğeyi (ör. fazladan gösterge/panel) ısrarla üretmeye devam ederse diğerini deneyin." }
      },
      required: ["productId", "sceneDescription"]
    }
  },
  {
    name: "generate_nano_banana_scene",
    description: `Nano Banana 2 (Gemini görsel modeli "${NANO_BANANA_2_MODEL}") ile SADECE bir sahne görseli üretir — bu bir video modeli DEĞİLDİR, video üretmez ve hiçbir şekilde Veo/Omni'yi otomatik tetiklemez. İki-aşamalı akışın 1. aşamasıdır: burada üretilen imageUrl'i kullanıcı inceleyip onayladıktan SONRA, siz (veya kullanıcı) AYRI ve AÇIK bir ikinci çağrıyla generate_video_clip (Veo 3.1 Lite/Fast/Quality) veya generate_omni_video_edit'e verirsiniz — bu tool bunu KENDİLİĞİNDEN yapmaz. productId verilirse ürünün gerçek fotoğrafı referans alınıp kimliği/logosu/parçaları korunur (üründe kullanılan mevcut maskeli-düzenleme mimarisi ile, bkz. generate_scene_image) ve sonuç otomatik ürün-kimliği kontrolünden (needsReview/failedChecks/reviewNotes) geçirilir — needsReview:true dönerse video aşamasına geçmeden önce kullanıcıdan ayrıca açık onay isteyin. productId verilmezse tamamen sıfırdan (zero-shot, promptan) bir sahne üretilir — bu modda ürün kimliği kontrolü uygulanmaz (kontrol edilecek bir ürün yok). GERÇEK PARA HARCAR — confirmed:true verilmezse hiçbir API çağrısı yapılmaz.`,
    inputSchema: {
      type: "object",
      properties: {
        productId: { type: "string", description: "İsteğe bağlı — verilirse ürünün gerçek fotoğrafı referans alınır (product-reference modu, ürün kimliği korunur). Verilmezse sıfırdan/zero-shot bir sahne üretilir." },
        prompt: { type: "string", description: "Sahnenin açıklaması (Türkçe olabilir) — productId verilmişse bu, mevcut geminiScenePrompt/generate_scene_image ile aynı 'sahne açıklaması' rolündedir; verilmemişse görselin tamamını tarif eden bağımsız bir prompt olmalıdır." },
        aspectRatio: { type: "string", enum: ["9:16", "1:1", "16:9"], description: "En-boy oranı (varsayılan '9:16', Reels için). productId verilmiş bir üretimde (maskeli-düzenleme) bu yalnızca bir tercih sinyalidir — model girdi görselinin kanvas geometrisini koruma eğiliminde olabilir; zero-shot modda tam olarak uygulanır." },
        confirmed: { type: "boolean", description: "true olmadan hiçbir API çağrısı yapılmaz/ücret alınmaz." }
      },
      required: ["prompt", "confirmed"]
    }
  },
  {
    name: "create_draft",
    description: "Yeni bir taslak içerik oluşturup yayın kuyruğuna ekler. Oluşturulan taslak 'Taslak' durumundadır, onaylanması gerekir. Carousel ve Reel AYRI gönderilerdir — aynı videoUrl'i hem bir Carousel taslağının mediaItems'ında hem ayrı bir Reel taslağında (tekrar upload etmeden) kullanmak için create_draft'ı iki kez, farklı format ile çağırın.",
    inputSchema: {
      type: "object",
      properties: {
        productId: { type: "string", description: "Ürün ID'si" },
        format: { type: "string", enum: ["Gönderi", "Hikâye", "Reel", "Carousel"], description: "Yayın biçimi. 'Carousel' seçilirse mediaItems ZORUNLU (imageUrl/videoUrl yok sayılır); diğer biçimler eskisi gibi imageUrl/videoUrl kullanır." },
        platforms: { type: "array", items: { type: "string", enum: ["Instagram", "Facebook", "X", "YouTube"] }, description: "Hedef platformlar — X metni verilmezse Facebook metni 280 karaktere kısaltılıp kullanılır; YouTube yalnızca format 'Reel' iken (video gerektirir) çalışır. Carousel'de Facebook yalnızca mediaItems TAMAMEN görsellerden oluşuyorsa desteklenir — karma (görsel+video) bir Carousel'e Facebook eklenirse taslak oluşturulamaz (UNSUPPORTED_FACEBOOK_MEDIA_COMBINATION); bu durumda videoyu ayrı bir Reel taslağı olarak (aynı videoUrl ile) oluşturun." },
        publishAt: { type: "string", description: "Yayın zamanı (ISO 8601, örn. 2026-09-05T10:00:00Z)" },
        instagramText: { type: "string", description: "Instagram gönderi metni (isteğe bağlı — verilmezse otomatik üretilir)" },
        facebookText: { type: "string", description: "Facebook gönderi metni (isteğe bağlı)" },
        hashtags: { type: "string", description: "Hashtagler (isteğe bağlı, örn. #Buzsu #SuArıtma)" },
        imageUrl: { type: "string", description: "İsteğe bağlı — verilirse ürünün kayıtlı ana görseli yerine SADECE bu taslak için bu HTTPS görsel URL'i kullanılır (ör. upload_media çıktısı). Ürünün Airtable'daki ana Görsel URL alanı değişmez. format 'Carousel' iken kullanılmaz (bkz. mediaItems)." },
        videoUrl: { type: "string", description: "format 'Reel' iken ZORUNLU — herkese açık HTTPS video URL'i (ör. generate_video_clip/get_video_clip_status veya upload_media çıktısındaki URL). Reel'de bu verilmezse taslak oluşturulamaz; YouTube platformu da yalnızca bu alan doluyken çalışır. Aynı videoUrl, tekrar upload edilmeden, bir Carousel taslağının mediaItems'ında (type:'video') AYRICA kullanılabilir — ikisi ayrı gönderi/ayrı create_draft çağrısıdır." },
        mediaItems: {
          type: "array",
          description: "YALNIZCA format 'Carousel' iken kullanılır ve zorunludur. En az 2, en fazla 10 öğe (Instagram sınırı). Her öğe zaten herkese açık bir HTTPS URL'e sahip olmalı (ör. upload_media veya generate_video_clip/get_video_clip_status çıktısı) — burada hiçbir upload yapılmaz. Facebook bu formatta yalnızca tüm öğeler 'image' ise desteklenir.",
          items: {
            type: "object",
            properties: {
              type: { type: "string", enum: ["image", "video"] },
              url: { type: "string", description: "Herkese açık HTTPS medya URL'i" }
            },
            required: ["type", "url"]
          }
        }
      },
      required: ["productId", "format", "platforms", "publishAt"]
    }
  },
  {
    name: "upload_media",
    description: "ChatGPT'de oluşturulmuş veya kullanıcının yüklediği hazır bir PNG/JPEG/WebP görselini Vercel Blob'a yükleyip herkese açık bir HTTPS URL döner — bu URL create_draft'a imageUrl olarak verilebilir. imageUrl (herkese açık HTTPS, sunucu indirir) veya imageBase64 (+ mimeType) alanlarından tam olarak biri verilmelidir. imageUrl bir Google Drive paylaşım linki ise (https://drive.google.com/file/d/<ID>/view veya .../open?id=<ID>) otomatik olarak doğrudan indirme URL'ine çevrilir — dosyanın (klasörün değil) \"Bağlantıya sahip olan herkes görüntüleyebilir\" ile paylaşılmış olması gerekir. confirmed:true olmadan hiçbir yükleme/kayıt yapılmaz, yalnızca doğrulama sonucu döner.",
    inputSchema: {
      type: "object",
      properties: {
        imageUrl: { type: "string", description: "İndirilecek görselin herkese açık HTTPS URL'i (yalnızca biri: imageUrl veya imageBase64)" },
        imageBase64: { type: "string", description: "Görselin base64 verisi (ham veya \"data:image/...;base64,\" önekiyle — önek varsa otomatik atılır). mimeType ile birlikte verilmelidir." },
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
    name: "get_draft",
    description: "Kuyruktaki mevcut bir kaydın (taslak, onaylı veya yayınlanmış) tam, normalize edilmiş verisini okur — salt-okunur, hiçbir şeyi değiştirmez. Carousel kayıtlarında mediaItems dizisini ve mediaCount'u da döner; Carousel olmayan kayıtlarda mediaItems boş bir dizidir. Bozuk/eski bir Media Items alanı bu aracı asla çökertmez — mediaItems boş döner ve mediaItemsWarning ile sebep belirtilir.",
    inputSchema: {
      type: "object",
      properties: {
        recordId: { type: "string", description: "Airtable kayıt ID'si (rec...) — list_queue veya create_draft çıktısından alınır." }
      },
      required: ["recordId"]
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
    description: "Onaylandı durumundaki ve yayın zamanı gelmiş (Yayın Zamanı <= şu an) içerikleri hemen yayınlar; normalde bu her 2 saatte bir otomatik çalışır. Belirli bir kaydı hemen yayınlamak için önce update_draft ile yayın zamanını geçmişe/şimdiye çekin, sonra bu tool'u çağırın. Dönen results dizisinde her işlenen kaydın status'ü ve instagramPostId/facebookPostId/xPostId/youtubeVideoId'si bulunur.",
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
        model: { type: "string", description: "Veo model/tier seçimi (isteğe bağlı). AKTİF/tek çağrılabilir aile Veo 3.1 (Preview)'dir: 'economy'/'veo-3.1-lite' (Lite, en ucuz — varsayılan), 'fast'/'veo-3.1-fast', 'quality'/'veo-3.1-generate' (en pahalı/yavaş, en yüksek kalite). ÖNEMLİ — Veo 3 (GA): 'veo-3-generate'/'veo-3-fast'/'veo-3-lite' ve ham 'veo-3.0-generate-001'/'veo-3.0-fast-generate-001' ID'leri Google tarafından 30 Haziran 2026'da KAPATILDI — bu isimler artık aktif bir modele çözülmez, seçilirse hangi Veo 3.1 alias'ının kullanılması gerektiğini söyleyen açık bir hata döner (AI Studio UI'da hâlâ \"Veo 3 Generate/Fast/Lite\" görünse bile, arka planda çağrılan gerçek model her zaman Veo 3.1'dir). 'auto' (VEO_DEFAULT_TIER'a, o da yoksa economy'ye düşer) veya doğrudan tam bir Veo 3.1 model adı (ör. 'veo-3.1-generate-preview') da kabul edilir. Verilmezse VEO_VIDEO_MODEL/VEO_DEFAULT_TIER env değişkenlerine, onlar da yoksa economy'ye düşülür. Seçilen model/tier ASLA başka birine sessizce düşürülmez — geçersiz/kapanmış bir isim hemen hata verir. Seçilen model 429 (kota) hatası verirse yanıttaki 'alternatives' alanında diğer Veo 3.1 tier'ları listelenir — bu tool onlara ASLA otomatik geçmez, açıkça yeni bir model ile confirmed:true göndermeniz gerekir." },
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
  },
  {
    name: "compose_product_video",
    description: "2-10 ürün görselinden ÜCRETSİZ (paid API kullanmadan), FFmpeg ile 9:16 1080x1920 Reels/Shorts videosu üretir — her ürün ~1.5-2sn gösterilir, hafif zoom/pan (Ken Burns) ve geçiş efekti uygulanır, ürün adı alt kısımda güvenli alanda gösterilir, sabit bir Buzsu kapanış sahnesiyle biter. Render işi (birkaç dakika sürebilir) GitHub Actions'ın ücretsiz kuyruğunda arka planda çalışır — bu tool işi başlatıp hemen bir jobId döner, sonucu get_video_render_status ile sorgulayın. Tamamlandığında dönen videoUrl, create_draft(format:'Reel') içinde videoUrl olarak veya bir Carousel'in mediaItems'ında doğrudan kullanılabilir. musicUrl VERİLMEZSE video sessiz çıkmaz — 30 parçalık ücretsiz, ticari kullanıma açık bir müzik havuzundan (Mixkit) otomatik bir arka plan müziği seçilir; musicMood ile hangi tarzdan seçileceği yönlendirilebilir. upscaleImages varsayılan olarak true'dur — düşük çözünürlüklü görseller (< 1080px) otomatik olarak Replicate/Real-ESRGAN ile AI büyütülür, zaten yüksek çözünürlüklü olanlar (>= 1080px) otomatik atlanır (kredi harcanmaz). Bu özellik GERÇEK PARA HARCAYABİLİR, confirmed:true olmadan çalışmaz. Upscale istemiyorsanız upscaleImages:false gönderin.",
    inputSchema: {
      type: "object",
      properties: {
        mediaItems: {
          type: "array",
          description: "2-10 öğe. Her öğe herkese açık bir HTTPS görsel URL'i (PNG/JPEG/WebP) ve isteğe bağlı bir ürün adı içerir.",
          items: {
            type: "object",
            properties: {
              imageUrl: { type: "string", description: "Herkese açık HTTPS görsel URL'i." },
              title: { type: "string", description: "İsteğe bağlı — videoda alt kısımda gösterilecek ürün adı (en fazla 60 karakter)." }
            },
            required: ["imageUrl"]
          }
        },
        durationPerImageSeconds: { type: "number", description: "Her ürünün ekranda kalma süresi, saniye (varsayılan 2.0, aralık 1.0-3.0)." },
        transition: { type: "string", enum: ["fade", "wipe"], description: "Ürünler arası geçiş efekti (varsayılan 'fade')." },
        transitionDurationSeconds: { type: "number", description: "Geçiş efektinin süresi, saniye (varsayılan 0.4, aralık 0.2-1.0; durationPerImageSeconds'tan küçük olmalı)." },
        closingTitle: { type: "string", description: "İsteğe bağlı — kapanış sahnesindeki ana metni değiştirir (varsayılan: 'Buzsu – İhtiyacınıza uygun su çözümünü keşfedin')." },
        closingSubtitle: { type: "string", description: "İsteğe bağlı — kapanış sahnesindeki alt metni değiştirir (varsayılan: 'buzsu.com.tr')." },
        musicUrl: { type: "string", description: "İsteğe bağlı — herkese açık HTTPS royalty-free müzik URL'i (MP3/MP4/WAV/OGG). Video süresine göre otomatik döngüye alınır ve kırpılır. Verilmezse ücretsiz havuzdan otomatik bir parça seçilir (bkz. musicMood)." },
        musicMood: { type: "string", enum: MUSIC_CATEGORIES, description: `İsteğe bağlı — musicUrl verilmediğinde otomatik seçilecek müziğin tarzı (${MUSIC_CATEGORIES.join(", ")}). Verilmezse rastgele bir tarzdan seçilir. musicUrl verilirse yok sayılır.` },
        musicVolume: { type: "number", description: "Müzik ses seviyesi, 0-1 aralığında (varsayılan 0.5) — hem musicUrl hem otomatik seçilen müzik için geçerli." },
        upscaleImages: { type: "boolean", default: true, description: "Varsayılan true — her ürün görseli render'dan önce Replicate/Real-ESRGAN ile AI büyütülür (yalnızca düşük çözünürlüklü görseller büyütülür, >= 1080px olanlar otomatik atlanır). Kapatmak için false gönderin. confirmed:true olmadan çalışmaz." },
        confirmed: { type: "boolean", default: false, description: "upscaleImages varsayılan true olduğundan her video oluşturmada confirmed:true GÖNDERİLMELİDİR (upscaleImages:false gönderilmedikçe). true olmadan iş başlamaz." }
      },
      required: ["mediaItems"]
    }
  },
  {
    name: "get_video_render_status",
    description: "compose_product_video ile başlatılmış bir render işinin durumunu sorgular. status 'queued'/'rendering' ise birkaç dakika sonra tekrar deneyin; 'completed' ise videoUrl, durationSeconds, width, height, fileSizeBytes döner; 'failed' ise error alanında sebep bulunur.",
    inputSchema: {
      type: "object",
      properties: {
        jobId: { type: "string", description: "compose_product_video yanıtındaki jobId." }
      },
      required: ["jobId"]
    }
  },
  {
    name: "generate_omni_video_edit",
    description: `Google Gemini Omni 1.1 Flash (${OMNI_MODEL}) ile ZATEN VAR OLAN bir videoyu düzenler. Not: Omni modeli sıfırdan video da üretebilir, ancak bu araç şu anda yalnızca mevcut video düzenleme özelliğini kullanır — sıfırdan üretim bu arayüzde henüz etkin değildir. İyi çıkmış bir sahneyi (örn. aile sahnesi) koruyup yalnızca hatalı/istenmeyen bir bölümü (örn. ürün) düzeltmek için kullanılır. Google, yüklenen videoları düzenleme özelliğinin her bölgede/hesapta desteklenmediğini belirtiyor (EEA/İsviçre/UK ve bazı ABD eyaletleri dokümante edilmiş kısıtlar — Türkiye için garanti yok); desteklenmiyorsa REGION_UNAVAILABLE hatası döner, ASLA otomatik tekrar denenmez. GERÇEK PARA HARCAR (360p en ucuz seçenektir). Video işlenmesi zaman alabilir; hemen fileUri gelmezse durumu get_omni_video_status ile sorgulayın. confirmed:true verilmezse hiçbir API çağrısı/harcama yapılmaz. Model ${OMNI_MODEL} ile sabittir, başka bir model kabul edilmez.`,
    inputSchema: {
      type: "object",
      properties: {
        existingVideoUrl: { type: "string", description: "Düzenlenecek, zaten üretilmiş videonun herkese açık HTTPS URL'si." },
        referenceImageUrl: { type: "string", description: "İsteğe bağlı — korunması istenen ürünün gerçek görselinin herkese açık HTTPS URL'si (düzenlemeye referans olarak eklenir)." },
        editPrompt: { type: "string", description: "Videoda ne değişecek/düzeltilecek — doğal dilde talimat (örn. 'yalnızca masadaki ürünü bu referans görseldeki cihazla değiştir, aile ve arka planı olduğu gibi bırak')." },
        aspectRatio: { type: "string", description: "En-boy oranı (varsayılan '9:16')." },
        resolution: { type: "string", enum: ["360p", "720p", "1080p", "4k"], description: "Çıktı çözünürlüğü (varsayılan '360p' — en ucuz, taslak/deneme için önerilir)." },
        confirmed: { type: "boolean", description: "true olmadan hiçbir API çağrısı yapılmaz/ücret alınmaz." }
      },
      required: ["existingVideoUrl", "editPrompt", "confirmed"]
    }
  },
  {
    name: "get_omni_video_status",
    description: "generate_omni_video_edit ile başlatılmış bir Omni interaction'ın (veya çıktı dosyasının) durumunu sorgular. Tamamlandıysa (COMPLETED) videoyu indirip Vercel Blob'a yükler ve herkese açık videoUrl döner; henüz bitmediyse (IN_PROGRESS/OUTPUT_PROCESSING) tüm durum alanlarını (outputFileId dahil) olduğu gibi geri döner — BİR SONRAKİ ÇAĞRIDA outputFileId'yi bu yanıttan aynen aktarın, aksi halde takip gereksiz yere /interactions/{id} yoluna düşer.",
    inputSchema: {
      type: "object",
      properties: {
        interactionId: { type: "string", description: "generate_omni_video_edit yanıtındaki interactionId." },
        outputFileId: { type: "string", description: "İsteğe bağlı — önceki bir get_omni_video_status/generate_omni_video_edit yanıtında outputFileId doluysa (status OUTPUT_PROCESSING olduğunda), bu çağrıya aynen aktarın. Verilirse durum sorgusu GET /interactions/{id} yerine doğrudan Files API'yi (GET /v1beta/files/{outputFileId}) sorgular." },
        model: { type: "string", description: "generate_omni_video_edit yanıtındaki model (isteğe bağlı, günlükleme amaçlı)." }
      },
      required: ["interactionId"]
    }
  },
  {
    name: "generate_gemini_video",
    description: `Google Gemini Omni 1.1 Flash (${OMNI_MODEL}) ile SIFIRDAN (zero-shot) yeni bir video üretir — generate_omni_video_edit'in aksine mevcut bir video GEREKMEZ, yalnızca bir metin prompt'u (ve isteğe bağlı bir referans görseli) yeterlidir. GERÇEK PARA HARCAR (360p en ucuz seçenektir). Async çalışır: bu tool işi başlatıp bir interactionId döner (bazen anında bir outputFileId de dönebilir); sonucu get_gemini_video_status ile sorgulayın. Google, bu özelliğin her bölgede/hesapta desteklenmediğini belirtiyor (EEA/İsviçre/UK ve bazı ABD eyaletleri dokümante edilmiş kısıtlar); desteklenmiyorsa REGION_UNAVAILABLE hatası döner, ASLA otomatik tekrar denenmez ve BAŞKA BİR PROVIDER'A (Veo/fal.ai) SESSİZCE GEÇİLMEZ — farklı bir provider denemek isterseniz açıkça o tool'u çağırın. confirmed:true verilmezse hiçbir API çağrısı/harcama yapılmaz. Model ${OMNI_MODEL} ile sabittir, başka bir model kabul edilmez. Dokümante edilmiş bir "süre" (duration) parametresi yoktur — süre modelin kendi varsayılanına bırakılır.`,
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "Üretilecek videonun doğal dilde açıklaması (sahne, hareket, kamera vb.)." },
        referenceImageUrl: { type: "string", description: "İsteğe bağlı — videoda korunması istenen bir ürün/nesnenin herkese açık HTTPS görsel URL'si (image-to-video referansı)." },
        aspectRatio: { type: "string", enum: ["9:16", "16:9", "1:1"], description: "En-boy oranı (varsayılan '9:16')." },
        resolution: { type: "string", enum: ["360p", "720p", "1080p", "4k"], description: "Çıktı çözünürlüğü (varsayılan '360p' — en ucuz, taslak/deneme için önerilir)." },
        confirmed: { type: "boolean", description: "true olmadan hiçbir API çağrısı yapılmaz/ücret alınmaz." }
      },
      required: ["prompt", "confirmed"]
    }
  },
  {
    name: "get_gemini_video_status",
    description: "generate_gemini_video ile başlatılmış bir Omni interaction'ın (veya çıktı dosyasının) durumunu sorgular — get_omni_video_status ile AYNI Interactions API durum mekanizmasını kullanır (yalnızca sıfırdan üretim akışı için ayrı adlandırılmıştır). Tamamlandıysa (COMPLETED) videoyu indirip Vercel Blob'a yükler ve herkese açık videoUrl döner; henüz bitmediyse (IN_PROGRESS/OUTPUT_PROCESSING) tüm durum alanlarını (outputFileId dahil) olduğu gibi geri döner — BİR SONRAKİ ÇAĞRIDA outputFileId'yi bu yanıttan aynen aktarın.",
    inputSchema: {
      type: "object",
      properties: {
        interactionId: { type: "string", description: "generate_gemini_video yanıtındaki interactionId." },
        outputFileId: { type: "string", description: "İsteğe bağlı — önceki bir get_gemini_video_status/generate_gemini_video yanıtında outputFileId doluysa, bu çağrıya aynen aktarın." },
        model: { type: "string", description: "generate_gemini_video yanıtındaki model (isteğe bağlı, günlükleme amaçlı)." }
      },
      required: ["interactionId"]
    }
  },
  {
    name: "get_buzsu_product_context",
    description: "AI Reels V2 senaryo yazımından ÖNCE GERÇEK Buzsu ürün bilgisini buzsu.com.tr'den (öncelik: llms-full.txt grounding + mevcut katalog/görsel modülleri; yalnızca destekleyici olarak ürün sayfası meta description) okur ve normalize eder. verifiedFacts SADECE kaynak metinden alınan birebir alıntılardır — AI ile yeniden yazılmaz/uydurulmaz — her biri sourceUrl taşır. prohibitedClaims, kaynakta doğrulanmayan sabit bir iddia kategorisi listesidir (sağlık/sertifika/garanti/performans/menşe), AI bu kategorilerde iddia UYDURMAMALIDIR. ÜCRETSİZDİR, hiçbir AI/paid API çağrısı yapmaz. productId veya productUrl'den en az biri gerekli (ikisi de verilirse productUrl önceliklidir). productUrl yalnızca buzsu.com.tr/www.buzsu.com.tr kabul eder (www'siz otomatik canonicalize edilir), başka host'lar ve yönlendirme sonucu başka host'a çıkan zincirler reddedilir. Sonuç ~30 dakika Vercel Blob'da önbelleğe alınır (contentHash/fetchedAt ile) — refresh:true ile zorla yenilenir.",
    inputSchema: {
      type: "object",
      properties: {
        productId: { type: "string", description: "list_products'tan alınan ürün id'si (Airtable kaydı veya katalog ürünü)." },
        productUrl: { type: "string", description: "Ürün sayfası URL'si — yalnızca buzsu.com.tr/www.buzsu.com.tr kabul edilir." },
        refresh: { type: "boolean", description: "true ise önbelleği atlar, ürünü yeniden okur (varsayılan false)." }
      }
    }
  },
  {
    name: "generate_reel_script",
    description: "AI Reels V2 senaryo motoru: get_buzsu_product_context'in doğrulanmış ürün bilgisini (verifiedFacts) OpenAI veya Google'a (creative-providers registry, bkz. get_buzsu_product_context/PR-B) vererek yapılandırılmış bir ReelScript JSON'u üretir. Yalnızca SENARYO üretir — Veo/TTS/Lyria/Omni/FFmpeg'i BURADA ÇALIŞTIRMAZ. Product Intelligence üretimi YÖNLENDİRİR fakat product-claim grounding senaryo üretimini/validasyonunu BLOKLAMAZ: doğrulanamayan bir ürün iddiası senaryoyu REDDETMEZ (UNVERIFIED_PRODUCT_CLAIM bu yoldan kaldırıldı). claimsUsed yalnız bilgilendirici bir kaynak atamasıdır: {claim, provenance, sourceUrl?} — verifiedFacts ile eşleşen claim provenance:'verified' ve gerçek sourceUrl ile, eşleşmeyen claim provenance:'unverified' olarak döner. Claim doğruluğu otomatik garanti EDİLMEZ; doğruluk kontrolü sahne onayındaki insan incelemesine aittir. Teknik/yapısal validasyon aynen uygulanır. Sahne zamanlamaları (0'dan başlama/çakışmama/toplam süreyi aşmama) ve Türkçe seslendirme bütçesi (NARRATION_TOO_LONG) doğrulanır. Her sahnenin veoPrompt'una İngilizce 'sessiz video' kısıtı ve (referenceImageRequired:true ise) Product Identity Lock DETERMİNİSTİK olarak eklenir. GERÇEK PARA HARCAR (bir inference çağrısıdır), confirmed:true olmadan hiçbir provider'a istek atılmaz. model verilmişse (provider AUTO OLAMAZ, açıkça belirtilmeli) yalnızca gerçek discovery'de listelenmiş/erişilebilir ise kullanılır — serbest yazılmış model adı kabul edilmez; verilmezse modelTier registry'den (env override + gerçek discovery) çözülür. Başarısızlıkta ASLA başka bir ücretli modele otomatik geçilmez. researchMode İSTEĞE BAĞLIDIR ve varsayılanı 'none'dir — verilmezse research_web'e HİÇ istek atılmaz, davranış eskisiyle AYNIDIR. 'auto'/'google'/'openai' verilirse research_web ÇAĞRILIR (AYNI confirmed:true onayı altında, ek bir ücretli çağrıdır) ve bulunan cevap+kaynaklar senaryo prompt'una bir VERİ bloğu olarak eklenir; sonuçtaki 'research' alanında da raporlanır.",
    inputSchema: {
      type: "object",
      properties: {
        productId: { type: "string", description: "list_products'tan alınan ürün id'si. productUrl ile birlikte verilirse productUrl önceliklidir." },
        productUrl: { type: "string", description: "Ürün sayfası URL'si (yalnızca buzsu.com.tr/www.buzsu.com.tr). productId/productUrl'den en az biri gerekli." },
        userBrief: { type: "string", description: "İsteğe bağlı — kullanıcının reklam fikri (Türkçe serbest metin). Talimat olarak değil veri olarak işlenir (injection sanitize edilir)." },
        durationSeconds: { type: "number", enum: REEL_DURATIONS, description: "Video süresi, saniye." },
        objective: { type: "string", enum: REEL_OBJECTIVES, description: "Reklamın hedefi." },
        aspectRatio: { type: "string", enum: REEL_ASPECT_RATIOS, description: "Varsayılan '9:16'." },
        provider: { type: "string", enum: ["auto", "openai", "google"], description: "Varsayılan 'auto'. 'model' verildiğinde 'auto' KABUL EDİLMEZ, açıkça 'openai' veya 'google' olmalı." },
        modelTier: { type: "string", enum: CREATIVE_TIERS, description: "'model' verilmezse kullanılır — registry'den (env override + gerçek discovery) çözülür, tahmini model ATANMAZ." },
        model: { type: "string", description: "İsteğe bağlı 'Özel' mod — gerçek discovery'de listelenmiş bir model kimliği. Verilirse modelTier yerine bu kullanılır, provider açıkça belirtilmelidir." },
        researchMode: { type: "string", enum: ["none", "auto", ...RESEARCH_PROVIDERS], description: "Varsayılan 'none' (research_web'e istek atılmaz, davranış değişmez). 'auto'/'google'/'openai' verilirse research_web bu senaryo için ÖNCE çağrılır ve sonucu prompt'a eklenir." },
        researchQuery: { type: "string", description: "researchMode!='none' iken kullanılacak arama sorgusu. Verilmezse ürünün adı (productContext'ten) kullanılır." },
        researchUrls: { type: "array", items: { type: "string" }, description: "researchMode!='none' iken isteğe bağlı — research_web'in URL Context ile okuyacağı en fazla 5 URL." },
        confirmed: { type: "boolean", description: "true olmadan hiçbir provider'a istek atılmaz/ücret alınmaz (researchMode!='none' iken research_web çağrısı da dahil)." }
      },
      required: ["durationSeconds", "objective", "confirmed"]
    }
  },
  {
    name: "research_web",
    description: "Google Search Grounding + URL Context veya OpenAI Web Search ile GÜNCEL web araması yapar — provider'ların kendi eğitim verisi kesim tarihinden sonraki bilgi/gelişme gerektiren sorular için kullanılır (ör. güncel API/model durumu, rakip fiyatlandırması, mevzuat). GERÇEK PARA HARCAR (bir inference çağrısıdır). provider='auto' hiçbir koşulda diğer sağlayıcıya SESSİZCE düşmez — açıkça 'google' veya 'openai' verilip o sağlayıcının API key'i yoksa/başarısız olursa hata döner, otomatik olarak diğerine geçilmez. urls verilirse (en fazla 5) bu sayfaların içeriği de dikkate alınır (Google: url_context tool'u; OpenAI: promptun içine eklenir). Dönen 'sources' listesi normalize edilmiştir: her kaynak {url,title,snippet,provider} şeklindedir, aynı url tekrar etmez.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Arama sorgusu/sorusu." },
        provider: { type: "string", enum: ["auto", ...RESEARCH_PROVIDERS], description: "Varsayılan 'auto' — hangi sağlayıcının GERÇEKTEN yapılandırılmış (API key) olduğuna göre sabit bir öncelik sırasıyla (google, sonra openai) seçilir. Başarısızlıkta ASLA diğer sağlayıcıya otomatik geçilmez." },
        urls: { type: "array", items: { type: "string" }, description: "İsteğe bağlı — içeriği dikkate alınacak en fazla 5 URL (URL Context)." },
        confirmed: { type: "boolean", description: "true olmadan ücretli research provider çağrısı yapılmaz." }
      },
      required: ["query", "confirmed"]
    }
  },
  {
    name: "transcribe_media",
    description: "Google Gemini 3.5 Transcribe (Files API + Interactions API) veya OpenAI Whisper/gpt-4o-transcribe-diarize (/v1/audio/transcriptions) ile bir medya dosyasını birebir metne çevirir. Model seçimi GERÇEK bir /models discovery çağrısıyla doğrulanır — yapılandırılmış bir model discovery'de bulunamazsa (model_not_found) SESSİZCE farklı bir modele düşülmez, açık bir hata döner. Google yalnız SES MIME türlerini kabul eder (video için OpenAI'yi seçin veya mevcut GitHub Actions FFmpeg render kuyruğuyla önce ses ayıklayın — bu depoda ayrı bir senkron FFmpeg alt sistemi YOKTUR). GERÇEK PARA HARCAR — confirmed:true olmadan hiçbir sağlayıcıya istek atılmaz. provider='auto' hiçbir koşulda diğer sağlayıcıya SESSİZCE düşmez. diarization:true istenirse yalnızca bunu destekleyen model seçilir (Google 'gemini-3.5-transcribe' native; OpenAI diarization istendiğinde OPENAI_TRANSCRIBE_MODEL override edilmemişse otomatik 'gpt-4o-transcribe-diarize'e geçer, override edilmiş whisper-1 gibi bir model diarization'ı desteklemiyorsa SESSİZCE yok sayılmaz, diarization_not_supported hatası döner). diarization:true ile vocabularyHints AYNI istekte birlikte kullanılamaz (her iki sağlayıcıda da bu ikisi karşılıklı dışlar) — birlikte verilirse hiçbir API çağrısı yapılmadan reddedilir. Zaman damgası doğruluğu seçilen modele göre 'exact_word' (Gemini native)/'exact_segment' (Whisper/diarize) olarak dönen 'timestampAccuracy' alanında raporlanır. vocabularyHints (ör. 'Buzsu', 'kireç önleyici') bir talimat DEĞİLDİR, kelime hazinesi ipucudur.",
    inputSchema: {
      type: "object",
      properties: {
        mediaUrl: { type: "string", description: "Herkese açık HTTPS medya URL'i. Google için SES MIME türü zorunludur (video reddedilir); OpenAI mp4/webm video container'larını da kabul eder — MOV/M4V gibi diğer kapsayıcılar KABUL EDİLMEZ, açık bir hatayla reddedilir (önce mevcut FFmpeg render kuyruğuyla ses ayıklayın)." },
        provider: { type: "string", enum: ["auto", ...TRANSCRIPTION_PROVIDERS], description: "Varsayılan 'auto' — GERÇEKTEN yapılandırılmış, discovery'de doğrulanmış (ve diarization/vocabularyHints isteniyorsa bunu destekleyen) ilk sağlayıcı seçilir. Başarısızlıkta ASLA diğer sağlayıcıya otomatik geçilmez." },
        languageHint: { type: "string", description: "İsteğe bağlı dil ipucu (Google: BCP-47 ör. 'tr-TR'; OpenAI: ISO-639-1 ör. 'tr'). Verilmezse sağlayıcı otomatik algılar." },
        vocabularyHints: { type: "array", items: { type: "string" }, description: "İsteğe bağlı — en fazla 20 marka/terim ipucu (ör. ['Buzsu','kireç önleyici']), tanımayı iyileştirir; diarization:true ile BİRLİKTE kullanılamaz, bunu desteklemeyen bir model seçiliyse (ör. gpt-4o-transcribe-diarize) custom_vocabulary_not_supported hatası döner." },
        diarization: { type: "boolean", description: "true ise konuşmacı ayrımı istenir. Bunu destekleyen bir model otomatik/doğrulanarak seçilir (Google gemini-3.5-transcribe; OpenAI gpt-4o-transcribe-diarize) — desteklemeyen bir model açıkça override edilmişse (ör. OPENAI_TRANSCRIBE_MODEL=whisper-1) SESSİZCE yok sayılmaz, açık bir hata döner." },
        confirmed: { type: "boolean", description: "true olmadan ücretli transkripsiyon çağrısı yapılmaz." }
      },
      required: ["mediaUrl", "confirmed"]
    }
  },
  {
    name: "validate_product_visual",
    description: `AI ile üretilmiş bir sahne görselini, ürünün GERÇEK referans fotoğrafıyla (Google Gemini vision) DOĞRUDAN karşılaştırır — generate_scene_image/generate_nano_banana_scene'in kendi otomatik incelemesinden (yalnızca metin bağlamına karşı, referans görsel YOK) farklıdır ve onların varsayılan akışını DEĞİŞTİRMEZ; ayrı, isteğe bağlı bir kontrol adımıdır. Karar, modelin bir güven puanından/confidence'ından DEĞİL, sabit ${VISUAL_VALIDATION_CHECKS.length} kontrol kategorisine (${VISUAL_VALIDATION_CHECKS.join(", ")}) karşı normalize edilmiş failedChecks listesinden türetilir — model bir sayısal puan döndürse bile bu OKUNMAZ/KULLANILMAZ. 'checks' alanı her zaman TAM listedir (hangi kriterlerin değerlendirildiğini gösterir); 'failedChecks' bunun başarısız alt kümesidir; passed = failedChecks boşsa true. GERÇEK PARA HARCAR (bir Gemini vision çağrısıdır) — confirmed:true olmadan hiçbir API çağrısı yapılmaz. generatedImageUrl veya generatedImageBase64'ten TAM OLARAK biri verilmelidir.`,
    inputSchema: {
      type: "object",
      properties: {
        referenceImageUrl: { type: "string", description: "Ürünün GERÇEK, herkese açık HTTPS referans fotoğrafı (ör. list_products çıktısındaki imageUrl)." },
        generatedImageUrl: { type: "string", description: "AI ile üretilmiş, kontrol edilecek görselin herkese açık HTTPS URL'i. generatedImageBase64 ile birlikte verilemez." },
        generatedImageBase64: { type: "string", description: "AI ile üretilmiş görselin base64 verisi (ör. generate_scene_image'ın dataUrl'inden). generatedImageMimeType ile birlikte verilmelidir; generatedImageUrl ile birlikte verilemez." },
        generatedImageMimeType: { type: "string", enum: ["image/png", "image/jpeg", "image/webp"], description: "generatedImageBase64 kullanılıyorsa zorunlu." },
        productTitle: { type: "string", description: "İsteğe bağlı — ürün adı, karşılaştırma bağlamı için kullanılır." },
        sceneDescription: { type: "string", description: "İsteğe bağlı — hedeflenen sahne açıklaması, karşılaştırma bağlamı için kullanılır." },
        confirmed: { type: "boolean", description: "true olmadan ücretli karşılaştırma çağrısı yapılmaz." }
      },
      required: ["referenceImageUrl", "confirmed"]
    }
  },
  {
    name: "generate_image_from_video",
    description: "Bir videonun görsel bağlamını kullanarak thumbnail/poster/carousel/story görseli üretir. Google Gemini video-to-image kullanır. Resmi olarak yalnız gemini-3.1-flash-image ve gemini-3.1-flash-lite-image desteklenir; başka modele SESSİZ fallback yapılmaz. Public YouTube URL doğrudan Gemini fileData olarak gönderilir; diğer herkese açık HTTPS MP4/MOV/WebM URL'leri mevcut SSRF-güvenli video fetch katmanıyla indirilip Gemini Files API'ye yüklenir. GERÇEK PARA HARCAR; confirmed:true zorunludur.",
    inputSchema: {
      type: "object",
      properties: {
        videoUrl: { type: "string", description: "Public YouTube URL veya herkese açık HTTPS MP4/MOV/WebM video URL'i." },
        prompt: { type: "string", description: "Videodan üretilecek görselin amacı/tarifi; ör. 'Bu videonun ana temasını yansıtan sinematik 9:16 Story kapağı oluştur'." },
        aspectRatio: { type: "string", enum: VIDEO_TO_IMAGE_ASPECT_RATIOS, description: "Çıktı oranı; varsayılan 9:16." },
        model: { type: "string", enum: VIDEO_TO_IMAGE_MODELS, description: "İsteğe bağlı; varsayılan gemini-3.1-flash-image. Seçilen model discovery'de yoksa açık hata döner." },
        confirmed: { type: "boolean", description: "true olmadan discovery/generation/video upload çağrısı yapılmaz." }
      },
      required: ["videoUrl", "prompt", "confirmed"]
    }
  },
  {
    name: "search_product_knowledge",
    description: `Buzsu ürün bilgisini yüksek-otoriteli kaynaklarla File Search depolarını birlikte kullanarak araştırır. Kaynak önceliği sabittir: ${SOURCE_PRIORITY.join(" > ")}. Airtable ürün kimliği ve Buzsu resmi feed/canonical ürün sayfası, Google/OpenAI File Search belgelerinden daha yüksek otoritedir. Düşük öncelikli belge resmi kaynakla çelişirse bilgi sessizce ezilmez; conflicts + hasConflicts alanlarında açıkça raporlanır. provider auto/google/openai destekler; auto yalnız yapılandırılmış ilk provider'ı seçer ve çalışma zamanı hatasında diğer ücretli providera sessiz fallback yapmaz. Google Gemini File Search store veya OpenAI vector store önceden yapılandırılmış olmalıdır. confirmed:true zorunludur.`,
    inputSchema: {
      type: "object",
      properties: {
        productId: { type: "string", description: "İsteğe bağlı ürün ID'si; productUrl ile birlikte verilmezse ürün çözümlemede kullanılır." },
        productUrl: { type: "string", description: "İsteğe bağlı resmi buzsu.com.tr ürün URL'i. productId veya productUrl'den en az biri zorunludur." },
        query: { type: "string", description: "Ürün hakkında aranacak soru/konu." },
        provider: { type: "string", enum: ["auto", ...KNOWLEDGE_PROVIDERS], description: "Varsayılan auto. Yapılandırılmış provider seçilir; başarısızlıkta sessizce diğer providera geçilmez." },
        confirmed: { type: "boolean", description: "true olmadan ücretli File Search/model çağrısı yapılmaz." }
      },
      required: ["query", "confirmed"]
    }
  },
  {
    name: "run_agent_orchestration",
    description: `TASK-001..006'nın MEVCUT READ/GENERATE capability'lerini (research_web, transcribe_media, generate_scene_image, validate_product_visual, generate_image_from_video, search_product_knowledge, list_products, get_buzsu_product_context) sabit, sıralı bir adım listesi (steps) olarak yürüten deterministik bir orkestratör. Yalnız ${ORCHESTRATOR_CAPABILITIES.join(", ")} capability'lerini bilir — publish_now/create_draft/update_draft/update_status/set_autopilot/upload_media veya herhangi bir silme/yayınlama/harici-durum-güncelleme işlemi BU ARAÇTA HİÇ YOKTUR ve hiçbir şekilde çağrılamaz; bilinmeyen/izin verilmeyen bir capability adı PLANIN TAMAMINI (henüz hiçbir adım çalışmadan) reddeder. Her adımın confirmed:true'su KENDİ args'ında AÇIKÇA verilmelidir — bu araç hiçbir adım için confirmed'i kendiliğinden ÜRETMEZ/VARSAYMAZ; ücretli bir capability confirmed:true almadan sırasına geldiğinde run 'waiting_for_confirmation' durumunda GÜVENLE durur, hiçbir API çağrısı yapılmadan. Bir adım başarısız olursa SONRAKİ adımlar ÇALIŞTIRILMAZ (bağımlı yürütme durur) ama ÖNCEKİ başarılı adımların çıktıları yanıtta korunur. maxAttempts (adım başına, isteğe bağlı, varsayılan 1, en fazla 3) ile SINIRLI/açık bir retry uygulanabilir — sonsuz veya örtük bir tekrar YOKTUR. Yanıt run durumunu (pending/running/waiting_for_confirmation/completed/failed/blocked) ve adım bazlı denetim bilgisini (currentStep, completedSteps, pendingSteps, failureReason, blockedOrConfirmationReason) döner; hiçbir hata mesajında ham bir API anahtarı/secret DÖNMEZ (bilinen secret env değerleri [REDACTED] ile değiştirilir). GERÇEK PARA HARCAYABİLİR — yalnızca hangi adımların kendi confirmed:true'su varsa onlar için, ve yalnızca altındaki capability'nin ZATEN uyguladığı aynı ücret/onay kurallarıyla.`,
    inputSchema: {
      type: "object",
      properties: {
        steps: {
          type: "array",
          minItems: 1,
          maxItems: MAX_ORCHESTRATOR_STEPS,
          description: `Sırayla yürütülecek en fazla ${MAX_ORCHESTRATOR_STEPS} adım. Her adım bir öncekinin BAŞARIYLA tamamlanmasına bağımlıdır — bir adım başarısız/onay-bekliyor olursa sonrakiler hiç çalışmaz.`,
          items: {
            type: "object",
            properties: {
              stepId: { type: "string", description: "Plan içinde benzersiz, çağıranın seçtiği bir kimlik (örn. 'step1')." },
              capability: { type: "string", enum: ORCHESTRATOR_CAPABILITIES, description: "Çalıştırılacak capability adı — bu listenin DIŞINDA bir değer PLANIN TAMAMINI reddeder." },
              args: { type: "object", description: "Capability'nin kendi MCP tool'undaki (örn. research_web) ile AYNI alanları — izin verilmeyen bir alan adı da PLANIN TAMAMINI reddeder. Ücretli bir capability için confirmed:true burada AÇIKÇA verilmelidir." },
              maxAttempts: { type: "number", description: `İsteğe bağlı, varsayılan 1, en fazla ${MAX_ORCHESTRATOR_RETRY_ATTEMPTS}. Bu adım başarısız olursa AÇIK/SINIRLI sayıda yeniden denenir.` }
            },
            required: ["stepId", "capability"]
          }
        }
      },
      required: ["steps"]
    }
  },
  {
    name: "generate_video_narration",
    description: "Bir video senaryosundan, videonun SÜRESİNE uygun uzunlukta Türkçe voice-over metni ve o senaryodan türetilmiş bir müzik brief'i üretir. ÜCRETSİZDİR (yalnızca metin üretimi, generate_caption ile aynı profil) — confirmed gerektirmez. Çıktı, generate_turkish_voiceover'ın `text` parametresine ve generate_lyria_music'in `musicBrief` parametresine doğrudan verilebilir.",
    inputSchema: {
      type: "object",
      properties: {
        scenario: { type: "string", description: "Video senaryosu/açıklaması (Türkçe) — örn. Reels/Video sekmesindeki video hareketi/prompt alanından alınabilir." },
        productName: { type: "string", description: "İsteğe bağlı — ürün adı, metne doğal şekilde geçirilir." },
        durationSeconds: { type: "number", description: "Videonun gerçek süresi, saniye — metin bu süreye SIĞACAK uzunlukta üretilir (örn. 8sn video için 20sn'lik metin üretilmez)." },
        style: { type: "string", enum: NARRATION_STYLES, description: "Seslendirme tonu (varsayılan 'reklam')." }
      },
      required: ["scenario", "durationSeconds"]
    }
  },
  {
    name: "generate_turkish_voiceover",
    description: "Google'ın Gemini TTS modeliyle GERÇEK Türkçe (tr-TR) seslendirme sesi üretir — İngilizceye veya başka bir dile ASLA otomatik geçmez; Türkçe desteklenmiyorsa TURKISH_TTS_UNAVAILABLE hatası döner. GERÇEK PARA HARCAR, confirmed:true olmadan çalışmaz. targetDurationSeconds verilirse ve gerçek ses süresi bunu önemli ölçüde aşarsa VOICEOVER_TOO_LONG hatası döner (metni AI ile kısaltıp tekrar deneyin — generate_video_narration'ı daha kısa bir durationSeconds ile tekrar çağırın). Üretim uzun sürerse (nadiren) IN_PROGRESS + interactionId döner, get_voiceover_status ile sorgulayın.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "Seslendirilecek Türkçe metin (örn. generate_video_narration çıktısı — kullanıcı düzenlemiş olabilir)." },
        style: { type: "string", enum: TTS_STYLES, description: "İsteğe bağlı, günlükleme/ses seçimi ipucu amaçlı (varsayılan 'reklam')." },
        gender: { type: "string", enum: ["female", "male", "auto"], description: "Ses tercihi (varsayılan 'auto'). Google'ın ses adları resmi olarak cinsiyete göre etiketlenmemiştir — bu, yaygın algılanan tona dayanan bir varsayılan eşlemedir; kesin bir ses istiyorsanız `voice` parametresini kullanın." },
        voice: { type: "string", description: "İsteğe bağlı — Google'ın prebuilt ses adını doğrudan belirtir (örn. 'Kore', 'Puck'), gender eşlemesini geçersiz kılar." },
        targetDurationSeconds: { type: "number", description: "İsteğe bağlı — videonun süresi. Verilirse gerçek ses süresi bunu %15'ten fazla aşarsa VOICEOVER_TOO_LONG hatası döner." },
        confirmed: { type: "boolean", description: "true olmadan hiçbir API çağrısı yapılmaz/ücret alınmaz." }
      },
      required: ["text", "confirmed"]
    }
  },
  {
    name: "get_voiceover_status",
    description: "generate_turkish_voiceover'ın IN_PROGRESS döndürdüğü nadir durumda interaction'ın durumunu sorgular. Tamamlandıysa sesi indirip Vercel Blob'a yükler ve herkese açık audioUrl döner.",
    inputSchema: {
      type: "object",
      properties: {
        interactionId: { type: "string", description: "generate_turkish_voiceover yanıtındaki interactionId." },
        model: { type: "string", description: "generate_turkish_voiceover yanıtındaki model (isteğe bağlı)." }
      },
      required: ["interactionId"]
    }
  },
  {
    name: "generate_lyria_music",
    description: "Google'ın Lyria 3 modeliyle (Clip: ~30sn, hızlı/ucuz — Pro: ~3dk'ya kadar, yüksek kalite) senaryoya uygun, SÖZSÜZ (instrumental) müzik üretir. Kullanıcıdan ayrıca bir müzik promptu İSTEMEZ — musicPrompt verilmezse scenario + musicBrief'ten (bkz. generate_video_narration çıktısı) otomatik türetilir. GERÇEK PARA HARCAR, confirmed:true olmadan çalışmaz. Üretim uzun sürerse (özellikle Pro) IN_PROGRESS + interactionId döner, get_lyria_music_status ile sorgulayın.",
    inputSchema: {
      type: "object",
      properties: {
        scenario: { type: "string", description: "Video senaryosu — musicPrompt otomatik türetimi için (musicPrompt verilmezse zorunlu)." },
        musicBrief: {
          type: "object",
          description: "İsteğe bağlı — generate_video_narration çıktısındaki musicBrief nesnesi, otomatik prompt türetimini yönlendirir.",
          properties: {
            mood: { type: "string" }, energy: { type: "string" }, tempo: { type: "string" }, description: { type: "string" }
          }
        },
        musicPrompt: { type: "string", description: "İsteğe bağlı — kullanıcı doğrudan bir müzik promptu vermek isterse (otomatik türetimi atlar). 'Instrumental only. No vocals.' otomatik olarak eklenir." },
        durationSeconds: { type: "number", description: "İsteğe bağlı — hedef süre. Clip için Google'ın kendi ~30sn varsayılanı geçerli olabilir (garanti edilmiyor)." },
        tier: { type: "string", enum: LYRIA_TIERS, description: "Varsayılan 'clip' (hızlı/ucuz, önerilen). 'pro' daha yüksek kalite ve daha uzun süre için." },
        confirmed: { type: "boolean", description: "true olmadan hiçbir API çağrısı yapılmaz/ücret alınmaz." }
      },
      required: ["confirmed"]
    }
  },
  {
    name: "get_lyria_music_status",
    description: "generate_lyria_music'in IN_PROGRESS döndürdüğü durumda interaction'ın durumunu sorgular. Tamamlandıysa müziği indirip Vercel Blob'a yükler ve herkese açık audioUrl döner.",
    inputSchema: {
      type: "object",
      properties: {
        interactionId: { type: "string", description: "generate_lyria_music yanıtındaki interactionId." },
        model: { type: "string", description: "generate_lyria_music yanıtındaki model (isteğe bağlı)." }
      },
      required: ["interactionId"]
    }
  },
  {
    name: "compose_reel_audio",
    description: "Zaten üretilmiş bir videoya Türkçe seslendirme ve/veya Lyria müziğini FFmpeg ile ekler (ducking: seslendirme çalarken müzik otomatik kısılır; limiter: clipping önlenir). ÜCRETSİZDİR (yalnızca FFmpeg, ücretli bir API çağrısı yok) — confirmed gerektirmez. voiceoverUrl/musicUrl'den en az biri gerekli. Video akışı yeniden kodlanmaz (-c:v copy) — yalnızca ses işlenir. Render GitHub Actions'ın ücretsiz kuyruğunda çalışır (birkaç dakika sürebilir); bu tool işi başlatıp hemen bir jobId döner, sonucu get_reel_audio_status ile sorgulayın.",
    inputSchema: {
      type: "object",
      properties: {
        videoUrl: { type: "string", description: "Ses eklenecek, zaten üretilmiş videonun herkese açık HTTPS URL'si (örn. generate_video_clip/get_video_clip_status, generate_omni_video_edit veya compose_product_video çıktısı)." },
        voiceoverUrl: { type: "string", description: "İsteğe bağlı — generate_turkish_voiceover/get_voiceover_status çıktısındaki audioUrl." },
        musicUrl: { type: "string", description: "İsteğe bağlı — generate_lyria_music/get_lyria_music_status çıktısındaki audioUrl." },
        musicVolume: { type: "number", description: "Müzik seviyesi, 0-1 aralığında (varsayılan 0.5 — yaklaşık -16dB, seslendirmenin altında). 0 tamamen susturur." }
      },
      required: ["videoUrl"]
    }
  },
  {
    name: "get_reel_audio_status",
    description: "compose_reel_audio ile başlatılmış bir ses mix işinin durumunu sorgular. status 'queued'/'rendering' ise birkaç dakika sonra tekrar deneyin; 'completed' ise videoUrl, durationSeconds, voiceoverIncluded, musicIncluded döner; 'failed' ise error alanında sebep bulunur.",
    inputSchema: {
      type: "object",
      properties: {
        jobId: { type: "string", description: "compose_reel_audio yanıtındaki jobId." }
      },
      required: ["jobId"]
    }
  }
];

export async function callTool(name, args) {
  switch (name) {
    case "list_products": {
      const products = await listProducts();
      return JSON.stringify(products, null, 2);
    }
    case "list_queue": {
      const data = await airtableGet();
      const allowedScopes = new Set(["recent", "active", "archive", "all"]);
      const scope = allowedScopes.has(args.scope) ? args.scope : "recent";
      const requestedDays = Number(args.publishedWithinDays);
      const publishedWithinDays = Number.isInteger(requestedDays)
        ? Math.min(365, Math.max(1, requestedDays))
        : 90;
      const cutoff = Date.now() - publishedWithinDays * 24 * 60 * 60 * 1000;
      const records = (data.records || []).filter((record) => {
        const fields = record.fields || {};
        const deleted = Boolean(fields["Silinme Tarihi"]);
        const published = fields.Durum === "Paylaşıldı" || Boolean(
          fields["Instagram Yayın ID"] ||
          fields["Facebook Yayın ID"] ||
          fields["X Yayın ID"] ||
          fields["YouTube Video ID"]
        );
        if (scope === "all") return true;
        if (deleted) return false;
        if (scope === "active") return !published;
        if (scope === "archive") return published;
        if (!published) return true;
        const publishedAt = Date.parse(fields["Yayın Zamanı"] || "");
        return !Number.isNaN(publishedAt) && publishedAt >= cutoff;
      }).map((record) => {
        const fields = record.fields || {};
        return {
          id: record.id, title: fields["Başlık"] || "Başlıksız", status: fields.Durum || "Taslak",
          format: fields["Yayın Biçimi"] || "Gönderi", platforms: fields.Platform || [],
          publishAt: fields["Yayın Zamanı"] || null, imageUrl: fields["Görsel URL"] || "",
          instagramText: truncatePreview(fields["Instagram Metni"]), facebookText: truncatePreview(fields["Facebook Metni"]),
          instagramPostId: fields["Instagram Yayın ID"] || "", facebookPostId: fields["Facebook Yayın ID"] || "",
          xPostId: fields["X Yayın ID"] || "", youtubeVideoId: fields["YouTube Video ID"] || ""
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
      // "composite" (bkz. src/scene-composite.js) generateSceneImage'ın
      // provider switch'inde YOKTUR — piksel-birebir kırpma + AI arka plan
      // üreten AYRI bir fonksiyondur (api/scene-image.js HTTP rotası zaten
      // bunu ayrıca çağırıyor). MCP tool enum'ı "composite"yi advertise
      // ettiği için burada da AYNI şekilde doğru fonksiyona yönlendirilmeli
      // (bkz. PR #102 ROOT review, blocker 2) — aksi halde ürün görseli
      // indirilip mask oluşturulduktan SONRA "Desteklenmeyen sahne üretim
      // sağlayıcısı." hatasıyla başarısız olurdu.
      const scene = provider === "composite"
        ? await generateCompositeSceneImage(product, args.sceneDescription, process.env, {})
        : await generateSceneImage(product, args.sceneDescription, process.env, {
            removeFaucet: Boolean(args.removeFaucet),
            provider
          });
      const rawBuffer = Buffer.from(scene.dataUrl.split(",")[1], "base64");
      let finalBuffer = rawBuffer;
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

      // Faz 1 — yalnızca raporlama: sonucu ekleriz ama üretimi/yayını hiçbir
      // şekilde engellemeyiz (bkz. src/lib/scene-validation.js). Görseli
      // her zaman ben (Claude) inceleyip onayladan sonra yayınlıyorum; bu
      // otomatik kontrol o incelemenin YERİNE geçmez, ona ek bir sinyaldir.
      const validation = await validateSceneImage(rawBuffer, { sceneDescription: args.sceneDescription, productTitle: product.title }, process.env);

      return JSON.stringify({ ok: true, imageUrl, provider: scene.provider, prompt: scene.prompt, needsReview: validation.needsReview, failedChecks: validation.failedChecks, reviewNotes: validation.notes }, null, 2);
    }
    case "generate_nano_banana_scene": {
      // confirmed kontrolü generateNanoBananaScene İÇİNDE, herhangi bir ağ
      // isteğinden (ürün çözümleme dahil) ÖNCE yapılır — burada tekrar
      // erkenden kontrol etmiyoruz, aksi halde iki farklı hata mesajı yolu
      // oluşurdu. productId boşsa resolveProduct HİÇ çağrılmaz (zero-shot).
      const product = String(args.productId || "").trim() ? await resolveProduct(args.productId) : null;
      const scene = await generateNanoBananaScene({ product, prompt: args.prompt, aspectRatio: args.aspectRatio, confirmed: args.confirmed === true }, process.env);
      return JSON.stringify({ ok: true, model: scene.model, provider: scene.provider, mode: scene.mode, imageUrl: scene.imageUrl, productId: args.productId || null, prompt: scene.prompt, aspectRatio: scene.aspectRatio, needsReview: scene.needsReview, failedChecks: scene.failedChecks, reviewNotes: scene.reviewNotes }, null, 2);
    }
    case "create_draft": {
      const allProducts = await listProducts();
      const product = allProducts.find((item) => item.id === args.productId);
      if (!product) throw new Error("Ürün bulunamadı.");
      // imageUrl/videoUrl verilirse ürünün Airtable kaydındaki ana alanları
      // DEĞİŞTİRMEDEN, yalnızca bu yeni taslak kaydı için geçerli olacak
      // şekilde kullanılır — createDraftRecord her zaman yeni bir kayıt
      // oluşturur (PATCH değil POST), bu yüzden orijinal ürün kaydına
      // dokunulmaz. videoUrl olmadan format "Reel" olamaz — bkz. buildDraft'ın
      // "Reel için herkese açık HTTPS video URL'i gerekli" uyarısı.
      const draftProduct = {
        ...product,
        ...(typeof args.imageUrl === "string" && args.imageUrl.trim() ? { imageUrl: args.imageUrl.trim() } : {}),
        ...(typeof args.videoUrl === "string" && args.videoUrl.trim() ? { videoUrl: args.videoUrl.trim() } : {}),
        ...(Array.isArray(args.mediaItems) ? { mediaItems: args.mediaItems } : {})
      };
      const aiCaption = args.instagramText || args.facebookText
        ? { instagramText: args.instagramText || args.facebookText, facebookText: args.facebookText || args.instagramText, hashtags: args.hashtags || "#Buzsu" }
        : null;
      const draft = buildDraft(draftProduct, { format: args.format, platforms: args.platforms, variant: 0, publishAt: args.publishAt, captionOverride: aiCaption, allowCatalogCaption: true });
      if (!draft.valid) throw new Error(draft.warnings.join(" "));
      const record = await createDraftRecord({ product: draftProduct, draft, format: args.format, platforms: args.platforms, publishAt: args.publishAt, note: "MCP üzerinden oluşturuldu." });
      return JSON.stringify({ ok: true, id: record.id, status: "Taslak" }, null, 2);
    }
    case "get_draft": {
      if (!String(args.recordId || "").trim()) throw new Error("recordId gerekli.");
      const response = await fetch(`https://api.airtable.com/v0/${baseId}/${tableId}/${encodeURIComponent(args.recordId)}`, {
        headers: { Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}` }
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message || `Airtable HTTP ${response.status}`);
      return JSON.stringify({ ok: true, id: data.id, ...normalizeDraftFields(data.fields || {}) }, null, 2);
    }
    case "upload_media": {
      const hasUrl = typeof args.imageUrl === "string" && args.imageUrl.trim().length > 0;
      const hasBase64 = typeof args.imageBase64 === "string" && args.imageBase64.trim().length > 0;
      if (hasUrl === hasBase64) throw new Error("imageUrl veya imageBase64 alanlarından tam olarak biri verilmelidir.");
      const wantsProductUpdate = Boolean(args.productId) && args.updateProductImage === true;
      // Bu kontrolü Blob'a yüklemeden ÖNCE yapıyoruz: aksi hâlde bilinen-geçersiz
      // bir kombinasyonda (katalog ürünü) bile önce herkese açık/faturalandırılan
      // bir Blob oluşturulup sonra hata fırlatılır — o Blob hiçbir yerden
      // referanslanamayan, sahipsiz kalan bir yük olur.
      if (wantsProductUpdate && isCatalogProductId(args.productId)) {
        throw new Error("Katalog ürünlerinin (Airtable kaydı olmayan) ana görseli MCP üzerinden güncellenemez.");
      }

      let buffer, mimeType;
      if (hasUrl) {
        // Google Drive paylaşım linkleri (ChatGPT'nin görsel kaydettiği yer)
        // doğrudan bir görsel URL'i değil, bir görüntüleyici sayfasıdır —
        // tanınırsa doğrudan indirme URL'ine çevrilir; Drive linki değilse
        // rawUrl olduğu gibi kullanılır (normal HTTPS akışı etkilenmez).
        const driveFileId = extractDriveFileId(args.imageUrl);
        const targetUrl = normalizeDriveUrl(args.imageUrl);
        try {
          ({ buffer, mimeType } = await fetchPublicImage(targetUrl));
        } catch (error) {
          if (driveFileId && /Desteklenmeyen görsel tipi/.test(error.message)) {
            throw new Error("Google Drive, ham görsel yerine bir HTML/onay sayfası döndürdü. Dosyanın (klasörün değil, dosyanın kendisinin) \"Bağlantıya sahip olan herkes\" ile paylaşıldığından emin olun.");
          }
          throw error;
        }
      } else {
        if (!args.mimeType) throw new Error("imageBase64 kullanılıyorsa mimeType zorunludur.");
        mimeType = String(args.mimeType).toLowerCase();
        buffer = decodeImageBase64(args.imageBase64, mimeType);
      }

      // Kaynak (özellikle Drive/ChatGPT gibi üçüncü taraf) bizim kontrolümüzde
      // kodlanmadığı için Meta'nın kabul edeceğini garanti edemeyiz (CMYK,
      // alışılmadık ICC profili, progressive JPEG, işlenmemiş EXIF döndürme
      // gibi "format desteklenmiyor" hatalarına yol açan detaylar Content-Type
      // başlığından görünmez). Blob'a yüklemeden önce her zaman temiz bir
      // JPEG/PNG'ye yeniden kodluyoruz — preview (confirmed:false) yanıtı da
      // gerçekte yüklenecek olanı yansıtsın diye bunu confirmed kontrolünden
      // ÖNCE yapıyoruz.
      let width, height;
      ({ buffer, mimeType, width, height } = await normalizeImageForMeta(buffer, mimeType));

      if (args.confirmed !== true) {
        return JSON.stringify({ ok: true, confirmed: false, preview: true, mimeType, size: buffer.length, width, height, message: "Doğrulama başarılı, henüz yüklenmedi. Gerçekten yüklemek için confirmed:true gönderin." }, null, 2);
      }

      if (!process.env.BLOB_READ_WRITE_TOKEN) throw new Error("BLOB_READ_WRITE_TOKEN Vercel Production ortamında tanımlı değil.");
      const safeName = String(args.filename || "gorsel").replace(/\.[a-zA-Z0-9]+$/, "").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80) || "gorsel";
      const blob = await put(`manual-uploads/${Date.now()}-${safeName}.${imageExtensionFor(mimeType)}`, buffer, { access: "public", contentType: mimeType });

      let productImageUpdated = false;
      if (wantsProductUpdate) {
        const patchResponse = await fetch(`https://api.airtable.com/v0/${baseId}/${tableId}/${encodeURIComponent(args.productId)}`, {
          method: "PATCH",
          headers: { Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}`, "Content-Type": "application/json" },
          body: JSON.stringify({ fields: { "Görsel URL": blob.url } })
        });
        if (!patchResponse.ok) {
          const patchData = await patchResponse.json().catch(() => ({}));
          // Ürün kaydı bulunamadı/geçersizse Blob zaten yüklenmiş oluyor —
          // sahipsiz kalmasın diye burada temizliyoruz. Silme başarısız olsa
          // bile asıl hatayı (Airtable) gizlemeden fırlatmaya devam ediyoruz.
          await del(blob.url).catch(() => {});
          throw new Error(patchData.error?.message || `Airtable HTTP ${patchResponse.status}`);
        }
        productImageUpdated = true;
      }

      return JSON.stringify({ ok: true, imageUrl: blob.url, mimeType, size: buffer.length, width, height, productId: args.productId || null, productImageUpdated }, null, 2);
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
    case "compose_product_video": {
      const result = await composeProductVideo(args);
      return JSON.stringify(result, null, 2);
    }
    case "get_video_render_status": {
      if (!String(args.jobId || "").trim()) throw new Error("jobId gerekli.");
      const status = await getVideoRenderStatus(args.jobId);
      return JSON.stringify(status, null, 2);
    }
    case "generate_omni_video_edit": {
      if (args.confirmed !== true) throw new Error("Bu işlem gerçek API kredisi harcar. Onaylamak için confirmed:true gönderin.");
      if (!String(args.editPrompt || "").trim()) throw new Error("editPrompt boş olamaz.");
      const job = await submitOmniVideoEdit(args.existingVideoUrl, process.env, {
        referenceImageUrl: args.referenceImageUrl,
        editPrompt: args.editPrompt,
        aspectRatio: args.aspectRatio || "9:16",
        resolution: args.resolution || "360p",
        confirmed: true
      });
      return JSON.stringify({ ok: true, ...job }, null, 2);
    }
    case "get_omni_video_status": {
      if (!String(args.interactionId || "").trim()) throw new Error("interactionId gerekli.");
      const status = await omniInteractionStatus({ interactionId: args.interactionId, outputFileId: args.outputFileId || null, model: args.model || OMNI_MODEL }, process.env);
      // status.status===undefined tüm alanları (outputFileId dahil)
      // olduğu gibi geri döner — aksi halde çağıran taraf outputFileId'yi
      // kaybedip bir sonraki sorguda gereksiz yere GET /interactions/{id}
      // yoluna düşerdi (bkz. yukarıdaki tool açıklaması).
      if (status.status !== "COMPLETED") return JSON.stringify({ ok: true, ...status }, null, 2);
      // Google, delivery:"uri" istenmiş olsa bile GET /interactions/{id} ile
      // durum sorgularken videoyu inline base64 döndürebiliyor (bkz.
      // src/omni-video.js:extractOmniVideoOutput) — fileUri yoksa videoBase64
      // kullanılır, biri "her zaman doğru şekil" diye varsayılmaz.
      const videoBuffer = status.videoBase64 ? Buffer.from(status.videoBase64, "base64") : await downloadOmniVideo(status.fileUri, process.env);
      let videoUrl = null;
      if (process.env.BLOB_READ_WRITE_TOKEN) {
        const safeName = String(args.interactionId).replace(/[^a-zA-Z0-9_-]/g, "_").slice(-80);
        const blob = await put(`ai-omni/${safeName}-${Date.now()}.mp4`, videoBuffer, { access: "public", contentType: status.videoMimeType || "video/mp4" });
        videoUrl = blob.url;
      }
      return JSON.stringify({ ok: true, status: "COMPLETED", videoUrl }, null, 2);
    }
    case "generate_gemini_video": {
      if (args.confirmed !== true) throw new Error("Bu işlem gerçek API kredisi harcar. Onaylamak için confirmed:true gönderin.");
      if (!String(args.prompt || "").trim()) throw new Error("prompt boş olamaz.");
      const job = await submitOmniVideoGeneration(args.prompt, process.env, {
        referenceImageUrl: args.referenceImageUrl,
        aspectRatio: args.aspectRatio || "9:16",
        resolution: args.resolution || "360p",
        confirmed: true
      });
      return JSON.stringify({ ok: true, ...job }, null, 2);
    }
    case "get_gemini_video_status": {
      if (!String(args.interactionId || "").trim()) throw new Error("interactionId gerekli.");
      const status = await omniInteractionStatus({ interactionId: args.interactionId, outputFileId: args.outputFileId || null, model: args.model || OMNI_MODEL }, process.env);
      if (status.status !== "COMPLETED") return JSON.stringify({ ok: true, ...status }, null, 2);
      const videoBuffer = status.videoBase64 ? Buffer.from(status.videoBase64, "base64") : await downloadOmniVideo(status.fileUri, process.env);
      let geminiVideoUrl = null;
      if (process.env.BLOB_READ_WRITE_TOKEN) {
        const safeName = String(args.interactionId).replace(/[^a-zA-Z0-9_-]/g, "_").slice(-80);
        const blob = await put(`ai-omni/${safeName}-${Date.now()}.mp4`, videoBuffer, { access: "public", contentType: status.videoMimeType || "video/mp4" });
        geminiVideoUrl = blob.url;
      }
      return JSON.stringify({ ok: true, status: "COMPLETED", videoUrl: geminiVideoUrl }, null, 2);
    }
    case "get_buzsu_product_context": {
      const result = await getBuzsuProductContext({ productId: args.productId, productUrl: args.productUrl, refresh: args.refresh === true });
      return JSON.stringify({ ok: true, ...result }, null, 2);
    }
    case "generate_reel_script": {
      const result = await generateReelScript(
        {
          productId: args.productId,
          productUrl: args.productUrl,
          userBrief: args.userBrief,
          durationSeconds: args.durationSeconds,
          objective: args.objective,
          aspectRatio: args.aspectRatio,
          provider: args.provider,
          modelTier: args.modelTier,
          model: args.model || null,
          researchMode: args.researchMode,
          researchQuery: args.researchQuery,
          researchUrls: args.researchUrls,
          confirmed: args.confirmed === true
        },
        process.env
      );
      return JSON.stringify({ ok: true, ...result }, null, 2);
    }
    case "research_web": {
      if (args.confirmed !== true) throw new Error("Bu işlem gerçek API kredisi harcar. Onaylamak için confirmed:true gönderin.");
      const result = await researchWeb({ query: args.query, provider: args.provider, urls: args.urls }, process.env);
      return JSON.stringify({ ok: true, ...result }, null, 2);
    }
    case "transcribe_media": {
      if (args.confirmed !== true) throw new Error("Bu işlem gerçek API kredisi harcar. Onaylamak için confirmed:true gönderin.");
      const result = await transcribeMedia(
        { mediaUrl: args.mediaUrl, provider: args.provider, languageHint: args.languageHint, vocabularyHints: args.vocabularyHints, diarization: args.diarization === true },
        process.env
      );
      return JSON.stringify({ ok: true, ...result }, null, 2);
    }
    case "validate_product_visual": {
      if (args.confirmed !== true) throw new Error("Bu işlem gerçek API kredisi harcar. Onaylamak için confirmed:true gönderin.");
      const result = await validateProductVisual(
        {
          referenceImageUrl: args.referenceImageUrl,
          generatedImageUrl: args.generatedImageUrl,
          generatedImageBase64: args.generatedImageBase64,
          generatedImageMimeType: args.generatedImageMimeType,
          productTitle: args.productTitle,
          sceneDescription: args.sceneDescription
        },
        process.env
      );
      return JSON.stringify({ ok: true, ...result }, null, 2);
    }
    case "generate_image_from_video": {
      const result = await generateImageFromVideo(
        {
          videoUrl: args.videoUrl,
          prompt: args.prompt,
          aspectRatio: args.aspectRatio,
          model: args.model,
          confirmed: args.confirmed === true
        },
        process.env
      );
      return JSON.stringify(result, null, 2);
    }
    case "search_product_knowledge": {
      const result = await searchProductKnowledge(
        {
          productId: args.productId,
          productUrl: args.productUrl,
          query: args.query,
          provider: args.provider,
          confirmed: args.confirmed === true
        },
        process.env
      );
      return JSON.stringify({ ok: true, ...result }, null, 2);
    }
    case "run_agent_orchestration": {
      // Bilinçli olarak burada bir top-level confirmed kontrolü YOKTUR —
      // bu tool'un kendisi ücretli değildir (sadece koordinasyon yapar);
      // gerçek ücret/onay kapısı HER adımın KENDİ confirmed:true'sunda
      // yaşar (bkz. src/orchestrator/capabilities.js requiresConfirmation),
      // runOrchestration bunu asla kendiliğinden üretmez/atlamaz.
      const result = await runOrchestration({ steps: args.steps }, process.env);
      return JSON.stringify(result, null, 2);
    }
    case "generate_video_narration": {
      const narration = await generateVideoNarration(
        { scenario: args.scenario, productName: args.productName, durationSeconds: args.durationSeconds, style: args.style },
        process.env
      );
      return JSON.stringify({ ok: true, ...narration }, null, 2);
    }
    case "generate_turkish_voiceover": {
      if (args.confirmed !== true) throw new Error("Bu işlem gerçek API kredisi harcar. Onaylamak için confirmed:true gönderin.");
      const result = await generateTurkishVoiceover(
        { text: args.text, style: args.style, gender: args.gender, voice: args.voice, targetDurationSeconds: args.targetDurationSeconds, confirmed: true },
        process.env
      );
      if (result.status !== "COMPLETED") return JSON.stringify({ ok: true, ...result }, null, 2);
      let audioUrl = null;
      if (process.env.BLOB_READ_WRITE_TOKEN) {
        const blob = await put(`turkish-voiceover/${Date.now()}.wav`, result.audioBuffer, { access: "public", contentType: result.mimeType || "audio/wav" });
        audioUrl = blob.url;
      }
      const { audioBuffer, ...rest } = result;
      return JSON.stringify({ ok: true, ...rest, audioUrl, downloadNote: audioUrl ? undefined : "BLOB_READ_WRITE_TOKEN tanımlı olmadığı için ses kalıcı bir bağlantı alamadı." }, null, 2);
    }
    case "get_voiceover_status": {
      if (!String(args.interactionId || "").trim()) throw new Error("interactionId gerekli.");
      const status = await turkishVoiceoverStatus({ interactionId: args.interactionId, model: args.model }, process.env);
      if (status.status !== "COMPLETED") return JSON.stringify({ ok: true, ...status }, null, 2);
      let audioUrl = null;
      if (process.env.BLOB_READ_WRITE_TOKEN) {
        const safeName = String(args.interactionId).replace(/[^a-zA-Z0-9_-]/g, "_").slice(-80);
        const blob = await put(`turkish-voiceover/${safeName}-${Date.now()}.wav`, status.audioBuffer, { access: "public", contentType: status.mimeType || "audio/wav" });
        audioUrl = blob.url;
      }
      const { audioBuffer, ...rest } = status;
      return JSON.stringify({ ok: true, ...rest, audioUrl }, null, 2);
    }
    case "generate_lyria_music": {
      if (args.confirmed !== true) throw new Error("Bu işlem gerçek API kredisi harcar. Onaylamak için confirmed:true gönderin.");
      const result = await generateLyriaMusic(
        { scenario: args.scenario, musicBrief: args.musicBrief, musicPrompt: args.musicPrompt, durationSeconds: args.durationSeconds, tier: args.tier || "clip", confirmed: true },
        process.env
      );
      if (result.status !== "COMPLETED") return JSON.stringify({ ok: true, ...result }, null, 2);
      let musicUrl = null;
      if (process.env.BLOB_READ_WRITE_TOKEN) {
        const blob = await put(`lyria-music/${Date.now()}.mp3`, result.audioBuffer, { access: "public", contentType: result.mimeType || "audio/mpeg" });
        musicUrl = blob.url;
      }
      const { audioBuffer, ...rest } = result;
      return JSON.stringify({ ok: true, ...rest, musicUrl, downloadNote: musicUrl ? undefined : "BLOB_READ_WRITE_TOKEN tanımlı olmadığı için müzik kalıcı bir bağlantı alamadı." }, null, 2);
    }
    case "get_lyria_music_status": {
      if (!String(args.interactionId || "").trim()) throw new Error("interactionId gerekli.");
      const status = await lyriaMusicStatus({ interactionId: args.interactionId, model: args.model }, process.env);
      if (status.status !== "COMPLETED") return JSON.stringify({ ok: true, ...status }, null, 2);
      let musicUrl = null;
      if (process.env.BLOB_READ_WRITE_TOKEN) {
        const safeName = String(args.interactionId).replace(/[^a-zA-Z0-9_-]/g, "_").slice(-80);
        const blob = await put(`lyria-music/${safeName}-${Date.now()}.mp3`, status.audioBuffer, { access: "public", contentType: status.mimeType || "audio/mpeg" });
        musicUrl = blob.url;
      }
      const { audioBuffer, ...rest } = status;
      return JSON.stringify({ ok: true, ...rest, musicUrl }, null, 2);
    }
    case "compose_reel_audio": {
      const result = await composeReelAudio(args);
      return JSON.stringify(result, null, 2);
    }
    case "get_reel_audio_status": {
      if (!String(args.jobId || "").trim()) throw new Error("jobId gerekli.");
      const status = await getReelAudioStatus(args.jobId);
      return JSON.stringify(status, null, 2);
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

// export: test/mcp.test.js bunu doğrudan çağırıp tools/call'ın JSON-RPC
// zarfını (isError:true, content[].text) MCP_API_KEY/HTTP katmanına hiç
// girmeden test edebiliyor — handler() zaten aynı fonksiyonu kullanıyor,
// davranış değişmedi.
export async function handleMessage(msg) {
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
        // PR #74 inceleme bulgusu: `typeof error.code === "string"` çok
        // genişti — Node/ağ/Blob hataları da sıklıkla bir .code taşır (ör.
        // ENOTFOUND, ECONNRESET, Vercel Blob SDK hataları) ve bunlar
        // RATE_LIMITED/VeoApiError İLE HİÇ İLGİLİ DEĞİL. Koşul artık tam
        // olarak VeoApiError/OmniApiError'ın kendi şekline (code'u
        // RATE_LIMITED veya REGION_UNAVAILABLE + toJSON metodu) kilitleniyor
        // — code'u olan ama bu şekle uymayan sıradan bir hata eskisi gibi
        // düz "Hata: ..." metnine düşer.
        const structuredCodes = new Set([
          "RATE_LIMITED", "REGION_UNAVAILABLE", "TURKISH_TTS_UNAVAILABLE",
          "MODEL_UNAVAILABLE", "INVALID_SCENE_TIMING", "NARRATION_TOO_LONG", "STRUCTURED_JSON_INVALID", "INVALID_INPUT"
        ]);
        const text = structuredCodes.has(error.code) && typeof error.toJSON === "function"
          ? JSON.stringify({ ok: false, ...error.toJSON() })
          : `Hata: ${error.message}`;
        return jsonRpcResponse(id, { content: [{ type: "text", text }], isError: true });
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
