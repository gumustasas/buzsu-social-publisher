// Instagram/Facebook gönderilerinin gerçek etkileşim sayılarını okur.
// Bilinçli olarak yalnızca her zaman erişilebilir temel alanlar kullanılır
// (like_count/comments_count, likes.summary/comments.summary/shares) —
// ayrıntılı "impressions/reach" metrikleri ek izin gerektirir ve API
// sürümüne göre sık değiştiği için buraya dahil edilmedi. Tek bir gönderi
// başarısız olursa çağıran taraf diğerlerini etkilemeden devam edebilir.
import { META_GRAPH_VERSION } from "./config.js";

async function graphGet(path, accessToken, graphVersion) {
  const response = await fetch(`https://graph.facebook.com/${graphVersion}/${path}`, { headers: { Authorization: `Bearer ${accessToken}` } });
  const data = await response.json();
  if (!response.ok || data.error) throw new Error(data.error?.message || `Graph HTTP ${response.status}`);
  return data;
}

// env.META_GRAPH_VERSION tanımlı değilse (config.js'teki merkezi varsayılan
// gibi) META_GRAPH_VERSION'a düşülür — aksi halde "/undefined/..." isteği
// atılıp bu gönderi sessizce "failures" sayacına eklenirdi.
export async function fetchInstagramEngagement(mediaId, env = process.env) {
  const data = await graphGet(`${mediaId}?fields=like_count,comments_count`, env.META_ACCESS_TOKEN, env.META_GRAPH_VERSION || META_GRAPH_VERSION);
  return { likes: Number(data.like_count || 0), comments: Number(data.comments_count || 0), shares: 0 };
}

export async function fetchFacebookEngagement(postId, env = process.env) {
  const data = await graphGet(`${postId}?fields=likes.summary(true),comments.summary(true),shares`, env.META_FACEBOOK_PAGE_ACCESS_TOKEN, env.META_GRAPH_VERSION || META_GRAPH_VERSION);
  return { likes: Number(data.likes?.summary?.total_count || 0), comments: Number(data.comments?.summary?.total_count || 0), shares: Number(data.shares?.count || 0) };
}

export function withinDays(isoDate, days, now = new Date()) {
  if (!isoDate) return false;
  const time = Date.parse(isoDate);
  if (Number.isNaN(time)) return false;
  return now.getTime() - time <= days * 24 * 60 * 60 * 1000 && time <= now.getTime();
}

// "Önerilen paylaşım saati" için kaba bir gün-içi dilim (daypart) bölümü.
// Tek tek saat (0-23) yerine 5 geniş dilim kullanılıyor çünkü küçük bir
// işletmenin haftalık yayın sayısı (genelde <20) saat bazında anlamlı bir
// örneklem oluşturmaz; dilim bazında bile veri azsa çağıran taraf
// (api/insights.js) bunu "yeterli veri yok" olarak ele almalı (bkz. sampleSize).
export const ENGAGEMENT_DAYPARTS = [
  { key: "morning", label: "Sabah (06:00-11:00)", startHour: 6, endHour: 11 },
  { key: "midday", label: "Öğlen (11:00-14:00)", startHour: 11, endHour: 14 },
  { key: "afternoon", label: "Öğleden sonra (14:00-18:00)", startHour: 14, endHour: 18 },
  { key: "evening", label: "Akşam (18:00-22:00)", startHour: 18, endHour: 22 },
  { key: "night", label: "Gece (22:00-06:00)", startHour: 22, endHour: 6 }
];

// Türkiye 2016'dan beri yaz saati uygulamıyor (sabit UTC+3); Intl ile
// hesaplamak, DST karmaşasına girmeden gelecekte de doğru kalır.
function istanbulHour(isoDate) {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return null;
  const formatted = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Istanbul", hour: "2-digit", hour12: false }).format(date);
  const hour = Number(formatted);
  return Number.isNaN(hour) ? null : hour % 24;
}

function daypartForHour(hour) {
  for (const part of ENGAGEMENT_DAYPARTS) {
    if (part.startHour < part.endHour) {
      if (hour >= part.startHour && hour < part.endHour) return part.key;
    } else if (hour >= part.startHour || hour < part.endHour) {
      return part.key;
    }
  }
  return ENGAGEMENT_DAYPARTS[ENGAGEMENT_DAYPARTS.length - 1].key;
}

// entries: [{ publishAt: isoString, engagement: number }] — her biri tek bir
// yayınlanmış kaydın toplam etkileşimi (beğeni+yorum+paylaşım). Geçersiz/eksik
// publishAt'li girdiler sessizce atlanır.
export function summarizeEngagementByDaypart(entries) {
  const totals = new Map();
  for (const entry of entries || []) {
    const hour = istanbulHour(entry?.publishAt);
    if (hour === null) continue;
    const key = daypartForHour(hour);
    const current = totals.get(key) || { total: 0, count: 0 };
    current.total += Number(entry.engagement) || 0;
    current.count += 1;
    totals.set(key, current);
  }
  const byDaypart = ENGAGEMENT_DAYPARTS.map((part) => {
    const stats = totals.get(part.key);
    const count = stats?.count || 0;
    return { key: part.key, label: part.label, count, avgEngagement: count ? Math.round((stats.total / count) * 10) / 10 : 0 };
  });
  const withData = byDaypart.filter((part) => part.count > 0);
  const best = withData.length ? withData.reduce((a, b) => (b.avgEngagement > a.avgEngagement ? b : a)) : null;
  return { byDaypart, best, sampleSize: withData.reduce((sum, part) => sum + part.count, 0) };
}
