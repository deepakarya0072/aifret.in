/**
 * AIFRET - Admin Product Management System
 * Connects to REST API endpoints for secure database-backed catalog control.
 */

let adminProducts = [];
let editingProductId = null;
let selectedMainImage = '';
let additionalImagesList = [];
let pendingDeleteProductId = null;
const PRODUCTS_STORAGE_KEY = 'aifret.products.v1';

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

// ---------------------------------------------------------------------------
// Authentication & Session
// ---------------------------------------------------------------------------

async function checkAdminSession() {
  try {
    const res = await fetch('/api/admin/session');
    if (res.ok) {
      const data = await res.json();
      showDashboard(data.user?.username || 'Admin');
    } else {
      showLogin();
    }
  } catch (err) {
    showLogin();
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
    const res = await fetch('/api/admin/login', {
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
    statusEl.textContent = 'Server connection error. Ensure server.py is running.';
    statusEl.style.color = 'var(--danger)';
  }
}

async function handleAdminLogout() {
  try {
    await fetch('/api/admin/logout', { method: 'POST' });
  } catch (e) {}
  showLogin();
}

// ---------------------------------------------------------------------------
// Product Data Loading & Filtering
// ---------------------------------------------------------------------------

async function loadProducts() {
  const tbody = document.querySelector('[data-admin-table-body]');
  try {
    const res = await fetch('/api/products?status=all&limit=500');
    if (!res.ok) throw new Error('Failed to load products');
    const data = await res.json();
    adminProducts = data.products || [];
    try {
      window.localStorage.setItem(PRODUCTS_STORAGE_KEY, JSON.stringify(
        adminProducts.filter((product) => product.status === 'active')
      ));
    } catch (error) {}
    updateStats();
    populateFilterDropdowns();
    renderProductTable();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; color: var(--danger); padding: 24px;">Failed to load products from database: ${err.message}</td></tr>`;
  }
}

function updateStats() {
  const total = adminProducts.length;
  const active = adminProducts.filter(p => p.status === 'active').length;
  const inactive = adminProducts.filter(p => p.status === 'inactive').length;
  const featured = adminProducts.filter(p => p.featured === 1 || p.featured === true).length;
  const best = adminProducts.filter(p => p.best_value === 1 || p.best_value === true).length;

  document.querySelector('[data-stat-total]').textContent = total;
  document.querySelector('[data-stat-active]').textContent = active;
  document.querySelector('[data-stat-inactive]').textContent = inactive;
  document.querySelector('[data-stat-featured]').textContent = featured;
  document.querySelector('[data-stat-best]').textContent = best;
}

function populateFilterDropdowns() {
  const categorySelect = document.querySelector('[data-admin-filter-category]');
  const marketSelect = document.querySelector('[data-admin-filter-market]');

  const currentCat = categorySelect.value;
  const currentMkt = marketSelect.value;

  const categories = Array.from(new Set(adminProducts.map(p => p.category).filter(Boolean))).sort();
  categorySelect.innerHTML = '<option value="all">All Categories</option>' +
    categories.map(c => `<option value="${escapeHtml(c)}" ${c === currentCat ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('');

  const markets = Array.from(new Set(adminProducts.map(p => p.marketplace).filter(Boolean))).sort();
  marketSelect.innerHTML = '<option value="all">All Marketplaces</option>' +
    markets.map(m => `<option value="${escapeHtml(m)}" ${m === currentMkt ? 'selected' : ''}>${escapeHtml(m)}</option>`).join('');
}

function getFilteredProducts() {
  const searchVal = (document.querySelector('[data-admin-search]').value || '').toLowerCase().trim();
  const statusVal = document.querySelector('[data-admin-filter-status]').value;
  const catVal = document.querySelector('[data-admin-filter-category]').value;
  const mktVal = document.querySelector('[data-admin-filter-market]').value;
  const sortVal = document.querySelector('[data-admin-sort]').value;

  let list = adminProducts.filter(p => {
    if (statusVal === 'active' && p.status !== 'active') return false;
    if (statusVal === 'inactive' && p.status !== 'inactive') return false;
    if (catVal !== 'all' && (p.category || '').toLowerCase() !== catVal.toLowerCase()) return false;
    if (mktVal !== 'all' && (p.marketplace || '').toLowerCase() !== mktVal.toLowerCase()) return false;

    if (searchVal) {
      const matchText = `${p.name} ${p.brand} ${p.category} ${p.subcategory || ''} ${p.marketplace}`.toLowerCase();
      if (!matchText.includes(searchVal)) return false;
    }
    return true;
  });

  list.sort((a, b) => {
    if (sortVal === 'name') return (a.name || '').localeCompare(b.name || '');
    if (sortVal === 'price-asc') return (a.selling_price || 0) - (b.selling_price || 0);
    if (sortVal === 'price-desc') return (b.selling_price || 0) - (a.selling_price || 0);
    if (sortVal === 'discount') return (b.discount || 0) - (a.discount || 0);
    if (sortVal === 'rating') return (b.rating || 0) - (a.rating || 0);
    // newest default
    return new Date(b.created_at || 0) - new Date(a.created_at || 0);
  });

  return list;
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
          <small style="color: var(--muted); font-size: 0.74rem;">ID: ${escapeHtml(p.id)}</small>
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
            ${isActive ? 'Active' : 'Inactive'}
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
            <button type="button" class="btn btn-small ${isActive ? 'btn-toggle-inactive' : 'btn-toggle-active'}" data-action="toggle-status" data-id="${escapeHtml(p.id)}" title="${isActive ? 'Deactivate product' : 'Activate product'}">
              ${isActive ? 'Deactivate' : 'Activate'}
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
          <select data-offer-marketplace>
            ${MARKETPLACES.map(m => `<option value="${m}" ${m === selectedMarket ? 'selected' : ''}>${m}</option>`).join('')}
          </select>
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
        <label class="admin-full">Product Deal URL *
          <input type="url" data-offer-url value="${escapeHtml(url)}" placeholder="https://www.store.com/item" required />
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
      mrp: mrp,
      discount: disc,
      product_url: row.querySelector('[data-offer-url]').value.trim(),
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
        const res = await fetch('/api/upload', {
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

    for (const file of files) {
      try {
        const url = await uploadFileToServer(file);
        additionalImagesList.push(url);
      } catch (err) {
        console.error('Error uploading extra image:', err);
      }
    }
    extraUrlsInput.value = additionalImagesList.join(', ');
    renderExtraPreviews();
    statusEl.textContent = 'Additional images uploaded!';
    statusEl.style.color = 'var(--success)';
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
  form.elements.discount.value = product.discount ?? 0;
  form.elements.product_url.value = product.product_url || '';
  form.elements.imageUrl.value = product.image || '';
  form.elements.description.value = product.description || '';
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
  const offers = (product.offers || product.comparison || []).filter(o => o.marketplace.toLowerCase() !== (product.marketplace || '').toLowerCase());
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
  const status = form.elements.status.value;
  const featured = form.elements.featured.checked ? 1 : 0;
  const best_value = form.elements.best_value.checked ? 1 : 0;
  const id = form.elements.id.value.trim();

  // Validation
  if (!name || !category || !marketplace || !product_url || !imageUrl || !description) {
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
    product_url,
    image: imageUrl,
    additional_images: additionalImagesList,
    description,
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
      res = await fetch(`/api/products/${encodeURIComponent(editingProductId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } else {
      res = await fetch('/api/products', {
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
      await loadProducts();
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

  if (action === 'edit' && product) {
    populateFormForEdit(product);
  } else if (action === 'toggle-status') {
    try {
      const res = await fetch(`/api/products/${encodeURIComponent(productId)}/status`, { method: 'PATCH' });
      if (res.ok) await loadProducts();
    } catch (e) {
      console.error(e);
    }
  } else if (action === 'toggle-featured') {
    try {
      const res = await fetch(`/api/products/${encodeURIComponent(productId)}/featured`, { method: 'PATCH' });
      if (res.ok) await loadProducts();
    } catch (e) {
      console.error(e);
    }
  } else if (action === 'toggle-best') {
    try {
      const res = await fetch(`/api/products/${encodeURIComponent(productId)}/best-value`, { method: 'PATCH' });
      if (res.ok) await loadProducts();
    } catch (e) {
      console.error(e);
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
    const res = await fetch(`/api/products/${encodeURIComponent(id)}?permanent=${permanent ? 'true' : 'false'}`, {
      method: 'DELETE'
    });
    if (res.ok) {
      await loadProducts();
      if (editingProductId === id) resetProductForm();
    }
  } catch (err) {
    alert(`Error deleting product: ${err.message}`);
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
  document.querySelector('[data-admin-search]').addEventListener('input', renderProductTable);
  document.querySelector('[data-admin-filter-status]').addEventListener('change', renderProductTable);
  document.querySelector('[data-admin-filter-category]').addEventListener('change', renderProductTable);
  document.querySelector('[data-admin-filter-market]').addEventListener('change', renderProductTable);
  document.querySelector('[data-admin-sort]').addEventListener('change', renderProductTable);

  // Delete modal buttons
  document.querySelector('[data-delete-cancel]').addEventListener('click', closeDeleteModal);
  document.querySelector('[data-delete-soft]').addEventListener('click', () => performDelete(false));
  document.querySelector('[data-delete-permanent]').addEventListener('click', () => performDelete(true));
});
