(function () {
  'use strict';

  const TRYON_MODAL_ID = 'aifret-ai-tryon-modal';
  const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
  const SUPPORTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

  function getModal() {
    let modal = document.getElementById(TRYON_MODAL_ID);
    if (!modal) {
      document.body.insertAdjacentHTML('beforeend', `
        <div id="${TRYON_MODAL_ID}" class="ai-tryon-backdrop" hidden>
          <div class="ai-tryon-modal" role="dialog" aria-modal="true" aria-labelledby="ai-tryon-title">
            <button type="button" class="ai-tryon-close" data-tryon-close aria-label="Close AI Video Try-On">×</button>

            <div data-tryon-stage="form">
              <div class="ai-tryon-header">
                <span class="eyebrow">AI Style Reel</span>
                <h3 id="ai-tryon-title">See How This Dress Looks on You</h3>
                <p>Upload your photo and create a 10-second AI fashion video.</p>
              </div>

              <div class="ai-tryon-upload-wrap">
                <label class="ai-tryon-upload-dropzone" for="ai-tryon-file-input">
                  <input id="ai-tryon-file-input" type="file" accept="image/jpeg,image/png,image/webp" hidden />
                  <span class="ai-tryon-upload-icon">📷</span>
                  <strong>Upload your photo</strong>
                  <small>JPG, PNG, or WebP up to 10MB</small>
                </label>
              </div>

              <div class="ai-tryon-preview-grid">
                <div class="ai-tryon-preview-card">
                  <span class="ai-tryon-preview-label">Your Photo</span>
                  <img data-tryon-customer-preview src="" alt="Customer upload preview" />
                </div>
                <div class="ai-tryon-preview-card">
                  <span class="ai-tryon-preview-label">Selected Dress</span>
                  <img data-tryon-product-preview src="" alt="Selected product preview" />
                </div>
              </div>

              <button type="button" class="btn btn-primary ai-tryon-generate" data-tryon-generate>
                <span>✨</span>
                <span>Generate AI Video</span>
              </button>
            </div>

            <div data-tryon-stage="processing" hidden>
              <div class="ai-tryon-header center">
                <span class="eyebrow">Generating</span>
                <h3>Creating your AI fashion video</h3>
              </div>
              <div class="ai-tryon-progress-box">
                <div class="media-progress-info-row">
                  <div class="media-progress-spinner" aria-hidden="true"></div>
                  <span class="media-progress-text" data-tryon-status-text>Preparing your photo...</span>
                  <span class="media-progress-percent" data-tryon-progress-percent>0%</span>
                </div>
                <div class="media-progress-bar-track">
                  <div class="media-progress-bar-fill" data-tryon-progress-bar style="width: 0%;"></div>
                </div>
                <p class="media-progress-subnote">This usually takes a few moments to build your 10-second fashion reel.</p>
              </div>
            </div>

            <div data-tryon-stage="result" hidden>
              <div class="ai-tryon-header center">
                <span class="eyebrow">AI Fashion Video</span>
                <h3>Your AI Fashion Video is Ready ✨</h3>
              </div>

              <div class="ai-tryon-video-shell">
                <video data-tryon-video controls playsinline preload="metadata"></video>
              </div>

              <div class="ai-tryon-result-actions">
                <a class="btn btn-primary" data-tryon-download href="" download>Download</a>
                <button type="button" class="btn btn-secondary" data-tryon-share>Share</button>
                <button type="button" class="btn btn-secondary" data-tryon-regenerate>Generate Again</button>
              </div>
            </div>
          </div>
        </div>
      `);
      modal = document.getElementById(TRYON_MODAL_ID);
    }
    return modal;
  }

  function setStage(modal, stageName) {
    const stages = modal.querySelectorAll('[data-tryon-stage]');
    stages.forEach((stage) => {
      const isActive = stage.dataset.tryonStage === stageName;
      stage.hidden = !isActive;
    });
  }

  function updateProgress(modal, message, percent) {
    const statusText = modal.querySelector('[data-tryon-status-text]');
    const progressBar = modal.querySelector('[data-tryon-progress-bar]');
    const percentText = modal.querySelector('[data-tryon-progress-percent]');

    if (statusText) statusText.textContent = message;
    if (progressBar) progressBar.style.width = `${Math.max(0, Math.min(100, Number(percent) || 0))}%`;
    if (percentText) percentText.textContent = `${Math.max(0, Math.min(100, Number(percent) || 0))}%`;
  }

  function openModal(modal, product) {
    const productPreview = modal.querySelector('[data-tryon-product-preview]');
    const customerPreview = modal.querySelector('[data-tryon-customer-preview]');
    const video = modal.querySelector('[data-tryon-video]');

    modal.dataset.productId = product.id;
    modal.dataset.productName = product.name;
    modal.dataset.productImage = product.image || '';
    modal.dataset.customerPhoto = '';
    modal.dataset.busy = 'false';
    if (productPreview) productPreview.src = product.image || '';
    if (customerPreview) customerPreview.src = '';
    if (video) {
      video.removeAttribute('src');
      video.load();
    }

    setStage(modal, 'form');
    modal.hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function closeModal(modal) {
    modal.hidden = true;
    document.body.style.overflow = '';
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      if (!(file instanceof File)) {
        reject(new Error('A valid file is required.'));
        return;
      }
      if (!SUPPORTED_TYPES.includes(file.type)) {
        reject(new Error('Please upload a JPG, PNG, or WebP image.'));
        return;
      }
      if (file.size > MAX_FILE_SIZE_BYTES) {
        reject(new Error('Your photo must be under 10MB.'));
        return;
      }

      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('Unable to read the selected photo.'));
      reader.readAsDataURL(file);
    });
  }

  function setCustomerPhoto(modal, dataUrl) {
    const preview = modal.querySelector('[data-tryon-customer-preview]');
    if (preview) preview.src = dataUrl;
    modal.dataset.customerPhoto = dataUrl;
  }

  async function handleFileSelection(modal, event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;

    try {
      const dataUrl = await readFileAsDataUrl(file);
      setCustomerPhoto(modal, dataUrl);
    } catch (error) {
      window.alert(error.message || 'The selected photo could not be used.');
    }
  }

  async function generateTryOnVideo(modal) {
    if (modal.dataset.busy === 'true') return;

    const productId = modal.dataset.productId;
    const productName = modal.dataset.productName || 'Selected Product';
    const productImage = modal.dataset.productImage || '';
    const customerPhoto = modal.dataset.customerPhoto || '';
    if (!productId || !customerPhoto) {
      window.alert('Please upload a clear photo before generating your AI video.');
      return;
    }

    modal.dataset.busy = 'true';
    setStage(modal, 'processing');
    updateProgress(modal, 'Preparing your photo...', 18);

    try {
      const sessionResponse = await window.AIFRET_AUTH.session();
      const user = sessionResponse?.user || {};
      const customerId = user.customerId || user.id || '';

      const response = await fetch('/api/ai-tryon/generate', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_id: customerId,
          product_id: productId,
          product_name: productName,
          product_image: productImage,
          customer_photo: customerPhoto
        })
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.message || 'Unable to start the AI try-on generation.');
      }

      const jobId = payload.job_id;
      let lastProgress = Number(payload.progress || 18) || 18;

      while (true) {
        await new Promise((resolve) => setTimeout(resolve, 1600));
        const statusResponse = await fetch(`/api/ai-tryon/status/${jobId}`, { credentials: 'include' });
        const statusPayload = await statusResponse.json().catch(() => ({}));

        if (!statusResponse.ok) {
          throw new Error(statusPayload.message || 'Unable to fetch the video generation status.');
        }

        const progress = Number(statusPayload.progress || lastProgress) || lastProgress;
        if (progress < 30) {
          updateProgress(modal, 'Preparing your photo...', progress);
        } else if (progress < 55) {
          updateProgress(modal, 'Applying the selected outfit...', progress);
        } else if (progress < 85) {
          updateProgress(modal, 'Creating your fashion video...', progress);
        } else {
          updateProgress(modal, 'Finalizing your AI video...', progress);
        }

        lastProgress = progress;
        if (statusPayload.status === 'completed') {
          const videoUrl = statusPayload.video_url || '';
          const videoElement = modal.querySelector('[data-tryon-video]');
          const resultDownload = modal.querySelector('[data-tryon-download]');

          if (videoElement) {
            videoElement.src = videoUrl;
            videoElement.load();
          }
          if (resultDownload) {
            resultDownload.href = videoUrl;
            resultDownload.setAttribute('download', `${productName.replace(/\s+/g, '-')}-aifret-tryon.mp4`);
          }

          setStage(modal, 'result');
          break;
        }
      }
    } catch (error) {
      setStage(modal, 'form');
      window.alert(error.message || 'The AI video generation could not be completed.');
    } finally {
      modal.dataset.busy = 'false';
    }
  }

  function bindModalEvents(modal) {
    const closeButton = modal.querySelector('[data-tryon-close]');
    if (closeButton) {
      closeButton.addEventListener('click', () => closeModal(modal));
    }

    const fileInput = modal.querySelector('#ai-tryon-file-input');
    if (fileInput) {
      fileInput.addEventListener('change', (event) => handleFileSelection(modal, event));
    }

    const generateButton = modal.querySelector('[data-tryon-generate]');
    if (generateButton) {
      generateButton.addEventListener('click', () => generateTryOnVideo(modal));
    }

    const regenerateButton = modal.querySelector('[data-tryon-regenerate]');
    if (regenerateButton) {
      regenerateButton.addEventListener('click', () => {
        modal.dataset.customerPhoto = '';
        const customerPreview = modal.querySelector('[data-tryon-customer-preview]');
        if (customerPreview) customerPreview.src = '';
        const fileInput = modal.querySelector('#ai-tryon-file-input');
        if (fileInput) fileInput.value = '';
        setStage(modal, 'form');
      });
    }

    const shareButton = modal.querySelector('[data-tryon-share]');
    if (shareButton) {
      shareButton.addEventListener('click', async () => {
        const videoUrl = modal.querySelector('[data-tryon-video]')?.src || '';
        if (!videoUrl) return;
        try {
          if (navigator.share) {
            await navigator.share({ title: 'AIFRET AI Fashion Video', url: videoUrl });
          } else if (navigator.clipboard) {
            await navigator.clipboard.writeText(videoUrl);
            window.alert('Video link copied to clipboard.');
          }
        } catch (error) {
          // Ignore share cancellation without disrupting the flow.
        }
      });
    }

    modal.addEventListener('click', (event) => {
      if (event.target === modal) closeModal(modal);
    });
  }

  document.addEventListener('click', async (event) => {
    const trigger = event.target.closest('[data-ai-tryon-trigger]');
    if (!trigger) return;
    event.preventDefault();

    const product = {
      id: trigger.dataset.productId,
      name: trigger.dataset.productName || 'Selected Product',
      image: trigger.dataset.productImage || ''
    };

    try {
      if (!window.AIFRET_AUTH || typeof window.AIFRET_AUTH.session !== 'function') {
        throw new Error('Authentication is not available.');
      }
      await window.AIFRET_AUTH.session();
      const modal = getModal();
      bindModalEvents(modal);
      openModal(modal, product);
    } catch (error) {
      const path = window.location.pathname + window.location.search;
      window.location.href = `login.html?returnTo=${encodeURIComponent(path)}`;
    }
  });
})();
