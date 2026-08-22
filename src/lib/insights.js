// Instagram/Facebook gönderilerinin gerçek etkileşim sayılarını okur.
// Bilinçli olarak yalnızca her zaman erişilebilir temel alanlar kullanılır
// (like_count/comments_count, likes.summary/comments.summary/shares) —
// ayrıntılı "impressions/reach" metrikleri ek izin gerektirir ve API
// sürümüne göre sık değiştiği için buraya dahil edilmedi. Tek bir gönderi
// başarısız olursa çağıran taraf diğerlerini etkilemeden devam edebilir.
async function graphGet(path, accessToken, graphVersion) {
  const response = await fetch(`https://graph.facebook.com/${graphVersion}/${path}`, { headers: { Authorization: `Bearer ${accessToken}` } });
  const data = await response.json();
  if (!response.ok || data.error) throw new Error(data.error?.message || `Graph HTTP ${response.status}`);
  return data;
}

export async function fetchInstagramEngagement(mediaId, env = process.env) {
  const data = await graphGet(`${mediaId}?fields=like_count,comments_count`, env.META_ACCESS_TOKEN, env.META_GRAPH_VERSION);
  return { likes: Number(data.like_count || 0), comments: Number(data.comments_count || 0), shares: 0 };
}

export async function fetchFacebookEngagement(postId, env = process.env) {
  const data = await graphGet(`${postId}?fields=likes.summary(true),comments.summary(true),shares`, env.META_FACEBOOK_PAGE_ACCESS_TOKEN, env.META_GRAPH_VERSION);
  return { likes: Number(data.likes?.summary?.total_count || 0), comments: Number(data.comments?.summary?.total_count || 0), shares: Number(data.shares?.count || 0) };
}

export function withinDays(isoDate, days, now = new Date()) {
  if (!isoDate) return false;
  const time = Date.parse(isoDate);
  if (Number.isNaN(time)) return false;
  return now.getTime() - time <= days * 24 * 60 * 60 * 1000 && time <= now.getTime();
}
