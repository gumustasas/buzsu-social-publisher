import { createSign } from "node:crypto";

// GA4 Data API'ye servis hesabıyla bağlanır. Bu proje boyunca (Airtable,
// OpenAI, Gemini, Meta) hep ham fetch() kullanıldığı için burada da bir SDK
// (google-auth-library vb.) eklemek yerine servis hesabı JWT'si Node'un
// yerleşik crypto modülüyle imzalanıyor — yeni bir bağımlılık yok.
function base64url(input) {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Bu değişken genelde bir telefonda, bir JSON dosyasından elle kopyala-
// yapıştır ile giriliyor. Bu yolda iki yaygın bozulma oluyor: (1) "\n" kaçış
// dizisi gerçek satır sonuna çevrilmemiş kalıyor, (2) iOS/Safari'nin "akıllı
// noktalama" özelliği PEM başlığındaki "-----" gibi art arda tireleri em/en
// dash'e (—/–) çevirip anahtarı okunamaz hale getiriyor. İkisini de burada
// düzeltiyoruz ki kullanıcı ortam değişkenini elle "temizlemek" zorunda
// kalmasın.
export function normalizePrivateKey(raw) {
  return String(raw || "")
    .trim()
    .replace(/^"|"$/g, "")
    .replace(/\\n/g, "\n")
    .replace(/[‐-―]/g, "-");
}

async function getAccessToken(env) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: env.GA4_CLIENT_EMAIL,
    scope: "https://www.googleapis.com/auth/analytics.readonly",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600
  };
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;
  const privateKey = normalizePrivateKey(env.GA4_PRIVATE_KEY);
  const signature = createSign("RSA-SHA256").update(unsigned).sign(privateKey, "base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const jwt = `${unsigned}.${signature}`;

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error_description || data.error || `Google OAuth HTTP ${response.status}`);
  return data.access_token;
}

export function ga4Configured(env = process.env) {
  return Boolean(env.GA4_PROPERTY_ID && env.GA4_CLIENT_EMAIL && env.GA4_PRIVATE_KEY);
}

async function runReport(path, body, env) {
  const token = await getAccessToken(env);
  const response = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${env.GA4_PROPERTY_ID}:${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || `GA4 HTTP ${response.status}`);
  return data;
}

// Son N günde en çok görüntülenen sayfaları döner. Her GA4 kurulumunda
// otomatik gelen temel bir metrik olduğundan, e-ticaret olayları ayrıca
// kurulmamış olsa bile çalışır.
export async function topViewedPages(env = process.env, { days = 7, limit = 10 } = {}) {
  const data = await runReport("runReport", {
    dateRanges: [{ startDate: `${days}daysAgo`, endDate: "today" }],
    dimensions: [{ name: "pagePath" }, { name: "pageTitle" }],
    metrics: [{ name: "screenPageViews" }],
    orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }],
    limit
  }, env);
  return (data.rows || []).map((row) => ({
    path: row.dimensionValues?.[0]?.value || "",
    title: row.dimensionValues?.[1]?.value || "",
    views: Number(row.metricValues?.[0]?.value || 0)
  }));
}

// GA4'te add_to_cart olayı (geliştirilmiş e-ticaret) kurulmamış olabilir;
// bu durumda GA4 hata döner. Hata durumunda boş dizi döner — çağıran taraf
// bunu "bu veri yok" olarak yorumlar, sayfa görüntüleme verisini etkilemez.
export async function topAddToCart(env = process.env, { days = 7, limit = 10 } = {}) {
  try {
    const data = await runReport("runReport", {
      dateRanges: [{ startDate: `${days}daysAgo`, endDate: "today" }],
      dimensions: [{ name: "itemName" }],
      metrics: [{ name: "addToCarts" }],
      orderBys: [{ metric: { metricName: "addToCarts" }, desc: true }],
      limit
    }, env);
    return (data.rows || []).map((row) => ({ item: row.dimensionValues?.[0]?.value || "", addToCarts: Number(row.metricValues?.[0]?.value || 0) }));
  } catch {
    return [];
  }
}

// GA4 Realtime API: son ~30 dakikada siteyi kullanan aktif ziyaretçi sayısı.
export async function activeVisitors(env = process.env) {
  const data = await runReport("runRealtimeReport", { metrics: [{ name: "activeUsers" }] }, env);
  return Number(data.rows?.[0]?.metricValues?.[0]?.value || 0);
}
