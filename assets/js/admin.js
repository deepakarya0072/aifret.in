const adminStorageKey = 'aifret.products.v1';
const adminConfig = window.AIFRET_CONFIG;
let adminProducts = loadAdminProducts();
let editingProductId = null;
let selectedImageData = '';
const maxImageBytes = 10 * 1024 * 1024;

function loadAdminProducts() {
  try {
    const saved = JSON.parse(localStorage.getItem(adminStorageKey) || 'null');
    return Array.isArray(saved) ? saved.map(migrateAdminProduct) : adminConfig.products.map(migrateAdminProduct);
  } catch (error) {
    return adminConfig.products.map(migrateAdminProduct);
  }
}

function migrateAdminProduct(product) {
  return {
    ...product,
    comparison: (product.comparison || []).map((offer) => ({
      ...offer,
      storeName: offer.storeName || (offer.marketplaceSlug === 'other-stores' ? 'Demo Store' : '')
    }))
  };
}

function saveAdminProducts() {
  localStorage.setItem(adminStorageKey, JSON.stringify(adminProducts));
}

function setAdminVideoStatus(status, product = null) {
  const statusRoot = document.querySelector('[data-admin-video-status]');
  const preview = document.querySelector('[data-admin-video-preview]');
  const regenerate = document.querySelector('[data-regenerate-video]');
  const messages = {
    pending: 'AI Product Video not generated',
    processing: 'Generating AI Product Video...',
    ready: 'AI Product Video Ready ✓',
    failed: 'AI Product Video Generation Failed'
  };
  if (statusRoot) {
    statusRoot.textContent = messages[status] || messages.pending;
    statusRoot.dataset.status = status || 'pending';
  }
  if (preview) {
    preview.hidden = status !== 'ready' || !product?.productVideoUrl;
    preview.href = product?.productVideoUrl || '#';
  }
  if (regenerate) regenerate.hidden = !product?.id || !product?.image;
}

async function generateProductVideo(product) {
  product.videoStatus = 'processing';
  product.productVideoUrl = '';
  product.videoJobId = '';
  saveAdminProducts();
  setAdminVideoStatus('processing', product);

  try {
    const result = await window.AIFRET_AI.generateVideo({ product, image: product.image });
    product.videoStatus = result.status === 'pending' || result.status === 'processing' ? result.status : 'ready';
    product.productVideoUrl = result.mediaUrl || '';
    product.videoJobId = result.jobId || '';
    product.videoGeneratedAt = result.generatedAt || new Date().toISOString();
    if (product.videoStatus === 'ready' && !product.productVideoUrl) throw new Error('Provider returned no video URL.');
  } catch (error) {
    product.videoStatus = 'failed';
    product.productVideoUrl = '';
    product.videoJobId = '';
  }

  const index = adminProducts.findIndex((item) => item.id === product.id);
  if (index >= 0) adminProducts[index] = product;
  saveAdminProducts();
  renderAdminList();
  setAdminVideoStatus(product.videoStatus, product);
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
}

function marketplaceOptions(selected = '') {
  return adminConfig.marketplaces.map((marketplace) => `<option value="${marketplace.slug}" ${marketplace.slug === selected ? 'selected' : ''}>${marketplace.name}</option>`).join('');
}

function categoryOptions(selected = '') {
  return adminConfig.categories.map((category) => `<option value="${category.slug}" data-name="${escapeHtml(category.name)}" ${category.slug === selected ? 'selected' : ''}>${category.name}</option>`).join('');
}

function isValidAffiliateUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch (error) {
    return false;
  }
}

function createOfferRow(offer = {}) {
  const marketplace = offer.marketplaceSlug || (offer.marketplace || '').toLowerCase().replace(/\s+/g, '-') || 'amazon';
  const affiliateUrl = offer.affiliateUrl || '';
  const affiliateStatus = isValidAffiliateUrl(affiliateUrl)
    ? '<small class="affiliate-status is-configured" data-affiliate-status>✓ Affiliate link configured</small>'
    : '<small class="affiliate-status is-missing" data-affiliate-status>⚠ Affiliate link not configured</small>';
  return `<div class="admin-offer-row" data-offer-row>
    <div class="admin-offer-heading"><strong>Marketplace offer</strong><button type="button" class="btn btn-secondary btn-small" data-remove-offer>Remove</button></div>
    <div class="admin-offer-fields">
      <label>Marketplace<select data-offer-marketplace required>${marketplaceOptions(marketplace)}</select></label>
      <label>Other store name<input type="text" data-offer-store-name value="${escapeHtml(offer.storeName || '')}" placeholder="Only needed for Other Stores" /></label>
      <label>Product URL<input type="url" data-offer-product-url value="${escapeHtml(offer.productUrl || offer.url || '')}" placeholder="https://example.com/product" required /></label>
      <label>Affiliate URL<input type="url" data-offer-affiliate-url value="${escapeHtml(affiliateUrl)}" placeholder="https://partner.example/affiliate-link" />${affiliateStatus}</label>
      <label>Current Price<input type="number" min="0" step="1" data-offer-price value="${offer.price ?? ''}" required /></label>
      <label>Original Price<input type="number" min="0" step="1" data-offer-original-price value="${offer.originalPrice ?? ''}" required /></label>
      <label>Discount (%)<input type="number" min="0" max="100" step="1" data-offer-discount value="${offer.discount ?? ''}" required /></label>
      <label>Availability<input type="text" data-offer-availability value="${escapeHtml(offer.availability || 'Demo listing')}" required /></label>
    </div>
  </div>`;
}

function renderOffers(offers = []) {
  const root = document.querySelector('[data-admin-offers]');
  root.innerHTML = (offers.length ? offers : [{}]).map(createOfferRow).join('');
}

function renderAdminList() {
  const root = document.querySelector('[data-admin-product-list]');
  root.innerHTML = adminProducts.map((product) => `<article class="admin-product-item">
    <div><strong>${escapeHtml(product.name)}</strong><span>${escapeHtml(product.category)} · ${(product.comparison || []).length} offers · video ${escapeHtml(product.videoStatus || 'pending')}</span></div>
    <div class="admin-product-actions"><button type="button" class="btn btn-secondary btn-small" data-edit-product="${escapeHtml(product.id)}">Edit</button><button type="button" class="btn btn-danger btn-small" data-delete-product="${escapeHtml(product.id)}">Delete</button></div>
  </article>`).join('') || '<p class="admin-empty">No products saved yet.</p>';
}

function resetAdminForm() {
  editingProductId = null;
  selectedImageData = '';
  document.querySelector('[data-admin-form]').reset();
  document.querySelector('[data-admin-form-title]').textContent = 'Add product';
  document.querySelector('[data-admin-submit]').textContent = 'Save product';
  document.querySelector('[data-admin-image-preview]').removeAttribute('src');
  document.querySelector('[data-admin-image-preview]').hidden = true;
  setAdminVideoStatus('pending');
  renderOffers();
}

function populateAdminForm(product) {
  editingProductId = product.id;
  selectedImageData = product.image || '';
  const form = document.querySelector('[data-admin-form]');
  form.elements.name.value = product.name || '';
  form.elements.category.value = product.slug || '';
  form.elements.brand.value = product.brand || '';
  form.elements.description.value = product.description || '';
  form.elements.imageUrl.value = product.image && !product.image.startsWith('data:') ? product.image : '';
  document.querySelector('[data-admin-form-title]').textContent = `Edit ${product.name}`;
  document.querySelector('[data-admin-submit]').textContent = 'Update product';
  const preview = document.querySelector('[data-admin-image-preview]');
  preview.src = product.image || '';
  preview.hidden = !product.image;
  setAdminVideoStatus(product.videoStatus || 'pending', product);
  renderOffers(product.comparison);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function collectOffers() {
  return [...document.querySelectorAll('[data-offer-row]')].map((row) => {
    const marketplaceField = row.querySelector('[data-offer-marketplace]');
    const marketplace = adminConfig.marketplaces.find((item) => item.slug === marketplaceField.value);
    return {
      marketplace: marketplace.name,
      marketplaceSlug: marketplace.slug,
      storeName: row.querySelector('[data-offer-store-name]').value.trim(),
      productUrl: row.querySelector('[data-offer-product-url]').value.trim(),
      affiliateUrl: row.querySelector('[data-offer-affiliate-url]').value.trim(),
      url: row.querySelector('[data-offer-product-url]').value.trim(),
      price: Number(row.querySelector('[data-offer-price]').value),
      originalPrice: Number(row.querySelector('[data-offer-original-price]').value),
      discount: Number(row.querySelector('[data-offer-discount]').value),
      availability: row.querySelector('[data-offer-availability]').value.trim()
    };
  });
}

async function readSelectedImage() {
  const file = document.querySelector('[data-admin-image-file]').files[0];
  if (!file) return selectedImageData;
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  const form = document.querySelector('[data-admin-form]');
  document.querySelector('[data-admin-category]').insertAdjacentHTML('beforeend', categoryOptions());
  renderAdminList();
  renderOffers();
  setAdminVideoStatus('pending');

  document.querySelector('[data-add-offer]').addEventListener('click', () => {
    document.querySelector('[data-admin-offers]').insertAdjacentHTML('beforeend', createOfferRow());
  });

  document.querySelector('[data-admin-offers]').addEventListener('click', (event) => {
    if (!event.target.matches('[data-remove-offer]')) return;
    const rows = document.querySelectorAll('[data-offer-row]');
    if (rows.length === 1) return;
    event.target.closest('[data-offer-row]').remove();
  });

  document.querySelector('[data-admin-offers]').addEventListener('input', (event) => {
    if (!event.target.matches('[data-offer-affiliate-url]')) return;
    const status = event.target.parentElement.querySelector('[data-affiliate-status]');
    const configured = isValidAffiliateUrl(event.target.value.trim());
    status.className = `affiliate-status ${configured ? 'is-configured' : 'is-missing'}`;
    status.textContent = configured ? '✓ Affiliate link configured' : '⚠ Affiliate link not configured';
  });

  document.querySelector('[data-admin-image-file]').addEventListener('change', async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > maxImageBytes) {
      event.target.value = '';
      document.querySelector('[data-admin-status]').textContent = 'Use a JPG, PNG, or WEBP image up to 10 MB.';
      return;
    }
    const preview = document.querySelector('[data-admin-image-preview]');
    preview.src = URL.createObjectURL(file);
    preview.hidden = false;
    setAdminVideoStatus('processing');
  });

  document.querySelector('[data-regenerate-video]').addEventListener('click', async () => {
    const product = adminProducts.find((item) => item.id === editingProductId);
    if (!product) return;
    await generateProductVideo(product);
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    const offers = collectOffers();
    const imageUrl = formData.get('imageUrl').trim();
    const image = await readSelectedImage() || imageUrl;
    const missingOtherStoreName = offers.some((offer) => offer.marketplaceSlug === 'other-stores' && !offer.storeName);
    const invalidAffiliate = offers.some((offer) => !isValidAffiliateUrl(offer.affiliateUrl));
    const duplicateMarketplace = new Set(offers.map((offer) => offer.marketplaceSlug)).size !== offers.length;
    if (!form.reportValidity() || !image || !offers.length || missingOtherStoreName || invalidAffiliate || duplicateMarketplace) {
      document.querySelector('[data-admin-status]').textContent = invalidAffiliate
        ? 'Please enter a valid HTTP/HTTPS affiliate URL for every offer.'
        : duplicateMarketplace
          ? 'Each marketplace may appear only once per product.'
          : 'Add a product image and at least one complete marketplace offer.';
      return;
    }

    const category = adminConfig.categories.find((item) => item.slug === formData.get('category'));
    const firstOffer = offers[0];
    const existingProduct = adminProducts.find((item) => item.id === editingProductId);
    const imageChanged = !existingProduct || existingProduct.image !== image;
    const product = {
      id: editingProductId || `product-${Date.now()}`,
      name: formData.get('name').trim(),
      image,
      category: category.name,
      slug: category.slug,
      brand: formData.get('brand').trim(),
      description: formData.get('description').trim(),
      price: firstOffer.price,
      originalPrice: firstOffer.originalPrice,
      discount: firstOffer.discount,
      currentPrice: firstOffer.price,
      oldPrice: firstOffer.originalPrice,
      rating: 0,
      reviews: 0,
      features: [],
      comparison: offers,
      isFeatured: true,
      isDeal: true,
      productVideoUrl: imageChanged ? '' : (existingProduct?.productVideoUrl || ''),
      videoStatus: imageChanged ? 'pending' : (existingProduct?.videoStatus || 'pending'),
      videoJobId: imageChanged ? '' : (existingProduct?.videoJobId || ''),
      videoGeneratedAt: imageChanged ? '' : (existingProduct?.videoGeneratedAt || '')
    };

    const existingIndex = adminProducts.findIndex((item) => item.id === product.id);
    if (existingIndex >= 0) adminProducts[existingIndex] = product; else adminProducts.unshift(product);
    saveAdminProducts();
    renderAdminList();
    document.querySelector('[data-admin-status]').textContent = `${product.name} saved locally. Generating AI Product Video...`;
    populateAdminForm(product);
    setAdminVideoStatus('processing', product);
    await generateProductVideo(product);
  });

  document.querySelector('[data-admin-product-list]').addEventListener('click', (event) => {
    const editButton = event.target.closest('[data-edit-product]');
    const deleteButton = event.target.closest('[data-delete-product]');
    if (editButton) {
      const product = adminProducts.find((item) => item.id === editButton.dataset.editProduct);
      if (product) populateAdminForm(product);
    }
    if (deleteButton && window.confirm('Delete this local product?')) {
      adminProducts = adminProducts.filter((item) => item.id !== deleteButton.dataset.deleteProduct);
      saveAdminProducts();
      renderAdminList();
      document.querySelector('[data-admin-status]').textContent = 'Product deleted from local storage.';
    }
  });

  document.querySelector('[data-admin-reset]').addEventListener('click', resetAdminForm);
});
