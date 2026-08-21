export function parsePublishTime(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function selectDueRecords(records, now = new Date(), limit = 1) {
  return records
    .map((record) => ({ record, publishTime: parsePublishTime(record.fields?.["Yayın Zamanı"]) }))
    .filter(({ publishTime }) => publishTime && publishTime.getTime() <= now.getTime())
    .sort((a, b) => a.publishTime - b.publishTime)
    .slice(0, limit)
    .map(({ record }) => record);
}

export function publicationFormat(fields) {
  return fields["Yayın Biçimi"] || "Gönderi";
}

export function slugify(value) {
  return String(value || "icerik")
    .replace(/[ıİ]/g, "i")
    .replace(/[ğĞ]/g, "g")
    .replace(/[şŞ]/g, "s")
    .replace(/[üÜ]/g, "u")
    .replace(/[öÖ]/g, "o")
    .replace(/[çÇ]/g, "c")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase() || "icerik";
}

export function withUtm(value, { source, title }) {
  if (!value) return "";
  const url = new URL(value);
  url.searchParams.set("utm_source", source);
  url.searchParams.set("utm_medium", "organic_social");
  url.searchParams.set("utm_campaign", `buzsu-${slugify(title)}`);
  return url.toString();
}
