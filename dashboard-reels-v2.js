/* AI REELS V2 — PR-D (Product -> Script -> Scene Approval) + PR-E (Step 5: sahne bazlı Veo video üretimi) + PR-F/G (Step 6: Türkçe seslendirme + Lyria müzik, Step 7: sahne concat + ses mix -> Final Reel). Tüm 7 adım aktif. */
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
    narration: { text: "", gender: "auto", status: "idle", job: null, audioUrl: null, error: null, pending: false },
    music: { prompt: "", tier: "clip", status: "idle", job: null, musicUrl: null, error: null, pending: false },
    finalVideo: { status: "idle", jobId: null, videoUrl: null, createdAt: null, error: null, stale: false, pending: false }
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
  let scriptGenerating = false;
  let selectedProductId = "";
  let productCatalog = [];
  // Step 5 (PR-E): sahne bazlı Veo onayı — dashboard.html'deki mevcut
  // #generate-reel danger-button ile AYNI iki-adımlı desen, ama sahne
  // başına AYRI bir anahtar (confirmKey referans görseli + tier/resolution'ı
  // da içerir — herhangi biri değişirse onay iptal olur).
  const pendingSceneConfirm = {};
  const pendingSceneConfirmTimers = {};
  // Step 6 (PR-F/G): Türkçe seslendirme (TTS) ve Lyria müziği — AYNI
  // iki-adımlı "tekrar bas" onay deseni, ama sahne değil TEK bir narration/
  // music kaynağı için (dashboard.html'deki mevcut #reel-audio-tts-generate/
  // #reel-audio-lyria-generate butonlarındaki AYNI ilke — o panele DOKUNULMAZ,
  // burada sihirbaz-yerel, izole bir kopyası kullanılır).
  let pendingNarrationConfirm = null;
  let pendingNarrationConfirmTimer = null;
  let pendingMusicConfirm = null;
  let pendingMusicConfirmTimer = null;

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

  function hasAnyAudioReady() {
    return Boolean((state.narration.status === "completed" && state.narration.audioUrl) || (state.music.status === "completed" && state.music.musicUrl));
  }

  function renderSteps() {
    const labels = ["Ürün", "Kreatif Ayarlar", "AI Senaryo", "Sahne Onayı", "Video Üretimi", "Ses & Müzik", "Final Reel"];
    byId("reels-v2-steps").innerHTML = labels.map((label, index) => {
      const step = index + 1;
      // PR-F/G: Adım 6 (Ses & Müzik) ve Adım 7 (Final Reel) bu PR'da AKTİF
      // hale geldi — artık pasif bir adım kalmadı.
      const complete = step < state.currentStep
        || (step === 4 && allScenesApproved())
        || (step === 5 && allScenesVideoCompleted())
        || (step === 6 && hasAnyAudioReady())
        || (step === 7 && state.finalVideo.status === "completed" && state.finalVideo.videoUrl && !state.finalVideo.stale);
      const className = `reels-v2-step${complete ? " complete" : step === state.currentStep ? " active" : ""}`;
      return `<button type="button" class="${className}" data-v2-step="${step}">${step}. ${escapeHtml(label)}</button>`;
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
    resetAudioAndFinalState();
    state.currentStep = state.productContext ? 2 : 1;
    byId("reels-v2-script-summary").classList.add("hidden");
    byId("reels-v2-script-summary").innerHTML = "";
    byId("reels-v2-scenes").innerHTML = '<p class="hint">Önce AI senaryo üretin.</p>';
    byId("reels-v2-validate").disabled = true;
    byId("reels-v2-approve-all").disabled = true;
    byId("reels-v2-approval-message").textContent = "";
    byId("reels-v2-video-scenes").innerHTML = '<p class="hint">Önce Adım 4\'te sahneleri onaylayın.</p>';
    byId("reels-v2-video-message").textContent = "";
    renderAudioStage();
    renderFinalStage();
    renderSteps();
  }

  // Step 6/7 (PR-F/G): yeni bir senaryo üretildiğinde veya senaryo tamamen
  // sıfırlandığında (ürün değişikliği vb.) eski narration/music/finalVideo
  // sonuçları da geçersiz olur — Step 5'in generatedSceneVideos/sceneReferenceImages
  // sıfırlamasıyla AYNI ilke. Bekleyen (onaylanmamış) TTS/Lyria onayları da temizlenir.
  function resetAudioAndFinalState() {
    state.narration = { text: "", gender: "auto", status: "idle", job: null, audioUrl: null, error: null, pending: false };
    state.music = { prompt: "", tier: "clip", status: "idle", job: null, musicUrl: null, error: null, pending: false };
    state.finalVideo = { status: "idle", jobId: null, videoUrl: null, createdAt: null, error: null, stale: false, pending: false };
    resetNarrationConfirm();
    resetMusicConfirm();
  }

  // Adım 6'nın varsayılan metinleri — YALNIZCA yeni bir senaryo üretildiğinde
  // set edilir (bkz. çağrı yeri: generateScript). validateEdits/scene
  // düzenlemelerinde TEKRAR ÇAĞRILMAZ — aksi halde kullanıcının narration/
  // music metnindeki elle yaptığı değişiklikler her sahne onayında silinirdi.
  function initAudioDefaults(script) {
    state.narration.text = script.fullNarrationText || "";
    state.music.prompt = script.musicBrief?.lyriaPrompt || "";
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
    renderTierOptions();
    renderCustomModels();
    renderResolution();
  }

  function availableModels(provider) {
    return options.models.filter((model) => model.available && (provider === "auto" || model.provider === provider));
  }

  function tierIsAvailable(provider, tier) {
    const providers = provider === "auto" ? options.providers.filter((value) => value !== "auto") : [provider];
    return providers.some((value) => availableModels(value).some((model) => model.tierCandidate === tier));
  }

  function renderTierOptions() {
    const select = byId("reels-v2-tier");
    const provider = byId("reels-v2-provider").value;
    const selected = state.creativeSettings.modelTier;
    select.innerHTML = options.tiers.map((tier) => {
      const available = tierIsAvailable(provider, tier);
      const label = `${tierLabels[tier] || tier}${available ? "" : " — Kullanılabilir model yok"}`;
      return `<option value="${escapeHtml(tier)}"${available ? "" : " disabled"}>${escapeHtml(label)}</option>`;
    }).join("");
    select.value = selected;
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
    byId("reels-v2-generate").disabled = scriptGenerating || !resolved;
  }

  async function loadOptions() {
    const response = await v2Api("/api/reel-script?action=options");
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "AI Reels seçenekleri yüklenemedi.");
    Object.assign(options, data);
    fillSelect(byId("reels-v2-provider"), options.providers, (value) => providerLabels[value] || value);
    renderTierOptions();
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

  function renderProductContext(context) {
    const wrap = byId("reels-v2-product-context");
    const images = (context.productImageUrls || []).map((url) => safeUrl(url) ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener"><img src="${escapeHtml(url)}" alt="${escapeHtml(context.productName)}"></a>` : "").join("");
    const facts = (context.verifiedFacts || []).map((fact) => `<li>${escapeHtml(fact.fact || fact)}</li>`).join("");
    const features = (context.technicalFeatures || []).map((fact) => `<li>${escapeHtml(fact.fact || fact)}</li>`).join("");
    const sellingPoints = (context.sellingPoints || []).map((fact) => `<li>${escapeHtml(fact.fact || fact)}</li>`).join("");
    const useCases = (context.useCases || []).map((fact) => `<li>${escapeHtml(fact.fact || fact)}</li>`).join("");
    const canonicalUrl = safeUrl(context.canonicalUrl);
    wrap.innerHTML = `<div class="reels-v2-context"><div><h4>${escapeHtml(context.productName)}</h4>${context.description ? `<p>${escapeHtml(context.description)}</p>` : ""}<strong>Doğrulanmış bilgiler</strong><ul class="reels-v2-facts">${facts || "<li>Doğrulanmış bilgi bulunamadı.</li>"}</ul>${features ? `<strong>Teknik özellikler</strong><ul class="reels-v2-facts">${features}</ul>` : ""}${sellingPoints ? `<strong>Satış noktaları</strong><ul class="reels-v2-facts">${sellingPoints}</ul>` : ""}${useCases ? `<strong>Kullanım alanları</strong><ul class="reels-v2-facts">${useCases}</ul>` : ""}${canonicalUrl ? `<p><a href="${escapeHtml(canonicalUrl)}" target="_blank" rel="noopener">Ürün sayfasını aç ↗</a></p>` : ""}</div><div><div class="reels-v2-images">${images || "Görsel bulunamadı."}</div></div></div>`;
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
    renderAudioStage();
    renderFinalStage();
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
  // (bkz. test/dashboard-reels-v2.test.js) kendi kopyası. Adı "veo" olsa da
  // code/alternatives şekli TtsApiError/LyriaApiError ile de uyumlu olduğundan
  // Step 6/7 (PR-F/G) hata mesajları için de reuse edilir — genel bir
  // "provider hata mesajı" yardımcısıdır.
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
      renderFinalStage();
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
    // §13 (PR-F/G): bu sahne zaten bir Final Reel'e dahil edilmişse (yeniden
    // üretim), mevcut final video artık GÜNCELLİĞİNİ KAYBETMİŞTİR — otomatik
    // silinmez, yalnızca "stale" işaretlenir; kullanıcı yeniden compose etmeyi
    // kendi seçmelidir.
    markFinalStale();
    renderVideoScenes();
    renderFinalStage();
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

  // AI Reels V2 PR-F/G — Step 6 (Ses & Müzik). YENİ bir TTS/Lyria client
  // YAZILMAZ; burada yalnızca PR-D'nin ürettiği reelScript.fullNarrationText /
  // musicBrief.lyriaPrompt varsayılan olarak kullanılır ve MEVCUT
  // /api/turkish-tts, /api/lyria-music uçları (aynen dashboard.html'deki
  // #reel-audio panelinin kullandığı uçlar) çağrılır. O panele HİÇ dokunulmaz
  // — burası sihirbaz-yerel, izole bir kopyadır (kendi state.narration/
  // state.music'ini tutar, ayrı DOM id'leri kullanır).

  function resetNarrationConfirm() {
    pendingNarrationConfirm = null;
    clearTimeout(pendingNarrationConfirmTimer);
    pendingNarrationConfirmTimer = null;
  }

  function resetMusicConfirm() {
    pendingMusicConfirm = null;
    clearTimeout(pendingMusicConfirmTimer);
    pendingMusicConfirmTimer = null;
  }

  function narrationUiStatus() {
    if (state.narration.pending) return "generating";
    if (state.narration.status === "completed" && state.narration.audioUrl) return "completed";
    if (state.narration.status === "failed") return "failed";
    return pendingNarrationConfirm ? "awaiting_confirmation" : "idle";
  }

  function musicUiStatus() {
    if (state.music.pending) return "generating";
    if (state.music.status === "completed" && state.music.musicUrl) return "completed";
    if (state.music.status === "failed") return "failed";
    return pendingMusicConfirm ? "awaiting_confirmation" : "idle";
  }

  function renderAudioStage() {
    const narrationField = byId("reels-v2-narration-text");
    const musicField = byId("reels-v2-music-prompt");
    // Kullanıcı yazarken imleç/odak kaybolmasın diye textarea'lar yalnızca
    // state ile GERÇEKTEN farklıysa güncellenir (bkz. Step 4'teki scene-field
    // input handler'ının AYNI ilkesi — orada da renderScript() re-render'ı
    // her tuş vuruşunda değil, yalnız gerekli anlarda çağrılıyor).
    if (narrationField.value !== state.narration.text) narrationField.value = state.narration.text;
    if (musicField.value !== state.music.prompt) musicField.value = state.music.prompt;
    byId("reels-v2-voice-gender").value = state.narration.gender;
    byId("reels-v2-lyria-tier").value = state.music.tier;

    const narrationStatus = narrationUiStatus();
    const narrationLabels = { idle: "Üretilmedi", awaiting_confirmation: "Onay bekliyor — tekrar bas", generating: "Üretiliyor (TTS)...", completed: "Tamamlandı", failed: "Başarısız" };
    byId("reels-v2-tts-status").textContent = narrationLabels[narrationStatus];
    byId("reels-v2-tts-generate").disabled = narrationStatus === "generating" || !state.narration.text.trim();
    byId("reels-v2-tts-generate").textContent = state.narration.audioUrl ? "Seslendirmeyi yeniden üret (ücretli)" : "Türkçe sesi üret (ücretli)";
    const ttsPlayer = byId("reels-v2-tts-player");
    if (state.narration.audioUrl) { ttsPlayer.src = state.narration.audioUrl; ttsPlayer.classList.remove("hidden"); } else { ttsPlayer.classList.add("hidden"); ttsPlayer.removeAttribute("src"); }
    byId("reels-v2-tts-message").textContent = state.narration.error || "";

    const musicStatus = musicUiStatus();
    const musicLabels = { idle: "Üretilmedi", awaiting_confirmation: "Onay bekliyor — tekrar bas", generating: "Üretiliyor (Lyria)...", completed: "Tamamlandı", failed: "Başarısız" };
    byId("reels-v2-lyria-status").textContent = musicLabels[musicStatus];
    byId("reels-v2-lyria-generate").disabled = musicStatus === "generating" || !state.music.prompt.trim();
    byId("reels-v2-lyria-generate").textContent = state.music.musicUrl ? "Müziği yeniden üret (ücretli)" : "Senaryoya göre müzik üret (ücretli)";
    const lyriaPlayer = byId("reels-v2-lyria-player");
    if (state.music.musicUrl) { lyriaPlayer.src = state.music.musicUrl; lyriaPlayer.classList.remove("hidden"); } else { lyriaPlayer.classList.add("hidden"); lyriaPlayer.removeAttribute("src"); }
    byId("reels-v2-lyria-message").textContent = state.music.error || "";
  }

  async function pollNarrationVoiceover() {
    if (!state.narration.pending || !state.narration.job) return;
    try {
      const response = await v2Api("/api/turkish-tts", { method: "POST", body: JSON.stringify({ action: "status", job: state.narration.job }) });
      const data = await response.json();
      if (!response.ok) throw new Error(veoErrorMessage(data, "Türkçe seslendirme durumu okunamadı"));
      const tts = data.tts;
      // Polling ASLA yeni bir TTS işi başlatmaz — yalnızca aynı interactionId'nin
      // durumunu okur (bkz. src/turkish-tts.js:turkishVoiceoverStatus).
      if (tts.status !== "COMPLETED") { setTimeout(pollNarrationVoiceover, 5000); return; }
      state.narration = { ...state.narration, status: "completed", audioUrl: tts.audioUrl || state.narration.audioUrl, pending: false, error: tts.audioUrl ? null : (tts.downloadNote || "Ses hazır ama kalıcı bağlantı alınamadı.") };
      renderAudioStage();
      renderSteps();
    } catch (error) {
      // §14: TTS başarısız olursa otomatik başka bir provider'a/tekrar denemeye
      // GEÇİLMEZ — önceki (varsa) tamamlanmış ses korunur, yalnız hata gösterilir.
      state.narration = { ...state.narration, pending: false, status: state.narration.audioUrl ? "completed" : "failed", error: error.message };
      renderAudioStage();
    }
  }

  async function generateNarrationVoiceover() {
    const scriptDuration = Number(state.reelScript?.durationSeconds) || undefined;
    state.narration.gender = byId("reels-v2-voice-gender").value;
    const confirmKey = `${state.narration.text}:${state.narration.gender}`;
    // §14: İLK TIKLAMA ücretli çağrı YAPMAZ — yalnız onay bekler.
    if (pendingNarrationConfirm !== confirmKey) {
      pendingNarrationConfirm = confirmKey;
      clearTimeout(pendingNarrationConfirmTimer);
      pendingNarrationConfirmTimer = setTimeout(() => { resetNarrationConfirm(); renderAudioStage(); }, 8000);
      renderAudioStage();
      byId("reels-v2-tts-message").textContent = "Google Gemini TTS ile gerçek bir Türkçe ses oluşturulacak ve Google kredinizden düşülecek. Onaylamak için butona 8 saniye içinde tekrar bas.";
      return;
    }
    resetNarrationConfirm();
    const previous = state.narration;
    state.narration = { ...previous, pending: true, error: null };
    markFinalStale();
    renderAudioStage();
    renderFinalStage();
    try {
      const response = await v2Api("/api/turkish-tts", {
        method: "POST",
        body: JSON.stringify({ text: state.narration.text, gender: state.narration.gender, targetDurationSeconds: scriptDuration, confirmed: true })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(veoErrorMessage(data, "Türkçe seslendirme başlatılamadı"));
      const tts = data.tts;
      if (tts.status === "COMPLETED") {
        state.narration = { ...previous, status: "completed", audioUrl: tts.audioUrl || previous.audioUrl, job: null, pending: false, error: tts.audioUrl ? null : (tts.downloadNote || "Ses hazır ama kalıcı bağlantı alınamadı.") };
        renderAudioStage();
        renderSteps();
        return;
      }
      state.narration = { ...previous, status: "generating", job: { interactionId: tts.interactionId, model: tts.model }, pending: true, audioUrl: previous.audioUrl, error: null };
      renderAudioStage();
      pollNarrationVoiceover();
    } catch (error) {
      state.narration = { ...previous, pending: false, status: previous.audioUrl ? "completed" : "failed", error: error.message };
      renderAudioStage();
    }
  }

  async function pollMusic() {
    if (!state.music.pending || !state.music.job) return;
    try {
      const response = await v2Api("/api/lyria-music", { method: "POST", body: JSON.stringify({ action: "status", job: state.music.job }) });
      const data = await response.json();
      if (!response.ok) throw new Error(veoErrorMessage(data, "Lyria müzik durumu okunamadı"));
      const lyria = data.lyria;
      if (lyria.status !== "COMPLETED") { setTimeout(pollMusic, 5000); return; }
      state.music = { ...state.music, status: "completed", musicUrl: lyria.musicUrl || state.music.musicUrl, pending: false, error: lyria.musicUrl ? null : (lyria.downloadNote || "Müzik hazır ama kalıcı bağlantı alınamadı.") };
      renderAudioStage();
      renderSteps();
    } catch (error) {
      state.music = { ...state.music, pending: false, status: state.music.musicUrl ? "completed" : "failed", error: error.message };
      renderAudioStage();
    }
  }

  async function generateMusic() {
    state.music.tier = byId("reels-v2-lyria-tier").value;
    const scriptDuration = Number(state.reelScript?.durationSeconds) || undefined;
    const confirmKey = `${state.music.prompt}:${state.music.tier}`;
    if (pendingMusicConfirm !== confirmKey) {
      pendingMusicConfirm = confirmKey;
      clearTimeout(pendingMusicConfirmTimer);
      pendingMusicConfirmTimer = setTimeout(() => { resetMusicConfirm(); renderAudioStage(); }, 8000);
      renderAudioStage();
      byId("reels-v2-lyria-message").textContent = "Google Lyria ile gerçek bir müzik oluşturulacak ve Google kredinizden düşülecek. Onaylamak için butona 8 saniye içinde tekrar bas.";
      return;
    }
    resetMusicConfirm();
    const previous = state.music;
    state.music = { ...previous, pending: true, error: null };
    markFinalStale();
    renderAudioStage();
    renderFinalStage();
    try {
      const response = await v2Api("/api/lyria-music", {
        method: "POST",
        body: JSON.stringify({ musicPrompt: state.music.prompt, durationSeconds: scriptDuration, tier: state.music.tier, confirmed: true })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(veoErrorMessage(data, "Lyria müzik başlatılamadı"));
      const lyria = data.lyria;
      if (lyria.status === "COMPLETED") {
        state.music = { ...previous, status: "completed", musicUrl: lyria.musicUrl || previous.musicUrl, job: null, pending: false, error: lyria.musicUrl ? null : (lyria.downloadNote || "Müzik hazır ama kalıcı bağlantı alınamadı.") };
        renderAudioStage();
        renderSteps();
        return;
      }
      state.music = { ...previous, status: "generating", job: { interactionId: lyria.interactionId, model: lyria.model }, pending: true, musicUrl: previous.musicUrl, error: null };
      renderAudioStage();
      pollMusic();
    } catch (error) {
      state.music = { ...previous, pending: false, status: previous.musicUrl ? "completed" : "failed", error: error.message };
      renderAudioStage();
    }
  }

  // AI Reels V2 PR-F/G — Step 7 (Final Reel). YENİ bir medya motoru YAZILMAZ.
  // src/reel-audio-compose.js (compose_reel_audio) yalnız TEK bir mevcut
  // videoya ses mix'i yapıyor, sahne birleştirme (concat) YAPMIYOR — bu
  // yüzden en küçük ek olarak /api/reel-final (src/reel-final-assembly.js)
  // eklendi: sahne videolarını sırayla birleştirip AYNI, DEĞİŞTİRİLMEMİŞ
  // ses-mix FFmpeg katmanını (buildReelAudioFfmpegArgs) reuse ediyor. Bu
  // fonksiyon Veo/TTS/Lyria'yı OTOMATİK TETİKLEMEZ — yalnızca zaten
  // tamamlanmış generatedSceneVideos/narration/music sonuçlarını kullanır.
  function markFinalStale() {
    if (state.finalVideo.videoUrl) state.finalVideo.stale = true;
  }

  function finalReadiness() {
    const scenesReady = allScenesVideoCompleted();
    const audioReady = hasAnyAudioReady();
    return { scenesReady, audioReady, ready: scenesReady && audioReady };
  }

  function renderFinalStage() {
    const readiness = finalReadiness();
    const button = byId("reels-v2-final-generate");
    button.disabled = !readiness.ready || state.finalVideo.pending;
    button.textContent = state.finalVideo.videoUrl ? "Final Reel'i yeniden oluştur" : "Final Reel'i oluştur";
    const statusLabels = { idle: "Üretilmedi", generating: "Oluşturuluyor...", completed: "Tamamlandı", failed: "Başarısız" };
    const effectiveStatus = state.finalVideo.pending ? "generating" : state.finalVideo.status;
    byId("reels-v2-final-status").textContent = state.finalVideo.stale
      ? `${statusLabels[effectiveStatus] || statusLabels.idle} (güncelliğini kaybetti — sahne/ses değişti, yeniden oluştur)`
      : (statusLabels[effectiveStatus] || statusLabels.idle);
    const reasons = [];
    if (!readiness.scenesReady) reasons.push("tüm sahnelerin videosu tamamlanmalı (Adım 5)");
    if (!readiness.audioReady) reasons.push("en az bir ses kaynağı (Türkçe seslendirme veya müzik) hazır olmalı (Adım 6)");
    byId("reels-v2-final-message").textContent = state.finalVideo.error || (reasons.length && !readiness.ready ? `Final Reel için gerekli: ${reasons.join(", ")}.` : "");
    const video = byId("reels-v2-final-video");
    if (state.finalVideo.videoUrl) { video.src = state.finalVideo.videoUrl; video.classList.remove("hidden"); } else { video.classList.add("hidden"); video.removeAttribute("src"); }
  }

  async function pollFinalReel() {
    if (!state.finalVideo.pending || !state.finalVideo.jobId) return;
    try {
      const response = await v2Api(`/api/reel-final?jobId=${encodeURIComponent(state.finalVideo.jobId)}`);
      const data = await response.json();
      if (!response.ok) throw new Error(veoErrorMessage(data, "Final Reel durumu okunamadı"));
      // Polling ASLA yeni bir compose işi başlatmaz — yalnızca aynı jobId'nin
      // durumunu okur (bkz. src/reel-audio-compose.js:getReelAudioStatus, reuse edildi).
      if (data.status === "queued" || data.status === "rendering") { setTimeout(pollFinalReel, 5000); return; }
      if (data.status === "completed" && data.videoUrl) {
        state.finalVideo = { status: "completed", jobId: state.finalVideo.jobId, videoUrl: data.videoUrl, createdAt: state.finalVideo.createdAt, pending: false, error: null, stale: false };
        renderFinalStage();
        renderSteps();
        return;
      }
      throw new Error(data.error || "Final Reel oluşturma başarısız.");
    } catch (error) {
      // §14: compose başarısız olursa otomatik yeni bir generation (Veo/TTS/
      // Lyria/tekrar compose) TETİKLENMEZ — eski (varsa) tamamlanmış final
      // video korunur, yalnız hata gösterilir.
      state.finalVideo = { ...state.finalVideo, pending: false, status: state.finalVideo.videoUrl ? "completed" : "failed", error: error.message };
      renderFinalStage();
    }
  }

  async function composeFinalReel() {
    const readiness = finalReadiness();
    if (!readiness.ready) { renderFinalStage(); return; }
    const sceneVideoUrls = state.reelScript.scenes.map((scene) => state.generatedSceneVideos[scene.sceneId].videoUrl);
    const previous = state.finalVideo;
    // §14: FFmpeg mix/concat ÜCRETSİZDİR (compose_reel_audio ile AYNI kural)
    // — bir ücretli onay bayrağı GEREKMEZ.
    state.finalVideo = { ...previous, pending: true, error: null };
    renderFinalStage();
    try {
      const response = await v2Api("/api/reel-final", {
        method: "POST",
        body: JSON.stringify({
          sceneVideoUrls,
          voiceoverUrl: state.narration.status === "completed" ? state.narration.audioUrl : undefined,
          musicUrl: state.music.status === "completed" ? state.music.musicUrl : undefined
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(veoErrorMessage(data, "Final Reel oluşturulamadı"));
      state.finalVideo = { status: "generating", jobId: data.jobId, videoUrl: previous.videoUrl, createdAt: new Date().toISOString(), pending: true, error: null, stale: false };
      renderFinalStage();
      pollFinalReel();
    } catch (error) {
      // §13: eski (varsa tamamlanmış) final video, yeni compose BAŞARILI
      // olana kadar ASLA silinmez.
      state.finalVideo = { ...previous, pending: false, status: previous.videoUrl ? "completed" : "failed", error: error.message };
      renderFinalStage();
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
    scriptGenerating = true;
    renderResolution();
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
      resetAudioAndFinalState();
      initAudioDefaults(state.reelScript);
      state.currentStep = 4;
      autofillAudio(state.reelScript);
      renderScript();
      renderAudioStage();
      renderFinalStage();
      message.textContent = "Senaryo hazır. Sahneleri düzenleyip tek tek veya topluca doğrulayın.";
    } catch (error) {
      message.textContent = error.message;
    } finally {
      scriptGenerating = false;
      renderResolution();
    }
  }

  async function initialize() {
    if (initialized) return;
    initialized = true;
    renderSteps();
    renderAudioStage();
    renderFinalStage();
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
  // Adım 6 (Ses & Müzik) — narration/music metni kullanıcı tarafından
  // düzenlenebilir; düzenleme bekleyen onayı iptal eder (metin değiştiyse
  // confirmKey de değişir, ama görünür geri bildirim için açıkça de sıfırlanır).
  byId("reels-v2-narration-text").addEventListener("input", (event) => {
    state.narration.text = event.target.value;
    resetNarrationConfirm();
    byId("reels-v2-tts-generate").disabled = !state.narration.text.trim();
  });
  byId("reels-v2-music-prompt").addEventListener("input", (event) => {
    state.music.prompt = event.target.value;
    resetMusicConfirm();
    byId("reels-v2-lyria-generate").disabled = !state.music.prompt.trim();
  });
  byId("reels-v2-voice-gender").addEventListener("change", () => { resetNarrationConfirm(); renderAudioStage(); });
  byId("reels-v2-lyria-tier").addEventListener("change", () => { resetMusicConfirm(); renderAudioStage(); });
  byId("reels-v2-tts-generate").addEventListener("click", generateNarrationVoiceover);
  byId("reels-v2-lyria-generate").addEventListener("click", generateMusic);
  // Adım 7 (Final Reel).
  byId("reels-v2-final-generate").addEventListener("click", composeFinalReel);
  document.querySelectorAll('.brand-rail [data-tab="reels"]').forEach((button) => button.addEventListener("click", initialize));
  const workspace = byId("workspace");
  new MutationObserver(() => { if (!workspace.classList.contains("hidden")) initialize(); }).observe(workspace, { attributes: true, attributeFilter: ["class"] });
  if (!workspace.classList.contains("hidden")) initialize();
})();
