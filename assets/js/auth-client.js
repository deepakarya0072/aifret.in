window.AIFRET_AUTH = {
  endpoint: window.AIFRET_CONFIG?.auth?.endpoint || '',
  safeReturnTo(value) {
    return value && value.startsWith('/') && !value.startsWith('//') ? value : '/index.html';
  },
  async request(path, options = {}) {
    if (!this.endpoint) throw new Error('Customer authentication is not configured.');
    const response = await fetch(`${this.endpoint.replace(/\/$/, '')}${path}`, { ...options, credentials: 'include', headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || 'Authentication request failed.');
    return data;
  },
  session() { return this.request('/session'); },
  login(credentials) { return this.request('/login', { method: 'POST', body: JSON.stringify(credentials) }); },
  signup(credentials) { return this.request('/signup', { method: 'POST', body: JSON.stringify(credentials) }); },
  forgot(identifier) { return this.request('/forgot-password', { method: 'POST', body: JSON.stringify({ identifier }) }); },
  logout() { return this.request('/logout', { method: 'POST' }); },
  profile() { return this.request('/account/profile'); },
  updateProfile(profile) { return this.request('/account/profile', { method: 'PUT', body: JSON.stringify(profile) }); },
  wishlist() { return this.request('/account/wishlist'); },
  updateWishlist(productId, saved) { return this.request('/account/wishlist', { method: saved ? 'POST' : 'DELETE', body: JSON.stringify({ productId }) }); },
  recentlyViewed() { return this.request('/account/recently-viewed'); },
  recordViewed(productId) { return this.request('/account/recently-viewed', { method: 'POST', body: JSON.stringify({ productId }) }); },
  previews() { return this.request('/account/ai-previews'); },
  deletePreview(previewId) { return this.request(`/account/ai-previews/${encodeURIComponent(previewId)}`, { method: 'DELETE' }); }
};

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('[aria-label="Account"]').forEach((control) => control.addEventListener('click', () => { window.location.href = `login.html?returnTo=${encodeURIComponent(window.location.pathname + window.location.search)}`; }));
  document.querySelectorAll('[data-auth-tab]').forEach((tab) => tab.addEventListener('click', () => {
    const mode = tab.dataset.authTab;
    document.querySelectorAll('[data-auth-tab]').forEach((item) => { item.classList.toggle('active', item === tab); item.setAttribute('aria-selected', String(item === tab)); });
    document.querySelector('[data-login-form]')?.toggleAttribute('hidden', mode !== 'login');
    document.querySelector('[data-signup-form]')?.toggleAttribute('hidden', mode !== 'signup');
  }));
});

document.addEventListener('click', (event) => {
  const control = event.target.closest('[data-customer-wishlist]');
  if (!control) return;
  event.preventDefault();
  window.location.href = `login.html?returnTo=${encodeURIComponent(window.location.pathname + window.location.search)}`;
});