# Airtable Token Kurulumu

Tokenı sohbet ekranına göndermeyin. Sadece bu klasördeki `.env` dosyasına yazın.

1. Airtable'da [Personal Access Tokens](https://airtable.com/create/tokens) sayfasını açın.
2. `Create token` seçin ve örneğin `buzsu-social-local` adını verin.
3. Şu yetkileri ekleyin:
   - `data.records:read`
   - `data.records:write`
   - `schema.bases:read`
4. Erişimi yalnızca `SuveSu Logs` base'i ile sınırlandırın.
5. Tokenı oluşturun ve yalnızca aşağıdaki dosyadaki satıra yapıştırın:

```text
C:\Users\bulen\OneDrive\Masaüstü\bulentdisk\buzsu-ftp\content-production\social-automation\.env
```

Satır şu biçimde olmalı:

```text
AIRTABLE_TOKEN=pat_buraya_gercek_token
```

Başındaki `AIRTABLE_TOKEN=` kısmını silmeyin. Tokenı tırnak içine almayın ve başına/sonuna boşluk koymayın.

Sonra PowerShell'de çalıştırın:

```powershell
cd "C:\Users\bulen\OneDrive\Masaüstü\bulentdisk\buzsu-ftp\content-production\social-automation"
npm run check
npm run dry-run
```

`npm run check` tokenın dolu olduğunu gösterir, değerini ekrana yazmaz. `npm run dry-run` yalnızca Airtable'daki `Durum = Onaylandı` kayıtlarını okur; Instagram veya Facebook'ta paylaşım yapmaz.

Canlı paylaşım şu an kapalıdır ve bu aşamada `ENABLE_LIVE_POSTING=true` yapılmamalıdır.
