import "dotenv/config";
import { getSession } from "../src/auth.js";

// Google OAuth 2.0 akışının BAŞLANGIÇ adımı — bkz. api/youtube-callback.js
// (dönüş adımı). Bu endpoint hiçbir sır/istemci gizli anahtarı tarayıcıya
// göndermez; yalnızca kullanıcıyı Google'ın kendi yetkilendirme sayfasına
// 302 ile yönlendirir. redirect_uri, Google Cloud Console'da bu OAuth
// Client için kayıtlı olan URI ile BİREBİR aynı olmalı — api/youtube-
// callback.js'teki ile senkron tutulur, buradan tek başına değiştirilirse
// Google "redirect_uri_mismatch" hatası döner.
const REDIRECT_URI = "https://buzsu-social-publisher.vercel.app/api/youtube-callback";
const SCOPE = "https://www.googleapis.com/auth/youtube.upload";

function html(body) {
  return `<!doctype html><meta charset="utf-8"><body style="font:14px/1.5 system-ui;max-width:640px;margin:40px auto;padding:0 16px">${body}</body>`;
}

// Bu bir GET/top-level navigation endpoint'idir — dashboard'daki "Bağlan /
// Yeniden bağlan" linki (target="_blank") buraya tarayıcının kendisiyle
// gider, fetch/XHR ile ÇAĞRILAMAZ (Google'ın giriş+onay ekranı bir sayfa
// gövdesi değil, tarayıcı adres çubuğunun değişmesini gerektirir). Session
// kontrolü var — bu, YALNIZCA panelde oturum açmış bir admin'in Google
// yetkilendirme akışını başlatabilmesi içindir; tamamlanan akış hiçbir
// şeyi otomatik KAYDETMEZ (bkz. youtube-callback.js), bu yüzden burada
// yetkisiz bir çağrı bile tek başına bir risk oluşturmaz — yine de
// tutarlılık için diğer tüm admin eylemleriyle aynı kurala tabi tutulur.
export default function handler(request, response) {
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  if (!getSession(request)) {
    return response.status(401).send(html("<h1>Giriş gerekli</h1><p>Bu bağlantıyı panelde oturum açmış bir tarayıcı sekmesinden kullanın.</p>"));
  }
  if (!process.env.YOUTUBE_CLIENT_ID || !process.env.YOUTUBE_CLIENT_SECRET) {
    return response.status(400).send(html("<h1>YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET tanımlı değil</h1><p>Önce Vercel Production ortamına ekleyip yeniden deploy edin, sonra bu bağlantıyı tekrar açın.</p>"));
  }
  const params = new URLSearchParams({
    client_id: process.env.YOUTUBE_CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    // offline: bir refresh_token döner (yalnızca access_token değil) —
    // uygulama kullanıcı tarayıcıda değilken de (cron/otomatik yayın)
    // video yükleyebilsin diye ZORUNLU.
    access_type: "offline",
    // consent: Google, DAHA ÖNCE bu istemciye izin verilmişse normalde bir
    // sonraki yetkilendirmede refresh_token DÖNDÜRMEZ (yalnızca ilk izinde
    // döner) — "prompt=consent" onay ekranını HER SEFERİNDE yeniden
    // gösterip yeni bir refresh_token almayı garanti eder; bu, mevcut token
    // süresi dolduğunda/iptal edildiğinde yeniden bağlanmayı mümkün kılan
    // asıl parametredir.
    prompt: "consent",
    scope: SCOPE
  });
  response.writeHead(302, { Location: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}` });
  response.end();
}
