import "dotenv/config";

const checks = [
  {
    name: "AIRTABLE_TOKEN",
    requiredFor: "Airtable onay kuyruğunu okumak"
  },
  {
    name: "AIRTABLE_BASE_ID",
    requiredFor: "Doğru Airtable base seçimi",
    fallback: "apphVqbUQohAMIoWk"
  },
  {
    name: "AIRTABLE_TABLE_ID",
    requiredFor: "Sosyal Medya Takvimi tablosu",
    fallback: "tblir7vlazMo8v532"
  },
  {
    name: "META_ACCESS_TOKEN",
    requiredFor: "Canlı Instagram/Facebook paylaşımı"
  },
  {
    name: "META_APP_SECRET",
    requiredFor: "Uzun süreli Meta token dönüşümü"
  },
  {
    name: "META_FACEBOOK_PAGE_ACCESS_TOKEN",
    requiredFor: "Facebook sayfa paylaşımı"
  },
  {
    name: "META_INSTAGRAM_ACCOUNT_ID",
    requiredFor: "Instagram hesabı seçimi"
  },
  {
    name: "META_FACEBOOK_PAGE_ID",
    requiredFor: "Facebook sayfası seçimi"
  },
  {
    name: "META_GRAPH_VERSION",
    requiredFor: "Meta Graph API sürümü"
  },
  {
    name: "SOCIAL_POST_LIMIT",
    requiredFor: "Tek seferde işlenecek kayıt sayısı",
    fallback: "1"
  },
  {
    name: "ENABLE_LIVE_POSTING",
    requiredFor: "Canlı paylaşımı bilinçli açmak",
    fallback: "false"
  },
  {
    name: "CRON_SECRET",
    requiredFor: "Cron ve önizleme paneli erişimi"
  }
];

function statusFor(check) {
  const value = process.env[check.name];

  if (value) {
    return "hazır";
  }

  if (check.fallback) {
    return `varsayılan kullanılacak (${check.fallback})`;
  }

  return "eksik";
}

console.log("Buzsu sosyal medya otomasyonu env kontrolü");
console.log("Gizli değerler ekrana yazılmaz.\n");

for (const check of checks) {
  console.log(`${check.name}: ${statusFor(check)} - ${check.requiredFor}`);
}

const livePostingEnabled = process.env.ENABLE_LIVE_POSTING === "true";

console.log("\nCanlı paylaşım durumu:");
if (livePostingEnabled) {
  console.log("ENABLE_LIVE_POSTING=true. Meta bilgileri tamamlanmadan canlı paylaşım denenmemeli.");
} else {
  console.log("Kapalı. Instagram/Facebook paylaşımı yapılmaz.");
}
