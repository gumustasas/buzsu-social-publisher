import test from "node:test";
import assert from "node:assert/strict";
import handler from "../api/compose-video.js";
import { setSession } from "../src/auth.js";

process.env.SESSION_SECRET = process.env.SESSION_SECRET || "test-secret-for-compose-video-handler";
delete process.env.BLOB_READ_WRITE_TOKEN;

function sessionCookie(user = { id: "u1", username: "test", role: "Admin" }) {
  const headers = {};
  const fakeResponse = { setHeader: (key, value) => { headers[key] = value; } };
  setSession(fakeResponse, user);
  return String(headers["Set-Cookie"]).split(";")[0];
}

function makeRequest({ method = "POST", body, url = "/api/compose-video" } = {}) {
  return { method, url, headers: { cookie: sessionCookie() }, body: body === undefined ? undefined : JSON.stringify(body) };
}

function makeResponse() {
  const res = { statusCode: null, payload: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => { res.payload = payload; return res; };
  return res;
}

function twoMediaItems() {
  return [
    { imageUrl: "https://example.com/a.jpg", title: "Ürün A" },
    { imageUrl: "https://example.com/b.jpg", title: "Ürün B" }
  ];
}

test("compose-video handler: yetkisiz istek 401 döner", async () => {
  const res = makeResponse();
  await handler({ method: "POST", url: "/api/compose-video", headers: {}, body: JSON.stringify({ mediaItems: twoMediaItems() }) }, res);
  assert.equal(res.statusCode, 401);
});

test("compose-video handler: 2'den az ürünle 400 döner (validasyon, hiç kuyruğa alınmaz)", async () => {
  const req = makeRequest({ body: { mediaItems: [{ imageUrl: "https://example.com/a.jpg" }] } });
  const res = makeResponse();
  await handler(req, res);
  assert.equal(res.statusCode, 400);
  assert.match(res.payload.error, /2-10/);
});

test("compose-video handler: 10'dan fazla ürünle 400 döner", async () => {
  const items = Array.from({ length: 11 }, (_, i) => ({ imageUrl: `https://example.com/${i}.jpg` }));
  const req = makeRequest({ body: { mediaItems: items } });
  const res = makeResponse();
  await handler(req, res);
  assert.equal(res.statusCode, 400);
});

test("compose-video handler: GET jobId olmadan 400 döner", async () => {
  const req = makeRequest({ method: "GET", url: "/api/compose-video" });
  const res = makeResponse();
  await handler(req, res);
  assert.equal(res.statusCode, 400);
  assert.match(res.payload.error, /jobId/);
});

// BLOB_READ_WRITE_TOKEN test ortamında tanımlı değil (üstte açıkça silindi) —
// bu yüzden geçerli bir POST, gerçek bir render kuyruğa almadan/ücret
// harcamadan composeProductVideo'nun blob yazma adımında durur. Bu, handler'ın
// gerçek doğrulama+iş başlatma mantığını (src/video-compose.js, compose_product_video
// MCP aracıyla paylaşılan aynı kod) fiilen çağırdığını ve alttan gelen hatayı
// olduğu gibi (bir 500'e gizlemeden/yutmadan) ilettiğini kanıtlar.
test("compose-video handler: geçerli POST composeProductVideo'yu çağırır ve alttaki (token eksik) hatayı iletir", async () => {
  const req = makeRequest({ body: { mediaItems: twoMediaItems(), transition: "wipe" } });
  const res = makeResponse();
  await handler(req, res);
  assert.equal(res.statusCode, 500);
  assert.equal(res.payload.ok, false);
  assert.match(res.payload.error, /token/i);
});

// upscaleImages varsayılan olarak composeProductVideo tarafında true kabul
// EDİLMEZ — handler yalnızca body.upscaleImages===true ise true gönderir ve
// confirmed'i de aynı bayrağa bağlar, böylece dashboard'dan confirmed
// gönderilmeden gerçek Replicate kredisi harcanan bir çağrı asla tetiklenmez.
test("compose-video handler: upscaleImages gönderilmezse composeProductVideo'ya false geçilir (confirmed gerekmez, ücretli çağrı tetiklenmez)", async () => {
  const req = makeRequest({ body: { mediaItems: twoMediaItems() } });
  const res = makeResponse();
  await handler(req, res);
  // confirmed:true olmadan upscaleImages:true gönderilseydi composeProductVideo
  // "gerçek Replicate API kredisi harcar" hatasını verirdi — bunun yerine yine
  // token hatası aldığımızı doğrulamak, upscale kontrolüne hiç takılmadan
  // (yani upscaleImages:false ile) blob yazma adımına ulaştığımızı kanıtlar.
  assert.equal(res.statusCode, 500);
  assert.match(res.payload.error, /token/i);
  assert.doesNotMatch(res.payload.error, /Replicate/i);
});
