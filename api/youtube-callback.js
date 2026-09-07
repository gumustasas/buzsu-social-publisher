import "dotenv/config";

// Google OAuth 2.0'ın bir kerelik yetkilendirme dönüşü. Kimlik doğrulaması
// yok (getSession gerekmiyor) — bu adrese Google kendisi, kullanıcının
// tarayıcısı üzerinden yönlendirir, uygulama oturumuyla ilgisi yok (bkz.
// api/x-callback.js'teki benzer not). Kullanıcı önce Google Cloud Console'da
// bir OAuth Client ID/Secret oluşturup Vercel'e YOUTUBE_CLIENT_ID/
// YOUTUBE_CLIENT_SECRET olarak eklemeli, sonra şu URL'i tarayıcıda açmalı:
//
// https://accounts.google.com/o/oauth2/v2/auth?client_id=<YOUTUBE_CLIENT_ID>
//   &redirect_uri=https://buzsu-social-publisher.vercel.app/api/youtube-callback
//   &response_type=code&access_type=offline&prompt=consent
//   &scope=https://www.googleapis.com/auth/youtube.upload
//
// Google giriş+onay sonrası buraya ?code=... ile döner; burada tek seferlik
// authorization code, kalıcı bir refresh_token ile değiştirilip ekranda
// gösterilir — kullanıcı onu Vercel'e YOUTUBE_REFRESH_TOKEN olarak ekler.
// Refresh token hiçbir yerde saklanmaz, yalnızca bu sayfada bir kez görünür.
function html(body) {
  return `<!doctype html><meta charset="utf-8"><body style="font:14px/1.5 system-ui;max-width:640px;margin:40px auto;padding:0 16px">${body}</body>`;
}

function esc(value) {
  return String(value).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

export default async function handler(request, response) {
  const redirectUri = "https://buzsu-social-publisher.vercel.app/api/youtube-callback";
  const url = new URL(request.url, redirectUri);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  response.setHeader("Content-Type", "text/html; charset=utf-8");

  if (error) return response.status(400).send(html(`<h1>Google izni reddedildi</h1><p>${error}</p>`));
  if (!process.env.YOUTUBE_CLIENT_ID || !process.env.YOUTUBE_CLIENT_SECRET) {
    return response.status(400).send(html("<h1>YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET tanımlı değil</h1><p>Önce Vercel Production ortamına ekleyip yeniden deploy edin, sonra yetkilendirme adımını tekrarlayın.</p>"));
  }
  if (!code) return response.status(400).send(html("<h1>Kod bulunamadı</h1><p>Bu sayfaya doğrudan değil, Google'ın yetkilendirme akışı üzerinden gelmelisiniz.</p>"));

  try {
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code, client_id: process.env.YOUTUBE_CLIENT_ID, client_secret: process.env.YOUTUBE_CLIENT_SECRET, redirect_uri: redirectUri, grant_type: "authorization_code" })
    });
    const data = await tokenResponse.json();
    if (!tokenResponse.ok) throw new Error(data.error_description || data.error || `HTTP ${tokenResponse.status}`);
    if (!data.refresh_token) {
      return response.status(200).send(html("<h1>Refresh token alınamadı</h1><p>Google zaten daha önce bu uygulamaya izin vermişse refresh_token döndürmeyebilir. Google hesabınızda Ayarlar → Güvenlik → Üçüncü taraf erişimi kısmından bu uygulamanın erişimini kaldırıp tekrar deneyin (yetkilendirme URL'inde <code>prompt=consent</code> zaten var).</p>"));
    }
    return response.status(200).send(html(`<h1>YouTube bağlantısı tamam</h1><p>Aşağıdaki değeri kopyalayıp Vercel Production ortamına <b>YOUTUBE_REFRESH_TOKEN</b> adıyla ekleyin. Bu sayfa bir daha gösterilmeyecek.</p><textarea readonly style="width:100%;min-height:80px;font:12px/1.4 ui-monospace,monospace">${esc(data.refresh_token)}</textarea>`));
  } catch (err) {
    return response.status(500).send(html(`<h1>Hata</h1><p>${err.message}</p>`));
  }
}
