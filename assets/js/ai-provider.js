window.AIFRET_AI = {
  isConfigured(kind) {
    const settings = window.AIFRET_CONFIG?.ai?.[kind] || {};
    return Boolean(settings.endpoint);
  },

  async generateVideo({ product, image }) {
    return this.request('video', { productId: product.id, productName: product.name, description: product.description, image });
  },

  async generatePreview({ product, productImage, customerPhoto }) {
    return this.request('preview', { productId: product.id, category: product.category, productImage, customerPhoto });
  },

  async request(kind, payload) {
    const settings = window.AIFRET_CONFIG?.ai?.[kind] || {};
    if (!settings.endpoint) throw new Error(`${kind} provider is not configured.`);

    const response = await fetch(settings.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!response.ok) throw new Error(`AI ${kind} provider returned ${response.status}.`);

    const result = await response.json();
    const mediaUrl = result.videoUrl || result.previewUrl || result.mediaUrl || '';
    if (mediaUrl && !/^https?:\/\//i.test(mediaUrl)) throw new Error(`AI ${kind} provider returned an invalid media URL.`);
    return { ...result, mediaUrl, status: result.status || 'ready', jobId: result.jobId || '' };
  }
};
