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

function getProducts() {
  try {
    const storedProducts = JSON.parse(window.localStorage.getItem(PRODUCTS_STORAGE_KEY) || 'null');
    return Array.isArray(storedProducts) ? storedProducts : config.products;
  } catch (error) {
    return config.products;
  }
}

function formatPrice(value) {
  return currency.format(value);
}

function getQueryParam(name) {
  const params = new URLSearchParams(window.location.search);
  return params.get(name);
}

function normalizeProduct(product) {
  const firstOffer = (product.comparison || [])[0] || {};

  return {
    ...product,
    productImage: product.productImage || product.image || '',
    currentPrice: product.currentPrice ?? product.price,
    oldPrice: product.oldPrice ?? product.originalPrice,
    productUrl: product.productUrl || `product.html?id=${product.id}`,
    store: product.store || firstOffer.marketplace || '',
    affiliateUrl: product.affiliateUrl || firstOffer.url || '#',
    comparison: (product.comparison || []).map((entry) => {
      const marketplaceFound = config.marketplaces.find((market) => {
        const marketName = (market.name || '').toLowerCase();
        const entryName = (entry.marketplace || '').toLowerCase();
        const entrySlug = (entry.marketplaceSlug || '').toLowerCase();
        return market.slug === entrySlug || marketName === entryName || marketName === (entry.marketplace || '').toLowerCase();
      });
      const marketplaceSlug = entry.marketplaceSlug || (marketplaceFound ? marketplaceFound.slug : (entry.marketplace || 'amazon').toLowerCase().replace(/\s+/g, '-'));

      return {
        ...entry,
        marketplaceSlug,
        marketplace: entry.storeName || entry.marketplace || (marketplaceFound ? marketplaceFound.name : 'Amazon'),
        url: config.affiliateLinks?.[marketplaceSlug] || entry.url || '#',
        buyUrl: entry.affiliateUrl || entry.productUrl || entry.url || config.affiliateLinks?.[marketplaceSlug] || '#',
        availability: entry.availability || 'Demo listing'
      };
    })
  };
}

function getBestOffer(product) {
  const normalized = normalizeProduct(product);
  const sorted = [...normalized.comparison].sort((a, b) => a.price - b.price);
  return sorted[0] || {
    marketplace: 'Amazon',
    price: product.price,
    discount: product.discount,
    url: config.affiliateLinks?.amazon || '#',
    buyUrl: config.affiliateLinks?.amazon || '#'
  };
}

function getProductSearchText(product) {
  const comparisonText = (product.comparison || []).map((entry) => entry.marketplace || '').join(' ');
  return `${product.name} ${product.brand} ${product.category} ${comparisonText}`.toLowerCase();
}

function renderCategoryCards() {
  const root = document.querySelector('[data-category-grid]');
  if (!root) return;

  root.innerHTML = config.categories.map((category) => `
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

  root.innerHTML = config.marketplaces.map((market) => `
    <article class="market-card">
      <div class="market-logo" style="background: ${market.color};">${market.name.slice(0, 2).toUpperCase()}</div>
      <div class="market-card-body">
        <h3>${market.name}</h3>
        <p>Trusted deals and shopping picks</p>
        <a href="deals.html?marketplace=${market.slug}" class="btn btn-secondary btn-small">Browse Deals</a>
      </div>
    </article>
  `).join('');
}

function renderProductCard(product, mode = 'featured') {
  const bestOffer = getBestOffer(product);
  const isCompact = mode === 'compact';

  return `
    <article class="${isCompact ? 'deal-card' : 'product-card'}">
      <div class="${isCompact ? 'deal-thumb' : 'product-image'}">
        <img src="${product.image}" alt="${product.name}" onerror="this.onerror=null;this.src='https://images.unsplash.com/photo-1524758631624-e2822e304c36?auto=format&fit=crop&w=900&q=80';" />
      </div>
      <div class="card-body">
        <div class="card-top-line">
          <span class="product-tag">${product.category}</span>
          <button class="mini-wishlist" type="button" aria-label="Add ${product.name} to wishlist">♡</button>
        </div>

        <h3>${product.name}</h3>
        <div class="product-meta">
          <span>${product.brand}</span>
          <span>⭐ ${product.rating}</span>
        </div>

        <div class="deal-market">Product By <a href="deals.html?marketplace=${encodeURIComponent(bestOffer.marketplaceSlug)}">${bestOffer.marketplace}</a></div>

        <div class="price-row">
          <strong>${formatPrice(bestOffer.price)}</strong>
          <span>${formatPrice(product.originalPrice)}</span>
        </div>

        <div class="discount-line">
          <span class="discount-badge">-${product.discount}%</span>
          <small>Price from ${bestOffer.marketplace}</small>
        </div>

        <div class="card-actions">
          <a href="product.html?id=${product.id}" class="btn btn-primary">View Deal</a>
        </div>
      </div>
    </article>
  `;
}

function renderFeaturedProducts() {
  const root = document.querySelector('[data-featured-grid]');
  if (!root) return;

  const products = getProducts().filter((product) => product.isFeatured !== false).slice(0, 4);
  root.innerHTML = products.map((product) => renderProductCard(normalizeProduct(product), 'featured')).join('');
}

function renderDealsCards(targetSelector = '[data-deals-grid]') {
  const root = document.querySelector(targetSelector);
  if (!root) return;

  const deals = getProducts().filter((product) => product.isDeal !== false).slice(0, 6);
  root.innerHTML = deals.map((product) => renderProductCard(normalizeProduct(product), 'compact')).join('');
}

function renderHomeComparison() {
  const root = document.querySelector('[data-home-compare]');
  if (!root) return;

  const products = getProducts().slice(0, 4);
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
          <h3>${product.name}</h3>
          <span class="product-tag">${product.category}</span>
        </div>
        <div class="compare-offers-grid">${offerRows}</div>
      </article>
    `;
  }).join('');
}

function renderProductDetail() {
  const root = document.querySelector('[data-product-detail]');
  if (!root) return;

  const products = getProducts();
  const productId = getQueryParam('id') || products[0].id;
  const product = normalizeProduct(products.find((item) => item.id === productId) || products[0]);
  const bestOffer = getBestOffer(product);
  const selectedMarketplace = getQueryParam('marketplace');
  const selectedOffer = product.comparison.find((entry) => entry.marketplaceSlug === selectedMarketplace) || bestOffer;
  const relatedProducts = products.filter((item) => item.id !== product.id).slice(0, 3);

  const metaTag = document.querySelector('meta[name="description"]');
  if (metaTag) {
    metaTag.setAttribute('content', `${product.name} product details and marketplace price comparison on AIFRET.`);
  }
  document.title = `${product.name} | AIFRET`;

  root.innerHTML = `
    <div class="breadcrumbs">
      <a href="index.html">Home</a>
      <span>›</span>
      <span>${product.category}</span>
      <span>›</span>
      <span>${product.name}</span>
    </div>

    <div class="product-layout">
      <div class="gallery-card">
        <div class="gallery-image-wrap">
          <img src="${product.image}" alt="${product.name}" onerror="this.onerror=null;this.src='https://images.unsplash.com/photo-1524758631624-e2822e304c36?auto=format&fit=crop&w=900&q=80';" />
        </div>
      </div>

      <div class="detail-card">
        <div class="detail-top-row">
          <span class="product-tag">${product.category}</span>
          <button class="mini-wishlist" type="button" aria-label="Add ${product.name} to wishlist">♡</button>
        </div>

        <h1>${product.name}</h1>

        <div class="rating-row">
          <span class="rating-badge">★ ${product.rating}</span>
          <span>${product.reviews} reviews</span>
        </div>

        <div class="deal-market">Product By ${selectedOffer.marketplace}</div>

        <div class="price-raised">
          <strong>${formatPrice(selectedOffer.price)}</strong>
          <span class="old-price">${formatPrice(selectedOffer.originalPrice || product.originalPrice)}</span>
          <span class="discount-pill-large">Save ${selectedOffer.discount}%</span>
        </div>

        <p class="product-summary">${product.description}</p>

        <ul class="feature-list">
          ${product.features.map((feature) => `<li>${feature}</li>`).join('')}
        </ul>

        <div class="product-actions">
          <a href="${selectedOffer.url}" class="btn btn-secondary" target="_blank" rel="noopener noreferrer">View Deal</a>
          <a href="${selectedOffer.buyUrl}" class="btn btn-primary" target="_blank" rel="noopener noreferrer">Buy Now</a>
          <a href="deals.html" class="btn btn-secondary">See More Deals</a>
        </div>
      </div>
    </div>

    <div class="product-content-grid">
      <div class="info-panel">
        <div class="panel-block">
          <h3>Highlights</h3>
          <ul class="list-grid">
            ${product.features.map((feature) => `<li>${feature}</li>`).join('')}
          </ul>
        </div>

        <div class="panel-block">
          <h3>Specifications</h3>
          <ul class="spec-list">
            <li><span>Brand</span><strong>${product.brand}</strong></li>
            <li><span>Category</span><strong>${product.category}</strong></li>
            <li><span>Rating</span><strong>${product.rating} / 5</strong></li>
            <li><span>Reviews</span><strong>${product.reviews}</strong></li>
          </ul>
        </div>
      </div>

      <aside class="offer-panel">
        <div class="offer-panel-head">
          <h3>Marketplace offers</h3>
          <span class="small-badge">Updated</span>
        </div>
        <div class="offer-list">
          ${product.comparison.map((entry) => `
            <div class="offer-item">
              <div>
                <strong>${entry.marketplace}</strong>
                <small>${entry.discount}% off</small>
              </div>
              <div class="offer-price-box">
                <span>${formatPrice(entry.price)}</span>
                <div class="offer-actions">
                  <a href="${entry.url}" class="btn btn-secondary btn-small" target="_blank" rel="noopener noreferrer">View Deal</a>
                  <a href="product.html?id=${encodeURIComponent(product.id)}&marketplace=${encodeURIComponent(entry.marketplaceSlug)}" class="btn btn-primary btn-small">Buy Now</a>
                </div>
              </div>
            </div>
          `).join('')}
        </div>
      </aside>
    </div>

    <div class="compare-wrap">
      <div class="section-head">
        <div>
          <span class="section-kicker">Comparison</span>
          <h2>Price comparison</h2>
        </div>
      </div>
      <div class="compare-grid" data-compare-grid></div>
    </div>

    <div class="related-wrap">
      <div class="section-head">
        <div>
          <span class="section-kicker">You may also like</span>
          <h2>Related products</h2>
        </div>
      </div>
      <div class="related-grid">
        ${relatedProducts.map((item) => `
          <article class="related-card">
            <img src="${item.image}" alt="${item.name}" onerror="this.onerror=null;this.src='https://images.unsplash.com/photo-1524758631624-e2822e304c36?auto=format&fit=crop&w=900&q=80';" />
            <div>
              <h4>${item.name}</h4>
              <p>${formatPrice(getBestOffer(item).price)}</p>
              <a href="product.html?id=${item.id}">View deal</a>
            </div>
          </article>
        `).join('')}
      </div>
    </div>
  `;

  const compareRoot = document.querySelector('[data-compare-grid]');
  if (compareRoot) {
    compareRoot.innerHTML = product.comparison.map((entry) => `
      <article class="compare-card">
        <span class="marketplace-badge">${entry.marketplace}</span>
        <h3>${entry.marketplace}</h3>
        <div class="compare-price">${formatPrice(entry.price)}</div>
        <div class="compare-status">Availability: ${entry.availability}</div>
        <div class="meta-row">
          <span>-${entry.discount}%</span>
          <a href="${entry.url}" class="btn btn-primary btn-small" target="_blank" rel="noopener noreferrer">View Deal</a>
        </div>
      </article>
    `).join('');
  }
}

function renderDealsPage() {
  const root = document.querySelector('[data-deals-page-grid]');
  if (!root) return;

  const categoryChipsRoot = document.querySelector('[data-category-chips]');
  const marketChipsRoot = document.querySelector('[data-market-chips]');
  const searchField = document.querySelector('[data-deals-search-input]');
  const sortField = document.querySelector('[data-deals-sort]');

  if (!categoryChipsRoot || !marketChipsRoot) return;

  const search = (getQueryParam('search') || '').trim().toLowerCase();
  const category = getQueryParam('category') || 'all';
  const market = getQueryParam('marketplace') || 'all';
  const sort = getQueryParam('sort') || 'featured';

  let items = getProducts().filter((product) => {
    const normalized = normalizeProduct(product);
    const matchesCategory = category === 'all' || normalized.slug === category || normalized.category.toLowerCase() === category.toLowerCase();
    const matchesMarket = market === 'all' || normalized.comparison.some((entry) => (entry.marketplaceSlug || '').toLowerCase() === market.toLowerCase());
    const matchesSearch = !search || getProductSearchText(normalized).includes(search);
    return matchesCategory && matchesMarket && matchesSearch;
  });

  items.sort((first, second) => {
    const firstProduct = normalizeProduct(first);
    const secondProduct = normalizeProduct(second);
    if (sort === 'price-asc') return getBestOffer(firstProduct).price - getBestOffer(secondProduct).price;
    if (sort === 'price-desc') return getBestOffer(secondProduct).price - getBestOffer(firstProduct).price;
    if (sort === 'discount') return secondProduct.discount - firstProduct.discount;
    if (sort === 'rating') return secondProduct.rating - firstProduct.rating;
    return 0;
  });

  const chips = [
    { label: 'All', slug: 'all' },
    ...config.categories.map((item) => ({ label: item.name, slug: item.slug }))
  ];

  const marketChips = [
    { label: 'All', slug: 'all' },
    ...config.marketplaces.map((item) => ({ label: item.name, slug: item.slug }))
  ];

  categoryChipsRoot.innerHTML = chips.map((chip) => `
    <button class="filter-chip ${chip.slug === category ? 'active' : ''}" data-category-chip="${chip.slug}">${chip.label}</button>
  `).join('');

  marketChipsRoot.innerHTML = marketChips.map((chip) => `
    <button class="filter-chip ${chip.slug === market ? 'active' : ''}" data-market-chip="${chip.slug}">${chip.label}</button>
  `).join('');

  if (searchField) searchField.value = search;
  if (sortField) sortField.value = sort;

  if (!items.length) {
    root.innerHTML = `
      <div class="empty-state">
        <h3>No deals match your search</h3>
        <p>Try another keyword, category, or marketplace filter.</p>
      </div>
    `;
    return;
  }

  root.innerHTML = items.map((product) => renderProductCard(normalizeProduct(product), 'compact')).join('');

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

function renderComparePage() {
  const root = document.querySelector('[data-compare-page-grid]');
  if (!root) return;

  const search = (getQueryParam('search') || '').trim().toLowerCase();
  const category = getQueryParam('category') || 'all';
  const market = getQueryParam('marketplace') || 'all';
  const sort = getQueryParam('sort') || 'featured';
  let products = getProducts().filter((item) => {
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
    return 0;
  });

  const categoryField = document.querySelector('[data-compare-category]');
  const marketField = document.querySelector('[data-compare-marketplace]');
  const searchField = document.querySelector('[data-compare-search]');
  const sortField = document.querySelector('[data-compare-sort]');
  if (categoryField) categoryField.value = category;
  if (marketField) marketField.value = market;
  if (searchField) searchField.value = search;
  if (sortField) sortField.value = sort;

  root.innerHTML = products.map((item) => {
    const product = normalizeProduct(item);
    const offers = product.comparison.filter((entry) => market === 'all' || entry.marketplaceSlug === market);
    return `<article class="compare-product-card">
      <div class="compare-product-heading"><div><span class="section-kicker">${product.category}</span><h2>${product.name}</h2></div><a class="btn btn-secondary btn-small" href="product.html?id=${product.id}">Product details</a></div>
      <div class="compare-table" role="table" aria-label="${product.name} price comparison">
        <div class="compare-table-row compare-table-head" role="row"><span>Store</span><span>Price</span><span>Discount</span><span>Availability</span><span></span></div>
        ${offers.map((entry) => `<div class="compare-table-row" role="row"><strong>${entry.marketplace}</strong><span>${formatPrice(entry.price)}</span><span class="discount-badge">-${entry.discount}%</span><span>${entry.availability}</span><a class="btn btn-primary btn-small" href="${entry.url}" target="_blank" rel="noopener noreferrer">View Deal</a></div>`).join('')}
      </div>
    </article>`;
  }).join('') || '<div class="empty-state"><h3>No products match these filters</h3><p>Try another category, store, or search.</p></div>';

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

      if (!value) return;
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
  renderCategoryCards();
  renderMarketplaceCards();
  renderFeaturedProducts();
  renderDealsCards();
  renderHomeComparison();
  renderProductDetail();
  renderDealsPage();
  renderComparePage();
}

window.addEventListener('storage', (event) => {
  if (event.key !== PRODUCTS_STORAGE_KEY) return;
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
