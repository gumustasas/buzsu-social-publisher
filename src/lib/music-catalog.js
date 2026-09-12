// compose_product_video'nun ÜCRETSİZ, otomatik arka plan müziği havuzu.
// musicUrl verilmediğinde video sessiz çıkmasın diye burada seçim yapılır.
// Her giriş Mixkit'in kalıcı CDN dosya URL'ine işaret eder (Mixkit Free
// License — ticari kullanım serbest, atıf gerekmez) — yeniden barındırma
// yapılmaz, render worker doğrudan bu URL'den indirir (fetchPublicAudio).
export const MUSIC_CATEGORIES = ["kurumsal_pozitif", "modern_teknoloji", "sakin_premium", "enerjik_reklam", "sinematik"];

export const MUSIC_CATALOG = {
  kurumsal_pozitif: [
    { title: "Close Up", audioUrl: "https://assets.mixkit.co/music/1167/1167.mp3" },
    { title: "It's Love", audioUrl: "https://assets.mixkit.co/music/834/834.mp3" },
    { title: "PlaceIt World 01", audioUrl: "https://assets.mixkit.co/music/724/724.mp3" },
    { title: "Motivating Mornings", audioUrl: "https://assets.mixkit.co/music/470/470.mp3" },
    { title: "Your Breath", audioUrl: "https://assets.mixkit.co/music/568/568.mp3" },
    { title: "Infinity", audioUrl: "https://assets.mixkit.co/music/473/473.mp3" },
    { title: "Stylz", audioUrl: "https://assets.mixkit.co/music/628/628.mp3" },
    { title: "Sci-Fi Game", audioUrl: "https://assets.mixkit.co/music/609/609.mp3" },
    { title: "Wind Leaves", audioUrl: "https://assets.mixkit.co/music/617/617.mp3" },
    { title: "Uplifting Bass", audioUrl: "https://assets.mixkit.co/music/720/720.mp3" }
  ],
  modern_teknoloji: [
    { title: "Deep Techno Ambience", audioUrl: "https://assets.mixkit.co/music/134/134.mp3" },
    { title: "Hazy After Hours", audioUrl: "https://assets.mixkit.co/music/132/132.mp3" },
    { title: "Pop Track 03", audioUrl: "https://assets.mixkit.co/music/729/729.mp3" },
    { title: "Kodama Night Town", audioUrl: "https://assets.mixkit.co/music/759/759.mp3" },
    { title: "Shame", audioUrl: "https://assets.mixkit.co/music/553/553.mp3" },
    { title: "Minimal Emotion", audioUrl: "https://assets.mixkit.co/music/162/162.mp3" }
  ],
  sakin_premium: [
    { title: "Meditation", audioUrl: "https://assets.mixkit.co/music/441/441.mp3" },
    { title: "Digital Clouds", audioUrl: "https://assets.mixkit.co/music/175/175.mp3" },
    { title: "Voxscape", audioUrl: "https://assets.mixkit.co/music/571/571.mp3" },
    { title: "Curiosity", audioUrl: "https://assets.mixkit.co/music/480/480.mp3" },
    { title: "See Line Funk", audioUrl: "https://assets.mixkit.co/music/416/416.mp3" }
  ],
  enerjik_reklam: [
    { title: "Deep Urban", audioUrl: "https://assets.mixkit.co/music/623/623.mp3" },
    { title: "Cat Walk", audioUrl: "https://assets.mixkit.co/music/371/371.mp3" },
    { title: "Rising Forest", audioUrl: "https://assets.mixkit.co/music/471/471.mp3" },
    { title: "What About Action?", audioUrl: "https://assets.mixkit.co/music/474/474.mp3" },
    { title: "House 02", audioUrl: "https://assets.mixkit.co/music/744/744.mp3" }
  ],
  sinematik: [
    { title: "Skyline", audioUrl: "https://assets.mixkit.co/music/12/12.mp3" },
    { title: "Possible Dreams", audioUrl: "https://assets.mixkit.co/music/13/13.mp3" },
    { title: "Little Bells", audioUrl: "https://assets.mixkit.co/music/14/14.mp3" },
    { title: "Romantic Getaway", audioUrl: "https://assets.mixkit.co/music/15/15.mp3" }
  ]
};

// mood verilirse o kategoriden, verilmezse rastgele bir kategoriden rastgele
// bir parça seçer. randomImpl (0-1 arası) enjekte edilebilir — testte
// deterministik seçim için.
export function pickMusicTrack({ mood, randomImpl = Math.random } = {}) {
  const category = mood && MUSIC_CATALOG[mood] ? mood : MUSIC_CATEGORIES[Math.floor(randomImpl() * MUSIC_CATEGORIES.length)];
  const tracks = MUSIC_CATALOG[category];
  const track = tracks[Math.floor(randomImpl() * tracks.length)];
  return { ...track, category };
}
