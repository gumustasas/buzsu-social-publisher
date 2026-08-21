// Panelden oluşturulan kayıtların Başlık alanı "Ürün Adı | Format" şeklinde
// yazılır (bkz. content-worker.js). Bu tür bir kayıt daha sonra "ürün" olarak
// tekrar seçilip yeni içerik üretilirse, temizlenmemiş başlık üstüne tekrar
// " | Format" eklenir ve birikir (örn. "Ürün | Hikâye | Hikâye | Gönderi").
// Ürün adını her okuyan yer bu fonksiyondan geçirmeli.
export function baseProductTitle(rawTitle) {
  return String(rawTitle || "").split(" | ")[0].trim();
}
