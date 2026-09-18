/* META REKLAMLAR — PR-1 (salt-okunur reklam listesi + kreatif analizi) + PR-2
   (Genel Bakış: bugün/7 gün performansı, low_volume uyarısı, aktif kampanya
   sayısı, Pixel durumu, reklam listesinde campaign/adset isim çözümlemesi) +
   PR-3 (tersinir yazma işlemleri: reklam durumu pause/resume + reklam seti
   günlük bütçesi) + PR-4 (destructive/creative yönetimi: reklam silme —
   yalnız PAUSED, geri alınamaz — ve mevcut bir image_hash'i yeniden kullanarak
   yeni bir kreatif oluşturup reklama bağlama). Tümü Admin-only, iki tıklamalı
   onay; asıl güvenlik sınırı backend'in Admin-only kontrolü ve MCP'nin
   confirmed=true şartıdır (bkz. src/lib/meta-connect.js) — buradaki
   PAUSED-only/Admin-only kontroller SADECE UX katmanıdır. */
(function () {
  "use strict";

  const state = { ads: [], loading: false, adsLoaded: false, currency: "TRY", isAdmin: false };
  let initialized = false;
  let searchDebounceTimer = null;

  const CONFIRM_ARM_MS = 6000;
  const CTA_OPTIONS = ["LEARN_MORE", "SHOP_NOW", "GET_QUOTE", "CONTACT_US", "SIGN_UP", "GET_OFFER", "SUBSCRIBE"];
  const writeState = {
    adId: null,
    adName: null,
    adStatus: null,
    adsetId: null,
    statusConfirmArmed: false,
    statusConfirmTimer: null,
    statusBusy: false,
    statusMessage: "",
    statusError: false,
    budgetValue: "",
    budgetConfirmArmed: false,
    budgetConfirmTimer: null,
    budgetBusy: false,
    budgetMessage: "",
    budgetError: false,
    // PR-4: silme — geri alınamaz, bu yüzden ayrı ve kendi onay zamanlayıcısına sahip.
    deleteConfirmArmed: false,
    deleteConfirmTimer: null,
    deleteBusy: false,
    deleteMessage: "",
    deleteError: false,
    // PR-4: kreatif oluştur + bağla. image_hash listesi mevcut kartlardan
    // türetilir — burada YENİ bir görsel yüklenmez (Meta CDN image_url asla
    // yeniden kullanılmaz, bkz. src/lib/meta-connect.js:createAdCreative).
    creativeImageHashes: [],
    creativeName: "",
    creativeMessage: "",
    creativeHeadline: "",
    creativeDescription: "",
    creativeLink: "",
    creativeCta: CTA_OPTIONS[0],
    creativeImageHash: "",
    creativeConfirmArmed: false,
    creativeConfirmTimer: null,
    creativeBusy: false,
    creativeResultMessage: "",
    creativeResultError: false
  };

  const byId = (id) => document.getElementById(id);
  const escapeHtml = (value) =>
    String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  const mAdsApi = (path, requestOptions = {}) =>
    fetch(path, {
      credentials: "same-origin",
      ...requestOptions,
      headers: { "Content-Type": "application/json", ...(requestOptions.headers || {}) }
    });

  // null = ölçülmedi/mevcut değil, 0 = ölçüldü ve sıfır — bu ikisini "0" göstererek
  // birbirine karıştırmamak için ayrı bir yardımcı: null her zaman "Veri yok" render eder.
  const formatNullable = (value, formatter) => (value === null || value === undefined ? "Veri yok" : formatter(value));
  const formatMoney = (value) => new Intl.NumberFormat("tr-TR", { style: "currency", currency: state.currency || "TRY" }).format(Number(value) || 0);
  const formatNumber = (value) => new Intl.NumberFormat("tr-TR").format(Number(value) || 0);
  const formatPercent = (value) => `%${new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2 }).format(Number(value) || 0)}`;

  function statCard(label, valueHtml, hintHtml) {
    return `<div class="card"><span class="hint">${escapeHtml(label)}</span><strong style="display:block;font-size:28px;margin-top:6px">${valueHtml}</strong>${
      hintHtml ? `<p class="hint" style="margin-top:6px">${hintHtml}</p>` : ""
    }</div>`;
  }

  // instagram-Facebook-connect/src/meta.ts'teki lowVolumeReport()'un resultMetric
  // olarak döndürebileceği üç değer (purchases/leads/messaging_conversations_started)
  // + sabit "impressions" sinyali — ham alan adı yerine okunabilir etiket.
  const LOW_VOLUME_METRIC_LABELS = {
    purchases: "Satın Almalar",
    leads: "Potansiyel Müşteriler",
    messaging_conversations_started: "Mesajlaşma Başlangıçları"
  };

  // lowVolumeReport() "flagged"ı sinyallerin OR'u olarak hesaplıyor — yani flagged:true
  // olsa da hangi sinyalin gerçekten eşiğin altında olduğu ayrıca belirlenmeli. results
  // sinyali value:null ise (o dönem için izlenen bir dönüşüm eylemi yok, örn. trafik
  // kampanyası) bu "eşiğin altında" DEĞİLDİR — bilinmiyor demektir, düşük değil. Bu
  // yüzden "yalnız bu iki koşuldan biri true'ysa flagged" kuralı istemci tarafında da
  // birebir uygulanıyor; sunucunun flagged:true'sunu doğrudan görüntülemiyoruz.
  function isLowVolumeSignalFlagged(signal) {
    return signal.value !== null && signal.value < signal.threshold;
  }

  function renderLowVolumeSignal(signal) {
    const label =
      signal.basis === "impressions" ? "Gösterim hacmi düşük" : `Sonuç hacmi düşük (${LOW_VOLUME_METRIC_LABELS[signal.metric] || signal.metric || "bilinmeyen metrik"})`;
    return `${escapeHtml(label)}: ${formatNumber(signal.value)} / eşik ${formatNumber(signal.threshold)}`;
  }

  function setListMessage(text, isError) {
    const el = byId("meta-ads-list-message");
    el.textContent = text || "";
    el.className = isError ? "error" : "hint";
  }

  function showListView() {
    byId("meta-ads-detail-view").classList.add("hidden");
    byId("meta-ads-list-view").classList.remove("hidden");
  }

  function showDetailView() {
    byId("meta-ads-list-view").classList.add("hidden");
    byId("meta-ads-detail-view").classList.remove("hidden");
  }

  function renderTable() {
    const wrap = byId("meta-ads-table-wrap");
    if (!state.ads.length) {
      wrap.innerHTML = "";
      return;
    }
    wrap.innerHTML = `<table style="width:100%;border-collapse:collapse">
      <thead><tr style="text-align:left;border-bottom:1px solid #dfe5e9">
        <th style="padding:8px">Reklam</th><th style="padding:8px">Durum</th><th style="padding:8px">Effective</th>
        <th style="padding:8px">Kampanya</th><th style="padding:8px">Reklam Seti</th><th style="padding:8px"></th>
      </tr></thead>
      <tbody>${state.ads
        .map(
          (ad) => `<tr style="border-bottom:1px solid #edf0f2">
          <td style="padding:8px">${escapeHtml(ad.name || ad.id)}<br><span class="hint">${escapeHtml(ad.id)}</span></td>
          <td style="padding:8px">${escapeHtml(ad.status)}</td>
          <td style="padding:8px">${escapeHtml(ad.effective_status)}</td>
          <td style="padding:8px">${escapeHtml(ad.campaign_name || ad.campaign_id)}${ad.campaign_name ? `<br><span class="hint">${escapeHtml(ad.campaign_id)}</span>` : ""}</td>
          <td style="padding:8px">${escapeHtml(ad.adset_name || ad.adset_id)}${ad.adset_name ? `<br><span class="hint">${escapeHtml(ad.adset_id)}</span>` : ""}</td>
          <td style="padding:8px"><button type="button" class="secondary" data-open-ad="${escapeHtml(ad.id)}">İncele</button></td>
        </tr>`
        )
        .join("")}</tbody>
    </table>`;
  }

  function showOverviewView() {
    byId("meta-ads-list-view").classList.add("hidden");
    byId("meta-ads-detail-view").classList.add("hidden");
    byId("meta-ads-overview-view").classList.remove("hidden");
    document.querySelectorAll("[data-meta-ads-view]").forEach((button) => button.classList.toggle("active", button.dataset.metaAdsView === "overview"));
  }

  function showAdsListView() {
    byId("meta-ads-overview-view").classList.add("hidden");
    byId("meta-ads-detail-view").classList.add("hidden");
    byId("meta-ads-list-view").classList.remove("hidden");
    document.querySelectorAll("[data-meta-ads-view]").forEach((button) => button.classList.toggle("active", button.dataset.metaAdsView === "list"));
    if (!state.adsLoaded) {
      state.adsLoaded = true;
      loadAds();
    }
  }

  function setOverviewMessage(text, isError) {
    const el = byId("meta-ads-overview-message");
    el.textContent = text || "";
    el.className = isError ? "error" : "hint";
  }

  function renderOverview(overview) {
    state.currency = overview.account?.currency || "TRY";
    const cards = [];

    if (overview.account) {
      cards.push(statCard("Hesap", escapeHtml(overview.account.name || overview.account.id || "—"), `Para birimi: ${escapeHtml(overview.account.currency || "—")}`));
    } else {
      cards.push(statCard("Hesap", "Veri yok", overview.account_error ? escapeHtml(overview.account_error.message) : ""));
    }

    if (overview.today) {
      cards.push(statCard("Bugünkü Harcama", formatMoney(overview.today.spend), `${formatNumber(overview.today.impressions)} gösterim · CTR ${formatPercent(overview.today.ctr)}`));
    } else {
      cards.push(statCard("Bugünkü Harcama", "Veri yok", overview.today_error ? escapeHtml(overview.today_error.message) : ""));
    }

    if (overview.last7d) {
      cards.push(statCard("7 Günlük Harcama", formatMoney(overview.last7d.spend), `${formatNumber(overview.last7d.impressions)} gösterim`));
      cards.push(statCard("CTR (7 gün)", formatPercent(overview.last7d.ctr), `CPC: ${formatMoney(overview.last7d.cpc)}`));
      cards.push(statCard("Mesajlaşma Başlangıçları (7 gün)", formatNumber(overview.last7d.messaging_conversations_started), "Messenger/Instagram/WhatsApp dahil, kampanya hedefine göre"));
      cards.push(statCard("Satış ROAS (7 gün)", formatNullable(overview.last7d.purchase_roas, (v) => v.toFixed(2)), "Satış izleme kurulu değilse veya bu dönemde satış yoksa 'Veri yok' gösterilir"));
    } else {
      cards.push(statCard("7 Günlük Harcama", "Veri yok", overview.last7d_error ? escapeHtml(overview.last7d_error.message) : ""));
    }

    cards.push(
      statCard(
        "Aktif Kampanya Sayısı",
        overview.active_campaign_count === null ? "Veri yok" : formatNumber(overview.active_campaign_count),
        overview.campaigns_error ? escapeHtml(overview.campaigns_error.message) : ""
      )
    );

    if (overview.pixel) {
      cards.push(statCard("Pixel", escapeHtml(overview.pixel.name || overview.pixel.id || "—"), overview.pixel.last_fired_time ? `Son ateşleme: ${escapeHtml(overview.pixel.last_fired_time)}` : "Hiç ateşlenmemiş"));
    } else {
      cards.push(statCard("Pixel", "Yapılandırılmamış / erişilemedi", overview.pixel_error ? escapeHtml(overview.pixel_error.message) : ""));
    }

    const lowVolume = overview.last7d?.low_volume;
    const flaggedSignals = lowVolume ? lowVolume.signals.filter(isLowVolumeSignalFlagged) : [];
    const lowVolumeHtml = flaggedSignals.length
      ? `<div class="card" style="margin-top:12px"><p class="error">⚠ Düşük hacim uyarısı (7 gün)</p><ul style="margin:8px 0 0;padding-left:20px">${flaggedSignals
          .map((signal) => `<li class="hint">${renderLowVolumeSignal(signal)}</li>`)
          .join("")}</ul></div>`
      : "";

    byId("meta-ads-overview-content").innerHTML = `<div class="grid">${cards.join("")}</div>${lowVolumeHtml}`;
  }

  async function loadOverview() {
    setOverviewMessage("Yükleniyor...", false);
    byId("meta-ads-overview-content").innerHTML = "";
    try {
      const res = await mAdsApi("/api/meta-ads/overview");
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data?.error?.message || "Genel bakış yüklenemedi.");
      setOverviewMessage("", false);
      renderOverview(data.overview);
    } catch (error) {
      setOverviewMessage(error.message, true);
    }
  }

  async function loadAds() {
    if (state.loading) return;
    state.loading = true;
    setListMessage("Yükleniyor...", false);
    byId("meta-ads-table-wrap").innerHTML = "";
    try {
      const params = new URLSearchParams();
      const status = byId("meta-ads-status-filter").value;
      const search = byId("meta-ads-search").value.trim();
      if (status) params.set("status", status);
      if (search) params.set("q", search);
      const query = params.toString();
      const res = await mAdsApi(`/api/meta-ads/ads${query ? `?${query}` : ""}`);
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data?.error?.message || "Reklamlar yüklenemedi.");
      state.ads = data.ads;
      setListMessage(state.ads.length ? "" : "Filtreye uyan reklam bulunamadı.", false);
      renderTable();
    } catch (error) {
      state.ads = [];
      renderTable();
      setListMessage(error.message, true);
    } finally {
      state.loading = false;
    }
  }

  function renderCard(card, index) {
    return `<div class="card" style="margin-bottom:12px">
      <strong>Kart ${index + 1}${card.name ? ` — ${escapeHtml(card.name)}` : ""}</strong>
      ${
        card.image_url
          ? `<div style="margin:8px 0"><img referrerpolicy="no-referrer" src="${escapeHtml(card.image_url)}" style="max-width:240px;max-height:240px;object-fit:contain;border:1px solid #dfe5e9"></div>`
          : '<p class="hint">Görsel yok</p>'
      }
      ${card.description ? `<p>${escapeHtml(card.description)}</p>` : ""}
      <p class="hint">CTA: ${escapeHtml(card.cta || "—")} · Link: ${
      card.link ? `<a href="${escapeHtml(card.link)}" target="_blank" rel="noopener">${escapeHtml(card.link)}</a>` : "—"
    }</p>
      <p class="hint">image_hash: ${escapeHtml(card.image_hash || "—")}</p>
      ${card.image_error ? `<p class="error">${escapeHtml(card.image_error)}</p>` : ""}
    </div>`;
  }

  function renderDetail(creative) {
    const duplicates = creative.duplicate_image_hashes || [];
    const hasCopy = creative.primary_text || creative.headline || creative.description || creative.destination_url || creative.call_to_action;
    byId("meta-ads-detail-content").innerHTML = `
      <h3>${escapeHtml(creative.ad_name || creative.ad_id)}</h3>
      <p class="hint">Ad ID: ${escapeHtml(creative.ad_id)} · Campaign ID: ${escapeHtml(creative.campaign_id || "—")} · Ad Set ID: ${escapeHtml(
      creative.adset_id || "—"
    )}</p>
      <p class="hint">Format: ${escapeHtml(creative.format)} · Desteklenen: ${creative.supported ? "Evet" : "Hayır"}${
      creative.reason ? ` (${escapeHtml(creative.reason)})` : ""
    }</p>
      <p class="hint">Asset Feed Spec: ${creative.has_asset_feed_spec ? "VAR" : "YOK"}</p>
      ${
        duplicates.length
          ? `<p class="error">⚠ Aynı görsel birden fazla kartta kullanılıyor (image_hash: ${duplicates.map(escapeHtml).join(", ")})</p>`
          : ""
      }
      <h4>Kreatif analizi</h4>
      ${
        hasCopy
          ? `<div class="card" style="margin-bottom:12px">
        ${creative.headline ? `<p><strong>${escapeHtml(creative.headline)}</strong></p>` : ""}
        ${creative.primary_text ? `<p>${escapeHtml(creative.primary_text)}</p>` : ""}
        ${creative.description ? `<p class="hint">${escapeHtml(creative.description)}</p>` : ""}
        <p class="hint">CTA: ${escapeHtml(creative.call_to_action || "—")} · Hedef URL: ${
              creative.destination_url
                ? `<a href="${escapeHtml(creative.destination_url)}" target="_blank" rel="noopener">${escapeHtml(creative.destination_url)}</a>`
                : "—"
            }</p>
      </div>`
          : ""
      }
      ${creative.cards.length ? creative.cards.map(renderCard).join("") : '<p class="hint">Kart verisi yok.</p>'}
      ${creative.image_lookup_error ? `<p class="error">${escapeHtml(creative.image_lookup_error)}</p>` : ""}
    `;
  }

  function resetStatusConfirm() {
    clearTimeout(writeState.statusConfirmTimer);
    writeState.statusConfirmArmed = false;
  }

  function resetBudgetConfirm() {
    clearTimeout(writeState.budgetConfirmTimer);
    writeState.budgetConfirmArmed = false;
  }

  function resetDeleteConfirm() {
    clearTimeout(writeState.deleteConfirmTimer);
    writeState.deleteConfirmArmed = false;
  }

  function resetCreativeConfirm() {
    clearTimeout(writeState.creativeConfirmTimer);
    writeState.creativeConfirmArmed = false;
  }

  function renderWriteControls() {
    const container = byId("meta-ads-write-controls");
    if (!container) return;
    if (!state.isAdmin) {
      container.innerHTML = '<p class="hint" style="margin-top:12px">Durum ve bütçe değişikliği yalnız Admin rolündeki kullanıcılara açıktır.</p>';
      return;
    }
    const targetStatus = writeState.adStatus === "ACTIVE" ? "PAUSED" : "ACTIVE";
    const statusLabel = writeState.statusConfirmArmed
      ? `Emin misiniz? Tekrar tıklayın — ${targetStatus === "PAUSED" ? "Duraklat" : "Etkinleştir"}`
      : targetStatus === "PAUSED"
        ? "Reklamı Duraklat"
        : "Reklamı Etkinleştir";

    container.innerHTML = `
      <div class="card" style="margin-top:12px">
        <strong>Durum Değişikliği</strong>
        <p class="hint">Mevcut durum: ${escapeHtml(writeState.adStatus || "—")}</p>
        <button type="button" id="meta-ads-status-toggle" class="${writeState.statusConfirmArmed ? "danger" : "secondary"}"${writeState.statusBusy ? " disabled" : ""}>${escapeHtml(statusLabel)}</button>
        ${writeState.statusMessage ? `<p class="${writeState.statusError ? "error" : "hint"}" style="margin-top:8px">${escapeHtml(writeState.statusMessage)}</p>` : ""}
      </div>
      <div class="card" style="margin-top:12px">
        <strong>Reklam Seti Günlük Bütçesi (TRY)</strong>
        <p class="hint">Ad Set ID: ${escapeHtml(writeState.adsetId || "—")} — bütçe reklam SETİ seviyesinde değişir, yalnız bu reklamı etkilemez.</p>
        <div class="toolbar">
          <input type="number" id="meta-ads-budget-input" min="1" max="100000" step="0.01" style="flex:1" value="${escapeHtml(writeState.budgetValue)}" placeholder="Günlük bütçe (TRY)">
          <button type="button" id="meta-ads-budget-submit" class="${writeState.budgetConfirmArmed ? "danger" : ""}"${writeState.budgetBusy ? " disabled" : ""}>${writeState.budgetConfirmArmed ? "Emin misiniz? Tekrar tıklayın" : "Bütçeyi Güncelle"}</button>
        </div>
        ${writeState.budgetMessage ? `<p class="${writeState.budgetError ? "error" : "hint"}" style="margin-top:8px">${escapeHtml(writeState.budgetMessage)}</p>` : ""}
      </div>
      ${renderCreativeCard()}
      ${renderDeleteCard()}
    `;
  }

  // PR-4: kreatif oluştur + reklama bağla. Yalnızca MEVCUT bir image_hash
  // (bu reklamın şu anki kartlarından) yeniden kullanılır — yeni görsel
  // yükleme bu ilk sürümün kapsamı dışında (bkz. PR-4 açıklaması).
  function renderCreativeCard() {
    const hashOptions = writeState.creativeImageHashes.length
      ? writeState.creativeImageHashes.map((hash) => `<option value="${escapeHtml(hash)}"${hash === writeState.creativeImageHash ? " selected" : ""}>${escapeHtml(hash)}</option>`).join("")
      : "";
    const ctaOptions = CTA_OPTIONS.map((cta) => `<option value="${escapeHtml(cta)}"${cta === writeState.creativeCta ? " selected" : ""}>${escapeHtml(cta)}</option>`).join("");
    return `
      <div class="card" style="margin-top:12px">
        <strong>Yeni Kreatif Oluştur ve Reklama Bağla</strong>
        <p class="hint">Yalnızca bu reklamın mevcut görsellerinden biri (image_hash) yeniden kullanılabilir — yeni görsel yükleme desteklenmiyor. Bağlama işlemi ACTIVE bir reklamda yeni bir Meta incelemesi tetikleyebilir ve öğrenme aşamasını sıfırlayabilir.</p>
        <label class="field-label">Ana metin<textarea id="meta-ads-creative-message" rows="2" style="width:100%">${escapeHtml(writeState.creativeMessage)}</textarea></label>
        <label class="field-label" style="margin-top:8px">Başlık<input id="meta-ads-creative-headline" style="width:100%" value="${escapeHtml(writeState.creativeHeadline)}"></label>
        <label class="field-label" style="margin-top:8px">Açıklama (opsiyonel)<input id="meta-ads-creative-description" style="width:100%" value="${escapeHtml(writeState.creativeDescription)}"></label>
        <label class="field-label" style="margin-top:8px">Hedef URL<input id="meta-ads-creative-link" style="width:100%" value="${escapeHtml(writeState.creativeLink)}"></label>
        <div class="auth-grid" style="margin-top:8px">
          <label class="field-label">CTA<select id="meta-ads-creative-cta">${ctaOptions}</select></label>
          <label class="field-label">Görsel (image_hash)<select id="meta-ads-creative-image-hash">${hashOptions || '<option value="">Yeniden kullanılabilir görsel bulunamadı</option>'}</select></label>
        </div>
        <button type="button" id="meta-ads-creative-submit" class="${writeState.creativeConfirmArmed ? "danger" : "secondary"}" style="margin-top:10px"${writeState.creativeBusy || !hashOptions ? " disabled" : ""}>${writeState.creativeConfirmArmed ? "Emin misiniz? Yeni kreatif oluşturulup bağlanacak — tekrar tıklayın" : "Yeni kreatif oluştur ve reklama bağla"}</button>
        ${writeState.creativeResultMessage ? `<p class="${writeState.creativeResultError ? "error" : "hint"}" style="margin-top:8px">${escapeHtml(writeState.creativeResultMessage)}</p>` : ""}
      </div>
    `;
  }

  // PR-4: silme — geri alınamaz. Buton yalnız reklam PAUSED iken görünür
  // (asıl guard MCP/ads_delete_ad tarafında: ACTIVE reddedilir, bu sadece UX).
  function renderDeleteCard() {
    if (writeState.adStatus !== "PAUSED") {
      return `<div class="card" style="margin-top:12px"><strong>Reklamı Sil</strong><p class="hint" style="margin-top:6px">Silmek için önce reklamı Duraklat (PAUSED) durumuna alın.</p></div>`;
    }
    const label = writeState.deleteConfirmArmed
      ? `Emin misiniz? "${escapeHtml(writeState.adName || writeState.adId)}" (${escapeHtml(writeState.adId)}, PAUSED) KALICI OLARAK silinecek — tekrar tıklayın`
      : "Reklamı Sil (geri alınamaz)";
    return `
      <div class="card" style="margin-top:12px">
        <strong>Reklamı Sil</strong>
        <p class="hint">Reklam: ${escapeHtml(writeState.adName || "—")} · ID: ${escapeHtml(writeState.adId || "—")} · Durum: PAUSED</p>
        <p class="hint" style="color:#b42318">Bu işlem GERİ ALINAMAZ. Meta bazen hard-delete yerine arşivler; sonuç durumu aşağıda gösterilir.</p>
        <button type="button" id="meta-ads-delete-submit" class="danger"${writeState.deleteBusy ? " disabled" : ""}>${escapeHtml(label)}</button>
        ${writeState.deleteMessage ? `<p class="${writeState.deleteError ? "error" : "hint"}" style="margin-top:8px">${escapeHtml(writeState.deleteMessage)}</p>` : ""}
      </div>
    `;
  }

  async function performStatusChange(targetStatus) {
    writeState.statusBusy = true;
    writeState.statusMessage = "Gönderiliyor...";
    writeState.statusError = false;
    renderWriteControls();
    try {
      const res = await mAdsApi("/api/meta-ads/ad-status", { method: "POST", body: JSON.stringify({ ad_id: writeState.adId, status: targetStatus, confirm: true }) });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data?.error?.message || "Durum güncellenemedi.");
      writeState.adStatus = targetStatus;
      writeState.statusMessage = `Durum güncellendi: ${targetStatus}`;
      const adInList = state.ads.find((ad) => ad.id === writeState.adId);
      if (adInList) {
        adInList.status = targetStatus;
        adInList.effective_status = targetStatus;
        renderTable();
      }
    } catch (error) {
      writeState.statusMessage = error.message;
      writeState.statusError = true;
    } finally {
      writeState.statusBusy = false;
      renderWriteControls();
    }
  }

  function handleStatusToggleClick() {
    if (writeState.statusBusy) return;
    const targetStatus = writeState.adStatus === "ACTIVE" ? "PAUSED" : "ACTIVE";
    if (!writeState.statusConfirmArmed) {
      writeState.statusConfirmArmed = true;
      writeState.statusMessage = "";
      clearTimeout(writeState.statusConfirmTimer);
      writeState.statusConfirmTimer = setTimeout(() => {
        writeState.statusConfirmArmed = false;
        renderWriteControls();
      }, CONFIRM_ARM_MS);
      renderWriteControls();
      return;
    }
    resetStatusConfirm();
    performStatusChange(targetStatus);
  }

  async function performBudgetChange(value) {
    writeState.budgetBusy = true;
    writeState.budgetMessage = "Gönderiliyor...";
    writeState.budgetError = false;
    renderWriteControls();
    try {
      const res = await mAdsApi("/api/meta-ads/adset-budget", { method: "POST", body: JSON.stringify({ adset_id: writeState.adsetId, daily_budget_try: value, confirm: true }) });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data?.error?.message || "Bütçe güncellenemedi.");
      writeState.budgetMessage = `Bütçe güncellendi: ${formatMoney(value)}`;
    } catch (error) {
      writeState.budgetMessage = error.message;
      writeState.budgetError = true;
    } finally {
      writeState.budgetBusy = false;
      renderWriteControls();
    }
  }

  function handleBudgetSubmitClick() {
    if (writeState.budgetBusy) return;
    const value = Number(writeState.budgetValue);
    if (!Number.isFinite(value) || value < 1 || value > 100000) {
      writeState.budgetMessage = "Geçerli bir bütçe girin (TRY, 1-100000).";
      writeState.budgetError = true;
      renderWriteControls();
      return;
    }
    if (!writeState.budgetConfirmArmed) {
      writeState.budgetConfirmArmed = true;
      writeState.budgetMessage = "";
      clearTimeout(writeState.budgetConfirmTimer);
      writeState.budgetConfirmTimer = setTimeout(() => {
        writeState.budgetConfirmArmed = false;
        renderWriteControls();
      }, CONFIRM_ARM_MS);
      renderWriteControls();
      return;
    }
    resetBudgetConfirm();
    performBudgetChange(value);
  }

  // PR-4: silme. İki tıklamalı onay + PAUSED-only render guard'ı zaten
  // renderDeleteCard'ta — bu fonksiyon yalnız buton gerçekten görünürken
  // (yani status PAUSED'ken) çalışabilir durumda olacak şekilde yazıldı.
  async function performDelete() {
    writeState.deleteBusy = true;
    writeState.deleteMessage = "Siliniyor...";
    writeState.deleteError = false;
    renderWriteControls();
    try {
      const res = await mAdsApi("/api/meta-ads/ad-delete", { method: "POST", body: JSON.stringify({ ad_id: writeState.adId, confirm: true }) });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data?.error?.message || "Reklam silinemedi.");
      // deletion_semantics: "hard_delete"/"archived"/"still_present"/"unconfirmed" —
      // deleted:null, Meta'nın read-back'i sonucu kesin olarak doğrulayamadığı anlamına
      // gelir (uydurulmaz, olduğu gibi gösterilir). delete_call_issued/status/
      // effective_status de MCP döndürdüyse (garanti değil) aynı şekilde eklenir.
      const detailParts = [];
      if (data.deletion_semantics) detailParts.push(data.deletion_semantics);
      if (data.status) detailParts.push(`status: ${data.status}`);
      if (data.effective_status && data.effective_status !== data.status) detailParts.push(`effective_status: ${data.effective_status}`);
      if (data.delete_call_issued === false) detailParts.push("delete çağrısı hiç gönderilmedi (zaten DELETED/ARCHIVED idi)");
      const detail = detailParts.length ? ` (${detailParts.join(", ")})` : "";
      const deletedLabel = data.deleted === true ? "Silindi" : data.deleted === false ? "Silinmedi" : "Durum doğrulanamadı";
      writeState.deleteMessage = `${deletedLabel}${detail}`;
      state.ads = state.ads.filter((ad) => ad.id !== writeState.adId);
      renderTable();
      showListView();
      setListMessage(`Reklam silindi: ${writeState.adName || writeState.adId}${detail}`, false);
    } catch (error) {
      writeState.deleteMessage = error.message;
      writeState.deleteError = true;
      writeState.deleteBusy = false;
      renderWriteControls();
    }
  }

  function handleDeleteClick() {
    if (writeState.deleteBusy || writeState.adStatus !== "PAUSED") return;
    if (!writeState.deleteConfirmArmed) {
      writeState.deleteConfirmArmed = true;
      writeState.deleteMessage = "";
      clearTimeout(writeState.deleteConfirmTimer);
      writeState.deleteConfirmTimer = setTimeout(() => {
        writeState.deleteConfirmArmed = false;
        renderWriteControls();
      }, CONFIRM_ARM_MS);
      renderWriteControls();
      return;
    }
    resetDeleteConfirm();
    performDelete();
  }

  // PR-4: yeni kreatif oluştur + reklama bağla. previous_creative_id
  // (rollback bilgisi) ve new_creative_id her zaman gösterilir — bind adımı
  // başarısız olsa bile new_creative_id varsa (create başarılı ama bağlama
  // başarısız oldu) kaybolmasın diye hata mesajında da gösterilir.
  async function performCreativeUpdate() {
    writeState.creativeBusy = true;
    writeState.creativeResultMessage = "Kreatif oluşturuluyor ve bağlanıyor...";
    writeState.creativeResultError = false;
    renderWriteControls();
    try {
      const creativeName = (writeState.adName || writeState.adId) + " — güncel kreatif " + new Date().toISOString();
      const res = await mAdsApi("/api/meta-ads/ad-creative-update", {
        method: "POST",
        body: JSON.stringify({
          ad_id: writeState.adId,
          name: creativeName,
          message: writeState.creativeMessage,
          headline: writeState.creativeHeadline,
          description: writeState.creativeDescription,
          link: writeState.creativeLink,
          call_to_action_type: writeState.creativeCta,
          image_hash: writeState.creativeImageHash,
          confirm: true
        })
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        const extra = data?.error?.new_creative_id ? ` (yeni kreatif oluşturuldu ama bağlanamadı: ${data.error.new_creative_id})` : "";
        throw new Error(`${data?.error?.message || "Kreatif güncellenemedi."}${extra}`);
      }
      writeState.creativeResultMessage = `Kreatif bağlandı. Önceki: ${data.previous_creative_id || "—"} · Yeni: ${data.new_creative_id || "—"}`;
      // Metin/kartlar güncel kreatife göre yeniden yüklensin.
      await openAdDetail(writeState.adId);
      return;
    } catch (error) {
      writeState.creativeResultMessage = error.message;
      writeState.creativeResultError = true;
      writeState.creativeBusy = false;
      renderWriteControls();
    }
  }

  function handleCreativeSubmitClick() {
    if (writeState.creativeBusy) return;
    if (!writeState.creativeMessage.trim() || !writeState.creativeHeadline.trim() || !writeState.creativeLink.trim() || !writeState.creativeImageHash) {
      writeState.creativeResultMessage = "Ana metin, başlık, hedef URL ve görsel (image_hash) gerekli.";
      writeState.creativeResultError = true;
      renderWriteControls();
      return;
    }
    if (!writeState.creativeConfirmArmed) {
      writeState.creativeConfirmArmed = true;
      writeState.creativeResultMessage = "";
      clearTimeout(writeState.creativeConfirmTimer);
      writeState.creativeConfirmTimer = setTimeout(() => {
        writeState.creativeConfirmArmed = false;
        renderWriteControls();
      }, CONFIRM_ARM_MS);
      renderWriteControls();
      return;
    }
    resetCreativeConfirm();
    performCreativeUpdate();
  }

  async function openAdDetail(adId) {
    showDetailView();
    byId("meta-ads-detail-content").innerHTML = '<p class="hint">Yükleniyor...</p>';
    byId("meta-ads-write-controls").innerHTML = "";
    resetStatusConfirm();
    resetBudgetConfirm();
    resetDeleteConfirm();
    resetCreativeConfirm();
    writeState.adId = adId;
    writeState.adName = state.ads.find((ad) => ad.id === adId)?.name || null;
    writeState.adStatus = state.ads.find((ad) => ad.id === adId)?.status || null;
    writeState.adsetId = null;
    writeState.budgetValue = "";
    writeState.statusMessage = "";
    writeState.budgetMessage = "";
    writeState.deleteMessage = "";
    writeState.deleteBusy = false;
    writeState.creativeBusy = false;
    writeState.creativeResultMessage = "";
    try {
      const res = await mAdsApi(`/api/meta-ads/ad-creative?ad_id=${encodeURIComponent(adId)}`);
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data?.error?.message || "Kreatif bilgisi yüklenemedi.");
      renderDetail(data.creative);
      writeState.adsetId = data.creative.adset_id || null;
      writeState.adName = data.creative.ad_name || writeState.adName;
      // PR-4: kreatif formu, o ANIN mevcut kopyasıyla önceden doldurulur —
      // admin her alanı sıfırdan yazmak zorunda kalmaz, yalnız değiştirmek
      // istediğini düzenler. image_hash listesi kartlardan (tekilleştirilmiş) türetilir.
      writeState.creativeMessage = data.creative.primary_text || "";
      writeState.creativeHeadline = data.creative.headline || "";
      writeState.creativeDescription = data.creative.description || "";
      writeState.creativeLink = data.creative.destination_url || "";
      writeState.creativeCta = CTA_OPTIONS.includes(data.creative.call_to_action) ? data.creative.call_to_action : CTA_OPTIONS[0];
      writeState.creativeImageHashes = [...new Set((data.creative.cards || []).map((card) => card.image_hash).filter(Boolean))];
      writeState.creativeImageHash = writeState.creativeImageHashes[0] || "";
      renderWriteControls();
    } catch (error) {
      byId("meta-ads-detail-content").innerHTML = `<p class="error">${escapeHtml(error.message)}</p>`;
    }
  }

  function debouncedLoadAds() {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(loadAds, 350);
  }

  function wireEvents() {
    byId("meta-ads-status-filter").addEventListener("change", loadAds);
    byId("meta-ads-search").addEventListener("input", debouncedLoadAds);
    byId("meta-ads-refresh").addEventListener("click", loadAds);
    byId("meta-ads-back").addEventListener("click", showListView);
    byId("meta-ads-table-wrap").addEventListener("click", (event) => {
      const button = event.target.closest("[data-open-ad]");
      if (!button) return;
      openAdDetail(button.dataset.openAd);
    });
    document.querySelectorAll("[data-meta-ads-view]").forEach((button) =>
      button.addEventListener("click", () => (button.dataset.metaAdsView === "overview" ? showOverviewView() : showAdsListView()))
    );
    byId("meta-ads-detail-view").addEventListener("click", (event) => {
      if (event.target.id === "meta-ads-status-toggle") handleStatusToggleClick();
      if (event.target.id === "meta-ads-budget-submit") handleBudgetSubmitClick();
      if (event.target.id === "meta-ads-delete-submit") handleDeleteClick();
      if (event.target.id === "meta-ads-creative-submit") handleCreativeSubmitClick();
    });
    byId("meta-ads-detail-view").addEventListener("input", (event) => {
      if (event.target.id === "meta-ads-budget-input") {
        writeState.budgetValue = event.target.value;
        if (writeState.budgetConfirmArmed) {
          resetBudgetConfirm();
          const button = byId("meta-ads-budget-submit");
          if (button) {
            button.textContent = "Bütçeyi Güncelle";
            button.className = "";
          }
        }
        return;
      }
      // PR-4: kreatif formundaki herhangi bir alan değişirse (metin/CTA/görsel
      // dahil) armed onay sıfırlanır — eski onay yeni içeriğe sirayet etmez
      // (bütçedeki desenle aynı).
      const CREATIVE_FIELD_IDS = {
        "meta-ads-creative-message": "creativeMessage",
        "meta-ads-creative-headline": "creativeHeadline",
        "meta-ads-creative-description": "creativeDescription",
        "meta-ads-creative-link": "creativeLink",
        "meta-ads-creative-cta": "creativeCta",
        "meta-ads-creative-image-hash": "creativeImageHash"
      };
      const stateKey = CREATIVE_FIELD_IDS[event.target.id];
      if (!stateKey) return;
      writeState[stateKey] = event.target.value;
      if (writeState.creativeConfirmArmed) {
        resetCreativeConfirm();
        const button = byId("meta-ads-creative-submit");
        if (button) {
          button.textContent = "Yeni kreatif oluştur ve reklama bağla";
          button.className = "secondary";
        }
      }
    });
  }

  async function loadCurrentUserRole() {
    try {
      const res = await mAdsApi("/api/auth");
      const data = await res.json();
      state.isAdmin = Boolean(data?.user?.role === "Admin");
    } catch {
      state.isAdmin = false;
    }
  }

  async function initialize() {
    if (initialized) return;
    initialized = true;
    wireEvents();
    await loadCurrentUserRole();
    await loadOverview();
  }

  document.querySelectorAll('.brand-rail [data-tab="meta-ads"]').forEach((button) => button.addEventListener("click", initialize));
  const workspace = byId("workspace");
  new MutationObserver(() => {
    if (!workspace.classList.contains("hidden")) initialize();
  }).observe(workspace, { attributes: true, attributeFilter: ["class"] });
  if (!workspace.classList.contains("hidden")) initialize();
})();
