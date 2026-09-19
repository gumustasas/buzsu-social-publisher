import { fetchPublicMediaFile } from "../lib/upload-media.js";

// TASK-002 ROOT review (PR #101): önceki sürüm yalnızca ilk URL'in şemasını
// (HTTPS mi) kontrol ediyordu — yönlendirme zincirini veya hostname'in
// çözümlendiği IP'yi HİÇ doğrulamıyordu (SSRF: özel/iç bir IP'ye çözümlenen
// bir host, veya HTTPS'ten iç bir HTTP endpoint'ine yönlendiren bir URL,
// sunucu tarafından sorgulanabiliyordu). Ayrıca tüm gövdeyi arrayBuffer()
// ile belleğe aldıktan SONRA boyut kontrolü yapıyordu — sınırsız/çok büyük
// bir gövde MAX_MEDIA_BYTES kontrolüne hiç ulaşmadan serverless fonksiyonun
// bellek/süresini tüketebilirdi.
//
// Bu modül artık upload-media.js'teki (upload_media/fetchPublicImage/
// fetchPublicAudio/fetchPublicVideo, bkz. o dosyanın kendi SSRF yorumları)
// GERÇEK SSRF-güvenli indirme çekirdeğini (assertPublicHttpsUrl + HER
// yönlendirme adımında yeniden IP doğrulaması + Content-Length erken reddi
// + akış hâlinde okuyup limiti aşınca durdurma) reuse eder — yeni bir
// indirme/SSRF mimarisi İCAT EDİLMEMİŞTİR.
//
// FFmpeg ile ses ayıklama KASITLI olarak YOKTUR: OpenAI /v1/audio/
// transcriptions video container'larını (mp4/webm) DOĞRUDAN kabul eder —
// sağlayıcı ses parçasını kendi tarafında ayıklar. Google yalnız ses MIME
// kabul eder (bkz. google-transcribe.js). Desteklenmeyen bir kapsayıcı
// (ör. MOV/M4V OpenAI için — bkz. openai-transcribe.js) burada DEĞİL,
// ilgili adapter'da AÇIKÇA reddedilir; bu katman yalnızca "genel olarak bir
// medya dosyası mı" diye kaba bir güvenlik ağıdır. Dosya bu MAX_BYTES
// sınırını aşarsa SESSİZCE küçültme/dönüştürme YAPILMAZ — açık bir hata
// döner. Bu durumda mevcut GitHub Actions FFmpeg render kuyruğu (bkz.
// src/lib/ffmpeg-command.js, src/reel-audio-compose.js) yeniden
// kullanılmalı — yeni bir senkron FFmpeg alt sistemi bu task kapsamında
// EKLENMEMİŞTİR (bkz. tasks/TASK-002 acceptance: "no duplicate FFmpeg
// subsystem").
export const MAX_MEDIA_BYTES = 24 * 1024 * 1024;

// Kasıtlı olarak geniş: bu katman bir kaba güvenlik ağıdır (ör. bir HTML
// hata sayfası veya bir görsel indirilirse burada elenir). Sağlayıcıya
// ÖZGÜ, sıkı kabul listesi (Google: yalnız audio/*; OpenAI: MOV/M4V hariç
// belgelenmiş formatlar) kendi adapter'ında uygulanır.
export const ALLOWED_TRANSCRIPTION_MIME_TYPES = new Set([
  "audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/mp4", "audio/m4a",
  "audio/ogg", "audio/flac", "audio/x-flac", "audio/webm",
  "video/mp4", "video/quicktime", "video/webm", "video/x-m4v"
]);

export async function fetchMediaBytes(mediaUrl, { fetchImpl = fetch, maxBytes = MAX_MEDIA_BYTES, lookup } = {}) {
  return fetchPublicMediaFile(mediaUrl, {
    maxBytes,
    fetchImpl,
    lookup,
    allowedMimeTypes: ALLOWED_TRANSCRIPTION_MIME_TYPES,
    mediaLabel: "Medya",
    mediaTypesLabel: "ses (mp3/wav/m4a/ogg/flac) veya video (mp4/mov/webm)"
  });
}
