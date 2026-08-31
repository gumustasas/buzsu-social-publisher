// Yayın hatalarını dış kanala (Slack uyumlu ya da genel bir webhook) bildirir.
// ALERT_WEBHOOK_URL tanımlı değilse sessizce hiçbir şey yapmaz — bildirim
// opsiyoneldir ve asla yayın akışını kesmemeli, bu yüzden kendi hatasını da
// yutar. runPublisher() her kaydı sırayla işlerken bu çağrıyı bekliyor; bir
// zaman aşımı olmazsa yanıt vermeyen bir webhook, sıradaki kayıtların
// işlenmesini süresiz durdurabilirdi.
const webhookUrl = process.env.ALERT_WEBHOOK_URL || "";
const WEBHOOK_TIMEOUT_MS = 5000;

export async function notifyFailure(message) {
  if (!webhookUrl) return;
  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: message }),
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS)
    });
    if (!response.ok) console.error(`Bildirim webhook'u HTTP ${response.status} döndü.`);
  } catch (error) {
    console.error(`Bildirim gönderilemedi: ${error.message}`);
  }
}
