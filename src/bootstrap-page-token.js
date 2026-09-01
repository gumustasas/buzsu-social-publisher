import "dotenv/config";
import fs from "node:fs";
import { META_GRAPH_VERSION, assertMetaGraphVersionCurrent } from "./lib/config.js";

const { META_ACCESS_TOKEN, META_FACEBOOK_PAGE_ID } = process.env;
const envPath = new URL("../.env", import.meta.url);

if (!META_ACCESS_TOKEN || !META_FACEBOOK_PAGE_ID) {
  throw new Error("Meta kullanıcı tokenı veya Facebook sayfa ID'si eksik.");
}
assertMetaGraphVersionCurrent();

const url = new URL(`https://graph.facebook.com/${META_GRAPH_VERSION}/${META_FACEBOOK_PAGE_ID}`);
url.searchParams.set("fields", "id,name,access_token");
const response = await fetch(url, {
  headers: { Authorization: `Bearer ${META_ACCESS_TOKEN}` }
});
const data = await response.json();

if (!response.ok || data.error || !data.access_token) {
  throw new Error(`Facebook sayfa tokenı alınamadı: ${data.error?.message || `HTTP ${response.status}`}`);
}

let envText = fs.readFileSync(envPath, "utf8");
if (/^META_FACEBOOK_PAGE_ACCESS_TOKEN=/m.test(envText)) {
  envText = envText.replace(/^META_FACEBOOK_PAGE_ACCESS_TOKEN=.*$/m, `META_FACEBOOK_PAGE_ACCESS_TOKEN=${data.access_token}`);
} else {
  envText += `\nMETA_FACEBOOK_PAGE_ACCESS_TOKEN=${data.access_token}\n`;
}
fs.writeFileSync(envPath, envText, "utf8");
console.log(`Facebook sayfa tokenı yerel .env dosyasına yazıldı: ${data.name || "sayfa"}`);
