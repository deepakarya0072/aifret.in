const config = window.AIFRET_CONFIG || {
  siteName: 'AIFRET',
  categories: [],
  marketplaces: [],
  products: []
};

const currency = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0
});

const PRODUCTS_STORAGE_KEY = 'aifret.products.v1';
let liveProducts = [];
let apiLoaded = false;

function getProducts() {
  if (apiLoaded) {
    return liveProducts;
  }
  try {
    const storedProducts = JSON.parse(window.localStorage.getItem(PRODUCTS_STORAGE_KEY) || 'null');
    if (Array.isArray(storedProducts) && storedProducts.length > 0) {
      return storedProducts;
    }
    return config.products;
  } catch (error) {
    return config.products;
  }
}

async function fetchProductsFromApi() {
  try {
    const res = await fetch('/api/products?status=active&limit=500');
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.products)) {
        liveProducts = data.products;
        apiLoaded = true;
        try {
          window.localStorage.setItem(PRODUCTS_STORAGE_KEY, JSON.stringify(liveProducts));
        } catch (e) { }
        // Refresh dynamic UI with database products
        renderHeroShowcase();
        renderCategoryCards();
        renderMarketplaceCards();
        renderFeaturedProducts();
        renderDealsCards();
        renderHomeComparison();
        renderProductDetail();
        renderDealsPage();
        renderComparePage();
      }
    }
  } catch (err) {
    console.warn('API unreachable, using cached/demo catalog.', err);
  }
}

function formatPrice(value) {
  return currency.format(Number(value) || 0);
}

function getQueryParam(name) {
  const params = new URLSearchParams(window.location.search);
  return params.get(name);
}

function isValidAffiliateUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch (error) {
    return false;
  }
}

function isValidMediaUrl(value) {
  return /^https?:\/\//i.test(value || '');
}

function supportsPhotoPreview(product) {
  return ['fashion', 'shoes', 'beauty', 'watches', 'jewellery', 'accessories'].includes((product.slug || product.category || '').toLowerCase());
}

function getCustomerLoginUrl(returnTo) {
  return `login.html?returnTo=${encodeURIComponent(returnTo)}`;
}

async function requireCustomerSession(actionUrl) {
  try {
    await window.AIFRET_AUTH.session();
    return true;
  } catch (error) {
    window.location.href = getCustomerLoginUrl(actionUrl);
    return false;
  }
}

function normalizeProduct(product) {
  const offers = product.offers || product.comparison || [];
  const primaryOffer = offers[0] || {};
  const defaultUrl = product.product_url || product.url || `product.html?id=${product.id}`;

  const normOffers = (offers.length ? offers : [{
    marketplace: product.marketplace || 'Amazon',
    price: product.selling_price ?? product.price,
    mrp: product.mrp ?? product.originalPrice,
    discount: product.discount,
    product_url: defaultUrl,
    availability: product.availability || 'In Stock'
  }]).map((entry) => {
    const marketName = entry.marketplace || 'Amazon';
    const marketSlug = entry.marketplace_slug || entry.marketplaceSlug || marketName.toLowerCase().replace(/\s+/g, '-');
    const offerUrl = entry.product_url || entry.url || defaultUrl;

    return {
      ...entry,
      marketplaceSlug: marketSlug,
      marketplace: entry.store_name || entry.storeName || marketName,
      price: Number(entry.price) || Number(product.selling_price ?? product.price),
      originalPrice: Number(entry.mrp ?? entry.originalPrice ?? product.mrp ?? product.originalPrice),
      discount: Number(entry.discount ?? product.discount),
      url: offerUrl,
      buyUrl: isValidAffiliateUrl(entry.affiliate_url || entry.affiliateUrl) ? (entry.affiliate_url || entry.affiliateUrl) : '',
      affiliateConfigured: isValidAffiliateUrl(entry.affiliate_url || entry.affiliateUrl),
      availability: entry.availability || 'In Stock'
    };
  });

  // Ensure category slug
  const catSlug = (product.category || 'electronics').toLowerCase().replace(/\s+/g, '-');

  return {
    ...product,
    id: product.id,
    name: product.name,
    brand: product.brand || '',
    category: product.category || 'General',
    subcategory: product.subcategory || '',
    slug: product.slug || catSlug,
    description: product.description || '',
    image: product.image || product.productImage || '',
    additional_images: Array.isArray(product.additional_images) ? product.additional_images : [],
    productImage: product.image || product.productImage || '',
    price: Number(product.selling_price ?? product.price),
    selling_price: Number(product.selling_price ?? product.price),
    originalPrice: Number(product.mrp ?? product.originalPrice),
    mrp: Number(product.mrp ?? product.originalPrice),
    currentPrice: Number(product.selling_price ?? product.price),
    oldPrice: Number(product.mrp ?? product.originalPrice),
    discount: Number(product.discount || 0),
    rating: Number(product.rating || 4.5),
    reviews: Number(product.review_count || product.reviews || 0),
    review_count: Number(product.review_count || product.reviews || 0),
    availability: product.availability || 'In Stock',
    stock_status: product.stock_status || 'in_stock',
    product_url: defaultUrl,
    productUrl: defaultUrl,
    marketplace: product.marketplace || primaryOffer.marketplace || 'Amazon',
    comparison: normOffers,
    offers: normOffers
  };
}

function getBestOffer(product) {
  const normalized = normalizeProduct(product);
  const sorted = [...normalized.comparison].sort((a, b) => a.price - b.price);
  return sorted[0] || {
    marketplace: normalized.marketplace || 'Amazon',
    marketplaceSlug: (normalized.marketplace || 'amazon').toLowerCase().replace(/\s+/g, '-'),
    price: normalized.price,
    discount: normalized.discount,
    url: normalized.product_url || '#',
    buyUrl: ''
  };
}

function getProductSearchText(product) {
  const comparisonText = (product.comparison || []).map((entry) => `${entry.marketplace} ${entry.store_name || ''}`).join(' ');
  return `${product.name} ${product.brand} ${product.category} ${product.subcategory || ''} ${product.marketplace || ''} ${comparisonText}`.toLowerCase();
}

// ---------------------------------------------------------------------------
// Homepage Hero "Best Value" Showcase (Dynamically loaded from Database)
// ---------------------------------------------------------------------------

function renderHeroShowcase() {
  const root = document.querySelector('[data-hero-showcase]');
  if (!root) return;

  const products = getProducts().filter((p) => p.status !== 'inactive');
  if (!products.length) return;

  // Best Value product from DB (where best_value = 1 or top discount)
  const bestProduct = products.find((p) => p.best_value === 1 || p.best_value === true) || products[0];
  const normalized = normalizeProduct(bestProduct);
  const bestOffer = getBestOffer(normalized);
  const fallbackImg = 'https://images.unsplash.com/photo-1546435770-a3e426bf472b?auto=format&fit=crop&w=900&q=80';
  const dealUrl = bestOffer.url || normalized.product_url || `product.html?id=${normalized.id}`;

  // Mini stack items from other active products
  const miniStack = products.filter((p) => p.id !== bestProduct.id).slice(0, 2);

  root.innerHTML = `
    <article class="showcase-card large">
      <div class="showcase-header">
        <span class="pill success">Best value</span>
        <button class="mini-wishlist" type="button" data-customer-wishlist data-product-id="${normalized.id}" aria-label="Save to wishlist">♡</button>
      </div>
      <div class="showcase-product-image">
        <a href="product.html?id=${normalized.id}">
          <img src="${normalized.image}" alt="${normalized.name}" onerror="this.onerror=null;this.src='${fallbackImg}';" />
        </a>
      </div>
      <div class="showcase-product-meta">
        <div>
          <a href="product.html?id=${normalized.id}" style="color: inherit;"><p style="font-weight: 700; margin: 0 0 4px;">${normalized.name}</p></a>
          <strong>${formatPrice(bestOffer.price)}</strong>
          <small style="display:block; text-decoration: line-through; color: var(--muted); font-size: 0.78rem;">MRP ${formatPrice(normalized.originalPrice)}</small>
        </div>
        <div style="text-align: right;">
          <span class="discount-badge" style="font-size: 0.88rem;">${normalized.discount}% OFF</span>
          <div style="margin-top: 8px;">
            <a href="${dealUrl}" class="btn btn-primary btn-small" target="_blank" rel="noopener noreferrer">View Deal</a>
          </div>
        </div>
      </div>
    </article>

    <div class="showcase-mini-stack">
      ${miniStack.map((item, idx) => {
    const itemNorm = normalizeProduct(item);
    const itemBest = getBestOffer(itemNorm);
    return `
          <article class="showcase-card mini ${idx === 1 ? 'alt' : ''}">
            <a href="product.html?id=${itemNorm.id}" style="text-decoration: none; color: inherit;">
              <span class="mini-label">${itemNorm.category}</span>
              <strong>${formatPrice(itemBest.price)}</strong>
              <small>${itemNorm.name}</small>
            </a>
          </article>
        `;
  }).join('')}
    </div>
  `;
}

function renderCategoryCards() {
  const root = document.querySelector('[data-category-grid]');
  if (!root) return;

  // Use dynamic categories from database products if available, fallback to config
  const products = getProducts().filter((p) => p.status !== 'inactive');
  const catNames = Array.from(new Set(products.map((p) => p.category).filter(Boolean)));

  const iconMap = {
    'electronics': '📱',
    'mobiles': '📲',
    'laptops': '💻',
    'fashion': '👕',
    'shoes': '👟',
    'beauty': '💄',
    'home-kitchen': '🏠',
    'home & kitchen': '🏠',
    'watches': '⌚',
    'earbuds': '🎧'
  };

  const categories = catNames.length > 0
    ? catNames.map((name) => {
      const slug = name.toLowerCase().replace(/\s+/g, '-');
      const icon = iconMap[slug] || iconMap[name.toLowerCase()] || '🏷️';
      return { name, slug, icon };
    })
    : config.categories;

  root.innerHTML = categories.map((category) => `
    <a href="deals.html?category=${encodeURIComponent(category.slug)}" class="category-card" aria-label="Browse ${category.name}">
      <div class="category-icon">${category.icon}</div>
      <div>
        <h3>${category.name}</h3>
        <small>Shop now</small>
      </div>
    </a>
  `).join('');
}

function renderMarketplaceCards() {
  const root = document.querySelector('[data-market-grid]');
  if (!root) return;

  // Extract distinct marketplaces actually in the database
  const products = getProducts().filter((p) => p.status !== 'inactive');
  const marketNames = new Set();
  products.forEach((p) => {
    if (p.marketplace) marketNames.add(p.marketplace);
    (p.comparison || p.offers || []).forEach((o) => {
      if (o.marketplace) marketNames.add(o.marketplace);
    });
  });

  const colorMap = {
    amazon: '#ffb800',
    flipkart: '#1676ff',
    meesho: '#f15a7d',
    myntra: '#ff5b8a',
    croma: '#0ea5a4',
    nykaa: '#fc2779',
    'reliance-digital': '#e53935',
    'other-stores': '#6f7c96'
  };

  const markets = Array.from(marketNames).map((name) => {
    const slug = name.toLowerCase().replace(/\s+/g, '-');
    return {
      name,
      slug,
      color: colorMap[slug] || '#2457ff'
    };
  });

  const displayMarkets = markets.length > 0 ? markets : config.marketplaces;

  root.innerHTML = displayMarkets.map((market) => `
    <article class="market-card">
      <div class="market-logo" style="background: ${market.color};">${market.name.slice(0, 2).toUpperCase()}</div>
      <div class="market-card-body">
        <h3>${market.name}</h3>
        <p>Trusted deals and shopping picks</p>
        <a href="deals.html?marketplace=${encodeURIComponent(market.slug)}" class="btn btn-secondary btn-small">Browse Deals</a>
      </div>
    </article>
  `).join('');
}

function renderProductCard(product, mode = 'featured') {
  const bestOffer = getBestOffer(product);
  const isCompact = mode === 'compact';
  const hasProductVideo = product.videoStatus === 'ready' && isValidMediaUrl(product.productVideoUrl);
  const fallbackImage = 'https://images.unsplash.com/photo-1524758631624-e2822e304c36?auto=format&fit=crop&w=900&q=80';
  const dealUrl = bestOffer.url || product.product_url || `product.html?id=${product.id}`;

  return `
    <article class="${isCompact ? 'deal-card' : 'product-card'}">
      <div class="${isCompact ? 'deal-thumb' : 'product-image'}">
        <a href="product.html?id=${product.id}">
          <img src="${product.image}" alt="${product.name}" loading="lazy" onerror="this.onerror=null;this.src='${fallbackImage}';" />
        </a>
      </div>
      <div class="card-body">
        <div class="card-top-line">
          <span class="product-tag">${product.category}</span>
          <div class="card-indicators">
            ${product.best_value === 1 ? '<span class="pill success" style="font-size: 0.68rem; padding: 2px 6px;">Best Value</span>' : ''}
            ${hasProductVideo ? '<span class="ai-video-badge">▶ AI Video</span>' : ''}
            <button class="mini-wishlist" type="button" data-customer-wishlist data-product-id="${product.id}" aria-label="Add ${product.name} to wishlist">♡</button>
          </div>
        </div>

        <h3><a href="product.html?id=${product.id}" style="color: inherit;">${product.name}</a></h3>
        <div class="product-meta">
          <span>${product.brand}</span>
          <span>⭐ ${product.rating || '4.5'}</span>
        </div>

        <div class="deal-market">Available on <a href="deals.html?marketplace=${encodeURIComponent(bestOffer.marketplaceSlug)}">${bestOffer.marketplace}</a></div>

        <div class="price-row">
          <strong>${formatPrice(bestOffer.price)}</strong>
          <span>${formatPrice(product.originalPrice || product.mrp)}</span>
        </div>

        <div class="discount-line">
          <span class="discount-badge">-${product.discount}%</span>
          <small>Best price from ${bestOffer.marketplace}</small>
        </div>

        <div class="card-actions" style="display: flex; gap: 8px;">
          <a href="${dealUrl}" class="btn btn-primary" target="_blank" rel="noopener noreferrer" style="flex: 1;">View Deal</a>
          <a href="product.html?id=${product.id}" class="btn btn-secondary btn-small" title="Compare Prices across stores">Compare</a>
        </div>
      </div>
    </article>
  `;
}

function renderFeaturedProducts() {
  const root = document.querySelector('[data-featured-grid]');
  if (!root) return;

  const products = getProducts()
    .filter((product) => product.status !== 'inactive' && (product.featured === 1 || product.featured === true || product.isFeatured !== false))
    .slice(0, 4);

  root.innerHTML = products.map((product) => renderProductCard(normalizeProduct(product), 'featured')).join('');
}

function renderDealsCards(targetSelector = '[data-deals-grid]') {
  const root = document.querySelector(targetSelector);
  if (!root) return;

  const deals = getProducts()
    .filter((product) => product.status !== 'inactive' && product.isDeal !== false)
    .slice(0, 6);

  root.innerHTML = deals.map((product) => renderProductCard(normalizeProduct(product), 'compact')).join('');
}

function renderHomeComparison() {
  const root = document.querySelector('[data-home-compare]');
  if (!root) return;

  const products = getProducts().filter((p) => p.status !== 'inactive').slice(0, 4);
  root.innerHTML = products.map((product) => {
    const normalized = normalizeProduct(product);
    const offerRows = normalized.comparison.map((entry) => `
      <div class="compare-offer">
        <span>${entry.marketplace}</span>
        <strong>${formatPrice(entry.price)}</strong>
        <small>${entry.discount}% off</small>
        <a href="${entry.url}" class="btn btn-secondary btn-small" target="_blank" rel="noopener noreferrer">View Deal</a>
      </div>
    `).join('');

    return `
      <article class="home-compare-card">
        <div class="compare-card-header">
          <h3><a href="product.html?id=${product.id}" style="color: inherit;">${product.name}</a></h3>
          <span class="product-tag">${product.category}</span>
        </div>
        <div class="compare-offers-grid">${offerRows}</div>
      </article>
    `;
  }).join('');
}

// ---------------------------------------------------------------------------
// Product Detail Page (product.html)
// ---------------------------------------------------------------------------

function renderProductDetail() {
  const root = document.querySelector('[data-product-detail]');
  if (!root) return;

  const products = getProducts().filter((p) => p.status !== 'inactive');
  if (!products.length) return;

  const productId = getQueryParam('id') || products[0].id;
  const rawProduct = products.find((item) => item.id === productId) || products[0];
  const product = normalizeProduct(rawProduct);
  const bestOffer = getBestOffer(product);
  const selectedMarketplace = getQueryParam('marketplace');
  const selectedOffer = product.comparison.find((entry) => entry.marketplaceSlug === selectedMarketplace) || bestOffer;
  const relatedProducts = products.filter((item) => item.id !== product.id && (item.category === product.category || item.slug === product.slug)).slice(0, 3);
  const fallbackRelated = relatedProducts.length ? relatedProducts : products.filter((item) => item.id !== product.id).slice(0, 3);

  const productActionUrl = `/product.html?id=${encodeURIComponent(product.id)}${selectedOffer.marketplaceSlug ? `&marketplace=${encodeURIComponent(selectedOffer.marketplaceSlug)}` : ''}`;
  const hasProductVideo = product.videoStatus === 'ready' && isValidMediaUrl(product.productVideoUrl);
  const fallbackImage = 'https://images.unsplash.com/photo-1524758631624-e2822e304c36?auto=format&fit=crop&w=900&q=80';

  // Additional images
  const allImages = [product.image, ...(product.additional_images || [])].filter(Boolean);

  const metaTag = document.querySelector('meta[name="description"]');
  if (metaTag) {
    metaTag.setAttribute('content', `${product.name} product details, reviews, and marketplace price comparison on AIFRET.`);
  }
  document.title = `${product.name} | AIFRET`;

  root.innerHTML = `
    <div class="breadcrumbs">
      <a href="index.html">Home</a>
      <span>›</span>
      <a href="deals.html?category=${encodeURIComponent(product.slug || product.category.toLowerCase())}">${product.category}</a>
      <span>›</span>
      <span>${product.name}</span>
    </div>

    <div class="product-switch-bar">
      <span>Switch Product:</span>
      <select data-product-switch-select aria-label="Select product to view">
        ${products.map((p) => `<option value="${p.id}" ${p.id === product.id ? 'selected' : ''}>${p.name} (${p.category})</option>`).join('')}
      </select>
    </div>

    <div class="product-layout">
      <div class="gallery-card">
        <div class="gallery-image-wrap">
          <img id="main-product-gallery-img" src="${product.image}" alt="${product.name}" onerror="this.onerror=null;this.src='${fallbackImage}';" />
        </div>
        ${allImages.length > 1 ? `
          <div class="gallery-thumbs-strip">
            ${allImages.map((imgUrl, idx) => `
              <button type="button" class="gallery-thumb-btn ${idx === 0 ? 'active' : ''}" data-thumb-src="${imgUrl}">
                <img src="${imgUrl}" alt="${product.name} thumbnail" onerror="this.onerror=null;this.src='${fallbackImage}';" />
              </button>
            `).join('')}
          </div>
        ` : ''}
        ${hasProductVideo ? `<div class="ai-video-card"><button type="button" class="btn btn-secondary" data-video-trigger>▶ Watch Product Video</button><video data-product-video controls preload="none" playsinline hidden><source src="${product.productVideoUrl}" type="video/mp4" /></video></div>` : ''}
      </div>

      <div class="detail-card">
        <div class="detail-top-row">
          <span class="product-tag">${product.category}</span>
          ${product.best_value === 1 ? '<span class="pill success">Best Value</span>' : ''}
          <button class="mini-wishlist" type="button" data-customer-wishlist data-product-id="${product.id}" aria-label="Add ${product.name} to wishlist">♡</button>
        </div>

        <h1>${product.name}</h1>

        <div class="rating-row">
          <span class="rating-badge">★ ${product.rating || '4.5'}</span>
          <span>${(product.reviews || product.review_count || 1250).toLocaleString()} reviews</span>
        </div>

        <div class="deal-market">Available on <strong>${selectedOffer.marketplace}</strong></div>

        <div class="price-raised">
          <strong>${formatPrice(selectedOffer.price)}</strong>
          <span class="old-price">${formatPrice(selectedOffer.originalPrice || product.originalPrice)}</span>
          <span class="discount-pill-large">Save ${selectedOffer.discount}%</span>
        </div>

        <p class="product-summary">${product.description || 'Lightweight, durable, and packed with features. Compare prices below across trusted stores to get the best deal.'}</p>

        <div class="spec-list" style="margin-bottom: 20px;">
          <div style="display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid var(--line);">
            <span>Availability:</span>
            <strong>${product.availability || 'In Stock'}</strong>
          </div>
          <div style="display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid var(--line);">
            <span>Stock Status:</span>
            <strong style="text-transform: capitalize;">${(product.stock_status || 'in_stock').replace('_', ' ')}</strong>
          </div>
        </div>

        <div class="product-actions">
          <a href="${selectedOffer.url}" class="btn btn-primary" target="_blank" rel="noopener noreferrer">View Deal</a>
          <a href="deals.html" class="btn btn-secondary">See More Deals</a>
        </div>
      </div>
    </div>

    <!-- Product Media Section: Photo Upload -> 10s Video Generation -> HTML5 Video Preview -->
    <div data-product-media-container></div>

    <!-- Marketplace Offers Comparison Table -->
    <div class="compare-wrap" style="margin-top: 40px;">
      <div class="section-head">
        <div>
          <span class="section-kicker">Multiple Stores</span>
          <h2>Compare Marketplace Offers</h2>
        </div>
      </div>
      <div class="compare-table" role="table" aria-label="${product.name} marketplace comparison">
        <div class="compare-table-row compare-table-head" role="row">
          <span>Marketplace</span>
          <span>Price</span>
          <span>Discount</span>
          <span>Availability</span>
          <span></span>
        </div>
        ${product.comparison.map((entry) => `
          <div class="compare-table-row" role="row">
            <strong>${entry.marketplace}</strong>
            <span style="font-weight: 700; color: var(--text);">${formatPrice(entry.price)}</span>
            <span class="discount-badge">-${entry.discount}%</span>
            <span>${entry.availability || 'In Stock'}</span>
            <a class="btn btn-primary btn-small" href="${entry.url}" target="_blank" rel="noopener noreferrer">View Deal</a>
          </div>
        `).join('')}
      </div>
    </div>

    <!-- Related Products -->
    <div class="related-wrap">
      <div class="section-head">
        <div>
          <span class="section-kicker">You may also like</span>
          <h2>Related products</h2>
        </div>
      </div>
      <div class="related-grid">
        ${fallbackRelated.map((item) => {
    const itemNorm = normalizeProduct(item);
    return `
            <article class="related-card">
              <img src="${itemNorm.image}" alt="${itemNorm.name}" onerror="this.onerror=null;this.src='${fallbackImage}';" />
              <div>
                <h4><a href="product.html?id=${itemNorm.id}" style="color: inherit;">${itemNorm.name}</a></h4>
                <p>${formatPrice(getBestOffer(itemNorm).price)}</p>
                <a href="product.html?id=${itemNorm.id}">View details</a>
              </div>
            </article>
          `;
  }).join('')}
      </div>
    </div>
  `;

  // Gallery thumbnail switching
  root.querySelectorAll('.gallery-thumb-btn').forEach((thumbBtn) => {
    thumbBtn.addEventListener('click', () => {
      root.querySelectorAll('.gallery-thumb-btn').forEach((b) => b.classList.remove('active'));
      thumbBtn.classList.add('active');
      const mainImg = root.querySelector('#main-product-gallery-img');
      if (mainImg) mainImg.src = thumbBtn.dataset.thumbSrc;
    });
  });

  // Initialize Product Media Studio for this product
  if (window.AIFRET_PRODUCT_MEDIA) {
    window.AIFRET_PRODUCT_MEDIA.init(product, '[data-product-media-container]');
  }

  // Product Switcher listener
  const switchSelect = root.querySelector('[data-product-switch-select]');
  if (switchSelect) {
    switchSelect.addEventListener('change', (e) => {
      const newId = e.target.value;
      const newUrl = new URL(window.location);
      newUrl.searchParams.set('id', newId);
      window.history.pushState({}, '', newUrl);
      renderProductDetail();
    });
  }

  // Related products smooth click navigation
  root.querySelectorAll('.related-grid a').forEach((link) => {
    link.addEventListener('click', (e) => {
      const href = link.getAttribute('href');
      if (href && href.startsWith('product.html?id=')) {
        e.preventDefault();
        const targetId = href.split('id=')[1].split('&')[0];
        const newUrl = new URL(window.location);
        newUrl.searchParams.set('id', targetId);
        window.history.pushState({}, '', newUrl);
        renderProductDetail();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Deals Page (deals.html)
// ---------------------------------------------------------------------------

function renderDealsPage() {
  const root = document.querySelector('[data-deals-page-grid]');
  if (!root) return;

  const categoryChipsRoot = document.querySelector('[data-category-chips]');
  const marketChipsRoot = document.querySelector('[data-market-chips]');
  const priceChipsRoot = document.querySelector('[data-price-chips]');
  const searchField = document.querySelector('[data-deals-search-input]');
  const sortField = document.querySelector('[data-deals-sort]');

  if (!categoryChipsRoot || !marketChipsRoot) return;

  const search = (getQueryParam('search') || '').trim().toLowerCase();
  const category = getQueryParam('category') || 'all';
  const market = getQueryParam('marketplace') || 'all';
  const priceRange = getQueryParam('price_range') || 'all';
  const sort = getQueryParam('sort') || 'featured';

  const allActive = getProducts().filter((p) => p.status !== 'inactive');

  let items = allActive.filter((product) => {
    const normalized = normalizeProduct(product);
    const bestOffer = getBestOffer(normalized);
    const itemPrice = bestOffer.price;

    // Category filter
    const matchesCategory = category === 'all' ||
      normalized.slug === category ||
      normalized.category.toLowerCase() === category.toLowerCase() ||
      (normalized.subcategory && normalized.subcategory.toLowerCase() === category.toLowerCase());

    // Marketplace filter (only match if product has offer on that marketplace)
    const matchesMarket = market === 'all' ||
      (normalized.marketplace && normalized.marketplace.toLowerCase().replace(/\s+/g, '-') === market.toLowerCase()) ||
      normalized.comparison.some((entry) => (entry.marketplaceSlug || '').toLowerCase() === market.toLowerCase());

    // Search filter across name, brand, category, subcategory, marketplace
    const matchesSearch = !search || getProductSearchText(normalized).includes(search);

    // Price range filter
    let matchesPrice = true;
    if (priceRange === 'under-1000') matchesPrice = itemPrice < 1000;
    else if (priceRange === '1000-5000') matchesPrice = itemPrice >= 1000 && itemPrice <= 5000;
    else if (priceRange === '5000-10000') matchesPrice = itemPrice >= 5000 && itemPrice <= 10000;
    else if (priceRange === '10000-25000') matchesPrice = itemPrice >= 10000 && itemPrice <= 25000;
    else if (priceRange === 'above-25000') matchesPrice = itemPrice > 25000;

    return matchesCategory && matchesMarket && matchesSearch && matchesPrice;
  });

  // Sorting
  items.sort((first, second) => {
    const firstProduct = normalizeProduct(first);
    const secondProduct = normalizeProduct(second);
    if (sort === 'price-asc') return getBestOffer(firstProduct).price - getBestOffer(secondProduct).price;
    if (sort === 'price-desc') return getBestOffer(secondProduct).price - getBestOffer(firstProduct).price;
    if (sort === 'discount') return secondProduct.discount - firstProduct.discount;
    if (sort === 'rating') return (secondProduct.rating || 0) - (firstProduct.rating || 0);
    if (sort === 'newest') return new Date(secondProduct.created_at || 0) - new Date(firstProduct.created_at || 0);
    // featured default
    const aFeat = firstProduct.featured ? 1 : 0;
    const bFeat = secondProduct.featured ? 1 : 0;
    return bFeat - aFeat;
  });

  // Extract distinct categories from database products
  const dbCategories = Array.from(new Set(allActive.map((p) => p.category).filter(Boolean)));
  const categoryChips = [
    { label: 'All', slug: 'all' },
    ...dbCategories.map((name) => ({ label: name, slug: name.toLowerCase().replace(/\s+/g, '-') }))
  ];

  // Extract distinct marketplaces ACTUALLY in the database (Section 7 requirement!)
  const dbMarkets = new Set();
  allActive.forEach((p) => {
    if (p.marketplace) dbMarkets.add(p.marketplace);
    (p.comparison || p.offers || []).forEach((o) => {
      if (o.marketplace) dbMarkets.add(o.marketplace);
    });
  });

  const marketChips = [
    { label: 'All Stores', slug: 'all' },
    ...Array.from(dbMarkets).map((name) => ({ label: name, slug: name.toLowerCase().replace(/\s+/g, '-') }))
  ];

  // Price range chips (Section 8 requirement!)
  const priceChips = [
    { label: 'All Prices', slug: 'all' },
    { label: 'Under ₹1,000', slug: 'under-1000' },
    { label: '₹1,000–₹5,000', slug: '1000-5000' },
    { label: '₹5,000–₹10,000', slug: '5000-10000' },
    { label: '₹10,000–₹25,000', slug: '10000-25000' },
    { label: '₹25,000+', slug: 'above-25000' }
  ];

  categoryChipsRoot.innerHTML = categoryChips.map((chip) => `
    <button class="filter-chip ${chip.slug === category.toLowerCase() ? 'active' : ''}" data-category-chip="${chip.slug}">${chip.label}</button>
  `).join('');

  marketChipsRoot.innerHTML = marketChips.map((chip) => `
    <button class="filter-chip ${chip.slug === market.toLowerCase() ? 'active' : ''}" data-market-chip="${chip.slug}">${chip.label}</button>
  `).join('');

  if (priceChipsRoot) {
    priceChipsRoot.innerHTML = priceChips.map((chip) => `
      <button class="filter-chip ${chip.slug === priceRange ? 'active' : ''}" data-price-chip="${chip.slug}">${chip.label}</button>
    `).join('');
  }

  if (searchField) searchField.value = search;
  if (sortField) sortField.value = sort;

  if (!items.length) {
    root.innerHTML = `
      <div class="empty-state" style="grid-column: 1 / -1;">
        <h3>No deals match your search</h3>
        <p>Try clearing filters or searching for another keyword, brand, or category.</p>
        <button type="button" class="btn btn-secondary btn-small" style="margin-top: 12px;" onclick="window.location.href='deals.html'">Reset all filters</button>
      </div>
    `;
    return;
  }

  root.innerHTML = items.map((product) => renderProductCard(normalizeProduct(product), 'compact')).join('');

  // Chip click listeners
  document.querySelectorAll('[data-category-chip]').forEach((button) => {
    button.addEventListener('click', () => {
      const params = new URLSearchParams(window.location.search);
      const nextCategory = button.dataset.categoryChip;
      if (nextCategory === 'all') params.delete('category'); else params.set('category', nextCategory);
      const nextUrl = params.toString() ? `${window.location.pathname}?${params.toString()}` : window.location.pathname;
      window.history.replaceState({}, '', nextUrl);
      renderDealsPage();
    });
  });

  document.querySelectorAll('[data-market-chip]').forEach((button) => {
    button.addEventListener('click', () => {
      const params = new URLSearchParams(window.location.search);
      const nextMarketplace = button.dataset.marketChip;
      if (nextMarketplace === 'all') params.delete('marketplace'); else params.set('marketplace', nextMarketplace);
      const nextUrl = params.toString() ? `${window.location.pathname}?${params.toString()}` : window.location.pathname;
      window.history.replaceState({}, '', nextUrl);
      renderDealsPage();
    });
  });

  document.querySelectorAll('[data-price-chip]').forEach((button) => {
    button.addEventListener('click', () => {
      const params = new URLSearchParams(window.location.search);
      const nextPrice = button.dataset.priceChip;
      if (nextPrice === 'all') params.delete('price_range'); else params.set('price_range', nextPrice);
      const nextUrl = params.toString() ? `${window.location.pathname}?${params.toString()}` : window.location.pathname;
      window.history.replaceState({}, '', nextUrl);
      renderDealsPage();
    });
  });

  if (sortField) {
    sortField.onchange = () => {
      const params = new URLSearchParams(window.location.search);
      if (sortField.value === 'featured') params.delete('sort'); else params.set('sort', sortField.value);
      const nextUrl = params.toString() ? `${window.location.pathname}?${params.toString()}` : window.location.pathname;
      window.history.replaceState({}, '', nextUrl);
      renderDealsPage();
    };
  }
}

// ---------------------------------------------------------------------------
// Compare Page (compare.html)
// ---------------------------------------------------------------------------

function renderComparePage() {
  const root = document.querySelector('[data-compare-page-grid]');
  if (!root) return;

  const search = (getQueryParam('search') || '').trim().toLowerCase();
  const category = getQueryParam('category') || 'all';
  const market = getQueryParam('marketplace') || 'all';
  const sort = getQueryParam('sort') || 'featured';

  const allActive = getProducts().filter((p) => p.status !== 'inactive');

  let products = allActive.filter((item) => {
    const product = normalizeProduct(item);
    const matchesCategory = category === 'all' || product.slug === category || product.category.toLowerCase() === category.toLowerCase();
    const matchesMarket = market === 'all' || product.comparison.some((entry) => entry.marketplaceSlug === market);
    return matchesCategory && matchesMarket && (!search || getProductSearchText(product).includes(search));
  });

  products.sort((first, second) => {
    const firstProduct = normalizeProduct(first);
    const secondProduct = normalizeProduct(second);
    if (sort === 'price-asc') return getBestOffer(firstProduct).price - getBestOffer(secondProduct).price;
    if (sort === 'price-desc') return getBestOffer(secondProduct).price - getBestOffer(firstProduct).price;
    if (sort === 'discount') return secondProduct.discount - firstProduct.discount;
    if (sort === 'rating') return secondProduct.rating - firstProduct.rating;
    if (sort === 'newest') return new Date(secondProduct.created_at || 0) - new Date(firstProduct.created_at || 0);
    return 0;
  });

  const categoryField = document.querySelector('[data-compare-category]');
  const marketField = document.querySelector('[data-compare-marketplace]');
  const searchField = document.querySelector('[data-compare-search]');
  const sortField = document.querySelector('[data-compare-sort]');

  // Populate dynamic category & store dropdowns if not already populated
  if (categoryField) {
    const cats = Array.from(new Set(allActive.map((p) => p.category).filter(Boolean))).sort();
    categoryField.innerHTML = '<option value="all">All categories</option>' +
      cats.map((c) => `<option value="${c.toLowerCase().replace(/\s+/g, '-')}">${c}</option>`).join('');
  }

  if (marketField) {
    const mks = new Set();
    allActive.forEach((p) => {
      if (p.marketplace) mks.add(p.marketplace);
      (p.comparison || p.offers || []).forEach((o) => { if (o.marketplace) mks.add(o.marketplace); });
    });
    marketField.innerHTML = '<option value="all">All stores</option>' +
      Array.from(mks).sort().map((m) => `<option value="${m.toLowerCase().replace(/\s+/g, '-')}">${m}</option>`).join('');
  }

  if (categoryField) categoryField.value = category;
  if (marketField) marketField.value = market;
  if (searchField) searchField.value = search;
  if (sortField) sortField.value = sort;

  root.innerHTML = products.map((item) => {
    const product = normalizeProduct(item);
    const offers = product.comparison.filter((entry) => market === 'all' || entry.marketplaceSlug === market);
    return `
      <article class="compare-product-card">
        <div class="compare-product-heading">
          <div>
            <span class="section-kicker">${product.category}</span>
            <h2><a href="product.html?id=${product.id}" style="color: inherit;">${product.name}</a></h2>
          </div>
          <a class="btn btn-secondary btn-small" href="product.html?id=${product.id}">Product details</a>
        </div>
        <div class="compare-table" role="table" aria-label="${product.name} price comparison">
          <div class="compare-table-row compare-table-head" role="row">
            <span>Store</span>
            <span>Price</span>
            <span>Discount</span>
            <span>Availability</span>
            <span></span>
          </div>
          ${offers.map((entry) => `
            <div class="compare-table-row" role="row">
              <strong>${entry.marketplace}</strong>
              <span style="font-weight: 700; color: var(--text);">${formatPrice(entry.price)}</span>
              <span class="discount-badge">-${entry.discount}%</span>
              <span>${entry.availability || 'In Stock'}</span>
              <a class="btn btn-primary btn-small" href="${entry.url}" target="_blank" rel="noopener noreferrer">View Deal</a>
            </div>
          `).join('')}
        </div>
      </article>
    `;
  }).join('') || '<div class="empty-state"><h3>No products match these filters</h3><p>Try another category, store, or search term.</p></div>';

  [categoryField, marketField, sortField].forEach((field) => {
    if (!field) return;
    field.onchange = () => updateCompareQuery();
  });
  if (searchField) searchField.oninput = () => updateCompareQuery();

  function updateCompareQuery() {
    const params = new URLSearchParams();
    if (categoryField?.value && categoryField.value !== 'all') params.set('category', categoryField.value);
    if (marketField?.value && marketField.value !== 'all') params.set('marketplace', marketField.value);
    if (sortField?.value && sortField.value !== 'featured') params.set('sort', sortField.value);
    if (searchField?.value.trim()) params.set('search', searchField.value.trim());
    const nextUrl = params.toString() ? `${window.location.pathname}?${params.toString()}` : window.location.pathname;
    window.history.replaceState({}, '', nextUrl);
    renderComparePage();
  }
}

// ---------------------------------------------------------------------------
// Search & Global Handlers
// ---------------------------------------------------------------------------

function bindSearch() {
  document.querySelectorAll('[data-search-form]').forEach((form) => {
    const input = form.querySelector('[data-search-input]');
    if (!input) return;

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const value = input.value.trim();

      if (window.location.pathname.includes('deals.html')) {
        const params = new URLSearchParams(window.location.search);
        if (value) params.set('search', value); else params.delete('search');
        const nextUrl = params.toString() ? `${window.location.pathname}?${params.toString()}` : window.location.pathname;
        window.history.replaceState({}, '', nextUrl);
        renderDealsPage();
        return;
      }

      if (!value) {
        window.location.href = 'deals.html';
        return;
      }
      window.location.href = `deals.html?search=${encodeURIComponent(value)}`;
    });
  });
}

function bindMobileNavigation() {
  const toggleButton = document.querySelector('[data-nav-toggle]');
  const nav = document.querySelector('[data-site-nav]');
  if (!toggleButton || !nav) return;

  toggleButton.addEventListener('click', () => {
    const isOpen = nav.classList.toggle('is-open');
    toggleButton.setAttribute('aria-expanded', String(isOpen));
  });

  nav.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', () => {
      nav.classList.remove('is-open');
      toggleButton.setAttribute('aria-expanded', 'false');
    });
  });
}

function bindHeaderScroll() {
  const header = document.querySelector('.site-header');
  if (!header) return;

  const onScroll = () => {
    header.classList.toggle('header-compact', window.scrollY > 12);
  };

  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });
}

function initializePage() {
  bindHeaderScroll();
  bindSearch();
  bindMobileNavigation();

  // Initial render with cached/fallback data
  renderHeroShowcase();
  renderCategoryCards();
  renderMarketplaceCards();
  renderFeaturedProducts();
  renderDealsCards();
  renderHomeComparison();
  renderProductDetail();
  renderDealsPage();
  renderComparePage();

  // Asynchronously fetch fresh data from database API
  fetchProductsFromApi();
}

window.addEventListener('storage', (event) => {
  if (event.key !== PRODUCTS_STORAGE_KEY) return;
  try {
    const updatedProducts = JSON.parse(event.newValue || 'null');
    if (!Array.isArray(updatedProducts)) return;
    liveProducts = updatedProducts;
    apiLoaded = true;
  } catch (error) {
    return;
  }
  renderHeroShowcase();
  renderCategoryCards();
  renderMarketplaceCards();
  renderFeaturedProducts();
  renderDealsCards();
  renderHomeComparison();
  renderProductDetail();
  renderDealsPage();
  renderComparePage();
});

document.addEventListener('DOMContentLoaded', initializePage);
