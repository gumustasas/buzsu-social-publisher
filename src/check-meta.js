import "dotenv/config";

const required = [
  "META_ACCESS_TOKEN",
  "META_GRAPH_VERSION",
  "META_INSTAGRAM_ACCOUNT_ID",
  "META_FACEBOOK_PAGE_ID"
];

for (const name of required) {
  if (!process.env[name]) throw new Error(`${name} eksik.`);
}

const baseUrl = `https://graph.facebook.com/${process.env.META_GRAPH_VERSION}`;
const headers = { Authorization: `Bearer ${process.env.META_ACCESS_TOKEN}` };

async function read(path, params = {}) {
  const url = new URL(`${baseUrl}/${path}`);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  const response = await fetch(url, { headers });
  const data = await response.json();
  if (!response.ok || data.error) {
    throw new Error(`Meta kontrolü başarısız: ${data.error?.message || `HTTP ${response.status}`}`);
  }
  return data;
}

const user = await read("me", { fields: "id,name" });
const instagram = await read(process.env.META_INSTAGRAM_ACCOUNT_ID, { fields: "id,username" });
let pages = { data: [] };
try {
  pages = await read("me/accounts", { fields: "id,name" });
} catch (error) {
  console.log(`Facebook sayfa listesi: hazır değil (${error.message})`);
}
let page = null;
try {
  page = await read(process.env.META_FACEBOOK_PAGE_ID, { fields: "id,name,access_token" });
} catch (error) {
  console.log(`Facebook sayfa erişimi: hazır değil (${error.message})`);
}

console.log("Meta bağlantısı başarılı.");
console.log(`Kullanıcı: ${user.name || "okundu"}`);
console.log(`Instagram: ${instagram.username || "okundu"}`);
console.log(`Facebook sayfa sayısı: ${pages.data?.length || 0}`);
console.log(`Seçilen Facebook sayfası erişilebilir: ${page?.id === process.env.META_FACEBOOK_PAGE_ID ? "evet" : "hayır"}`);
