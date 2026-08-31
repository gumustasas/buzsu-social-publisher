// Yayın hatalarını dış kanala (Slack uyumlu ya da genel bir webhook) bildirir.
// ALERT_WEBHOOK_URL tanımlı değilse sessizce hiçbir şey yapmaz — bildirim
// opsiyoneldir ve asla yayın akışını kesmemeli, bu yüzden kendi hatasını da
// yutar.
const webhookUrl = process.env.ALERT_WEBHOOK_URL || "";

export async function notifyFailure(message) {
  if (!webhookUrl) return;
  try {
    const isSlack = webhookUrl.includes("hooks.slack.com");
    const body = isSlack ? { text: message } : { text: message };
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    if (!response.ok) console.error(`Bildirim webhook'u HTTP ${response.status} döndü.`);
  } catch (error) {
    console.error(`Bildirim gönderilemedi: ${error.message}`);
  }
}
