import "dotenv/config";
import fs from "node:fs";

const { META_ACCESS_TOKEN, META_APP_SECRET, META_GRAPH_VERSION } = process.env;
const envPath = new URL("../.env", import.meta.url);

if (!META_ACCESS_TOKEN || !META_APP_SECRET || !META_GRAPH_VERSION) {
  throw new Error("Meta kullanıcı tokenı, uygulama secretı veya Graph sürümü eksik.");
}

const url = new URL(`https://graph.facebook.com/${META_GRAPH_VERSION}/oauth/access_token`);
url.searchParams.set("grant_type", "fb_exchange_token");
url.searchParams.set("client_id", "1962006424091247");
url.searchParams.set("client_secret", META_APP_SECRET);
url.searchParams.set("fb_exchange_token", META_ACCESS_TOKEN);

const response = await fetch(url);
const data = await response.json();
if (!response.ok || data.error || !data.access_token) {
  throw new Error(`Uzun süreli token alınamadı: ${data.error?.message || `HTTP ${response.status}`}`);
}

let envText = fs.readFileSync(envPath, "utf8");
envText = envText.replace(/^META_ACCESS_TOKEN=.*$/m, `META_ACCESS_TOKEN=${data.access_token}`);
fs.writeFileSync(envPath, envText, "utf8");
console.log(`Uzun süreli Meta tokenı yerel .env dosyasına yazıldı. Süre: ${data.expires_in ? `${data.expires_in} saniye` : "Meta tarafından belirtildi"}`);
