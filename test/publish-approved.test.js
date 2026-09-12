import test from "node:test";
import assert from "node:assert/strict";
import { publishInstagram, publishFacebook, publishX, publishYouTube, parseMediaItems } from "../src/publish-approved.js";

// storyImageUrl STORY_IMAGE_BASE_URL'i modül yüklenirken bir kez okuyor
// (üst seviye const) — env değişkenini set edip modülü taze bir specifier'la
// (cache-busting query) yeniden import ederek gerçek davranışını test ediyoruz.
async function loadStoryImageUrlWithBaseUrl(baseUrl) {
  const originalValue = process.env.STORY_IMAGE_BASE_URL;
  process.env.STORY_IMAGE_BASE_URL = baseUrl;
  try {
    const mod = await import(`../src/publish-approved.js?t=${Date.now()}-${Math.random()}`);
    return mod.storyImageUrl;
  } finally {
    if (originalValue === undefined) delete process.env.STORY_IMAGE_BASE_URL;
    else process.env.STORY_IMAGE_BASE_URL = originalValue;
  }
}

const originalEnv = {
  META_ACCESS_TOKEN: process.env.META_ACCESS_TOKEN,
  META_INSTAGRAM_ACCOUNT_ID: process.env.META_INSTAGRAM_ACCOUNT_ID,
  META_FACEBOOK_PAGE_ACCESS_TOKEN: process.env.META_FACEBOOK_PAGE_ACCESS_TOKEN,
  META_FACEBOOK_PAGE_ID: process.env.META_FACEBOOK_PAGE_ID
};

function setMetaEnv() {
  process.env.META_ACCESS_TOKEN = "test-ig-token";
  process.env.META_INSTAGRAM_ACCOUNT_ID = "17841400000000000";
  process.env.META_FACEBOOK_PAGE_ACCESS_TOKEN = "test-fb-token";
  process.env.META_FACEBOOK_PAGE_ID = "100000000000000";
}

function restoreMetaEnv() {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

// graphPost gövdeyi bir URLSearchParams örneği olarak gönderir (bkz.
// src/publish-approved.js graphPost) — mock burada onu yakalayıp .get() ile
// okuyabiliyor; publish-approved.js'in kendisi global fetch'i kullanıyor
// (injectable değil), bu yüzden diğer testlerdeki gibi (scene-validation.test.js)
// global.fetch geçici olarak override ediliyor.
function queueFetchMock(responses) {
  let index = 0;
  const calls = [];
  const fetchMock = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method || "GET", body: options.body });
    const response = responses[index++];
    if (!response) throw new Error(`Beklenmeyen ek fetch çağrısı (#${index}): ${url}`);
    if (response.error) return { ok: false, status: response.status || 400, json: async () => ({ error: { message: response.error } }) };
    return { ok: true, json: async () => response };
  };
  return { fetchMock, calls };
}

function withMocks(responses, run) {
  const originalFetch = global.fetch;
  setMetaEnv();
  const { fetchMock, calls } = queueFetchMock(responses);
  global.fetch = fetchMock;
  return run(calls).finally(() => {
    global.fetch = originalFetch;
    restoreMetaEnv();
  });
}

test("parseMediaItems returns [] for an empty/undefined field and throws on malformed JSON", () => {
  assert.deepEqual(parseMediaItems(""), []);
  assert.deepEqual(parseMediaItems(undefined), []);
  assert.throws(() => parseMediaItems("not json"), /geçerli bir JSON dizisi değil/);
  assert.throws(() => parseMediaItems(JSON.stringify({ not: "an array" })), /bir dizi olmalı/);
});

test("publishInstagram still publishes a plain single-image Gönderi exactly as before (regression)", async () => {
  await withMocks(
    [
      { id: "container_1" },
      { status_code: "FINISHED" },
      { id: "ig_post_1" }
    ],
    async (calls) => {
      const fields = { "Görsel URL": "https://blob.vercel-storage.com/photo.jpg", "Instagram Metni": "Merhaba", Hashtagler: "#Buzsu" };
      const postId = await publishInstagram(fields, "Gönderi");
      assert.equal(postId, "ig_post_1");
      assert.equal(calls.length, 3);
      assert.match(calls[0].url, /\/media$/);
      assert.equal(calls[0].body.get("image_url"), "https://blob.vercel-storage.com/photo.jpg");
    }
  );
});

test("publishInstagram still publishes a Reel exactly as before, using media_type=REELS (regression)", async () => {
  await withMocks(
    [
      { id: "reel_container_1" },
      { status_code: "FINISHED" },
      { id: "ig_reel_1" }
    ],
    async (calls) => {
      const fields = { "Video URL": "https://blob.vercel-storage.com/video.mp4", "Instagram Metni": "Reel metni", Hashtagler: "#Buzsu" };
      const postId = await publishInstagram(fields, "Reel");
      assert.equal(postId, "ig_reel_1");
      assert.equal(calls[0].body.get("media_type"), "REELS");
      assert.equal(calls[0].body.get("video_url"), "https://blob.vercel-storage.com/video.mp4");
    }
  );
});

test("publishInstagram Carousel: 2 image mediaItems produce 2 child containers + 1 parent, published once", async () => {
  await withMocks(
    [
      { id: "child_img1" }, { status_code: "FINISHED" },
      { id: "child_img2" }, { status_code: "FINISHED" },
      { id: "parent_1" }, { status_code: "FINISHED" },
      { id: "ig_carousel_1" }
    ],
    async (calls) => {
      const fields = {
        "Instagram Metni": "2 görsel carousel", Hashtagler: "#Buzsu",
        "Media Items": JSON.stringify([
          { type: "image", url: "https://blob.vercel-storage.com/img1.jpg" },
          { type: "image", url: "https://blob.vercel-storage.com/img2.jpg" }
        ])
      };
      const postId = await publishInstagram(fields, "Carousel");
      assert.equal(postId, "ig_carousel_1");
      assert.equal(calls.length, 7);
      assert.equal(calls[0].body.get("image_url"), "https://blob.vercel-storage.com/img1.jpg");
      assert.equal(calls[0].body.get("is_carousel_item"), "true");
      assert.equal(calls[2].body.get("image_url"), "https://blob.vercel-storage.com/img2.jpg");
      const parentCall = calls[4];
      assert.equal(parentCall.body.get("media_type"), "CAROUSEL");
      assert.equal(parentCall.body.get("children"), "child_img1,child_img2");
    }
  );
});

test("publishInstagram Carousel: 3 image mediaItems produce 3 child containers + 1 parent with correct child order", async () => {
  await withMocks(
    [
      { id: "c1" }, { status_code: "FINISHED" },
      { id: "c2" }, { status_code: "FINISHED" },
      { id: "c3" }, { status_code: "FINISHED" },
      { id: "parent_2" }, { status_code: "FINISHED" },
      { id: "ig_carousel_2" }
    ],
    async (calls) => {
      const fields = {
        "Instagram Metni": "3 görsel carousel", Hashtagler: "#Buzsu",
        "Media Items": JSON.stringify([
          { type: "image", url: "https://blob.vercel-storage.com/img1.jpg" },
          { type: "image", url: "https://blob.vercel-storage.com/img2.jpg" },
          { type: "image", url: "https://blob.vercel-storage.com/img3.jpg" }
        ])
      };
      const postId = await publishInstagram(fields, "Carousel");
      assert.equal(postId, "ig_carousel_2");
      const parentCall = calls[6];
      assert.equal(parentCall.body.get("children"), "c1,c2,c3");
    }
  );
});

test("publishInstagram Carousel: image+image+video — the video child is never REELS, uses VIDEO media_type, and the parent references all three children in order", async () => {
  await withMocks(
    [
      { id: "img_child_1" }, { status_code: "FINISHED" },
      { id: "img_child_2" }, { status_code: "FINISHED" },
      { id: "vid_child_1" }, { status_code: "FINISHED" },
      { id: "parent_3" }, { status_code: "FINISHED" },
      { id: "ig_carousel_3" }
    ],
    async (calls) => {
      const fields = {
        "Instagram Metni": "Karma carousel", Hashtagler: "#Buzsu",
        "Media Items": JSON.stringify([
          { type: "image", url: "https://blob.vercel-storage.com/img1.jpg" },
          { type: "image", url: "https://blob.vercel-storage.com/img2.jpg" },
          { type: "video", url: "https://blob.vercel-storage.com/ultramag.mp4" }
        ])
      };
      const postId = await publishInstagram(fields, "Carousel");
      assert.equal(postId, "ig_carousel_3");
      const videoChildCall = calls[4];
      assert.equal(videoChildCall.body.get("video_url"), "https://blob.vercel-storage.com/ultramag.mp4");
      assert.equal(videoChildCall.body.get("media_type"), "VIDEO");
      assert.notEqual(videoChildCall.body.get("media_type"), "REELS");
      assert.equal(videoChildCall.body.get("is_carousel_item"), "true");
      const parentCall = calls[6];
      assert.equal(parentCall.body.get("media_type"), "CAROUSEL");
      assert.equal(parentCall.body.get("children"), "img_child_1,img_child_2,vid_child_1");
    }
  );
});

test("publishInstagram Carousel: waits (polls) until a child container's status_code is FINISHED before moving on", async () => {
  await withMocks(
    [
      { id: "slow_child" },
      { status_code: "IN_PROGRESS" }, // ilk sorguda henüz hazır değil — waitForInstagramContainer tekrar sormalı
      { status_code: "FINISHED" },
      { id: "quick_child" }, { status_code: "FINISHED" },
      { id: "parent_4" }, { status_code: "FINISHED" },
      { id: "ig_carousel_4" }
    ],
    async (calls) => {
      const fields = {
        "Instagram Metni": "Bekleme testi", Hashtagler: "#Buzsu",
        "Media Items": JSON.stringify([
          { type: "image", url: "https://blob.vercel-storage.com/img1.jpg" },
          { type: "image", url: "https://blob.vercel-storage.com/img2.jpg" }
        ])
      };
      const postId = await publishInstagram(fields, "Carousel");
      assert.equal(postId, "ig_carousel_4");
      assert.equal(calls.length, 8, "IN_PROGRESS yanıtı ek bir durum sorgusu tetiklemeli");
    }
  );
});

test("publishFacebook still publishes a plain single-image post and a Reel exactly as before (regression)", async () => {
  await withMocks(
    [{ post_id: "fb_post_1" }],
    async (calls) => {
      const fields = { "Görsel URL": "https://blob.vercel-storage.com/photo.jpg", "Facebook Metni": "Merhaba", Hashtagler: "#Buzsu", "Kaynak URL": "https://www.buzsu.com.tr/urun/" };
      const postId = await publishFacebook(fields, "Gönderi");
      assert.equal(postId, "fb_post_1");
      assert.match(calls[0].url, /\/photos$/);
    }
  );
  // publishFacebookReel 3 fetch çağrısı yapar: (1) video_reels upload_phase=start,
  // (2) rupload.facebook.com'a dosya yükleme çağrısı (queueFetchMock bunu da
  // aynı global.fetch üzerinden yakalar), (3) video_reels upload_phase=finish.
  await withMocks(
    [
      { video_id: "fb_video_1" },
      { success: true },
      { success: true }
    ],
    async (calls) => {
      const fields = { "Video URL": "https://blob.vercel-storage.com/video.mp4", "Facebook Metni": "Reel metni", Hashtagler: "#Buzsu" };
      const postId = await publishFacebook(fields, "Reel");
      assert.equal(postId, "fb_video_1");
      assert.ok(calls.some((call) => call.url.includes("rupload.facebook.com")));
    }
  );
});

test("publishFacebook Carousel: image-only mediaItems become unpublished photos combined into a single /feed post via attached_media", async () => {
  await withMocks(
    [
      { id: "fb_photo_1" },
      { id: "fb_photo_2" },
      { id: "fb_post_carousel" }
    ],
    async (calls) => {
      const fields = {
        "Facebook Metni": "2 görsel carousel", Hashtagler: "#Buzsu",
        "Media Items": JSON.stringify([
          { type: "image", url: "https://blob.vercel-storage.com/img1.jpg" },
          { type: "image", url: "https://blob.vercel-storage.com/img2.jpg" }
        ])
      };
      const postId = await publishFacebook(fields, "Carousel");
      assert.equal(postId, "fb_post_carousel");
      assert.equal(calls.length, 3);
      assert.match(calls[0].url, /\/photos$/);
      assert.equal(calls[0].body.get("published"), "false");
      assert.match(calls[1].url, /\/photos$/);
      const feedCall = calls[2];
      assert.match(feedCall.url, /\/feed$/);
      assert.equal(feedCall.body.get("attached_media[0]"), JSON.stringify({ media_fbid: "fb_photo_1" }));
      assert.equal(feedCall.body.get("attached_media[1]"), JSON.stringify({ media_fbid: "fb_photo_2" }));
    }
  );
});

test("publishFacebook Carousel explicitly rejects a mixed image+video combination with UNSUPPORTED_FACEBOOK_MEDIA_COMBINATION, without making any Graph API call", async () => {
  await withMocks([], async (calls) => {
    const fields = {
      "Facebook Metni": "Karma carousel", Hashtagler: "#Buzsu",
      "Media Items": JSON.stringify([
        { type: "image", url: "https://blob.vercel-storage.com/img1.jpg" },
        { type: "video", url: "https://blob.vercel-storage.com/ultramag.mp4" }
      ])
    };
    await assert.rejects(() => publishFacebook(fields, "Carousel"), /UNSUPPORTED_FACEBOOK_MEDIA_COMBINATION/);
    assert.equal(calls.length, 0, "reddedilmeden önce hiçbir Graph API çağrısı yapılmamalı");
  });
});

test("the same Video URL is reused, unmodified, across an Instagram Reel and a Facebook Reel publish for the same record (no re-upload, no Blob interaction in this module)", async () => {
  const videoUrl = "https://blob.vercel-storage.com/ultramag.mp4";
  const fields = { "Video URL": videoUrl, "Instagram Metni": "IG Reel", "Facebook Metni": "FB Reel", Hashtagler: "#Buzsu" };

  await withMocks(
    [{ id: "ig_reel_container" }, { status_code: "FINISHED" }, { id: "ig_reel_post" }],
    async (calls) => {
      await publishInstagram(fields, "Reel");
      assert.equal(calls[0].body.get("video_url"), videoUrl);
    }
  );

  await withMocks(
    [{ video_id: "fb_reel_video" }, { success: true }, { success: true }],
    async (calls) => {
      const postId = await publishFacebook(fields, "Reel");
      assert.equal(postId, "fb_reel_video");
      // rupload.facebook.com adımına dosya URL'i header olarak, aynı videoUrl ile geçiliyor.
      assert.ok(calls.some((call) => call.url.includes("rupload.facebook.com")));
    }
  );
});

// Regresyon (PR #36 review bulgusu — Codex): publishX önceden Carousel'i
// "Reel dışı her şey" dalına düşürüp mediaItems'ı yok sayarak SADECE
// "Görsel URL" alanındaki tek önizleme görseliyle normal bir tweet
// atıyordu — kayıt "Paylaşıldı" işaretleniyordu ama carousel'in geri kalan
// görselleri/videosu X'e hiç paylaşılmamış oluyordu. X (bu entegrasyonda)
// çoklu medya desteklemediği için Reel'deki video atlama deseniyle aynı
// şekilde sessizce (hatasız) atlanmalı.
test("publishX skips a Carousel draft without posting anything (no partial/degraded tweet with just the first mediaItem), matching how it already skips Reel", async () => {
  const originalFetch = global.fetch;
  let fetchCalled = false;
  global.fetch = async () => { fetchCalled = true; throw new Error("publishX Carousel'de hiçbir fetch çağrısı yapmamalı"); };
  try {
    const fields = {
      "Görsel URL": "https://blob.vercel-storage.com/img1.jpg",
      "Facebook Metni": "Karma carousel",
      "Media Items": JSON.stringify([
        { type: "image", url: "https://blob.vercel-storage.com/img1.jpg" },
        { type: "image", url: "https://blob.vercel-storage.com/img2.jpg" },
        { type: "video", url: "https://blob.vercel-storage.com/video.mp4" }
      ])
    };
    const result = await publishX(fields, "Carousel");
    assert.equal(result, null);
    assert.equal(fetchCalled, false);
  } finally {
    global.fetch = originalFetch;
  }
});

function fakeYouTubeResponse({ ok = true, status = 200, json = {}, headers = {} } = {}) {
  return { ok, status, json: async () => json, headers: { get: (name) => headers[name.toLowerCase()] ?? null } };
}

const YOUTUBE_ENV = { YOUTUBE_CLIENT_ID: "client-id", YOUTUBE_CLIENT_SECRET: "client-secret", YOUTUBE_REFRESH_TOKEN: "refresh-token" };

function withYouTubeEnv(run) {
  const original = { ...process.env };
  Object.assign(process.env, YOUTUBE_ENV);
  return run().finally(() => {
    for (const key of Object.keys(YOUTUBE_ENV)) delete process.env[key];
    Object.assign(process.env, original);
  });
}

// publishYouTube, "Hashtagler" alanını (Instagram/Facebook metnine eklenen
// serbest metnin YANINDA, ayrıca) YouTube'un videos.insert snippet.tags
// dizisine de çevirip geçiriyor mu — # işaretleri temizlenmiş, boşluğa göre
// ayrılmış anahtar kelimeler olarak (bkz. src/publish-approved.js
// hashtagsToTags).
test("publishYouTube converts Hashtagler into YouTube's snippet.tags array (# stripped, space-separated)", async () => {
  await withYouTubeEnv(async () => {
    const originalFetch = global.fetch;
    let initBody;
    global.fetch = async (url, options = {}) => {
      const u = String(url);
      if (u === "https://blob.vercel-storage.com/ultramag.mp4") return { ok: true, arrayBuffer: async () => new Uint8Array([1, 2]).buffer };
      if (u === "https://oauth2.googleapis.com/token") return fakeYouTubeResponse({ json: { access_token: "access-123" } });
      if (u.startsWith("https://www.googleapis.com/upload/youtube/v3/videos")) {
        initBody = JSON.parse(options.body);
        return fakeYouTubeResponse({ headers: { location: "https://upload.example.com/session-xyz" } });
      }
      if (u === "https://upload.example.com/session-xyz") return fakeYouTubeResponse({ json: { id: "yt_video_1" } });
      throw new Error(`beklenmeyen istek: ${u}`);
    };
    try {
      const fields = {
        "Video URL": "https://blob.vercel-storage.com/ultramag.mp4",
        "Başlık": "UltraMag Kireç Önleyici | Reel",
        "Instagram Metni": "Ürünü keşfedin",
        "Hashtagler": "#Buzsu #UltraMag #KireçÖnleyici"
      };
      const id = await publishYouTube(fields, "Reel");
      assert.equal(id, "yt_video_1");
      assert.deepEqual(initBody.snippet.tags, ["Buzsu", "UltraMag", "KireçÖnleyici"]);
    } finally {
      global.fetch = originalFetch;
    }
  });
});

test("storyImageUrl passes the full first line of the caption as subtitle — no hard character cutoff (kullanıcı geri bildirimiyle kaldırıldı)", async () => {
  const storyImageUrl = await loadStoryImageUrlWithBaseUrl("https://example.com/api/story-image");
  const longFirstLine = "Bu cümle doksan karakterden kesinlikle daha uzun olacak şekilde bilerek yazılmış bir test metnidir ve devamı da var.";
  const url = storyImageUrl("https://example.com/photo.jpg", { "Başlık": "Test Ürünü | Hikâye", "Instagram Metni": `${longFirstLine}\nİkinci satır burada.` });
  const subtitle = new URL(url).searchParams.get("subtitle");
  assert.equal(subtitle, longFirstLine);
  assert.ok(subtitle.length > 90, "eski 90 karakterlik sabit kesme kaldırılmış olmalı");
});

test("publishYouTube passes an empty tags array when Hashtagler is missing/blank", async () => {
  await withYouTubeEnv(async () => {
    const originalFetch = global.fetch;
    let initBody;
    global.fetch = async (url, options = {}) => {
      const u = String(url);
      if (u === "https://blob.vercel-storage.com/v.mp4") return { ok: true, arrayBuffer: async () => new Uint8Array([1]).buffer };
      if (u === "https://oauth2.googleapis.com/token") return fakeYouTubeResponse({ json: { access_token: "access-123" } });
      if (u.startsWith("https://www.googleapis.com/upload/youtube/v3/videos")) {
        initBody = JSON.parse(options.body);
        return fakeYouTubeResponse({ headers: { location: "https://upload.example.com/session-abc" } });
      }
      if (u === "https://upload.example.com/session-abc") return fakeYouTubeResponse({ json: { id: "yt_video_2" } });
      throw new Error(`beklenmeyen istek: ${u}`);
    };
    try {
      const fields = { "Video URL": "https://blob.vercel-storage.com/v.mp4", "Başlık": "Test", "Instagram Metni": "Metin" };
      await publishYouTube(fields, "Reel");
      assert.deepEqual(initBody.snippet.tags, []);
    } finally {
      global.fetch = originalFetch;
    }
  });
});
