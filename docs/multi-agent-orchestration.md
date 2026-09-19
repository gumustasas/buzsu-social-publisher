# Multi-Agent Development Workflow

Bu dosya, `buzsu-social-publisher` için ChatGPT + Claude Code + Codex + Gemini + Perplexity birlikte çalışma protokolünü tanımlar.

## Roller

- **ChatGPT ROOT**: işi parçalar, dependency graph çıkarır, READY/BLOCKED durumlarını yönetir, merge sırasını belirler.
- **Claude Code**: ana repo worker; branch açar, kodlar, test eder, PR açar.
- **Codex**: ikinci repo worker; bağımsız modüller, test, bugfix ve review/fix işleri.
- **Gemini**: public repo/branch üzerinden Google API, multimodal, image/video ve mimari review.
- **Perplexity**: public repo + resmi dokümantasyon üzerinden güncel API/özellik doğrulaması ve research.

## Tek gerçek durum kaynağı

Task durumu sohbet hafızası değil, GitHub'daki `tasks/*.yaml` dosyalarıdır.

Durumlar:
- `READY`
- `RUNNING`
- `BLOCKED`
- `REVIEW`
- `DONE`
- `FAILED`

## Branch kuralı

Her kodlama görevi ayrı branch:
`agent/<task-id>-<slug>`

Örnek:
`agent/task-003-image-tiers`

Ajanlar doğrudan `main` üzerinde değişiklik yapmaz.

## Sonuç kuralı

Kod worker görevi bitirdiğinde:
1. testleri çalıştırır,
2. commit eder,
3. PR açar,
4. task dosyasına veya PR açıklamasına şu özeti ekler:
   - commit SHA
   - PR no
   - test sonucu
   - değişen ana dosyalar
   - bilinen riskler

Research/review ajanları doğrudan koda yazmak zorunda değildir; task için bulgularını açık, maddeli bir RESULT olarak döndürür.

## Dependency davranışı

Bir task yalnız:
- tüm `depends_on` taskları `DONE` olduğunda,
- çakışan file ownership yoksa,
- gerekli provider/repo context hazırsa
`READY` olabilir.

## File ownership

Task dosyasındaki `owns` alanı, paralel worker'ların aynı dosyalara gereksizce dokunmasını azaltmak içindir. Ortak kritik dosyalar gerekiyorsa değişiklik küçük tutulmalı ve merge sırası ROOT tarafından belirlenmelidir.

## Güvenlik

- Ücretli AI generation gerçek çağrıları test sırasında yapılmaz.
- Production'a otomatik merge yapılmaz.
- API key/secrets loglanmaz.
- Publish/delete/destructive aksiyonlar explicit kullanıcı onayı olmadan çalıştırılmaz.
- Public repo okunabilir; Gemini/Perplexity review için ilgili branch URL'si task içinde verilir.

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
