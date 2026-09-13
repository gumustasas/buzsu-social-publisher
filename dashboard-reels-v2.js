/* AI REELS V2 — PR-D (Product -> Script -> Scene Approval) + PR-E (Step 5: sahne bazlı Veo video üretimi). Adım 6/7 (Ses & Müzik, Final Reel) hâlâ pasif/sonraki PR. */
(function () {
  "use strict";

  const state = {
    currentStep: 1,
    productContext: null,
    creativeSettings: {
      provider: "auto",
      modelTier: "balanced",
      model: null,
      objective: "sales",
      durationSeconds: 8,
      aspectRatio: "9:16",
      userBrief: ""
    },
    reelScript: null,
    approvedScenes: {},
    generatedSceneVideos: {},
    sceneReferenceImages: {},
    videoSettings: { modelTier: "auto", resolution: "" },
    narration: null,
    music: null,
    finalVideo: null
  };
  window.aiReelsV2State = state;

  const SILENT_MARKER = "NO spoken dialogue.";
  const SILENT_CONSTRAINT = "NO spoken dialogue. NO narration. NO background music. NO generated captions.";
  const IDENTITY_MARKER = "Preserve the exact physical product";
  const IDENTITY_LOCK = "Preserve the exact physical product shown in the supplied reference image. Do not redesign the product. Do not alter proportions, housing count, connections, colors, geometry, logo placement or visible physical components. NO invented product labels. NO rewritten logo. NO generated brand typography.";
  const options = { durations: [], aspectRatios: [], objectives: [], tiers: [], providers: [], models: [] };
  const objectiveLabels = { sales: "Satış", awareness: "Farkındalık", product_demo: "Ürün demosu", educational: "Eğitici" };
  const providerLabels = { auto: "Otomatik", openai: "OpenAI", google: "Google" };
  const tierLabels = { economy: "Ekonomik", balanced: "Dengeli", quality: "Kaliteli", premium: "Premium" };
  let initialized = false;
  let pendingPaidFingerprint = null;
  let pendingPaidTimer = null;
  let selectedProductId = "";
  let productCatalog = [];
  // Step 5 (PR-E): sahne bazlı Veo onayı — dashboard.html'deki mevcut
  // #generate-reel danger-button ile AYNI iki-adımlı desen, ama sahne
  // başına AYRI bir anahtar (confirmKey referans görseli + tier/resolution'ı
  // da içerir — herhangi biri değişirse onay iptal olur).
  const pendingSceneConfirm = {};
  const pendingSceneConfirmTimers = {};

  const byId = (id) => document.getElementById(id);
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  const safeUrl = (value) => /^https:\/\//i.test(String(value || "")) ? String(value) : "";
  const v2Api = (path, requestOptions = {}) => fetch(path, {
    credentials: "same-origin",
    ...requestOptions,
    headers: { "Content-Type": "application/json", ...(requestOptions.headers || {}) }
  });

  function fillSelect(select, values, labeler) {
    select.innerHTML = values.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(labeler(value))}</option>`).join("");
  }

  function allScenesVideoCompleted() {
    return Boolean(state.reelScript?.scenes?.length) && state.reelScript.scenes.every((scene) => state.generatedSceneVideos[scene.sceneId]?.status === "completed" && state.generatedSceneVideos[scene.sceneId]?.videoUrl);
  }

  function renderSteps() {
    const labels = ["Ürün", "Kreatif Ayarlar", "AI Senaryo", "Sahne Onayı", "Video Üretimi", "Ses & Müzik", "Final Reel"];
    byId("reels-v2-steps").innerHTML = labels.map((label, index) => {
      const step = index + 1;
      // Adım 5 (Video Üretimi) bu PR'da AKTİF hale geldi — yalnız 6/7
      // (Ses & Müzik, Final Reel) hâlâ pasif ve "Sonraki PR" olarak kalır.
      const passive = step > 5;
      const complete = step < state.currentStep || (step === 4 && allScenesApproved()) || (step === 5 && allScenesVideoCompleted());
      const className = `reels-v2-step${complete ? " complete" : step === state.currentStep ? " active" : ""}`;
      return `<button type="button" class="${className}" data-v2-step="${step}"${passive ? " disabled" : ""}>${step}. ${escapeHtml(label)}${passive ? " · Sonraki PR" : ""}</button>`;
    }).join("");
  }

  function resetPaidConfirmation() {
    pendingPaidFingerprint = null;
    clearTimeout(pendingPaidTimer);
    const button = byId("reels-v2-generate");
    button.textContent = "AI senaryoyu üret (ücretli)";
    button.classList.remove("danger");
  }

  function resetScriptState() {
    state.reelScript = null;
    state.approvedScenes = {};
    state.generatedSceneVideos = {};
    state.sceneReferenceImages = {};
    Object.keys(pendingSceneConfirm).forEach(resetSceneConfirm);
    state.currentStep = state.productContext ? 2 : 1;
    byId("reels-v2-script-summary").classList.add("hidden");
    byId("reels-v2-script-summary").innerHTML = "";
    byId("reels-v2-scenes").innerHTML = '<p class="hint">Önce AI senaryo üretin.</p>';
    byId("reels-v2-validate").disabled = true;
    byId("reels-v2-approve-all").disabled = true;
    byId("reels-v2-approval-message").textContent = "";
    byId("reels-v2-video-scenes").innerHTML = '<p class="hint">Önce Adım 4\'te sahneleri onaylayın.</p>';
    byId("reels-v2-video-message").textContent = "";
    renderSteps();
  }

  function resetSceneConfirm(sceneId) {
    delete pendingSceneConfirm[sceneId];
    clearTimeout(pendingSceneConfirmTimers[sceneId]);
    delete pendingSceneConfirmTimers[sceneId];
  }

  function settingChanged(invalidateConfirmation = true) {
    state.creativeSettings.provider = byId("reels-v2-provider").value;
    state.creativeSettings.modelTier = byId("reels-v2-tier").value;
    state.creativeSettings.objective = byId("reels-v2-objective").value;
    state.creativeSettings.durationSeconds = Number(byId("reels-v2-duration").value);
    state.creativeSettings.aspectRatio = byId("reels-v2-aspect").value;
    state.creativeSettings.userBrief = byId("reels-v2-brief").value.trim();
    state.creativeSettings.model = byId("reels-v2-custom-toggle").checked ? (byId("reels-v2-custom-model").value || null) : null;
    if (invalidateConfirmation) resetPaidConfirmation();
    renderCustomModels();
    renderResolution();
  }

  function availableModels(provider) {
    return options.models.filter((model) => model.available && (provider === "auto" || model.provider === provider));
  }

  function renderCustomModels() {
    const custom = byId("reels-v2-custom-toggle").checked;
    const wrap = byId("reels-v2-custom-wrap");
    wrap.classList.toggle("hidden", !custom);
    if (!custom) return;
    const provider = byId("reels-v2-provider").value;
    const select = byId("reels-v2-custom-model");
    const previous = select.value;
    const models = provider === "auto" ? [] : availableModels(provider);
    select.innerHTML = '<option value="">Model seçin</option>' + models.map((model) => `<option value="${escapeHtml(model.model)}">${escapeHtml(model.displayName || model.model)}</option>`).join("");
    if (models.some((model) => model.model === previous)) select.value = previous;
    if (provider === "auto") wrap.querySelector("select").innerHTML = '<option value="">Özel model için önce OpenAI veya Google seçin</option>';
  }

  function resolveSelection() {
    const settings = state.creativeSettings;
    if (byId("reels-v2-custom-toggle").checked) {
      if (settings.provider === "auto" || !settings.model) return null;
      const model = availableModels(settings.provider).find((item) => item.model === settings.model);
      return model ? { provider: model.provider, model: model.model, tier: model.tierCandidate || "custom", custom: true } : null;
    }
    const providers = settings.provider === "auto" ? options.providers.filter((provider) => provider !== "auto") : [settings.provider];
    for (const provider of providers) {
      const model = availableModels(provider).find((item) => item.tierCandidate === settings.modelTier);
      if (model) return { provider, model: model.model, tier: settings.modelTier, custom: false };
    }
    return null;
  }

  function renderResolution() {
    const resolved = resolveSelection();
    byId("reels-v2-resolution").textContent = resolved
      ? `Onaylanacak seçim: ${providerLabels[resolved.provider] || resolved.provider} · ${resolved.model} · ${tierLabels[resolved.tier] || resolved.tier}`
      : "Bu seçim için erişilebilir/yapılandırılmış model bulunamadı. Başka sağlayıcı, tier veya keşfedilmiş özel model seçin.";
  }

  async function loadOptions() {
    const response = await v2Api("/api/reel-script?action=options");
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "AI Reels seçenekleri yüklenemedi.");
    Object.assign(options, data);
    fillSelect(byId("reels-v2-provider"), options.providers, (value) => providerLabels[value] || value);
    fillSelect(byId("reels-v2-tier"), options.tiers, (value) => tierLabels[value] || value);
    fillSelect(byId("reels-v2-objective"), options.objectives, (value) => objectiveLabels[value] || value);
    fillSelect(byId("reels-v2-duration"), options.durations, (value) => `${value} saniye`);
    fillSelect(byId("reels-v2-aspect"), options.aspectRatios, (value) => value);
    byId("reels-v2-provider").value = state.creativeSettings.provider;
    byId("reels-v2-tier").value = state.creativeSettings.modelTier;
    byId("reels-v2-objective").value = state.creativeSettings.objective;
    byId("reels-v2-duration").value = String(state.creativeSettings.durationSeconds);
    byId("reels-v2-aspect").value = state.creativeSettings.aspectRatio;
    renderCustomModels();
    renderResolution();
  }

  function productLabel(product) {
    return product.title || product.productName || product.name || "İsimsiz ürün";
  }

  function refreshProductSelect() {
    const search = byId("reels-v2-product-search").value.trim().toLocaleLowerCase("tr-TR");
    const visible = productCatalog.filter((product) => !search || productLabel(product).toLocaleLowerCase("tr-TR").includes(search));
    const select = byId("reels-v2-product");
    select.innerHTML = '<option value="">Ürün seçin</option>' + visible.map((product) => `<option value="${escapeHtml(product.id)}">${escapeHtml(productLabel(product))}</option>`).join("");
    if (visible.some((product) => product.id === selectedProductId)) select.value = selectedProductId;
  }

  async function loadProductCatalog() {
    const response = await v2Api("/api/content");
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Ürünler okunamadı.");
    productCatalog = Array.isArray(data.products) ? data.products : [];
    refreshProductSelect();
  }

  function listText(items) {
    return (items || []).map((item) => typeof item === "string" ? item : (item.fact || item.label || item.category || JSON.stringify(item))).filter(Boolean);
  }

  function renderProductContext(context) {
    const wrap = byId("reels-v2-product-context");
    const images = (context.productImageUrls || []).map((url) => safeUrl(url) ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener"><img src="${escapeHtml(url)}" alt="${escapeHtml(context.productName)}"></a>` : "").join("");
    const facts = (context.verifiedFacts || []).map((fact) => `<li>${escapeHtml(fact.fact || fact)}${safeUrl(fact.sourceUrl) ? ` <a href="${escapeHtml(fact.sourceUrl)}" target="_blank" rel="noopener">kaynak ↗</a>` : ""}</li>`).join("");
    const prohibited = listText(context.prohibitedClaims).map((item) => `<li>${escapeHtml(item)}</li>`).join("");
    const sources = (context.sourceUrls || []).filter(safeUrl).map((url) => `<li><a href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(url)}</a></li>`).join("");
    wrap.innerHTML = `<div class="reels-v2-context"><div><h4>${escapeHtml(context.productName)}</h4><p><a href="${escapeHtml(safeUrl(context.canonicalUrl))}" target="_blank" rel="noopener">${escapeHtml(context.canonicalUrl)}</a></p><strong>Doğrulanmış bilgiler</strong><ul class="reels-v2-facts">${facts || "<li>Doğrulanmış bilgi bulunamadı.</li>"}</ul><strong>Kaynaklar</strong><ul class="reels-v2-facts">${sources || "<li>Kaynak bulunamadı.</li>"}</ul></div><div><div class="reels-v2-images">${images || "Görsel bulunamadı."}</div><strong style="display:block;margin-top:10px">Kullanılmaması gereken iddialar</strong><ul class="reels-v2-facts">${prohibited || "<li>Ek kısıt bildirilmedi.</li>"}</ul></div></div>`;
    wrap.classList.remove("hidden");
  }

  async function selectProduct() {
    const select = byId("reels-v2-product");
    const nextId = select.value;
    if (state.reelScript && nextId !== selectedProductId && !confirm("Ürün değişikliği mevcut senaryo düzenlemelerini ve onaylarını sıfırlayacak. Devam edilsin mi?")) {
      select.value = selectedProductId;
      return;
    }
    selectedProductId = nextId;
    state.productContext = null;
    resetScriptState();
    resetPaidConfirmation();
    byId("reels-v2-product-context").classList.add("hidden");
    if (!nextId) { byId("reels-v2-product-message").textContent = "Ürün seçin."; return; }
    const message = byId("reels-v2-product-message");
    message.textContent = "Doğrulanmış ürün bağlamı getiriliyor...";
    try {
      const response = await v2Api(`/api/reel-script?action=product-context&productId=${encodeURIComponent(nextId)}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Ürün bilgisi alınamadı.");
      state.productContext = data.productContext;
      state.currentStep = 2;
      renderProductContext(state.productContext);
      renderSteps();
      message.textContent = "Ürün bilgisi Buzsu kaynaklarından doğrulandı.";
    } catch (error) {
      message.textContent = error.message;
    }
  }

  function paidFingerprint(resolved) {
    return JSON.stringify({ productId: selectedProductId, ...state.creativeSettings, resolved });
  }

  function autofillAudio(script) {
    byId("reel-audio-narration-text").value = script.fullNarrationText || "";
    byId("reel-audio-music-prompt").value = script.musicBrief?.lyriaPrompt || "";
    byId("reel-audio-duration").value = script.durationSeconds || "";
    byId("reel-audio-product-name").value = script.product?.name || "";
  }

  function creativePrompt(prompt) {
    return String(prompt || "").replace(SILENT_CONSTRAINT, "").replace(IDENTITY_LOCK, "").trim();
  }

  function sceneConstraints(scene) {
    const lines = ["NO spoken dialogue", "NO narration", "NO background music", "NO generated captions"];
    if (scene.referenceImageRequired) lines.push("Product Identity Lock: ürün geometrisi, housing sayısı, bağlantılar, renkler, logo ve görünür bileşenler değiştirilemez");
    return lines.join("\n");
  }

  function renderScript() {
    const script = state.reelScript;
    const summary = byId("reels-v2-script-summary");
    // claim'ler BLOKLANMAZ (ürün kararı) — burada yalnız kaynak eşleşmesi
    // gösterilir, böylece onaylayan kişi neyin doğrulanmış bilgiye dayandığını
    // görerek karar verir.
    const claims = (script.claimsUsed || []).map((claim) => {
      const verified = claim.provenance === "verified" && safeUrl(claim.sourceUrl);
      const badge = verified
        ? `<br><a href="${escapeHtml(claim.sourceUrl)}" target="_blank" rel="noopener">Doğrulanmış kaynak ↗</a>`
        : '<br><span class="hint">Kaynak eşleşmesi bulunamadı — lütfen kendiniz kontrol edin</span>';
      return `<div class="reels-v2-claim">${escapeHtml(claim.claim)}${badge}</div>`;
    }).join("");
    summary.innerHTML = `<h4>${escapeHtml(script.title)}</h4><p><strong>Konsept:</strong> ${escapeHtml(script.concept)}</p><p><strong>Hook:</strong> ${escapeHtml(script.hook)}</p><p class="meta">${escapeHtml(script.provider)} · ${escapeHtml(script.modelUsed)} · ${escapeHtml(script.modelTier || "custom")} · ${escapeHtml(script.durationSeconds)} sn · ${escapeHtml(script.aspectRatio)}</p>${claims ? `<strong>Kullanılan ürün iddiaları</strong><div class="reels-v2-claims">${claims}</div>` : '<p class="hint">Model factual ürün iddiası bildirmedi.</p>'}`;
    summary.classList.remove("hidden");
    byId("reels-v2-scenes").innerHTML = script.scenes.map((scene) => `<article class="reels-v2-scene${state.approvedScenes[scene.sceneId] ? " approved" : ""}" data-scene-id="${escapeHtml(scene.sceneId)}"><div class="reels-v2-scene-head"><strong>${escapeHtml(scene.sceneId)} · ${escapeHtml(scene.startSeconds)}–${escapeHtml(scene.endSeconds)} sn</strong><span>${state.approvedScenes[scene.sceneId] ? "✓ Onaylandı" : "Onay bekliyor"}</span></div><p class="meta">Amaç: ${escapeHtml(scene.purpose)} · Ürün görünürlüğü: ${escapeHtml(scene.productVisibility)}</p><div class="reels-v2-scene-grid"><label class="field-label wide">Görsel açıklama<textarea data-scene-field="visualDescription" rows="2">${escapeHtml(scene.visualDescription)}</textarea></label><label class="field-label">Aksiyon<textarea data-scene-field="action" rows="2">${escapeHtml(scene.action)}</textarea></label><label class="field-label">Kamera<textarea data-scene-field="camera" rows="2">${escapeHtml(scene.camera)}</textarea></label><label class="field-label wide">Türkçe seslendirme<textarea data-scene-field="narrationText" rows="2">${escapeHtml(scene.narrationText)}</textarea></label><label class="field-label">Ekran yazısı<input data-scene-field="onScreenText" value="${escapeHtml(scene.onScreenText)}"></label><label class="field-label">Geçiş<input data-scene-field="transition" value="${escapeHtml(scene.transition)}"></label><label class="field-label wide">Creative Veo prompt<textarea data-scene-field="veoPrompt" rows="4">${escapeHtml(creativePrompt(scene.veoPrompt))}</textarea></label></div><strong class="meta" style="display:block;margin-top:8px">Sistem kısıtları — değiştirilemez</strong><div class="reels-v2-constraints">${escapeHtml(sceneConstraints(scene))}</div><div class="reels-v2-actions"><button type="button" data-approve-scene="${escapeHtml(scene.sceneId)}">${state.approvedScenes[scene.sceneId] ? "Onayı kaldır" : "Doğrula ve onayla"}</button></div></article>`).join("");
    byId("reels-v2-validate").disabled = false;
    byId("reels-v2-approve-all").disabled = false;
    renderSteps();
    renderVideoScenes();
  }

  function collectSceneEdits() {
    if (!state.reelScript) return null;
    const scenes = state.reelScript.scenes.map((scene) => {
      const card = [...document.querySelectorAll(".reels-v2-scene")].find((item) => item.dataset.sceneId === scene.sceneId);
      if (!card) return scene;
      const updated = { ...scene };
      card.querySelectorAll("[data-scene-field]").forEach((field) => { updated[field.dataset.sceneField] = field.value; });
      return updated;
    });
    return { ...state.reelScript, scenes, fullNarrationText: scenes.map((scene) => scene.narrationText.trim()).filter(Boolean).join(" ") };
  }

  async function validateEdits({ approveSceneId = null, approveAll = false } = {}) {
    const message = byId("reels-v2-approval-message");
    const candidate = collectSceneEdits();
    if (!candidate) return;
    message.textContent = "Sahneler doğrulanıyor (ücretsiz, inference yok)...";
    const response = await v2Api("/api/reel-script?action=validate", { method: "POST", body: JSON.stringify({ productId: selectedProductId, reelScript: candidate }) });
    const data = await response.json();
    if (!response.ok) throw new Error(`${data.code ? `${data.code}: ` : ""}${data.error || "Doğrulama başarısız"}`);
    state.reelScript = data.reelScript;
    if (approveAll) state.approvedScenes = Object.fromEntries(state.reelScript.scenes.map((scene) => [scene.sceneId, true]));
    if (approveSceneId) state.approvedScenes[approveSceneId] = true;
    state.currentStep = allScenesApproved() ? 5 : state.currentStep;
    autofillAudio(state.reelScript);
    renderScript();
    message.textContent = allScenesApproved() ? "Tüm sahneler doğrulandı ve onaylandı. PR-D akışı tamamlandı." : "Değişiklikler server tarafından doğrulandı.";
  }

  function allScenesApproved() {
    return Boolean(state.reelScript?.scenes?.length) && state.reelScript.scenes.every((scene) => state.approvedScenes[scene.sceneId] === true);
  }

  // AI Reels V2 PR-E — Step 5 (Video Üretimi). YENİ bir Veo sistemi YAZILMAZ;
  // burada yalnızca PR-D'nin zaten onayladığı scene.veoPrompt, /api/reel-scene-video
  // (mevcut submitVeoVideo'yu saran TEK yeni endpoint) ve /api/veo-video
  // (mevcut, DEĞİŞTİRİLMEMİŞ durum sorgulama endpoint'i) üzerinden çağrılır.
  //
  // dashboard.html'deki #generate-reel VEYA #veo-model-tier'a HİÇ dokunulmaz
  // — bu, o akıştan tamamen AYRI, izole bir sahne bazlı akıştır.

  // RATE_LIMITED (bkz. src/veo-video.js:VeoApiError) — dashboard.html'deki
  // veoErrorMessage ile AYNI mantık, ama bu dosya izole kalması gerektiği için
  // (bkz. test/dashboard-reels-v2.test.js) kendi kopyası.
  function veoErrorMessage(data, fallback) {
    const base = (data && data.error) || fallback || "Video üretimi başarısız";
    if (!data || data.code !== "RATE_LIMITED") return base;
    const alts = (data.alternatives || []).map((item) => item.label || item.tier).join(", ");
    return `${base}${alts ? ` Alternatif modeller: ${alts}.` : ""}`;
  }

  // Gerçek backend durumları (IN_PROGRESS/COMPLETED, ya da bir hata) burada
  // spesifikasyonun istediği sabit UI durum kümesine normalize edilir:
  // idle | awaiting_confirmation | generating | completed | failed.
  function sceneVideoUiStatus(sceneId) {
    const entry = state.generatedSceneVideos[sceneId];
    if (entry?.pending) return "generating";
    if (entry?.status === "completed" && entry.videoUrl) return "completed";
    if (entry?.status === "failed") return "failed";
    return pendingSceneConfirm[sceneId] ? "awaiting_confirmation" : "idle";
  }

  function renderVideoScenes() {
    const container = byId("reels-v2-video-scenes");
    if (!state.reelScript?.scenes?.length) {
      container.innerHTML = '<p class="hint">Önce Adım 3-4\'te bir senaryo üretip sahneleri onaylayın.</p>';
      return;
    }
    const images = (state.productContext?.productImageUrls || []).filter(safeUrl);
    const statusLabels = { idle: "Üretilmedi", awaiting_confirmation: "Onay bekliyor — tekrar bas", generating: "Üretiliyor (Veo)...", completed: "Tamamlandı", failed: "Başarısız" };
    container.innerHTML = state.reelScript.scenes.map((scene) => {
      const approved = state.approvedScenes[scene.sceneId] === true;
      const entry = state.generatedSceneVideos[scene.sceneId];
      const uiStatus = sceneVideoUiStatus(scene.sceneId);
      const selectedRef = state.sceneReferenceImages[scene.sceneId] || "";
      const thumbs = images.map((url) => `<button type="button" class="reels-v2-ref-thumb${selectedRef === url ? " selected" : ""}" data-video-ref-thumb data-scene-id="${escapeHtml(scene.sceneId)}" data-url="${escapeHtml(url)}"><img src="${escapeHtml(url)}" alt=""></button>`).join("")
        || '<p class="hint">Bu ürün için görsel bulunamadı — referans görseli olmadan Veo video üretilemez.</p>';
      const buttonLabel = entry?.videoUrl ? "Sahneyi yeniden üret (ücretli)" : "Sahne videosu üret (ücretli)";
      const disabled = !approved || !selectedRef || uiStatus === "generating";
      const preview = entry?.videoUrl ? `<video controls src="${escapeHtml(entry.videoUrl)}" style="width:100%;max-width:280px;border-radius:8px;margin-top:8px;background:#0e1a25"></video>` : "";
      const errorLine = entry?.error ? `<p class="error">${escapeHtml(entry.error)}</p>` : "";
      return `<article class="reels-v2-scene${uiStatus === "completed" ? " approved" : ""}" data-video-scene-id="${escapeHtml(scene.sceneId)}">
        <div class="reels-v2-scene-head"><strong>${escapeHtml(scene.sceneId)} · ${escapeHtml(scene.startSeconds)}–${escapeHtml(scene.endSeconds)} sn</strong><span>${approved ? statusLabels[uiStatus] : "Onay bekliyor (Adım 4)"}</span></div>
        <p class="meta">Referans ürün görseli seçin (image-to-video girdisi):</p>
        <div class="reels-v2-ref-thumbs">${thumbs}</div>
        <div class="reels-v2-actions"><button type="button" data-generate-scene-video data-scene-id="${escapeHtml(scene.sceneId)}"${disabled ? " disabled" : ""}>${buttonLabel}</button></div>
        ${errorLine}${preview}
      </article>`;
    }).join("");
  }

  async function pollSceneVideo(sceneId) {
    const entry = state.generatedSceneVideos[sceneId];
    if (!entry || !entry.pending || !entry.jobId) return;
    try {
      const response = await v2Api("/api/veo-video", { method: "POST", body: JSON.stringify({ job: { operationName: entry.jobId, model: entry.model } }) });
      const data = await response.json();
      if (!response.ok) throw new Error(veoErrorMessage(data));
      const job = data.veo;
      // Polling ASLA yeni bir iş başlatmaz/mevcut işi yeniden tetiklemez —
      // yalnızca aynı operationName'in durumunu okur (bkz. api/veo-video.js).
      if (job.status !== "COMPLETED") {
        setTimeout(() => pollSceneVideo(sceneId), 5000);
        return;
      }
      const current = state.generatedSceneVideos[sceneId] || entry;
      state.generatedSceneVideos[sceneId] = {
        status: "completed",
        jobId: entry.jobId,
        model: entry.model,
        provider: entry.provider,
        createdAt: entry.createdAt,
        videoUrl: job.videoUrl || current.videoUrl || null,
        pending: false,
        error: job.videoUrl ? null : (job.downloadNote || "Video hazır ama kalıcı bağlantı alınamadı.")
      };
      renderVideoScenes();
      renderSteps();
    } catch (error) {
      // §9: hata durumunda ASLA başka bir provider/model'e otomatik geçilmez,
      // otomatik ikinci bir üretim BAŞLATILMAZ. Önceki (varsa) tamamlanmış
      // sonuç KORUNUR — yalnızca yeni deneme başarısız işaretlenir.
      const current = state.generatedSceneVideos[sceneId] || entry;
      state.generatedSceneVideos[sceneId] = { ...current, pending: false, status: current.videoUrl ? "completed" : "failed", error: error.message };
      renderVideoScenes();
    }
  }

  async function generateSceneVideo(sceneId) {
    const message = byId("reels-v2-video-message");
    const scene = state.reelScript?.scenes?.find((item) => item.sceneId === sceneId);
    if (!scene) return;
    // §2: onaylanmamış sahne için üretim ASLA tetiklenmez.
    if (state.approvedScenes[sceneId] !== true) { message.textContent = "Bu sahne henüz onaylanmadı — önce Adım 4'te doğrulayıp onaylayın."; return; }
    const referenceImageUrl = state.sceneReferenceImages[sceneId];
    if (!referenceImageUrl) { message.textContent = "Önce bu sahne için bir referans ürün görseli seçin."; return; }
    const modelTier = state.videoSettings.modelTier;
    const resolution = state.videoSettings.resolution;
    const confirmKey = `${sceneId}:${referenceImageUrl}:${modelTier}:${resolution}`;
    // §8: İLK TIKLAMA ASLA ücretli çağrı tetiklemez — yalnızca özet/onay gösterir.
    if (pendingSceneConfirm[sceneId] !== confirmKey) {
      pendingSceneConfirm[sceneId] = confirmKey;
      clearTimeout(pendingSceneConfirmTimers[sceneId]);
      pendingSceneConfirmTimers[sceneId] = setTimeout(() => { resetSceneConfirm(sceneId); renderVideoScenes(); }, 8000);
      renderVideoScenes();
      message.textContent = `${sceneId}: Google Veo 3.1 ile gerçek bir video oluşturulacak (${Math.max(1, Math.round(scene.endSeconds - scene.startSeconds))} sn, ${resolution || "varsayılan çözünürlük"}, ${modelTier}) ve Google kredinizden düşülecek. Onaylamak için butona 8 saniye içinde tekrar bas.`;
      return;
    }
    resetSceneConfirm(sceneId);
    const durationSeconds = Math.max(1, Math.round(Number(scene.endSeconds) - Number(scene.startSeconds)));
    const previous = state.generatedSceneVideos[sceneId] || { status: "idle", jobId: null, model: null, provider: null, createdAt: null, videoUrl: null, error: null };
    // §12: eski (varsa tamamlanmış) sonuç, yeni üretim BAŞARILI olana kadar
    // ASLA silinmez — videoUrl burada korunur, yalnızca pending:true eklenir.
    state.generatedSceneVideos[sceneId] = { ...previous, pending: true, error: null };
    renderVideoScenes();
    message.textContent = `${sceneId} için Veo 3.1 video üretimi başladı (Google kredinizden düşülür).`;
    try {
      const response = await v2Api("/api/reel-scene-video", {
        method: "POST",
        body: JSON.stringify({
          sceneId,
          approved: true,
          confirmed: true,
          referenceImageUrl,
          referenceImageRequired: scene.referenceImageRequired === true,
          veoPrompt: scene.veoPrompt,
          aspectRatio: state.creativeSettings.aspectRatio,
          durationSeconds,
          resolution: resolution || undefined,
          model: modelTier === "auto" ? undefined : modelTier
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(veoErrorMessage(data));
      state.generatedSceneVideos[sceneId] = {
        status: "generating",
        jobId: data.veo.operationName,
        model: data.veo.model,
        provider: data.veo.provider,
        createdAt: data.veo.createdAt,
        videoUrl: previous.videoUrl || null,
        pending: true,
        error: null
      };
      renderVideoScenes();
      pollSceneVideo(sceneId);
    } catch (error) {
      state.generatedSceneVideos[sceneId] = { ...previous, pending: false, status: previous.videoUrl ? "completed" : "failed", error: error.message };
      renderVideoScenes();
      message.textContent = error.message;
    }
  }

  async function generateScript() {
    const button = byId("reels-v2-generate");
    const message = byId("reels-v2-generate-message");
    settingChanged(false);
    if (!state.productContext || !selectedProductId) { message.textContent = "Önce ürün seçip doğrulanmış ürün bağlamını yükleyin."; return; }
    const resolved = resolveSelection();
    if (!resolved) { message.textContent = "Seçilen provider/tier için kullanılabilir model yok."; return; }
    const fingerprint = paidFingerprint(resolved);
    if (state.reelScript && pendingPaidFingerprint !== fingerprint && !confirm("Yeni senaryo mevcut sahne düzenlemelerini ve onaylarını sıfırlayacak. Devam edilsin mi?")) return;
    if (pendingPaidFingerprint !== fingerprint) {
      pendingPaidFingerprint = fingerprint;
      button.textContent = "Emin misiniz? Ücretli üretimi başlat";
      button.classList.add("danger");
      clearTimeout(pendingPaidTimer);
      pendingPaidTimer = setTimeout(resetPaidConfirmation, 10000);
      message.textContent = `Ücretli AI çağrısı: ${providerLabels[resolved.provider] || resolved.provider} · ${resolved.model} · ${tierLabels[resolved.tier] || resolved.tier}. 10 saniye içinde tekrar basarak onaylayın.`;
      return;
    }
    resetPaidConfirmation();
    button.disabled = true;
    message.textContent = "Doğrulanmış ürün bilgileriyle AI senaryo hazırlanıyor...";
    try {
      const payload = {
        productId: selectedProductId,
        provider: resolved.provider,
        modelTier: resolved.custom ? undefined : resolved.tier,
        // Kullanıcının onayladığı gerçek modeli kilitle; generateReelScript selectable
        // discovery doğrulamasını yine server tarafında uygular.
        model: resolved.model,
        objective: state.creativeSettings.objective,
        durationSeconds: state.creativeSettings.durationSeconds,
        aspectRatio: state.creativeSettings.aspectRatio,
        userBrief: state.creativeSettings.userBrief,
        confirmed: true
      };
      const response = await v2Api("/api/reel-script?action=generate", { method: "POST", body: JSON.stringify(payload) });
      const data = await response.json();
      if (!response.ok) throw new Error(`${data.code ? `${data.code}: ` : ""}${data.error || "Senaryo üretilemedi"}`);
      state.reelScript = {
        ...data.reelScript,
        modelTier: resolved.custom ? data.reelScript.modelTier : resolved.tier
      };
      state.approvedScenes = {};
      state.generatedSceneVideos = {};
      state.sceneReferenceImages = {};
      Object.keys(pendingSceneConfirm).forEach(resetSceneConfirm);
      state.currentStep = 4;
      autofillAudio(state.reelScript);
      renderScript();
      message.textContent = "Senaryo hazır. Sahneleri düzenleyip tek tek veya topluca doğrulayın.";
    } catch (error) {
      message.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  }

  async function initialize() {
    if (initialized) return;
    initialized = true;
    renderSteps();
    try { await Promise.all([loadOptions(), loadProductCatalog()]); } catch (error) { byId("reels-v2-generate-message").textContent = error.message; }
  }

  byId("reels-v2-product-search").addEventListener("input", refreshProductSelect);
  byId("reels-v2-product").addEventListener("change", selectProduct);
  ["reels-v2-provider", "reels-v2-tier", "reels-v2-objective", "reels-v2-duration", "reels-v2-aspect", "reels-v2-custom-toggle", "reels-v2-custom-model"].forEach((id) => byId(id).addEventListener("change", () => settingChanged(true)));
  byId("reels-v2-brief").addEventListener("input", () => settingChanged(true));
  byId("reels-v2-generate").addEventListener("click", generateScript);
  byId("reels-v2-validate").addEventListener("click", () => validateEdits().catch((error) => { byId("reels-v2-approval-message").textContent = error.message; }));
  byId("reels-v2-approve-all").addEventListener("click", () => validateEdits({ approveAll: true }).catch((error) => { byId("reels-v2-approval-message").textContent = error.message; }));
  byId("reels-v2-scenes").addEventListener("input", (event) => {
    const card = event.target.closest(".reels-v2-scene");
    if (!card || !event.target.matches("[data-scene-field]")) return;
    state.reelScript = collectSceneEdits();
    state.approvedScenes[card.dataset.sceneId] = false;
    card.classList.remove("approved");
    card.querySelector(".reels-v2-scene-head span").textContent = "Düzenlendi · yeniden onay gerekli";
    renderSteps();
    renderVideoScenes();
  });
  byId("reels-v2-scenes").addEventListener("click", (event) => {
    const button = event.target.closest("[data-approve-scene]");
    if (!button) return;
    const sceneId = button.dataset.approveScene;
    if (state.approvedScenes[sceneId]) { state.approvedScenes[sceneId] = false; renderScript(); return; }
    button.disabled = true;
    validateEdits({ approveSceneId: sceneId }).catch((error) => { byId("reels-v2-approval-message").textContent = error.message; }).finally(() => { button.disabled = false; });
  });
  // Adım 5 (Video Üretimi) — referans görsel seçimi ve sahne bazlı Veo üretimi.
  byId("reels-v2-video-tier").addEventListener("change", () => {
    state.videoSettings.modelTier = byId("reels-v2-video-tier").value;
    Object.keys(pendingSceneConfirm).forEach(resetSceneConfirm);
    renderVideoScenes();
  });
  byId("reels-v2-video-resolution").addEventListener("change", () => {
    state.videoSettings.resolution = byId("reels-v2-video-resolution").value;
    Object.keys(pendingSceneConfirm).forEach(resetSceneConfirm);
    renderVideoScenes();
  });
  byId("reels-v2-video-scenes").addEventListener("click", (event) => {
    const thumbButton = event.target.closest("[data-video-ref-thumb]");
    if (thumbButton) {
      const sceneId = thumbButton.dataset.sceneId;
      state.sceneReferenceImages[sceneId] = thumbButton.dataset.url;
      resetSceneConfirm(sceneId);
      renderVideoScenes();
      return;
    }
    const generateButton = event.target.closest("[data-generate-scene-video]");
    if (!generateButton) return;
    generateSceneVideo(generateButton.dataset.sceneId);
  });
  document.querySelectorAll('.brand-rail [data-tab="reels"]').forEach((button) => button.addEventListener("click", initialize));
  const workspace = byId("workspace");
  new MutationObserver(() => { if (!workspace.classList.contains("hidden")) initialize(); }).observe(workspace, { attributes: true, attributeFilter: ["class"] });
  if (!workspace.classList.contains("hidden")) initialize();
})();
