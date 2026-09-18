/* META REKLAMLAR — PR-1 (salt-okunur reklam listesi + kreatif analizi). Hiçbir write çağrısı yapılmaz. */
(function () {
  "use strict";

  const state = { ads: [], loading: false };
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
        <th style="padding:8px">Campaign ID</th><th style="padding:8px">Ad Set ID</th><th style="padding:8px"></th>
      </tr></thead>
      <tbody>${state.ads
        .map(
          (ad) => `<tr style="border-bottom:1px solid #edf0f2">
          <td style="padding:8px">${escapeHtml(ad.name || ad.id)}<br><span class="hint">${escapeHtml(ad.id)}</span></td>
          <td style="padding:8px">${escapeHtml(ad.status)}</td>
          <td style="padding:8px">${escapeHtml(ad.effective_status)}</td>
          <td style="padding:8px">${escapeHtml(ad.campaign_id)}</td>
          <td style="padding:8px">${escapeHtml(ad.adset_id)}</td>
          <td style="padding:8px"><button type="button" class="secondary" data-open-ad="${escapeHtml(ad.id)}">İncele</button></td>
        </tr>`
        )
        .join("")}</tbody>
    </table>`;
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
  }

  async function initialize() {
    if (initialized) return;
    initialized = true;
    wireEvents();
    await loadAds();
  }

  document.querySelectorAll('.brand-rail [data-tab="meta-ads"]').forEach((button) => button.addEventListener("click", initialize));
  const workspace = byId("workspace");
  new MutationObserver(() => {
    if (!workspace.classList.contains("hidden")) initialize();
  }).observe(workspace, { attributes: true, attributeFilter: ["class"] });
  if (!workspace.classList.contains("hidden")) initialize();
})();
