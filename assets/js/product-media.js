/**
 * AIFRET - Product Media & 10-Second Video Generation Module
 * 
 * Flow:
 * 1. Product Selection: Preserves existing selection; isolates media per product ID.
 * 2. Upload Product Photos: JPG, JPEG, PNG, WEBP; multiple photos; thumbnail previews with delete; size validation.
 * 3. Generate Product Video: Prominent button; validation; non-blocking 10s generation progress.
 * 4. Product Video Preview: HTML5 player (play/pause, volume, fullscreen, replay, responsive, no autoplay with sound).
 * 5. Actions: Regenerate Video, Remove Video.
 * 6. Product Switching: Loads existing media per product, never mixing photos or videos.
 * 7. Architecture: Uses existing API endpoint if configured in window.AIFRET_CONFIG.ai.video.endpoint;
 *    otherwise uses client-side 10-second HTML5 Canvas + MediaRecorder engine.
 */

(function () {
  'use strict';

  // Constants & Limits
  const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
  const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
  const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];
  const VIDEO_DURATION_SECONDS = 10; // Exactly 10 seconds duration
  const DB_NAME = 'aifret_product_media_db';
  const DB_VERSION = 1;
  const STORE_NAME = 'product_media';

  // Active state
  let currentProduct = null;
  let activePendingPhotos = []; // [{ id, name, size, type, dataUrl, objectUrl }]
  let activeGeneratedVideoBlob = null;
  let activeGeneratedVideoUrl = null;
  let isGenerating = false;
  let activeDbPromise = null;

  // ---------------------------------------------------------------------------
  // IndexedDB Storage Engine (Safe, isolated, handles multi-MB media)
  // ---------------------------------------------------------------------------

  function getDB() {
    if (!activeDbPromise) {
      activeDbPromise = new Promise((resolve, reject) => {
        if (!window.indexedDB) {
          console.warn('[AIFRET Media] IndexedDB not supported; using in-memory storage');
          resolve(null);
          return;
        }
        const request = window.indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = (e) => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            db.createObjectStore(STORE_NAME, { keyPath: 'productId' });
          }
        };
        request.onsuccess = (e) => resolve(e.target.result);
        request.onerror = (e) => {
          console.warn('[AIFRET Media] IndexedDB error:', e.target.error);
          resolve(null);
        };
      });
    }
    return activeDbPromise;
  }

  async function loadMediaRecord(productId) {
    if (!productId) return null;
    try {
      const db = await getDB();
      if (!db) {
        const mem = localStorage.getItem(`aifret_media_${productId}`);
        return mem ? JSON.parse(mem) : null;
      }
      return new Promise((resolve) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.get(productId);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      });
    } catch (err) {
      console.warn('[AIFRET Media] Error reading media store:', err);
      return null;
    }
  }

  async function saveMediaRecord(record) {
    if (!record || !record.productId) return;
    try {
      const db = await getDB();
      if (!db) {
        try {
          localStorage.setItem(`aifret_media_${record.productId}`, JSON.stringify(record));
        } catch (_) {}
        return;
      }
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const req = store.put(record);
        req.onsuccess = () => resolve();
        req.onerror = (e) => reject(e.target.error);
      });
    } catch (err) {
      console.warn('[AIFRET Media] Error saving media record:', err);
    }
  }

  async function deleteVideoRecord(productId) {
    const existing = await loadMediaRecord(productId);
    if (existing) {
      existing.videoBlob = null;
      existing.videoUrl = null;
      existing.updatedAt = new Date().toISOString();
      await saveMediaRecord(existing);
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function formatFileSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function sanitizeFilename(name) {
    return name.replace(/[^a-zA-Z0-9._-]/g, '_');
  }

  function getBestMimeType() {
    if (typeof MediaRecorder === 'undefined') return '';
    const candidates = [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm',
      'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
      'video/mp4'
    ];
    for (const t of candidates) {
      if (MediaRecorder.isTypeSupported(t)) return t;
    }
    return '';
  }

  function revokeAllPendingUrls() {
    activePendingPhotos.forEach((p) => {
      if (p.objectUrl) {
        try { URL.revokeObjectURL(p.objectUrl); } catch (_) {}
      }
    });
    if (activeGeneratedVideoUrl && activeGeneratedVideoUrl.startsWith('blob:')) {
      try { URL.revokeObjectURL(activeGeneratedVideoUrl); } catch (_) {}
    }
  }

  // ---------------------------------------------------------------------------
  // UI Rendering & Mounting
  // ---------------------------------------------------------------------------

  function renderMediaSectionMarkup(container, product) {
    container.innerHTML = `
      <section class="product-media-card" id="product-media-section" aria-label="Product Media Studio">
        <div class="product-media-header">
          <div class="product-media-title-wrap">
            <span class="section-kicker">Interactive Studio</span>
            <h2 class="product-media-title">Product Media</h2>
          </div>
          <div class="product-media-badge-wrap">
            <span class="product-media-pill">10-Second Video Showcase</span>
            <span class="product-media-product-id" title="Linked Product ID">SKU: <strong>${product.id}</strong></span>
          </div>
        </div>

        <!-- 1. Upload Product Photos -->
        <div class="product-media-subblock" data-upload-block>
          <div class="product-media-subhead">
            <h3>Upload Product Photos</h3>
            <p class="media-hint">Add product photos to automatically produce a 10-second video showcase. Supports JPG, PNG, WEBP up to 10MB each.</p>
          </div>

          <div class="product-media-dropzone" data-media-dropzone tabindex="0" role="region" aria-label="File upload dropzone">
            <input type="file" id="product-photo-file-input" multiple accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" hidden />
            <div class="dropzone-content">
              <div class="dropzone-icon" aria-hidden="true">📸</div>
              <label for="product-photo-file-input" class="btn btn-secondary media-choose-btn">Choose Product Photos</label>
              <p class="dropzone-drag-text">or drag and drop photos here</p>
              <small class="dropzone-format-info">Supported: JPG, JPEG, PNG, WEBP (Max 10MB per file)</small>
            </div>
          </div>

          <!-- Thumbnail Gallery -->
          <div class="media-thumbnails-grid" data-media-thumbnails aria-live="polite"></div>

          <!-- Validation message alert -->
          <div class="media-validation-alert" data-media-validation hidden role="alert"></div>
        </div>

        <!-- 2. Generate Product Video -->
        <div class="product-media-subblock media-generate-subblock" data-generate-block>
          <div class="product-media-subhead">
            <h3>Generate Product Video</h3>
            <p class="media-hint">Creates a 10-second high-definition animated video showcase featuring your uploaded photos, product details, and store pricing.</p>
          </div>

          <div class="generate-action-row">
            <button type="button" class="btn btn-primary btn-generate-video" data-action="generate-video">
              <span class="generate-btn-icon">▶</span>
              <span class="generate-btn-text">Generate Video (10s)</span>
            </button>
            <span class="generate-duration-tag">⏱ 10 Seconds Duration</span>
          </div>

          <!-- Generation Progress & Status -->
          <div class="media-progress-card" data-media-progress hidden aria-live="assertive">
            <div class="media-progress-info-row">
              <div class="media-progress-spinner" aria-hidden="true"></div>
              <span class="media-progress-text" data-progress-text>Generating Product Video...</span>
              <span class="media-progress-percent" data-progress-percent>0%</span>
            </div>
            <div class="media-progress-bar-track">
              <div class="media-progress-bar-fill" data-progress-bar style="width: 0%;"></div>
            </div>
            <p class="media-progress-subnote">Compiling 10-second animation and product showcase overlay...</p>
          </div>
        </div>

        <!-- 3. Product Video Preview (Shown once generated) -->
        <div class="product-media-subblock media-preview-subblock" data-preview-block hidden>
          <div class="product-media-subhead">
            <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
              <h3>Product Video Preview</h3>
              <span class="video-ready-badge">✓ 10s Ready</span>
            </div>
            <p class="media-hint">Your 10-second product video has been generated. Use the controls below to play, seek, adjust volume, or go fullscreen.</p>
          </div>

          <div class="media-video-player-container">
            <video class="media-video-player" data-video-player controls playsinline preload="metadata">
              Your browser does not support HTML5 video playback.
            </video>
          </div>

          <div class="media-video-actions-bar">
            <button type="button" class="btn btn-secondary" data-action="regenerate-video">
              <span>🔄</span> Regenerate Video
            </button>
            <button type="button" class="btn btn-secondary btn-danger-action" data-action="remove-video">
              <span>🗑️</span> Remove Video
            </button>
            <span class="media-video-timestamp" data-video-timestamp></span>
          </div>
        </div>
      </section>
    `;
  }

  // ---------------------------------------------------------------------------
  // Thumbnail Rendering
  // ---------------------------------------------------------------------------

  function renderThumbnails(root) {
    const thumbsContainer = root.querySelector('[data-media-thumbnails]');
    if (!thumbsContainer) return;

    if (!activePendingPhotos.length) {
      thumbsContainer.innerHTML = '';
      return;
    }

    thumbsContainer.innerHTML = activePendingPhotos.map((photo, index) => `
      <div class="media-thumb-item" data-thumb-id="${photo.id}">
        <div class="media-thumb-img-wrap">
          <img src="${photo.previewUrl}" alt="${photo.name}" />
          <button type="button" class="media-thumb-delete-btn" data-action="remove-photo" data-photo-id="${photo.id}" aria-label="Remove ${photo.name}" title="Remove photo">
            ✕
          </button>
          <span class="media-thumb-order">#${index + 1}</span>
        </div>
        <div class="media-thumb-meta">
          <span class="media-thumb-name" title="${photo.name}">${photo.name}</span>
          <span class="media-thumb-size">${formatFileSize(photo.size)}</span>
        </div>
      </div>
    `).join('');
  }

  function showValidationMessage(root, message) {
    const el = root.querySelector('[data-media-validation]');
    if (!el) return;
    if (!message) {
      el.hidden = true;
      el.textContent = '';
      return;
    }
    el.hidden = false;
    el.textContent = message;
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // ---------------------------------------------------------------------------
  // File Upload Handlers (Client-side validation & staging)
  // ---------------------------------------------------------------------------

  async function handleFilesSelected(root, fileList) {
    showValidationMessage(root, '');
    const files = Array.from(fileList || []);
    if (!files.length) return;

    const errors = [];
    const validFiles = [];

    for (const file of files) {
      // Format validation
      const ext = '.' + file.name.split('.').pop().toLowerCase();
      const isAllowedExt = ALLOWED_EXTENSIONS.includes(ext);
      const isAllowedMime = ALLOWED_MIME_TYPES.includes(file.type);

      if (!isAllowedExt && !isAllowedMime) {
        errors.push(`"${file.name}" is not a supported format. Please use JPG, JPEG, PNG, or WEBP.`);
        continue;
      }

      // Size validation
      if (file.size > MAX_FILE_SIZE_BYTES) {
        errors.push(`"${file.name}" (${formatFileSize(file.size)}) exceeds the maximum allowed file size of 10MB.`);
        continue;
      }

      validFiles.push(file);
    }

    if (errors.length) {
      showValidationMessage(root, errors.join(' '));
    }

    if (!validFiles.length) return;

    for (const file of validFiles) {
      const id = 'photo_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
      const previewUrl = URL.createObjectURL(file);
      
      // Convert to base64 DataURL for persistent storage in IndexedDB
      const dataUrl = await readFileAsDataURL(file);

      activePendingPhotos.push({
        id,
        name: sanitizeFilename(file.name),
        size: file.size,
        type: file.type || 'image/jpeg',
        previewUrl,
        dataUrl,
        file
      });
    }

    renderThumbnails(root);
    persistCurrentState();
  }

  function readFileAsDataURL(file) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => resolve('');
      reader.readAsDataURL(file);
    });
  }

  function removePhoto(root, photoId) {
    const idx = activePendingPhotos.findIndex((p) => p.id === photoId);
    if (idx !== -1) {
      const [removed] = activePendingPhotos.splice(idx, 1);
      if (removed.previewUrl && removed.previewUrl.startsWith('blob:')) {
        try { URL.revokeObjectURL(removed.previewUrl); } catch (_) {}
      }
      renderThumbnails(root);
      persistCurrentState();
    }
  }

  // ---------------------------------------------------------------------------
  // State Persistence per Product
  // ---------------------------------------------------------------------------

  async function persistCurrentState() {
    if (!currentProduct) return;
    const record = {
      productId: currentProduct.id,
      productName: currentProduct.name,
      photos: activePendingPhotos.map((p) => ({
        id: p.id,
        name: p.name,
        size: p.size,
        type: p.type,
        dataUrl: p.dataUrl
      })),
      videoBlob: activeGeneratedVideoBlob,
      videoUrl: activeGeneratedVideoUrl && !activeGeneratedVideoUrl.startsWith('blob:') ? activeGeneratedVideoUrl : null,
      duration: VIDEO_DURATION_SECONDS,
      updatedAt: new Date().toISOString()
    };
    await saveMediaRecord(record);
  }

  // ---------------------------------------------------------------------------
  // 10-Second Video Generation Engine
  // ---------------------------------------------------------------------------

  async function generateVideo(root) {
    if (isGenerating) return;

    // 1. Validation: At least one photo must be uploaded
    if (!activePendingPhotos.length) {
      showValidationMessage(root, 'Please upload at least one product photo before generating a video.');
      return;
    }
    showValidationMessage(root, '');

    isGenerating = true;
    setGenerationUIState(root, true);

    try {
      // 2. Check if an external video API endpoint is configured
      const aiEndpoint = window.AIFRET_CONFIG?.ai?.video?.endpoint;
      if (aiEndpoint) {
        // Architecture integration layer: Send to configured external API
        await generateViaExternalApi(root, aiEndpoint);
      } else {
        // Native High-Definition 10-Second Showcase Video Generator (Canvas + MediaRecorder)
        await generateViaClientCanvasEngine(root);
      }

      // Display video preview
      displayVideoPreview(root);
      await persistCurrentState();
    } catch (err) {
      console.error('[AIFRET Media] Generation failed:', err);
      showValidationMessage(root, `Video generation failed: ${err.message || 'An unexpected error occurred. Please try again.'}`);
    } finally {
      isGenerating = false;
      setGenerationUIState(root, false);
    }
  }

  function setGenerationUIState(root, generating) {
    const btn = root.querySelector('[data-action="generate-video"]');
    const progressCard = root.querySelector('[data-media-progress]');
    const fileInput = root.querySelector('#product-photo-file-input');

    if (btn) btn.disabled = generating;
    if (fileInput) fileInput.disabled = generating;
    if (progressCard) progressCard.hidden = !generating;

    if (!generating) {
      updateProgressBar(root, 0, 'Ready');
    }
  }

  function updateProgressBar(root, percent, text) {
    const bar = root.querySelector('[data-progress-bar]');
    const percentEl = root.querySelector('[data-progress-percent]');
    const textEl = root.querySelector('[data-progress-text]');

    const p = Math.min(100, Math.max(0, Math.round(percent)));
    if (bar) bar.style.width = `${p}%`;
    if (percentEl) percentEl.textContent = `${p}%`;
    if (textEl && text) textEl.textContent = text;
  }

  // Architecture: External API Generator with polling support
  async function generateViaExternalApi(root, endpoint) {
    updateProgressBar(root, 15, 'Sending photos to AI Video Provider...');
    const payload = {
      productId: currentProduct.id,
      productName: currentProduct.name,
      duration: VIDEO_DURATION_SECONDS,
      images: activePendingPhotos.map((p) => p.dataUrl)
    };

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) throw new Error(`Video provider returned status ${res.status}`);
    const data = await res.json();

    if (data.status === 'pending' && data.jobId) {
      // Asynchronous job polling
      let ready = false;
      let attempts = 0;
      while (!ready && attempts < 30) {
        await new Promise((r) => setTimeout(r, 2000));
        attempts++;
        updateProgressBar(root, 20 + attempts * 2.5, `Rendering video in cloud (poll #${attempts})...`);
        const pollRes = await fetch(`${endpoint}?jobId=${encodeURIComponent(data.jobId)}`);
        if (pollRes.ok) {
          const pollData = await pollRes.json();
          if (pollData.status === 'ready' && pollData.videoUrl) {
            activeGeneratedVideoUrl = pollData.videoUrl;
            ready = true;
            break;
          }
        }
      }
      if (!ready) throw new Error('Video generation timed out from provider.');
    } else if (data.videoUrl) {
      activeGeneratedVideoUrl = data.videoUrl;
    } else {
      throw new Error('Provider response did not include a valid video URL.');
    }
  }

  // Client-Side 10-Second Showcase Video Generator (Canvas + MediaRecorder)
  async function generateViaClientCanvasEngine(root) {
    const mimeType = getBestMimeType();
    if (!mimeType) {
      throw new Error('Your browser does not support MediaRecorder video capture.');
    }

    updateProgressBar(root, 10, 'Loading and preparing product photos...');

    // Pre-load all photo Image elements
    const loadedImages = await Promise.all(
      activePendingPhotos.map((photo) => new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error(`Failed to process photo "${photo.name}"`));
        img.src = photo.dataUrl || photo.previewUrl;
      }))
    );

    // Setup Canvas
    const canvas = document.createElement('canvas');
    canvas.width = 1280;
    canvas.height = 720;
    const ctx = canvas.getContext('2d');

    // Setup Web Audio ambient chime track for video
    let audioStreamTrack = null;
    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') await audioCtx.resume();
      const dest = audioCtx.createMediaStreamDestination();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(440, audioCtx.currentTime);
      gain.gain.setValueAtTime(0.001, audioCtx.currentTime);
      osc.connect(gain);
      gain.connect(dest);
      osc.start();
      audioStreamTrack = dest.stream.getAudioTracks()[0];
    } catch (_) {}

    // Combine canvas video stream + optional audio
    const stream = canvas.captureStream(30);
    if (audioStreamTrack) {
      stream.addTrack(audioStreamTrack);
    }

    const mediaRecorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: 3000000 // 3 Mbps
    });

    const recordedChunks = [];
    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) recordedChunks.push(e.data);
    };

    const recordPromise = new Promise((resolve, reject) => {
      mediaRecorder.onstop = () => {
        const blob = new Blob(recordedChunks, { type: mimeType });
        if (blob.size < 1024) {
          reject(new Error('Generated video is empty. Please ensure photos are loaded and try again.'));
        } else {
          resolve(blob);
        }
      };
    });

    mediaRecorder.start(250);

    const fps = 30;
    const totalFrames = VIDEO_DURATION_SECONDS * fps; // 300 frames = 10s
    // CRITICAL: Each frame must wait its real-time slot (~33ms) so
    // MediaRecorder captures a proper 10-second video, not a 0-duration blob.
    const frameDurationMs = 1000 / fps; // ~33.33ms per frame
    const framesPerImage = Math.floor(totalFrames / loadedImages.length);

    // Render 10 seconds of Ken Burns animation at real 30fps timing
    for (let frame = 0; frame < totalFrames; frame++) {
      const frameStart = performance.now();
      const progressFraction = frame / totalFrames;
      const currentSec = (frame / fps).toFixed(1);

      // Determine active image and transition
      const imgIndex = Math.min(loadedImages.length - 1, Math.floor(frame / framesPerImage));
      const frameInImage = frame % framesPerImage;
      const imageProgress = frameInImage / framesPerImage;

      const currentImg = loadedImages[imgIndex];
      const nextImg = loadedImages[(imgIndex + 1) % loadedImages.length];

      // Draw background
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Draw active image with Ken Burns pan/zoom
      ctx.save();
      const zoom = 1.0 + 0.08 * imageProgress;
      const panX = (imageProgress - 0.5) * 40;
      const panY = (imageProgress - 0.5) * 20;

      // Maintain aspect ratio with cover fit
      drawImageCover(ctx, currentImg, panX, panY, zoom, canvas.width, canvas.height);
      ctx.restore();

      // Cross-fade if near end of image slot and more than 1 image
      const crossfadeFrames = 25;
      if (loadedImages.length > 1 && frameInImage >= framesPerImage - crossfadeFrames) {
        const alpha = (frameInImage - (framesPerImage - crossfadeFrames)) / crossfadeFrames;
        ctx.save();
        ctx.globalAlpha = alpha;
        drawImageCover(ctx, nextImg, 0, 0, 1.0, canvas.width, canvas.height);
        ctx.restore();
      }

      // Draw sleek AIFRET Product Showcase Overlay
      drawVideoBrandingOverlay(ctx, canvas.width, canvas.height, currentProduct, currentSec, progressFraction);

      // Update progress bar UI every 15 frames
      if (frame % 15 === 0 || frame === totalFrames - 1) {
        const percent = (progressFraction * 80) + 15;
        updateProgressBar(root, percent, `Encoding ${currentSec}s / 10s  (frame ${frame + 1}/${totalFrames})`);
      }

      // Wait remaining frame budget so total wall-clock time = ~33ms/frame
      const elapsed = performance.now() - frameStart;
      const remaining = frameDurationMs - elapsed;
      await new Promise((r) => setTimeout(r, remaining > 1 ? remaining : 1));
    }

    updateProgressBar(root, 95, 'Finalizing 10-second video encoding...');
    mediaRecorder.stop();
    const finalBlob = await recordPromise;

    if (activeGeneratedVideoUrl && activeGeneratedVideoUrl.startsWith('blob:')) {
      try { URL.revokeObjectURL(activeGeneratedVideoUrl); } catch (_) {}
    }

    activeGeneratedVideoBlob = finalBlob;
    activeGeneratedVideoUrl = URL.createObjectURL(finalBlob);
    updateProgressBar(root, 100, `Generation complete! (${(finalBlob.size / 1024).toFixed(0)} KB)`);
  }

  function drawImageCover(ctx, img, panX, panY, scale, targetW, targetH) {
    const imgRatio = img.width / img.height;
    const targetRatio = targetW / targetH;
    let drawW, drawH;

    if (imgRatio > targetRatio) {
      drawH = targetH * scale;
      drawW = drawH * imgRatio;
    } else {
      drawW = targetW * scale;
      drawH = drawW / imgRatio;
    }

    const x = (targetW - drawW) / 2 + panX;
    const y = (targetH - drawH) / 2 + panY;
    ctx.drawImage(img, x, y, drawW, drawH);
  }

  function drawVideoBrandingOverlay(ctx, width, height, product, currentSec, progress) {
    // 1. Top Bar: AIFRET Tag & Timestamp
    const topGrad = ctx.createLinearGradient(0, 0, 0, 120);
    topGrad.addColorStop(0, 'rgba(15, 23, 42, 0.75)');
    topGrad.addColorStop(1, 'rgba(15, 23, 42, 0)');
    ctx.fillStyle = topGrad;
    ctx.fillRect(0, 0, width, 120);

    // Brand tag
    ctx.fillStyle = '#2457ff';
    ctx.beginPath();
    ctx.arc(44, 44, 8, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 22px "Inter", "Segoe UI", sans-serif';
    ctx.fillText('AIFRET  •  Product Video Showcase', 62, 51);

    // Duration timer pill on right
    ctx.fillStyle = 'rgba(255, 255, 255, 0.18)';
    ctx.roundRect(width - 170, 26, 130, 36, 18);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = '600 16px "Inter", "Segoe UI", sans-serif';
    ctx.fillText(`⏱ ${currentSec}s / 10s`, width - 156, 50);

    // 2. Bottom Card: Product Info & Price
    const botGrad = ctx.createLinearGradient(0, height - 200, 0, height);
    botGrad.addColorStop(0, 'rgba(15, 23, 42, 0)');
    botGrad.addColorStop(0.35, 'rgba(15, 23, 42, 0.85)');
    botGrad.addColorStop(1, 'rgba(15, 23, 42, 0.95)');
    ctx.fillStyle = botGrad;
    ctx.fillRect(0, height - 200, width, 200);

    // Product Title
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 36px "Inter", "Segoe UI", sans-serif';
    const truncatedName = product.name.length > 38 ? product.name.substring(0, 36) + '...' : product.name;
    ctx.fillText(truncatedName, 44, height - 100);

    // Product Category & Price details
    ctx.fillStyle = '#94a3b8';
    ctx.font = '500 20px "Inter", "Segoe UI", sans-serif';
    const category = product.category || 'Featured';
    const brand = product.brand ? ` | ${product.brand}` : '';
    ctx.fillText(`${category}${brand}`, 44, height - 68);

    // Price badge if available
    if (product.price || product.selling_price) {
      const priceVal = product.price || product.selling_price;
      ctx.fillStyle = '#10b981';
      ctx.font = 'bold 26px "Inter", "Segoe UI", sans-serif';
      ctx.fillText(`₹${Number(priceVal).toLocaleString('en-IN')}`, 44, height - 32);

      const discount = product.discount || product.discount_percentage;
      if (discount) {
        ctx.fillStyle = '#f59e0b';
        ctx.font = 'bold 18px "Inter", "Segoe UI", sans-serif';
        ctx.fillText(`Save ${discount}%`, 200, height - 34);
      }
    }

    // 3. Bottom Animated Timeline Line (0 to 10s)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.fillRect(0, height - 6, width, 6);

    ctx.fillStyle = '#2457ff';
    ctx.fillRect(0, height - 6, width * progress, 6);
  }

  // ---------------------------------------------------------------------------
  // Preview Display & Video Player
  // ---------------------------------------------------------------------------

  function displayVideoPreview(root) {
    const previewBlock = root.querySelector('[data-preview-block]');
    const player = root.querySelector('[data-video-player]');
    const timestampEl = root.querySelector('[data-video-timestamp]');

    if (!previewBlock || !player) return;

    if (!activeGeneratedVideoUrl) {
      previewBlock.hidden = true;
      player.pause();
      player.removeAttribute('src');
      player.load();
      return;
    }

    previewBlock.hidden = false;

    // Clear old handlers to avoid stacking listeners
    player.oncanplay = null;
    player.onerror = null;

    // Revoke previous blob src if different (avoid stale URL)
    const prevSrc = player.getAttribute('src');
    if (prevSrc && prevSrc.startsWith('blob:') && prevSrc !== activeGeneratedVideoUrl) {
      try { URL.revokeObjectURL(prevSrc); } catch (_) {}
    }

    // Set new src and load
    player.src = activeGeneratedVideoUrl;

    // Wait for canplay before confirming video is ready
    player.oncanplay = () => {
      player.currentTime = 0;
      player.oncanplay = null;
    };

    // Handle load errors gracefully
    player.onerror = () => {
      player.onerror = null;
      const validationEl = root.querySelector('[data-media-validation]');
      if (validationEl) {
        validationEl.hidden = false;
        validationEl.textContent = 'Video playback failed. Your browser may not support this video format. Try regenerating the video.';
      }
    };

    player.load();

    if (timestampEl) {
      const now = new Date();
      timestampEl.textContent = `Generated: ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    }

    // Scroll smoothly to video preview
    previewBlock.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function removeVideo(root) {
    if (confirm('Are you sure you want to remove this generated product video?')) {
      if (activeGeneratedVideoUrl && activeGeneratedVideoUrl.startsWith('blob:')) {
        try { URL.revokeObjectURL(activeGeneratedVideoUrl); } catch (_) {}
      }
      activeGeneratedVideoBlob = null;
      activeGeneratedVideoUrl = null;

      displayVideoPreview(root);
      if (currentProduct) {
        deleteVideoRecord(currentProduct.id);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Product Switching & Initialization
  // ---------------------------------------------------------------------------

  async function loadProductMedia(root, product) {
    // 1. Reset current in-memory staging
    revokeAllPendingUrls();
    activePendingPhotos = [];
    activeGeneratedVideoBlob = null;
    activeGeneratedVideoUrl = null;
    currentProduct = product;

    // 2. Render initial markup
    renderMediaSectionMarkup(root, product);
    bindEvents(root);

    // 3. Load saved media record for this specific product ID from IndexedDB
    const savedRecord = await loadMediaRecord(product.id);
    if (savedRecord) {
      // Re-hydrate saved photos
      if (Array.isArray(savedRecord.photos) && savedRecord.photos.length) {
        activePendingPhotos = savedRecord.photos.map((p) => ({
          ...p,
          previewUrl: p.dataUrl
        }));
        renderThumbnails(root);
      }

      // Re-hydrate saved video
      if (savedRecord.videoBlob) {
        activeGeneratedVideoBlob = savedRecord.videoBlob;
        activeGeneratedVideoUrl = URL.createObjectURL(savedRecord.videoBlob);
        displayVideoPreview(root);
      } else if (savedRecord.videoUrl) {
        activeGeneratedVideoUrl = savedRecord.videoUrl;
        displayVideoPreview(root);
      }
    }
  }

  function bindEvents(root) {
    const fileInput = root.querySelector('#product-photo-file-input');
    const dropzone = root.querySelector('[data-media-dropzone]');
    const generateBtn = root.querySelector('[data-action="generate-video"]');
    const regenerateBtn = root.querySelector('[data-action="regenerate-video"]');
    const removeVideoBtn = root.querySelector('[data-action="remove-video"]');

    // File input change
    if (fileInput) {
      fileInput.addEventListener('change', (e) => {
        handleFilesSelected(root, e.target.files);
        fileInput.value = ''; // Reset input to allow selecting same file again
      });
    }

    // Drag & Drop
    if (dropzone) {
      ['dragenter', 'dragover'].forEach((eventName) => {
        dropzone.addEventListener(eventName, (e) => {
          e.preventDefault();
          e.stopPropagation();
          dropzone.classList.add('drag-active');
        });
      });

      ['dragleave', 'drop'].forEach((eventName) => {
        dropzone.addEventListener(eventName, (e) => {
          e.preventDefault();
          e.stopPropagation();
          dropzone.classList.remove('drag-active');
        });
      });

      dropzone.addEventListener('drop', (e) => {
        if (e.dataTransfer && e.dataTransfer.files) {
          handleFilesSelected(root, e.dataTransfer.files);
        }
      });
    }

    // Thumbnail remove clicks (event delegation)
    const thumbsContainer = root.querySelector('[data-media-thumbnails]');
    if (thumbsContainer) {
      thumbsContainer.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-action="remove-photo"]');
        if (btn) {
          const photoId = btn.dataset.photoId;
          removePhoto(root, photoId);
        }
      });
    }

    // Generate Video click
    if (generateBtn) {
      generateBtn.addEventListener('click', () => generateVideo(root));
    }

    // Regenerate Video click
    if (regenerateBtn) {
      regenerateBtn.addEventListener('click', () => generateVideo(root));
    }

    // Remove Video click
    if (removeVideoBtn) {
      removeVideoBtn.addEventListener('click', () => removeVideo(root));
    }
  }

  // ---------------------------------------------------------------------------
  // Public Interface
  // ---------------------------------------------------------------------------

  window.AIFRET_PRODUCT_MEDIA = {
    init(product, containerSelector = '[data-product-media-container]') {
      const container = document.querySelector(containerSelector);
      if (!container || !product) return;
      loadProductMedia(container, product);
    },

    switchProduct(product, containerSelector = '[data-product-media-container]') {
      this.init(product, containerSelector);
    }
  };
})();
