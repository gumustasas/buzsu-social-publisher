import test from "node:test";
import assert from "node:assert/strict";
import { callTool } from "../api/mcp.js";

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
