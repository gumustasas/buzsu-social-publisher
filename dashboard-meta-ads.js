/* META REKLAMLAR — PR-1 (salt-okunur reklam listesi + kreatif analizi) + PR-2
   (Genel Bakış: bugün/7 gün performansı, low_volume uyarısı, aktif kampanya
   sayısı, Pixel durumu, reklam listesinde campaign/adset isim çözümlemesi).
   Hiçbir write çağrısı yapılmaz. */
(function () {
  "use strict";

  const state = { ads: [], loading: false, adsLoaded: false, currency: "TRY" };
  let initialized = false;
  let searchDebounceTimer = null;

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

  function renderLowVolumeSignal(signal) {
    const label = signal.basis === "impressions" ? "Gösterim" : LOW_VOLUME_METRIC_LABELS[signal.metric] || signal.metric || "Sonuç";
    const value = formatNullable(signal.value, (v) => formatNumber(v));
    return `${escapeHtml(label)}: ${value} / eşik ${formatNumber(signal.threshold)}`;
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
    const lowVolumeHtml = lowVolume?.flagged
      ? `<div class="card" style="margin-top:12px"><p class="error">⚠ Sonuç hacmi düşük (7 gün)</p><ul style="margin:8px 0 0;padding-left:20px">${lowVolume.signals
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

  async function openAdDetail(adId) {
    showDetailView();
    byId("meta-ads-detail-content").innerHTML = '<p class="hint">Yükleniyor...</p>';
    try {
      const res = await mAdsApi(`/api/meta-ads/ad-creative?ad_id=${encodeURIComponent(adId)}`);
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data?.error?.message || "Kreatif bilgisi yüklenemedi.");
      renderDetail(data.creative);
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
  }

  async function initialize() {
    if (initialized) return;
    initialized = true;
    wireEvents();
    await loadOverview();
  }

  document.querySelectorAll('.brand-rail [data-tab="meta-ads"]').forEach((button) => button.addEventListener("click", initialize));
  const workspace = byId("workspace");
  new MutationObserver(() => {
    if (!workspace.classList.contains("hidden")) initialize();
  }).observe(workspace, { attributes: true, attributeFilter: ["class"] });
  if (!workspace.classList.contains("hidden")) initialize();
})();
