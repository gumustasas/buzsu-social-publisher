// X (Twitter) Developer Portal, "User authentication settings" kaydedilirken
// geçerli bir Callback/Redirect URL zorunlu kılıyor. Bu proje X'e statik bir
// Access Token + Secret (OAuth 1.0a, uygulama sahibinin kendi hesabı) ile
// bağlanacak — üçüncü taraf kullanıcılar için "Sign in with X" akışı
// çalıştırmıyoruz, bu yüzden buraya normalde hiç istek gelmez. Endpoint
// yalnızca X panelinin URL doğrulamasını geçebilmesi ve linkin ölü kalmaması
// için var; hiçbir oturum/veri işlemi yapmaz.
export default function handler(request, response) {
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.status(200).send("<!doctype html><meta charset=\"utf-8\"><p>Buzsu Social Publisher — X callback endpoint. Bu sayfa X Developer Portal doğrulaması için ayrılmıştır.</p>");
}
