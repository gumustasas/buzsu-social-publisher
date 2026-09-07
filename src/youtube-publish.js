// YouTube Data API v3 — Shorts (kısa video) yükleme. Şirket/marka kanalı
// adına yükleyebilmek için OAuth 2.0 3-legged akışı (refresh token) gerekir;
// X'teki gibi statik bir anahtar yeterli değil. Kurulum: bkz. api/youtube-
// callback.js (bir kerelik yetkilendirme dönüşü, refresh token'ı ekranda
// gösterir). "Shorts" ayrı bir API değildir — dikey (≤ 3dk) bir video normal
// videos.insert ile yüklenir, YouTube otomatik Shorts olarak sınıflandırır.
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const UPLOAD_INIT_URL = "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status";

function assertYouTubeConfigured(env) {
  const required = ["YOUTUBE_CLIENT_ID", "YOUTUBE_CLIENT_SECRET", "YOUTUBE_REFRESH_TOKEN"];
  const missing = required.filter((name) => !env[name]);
  if (missing.length) throw new Error(`YouTube için eksik ortam değişkenleri: ${missing.join(", ")}`);
}

async function getAccessToken(env) {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: env.YOUTUBE_CLIENT_ID, client_secret: env.YOUTUBE_CLIENT_SECRET, refresh_token: env.YOUTUBE_REFRESH_TOKEN, grant_type: "refresh_token" })
  });
  const data = await response.json();
  if (!response.ok || !data.access_token) throw new Error(`YouTube token yenilenemedi: ${data.error_description || data.error || `HTTP ${response.status}`}`);
  return data.access_token;
}

// Resumable upload: (1) metadata ile bir oturum URL'i alınır (Location
// header), (2) video baytları o URL'e tek seferde PUT edilir (dosya boyutu
// baştan biliniyor, chunk'lamaya gerek yok — Shorts kısa videolar için
// pratikte birkaç on MB'ı geçmiyor).
async function initUploadSession({ title, description, tags, categoryId, privacyStatus }, buffer, accessToken) {
  const response = await fetch(UPLOAD_INIT_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "X-Upload-Content-Type": "video/mp4",
      "X-Upload-Content-Length": String(buffer.length)
    },
    body: JSON.stringify({
      snippet: { title: title.slice(0, 100), description: description.slice(0, 5000), tags, categoryId },
      status: { privacyStatus, selfDeclaredMadeForKids: false }
    })
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(`YouTube yükleme oturumu açılamadı: ${data.error?.message || `HTTP ${response.status}`}`);
  }
  const uploadUrl = response.headers.get("location");
  if (!uploadUrl) throw new Error("YouTube yükleme oturumu URL'i alınamadı.");
  return uploadUrl;
}

async function putVideoBytes(uploadUrl, buffer) {
  const response = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": "video/mp4", "Content-Length": String(buffer.length) },
    body: buffer
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.id) throw new Error(`YouTube video yüklenemedi: ${data.error?.message || `HTTP ${response.status}`}`);
  return data.id;
}

// title/description Facebook/Instagram metinlerinden türetilir (bkz.
// src/publish-approved.js) — burada yalnızca API mekaniği var.
export async function uploadShort({ title, description, videoUrl, tags = [], categoryId, privacyStatus = "public" }, env = process.env) {
  assertYouTubeConfigured(env);
  if (!/^https:\/\//i.test(videoUrl || "")) throw new Error("YouTube için video URL'i herkese açık HTTPS olmalı.");
  if (!title || !title.trim()) throw new Error("YouTube başlığı boş.");
  const videoResponse = await fetch(videoUrl);
  if (!videoResponse.ok) throw new Error(`YouTube için video indirilemedi (HTTP ${videoResponse.status}).`);
  const buffer = Buffer.from(await videoResponse.arrayBuffer());
  const accessToken = await getAccessToken(env);
  const uploadUrl = await initUploadSession({ title, description: description || "", tags, categoryId: categoryId || env.YOUTUBE_CATEGORY_ID || "22", privacyStatus }, buffer, accessToken);
  return putVideoBytes(uploadUrl, buffer);
}
