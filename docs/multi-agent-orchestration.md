# Multi-Agent Development Workflow

Bu dosya, `buzsu-social-publisher` için ChatGPT + Claude Code + Codex + Gemini + Perplexity birlikte çalışma protokolünü tanımlar.

## Roller

- **ChatGPT ROOT**: işi parçalar, dependency graph çıkarır, READY/BLOCKED durumlarını yönetir, merge sırasını belirler, task state mutation'ının tek sahibidir.
- **Claude Code**: ana repo worker; branch açar, kodlar, test eder, PR açar. Şu an tüm kodlama tasklarının (TASK-001..008) fiili worker'ı budur.
- **Codex**: standby / optional worker. Şu an aktif olarak kullanılmıyor; hiçbir task'a `assigned_to: codex` atanmaz. İleride ikinci bir repo worker'a ihtiyaç duyulursa (bağımsız modül, bugfix, review/fix) yeniden devreye alınabilir. Codex prompt dosyası (`agent-prompts/codex.md`) bu yüzden silinmez.
- **Gemini**: public repo/branch üzerinden Google API, multimodal, image/video ve mimari review. Bkz. "External Review Trigger".
- **Perplexity**: public repo + resmi dokümantasyon üzerinden güncel API/özellik doğrulaması ve research. Bkz. "External Review Trigger".

## Tek gerçek durum kaynağı

Task durumu sohbet hafızası değil, GitHub'daki `tasks/*.yaml` dosyalarıdır.

Durumlar:
- `READY`
- `RUNNING`
- `BLOCKED`
- `REVIEW`
- `DONE`
- `FAILED`

### Task state mutation sahipliği

- Task YAML dosyasındaki `status` alanını **yalnız `chatgpt-root` değiştirir.**
- Worker (Claude Code veya standby Codex) kendi branch'inde task YAML güncellemesi yapmaz; `tasks/*.yaml` dosyalarına status değişikliği içeren commit atmaz.
- Worker sonucu **PR açıklaması veya RESULT formatında** raporlar (bkz. "Sonuç kuralı"). Task dosyasını kendisi `DONE`/`REVIEW` yapmaz.
- ROOT, worker'ın raporunu (acceptance kriterleri, diff, test sonucu, external review) doğruladıktan sonra task status'unu günceller.
- Bir status geçişi (`READY → RUNNING → REVIEW → DONE`, veya `FAILED`/`BLOCKED`) her zaman ROOT tarafından, ayrı bir commit ile yapılır.

## Branch kuralı

Her kodlama görevi ayrı branch:
`agent/<task-id>-<slug>`

Örnek:
`agent/task-003-image-tiers`

Ajanlar doğrudan `main` üzerinde değişiklik yapmaz.

### Branch tabanı

- Her yeni task branch'i **güncel `main` üzerinden** açılmalıdır.
- Scaffold PR'ı (bu protokolü ve `tasks/*.yaml` manifestlerini ekleyen PR, örn. #99) `main`'e merge edilmeden hiçbir task branch'i açılmaz — task manifestleri worker'ın çalıştığı `main`'de görünür olmalı.
- Bir task merge edildikten sonra, henüz açılmamış veya hâlâ açık olan sonraki task branch'leri güncel `main` ile rebase/update edilir (özellikle o task'ın `shared_touch` dosyalarına dokunan diğer branch'ler için).

## Sonuç kuralı

Kod worker görevi bitirdiğinde:
1. testleri çalıştırır,
2. commit eder,
3. PR açar,
4. PR açıklamasına (task YAML'ına değil — bkz. "Task state mutation sahipliği") RESULT formatında şu özeti ekler:
   - commit SHA
   - PR no
   - test sonucu
   - değişen ana dosyalar (`owns` vs `shared_touch` ayrımıyla)
   - bilinen riskler

Research/review ajanları doğrudan koda yazmak zorunda değildir; task için bulgularını açık, maddeli bir RESULT olarak döndürür.

## Dependency davranışı

Bir task yalnız:
- tüm `depends_on` taskları `DONE` olduğunda,
- çakışan file ownership yoksa,
- gerekli provider/repo context hazırsa
`READY` olabilir.

## File ownership

Task dosyasında iki ayrı alan vardır:

- **`owns`**: task'ın ana sahibi olduğu dosyalar/dizinler. Worker bu dosyalarda serbestçe çalışır (yeniden adlandırma, refactor, yeni dosya ekleme dahil).
- **`shared_touch`**: worker'ın yalnızca minimum entegrasyon değişikliği yapabileceği ortak dosyalar (örn. `api/mcp.js`'e yeni bir MCP tool kaydı eklemek, `test/mcp.test.js`'e o tool için test eklemek, `README.md`'ye kısa bir bölüm eklemek, `.env.example`'a gerekiyorsa yeni bir opsiyonel değişken eklemek). Worker bu dosyalarda geniş refactor yapmaz, başka worker'ların eklediği bölümleri silmez/yeniden düzenlemez.

`owns` altında olmayan ve `shared_touch` altında da listelenmeyen bir dosya, o worker için **do_not_touch** kabul edilir.

### Shared File Conflict Protocol (paralel çalışma)

Birden fazla READY task aynı anda `api/mcp.js`, `test/mcp.test.js`, `README.md` gibi ortak dosyalarda değişiklik yapabilir. Bu durumda:

- Worker yalnız kendi `owns` dosyalarında serbestçe çalışır.
- Worker `shared_touch` dosyalarında sadece minimum entegrasyon değişikliği yapar (kendi tool'unu/bölümünü ekler); ortak dosyada geniş refactor yapmaz.
- PR merge sırasını ChatGPT ROOT belirler.
- Bir task merge edildikten sonra, henüz merge edilmemiş sonraki task branch'i main ile rebase/update edilir.
- Conflict varsa worker kendi feature kodunu yeniden yazmaz; yalnız entegrasyon conflict'ini (örn. `api/mcp.js`'teki switch/case bloğunun birleşimi) çözer.
- Aynı ortak bölüm üzerinde iki task değişiklik yapacaksa, hangisinin önce merge olacağına ROOT karar verir; ikinci worker rebase sonrası kendi entegrasyonunu tekrar uygular.

## Güvenlik

- Ücretli AI generation gerçek çağrıları test sırasında yapılmaz.
- Production'a otomatik merge yapılmaz.
- API key/secrets loglanmaz.
- Publish/delete/destructive aksiyonlar explicit kullanıcı onayı olmadan çalıştırılmaz.
- Public repo okunabilir; Gemini/Perplexity review için ilgili branch URL'si task içinde verilir.

## External Review Trigger

ROOT bir task kod PR'ı açıldığında ilgili review'ları tetikler.

**Gemini gerekiyorsa:**
- exact PR URL veya branch URL verilir
- task manifest linki verilir
- Gemini sonucu `PASS` veya `CHANGES_NEEDED` döndürür

**Perplexity gerekiyorsa:**
- public repo/PR URL verilir
- task manifest verilir
- doğrulanacak API/model varsayımları verilir

Review sonucu **doğrudan task state değiştirmez** — state mutation her zaman ROOT'un elindedir (bkz. "Task state mutation sahipliği").

Akış:
1. worker PR açar
2. ROOT task state'i `REVIEW`'a alır
3. Gemini/Perplexity review yapılır
4. ROOT sonucu değerlendirir
5. gerekiyorsa worker düzeltir (aynı branch/PR üzerinde)
6. ROOT tekrar inceler
7. task `DONE` olur

Gemini/Perplexity GitHub'a doğrudan yazamıyorsa, kullanıcı sonucu ChatGPT ROOT'a taşır; ROOT sonucu task kaydına işler.

## ROOT Review Standardı

Her task merge öncesi ChatGPT ROOT şu kontrolleri yapar:

- task acceptance kriterleri karşılanmış mı
- diff (scope, `owns`/`shared_touch` sınırlarına uyum)
- test sonuçları
- CI
- external review sonucu (Gemini/Perplexity, gerekliyse)
- dependency durumu (`depends_on` taskları `DONE` mı)
- shared-file conflict riski (aynı anda açık başka PR var mı, merge sırası netleşmiş mi)
- production risk (default davranış değişti mi, ücretli çağrı riski var mı)

ROOT **PASS** olmadan merge önerilmez.

## İlk çalışma seti

İlk dalga paralel:
- TASK-001 Research Provider
- TASK-002 Transcription Provider
- TASK-003 Image Quality Tiers
- TASK-005 Video -> Image
- TASK-006 Product Knowledge / File Search

Bağımlı:
- TASK-004 Visual Validation <- TASK-003
- TASK-007 Agent Orchestrator <- TASK-001..006
- TASK-008 Deep Research <- TASK-001, TASK-006

### Paralellik notu

Bu 5 READY task'ın hepsinin `assigned_to: claude-code` olması, "tek bir Claude Code session'ın aynı anda 5 işi birden yapacağı" anlamına gelmez. Gerçek paralellik, birden fazla Claude Code session/worktree kullanılabildiği ölçüde mümkündür (her biri kendi branch'inde çalışan ayrı bir session/worktree). Aksi halde ChatGPT ROOT, READY queue'dan task'ları sırayla (bir worker session'ı boşaldıkça) dispatch eder — bu durumda "READY" bir task'ın "şu an kodlanıyor" anlamına gelmediğini, sadece "bağımlılıkları ve dosya çakışması engeli olmadan bir sonraki dispatch edilebilir task" anlamına geldiğini unutmayın.

## Scaffold PR Kapsamı

Bu protokolü ve `tasks/*.yaml` / `agent-prompts/*.md` dosyalarını ekleyen/düzelten scaffold PR'lar (örn. #99) yalnızca `docs/`, `tasks/`, `agent-prompts/` içeriği taşır. Production kodu (`src/`, `api/`, dashboard, provider logic), paket bağımlılıkları veya CI/CD workflow'ları bu tür PR'larda değiştirilmez.
