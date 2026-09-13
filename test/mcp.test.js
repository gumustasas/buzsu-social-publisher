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

test("tools/call: code'u olmayan (mevcut/genel) bir hata hâlâ düz \"Hata: ...\" metni döner (regresyon — davranış bozulmadı)", async () => {
  const response = await handleMessage({ id: 1, method: "tools/call", params: { name: "get_draft", arguments: {} } });
  assert.equal(response.result.isError, true);
  assert.match(response.result.content[0].text, /^Hata: /);
  assert.throws(() => JSON.parse(response.result.content[0].text), "düz metin JSON olarak parse edilemez, bu beklenen davranış");
});
