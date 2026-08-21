import "dotenv/config";

const {
  AIRTABLE_TOKEN,
  AIRTABLE_BASE_ID = "apphVqbUQohAMIoWk",
  AIRTABLE_TABLE_ID = "tblir7vlazMo8v532"
} = process.env;

const FIELD_NAMES = [
  "Başlık",
  "İçerik Türü",
  "Kaynak URL",
  "Görsel URL",
  "Instagram Metni",
  "Facebook Metni",
  "Hashtagler",
  "Platform",
  "Durum",
  "Yayın Tarihi",
  "Not"
];

function requireEnv(name, value) {
  if (!value) {
    throw new Error(`${name} eksik. .env dosyasına eklenmeli.`);
  }
}

function airtableUrl(offset) {
  const params = new URLSearchParams();
  params.set("pageSize", "100");
  FIELD_NAMES.forEach((fieldName) => params.append("fields[]", fieldName));
  params.set("filterByFormula", "{Durum}='Onaylandı'");

  if (offset) {
    params.set("offset", offset);
  }

  return `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE_ID}?${params.toString()}`;
}

async function fetchApprovedRecords() {
  requireEnv("AIRTABLE_TOKEN", AIRTABLE_TOKEN);

  const records = [];
  let offset;

  do {
    const response = await fetch(airtableUrl(offset), {
      headers: {
        Authorization: `Bearer ${AIRTABLE_TOKEN}`
      }
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Airtable okunamadı: HTTP ${response.status} ${body}`);
    }

    const data = await response.json();
    records.push(...(data.records || []));
    offset = data.offset;
  } while (offset);

  return records;
}

function formatRecord(record) {
  const fields = record.fields || {};

  return {
    id: record.id,
    title: fields["Başlık"] || "",
    type: fields["İçerik Türü"] || "",
    url: fields["Kaynak URL"] || "",
    platforms: fields["Platform"] || [],
    instagramText: fields["Instagram Metni"] || "",
    facebookText: fields["Facebook Metni"] || "",
    hashtags: fields["Hashtagler"] || "",
    publishDate: fields["Yayın Tarihi"] || "",
    note: fields["Not"] || ""
  };
}

async function main() {
  const approvedRecords = await fetchApprovedRecords();
  const posts = approvedRecords.map(formatRecord);

  console.log(`Onaylı kayıt sayısı: ${posts.length}`);

  if (posts.length === 0) {
    console.log("Paylaşıma hazır kayıt yok. Airtable'da Durum alanını Onaylandı yapınca burada görünür.");
    return;
  }

  for (const post of posts) {
    console.log("\n---");
    console.log(`Kayıt: ${post.id}`);
    console.log(`Başlık: ${post.title}`);
    console.log(`Tür: ${post.type}`);
    console.log(`URL: ${post.url}`);
    console.log(`Platform: ${post.platforms.join(", ")}`);
    console.log(`Instagram: ${post.instagramText}`);
    console.log(`Facebook: ${post.facebookText}`);
    console.log(`Hashtagler: ${post.hashtags}`);
    console.log(`Yayın Tarihi: ${post.publishDate || "Belirtilmedi"}`);
    console.log(`Not: ${post.note || "-"}`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
