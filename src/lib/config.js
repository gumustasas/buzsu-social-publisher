// Airtable base/tablo ID'leri ve Meta Graph API sürümü için tekil kaynak.
// Önceden bu değerler ~15 dosyada literal fallback olarak tekrarlanıyordu;
// ikinci bir marka/hesap eklenmesi ya da base değişimi tek yerden yönetilsin
// diye buraya toplandı. Her export, aynı isimdeki env değişkeniyle override
// edilebilir.

export const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID || "apphVqbUQohAMIoWk";
export const AIRTABLE_TABLE_ID = process.env.AIRTABLE_TABLE_ID || "tblir7vlazMo8v532";
export const AIRTABLE_SETTINGS_TABLE_ID = process.env.AIRTABLE_SETTINGS_TABLE_ID || "tblcoBjEWj7UbQ0wr";
export const AIRTABLE_AUTOPILOT_RECORD_ID = process.env.AIRTABLE_AUTOPILOT_RECORD_ID || "recserXsAErwqHUbZ";
export const AIRTABLE_USER_TABLE_ID = process.env.AIRTABLE_USER_TABLE_ID || "tblH84os6uOYsy4AK";

// Meta, Graph API sürümlerini yaklaşık 2 yılda bir sonlandırıyor
// (https://developers.facebook.com/docs/graph-api/changelog). Bu sabit
// yalnızca META_GRAPH_VERSION env'de tanımlı değilken devreye giren bir
// yedektir; periyodik olarak güncel tutulmalı, kalıcı bir çözüm değildir.
export const DEFAULT_META_GRAPH_VERSION = "v25.0";
export const META_GRAPH_VERSION = process.env.META_GRAPH_VERSION || DEFAULT_META_GRAPH_VERSION;

// Meta'nın resmi olarak sonlandırdığı sürümler. Biri env'de kalmışsa Meta'nın
// kendi (çoğu zaman anlaşılması güç) hata mesajını beklemeden erken uyarır.
const EXPIRED_META_GRAPH_VERSIONS = new Set(["v15.0", "v16.0", "v17.0", "v18.0", "v19.0"]);

export function assertMetaGraphVersionCurrent() {
  if (EXPIRED_META_GRAPH_VERSIONS.has(META_GRAPH_VERSION)) {
    throw new Error(
      `META_GRAPH_VERSION=${META_GRAPH_VERSION} Meta tarafından sonlandırıldı. .env dosyasında güncel bir sürüme (örn. ${DEFAULT_META_GRAPH_VERSION}) yükseltin.`
    );
  }
}
