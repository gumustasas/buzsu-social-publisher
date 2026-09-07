import { createHmac, randomBytes } from "node:crypto";

// X (Twitter) API v2 gönderi + v1.1 medya yükleme, OAuth 1.0a ile — resmi
// bir kütüphane eklemek yerine (proje genelinde çıplak fetch kullanılıyor,
// bkz. src/publish-approved.js, src/veo-video.js) imzalama Node'un yerleşik
// crypto modülüyle elle yapılıyor. Statik Access Token + Secret kullanıldığı
// için (uygulama sahibinin kendi @buzsuaritma hesabı) 3 legli bir OAuth
// akışı yok — bkz. api/x-callback.js.
const X_TWEETS_URL = "https://api.x.com/2/tweets";
const X_MEDIA_UPLOAD_URL = "https://upload.twitter.com/1.1/media/upload.json";

function percentEncode(value) {
  return encodeURIComponent(value).replace(/[!*'()]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

// RFC 5849 §3.4.1: imza yalnızca protokol parametrelerini (oauth_*) ve —
// gövde application/x-www-form-urlencoded olduğunda — gövde parametrelerini
// kapsar. Medya yüklemesi multipart/form-data gönderdiği için oradaki
// "media" alanı imzaya hiç girmez; bu yüzden burada yalnızca oauth_*
// parametreleri veriliyor.
function buildSignature(method, url, params, consumerSecret, tokenSecret) {
  const baseString = [
    method.toUpperCase(),
    percentEncode(url),
    percentEncode(Object.keys(params).sort().map((key) => `${percentEncode(key)}=${percentEncode(params[key])}`).join("&"))
  ].join("&");
  const signingKey = `${percentEncode(consumerSecret)}&${percentEncode(tokenSecret)}`;
  return createHmac("sha1", signingKey).update(baseString).digest("base64");
}

function oauthAuthHeader(method, url, env) {
  const oauthParams = {
    oauth_consumer_key: env.X_CONSUMER_KEY,
    oauth_nonce: randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_token: env.X_ACCESS_TOKEN,
    oauth_version: "1.0"
  };
  const signature = buildSignature(method, url, oauthParams, env.X_CONSUMER_SECRET, env.X_ACCESS_TOKEN_SECRET);
  const signedParams = { ...oauthParams, oauth_signature: signature };
  return `OAuth ${Object.keys(signedParams).sort().map((key) => `${percentEncode(key)}="${percentEncode(signedParams[key])}"`).join(", ")}`;
}

function assertXConfigured(env) {
  const required = ["X_CONSUMER_KEY", "X_CONSUMER_SECRET", "X_ACCESS_TOKEN", "X_ACCESS_TOKEN_SECRET"];
  const missing = required.filter((name) => !env[name]);
  if (missing.length) throw new Error(`X için eksik ortam değişkenleri: ${missing.join(", ")}`);
}

async function uploadImageMedia(imageUrl, env) {
  const imageResponse = await fetch(imageUrl);
  if (!imageResponse.ok) throw new Error(`X medyası için görsel indirilemedi (HTTP ${imageResponse.status}).`);
  const contentType = imageResponse.headers.get("content-type") || "image/jpeg";
  const buffer = Buffer.from(await imageResponse.arrayBuffer());
  const form = new FormData();
  form.append("media", new Blob([buffer], { type: contentType }));
  const response = await fetch(X_MEDIA_UPLOAD_URL, {
    method: "POST",
    headers: { Authorization: oauthAuthHeader("POST", X_MEDIA_UPLOAD_URL, env) },
    body: form
  });
  const data = await response.json();
  if (!response.ok || data.errors) throw new Error(`X medya yüklenemedi: ${data.errors?.[0]?.message || `HTTP ${response.status}`}`);
  return data.media_id_string;
}

async function postTweet({ text, mediaId }, env) {
  const body = mediaId ? { text, media: { media_ids: [mediaId] } } : { text };
  const response = await fetch(X_TWEETS_URL, {
    method: "POST",
    headers: { Authorization: oauthAuthHeader("POST", X_TWEETS_URL, env), "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok || data.errors) throw new Error(`X API: ${data.detail || data.errors?.[0]?.message || `HTTP ${response.status}`}`);
  if (!data.data?.id) throw new Error("X gönderi ID'si alınamadı.");
  return data.data.id;
}

// imageUrl verilmezse yalnızca metin gönderisi atılır. Video (Reel) desteği
// yok — X'te chunked (INIT/APPEND/FINALIZE) medya yüklemesi gerektiriyor,
// bu ilk sürümün kapsamı dışında bırakıldı.
export async function publishTweet({ text, imageUrl }, env = process.env) {
  assertXConfigured(env);
  if (!text || !text.trim()) throw new Error("X metni boş.");
  const mediaId = imageUrl ? await uploadImageMedia(imageUrl, env) : undefined;
  return postTweet({ text, mediaId }, env);
}
