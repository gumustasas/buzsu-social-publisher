import "dotenv/config";
import { getSession } from "../src/auth.js";
import { getAccessToken } from "../src/youtube-publish.js";

function authorized(request) { return Boolean(getSession(request)); }

// Dashboard'daki "Platform bağlantıları" panelinin YouTube Shorts satırını
// besler (bkz. dashboard.html #youtube-connection-status). Daha önce bu
// satır SABİT "Bağlı değil" metniydi, hiçbir gerçek duruma bakmıyordu.
//
// getAccessToken bir OAuth token YENİLEME çağrısıdır — Google'ın kendisi
// bunu ÜCRETSİZ sunar (bkz. src/lib/video-provider-capabilities.js'teki
// GET /v1beta/models discovery çağrısı için aynı gerekçe) ve zaten her
// gerçek yüklemeden (uploadShort) önce AYNEN yapılıyor — burada YENİ bir
// maliyet/istek türü eklenmiyor, yalnızca aynı çağrı erkenden/bağımsız
// olarak tetiklenip sonucu raporlanıyor. Elde edilen access_token hiçbir
// yerde saklanmaz/döndürülmez, YouTube Data API'ye AYRICA bir istek
// atılmaz — yalnızca refresh_token'ın hâlâ geçerli olup olmadığı doğrulanır.
export default async function handler(request, response) {
  if (!authorized(request)) return response.status(401).json({ error: "Unauthorized" });

  const configured = Boolean(process.env.YOUTUBE_CLIENT_ID && process.env.YOUTUBE_CLIENT_SECRET && process.env.YOUTUBE_REFRESH_TOKEN);
  if (!configured) {
    return response.status(200).json({ ok: true, configured: false, connected: false, error: null });
  }

  try {
    await getAccessToken(process.env);
    return response.status(200).json({ ok: true, configured: true, connected: true, error: null });
  } catch (error) {
    // Hata mesajı Google'ın döndürdüğü metni taşıyabilir (ör. "Token has
    // been expired or revoked") — bu, YOUTUBE_CLIENT_SECRET/REFRESH_TOKEN
    // değerlerinin kendisini İÇERMEZ (yalnızca error_description), bu
    // yüzden dashboard'da olduğu gibi gösterilmesi güvenlidir.
    return response.status(200).json({ ok: true, configured: true, connected: false, error: error.message });
  }
}
