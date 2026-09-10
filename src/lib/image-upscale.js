// compose_product_video'nun opsiyonel, ÜCRETLİ görsel büyütme adımı: kaynak
// ürün fotoğrafı 1080x1920'nin çok altında (site thumbnail'ı gibi) olduğunda
// composeFramedBackground'daki sharp .sharpen() yalnızca kenar kontrastını
// artırır, kayıp detayı geri getirmez — gerçek çözüm görseli Ken Burns
// animasyonundan ÖNCE AI ile büyütmektir (bkz. src/post-branding.js'teki
// composeFramedBackground yorumu). Replicate'in nightmareai/real-esrgan
// modelini kullanır; her çağrı gerçek para harcar, bu yüzden çağıran taraf
// (api/mcp.js) açık bir confirmed:true/upscaleImages opt-in'i olmadan bu
// modülü hiç çağırmamalıdır — burada sessiz bir varsayılan/otomasyon yok.
const REPLICATE_MODEL = "nightmareai/real-esrgan";
const DEFAULT_POLL_INTERVAL_MS = 2000;
const DEFAULT_TIMEOUT_MS = 60000;
const TERMINAL_STATUSES = new Set(["succeeded", "failed", "canceled"]);
const MAX_RATE_LIMIT_RETRIES = 3;
const DEFAULT_RATE_LIMIT_RETRY_MS = 5000;
const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Replicate, hesap bakiyesi düşükken (<$5) veya kısa süreli organik yoğunlukta
// tahmin oluşturmayı 429 ile hız sınırlayabiliyor — gerçek bir render'da
// gözlemlendi ("... resets in ~7s"). Yanıt ne kadar beklenmesi gerektiğini
// söylüyor; bunu ayrıştırıp o kadar bekliyoruz, ayrıştırılamazsa sabit bir
// süreye düşüyoruz.
function parseRetryAfterMs(detail) {
  const match = /resets in ~?(\d+(?:\.\d+)?)s/i.exec(String(detail || ""));
  if (!match) return DEFAULT_RATE_LIMIT_RETRY_MS;
  return Math.ceil(Number(match[1]) * 1000);
}

async function createPrediction(dataUri, { apiToken, fetchImpl, scale, faceEnhance, sleepImpl, maxRetries = MAX_RATE_LIMIT_RETRIES }) {
  for (let attempt = 0; ; attempt++) {
    const response = await fetchImpl(`https://api.replicate.com/v1/models/${REPLICATE_MODEL}/predictions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
        Prefer: "wait=30"
      },
      body: JSON.stringify({ input: { image: dataUri, scale, face_enhance: faceEnhance } })
    });
    if (response.ok) return response.json();

    let detail = "";
    try { detail = (await response.json())?.detail || ""; } catch { /* gövde olmayabilir */ }

    if (response.status === 429 && attempt < maxRetries) {
      await sleepImpl(parseRetryAfterMs(detail));
      continue;
    }
    throw new Error(`Replicate API hatası (HTTP ${response.status})${detail ? `: ${detail}` : "."}`);
  }
}

async function pollUntilTerminal(prediction, {
  apiToken,
  fetchImpl,
  sleepImpl = defaultSleep,
  nowImpl = Date.now,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  timeoutMs = DEFAULT_TIMEOUT_MS
}) {
  const startedAt = nowImpl();
  let current = prediction;
  while (!TERMINAL_STATUSES.has(current.status)) {
    if (nowImpl() - startedAt > timeoutMs) throw new Error("Replicate tahmini zaman aşımına uğradı.");
    const pollUrl = current.urls?.get;
    if (!pollUrl) throw new Error("Replicate yanıtında poll URL'i (urls.get) yok.");
    await sleepImpl(pollIntervalMs);
    const response = await fetchImpl(pollUrl, { headers: { Authorization: `Bearer ${apiToken}` } });
    if (!response.ok) throw new Error(`Replicate durum sorgusu başarısız (HTTP ${response.status}).`);
    current = await response.json();
  }
  return current;
}

// Bir görsel arabelleğini Replicate'in Real-ESRGAN modeliyle büyütür ve
// sonucun herkese açık geçici Replicate URL'ini döner (kalıcı depolama
// çağıranın sorumluluğundadır — ör. fetchPublicImage ile indirip Blob'a
// yeniden yüklemek). apiToken verilmezse (veya env'de yoksa) hiçbir ağ
// çağrısı yapılmadan hata fırlatılır.
export async function upscaleImage(buffer, mimeType, {
  apiToken = process.env.REPLICATE_API_TOKEN,
  fetchImpl = fetch,
  scale = 4,
  faceEnhance = false,
  sleepImpl = defaultSleep,
  nowImpl,
  pollIntervalMs,
  timeoutMs,
  maxRateLimitRetries
} = {}) {
  if (!apiToken) throw new Error("REPLICATE_API_TOKEN tanımlı değil — görsel büyütme yapılamaz.");
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error("Geçerli bir görsel arabelleği gerekli.");

  const dataUri = `data:${mimeType};base64,${buffer.toString("base64")}`;
  const initial = await createPrediction(dataUri, { apiToken, fetchImpl, scale, faceEnhance, sleepImpl, maxRetries: maxRateLimitRetries });
  const finalPrediction = TERMINAL_STATUSES.has(initial.status)
    ? initial
    : await pollUntilTerminal(initial, { apiToken, fetchImpl, sleepImpl, nowImpl, pollIntervalMs, timeoutMs });

  if (finalPrediction.status !== "succeeded") {
    const reason = finalPrediction.error ? ` — ${finalPrediction.error}` : "";
    throw new Error(`Replicate tahmini başarısız (${finalPrediction.status})${reason}.`);
  }
  const outputUrl = Array.isArray(finalPrediction.output) ? finalPrediction.output[0] : finalPrediction.output;
  if (!outputUrl) throw new Error("Replicate yanıtında çıktı URL'i bulunamadı.");
  return outputUrl;
}
