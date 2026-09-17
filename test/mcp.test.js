import test from "node:test";
import assert from "node:assert/strict";
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
  ["quality tier name", "quality", "veo-3.1-generate-preview"],
  // Veo 3 (GA) — Veo 3.1 (Preview) ile AYNI test döngüsünde, ama tamamen
  // farklı model ID'lerine gitmesi gerektiğini doğrulamak için birlikte.
  ["veo-3-generate alias (Veo 3 GA, NOT 3.1)", "veo-3-generate", "veo-3.0-generate-001"],
  ["veo-3-fast alias (Veo 3 GA, NOT 3.1)", "veo-3-fast", "veo-3.0-fast-generate-001"]
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

// Düzeltme: Veo 3 (GA) ve Veo 3.1 (Preview) birbirinden AYRI aileler —
// biri seçildiğinde diğerinin endpoint'i/model ID'si ASLA çağrılmaz.
test("generate_video_clip with model:\"veo-3-generate\" (Veo 3 GA) never calls a Veo 3.1 URL", async () => {
  const originalFetch = global.fetch;
  const calledUrls = [];
  global.fetch = async (url, options) => {
    const href = String(url);
    calledUrls.push(href);
    if (!options) return { ok: true, headers: { get: () => "image/jpeg" }, arrayBuffer: async () => new Uint8Array([1]).buffer };
    return { ok: true, json: async () => ({ name: "operations/op-v3" }) };
  };
  try {
    await callTool("generate_video_clip", { imageUrl: "https://example.com/x.jpg", prompt: "p", confirmed: true, model: "veo-3-generate" });
    assert.ok(!calledUrls.some((u) => u.includes("veo-3.1")));
  } finally {
    global.fetch = originalFetch;
  }
});

test("generate_video_clip with model:\"veo-3.1-generate\" (Veo 3.1 Preview) never calls a Veo 3 (GA) URL", async () => {
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

test("generate_video_clip with model:\"veo-3-lite\" rejects with a clear error (no verified canonical ID) instead of silently using Veo 3.1 Lite", async () => {
  const originalFetch = global.fetch;
  let calls = 0;
  global.fetch = async () => { calls++; throw new Error("fetch should not be called"); };
  try {
    await assert.rejects(
      () => callTool("generate_video_clip", { imageUrl: "https://example.com/x.jpg", prompt: "p", confirmed: true, model: "veo-3-lite" }),
      /VEO_3_LITE_MODEL_ID/
    );
    assert.equal(calls, 0);
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
