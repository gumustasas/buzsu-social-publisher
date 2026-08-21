import "dotenv/config";

const baseId = process.env.AIRTABLE_BASE_ID || "apphVqbUQohAMIoWk";
const tableId = process.env.AIRTABLE_TABLE_ID || "tblir7vlazMo8v532";
const fields = ["Başlık", "Kaynak URL", "Görsel URL", "Platform", "Yayın Biçimi", "Yayın Zamanı", "Durum"];

async function main() {
  const params = new URLSearchParams({ pageSize: "100", filterByFormula: "{Durum}='Onaylandı'" });
  fields.forEach((field) => params.append("fields[]", field));
  const response = await fetch(`https://api.airtable.com/v0/${baseId}/${tableId}?${params}`, { headers: { Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}` } });
  const data = await response.json();
  if (!response.ok) throw new Error(`Airtable okunamadı: ${data.error?.message || response.status}`);

  const problems = [];
  const warnings = [];
  for (const record of data.records || []) {
    const f = record.fields || {};
    if (!f["Yayın Zamanı"]) {
      warnings.push(`${record.id}: Yayın Zamanı boş, otomatik yayınlanmayacak`);
      continue;
    }
    for (const [label, value] of [["Görsel URL", f["Görsel URL"]], ["Kaynak URL", f["Kaynak URL"]]]) {
      if (!value) { problems.push(`${record.id}: ${label} boş`); continue; }
      try {
        if (new URL(value).protocol !== "https:") problems.push(`${record.id}: ${label} HTTPS değil`);
      } catch {
        problems.push(`${record.id}: ${label} geçersiz`);
      }
    }
    if (!Array.isArray(f.Platform) || !f.Platform.some((p) => ["Instagram", "Facebook"].includes(p))) problems.push(`${record.id}: Platform boş/geçersiz`);
  }
  console.log(`Onaylı kayıt: ${(data.records || []).length}`);
  if (warnings.length) { console.log("Bilgi:"); warnings.forEach((warning) => console.log(`- ${warning}`)); }
  if (problems.length) {
    console.log("Kontrol gerektirenler:");
    problems.forEach((problem) => console.log(`- ${problem}`));
    process.exitCode = 1;
  } else {
    console.log("URL, görsel, platform ve yayın zamanı kontrolleri geçti.");
  }
}

main().catch((error) => { console.error(error.message); process.exit(1); });
