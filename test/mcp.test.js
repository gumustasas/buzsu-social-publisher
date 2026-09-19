import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { callTool, handleMessage } from "../api/mcp.js";

process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || "test-gemini-key";

const originalAirtableToken = process.env.AIRTABLE_TOKEN;

function withAirtableRecordMock(fields, run) {
  process.env.AIRTABLE_TOKEN = "test-token";
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    assert.match(String(url), /\/recTEST123$/);
    return { ok: true, json: async () => ({ id: "recTEST123", fields }) };
  };
  return run().finally(() => {
    global.fetch = originalFetch;
    if (originalAirtableToken === undefined) delete process.env.AIRTABLE_TOKEN;
    else process.env.AIRTABLE_TOKEN = originalAirtableToken;
  });
}

test("get_draft requires recordId", async () => {
  await assert.rejects(() => callTool("get_draft", {}), /recordId gerekli/);
});

test("get_draft reads a plain Gönderi record — no mediaItems/mediaItemsWarning drift, matches the documented response shape", async () => {
  await withAirtableRecordMock(
    {
      "Başlık": "Code Su Arıtma Cihazı | Gönderi",
      "Durum": "Onaylandı",
      "Yayın Biçimi": "Gönderi",
      "Platform": ["Instagram", "Facebook"],
      "Yayın Zamanı": "2026-09-15T10:00:00.000Z",
      "Instagram Metni": "IG metni",
      "Facebook Metni": "FB metni",
      "Hashtagler": "#Buzsu",
      "Görsel URL": "https://example.com/photo.jpg"
    },
    async () => {
      const result = JSON.parse(await callTool("get_draft", { recordId: "recTEST123" }));
      assert.equal(result.ok, true);
      assert.equal(result.id, "recTEST123");
      assert.equal(result.title, "Code Su Arıtma Cihazı | Gönderi");
      assert.equal(result.status, "Onaylandı");
      assert.equal(result.format, "Gönderi");
      assert.deepEqual(result.platforms, ["Instagram", "Facebook"]);
      assert.equal(result.imageUrl, "https://example.com/photo.jpg");
      assert.equal(result.videoUrl, "");
      assert.deepEqual(result.mediaItems, []);
      assert.equal(result.mediaCount, 0);
      assert.ok(!("mediaItemsWarning" in result));
    }
  );
});

test("get_draft returns exactly 10 mediaItems for a Carousel record, preserving image/video types in order", async () => {
  const mediaItems = Array.from({ length: 10 }, (_, index) => ({
    type: index % 3 === 0 ? "video" : "image",
    url: `https://example.com/media${index}.${index % 3 === 0 ? "mp4" : "jpg"}`
  }));
  await withAirtableRecordMock(
    {
      "Başlık": "Code Su Arıtma Cihazı | Carousel",
      "Durum": "Taslak",
      "Yayın Biçimi": "Carousel",
      "Platform": ["Instagram", "Facebook"],
      "Media Items": JSON.stringify(mediaItems)
    },
    async () => {
      const result = JSON.parse(await callTool("get_draft", { recordId: "recTEST123" }));
      assert.equal(result.format, "Carousel");
      assert.equal(result.mediaCount, 10);
      assert.equal(result.mediaItems.length, 10);
      assert.deepEqual(result.mediaItems.map((item) => item.type), mediaItems.map((item) => item.type));
      assert.deepEqual(result.mediaItems, mediaItems);
    }
  );
});

test("get_draft does not crash on a corrupt Media Items field — it degrades to an empty mediaItems array with a warning instead of throwing", async () => {
  await withAirtableRecordMock(
    { "Başlık": "Bozuk kayıt", "Yayın Biçimi": "Carousel", "Media Items": "{bozuk json" },
    async () => {
      const result = JSON.parse(await callTool("get_draft", { recordId: "recTEST123" }));
      assert.equal(result.ok, true);
      assert.deepEqual(result.mediaItems, []);
      assert.equal(result.mediaCount, 0);
      assert.match(result.mediaItemsWarning, /JSON dizisi değil/);
    }
  );
});

test("get_draft surfaces the Airtable error when the record cannot be found", async () => {
  process.env.AIRTABLE_TOKEN = "test-token";
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: false, status: 404, json: async () => ({ error: { message: "NOT_FOUND" } }) });
  try {
    await assert.rejects(() => callTool("get_draft", { recordId: "recDOESNOTEXIST" }), /NOT_FOUND/);
  } finally {
    global.fetch = originalFetch;
    if (originalAirtableToken === undefined) delete process.env.AIRTABLE_TOKEN;
    else process.env.AIRTABLE_TOKEN = originalAirtableToken;
  }
});

// list_queue bir genel-bakış aracıdır (tam metin için get_draft var) —
// instagramText/facebookText tam metniyle taşınırsa çok kayıtlı kuyruklarda
// MCP istemcilerinin token limitini aşacak kadar şişiyordu (bkz. PR #35 ve
// sonrasındaki bu düzeltme). Burada kısa bir önizlemeye indiriliyor.
function withAirtableListMock(records, run) {
  process.env.AIRTABLE_TOKEN = "test-token";
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: true, json: async () => ({ records }) });
  return run().finally(() => {
    global.fetch = originalFetch;
    if (originalAirtableToken === undefined) delete process.env.AIRTABLE_TOKEN;
    else process.env.AIRTABLE_TOKEN = originalAirtableToken;
  });
}

test("list_queue truncates long instagramText/facebookText to a short preview instead of the full caption", async () => {
  const longText = "Bu ürünle ilgili çok uzun bir Instagram gönderi metni burada yer alıyor ve seksen karakteri kesinlikle aşıyor, hatta bir hayli fazlasını içeriyor.";
  await withAirtableListMock(
    [{ id: "rec1", fields: { "Başlık": "Uzun metinli kayıt", "Durum": "Taslak", "Instagram Metni": longText, "Facebook Metni": longText } }],
    async () => {
      const [record] = JSON.parse(await callTool("list_queue", {}));
      assert.ok(record.instagramText.length <= 81, "instagramText önizlemesi ~80 karakteri aşmamalı");
      assert.ok(record.facebookText.length <= 81, "facebookText önizlemesi ~80 karakteri aşmamalı");
      assert.match(record.instagramText, /…$/);
      assert.notEqual(record.instagramText, longText);
    }
  );
});

test("list_queue's truncation never splits an emoji's surrogate pair at the boundary (Codex review)", async () => {
  // 💧 (U+1F4A7) UTF-16'da bir surrogate pair'tir (2 kod birimi). Bunu tam
  // 80. kod noktası konumuna yerleştirip string.slice'ın (UTF-16 kod
  // birimine göre kesen) emoji'yi ortadan bölüp bölmediğini doğruluyoruz.
  const prefix = "a".repeat(79);
  const text = `${prefix}💧 devamında daha da uzun bir metin geliyor ve seksen karakteri aşıyor.`;
  await withAirtableListMock(
    [{ id: "rec1", fields: { "Başlık": "Emoji sınırında kayıt", "Durum": "Taslak", "Instagram Metni": text, "Facebook Metni": text } }],
    async () => {
      const [record] = JSON.parse(await callTool("list_queue", {}));
      assert.ok(record.instagramText.includes("💧"), "emoji bölünmemiş olarak önizlemede kalmalı");
      assert.match(record.instagramText, /…$/);
    }
  );
});

test("list_queue leaves short instagramText/facebookText unchanged (no unnecessary truncation)", async () => {
  await withAirtableListMock(
    [{ id: "rec1", fields: { "Başlık": "Kısa metinli kayıt", "Durum": "Taslak", "Instagram Metni": "Kısa metin", "Facebook Metni": "Kısa metin" } }],
    async () => {
      const [record] = JSON.parse(await callTool("list_queue", {}));
      assert.equal(record.instagramText, "Kısa metin");
      assert.equal(record.facebookText, "Kısa metin");
    }
  );
});

test("get_video_render_status requires jobId", async () => {
  await assert.rejects(() => callTool("get_video_render_status", {}), /jobId gerekli/);
});

// compose_product_video, gerçek Blob/GitHub API çağrılarından ÖNCE
// mediaItems'ı doğrular (bkz. src/video-compose.js validateComposeInput) —
// bu yüzden geçersiz bir mediaItems, BLOB_READ_WRITE_TOKEN/
// GITHUB_DISPATCH_TOKEN tanımlı olmadan da güvenle test edilebilir; gerçek
// ağ/Blob mock'lu kapsamlı akış testleri test/video-compose.test.js'te.
test("compose_product_video validates mediaItems before any network/Blob access", async () => {
  await assert.rejects(() => callTool("compose_product_video", { mediaItems: [{ imageUrl: "https://example.com/a.jpg" }] }), /en az 2/);
  await assert.rejects(() => callTool("compose_product_video", { mediaItems: [] }), /en az 2/);
});

// generate_video_clip'in RATE_LIMITED (429) hatası, MCP JSON-RPC zarfında
// isError:true KORUNARAK ama content[].text'in düz "Hata: ..." yerine
// code/model/alternatives gibi alanları taşıyan geçerli bir JSON olmasını
// gerektiriyor (bkz. src/veo-video.js:VeoApiError, api/mcp.js tools/call
// catch bloğu). callTool değil handleMessage test ediliyor çünkü bu
// zarflama (content/isError) tools/call seviyesinde, callTool'un DIŞINDA.
test("tools/call: generate_video_clip'in RATE_LIMITED hatası isError:true ile birlikte geçerli JSON içeren bir content.text döner", async () => {
  const originalFetch = global.fetch;
  global.fetch = async (url, options) => {
    if (!options) return { ok: true, headers: { get: () => "image/jpeg" }, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
    return {
      ok: false,
      status: 429,
      headers: { get: (name) => (name.toLowerCase() === "retry-after" ? "7" : null) },
      json: async () => ({ error: { message: "quota exceeded", status: "RESOURCE_EXHAUSTED", details: [] } })
    };
  };
  try {
    const response = await handleMessage({
      id: 1,
      method: "tools/call",
      params: { name: "generate_video_clip", arguments: { imageUrl: "https://example.com/x.jpg", prompt: "p", confirmed: true, model: "fast" } }
    });
    assert.equal(response.result.isError, true);
    const parsed = JSON.parse(response.result.content[0].text);
    assert.equal(parsed.ok, false);
    assert.equal(parsed.code, "RATE_LIMITED");
    assert.equal(parsed.httpStatus, 429);
    assert.equal(parsed.model, "veo-3.1-fast-generate-preview");
    assert.equal(parsed.retryAfter, 7);
    assert.deepEqual(parsed.alternatives.map((a) => a.tier), ["economy", "quality"]);
  } finally {
    global.fetch = originalFetch;
  }
});

test("generate_omni_video_edit confirmed:false ile hiçbir ağ isteği atmadan reddeder (Veo'daki confirmed kuralının Omni karşılığı)", async () => {
  const originalFetch = global.fetch;
  let calls = 0;
  global.fetch = async () => { calls++; throw new Error("fetch should not be called without confirmed:true"); };
  try {
    await assert.rejects(
      () => callTool("generate_omni_video_edit", { existingVideoUrl: "https://example.com/video.mp4", editPrompt: "fix", confirmed: false }),
      /confirmed:true/
    );
    assert.equal(calls, 0);
  } finally {
    global.fetch = originalFetch;
  }
});

// generate_omni_video_edit'in REGION_UNAVAILABLE hatası (bkz.
// src/omni-video.js:OmniApiError, api/mcp.js tools/call catch bloğu),
// RATE_LIMITED ile aynı yapılandırılmış-JSON muamelesini görüyor mu diye
// doğrular — mcp.js'deki catch koşulu bu PR ile RATE_LIMITED'den
// REGION_UNAVAILABLE'ı da kapsayacak şekilde genişletildi.
test("tools/call: generate_omni_video_edit'in REGION_UNAVAILABLE hatası isError:true ile birlikte geçerli JSON içeren bir content.text döner", async () => {
  const originalFetch = global.fetch;
  global.fetch = async (url, options) => {
    const href = String(url);
    if (!options && href.startsWith("https://example.com/video")) return { ok: true, headers: { get: () => "video/mp4" }, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
    if (href.includes("/upload/v1beta/files") && options?.headers?.["X-Goog-Upload-Command"] === "start") return { ok: true, headers: { get: (name) => (name === "x-goog-upload-url" ? "https://example.com/upload-session" : null) } };
    if (href === "https://example.com/upload-session") return { ok: true, json: async () => ({ file: { uri: "https://example.com/files/abc123", name: "files/abc123", mimeType: "video/mp4" } }) };
    if (href.includes("/v1beta/files/abc123")) return { ok: true, json: async () => ({ name: "files/abc123", uri: "https://example.com/files/abc123", mimeType: "video/mp4", state: "ACTIVE" }) };
    if (href.endsWith("/v1beta/interactions")) return { ok: false, status: 403, headers: { get: () => null }, json: async () => ({ error: { status: "PERMISSION_DENIED", message: "Video editing is not available in your region." } }) };
    throw new Error(`Beklenmeyen fetch: ${href}`);
  };
  try {
    const response = await handleMessage({
      id: 1,
      method: "tools/call",
      params: { name: "generate_omni_video_edit", arguments: { existingVideoUrl: "https://example.com/video.mp4", editPrompt: "fix", confirmed: true } }
    });
    assert.equal(response.result.isError, true);
    const parsed = JSON.parse(response.result.content[0].text);
    assert.equal(parsed.ok, false);
    assert.equal(parsed.code, "REGION_UNAVAILABLE");
    assert.equal(parsed.httpStatus, 403);
    assert.equal(parsed.model, "gemini-omni-1.1-flash");
  } finally {
    global.fetch = originalFetch;
  }
});

// Türkçe seslendirme + Lyria müzik + FFmpeg mix mimarisi — bkz.
// src/turkish-tts.js, src/lyria-music.js, src/reel-audio-compose.js.
test("generate_video_narration is a free tool — no confirmed required", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ narrationText: "Kısa metin.", musicBrief: {} }) }] } }] }) });
  try {
    const text = await callTool("generate_video_narration", { scenario: "test", durationSeconds: 8 });
    const parsed = JSON.parse(text);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.narrationText, "Kısa metin.");
  } finally {
    global.fetch = originalFetch;
  }
});

test("generate_turkish_voiceover confirmed:false ile hiçbir ağ isteği atmadan reddeder", async () => {
  const originalFetch = global.fetch;
  let calls = 0;
  global.fetch = async () => { calls++; throw new Error("fetch should not be called without confirmed:true"); };
  try {
    await assert.rejects(() => callTool("generate_turkish_voiceover", { text: "test", confirmed: false }), /confirmed:true/);
    assert.equal(calls, 0);
  } finally {
    global.fetch = originalFetch;
  }
});

test("tools/call: generate_turkish_voiceover'ın TURKISH_TTS_UNAVAILABLE hatası isError:true ile birlikte geçerli JSON içeren bir content.text döner (asla başka bir dile otomatik geçmez)", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: false, status: 400, headers: { get: () => null }, json: async () => ({ error: { status: "INVALID_ARGUMENT", message: "Language tr-TR is not supported." } }) });
  try {
    const response = await handleMessage({ id: 1, method: "tools/call", params: { name: "generate_turkish_voiceover", arguments: { text: "test", confirmed: true } } });
    assert.equal(response.result.isError, true);
    const parsed = JSON.parse(response.result.content[0].text);
    assert.equal(parsed.ok, false);
    assert.equal(parsed.code, "TURKISH_TTS_UNAVAILABLE");
  } finally {
    global.fetch = originalFetch;
  }
});

test("generate_lyria_music confirmed:false ile hiçbir ağ isteği atmadan reddeder", async () => {
  const originalFetch = global.fetch;
  let calls = 0;
  global.fetch = async () => { calls++; throw new Error("fetch should not be called without confirmed:true"); };
  try {
    await assert.rejects(() => callTool("generate_lyria_music", { scenario: "test", confirmed: false }), /confirmed:true/);
    assert.equal(calls, 0);
  } finally {
    global.fetch = originalFetch;
  }
});

test("compose_reel_audio validates its input (videoUrl + en az bir ses) before any network/GitHub dispatch access", async () => {
  await assert.rejects(() => callTool("compose_reel_audio", {}), /videoUrl/);
  await assert.rejects(() => callTool("compose_reel_audio", { videoUrl: "https://example.com/v.mp4" }), /voiceoverUrl.*musicUrl/);
});

// AI Reels V2 PR-A: Product Intelligence — src/lib/product-intelligence.js.
// Bu araç ÜCRETSİZDİR, hiçbir AI/paid API çağrısına gitmez; yalnızca
// buzsu.com.tr (llms-full.txt/feed.xml/ürün sayfası) ve Airtable'a fetch
// atar. NOT: src/lib/product-context.js, src/lib/product-catalog.js ve
// src/lib/feed-catalog.js modül-seviyesi (process ömrü boyunca) bir
// in-memory cache tutar — bu dosyadaki get_buzsu_product_context testleri
// bu yüzden BİLEREK az sayıda ve birbirinden bağımsız (fetch'e hiç
// gitmeyen erken-hata testleri + tek bir mutlu-yol testi) tutuldu; ileride
// buraya YENİ bir mutlu-yol testi eklerken bu paylaşılan cache'in önceki
// testten gelen içeriği döndürebileceğini unutmayın.
test("get_buzsu_product_context: productId veya productUrl verilmeden hiçbir fetch atmadan hata verir", async () => {
  const originalFetch = global.fetch;
  global.fetch = async (url) => { throw new Error(`fetch çağrılmamalıydı: ${url}`); };
  try {
    await assert.rejects(() => callTool("get_buzsu_product_context", {}), /productId veya productUrl gerekli/);
  } finally {
    global.fetch = originalFetch;
  }
});

test("get_buzsu_product_context: allowlist dışı bir productUrl hiçbir fetch atmadan reddedilir", async () => {
  const originalFetch = global.fetch;
  global.fetch = async (url) => { throw new Error(`fetch çağrılmamalıydı: ${url}`); };
  try {
    await assert.rejects(() => callTool("get_buzsu_product_context", { productUrl: "https://evil-buzsu.com.tr/urun/" }), /buzsu\.com\.tr/);
  } finally {
    global.fetch = originalFetch;
  }
});

// AI Reels V2 PR-C: generate_reel_script — src/reel-script.js. Bu dosyada
// GEMINI_API_KEY process-wide TANIMLI (yukarıda, dosyanın başında) — bu
// yüzden generate_reel_script'in gerçek discovery/generation akışını
// ağ mock'u OLMADAN çağırmak GERÇEK bir Google isteği atardı. Bu yüzden
// burada SADECE confirmed:false yolu test edilir (hiçbir ağ çağrısı
// atmadan en baştan reddeder) — geri kalan tüm akış (provider/tier
// çözümleme, claims/sahne/narration doğrulaması, Veo/Lyria kısıtları)
// test/reel-script.test.js'te tamamen DI ile (ağdan bağımsız) test edildi.
test("generate_reel_script: confirmed:false ile hiçbir ağ isteği atmadan (productContext/discovery/generation) reddeder", async () => {
  await assert.rejects(
    () => callTool("generate_reel_script", { productUrl: "https://www.buzsu.com.tr/code-su-aritma-cihazi/", durationSeconds: 8, objective: "sales", provider: "auto", modelTier: "balanced", confirmed: false }),
    /confirmed:true/
  );
});

test("get_buzsu_product_context: exact XML feed + canonical sayfadan verifiedFacts üretir, hiçbir AI/paid API'ye gitmez", async () => {
  const originalFetch = global.fetch;
  const FEED_XML = `<rss xmlns:g="http://base.google.com/ns/1.0"><channel><item>
    <g:id>319</g:id><title>Code Su Arıtma Cihazı</title>
    <description>Code Su Arıtma Cihazı 3 kademeli filtre sistemi içerir.</description>
    <link>https://www.buzsu.com.tr/code-su-aritma-cihazi/</link>
    <g:image_link>https://www.buzsu.com.tr/code.png</g:image_link>
  </item></channel></rss>`;
  global.fetch = async (url) => {
    const href = String(url);
    if (href.includes("api.airtable.com")) return { ok: true, json: async () => ({ records: [] }) };
    if (href.includes("llms-full.txt")) return { ok: true, text: async () => "" };
    if (href.includes("feed.xml")) return { ok: true, text: async () => FEED_XML };
    if (href === "https://www.buzsu.com.tr/code-su-aritma-cihazi/") {
      return { ok: true, status: 200, headers: { get: () => null }, text: async () => '<meta name="description" content="Code canonical ürün sayfası açıklamasıdır.">' };
    }
    throw new Error(`Beklenmeyen (ücretli/AI olmayan bir kaynak dışı) fetch: ${href}`);
  };
  try {
    const result = JSON.parse(await callTool("get_buzsu_product_context", { productUrl: "https://www.buzsu.com.tr/code-su-aritma-cihazi/" }));
    assert.equal(result.ok, true);
    assert.equal(result.canonicalUrl, "https://www.buzsu.com.tr/code-su-aritma-cihazi/");
    assert.ok(result.verifiedFacts.length > 0);
    assert.equal(result.verifiedFacts[0].sourceUrl, "https://www.buzsu.com.tr/feed.xml");
    assert.ok(result.sourceUrls.includes("https://www.buzsu.com.tr/feed.xml"));
    assert.ok(result.sourceUrls.includes("https://www.buzsu.com.tr/code-su-aritma-cihazi/"));
    assert.equal(result.fromCache, false);
    assert.ok(Array.isArray(result.prohibitedClaims));
  } finally {
    global.fetch = originalFetch;
  }
});

// Bulunan aktarım hatası: get_omni_video_status önceki turda outputFileId'yi
// kabul etmiyor/geri döndürmüyordu — bu, MCP istemcisinin (dashboard değil,
// ChatGPT/Codex gibi bağlayıcılar) her sorguda gereksiz yere
// GET /interactions/{id}'ye düşmesine yol açıyordu. Bu test tam döngüyü
// (outputFileId ver -> yalnızca Files API çağrılsın -> PROCESSING'de
// outputFileId korunsun) doğruluyor.
test("get_omni_video_status: outputFileId verilirse yalnızca Files API'yi sorgular (GET /interactions/{id}'ye gitmez) ve PROCESSING'de outputFileId'yi yanıtta korur", async () => {
  const originalFetch = global.fetch;
  let requestedUrl = null;
  global.fetch = async (url) => {
    requestedUrl = String(url);
    return { ok: true, json: async () => ({ name: "files/out789", state: "PROCESSING" }) };
  };
  try {
    const text = await callTool("get_omni_video_status", { interactionId: "v1_xyz", outputFileId: "out789", model: "gemini-omni-1.1-flash" });
    assert.equal(requestedUrl, "https://generativelanguage.googleapis.com/v1beta/files/out789");
    const parsed = JSON.parse(text);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.status, "OUTPUT_PROCESSING");
    assert.equal(parsed.outputFileId, "out789"); // korunmalı — aksi halde bir sonraki çağrı bunu kaybeder
  } finally {
    global.fetch = originalFetch;
  }
});

// generate_gemini_video: submitOmniVideoGeneration'ın AYNI confirmed:true
// kuralı, MCP tool seviyesinde de zorunlu (generate_omni_video_edit'in
// yukarıdaki testiyle aynı desen).
test("generate_gemini_video confirmed:false ile hiçbir ağ isteği atmadan reddeder", async () => {
  const originalFetch = global.fetch;
  let calls = 0;
  global.fetch = async () => { calls++; throw new Error("fetch should not be called without confirmed:true"); };
  try {
    await assert.rejects(
      () => callTool("generate_gemini_video", { prompt: "bir sahne", confirmed: false }),
      /confirmed:true/
    );
    assert.equal(calls, 0);
  } finally {
    global.fetch = originalFetch;
  }
});

// "selected model omni -> yalnız Omni akışı çağrılır": generate_gemini_video
// SADECE /v1beta/interactions'a gider — Veo'nun :predictLongRunning
// endpoint'ine veya fal.ai'ye ASLA istek atmaz.
test("generate_gemini_video only calls the Omni Interactions API, never Veo or fal.ai, and returns the model name explicitly", async () => {
  const originalFetch = global.fetch;
  const calledUrls = [];
  global.fetch = async (url) => {
    calledUrls.push(String(url));
    return { ok: true, json: async () => ({ id: "v1_gen_mcp", steps: [{ type: "model_output", content: [{ type: "video", uri: "https://generativelanguage.googleapis.com/v1beta/files/out1:download?alt=media", mime_type: "video/mp4" }] }] }) };
  };
  try {
    const text = await callTool("generate_gemini_video", { prompt: "mutfakta su içen bir aile", confirmed: true });
    const parsed = JSON.parse(text);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.model, "gemini-omni-1.1-flash");
    assert.equal(parsed.interactionId, "v1_gen_mcp");
    assert.ok(calledUrls.every((u) => u.includes("generativelanguage.googleapis.com")));
    assert.ok(!calledUrls.some((u) => u.includes("predictLongRunning")));
    assert.ok(!calledUrls.some((u) => u.includes("fal.run")));
  } finally {
    global.fetch = originalFetch;
  }
});

test("get_gemini_video_status: outputFileId verilirse yalnızca Files API'yi sorgular (get_omni_video_status ile aynı mekanizma)", async () => {
  const originalFetch = global.fetch;
  let requestedUrl = null;
  global.fetch = async (url) => {
    requestedUrl = String(url);
    return { ok: true, json: async () => ({ name: "files/out789", state: "PROCESSING" }) };
  };
  try {
    const text = await callTool("get_gemini_video_status", { interactionId: "v1_gen_mcp", outputFileId: "out789", model: "gemini-omni-1.1-flash" });
    assert.equal(requestedUrl, "https://generativelanguage.googleapis.com/v1beta/files/out789");
    const parsed = JSON.parse(text);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.status, "OUTPUT_PROCESSING");
    assert.equal(parsed.outputFileId, "out789");
  } finally {
    global.fetch = originalFetch;
  }
});

// HEDEF 2/3/7: "seçilen model X -> yalnız X çağrılır, sessiz fallback yok".
// Her tier/alias, :predictLongRunning URL'inde TAM OLARAK kendi model ID'sini
// taşıyor mu diye doğrular; başka bir model asla denenmez.
for (const [label, requestedModel, expectedModelId] of [
  ["veo-3.1-lite alias", "veo-3.1-lite", "veo-3.1-lite-generate-preview"],
  ["veo-3.1-fast alias", "veo-3.1-fast", "veo-3.1-fast-generate-preview"],
  ["veo-3.1-generate alias", "veo-3.1-generate", "veo-3.1-generate-preview"],
  ["economy tier name", "economy", "veo-3.1-lite-generate-preview"],
  ["fast tier name", "fast", "veo-3.1-fast-generate-preview"],
  ["quality tier name", "quality", "veo-3.1-generate-preview"]
]) {
  test(`generate_video_clip with model:"${requestedModel}" (${label}) calls exactly ${expectedModelId} and no other model`, async () => {
    const originalFetch = global.fetch;
    const calledUrls = [];
    global.fetch = async (url, options) => {
      const href = String(url);
      calledUrls.push(href);
      if (!options) return { ok: true, headers: { get: () => "image/jpeg" }, arrayBuffer: async () => new Uint8Array([1]).buffer };
      return { ok: true, json: async () => ({ name: "operations/op1" }) };
    };
    try {
      const text = await callTool("generate_video_clip", { imageUrl: "https://example.com/x.jpg", prompt: "p", confirmed: true, model: requestedModel });
      const parsed = JSON.parse(text);
      assert.equal(parsed.model, expectedModelId);
      const predictCalls = calledUrls.filter((u) => u.includes(":predictLongRunning"));
      assert.equal(predictCalls.length, 1);
      assert.ok(predictCalls[0].includes(`/models/${expectedModelId}:predictLongRunning`));
    } finally {
      global.fetch = originalFetch;
    }
  });
}

// Seçilen model başarısız olursa (429/kota) başka bir modele (örn. economy)
// ASLA otomatik geçilmez — tek bir çağrı yapılır, hata olduğu gibi
// (alternatives bilgi amaçlı) döner.
test("generate_video_clip does not silently retry with a different model when the selected one fails", async () => {
  const originalFetch = global.fetch;
  const predictModelUrls = [];
  global.fetch = async (url, options) => {
    const href = String(url);
    if (!options) return { ok: true, headers: { get: () => "image/jpeg" }, arrayBuffer: async () => new Uint8Array([1]).buffer };
    if (href.includes(":predictLongRunning")) {
      predictModelUrls.push(href);
      return { ok: false, status: 429, headers: { get: () => null }, json: async () => ({ error: { message: "quota exceeded", status: "RESOURCE_EXHAUSTED", details: [] } }) };
    }
    throw new Error(`Beklenmeyen fetch: ${href}`);
  };
  try {
    await assert.rejects(() => callTool("generate_video_clip", { imageUrl: "https://example.com/x.jpg", prompt: "p", confirmed: true, model: "veo-3.1-generate" }));
    assert.equal(predictModelUrls.length, 1);
    assert.ok(predictModelUrls[0].includes("/models/veo-3.1-generate-preview:predictLongRunning"));
  } finally {
    global.fetch = originalFetch;
  }
});

// DÜZELTME (2. tur): veo-3.0-generate-001/veo-3.0-fast-generate-001, Google
// tarafından 30 Haziran 2026'da kapatıldı — bu yüzden "veo-3-generate"/
// "veo-3-fast"/"veo-3-lite" artık AKTİF bir modele çözülmez, hiçbir ağ
// isteği (Veo'ya veya başka bir modele) ASLA atılmaz; sessizce Veo 3.1'e de
// düşülmez, açık ve yönlendirici bir hata döner.
for (const deprecatedModel of ["veo-3-generate", "veo-3-fast", "veo-3-lite", "veo-3.0-generate-001", "veo-3.0-fast-generate-001"]) {
  test(`generate_video_clip with model:"${deprecatedModel}" (deprecated Veo 3 GA, shut down 2026-06-30) rejects before any network call — never falls back to Veo 3.1`, async () => {
    const originalFetch = global.fetch;
    let calls = 0;
    global.fetch = async () => { calls++; throw new Error("fetch should not be called for a deprecated model"); };
    try {
      await assert.rejects(
        () => callTool("generate_video_clip", { imageUrl: "https://example.com/x.jpg", prompt: "p", confirmed: true, model: deprecatedModel }),
        /30 Haziran 2026/
      );
      assert.equal(calls, 0);
    } finally {
      global.fetch = originalFetch;
    }
  });
}

test("generate_video_clip with model:\"veo-3.1-generate\" (the only ACTIVE Veo family) never calls a veo-3.0 URL", async () => {
  const originalFetch = global.fetch;
  const calledUrls = [];
  global.fetch = async (url, options) => {
    const href = String(url);
    calledUrls.push(href);
    if (!options) return { ok: true, headers: { get: () => "image/jpeg" }, arrayBuffer: async () => new Uint8Array([1]).buffer };
    return { ok: true, json: async () => ({ name: "operations/op-v31" }) };
  };
  try {
    await callTool("generate_video_clip", { imageUrl: "https://example.com/x.jpg", prompt: "p", confirmed: true, model: "veo-3.1-generate" });
    assert.ok(!calledUrls.some((u) => u.includes("veo-3.0")));
  } finally {
    global.fetch = originalFetch;
  }
});

// BLOB_READ_WRITE_TOKEN gerektiren gerçek Blob upload akışı burada
// KASITLI olarak test edilmiyor — bu depodaki hiçbir test @vercel/blob'un
// put() fonksiyonunu mock'lamıyor (modül mock altyapısı yok); bir token
// verip gerçek bir ağ isteği tetiklemek "gerçek ücretli/ağ çağrısı yapılmaz"
// ilkesini ihlal ederdi. ACTIVE durumundaki dosyanın doğru URL'den doğru
// şekilde indirildiği (downloadOmniVideo) zaten src/omni-video.js ve
// api/omni-video.js testlerinde ayrı ayrı doğrulanıyor; burada yalnızca
// MCP'ye özgü outputFileId aktarım hatası (asıl bulunan sorun) test edilir.
test("tools/call: code'u olmayan (mevcut/genel) bir hata hâlâ düz \"Hata: ...\" metni döner (regresyon — davranış bozulmadı)", async () => {
  const response = await handleMessage({ id: 1, method: "tools/call", params: { name: "get_draft", arguments: {} } });
  assert.equal(response.result.isError, true);
  assert.match(response.result.content[0].text, /^Hata: /);
  assert.throws(() => JSON.parse(response.result.content[0].text), "düz metin JSON olarak parse edilemez, bu beklenen davranış");
});

// PR #74 inceleme bulgusu: eski koşul (`typeof error.code === "string"`)
// RATE_LIMITED/VeoApiError DIŞINDAKİ, ama yine de bir .code taşıyan Node/ağ
// hatalarını (ör. ECONNRESET, ENOTFOUND, Blob SDK hataları) da yanlışlıkla
// JSON'a çeviriyordu. Burada get_draft'ın kendi fetch çağrısı, .code
// taşıyan ama RATE_LIMITED OLMAYAN sıradan bir hata fırlatıyor — sonuç hâlâ
// düz "Hata: ..." metni olmalı.
test("tools/call: RATE_LIMITED olmayan ama yine de .code taşıyan sıradan bir hata (ör. ECONNRESET) hâlâ düz \"Hata: ...\" metni döner (dar kapsam regresyonu)", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => {
    const error = new Error("network is down");
    error.code = "ECONNRESET";
    throw error;
  };
  try {
    const response = await handleMessage({ id: 1, method: "tools/call", params: { name: "get_draft", arguments: { recordId: "recX" } } });
    assert.equal(response.result.isError, true);
    assert.equal(response.result.content[0].text, "Hata: network is down");
    assert.throws(() => JSON.parse(response.result.content[0].text));
  } finally {
    global.fetch = originalFetch;
  }
});

// generate_nano_banana_scene: Nano Banana 2 + Veo iki-aşamalı akışın 1.
// aşaması. Bu tool YALNIZCA görsel üretir; Veo/Omni'ye hiçbir koşulda
// otomatik geçmez (bkz. src/nano-banana-scene.js).
test("generate_nano_banana_scene: confirmed:false rejects before any network call", async () => {
  const originalFetch = global.fetch;
  let called = false;
  global.fetch = async () => { called = true; throw new Error("must not be called"); };
  try {
    await assert.rejects(
      () => callTool("generate_nano_banana_scene", { prompt: "mutfak sahnesi", confirmed: false }),
      /confirmed:true/
    );
    assert.equal(called, false);
  } finally {
    global.fetch = originalFetch;
  }
});

test("generate_nano_banana_scene: zero-shot (no productId) calls exactly the Nano Banana 2 model and never a Veo/Omni endpoint", async () => {
  const originalFetch = global.fetch;
  const calledUrls = [];
  global.fetch = async (url) => {
    const href = String(url);
    calledUrls.push(href);
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ inlineData: { data: "AAAA" } }] } }] }) };
  };
  try {
    const text = await callTool("generate_nano_banana_scene", { prompt: "sıfırdan modern bir mutfak sahnesi", aspectRatio: "9:16", confirmed: true });
    const parsed = JSON.parse(text);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.mode, "zero-shot");
    assert.equal(parsed.model, "gemini-3.1-flash-image");
    assert.equal(parsed.provider, "nano-banana-2");
    assert.equal(parsed.needsReview, false);
    assert.equal(calledUrls.length, 1);
    assert.ok(calledUrls[0].includes("models/gemini-3.1-flash-image:generateContent"));
    for (const url of calledUrls) {
      assert.ok(!url.includes("predictLongRunning"), `unexpected Veo call: ${url}`);
      assert.ok(!/interactions/i.test(url), `unexpected Omni call: ${url}`);
    }
  } finally {
    global.fetch = originalFetch;
  }
});

test("generate_nano_banana_scene: product-reference mode (productId given) resolves the product, calls Nano Banana 2, and surfaces needsReview from the existing scene-validation system", async () => {
  process.env.AIRTABLE_TOKEN = "test-token";
  const originalFetch = global.fetch;
  const tinyPng = await sharp({ create: { width: 4, height: 4, channels: 3, background: { r: 255, g: 255, b: 255 } } }).png().toBuffer();
  global.fetch = async (url, options) => {
    const href = String(url);
    if (href.includes("api.airtable.com")) {
      return { ok: true, json: async () => ({ records: [{ id: "recTEST123", fields: { "Başlık": "Buzsu Ultramag", "Görsel URL": "https://example.com/photo.png" } }] }) };
    }
    if (href.includes("example.com")) {
      return { ok: true, arrayBuffer: async () => tinyPng };
    }
    const body = JSON.parse(options.body);
    if (body.generationConfig?.responseMimeType === "application/json") {
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ failedChecks: ["fabricated_signage"], notes: "uydurma tabela" }) }] } }] }) };
    }
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ inlineData: { data: "AAAA" } }] } }] }) };
  };
  try {
    const text = await callTool("generate_nano_banana_scene", { productId: "recTEST123", prompt: "dış cephe montajı", confirmed: true });
    const parsed = JSON.parse(text);
    assert.equal(parsed.mode, "product-reference");
    assert.equal(parsed.model, "gemini-3.1-flash-image");
    assert.equal(parsed.needsReview, true);
    assert.deepEqual(parsed.failedChecks, ["fabricated_signage"]);
  } finally {
    global.fetch = originalFetch;
    delete process.env.AIRTABLE_TOKEN;
  }
});

// TASK-001 (research_web): api/mcp.js'e minimum entegrasyon — asıl
// provider/normalize testleri test/research-*.test.js'te (owns). Burada
// yalnız tool'un TOOLS listesinde göründüğü ve callTool'un researchWeb'i
// gerçekten çağırdığı doğrulanır.
test("tools/list: research_web tool listesinde 'query' + 'confirmed' zorunlu, 'provider'/'urls' isteğe bağlı olarak yer alır", async () => {
  const response = await handleMessage({ id: 1, method: "tools/list" });
  const tool = response.result.tools.find((t) => t.name === "research_web");
  assert.ok(tool, "research_web tools/list içinde bulunamadı");
  assert.deepEqual(tool.inputSchema.required, ["query", "confirmed"]);
  assert.deepEqual(tool.inputSchema.properties.provider.enum, ["auto", "google", "openai"]);
});

test("research_web: confirmed:true olmadan provider çağrısı yapılmaz", async () => {
  let called = false;
  const originalFetch = global.fetch;
  global.fetch = async () => { called = true; throw new Error("çağrılmamalıydı"); };
  try {
    const response = await handleMessage({ id: 1, method: "tools/call", params: { name: "research_web", arguments: { query: "test", provider: "google" } } });
    assert.equal(response.result.isError, true);
    assert.match(response.result.content[0].text, /confirmed:true/);
    assert.equal(called, false);
  } finally {
    global.fetch = originalFetch;
  }
});

test("research_web: provider='google' ile researchWeb'i çağırır, normalize edilmiş sources döner", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    json: async () => ({ candidates: [{ content: { parts: [{ text: "Cevap metni." }] }, groundingMetadata: { groundingChunks: [{ web: { uri: "https://example.com/a", title: "A" } }] } }] })
  });
  try {
    const text = await callTool("research_web", { query: "buzsu su arıtma güncel fiyat", provider: "google", confirmed: true });
    const parsed = JSON.parse(text);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.provider, "google");
    assert.equal(parsed.answer, "Cevap metni.");
    assert.deepEqual(parsed.sources, [{ url: "https://example.com/a", title: "A", snippet: "", provider: "google" }]);
  } finally {
    global.fetch = originalFetch;
  }
});

test("research_web: provider='openai' ama OPENAI_API_KEY yoksa google'a SESSİZCE geçmez, isError:true ile hata döner", async () => {
  const originalOpenAiKey = process.env.OPENAI_API_KEY;
  const originalOpenAiImageKey = process.env.OPENAI_IMAGE_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_IMAGE_API_KEY;
  const originalFetch = global.fetch;
  let googleCalled = false;
  global.fetch = async (url) => { if (String(url).includes("generativelanguage")) googleCalled = true; throw new Error("çağrılmamalıydı"); };
  try {
    const response = await handleMessage({ id: 1, method: "tools/call", params: { name: "research_web", arguments: { query: "test", provider: "openai", confirmed: true } } });
    assert.equal(response.result.isError, true);
    assert.match(response.result.content[0].text, /missing_api_key/);
    assert.equal(googleCalled, false);
  } finally {
    global.fetch = originalFetch;
    if (originalOpenAiKey !== undefined) process.env.OPENAI_API_KEY = originalOpenAiKey;
    if (originalOpenAiImageKey !== undefined) process.env.OPENAI_IMAGE_API_KEY = originalOpenAiImageKey;
  }
});

test("generate_reel_script: researchMode verilmezse research_web'e istek atmadan senaryo üretir (varsayılan davranış değişmedi)", async () => {
  process.env.AIRTABLE_TOKEN = "test-token";
  process.env.GOOGLE_CREATIVE_BALANCED_MODEL = "gemini-3.5-flash";
  const originalFetch = global.fetch;
  global.fetch = async (url, options) => {
    const href = String(url);
    if (href.includes("api.airtable.com")) return { ok: true, json: async () => ({ records: [] }) };
    if (href.includes("buzsu.com.tr")) return { ok: true, text: async () => "<html></html>" };
    if (href.includes("generativelanguage")) {
      // discoverCreativeModels: GET /v1beta/models (istek gövdesi yok) —
      // generateContent (POST, gövdeli) çağrısından body varlığıyla ayırt edilir.
      if (!options?.body) return { ok: true, json: async () => ({ models: [{ name: "models/gemini-3.5-flash", displayName: "Gemini 3.5 Flash", supportedGenerationMethods: ["generateContent"] }] }) };
      const body = JSON.parse(options.body);
      if (body.tools) throw new Error("research_web çağrılmamalıydı (researchMode='none')");
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({
        title: "t", concept: "c", hook: "h", creativeDirection: "d",
        scenes: [{ sceneId: "s1", startSeconds: 0, endSeconds: 8, purpose: "p", visualDescription: "v", action: "a", camera: "c", productVisibility: "hero", referenceImageRequired: false, veoPrompt: "A scene.", narrationText: "n", onScreenText: "", transition: "cut" }],
        fullNarrationText: "n", musicBrief: { mood: "m", energy: "orta", tempo: "orta", instruments: [], lyriaPrompt: "Instrumental" },
        claimsUsed: [], negativeConstraints: [], warnings: []
      }) }] } }] }) };
    }
    throw new Error("beklenmeyen fetch: " + href);
  };
  try {
    const text = await callTool("generate_reel_script", {
      productUrl: "https://www.buzsu.com.tr/test-urun/", durationSeconds: 8, objective: "sales", aspectRatio: "9:16",
      provider: "google", modelTier: "balanced", confirmed: true
    });
    const parsed = JSON.parse(text);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.researchMode, "none");
    assert.equal(parsed.research, null);
  } finally {
    global.fetch = originalFetch;
    delete process.env.AIRTABLE_TOKEN;
    delete process.env.GOOGLE_CREATIVE_BALANCED_MODEL;
  }
});

// TASK-002 (transcribe_media): api/mcp.js'e minimum entegrasyon — asıl
// provider/normalize testleri test/transcription*.test.js'te (owns). Burada
// yalnız tool'un TOOLS listesinde göründüğü ve callTool'un transcribeMedia'yı
// gerçekten çağırdığı doğrulanır.
test("tools/list: transcribe_media tool listesinde 'mediaUrl' + 'confirmed' zorunlu, diğerleri isteğe bağlı olarak yer alır", async () => {
  const response = await handleMessage({ id: 1, method: "tools/list" });
  const tool = response.result.tools.find((t) => t.name === "transcribe_media");
  assert.ok(tool, "transcribe_media tools/list içinde bulunamadı");
  assert.deepEqual(tool.inputSchema.required, ["mediaUrl", "confirmed"]);
  assert.deepEqual(tool.inputSchema.properties.provider.enum, ["auto", "google", "openai"]);
});

test("transcribe_media: confirmed:true olmadan hiçbir sağlayıcıya istek atılmaz", async () => {
  const originalFetch = global.fetch;
  let called = false;
  global.fetch = async () => { called = true; throw new Error("çağrılmamalıydı"); };
  try {
    const response = await handleMessage({ id: 1, method: "tools/call", params: { name: "transcribe_media", arguments: { mediaUrl: "https://example.com/a.mp3", provider: "openai" } } });
    assert.equal(response.result.isError, true);
    assert.match(response.result.content[0].text, /confirmed:true/);
    assert.equal(called, false);
  } finally {
    global.fetch = originalFetch;
  }
});

test("transcribe_media: provider='openai' ile transcribeMedia'yı çağırır (gerçek /v1/models discovery dahil), normalize edilmiş segments döner", async () => {
  const originalFetch = global.fetch;
  const originalOpenAiKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-openai-key";
  global.fetch = async (url) => {
    const href = String(url);
    if (href.includes("/v1/models")) return { ok: true, json: async () => ({ data: [{ id: "whisper-1" }] }) };
    if (href.includes("/v1/audio/transcriptions")) return { ok: true, json: async () => ({ text: "Merhaba dünya.", language: "turkish", segments: [{ start: 0, end: 2, text: "Merhaba dünya." }] }) };
    return { ok: true, headers: { get: () => "audio/mpeg" }, arrayBuffer: async () => new ArrayBuffer(8) };
  };
  try {
    // 93.184.216.34: IP-literal (example.com'un GERÇEK adresi) — fetchMediaBytes
    // artık SSRF koruması için gerçek dns.lookup çağırıyor (bkz. media-fetch.js
    // ROOT review fix'i); testin gerçek DNS'e bağımlı olmaması için bir
    // hostname değil doğrudan IP-literal kullanılıyor (private-IP kontrolü
    // DNS'siz, senkron çalışır).
    const text = await callTool("transcribe_media", { mediaUrl: "https://93.184.216.34/a.mp3", provider: "openai", confirmed: true });
    const parsed = JSON.parse(text);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.provider, "openai");
    assert.equal(parsed.modelUsed, "whisper-1");
    assert.equal(parsed.text, "Merhaba dünya.");
    assert.deepEqual(parsed.segments, [{ startSeconds: 0, endSeconds: 2, text: "Merhaba dünya.", speaker: null }]);
  } finally {
    global.fetch = originalFetch;
    if (originalOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalOpenAiKey;
  }
});

test("transcribe_media: diarization:true + whisper-1 override (discovery diarization desteklemediğini doğrular) SESSİZCE yok sayılmaz, isError:true ile açık bir hata döner", async () => {
  const originalFetch = global.fetch;
  const originalOpenAiKey = process.env.OPENAI_API_KEY;
  const originalModel = process.env.OPENAI_TRANSCRIBE_MODEL;
  process.env.OPENAI_API_KEY = "test-openai-key";
  process.env.OPENAI_TRANSCRIBE_MODEL = "whisper-1";
  let transcribeCalled = false;
  global.fetch = async (url) => {
    const href = String(url);
    if (href.includes("/v1/models")) return { ok: true, json: async () => ({ data: [{ id: "whisper-1" }] }) };
    // GEMINI_API_KEY dosya başında (process.env.GEMINI_API_KEY = ... || "test-gemini-key")
    // her testte set edildiği için discoverTranscriptionModels her zaman Google'ı da
    // sorgular — burada zararsız bir discovery yanıtı döndürülür, gerçek transkripsiyon
    // çağrısıyla karıştırılmaz.
    if (href.includes("generativelanguage")) return { ok: true, json: async () => ({ models: [] }) };
    transcribeCalled = true;
    throw new Error("çağrılmamalıydı");
  };
  try {
    const response = await handleMessage({ id: 1, method: "tools/call", params: { name: "transcribe_media", arguments: { mediaUrl: "https://93.184.216.34/a.mp3", provider: "openai", diarization: true, confirmed: true } } });
    assert.equal(response.result.isError, true);
    assert.match(response.result.content[0].text, /diarization_not_supported/);
    assert.equal(transcribeCalled, false);
  } finally {
    global.fetch = originalFetch;
    if (originalOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalOpenAiKey;
    if (originalModel === undefined) delete process.env.OPENAI_TRANSCRIBE_MODEL;
    else process.env.OPENAI_TRANSCRIBE_MODEL = originalModel;
  }
});

// TASK-003 (generate_scene_image tiers): api/mcp.js'e minimum entegrasyon —
// asıl provider/discovery/tier testleri test/scene-image.test.js ve
// test/video-provider-capabilities.test.js'te (owns). Burada yalnız yeni
// tier değerlerinin tools/list'te göründüğü ve callTool'un discovery-gating'i
// gerçekten uyguladığı doğrulanır.
test("tools/list: generate_scene_image provider enum'ı economy/balanced/quality tier'larının tümünü (nano-banana-pro, openai-high dahil) içerir", async () => {
  const response = await handleMessage({ id: 1, method: "tools/list" });
  const tool = response.result.tools.find((t) => t.name === "generate_scene_image");
  assert.ok(tool, "generate_scene_image tools/list içinde bulunamadı");
  assert.deepEqual(tool.inputSchema.properties.provider.enum, ["gemini", "nano-banana-2", "nano-banana-pro", "openai", "openai-low", "openai-high", "composite"]);
});

test("generate_scene_image: provider='nano-banana-pro' gerçek discovery'de bulunamazsa SESSİZCE nano-banana-2'ye düşmez, isError:true ile açık bir hata döner", async () => {
  process.env.AIRTABLE_TOKEN = "test-token";
  const originalFetch = global.fetch;
  let generateContentCalled = false;
  global.fetch = async (url) => {
    const href = String(url);
    if (href.includes("api.airtable.com")) return { ok: true, json: async () => ({ records: [{ id: "recTEST123", fields: { "Başlık": "Buzsu Ultramag", "Görsel URL": "https://example.com/photo.png" } }] }) };
    if (href.includes("example.com")) return { ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer };
    if (href.includes("generativelanguage.googleapis.com/v1beta/models") && !href.includes("generateContent")) {
      // discovery gerçekten çalışıyor ama Nano Banana Pro listede YOK.
      return { ok: true, json: async () => ({ models: [{ name: "models/gemini-3.1-flash-image" }] }) };
    }
    if (href.includes("generateContent")) { generateContentCalled = true; throw new Error("çağrılmamalıydı"); }
    throw new Error("beklenmeyen fetch: " + href);
  };
  try {
    const response = await handleMessage({ id: 1, method: "tools/call", params: { name: "generate_scene_image", arguments: { productId: "recTEST123", sceneDescription: "mutfak", provider: "nano-banana-pro" } } });
    assert.equal(response.result.isError, true);
    assert.match(response.result.content[0].text, /Nano Banana Pro/);
    assert.equal(generateContentCalled, false);
  } finally {
    global.fetch = originalFetch;
    delete process.env.AIRTABLE_TOKEN;
  }
});

// TASK-003 (PR #102 ROOT review, blocker 2): generate_scene_image
// provider='composite' MCP üzerinden generateSceneImage'a değil (o zaten
// "composite"yi reddeder), generateCompositeSceneImage'a yönlendirilmeli —
// asıl composite mantığının testleri test/scene-composite.test.js'te (owns).
function makeOffWhiteProductPhoto(size = 64, bg = 224) {
  const raw = Buffer.alloc(size * size * 3, bg);
  for (let y = 20; y < 44; y++) {
    for (let x = 20; x < 44; x++) {
      const o = (y * size + x) * 3;
      raw[o] = 10; raw[o + 1] = 20; raw[o + 2] = 200;
    }
  }
  return sharp(raw, { raw: { width: size, height: size, channels: 3 } }).png().toBuffer();
}

test("generate_scene_image: provider='composite' generateCompositeSceneImage'a yönlendirilir, generateSceneImage'ın 'Desteklenmeyen sahne üretim sağlayıcısı.' hatasına düşmez", async () => {
  process.env.AIRTABLE_TOKEN = "test-token";
  const originalFetch = global.fetch;
  const productPhoto = await makeOffWhiteProductPhoto();
  const backgroundPhoto = await sharp(Buffer.alloc(64 * 64 * 3, 200), { raw: { width: 64, height: 64, channels: 3 } }).png().toBuffer();
  global.fetch = async (url, options) => {
    const href = String(url);
    if (href.includes("api.airtable.com")) return { ok: true, json: async () => ({ records: [{ id: "recTEST123", fields: { "Başlık": "Test Ürün", "Görsel URL": "https://example.com/photo.png" } }] }) };
    if (href.includes("example.com")) return { ok: true, arrayBuffer: async () => productPhoto };
    if (href.includes("generativelanguage.googleapis.com")) {
      const body = JSON.parse(options.body);
      if (body.generationConfig?.responseMimeType === "application/json") {
        // validateSceneImage'ın otomatik inceleme çağrısı.
        return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ failedChecks: [], notes: "" }) }] } }] }) };
      }
      // generateCompositeSceneImage'ın arka plan üretim çağrısı.
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ inlineData: { data: backgroundPhoto.toString("base64") } }] } }] }) };
    }
    throw new Error("beklenmeyen fetch: " + href);
  };
  try {
    const text = await callTool("generate_scene_image", { productId: "recTEST123", sceneDescription: "mutfak", provider: "composite", brand: false });
    const parsed = JSON.parse(text);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.provider, "composite");
  } finally {
    global.fetch = originalFetch;
    delete process.env.AIRTABLE_TOKEN;
  }
});

// TASK-004 (validate_product_visual): api/mcp.js'e minimum entegrasyon —
// asıl karşılaştırma/normalize/prompt testleri test/visual-validation*.test.js'te
// (owns). Burada yalnız tool'un TOOLS listesinde göründüğü ve callTool'un
// validateProductVisual'ı gerçekten çağırdığı (confirmed gate dahil) doğrulanır.
test("tools/list: validate_product_visual tool listesinde 'referenceImageUrl' + 'confirmed' zorunlu, generatedImageUrl/generatedImageBase64 isteğe bağlı olarak yer alır", async () => {
  const response = await handleMessage({ id: 1, method: "tools/list" });
  const tool = response.result.tools.find((t) => t.name === "validate_product_visual");
  assert.ok(tool, "validate_product_visual tools/list içinde bulunamadı");
  assert.deepEqual(tool.inputSchema.required, ["referenceImageUrl", "confirmed"]);
  assert.ok(!tool.inputSchema.required.includes("generatedImageUrl"));
  assert.ok(!tool.inputSchema.required.includes("generatedImageBase64"));
  assert.deepEqual(tool.inputSchema.properties.generatedImageMimeType.enum, ["image/png", "image/jpeg", "image/webp"]);
});

test("validate_product_visual: confirmed:true olmadan hiçbir görsel indirilmez/Gemini'ye istek atılmaz", async () => {
  const originalFetch = global.fetch;
  let called = false;
  global.fetch = async () => { called = true; throw new Error("çağrılmamalıydı"); };
  try {
    const response = await handleMessage({
      id: 1,
      method: "tools/call",
      params: { name: "validate_product_visual", arguments: { referenceImageUrl: "https://93.184.216.34/ref.png", generatedImageUrl: "https://93.184.216.34/gen.png" } }
    });
    assert.equal(response.result.isError, true);
    assert.match(response.result.content[0].text, /confirmed:true/);
    assert.equal(called, false);
  } finally {
    global.fetch = originalFetch;
  }
});

test("validate_product_visual: confirmed:true ile referans+üretilen görseli indirir, Gemini karşılaştırmasını çağırır ve normalize edilmiş failedChecks döner", async () => {
  const originalFetch = global.fetch;
  const originalGeminiKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = "test-gemini-key";
  const referenceBytes = new Uint8Array([1, 2, 3, 4]).buffer;
  const generatedBytes = new Uint8Array([5, 6, 7, 8]).buffer;
  const fakeImageResponse = (buffer) => ({
    ok: true,
    status: 200,
    headers: { get: (name) => (name === "content-type" ? "image/png" : name === "content-length" ? "4" : null) },
    arrayBuffer: async () => buffer
  });
  let generateContentCalled = false;
  global.fetch = async (url) => {
    const href = String(url);
    if (href.includes("ref.png")) return fakeImageResponse(referenceBytes);
    if (href.includes("gen.png")) return fakeImageResponse(generatedBytes);
    if (href.includes("generateContent")) {
      generateContentCalled = true;
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ failedChecks: ["logo"], notes: "Logo farklı." }) }] } }] }) };
    }
    throw new Error("beklenmeyen fetch: " + href);
  };
  try {
    const text = await callTool("validate_product_visual", {
      referenceImageUrl: "https://93.184.216.34/ref.png",
      generatedImageUrl: "https://93.184.216.34/gen.png",
      productTitle: "UltraMag",
      confirmed: true
    });
    const parsed = JSON.parse(text);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.passed, false);
    assert.equal(parsed.needsReview, true);
    assert.deepEqual(parsed.failedChecks, ["logo"]);
    assert.equal(parsed.notes, "Logo farklı.");
    assert.deepEqual([...parsed.checks].sort(), ["component_count", "fabricated_text", "identity", "installation", "label", "logo", "proportions"]);
    assert.equal(generateContentCalled, true);
  } finally {
    global.fetch = originalFetch;
    if (originalGeminiKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalGeminiKey;
  }
});


// TASK-005: video-to-image MCP sözleşmesi — ücretli çağrı confirmed:true ile gated.
test("tools/list: generate_image_from_video exposes official models and confirmed gate", async () => {
  const response = await handleMessage({ id: 1, method: "tools/list" });
  const tool = response.result.tools.find((t) => t.name === "generate_image_from_video");
  assert.ok(tool);
  assert.deepEqual(tool.inputSchema.required, ["videoUrl", "prompt", "confirmed"]);
  assert.deepEqual(tool.inputSchema.properties.model.enum, ["gemini-3.1-flash-lite-image", "gemini-3.1-flash-image"]);
  assert.deepEqual(tool.inputSchema.properties.aspectRatio.enum, ["9:16", "1:1", "16:9"]);
});

test("generate_image_from_video: confirmed:true olmadan ücretli çağrı başlamaz", async () => {
  const originalFetch = global.fetch;
  let called = false;
  global.fetch = async () => { called = true; throw new Error("çağrılmamalıydı"); };
  try {
    const response = await handleMessage({
      id: 1,
      method: "tools/call",
      params: { name: "generate_image_from_video", arguments: { videoUrl: "https://youtu.be/abc", prompt: "poster" } }
    });
    assert.equal(response.result.isError, true);
    assert.match(response.result.content[0].text, /confirmed:true/);
    assert.equal(called, false);
  } finally {
    global.fetch = originalFetch;
  }
});


// TASK-006: Product Knowledge MCP sözleşmesi.
test("tools/list: search_product_knowledge exposes provider choices and confirmed gate", async () => {
  const response = await handleMessage({ id: 1, method: "tools/list" });
  const tool = response.result.tools.find((t) => t.name === "search_product_knowledge");
  assert.ok(tool);
  assert.deepEqual(tool.inputSchema.required, ["query", "confirmed"]);
  assert.deepEqual(tool.inputSchema.properties.provider.enum, ["auto", "google", "openai"]);
  assert.match(tool.description, /airtable > buzsu_official > file_search/);
  assert.match(tool.description, /conflicts/);
});

test("search_product_knowledge: confirmed:true olmadan hiçbir provider çağrısı başlamaz", async () => {
  const originalFetch = global.fetch;
  let called = false;
  global.fetch = async () => { called = true; throw new Error("çağrılmamalıydı"); };
  try {
    const response = await handleMessage({
      id: 1,
      method: "tools/call",
      params: { name: "search_product_knowledge", arguments: { productId: "recTEST", query: "özellikler" } }
    });
    assert.equal(response.result.isError, true);
    assert.match(response.result.content[0].text, /confirmed:true/);
    assert.equal(called, false);
  } finally {
    global.fetch = originalFetch;
  }
});

// TASK-007 (run_agent_orchestration): api/mcp.js'e minimum entegrasyon —
// asıl state machine/registry/validation testleri test/orchestrator*.test.js'te
// (owns). Burada yalnız tool'un TOOLS listesinde göründüğü, mevcut tool'ları
// BOZMADIĞI ve callTool'un runOrchestration'ı gerçekten çağırdığı doğrulanır.
test("tools/list: run_agent_orchestration tool listesinde 'steps' zorunlu olarak yer alır, capability enum'ı sabit TASK-001..006+READ listesidir, ve MEVCUT tool sayısı/adları BOZULMAMIŞTIR", async () => {
  const response = await handleMessage({ id: 1, method: "tools/list" });
  const tools = response.result.tools;
  const tool = tools.find((t) => t.name === "run_agent_orchestration");
  assert.ok(tool, "run_agent_orchestration tools/list içinde bulunamadı");
  assert.deepEqual(tool.inputSchema.required, ["steps"]);
  assert.deepEqual(tool.inputSchema.properties.steps.items.properties.capability.enum, [
    "list_products",
    "get_buzsu_product_context",
    "research_web",
    "transcribe_media",
    "generate_scene_image",
    "validate_product_visual",
    "generate_image_from_video",
    "search_product_knowledge"
  ]);
  // Mevcut MCP tool'ları (TASK-001..006 dahil) hâlâ hepsi orada — yeni tool
  // sadece EKLENMİŞ, hiçbiri kaldırılmamış/adı değişmemiş.
  for (const existingName of ["list_products", "get_draft", "publish_now", "create_draft", "update_status", "set_autopilot", "upload_media", "research_web", "transcribe_media", "generate_scene_image", "validate_product_visual", "generate_image_from_video", "search_product_knowledge"]) {
    assert.ok(tools.some((t) => t.name === existingName), `${existingName} tools/list'ten kaybolmuş`);
  }
});

test("run_agent_orchestration: bilinmeyen/forbidden bir capability (örn. publish_now) hiçbir adım çalışmadan reddedilir (blocked)", async () => {
  const originalFetch = global.fetch;
  let called = false;
  global.fetch = async () => { called = true; throw new Error("çağrılmamalıydı"); };
  try {
    const text = await callTool("run_agent_orchestration", { steps: [{ stepId: "s1", capability: "publish_now", args: {} }] });
    const parsed = JSON.parse(text);
    assert.equal(parsed.status, "blocked");
    assert.match(parsed.blockedOrConfirmationReason, /bilinmeyen veya izin verilmeyen capability/);
    assert.equal(called, false);
  } finally {
    global.fetch = originalFetch;
  }
});

test("run_agent_orchestration: confirmed:true verilmeyen ücretli bir adımda GÜVENLE durur (waiting_for_confirmation), hiçbir API çağrısı yapılmaz", async () => {
  const originalFetch = global.fetch;
  let called = false;
  global.fetch = async () => { called = true; throw new Error("çağrılmamalıydı"); };
  try {
    const text = await callTool("run_agent_orchestration", { steps: [{ stepId: "s1", capability: "research_web", args: { query: "buzsu" } }] });
    const parsed = JSON.parse(text);
    assert.equal(parsed.status, "waiting_for_confirmation");
    assert.equal(parsed.currentStep, "s1");
    assert.equal(called, false);
  } finally {
    global.fetch = originalFetch;
  }
});

test("run_agent_orchestration: confirmed:true ile research_web adımını gerçekten çalıştırır ve tamamlanmış bir run döner (TASK-001 regresyonu bozulmamış)", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    json: async () => ({ candidates: [{ content: { parts: [{ text: "Cevap metni." }] }, groundingMetadata: { groundingChunks: [{ web: { uri: "https://example.com/a", title: "A" } }] } }] })
  });
  try {
    const text = await callTool("run_agent_orchestration", {
      steps: [{ stepId: "s1", capability: "research_web", args: { query: "buzsu su arıtma güncel fiyat", provider: "google", confirmed: true } }]
    });
    const parsed = JSON.parse(text);
    assert.equal(parsed.status, "completed");
    assert.equal(parsed.completedSteps.length, 1);
    assert.equal(parsed.completedSteps[0].output.answer, "Cevap metni.");
    assert.equal(parsed.capabilityOrToolUsed, "research_web");
  } finally {
    global.fetch = originalFetch;
  }
});

// TASK-008 (run_deep_research): api/mcp.js'e minimum entegrasyon — asıl
// mode/allowlist/uncertainty/conflict testleri test/deep-research*.test.js'te
// (owns). Burada yalnız tool'un TOOLS listesinde göründüğü, mevcut tool'ları
// BOZMADIĞI ve callTool'un runDeepResearch'ü gerçekten çağırdığı doğrulanır.
test("tools/list: run_deep_research tool listesinde 'mode' + 'confirmed' zorunlu, mode enum'ı sabit 3 araştırma moduyla eşleşir, ve MEVCUT tool'lar (TASK-001/006/007 dahil) BOZULMAMIŞTIR", async () => {
  const response = await handleMessage({ id: 1, method: "tools/list" });
  const tools = response.result.tools;
  const tool = tools.find((t) => t.name === "run_deep_research");
  assert.ok(tool, "run_deep_research tools/list içinde bulunamadı");
  assert.deepEqual(tool.inputSchema.required, ["mode", "confirmed"]);
  assert.deepEqual(tool.inputSchema.properties.mode.enum, ["seo", "competitor", "weekly_content_opportunities"]);
  for (const existingName of ["research_web", "search_product_knowledge", "get_buzsu_product_context", "run_agent_orchestration", "list_products", "publish_now", "create_draft"]) {
    assert.ok(tools.some((t) => t.name === existingName), `${existingName} tools/list'ten kaybolmuş`);
  }
});

test("run_deep_research: desteklenmeyen bir mode hiçbir API çağrısı yapılmadan reddedilir", async () => {
  const originalFetch = global.fetch;
  let called = false;
  global.fetch = async () => { called = true; throw new Error("çağrılmamalıydı"); };
  try {
    const response = await handleMessage({ id: 1, method: "tools/call", params: { name: "run_deep_research", arguments: { mode: "made_up_mode", confirmed: true } } });
    assert.equal(response.result.isError, true);
    assert.match(response.result.content[0].text, /Desteklenmeyen veya bilinmeyen research mode/);
    assert.equal(called, false);
  } finally {
    global.fetch = originalFetch;
  }
});

test("run_deep_research: confirmed:true olmadan hiçbir API çağrısı yapılmaz", async () => {
  const originalFetch = global.fetch;
  let called = false;
  global.fetch = async () => { called = true; throw new Error("çağrılmamalıydı"); };
  try {
    const response = await handleMessage({ id: 1, method: "tools/call", params: { name: "run_deep_research", arguments: { mode: "seo", objective: "test" } } });
    assert.equal(response.result.isError, true);
    assert.match(response.result.content[0].text, /confirmed:true/);
    assert.equal(called, false);
  } finally {
    global.fetch = originalFetch;
  }
});

test("run_deep_research: confirmed:true ile geçerli bir SEO akışını çalıştırır, research_web'i (TASK-001) reuse ederek normalize edilmiş kaynaklar döner (regresyon bozulmamış)", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    json: async () => ({ candidates: [{ content: { parts: [{ text: "SEO cevabı." }] }, groundingMetadata: { groundingChunks: [{ web: { uri: "https://example.com/seo", title: "SEO" } }] } }] })
  });
  try {
    const text = await callTool("run_deep_research", { mode: "seo", objective: "kireç önleyici anahtar kelimeleri", provider: "google", confirmed: true });
    const parsed = JSON.parse(text);
    assert.equal(parsed.query_or_objective, "kireç önleyici anahtar kelimeleri");
    assert.equal(parsed.findings[0].answer, "SEO cevabı.");
    assert.deepEqual(parsed.providers_or_capabilities_used, ["research_web:google"]);
    assert.ok(Array.isArray(parsed.uncertainty));
    assert.deepEqual(parsed.conflicts, []);
  } finally {
    global.fetch = originalFetch;
  }
});
