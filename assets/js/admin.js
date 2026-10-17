/**
 * AIFRET - Admin Product Management System
 * Connects to REST API endpoints for secure database-backed catalog control.
 */

let adminProducts = [];
let editingProductId = null;
let selectedMainImage = '';
let additionalImagesList = [];
let pendingDeleteProductId = null;
let adminOffset = 0;
let adminTotal = 0;
let adminStats = { total: 0, published: 0, drafts: 0, featured: 0, best_value: 0 };
const ADMIN_PAGE_SIZE = 50;
const PRODUCTS_STORAGE_KEY = 'aifret.products.v1';
const DEFAULT_ADMIN_CATEGORIES = [
  'Electronics', 'Mobiles', 'Laptops', 'Fashion', 'Shoes', 'Beauty',
  'Home & Kitchen', 'Watches'
];
const DEFAULT_ADMIN_MARKETPLACES = ['Amazon', 'Flipkart', 'Meesho', 'Myntra', 'Other Stores'];
const IMPORT_FIELD_LABELS = {
  name: 'product name', brand: 'brand', description: 'description', category: 'category',
  subcategory: 'subcategory', image: 'main image', price: 'selling price', mrp: 'MRP', currency: 'currency',
  discount: 'discount', availability: 'availability', product_id: 'marketplace product ID',
  model_number: 'model number', additional_images: 'additional images', key_features: 'key features',
  specifications: 'specifications', variants: 'variants'
};

const currency = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0
});

function formatPrice(val) {
  return currency.format(Number(val) || 0);
}

function escapeHtml(str = '') {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

async function adminFetch(path, options = {}) {
  let response;
  try {
    response = await fetch(path, { credentials: 'same-origin', ...options });
  } catch {
    throw new Error('Cannot connect to the AIFRET API. Check the Cloudflare Pages deployment and API bindings.');
  }

  const contentType = response.headers.get('Content-Type') || '';
  if (response.status === 404 && path.startsWith('/api/') && !contentType.includes('application/json')) {
    throw new Error('The AIFRET API is not available on this website (HTTP 404). Deploy the Cloudflare Pages Functions and configure the D1 binding.');
  }
  return response;
}

function setLoginStatus(message) {
  const statusEl = document.querySelector('[data-admin-login-status]');
  statusEl.textContent = message;
  statusEl.style.color = message ? 'var(--danger)' : '';
}

// ---------------------------------------------------------------------------
// Authentication & Session
// ---------------------------------------------------------------------------

async function checkAdminSession() {
  try {
    const res = await adminFetch('/api/admin/session');
    if (res.ok) {
      const data = await res.json();
      showDashboard(data.user?.username || 'Admin');
    } else {
      showLogin();
    }
  } catch (err) {
    showLogin();
    setLoginStatus(err.message);
  }
}

function showLogin() {
  document.querySelector('[data-admin-login-view]').hidden = false;
  document.querySelector('[data-admin-dashboard-view]').hidden = true;
  document.querySelector('[data-admin-logout-btn]').hidden = true;
  document.querySelector('[data-admin-header-user]').textContent = 'Admin Management';
}

function showDashboard(username) {
  document.querySelector('[data-admin-login-view]').hidden = true;
  document.querySelector('[data-admin-dashboard-view]').hidden = false;
  document.querySelector('[data-admin-logout-btn]').hidden = false;
  document.querySelector('[data-admin-header-user]').textContent = `Logged in as: ${username}`;
  loadProducts();
}

async function handleAdminLogin(event) {
  event.preventDefault();
  const form = event.target;
  const statusEl = document.querySelector('[data-admin-login-status]');
  statusEl.textContent = 'Verifying credentials...';
  statusEl.style.color = 'var(--muted)';

  const body = {
    username: form.elements.username.value.trim(),
    password: form.elements.password.value.trim()
  };

  try {
    const res = await adminFetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (res.ok && data.success) {
      statusEl.textContent = '';
      form.reset();
      showDashboard(data.username || body.username);
    } else {
      statusEl.textContent = data.message || 'Invalid username or password.';
      statusEl.style.color = 'var(--danger)';
    }
  } catch (err) {
    statusEl.textContent = err.message;
    statusEl.style.color = 'var(--danger)';
  }
}

async function handleAdminLogout() {
  try {
    const response = await adminFetch('/api/admin/logout', { method: 'POST' });
    if (!response.ok) throw new Error('Could not sign out. Please try again.');
    showLogin();
  } catch (error) {
    const statusEl = document.querySelector('[data-admin-status]');
    statusEl.textContent = error.message;
    statusEl.style.color = 'var(--danger)';
  }
}

// ---------------------------------------------------------------------------
// Product Data Loading & Filtering
// ---------------------------------------------------------------------------

async function loadProducts(resetPage = false) {
  const tbody = document.querySelector('[data-admin-table-body]');
  if (resetPage) adminOffset = 0;
  const query = new URLSearchParams({
    status: document.querySelector('[data-admin-filter-status]').value,
    search: document.querySelector('[data-admin-search]').value.trim(),
    category: document.querySelector('[data-admin-filter-category]').value,
    marketplace: document.querySelector('[data-admin-filter-market]').value,
    sort: document.querySelector('[data-admin-sort]').value,
    limit: String(ADMIN_PAGE_SIZE),
    offset: String(adminOffset)
  });
  try {
    const res = await adminFetch(`/api/products?${query}`);
    if (!res.ok) throw new Error('Failed to load products');
    const data = await res.json();
    adminProducts = data.products || [];
    adminTotal = Number(data.total) || 0;
    adminStats = data.stats || adminStats;
    if (Array.isArray(data.categories)) populateFilterDropdowns(data.categories, data.marketplaces || []);
    if (adminOffset >= adminTotal && adminOffset > 0) {
      adminOffset = Math.max(0, Math.floor((adminTotal - 1) / ADMIN_PAGE_SIZE) * ADMIN_PAGE_SIZE);
      return loadProducts();
    }
    try {
      if (adminOffset === 0 && adminTotal <= ADMIN_PAGE_SIZE) {
        window.localStorage.setItem(PRODUCTS_STORAGE_KEY, JSON.stringify(
          adminProducts.filter((product) => product.status === 'active')
        ));
      }
    } catch (error) { console.warn('Unable to refresh the local product cache.', error); }
    updateStats();
    renderProductTable();
    updatePagination();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; color: var(--danger); padding: 24px;">Failed to load products from database: ${err.message}</td></tr>`;
  }
}

function updateStats() {
  document.querySelector('[data-stat-total]').textContent = adminStats.total;
  document.querySelector('[data-stat-active]').textContent = adminStats.published;
  document.querySelector('[data-stat-inactive]').textContent = adminStats.drafts;
  document.querySelector('[data-stat-featured]').textContent = adminStats.featured;
  document.querySelector('[data-stat-best]').textContent = adminStats.best_value;
}

function populateFilterDropdowns(categories = [], marketplaces = []) {
  const categorySelect = document.querySelector('[data-admin-filter-category]');
  const marketSelect = document.querySelector('[data-admin-filter-market]');
  const categoryOptions = document.querySelector('[data-admin-category-options]');
  const marketplaceOptions = document.querySelector('[data-admin-marketplace-options]');

  const currentCat = categorySelect.value;
  const currentMkt = marketSelect.value;

  const allCategories = Array.from(new Set([...DEFAULT_ADMIN_CATEGORIES, ...categories])).sort((a, b) => a.localeCompare(b));
  const allMarketplaces = Array.from(new Set([...DEFAULT_ADMIN_MARKETPLACES, ...marketplaces])).sort((a, b) => a.localeCompare(b));

  categorySelect.innerHTML = '<option value="all">All Categories</option>' +
    allCategories.map(c => `<option value="${escapeHtml(c)}" ${c === currentCat ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('');

  marketSelect.innerHTML = '<option value="all">All Marketplaces</option>' +
    allMarketplaces.map(m => `<option value="${escapeHtml(m)}" ${m === currentMkt ? 'selected' : ''}>${escapeHtml(m)}</option>`).join('');
  categoryOptions.innerHTML = allCategories.map(category =>
    `<option value="${escapeHtml(category)}"></option>`
  ).join('');
  marketplaceOptions.innerHTML = allMarketplaces.map(marketplace =>
    `<option value="${escapeHtml(marketplace)}"></option>`
  ).join('');
}

function setImportStatus(message, tone = 'muted') {
  const status = document.querySelector('[data-import-status]');
  if (!status) return;
  status.textContent = message || '';
  status.style.color = tone === 'danger' ? 'var(--danger)' : tone === 'success' ? 'var(--success)' : 'var(--muted)';
}

function formatImportedLines(value) {
  if (Array.isArray(value)) return value.filter(Boolean).join('\n');
  return typeof value === 'string' ? value : '';
}

function formatImportedSpecifications(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  return Object.entries(value).map(([key, item]) => `${key}: ${item}`).join('\n');
}

function fillImportedProduct(product, sourceUrl, marketplace) {
  const form = document.querySelector('[data-admin-form]');
  const set = (name, value) => {
    if (value !== undefined && value !== null && value !== '') form.elements[name].value = value;
  };
  set('marketplace', marketplace);
  set('product_url', sourceUrl);
  set('affiliate_url', sourceUrl);
  set('name', product.name);
  set('brand', product.brand);
  set('category', product.category);
  set('subcategory', product.subcategory);
  set('description', product.description);
  set('short_description', product.short_description);
  set('detailed_description', product.description);
  set('model_number', product.model_number);
  set('manufacturer', product.manufacturer);
  set('color', product.color);
  set('size', product.size);
  set('material', product.material);
  set('weight', product.weight);
  set('dimensions', product.dimensions);
  set('country_of_origin', product.country_of_origin);
  set('availability', product.availability);
  set('imageUrl', product.image);
  set('mrp', product.mrp);
  set('discount', product.discount);
  set('selling_price', product.price);
  set('currency', product.currency);
  set('key_features', formatImportedLines(product.key_features));
  set('specifications', formatImportedSpecifications(product.specifications));
  set('variants', formatImportedLines(product.variants));
  if (product.image) {
    selectedMainImage = product.image;
    const preview = document.querySelector('[data-admin-image-preview]');
    preview.src = product.image;
    preview.hidden = false;
  }
  additionalImagesList = Array.isArray(product.additional_images) ? product.additional_images.filter(Boolean) : [];
  form.elements.additionalImagesUrls.value = additionalImagesList.join(', ');
  renderExtraPreviews();
  document.querySelector('[data-import-preview]').hidden = false;
  updateDiscountCalculation();
  if (product.price !== undefined && product.price !== null && product.price !== '') form.elements.selling_price.value = product.price;
  document.getElementById('product-form-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function handleImportFetch() {
  const urlInput = document.querySelector('[data-import-url]');
  const button = document.querySelector('[data-import-fetch]');
  const sourceUrl = urlInput.value.trim();
  if (!sourceUrl) {
    setImportStatus('Paste an HTTPS marketplace or affiliate URL first.', 'danger');
    return;
  }
  button.disabled = true;
  setImportStatus('Checking marketplace and authorized provider access...', 'muted');
  try {
    const response = await adminFetch('/api/admin/import-preview', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: sourceUrl })
    });
    const data = await response.json();
    if (data.marketplace && data.source_url) {
      const missing = (data.missing_fields || []).map((field) => IMPORT_FIELD_LABELS[field] || field);
      const provider = document.querySelector('[data-import-provider]');
      const fields = document.querySelector('[data-import-fields]');
      provider.textContent = `${data.marketplace}${data.ready ? ' · Authorized data received' : ' · Manual fallback'}`;
      fields.textContent = missing.length ? `Unavailable or needs review: ${missing.join(', ')}.` : 'All mapped fields were returned; review before saving.';
      document.querySelector('[data-import-preview]').hidden = false;
    }
    if (data.ready) {
      fillImportedProduct(data, data.source_url, data.marketplace);
      setImportStatus(data.duplicates?.length
        ? `Details fetched, but this URL already matches ${data.duplicates.length} catalog record(s). Review duplicates before saving.`
        : (data.message || 'Details fetched. Review and save as Draft or Publish.'), data.duplicates?.length ? 'danger' : 'success');
    } else {
      if (data.source_url && data.marketplace) fillImportedProduct(data, data.source_url, data.marketplace);
      setImportStatus(data.message || 'Authorized API data is unavailable. Manual entry is still available.', 'danger');
    }
  } catch (error) {
    setImportStatus(error.message || 'Product import failed. Manual entry is still available.', 'danger');
  } finally {
    button.disabled = false;
  }
}

function parseLineList(value) {
  return String(value || '').split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean);
}

function parseSpecificationLines(value) {
  return String(value || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean).reduce((result, line) => {
    const separator = line.indexOf(':');
    if (separator > 0) result[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
    return result;
  }, {});
}

function formatSpecificationLines(value) {
  return Object.entries(value && typeof value === 'object' ? value : {}).map(([key, item]) => `${key}: ${item}`).join('\n');
}

function getFilteredProducts() {
  return adminProducts;
}

function updatePagination() {
  const first = adminTotal ? adminOffset + 1 : 0;
  const last = Math.min(adminOffset + ADMIN_PAGE_SIZE, adminTotal);
  document.querySelector('[data-admin-page-info]').textContent =
    `${first}-${last} of ${adminTotal} products`;
  document.querySelector('[data-admin-page-prev]').disabled = adminOffset === 0;
  document.querySelector('[data-admin-page-next]').disabled = adminOffset + ADMIN_PAGE_SIZE >= adminTotal;
}

function renderProductTable() {
  const tbody = document.querySelector('[data-admin-table-body]');
  const products = getFilteredProducts();

  if (!products.length) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; padding: 32px; color: var(--muted);">No products found matching filters.</td></tr>`;
    return;
  }

  tbody.innerHTML = products.map(p => {
    const isActive = p.status === 'active';
    const isFeatured = p.featured === 1 || p.featured === true;
    const isBest = p.best_value === 1 || p.best_value === true;
    const extraOffersCount = (p.offers || p.comparison || []).length;
    const fallbackImage = 'https://images.unsplash.com/photo-1524758631624-e2822e304c36?auto=format&fit=crop&w=200&q=80';

    return `
      <tr data-prod-id="${escapeHtml(p.id)}">
        <td>
          <img src="${escapeHtml(p.image)}" alt="${escapeHtml(p.name)}" class="admin-prod-thumb" onerror="this.onerror=null;this.src='${fallbackImage}';" />
        </td>
        <td>
          <strong>${escapeHtml(p.name)}</strong>
          ${p.subcategory ? `<small style="display:block; color: var(--muted); font-size: 0.76rem;">${escapeHtml(p.subcategory)}</small>` : ''}
          <small style="color: var(--muted); font-size: 0.74rem;">${escapeHtml(p.product_code || p.id)}</small>
        </td>
        <td>${escapeHtml(p.brand)}</td>
        <td><span class="product-tag" style="font-size: 0.72rem;">${escapeHtml(p.category)}</span></td>
        <td>
          <strong>${formatPrice(p.selling_price)}</strong>
          <small style="display:block; text-decoration: line-through; color: var(--muted); font-size: 0.76rem;">${formatPrice(p.mrp)}</small>
          <span style="color: var(--success); font-size: 0.74rem; font-weight: 700;">${p.discount}% OFF</span>
        </td>
        <td>
          <strong>${escapeHtml(p.marketplace)}</strong>
          ${extraOffersCount > 1 ? `<small style="display:block; color: var(--primary); font-size: 0.74rem;">+${extraOffersCount - 1} more offers</small>` : ''}
        </td>
        <td>
          <span class="admin-pill ${isActive ? 'active' : 'inactive'}">
            ${isActive ? 'Published' : 'Draft'}
          </span>
        </td>
        <td>
          <div style="display: flex; gap: 4px; flex-wrap: wrap;">
            ${isFeatured ? '<span class="admin-pill featured">★ Featured</span>' : ''}
            ${isBest ? '<span class="admin-pill best-value">👑 Best Value</span>' : ''}
          </div>
        </td>
        <td>
          <div class="admin-actions-cell">
            <button type="button" class="btn btn-secondary btn-small" data-action="edit" data-id="${escapeHtml(p.id)}" title="Edit product details">Edit</button>
            <button type="button" class="btn btn-small ${isActive ? 'btn-toggle-inactive' : 'btn-toggle-active'}" data-action="toggle-status" data-id="${escapeHtml(p.id)}" title="${isActive ? 'Unpublish product' : 'Publish product'}">
              ${isActive ? 'Unpublish' : 'Publish'}
            </button>
            <button type="button" class="btn btn-small btn-toggle-featured" data-action="toggle-featured" data-id="${escapeHtml(p.id)}" title="Toggle featured status">
              ${isFeatured ? '★ Unfeature' : '☆ Feature'}
            </button>
            <button type="button" class="btn btn-small btn-toggle-best" data-action="toggle-best" data-id="${escapeHtml(p.id)}" title="Toggle Best Value spotlight">
              ${isBest ? '👑 Remove Best' : '👑 Set Best'}
            </button>
            <button type="button" class="btn btn-danger btn-small" data-action="delete" data-id="${escapeHtml(p.id)}" title="Delete or deactivate">Delete</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

// ---------------------------------------------------------------------------
// Selling price calculation (Formula: MRP * (1 - discount / 100))
// ---------------------------------------------------------------------------

function updateDiscountCalculation() {
  const mrpInput = document.querySelector('[data-calc-mrp]');
  const priceInput = document.querySelector('[data-calc-price]');
  const discountInput = document.querySelector('[data-calc-discount]');

  const mrp = Number(mrpInput.value);
  const discount = Number(discountInput.value);

  if (mrpInput.value !== '' && discountInput.value !== '' && mrp >= 0 && discount >= 0 && discount <= 100) {
    priceInput.value = String(Math.round(mrp * (1 - discount / 100)));
  } else {
    priceInput.value = '';
  }
}

// ---------------------------------------------------------------------------
// Multiple Marketplace Offers Row Builder (Sections 10 & 11)
// ---------------------------------------------------------------------------

const MARKETPLACES = ['Amazon', 'Flipkart', 'Croma', 'Reliance Digital', 'Myntra', 'Meesho', 'Nykaa', 'Other Stores'];

function createOfferRow(offer = {}) {
  const selectedMarket = offer.marketplace || 'Flipkart';
  const price = offer.price ?? '';
  const mrp = offer.mrp ?? '';
  const disc = offer.discount ? `${offer.discount}% OFF` : '';
  const url = offer.product_url || offer.url || '';
  const affiliateUrl = offer.affiliate_url || '';
  const avail = offer.availability || 'In Stock';
  const storeName = offer.store_name || offer.storeName || '';

  return `
    <div class="admin-offer-row" data-offer-row>
      <div class="admin-offer-heading">
        <strong>Marketplace Store Offer</strong>
        <button type="button" class="btn btn-secondary btn-small" data-remove-offer>Remove</button>
      </div>
      <div class="admin-offer-fields">
        <label>Marketplace
          <input type="text" data-offer-marketplace list="admin-marketplace-options" value="${escapeHtml(selectedMarket)}" required />
        </label>
        <label>Store Name (Optional)
          <input type="text" data-offer-store-name value="${escapeHtml(storeName)}" placeholder="e.g. Official Seller" />
        </label>
        <label>Offer Price (₹) *
          <input type="number" min="0" step="1" data-offer-price value="${price}" placeholder="e.g. 2599" required />
        </label>
        <label>Offer MRP (₹)
          <input type="number" min="0" step="1" data-offer-mrp value="${mrp}" placeholder="e.g. 3999" />
        </label>
        <label>Currency
          <input type="text" maxlength="3" pattern="[A-Za-z]{3}" data-offer-currency value="${escapeHtml(offer.currency || 'INR')}" placeholder="INR" />
        </label>
        <label class="admin-full">Product Deal URL *
          <input type="url" data-offer-url value="${escapeHtml(url)}" placeholder="https://www.store.com/item" required />
        </label>
        <label class="admin-full">Affiliate URL
          <input type="url" data-offer-affiliate-url value="${escapeHtml(affiliateUrl)}" placeholder="Optional tracking-enabled URL" />
        </label>
        <label>Availability
          <input type="text" data-offer-avail value="${escapeHtml(avail)}" placeholder="In Stock" />
        </label>
      </div>
    </div>
  `;
}

function renderOffersList(offers = []) {
  const root = document.querySelector('[data-admin-offers]');
  root.innerHTML = (offers.length ? offers : []).map(createOfferRow).join('');
}

function collectOffers() {
  return Array.from(document.querySelectorAll('[data-offer-row]')).map(row => {
    const mrp = parseFloat(row.querySelector('[data-offer-mrp]').value) || 0;
    const price = parseFloat(row.querySelector('[data-offer-price]').value) || 0;
    const disc = mrp > 0 && price <= mrp ? Math.round(((mrp - price) / mrp) * 100) : 0;

    return {
      marketplace: row.querySelector('[data-offer-marketplace]').value,
      store_name: row.querySelector('[data-offer-store-name]').value.trim(),
      price: price,
      currency: (row.querySelector('[data-offer-currency]').value.trim() || 'INR').toUpperCase(),
      mrp: mrp,
      discount: disc,
      product_url: row.querySelector('[data-offer-url]').value.trim(),
      affiliate_url: row.querySelector('[data-offer-affiliate-url]').value.trim(),
      availability: row.querySelector('[data-offer-avail]').value.trim() || 'In Stock'
    };
  }).filter(o => o.product_url && o.price > 0);
}

// ---------------------------------------------------------------------------
// Image Upload & Previews
// ---------------------------------------------------------------------------

async function uploadFileToServer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const res = await adminFetch('/api/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data: reader.result })
        });
        const data = await res.json();
        if (res.ok && data.url) resolve(data.url);
        else reject(new Error(data.message || 'Upload failed'));
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function setupImageHandlers() {
  const mainFileInput = document.querySelector('[data-admin-image-file]');
  const mainUrlInput = document.querySelector('[data-admin-image-url]');
  const mainPreview = document.querySelector('[data-admin-image-preview]');
  const statusEl = document.querySelector('[data-admin-status]');

  mainFileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      statusEl.textContent = 'Choose a JPEG, PNG, or WebP image.';
      statusEl.style.color = 'var(--danger)';
      e.target.value = '';
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      statusEl.textContent = 'Image file exceeds 10 MB limit.';
      statusEl.style.color = 'var(--danger)';
      e.target.value = '';
      return;
    }
    statusEl.textContent = 'Uploading main image...';
    try {
      const url = await uploadFileToServer(file);
      selectedMainImage = url;
      mainUrlInput.value = url;
      mainPreview.src = url;
      mainPreview.hidden = false;
      statusEl.textContent = 'Main image uploaded successfully!';
      statusEl.style.color = 'var(--success)';
    } catch (err) {
      statusEl.textContent = `Upload error: ${err.message}`;
      statusEl.style.color = 'var(--danger)';
    }
  });

  mainUrlInput.addEventListener('input', () => {
    const url = mainUrlInput.value.trim();
    if (url) {
      selectedMainImage = url;
      mainPreview.src = url;
      mainPreview.hidden = false;
    } else {
      selectedMainImage = '';
      mainPreview.hidden = true;
    }
  });

  // Additional Images
  const extraFilesInput = document.querySelector('[data-admin-extra-files]');
  const extraUrlsInput = document.querySelector('[data-admin-extra-urls]');
  const extraPreviewContainer = document.querySelector('[data-admin-extra-preview]');

  extraFilesInput.addEventListener('change', async (e) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    statusEl.textContent = `Uploading ${files.length} additional image(s)...`;

    const failures = [];
    for (const file of files) {
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024) {
        failures.push(`${file.name}: use a JPEG, PNG, or WebP file smaller than 10 MB`);
        continue;
      }
      try {
        const url = await uploadFileToServer(file);
        additionalImagesList.push(url);
      } catch (err) {
        failures.push(`${file.name}: ${err.message}`);
      }
    }
    extraUrlsInput.value = additionalImagesList.join(', ');
    renderExtraPreviews();
    statusEl.textContent = failures.length
      ? `Some images could not be uploaded: ${failures.join('; ')}`
      : 'Additional images uploaded!';
    statusEl.style.color = failures.length ? 'var(--danger)' : 'var(--success)';
  });

  extraUrlsInput.addEventListener('input', () => {
    const urls = extraUrlsInput.value.split(',').map(s => s.trim()).filter(Boolean);
    additionalImagesList = urls;
    renderExtraPreviews();
  });
}

function renderExtraPreviews() {
  const container = document.querySelector('[data-admin-extra-preview]');
  container.innerHTML = additionalImagesList.map(url => `
    <img src="${escapeHtml(url)}" class="admin-gallery-thumb" alt="Additional preview" onerror="this.style.display='none';" />
  `).join('');
}

// ---------------------------------------------------------------------------
// Form Population & Editing
// ---------------------------------------------------------------------------

function populateFormForEdit(product) {
  editingProductId = product.id;
  const form = document.querySelector('[data-admin-form]');

  form.elements.id.value = product.id || '';
  form.elements.id.readOnly = true;
  form.elements.name.value = product.name || '';
  form.elements.brand.value = product.brand || '';
  form.elements.category.value = product.category || '';
  form.elements.subcategory.value = product.subcategory || '';
  form.elements.marketplace.value = product.marketplace || 'Amazon';
  form.elements.mrp.value = product.mrp || '';
  form.elements.selling_price.value = product.selling_price || '';
  form.elements.currency.value = product.currency || 'INR';
  form.elements.discount.value = product.discount ?? 0;
  form.elements.product_url.value = product.product_url || '';
  const primaryOffer = (product.offers || []).find((offer) =>
    (offer.marketplace || '').toLowerCase() === (product.marketplace || '').toLowerCase()
  );
  form.elements.affiliate_url.value = primaryOffer?.affiliate_url || '';
  form.elements.imageUrl.value = product.image || '';
  form.elements.description.value = product.description || '';
  form.elements.short_description.value = product.short_description || '';
  form.elements.detailed_description.value = product.detailed_description || product.description || '';
  form.elements.model_number.value = product.model_number || '';
  form.elements.manufacturer.value = product.manufacturer || '';
  form.elements.color.value = product.color || '';
  form.elements.size.value = product.size || '';
  form.elements.material.value = product.material || '';
  form.elements.weight.value = product.weight || '';
  form.elements.dimensions.value = product.dimensions || '';
  form.elements.country_of_origin.value = product.country_of_origin || '';
  form.elements.key_features.value = Array.isArray(product.key_features) ? product.key_features.join('\n') : '';
  form.elements.specifications.value = formatSpecificationLines(product.specifications);
  form.elements.product_video_url.value = product.product_video_url || '';
  form.elements.warranty_info.value = product.warranty_info || '';
  form.elements.rating.value = product.rating ?? 4.5;
  form.elements.review_count.value = product.review_count ?? 1250;
  form.elements.availability.value = product.availability || 'In Stock';
  form.elements.stock_status.value = product.stock_status || 'in_stock';
  form.elements.status.value = product.status || 'active';
  form.elements.featured.checked = product.featured === 1 || product.featured === true;
  form.elements.best_value.checked = product.best_value === 1 || product.best_value === true;

  selectedMainImage = product.image || '';
  const mainPreview = document.querySelector('[data-admin-image-preview]');
  if (selectedMainImage) {
    mainPreview.src = selectedMainImage;
    mainPreview.hidden = false;
  } else {
    mainPreview.hidden = true;
  }

  additionalImagesList = Array.isArray(product.additional_images) ? product.additional_images : [];
  form.elements.additionalImagesUrls.value = additionalImagesList.join(', ');
  renderExtraPreviews();

  updateDiscountCalculation();

  // Offers (exclude primary if duplicated)
  const offers = (product.offers || product.comparison || []).filter(o => (o.marketplace || '').toLowerCase() !== (product.marketplace || '').toLowerCase());
  renderOffersList(offers);

  document.querySelector('[data-admin-form-title]').textContent = `Edit Product: ${product.name}`;
  document.querySelector('[data-admin-submit]').textContent = 'Update Product';
  document.querySelector('[data-admin-cancel-edit]').hidden = false;

  document.getElementById('product-form-panel').scrollIntoView({ behavior: 'smooth' });
}

function resetProductForm() {
  editingProductId = null;
  selectedMainImage = '';
  additionalImagesList = [];

  const form = document.querySelector('[data-admin-form]');
  form.reset();
  form.elements.id.readOnly = false;
  form.elements.discount.value = '';
  form.elements.status.value = 'inactive';
  document.querySelector('[data-admin-image-preview]').hidden = true;
  document.querySelector('[data-admin-extra-preview]').innerHTML = '';
  renderOffersList([]);

  document.querySelector('[data-admin-form-title]').textContent = 'Add New Product';
  document.querySelector('[data-admin-submit]').textContent = 'Save Product';
  document.querySelector('[data-admin-cancel-edit]').hidden = true;
  document.querySelector('[data-admin-status]').textContent = '';
}

// ---------------------------------------------------------------------------
// Form Submit Handler (Add / Edit)
// ---------------------------------------------------------------------------

async function handleProductSubmit(event) {
  event.preventDefault();
  const form = event.target;
  const statusEl = document.querySelector('[data-admin-status]');
  statusEl.textContent = 'Saving product...';
  statusEl.style.color = 'var(--muted)';

  const name = form.elements.name.value.trim();
  const brand = form.elements.brand.value.trim();
  const category = form.elements.category.value.trim();
  const subcategory = form.elements.subcategory.value.trim();
  const marketplace = form.elements.marketplace.value.trim();
  const mrp = parseFloat(form.elements.mrp.value);
  const selling_price = parseFloat(form.elements.selling_price.value);
  const product_url = form.elements.product_url.value.trim();
  const imageUrl = form.elements.imageUrl.value.trim() || selectedMainImage;
  const description = form.elements.description.value.trim();
  const rating = parseFloat(form.elements.rating.value) || 4.5;
  const review_count = parseInt(form.elements.review_count.value) || 0;
  const availability = form.elements.availability.value.trim() || 'In Stock';
  const stock_status = form.elements.stock_status.value;
  const featured = form.elements.featured.checked ? 1 : 0;
  const best_value = form.elements.best_value.checked ? 1 : 0;
  const id = form.elements.id.value.trim();

  // Validation
  const status = form.elements.status.value;
  if (!name || !brand || !category || !description || !marketplace || !product_url || (status === 'active' && !imageUrl)) {
    statusEl.textContent = 'Please fill out all required fields marked with *.';
    statusEl.style.color = 'var(--danger)';
    return;
  }

  const discount = parseFloat(form.elements.discount.value);
  if (isNaN(mrp) || mrp < 0 || isNaN(discount) || discount < 0 || discount > 100 || isNaN(selling_price) || selling_price < 0) {
    statusEl.textContent = 'Enter a valid MRP and a discount from 0% to 100%.';
    statusEl.style.color = 'var(--danger)';
    return;
  }

  const extraOffers = collectOffers();

  const payload = {
    id: id || undefined,
    name,
    brand,
    category,
    subcategory,
    marketplace,
    mrp,
    selling_price,
    currency: (form.elements.currency.value.trim() || 'INR').toUpperCase(),
    product_url,
    affiliate_url: form.elements.affiliate_url.value.trim(),
    image: imageUrl,
    additional_images: additionalImagesList,
    description,
    short_description: form.elements.short_description.value.trim(),
    detailed_description: form.elements.detailed_description.value.trim() || description,
    key_features: parseLineList(form.elements.key_features.value),
    specifications: parseSpecificationLines(form.elements.specifications.value),
    model_number: form.elements.model_number.value.trim(),
    variants: parseLineList(form.elements.size.value),
    color: form.elements.color.value.trim(),
    size: form.elements.size.value.trim(),
    material: form.elements.material.value.trim(),
    weight: form.elements.weight.value.trim(),
    dimensions: form.elements.dimensions.value.trim(),
    manufacturer: form.elements.manufacturer.value.trim(),
    country_of_origin: form.elements.country_of_origin.value.trim(),
    product_video_url: form.elements.product_video_url.value.trim(),
    warranty_info: form.elements.warranty_info.value.trim(),
    rating,
    review_count,
    availability,
    stock_status,
    status,
    featured,
    best_value,
    offers: extraOffers
  };

  try {
    let res;
    if (editingProductId) {
      res = await adminFetch(`/api/products/${encodeURIComponent(editingProductId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } else {
      res = await adminFetch('/api/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    }

    const data = await res.json();
    if (res.ok && (data.success || data.id)) {
      statusEl.textContent = editingProductId ? 'Product updated successfully!' : 'Product added successfully!';
      statusEl.style.color = 'var(--success)';
      resetProductForm();
      await loadProducts(true);
    } else {
      statusEl.textContent = data.message || 'Error saving product.';
      statusEl.style.color = 'var(--danger)';
    }
  } catch (err) {
    statusEl.textContent = `Server error: ${err.message}`;
    statusEl.style.color = 'var(--danger)';
  }
}

// ---------------------------------------------------------------------------
// Quick Actions (Toggle Status, Featured, Best Value, Delete)
// ---------------------------------------------------------------------------

async function handleTableActions(event) {
  const btn = event.target.closest('button[data-action]');
  if (!btn) return;

  const action = btn.dataset.action;
  const productId = btn.dataset.id;
  const product = adminProducts.find(p => p.id === productId);
  const statusEl = document.querySelector('[data-admin-status]');

  if (action === 'edit' && product) {
    populateFormForEdit(product);
  } else if (action === 'toggle-status') {
    try {
      const res = await adminFetch(`/api/products/${encodeURIComponent(productId)}/status`, { method: 'PATCH' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Unable to update publication status.');
      statusEl.textContent = data.value === 'active' ? 'Product published.' : 'Product saved as a draft.';
      statusEl.style.color = 'var(--success)';
      await loadProducts();
    } catch (error) {
      statusEl.textContent = error.message;
      statusEl.style.color = 'var(--danger)';
    }
  } else if (action === 'toggle-featured') {
    try {
      const res = await adminFetch(`/api/products/${encodeURIComponent(productId)}/featured`, { method: 'PATCH' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Unable to update featured status.');
      await loadProducts();
    } catch (error) {
      statusEl.textContent = error.message;
      statusEl.style.color = 'var(--danger)';
    }
  } else if (action === 'toggle-best') {
    try {
      const res = await adminFetch(`/api/products/${encodeURIComponent(productId)}/best-value`, { method: 'PATCH' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Unable to update best-value status.');
      await loadProducts();
    } catch (error) {
      statusEl.textContent = error.message;
      statusEl.style.color = 'var(--danger)';
    }
  } else if (action === 'delete') {
    openDeleteModal(productId, product ? product.name : 'this product');
  }
}

function openDeleteModal(productId, productName) {
  pendingDeleteProductId = productId;
  const modal = document.querySelector('[data-admin-delete-modal]');
  document.querySelector('[data-delete-modal-text]').textContent = `Do you want to soft-deactivate "${productName}" or permanently delete it from the database?`;
  modal.hidden = false;
  modal.style.display = 'grid';
}

function closeDeleteModal() {
  pendingDeleteProductId = null;
  const modal = document.querySelector('[data-admin-delete-modal]');
  if (modal) {
    modal.hidden = true;
    modal.style.display = 'none';
  }
}

async function performDelete(permanent = false) {
  if (!pendingDeleteProductId) return;
  const id = pendingDeleteProductId;
  closeDeleteModal();

  try {
    const res = await adminFetch(`/api/products/${encodeURIComponent(id)}?permanent=${permanent ? 'true' : 'false'}`, {
      method: 'DELETE'
    });
    if (res.ok) {
      await loadProducts();
      if (editingProductId === id) resetProductForm();
    } else {
      const data = await res.json();
      throw new Error(data.message || 'Unable to delete this product.');
    }
  } catch (err) {
    const statusEl = document.querySelector('[data-admin-status]');
    statusEl.textContent = `Error deleting product: ${err.message}`;
    statusEl.style.color = 'var(--danger)';
  }
}

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', () => {
  // Check session status on page load
  checkAdminSession();

  // Login form
  document.querySelector('[data-admin-login-form]').addEventListener('submit', handleAdminLogin);

  // Logout button
  document.querySelector('[data-admin-logout-btn]').addEventListener('click', handleAdminLogout);
  document.querySelector('[data-admin-add-product]').addEventListener('click', () => {
    resetProductForm();
    document.getElementById('product-form-panel').scrollIntoView({ behavior: 'smooth' });
    document.querySelector('[data-admin-form] [name="name"]').focus({ preventScroll: true });
  });

  document.querySelector('[data-import-fetch]').addEventListener('click', handleImportFetch);
  document.querySelector('[data-import-url]').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      handleImportFetch();
    }
  });

  // Discount calculation listeners
  document.querySelector('[data-calc-mrp]').addEventListener('input', updateDiscountCalculation);
  document.querySelector('[data-calc-discount]').addEventListener('input', updateDiscountCalculation);

  // Add offer row button
  document.querySelector('[data-add-offer]').addEventListener('click', () => {
    document.querySelector('[data-admin-offers]').insertAdjacentHTML('beforeend', createOfferRow());
  });

  // Remove offer row button
  document.querySelector('[data-admin-offers]').addEventListener('click', (e) => {
    if (e.target.matches('[data-remove-offer]')) {
      e.target.closest('[data-offer-row]').remove();
    }
  });

  // Image upload handlers
  setupImageHandlers();

  // Product form submit
  document.querySelector('[data-admin-form]').addEventListener('submit', handleProductSubmit);

  // Form Reset / Cancel Edit
  document.querySelector('[data-admin-reset]').addEventListener('click', resetProductForm);
  document.querySelector('[data-admin-cancel-edit]').addEventListener('click', resetProductForm);

  // Table action clicks (edit, toggles, delete)
  document.querySelector('[data-admin-table-body]').addEventListener('click', handleTableActions);

  // Filters and search
  let searchTimer;
  document.querySelector('[data-admin-search]').addEventListener('input', () => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => loadProducts(true), 250);
  });
  document.querySelector('[data-admin-filter-status]').addEventListener('change', () => loadProducts(true));
  document.querySelector('[data-admin-filter-category]').addEventListener('change', () => loadProducts(true));
  document.querySelector('[data-admin-filter-market]').addEventListener('change', () => loadProducts(true));
  document.querySelector('[data-admin-sort]').addEventListener('change', () => loadProducts(true));
  document.querySelector('[data-admin-page-prev]').addEventListener('click', () => {
    adminOffset = Math.max(0, adminOffset - ADMIN_PAGE_SIZE);
    loadProducts();
  });
  document.querySelector('[data-admin-page-next]').addEventListener('click', () => {
    adminOffset += ADMIN_PAGE_SIZE;
    loadProducts();
  });

  // Delete modal buttons
  document.querySelector('[data-delete-cancel]').addEventListener('click', closeDeleteModal);
  document.querySelector('[data-delete-soft]').addEventListener('click', () => performDelete(false));
  document.querySelector('[data-delete-permanent]').addEventListener('click', () => performDelete(true));
});
