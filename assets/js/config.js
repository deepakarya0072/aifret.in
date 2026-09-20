window.AIFRET_CONFIG = {
  siteName: 'AIFRET',
  domain: 'aifret.in',
  ai: {
    video: { endpoint: '' },
    preview: { endpoint: '' }
  },
  auth: {
    endpoint: ''
  },
  affiliateLinks: {
    amazon: '#demo-amazon',
    flipkart: '#demo-flipkart',
    meesho: '#demo-meesho',
    myntra: '#demo-myntra',
    'other-stores': '#demo-other-stores'
  },
  categories: [
    { name: 'Electronics', icon: '📱', slug: 'electronics' },
    { name: 'Mobiles', icon: '📲', slug: 'mobiles' },
    { name: 'Laptops', icon: '💻', slug: 'laptops' },
    { name: 'Fashion', icon: '👕', slug: 'fashion' },
    { name: 'Shoes', icon: '👟', slug: 'shoes' },
    { name: 'Beauty', icon: '💄', slug: 'beauty' },
    { name: 'Home & Kitchen', icon: '🏠', slug: 'home-kitchen' },
    { name: 'Watches', icon: '⌚', slug: 'watches' }
  ],
  marketplaces: [
    { name: 'Amazon', slug: 'amazon', color: '#ffb800' },
    { name: 'Flipkart', slug: 'flipkart', color: '#1676ff' },
    { name: 'Meesho', slug: 'meesho', color: '#f15a7d' },
    { name: 'Myntra', slug: 'myntra', color: '#ff5b8a' },
    { name: 'Other Stores', slug: 'other-stores', color: '#6f7c96' }
  ],
  products: [
    {
      id: 'noise-buds-x',
      name: 'Noise Buds X',
      category: 'Electronics',
      slug: 'electronics',
      brand: 'Noise',
      rating: 4.5,
      reviews: 1287,
      price: 2499,
      originalPrice: 3999,
      discount: 38,
      description: 'Lightweight wireless earbuds with deep bass, clear calls, and long battery life for daily use.',
      image: 'https://images.unsplash.com/photo-1546435770-a3e426bf472b?auto=format&fit=crop&w=900&q=80',
      features: ['20h battery life', 'Low-latency gaming mode', 'Noise isolation', 'Fast USB-C charging'],
      comparison: [
        { marketplace: 'Amazon', price: 2499, discount: 38, url: '#demo-amazon' },
        { marketplace: 'Flipkart', price: 2599, discount: 35, url: 'https://www.flipkart.com/' },
        { marketplace: 'Meesho', price: 2399, discount: 40, url: 'https://www.meesho.com/' },
        { marketplace: 'Myntra', price: 2699, discount: 32, url: 'https://www.myntra.com/' },
        { marketplace: 'Other Stores', marketplaceSlug: 'other-stores', storeName: 'Demo Store', price: 2549, discount: 36, url: '#demo-other-stores' }
      ]
    },
    {
      id: 'oneplus-nord-buds',
      name: 'OnePlus Nord Buds',
      category: 'Electronics',
      slug: 'electronics',
      brand: 'OnePlus',
      rating: 4.4,
      reviews: 982,
      price: 2999,
      originalPrice: 4999,
      discount: 40,
      description: 'Balanced sound, ergonomic fit, and quick charge for commuting and workouts.',
      image: 'https://images.unsplash.com/photo-1583394838336-acd977736f90?auto=format&fit=crop&w=900&q=80',
      features: ['Deep bass profile', '44ms low latency', 'IP55 sweat resistance', 'Dual device pairing'],
      comparison: [
        { marketplace: 'Amazon', price: 2999, discount: 40, url: '#demo-amazon' },
        { marketplace: 'Flipkart', price: 3199, discount: 36, url: 'https://www.flipkart.com/' },
        { marketplace: 'Meesho', price: 2899, discount: 42, url: 'https://www.meesho.com/' },
        { marketplace: 'Myntra', price: 3499, discount: 30, url: 'https://www.myntra.com/' }
      ]
    },
    {
      id: 'samsung-m14',
      name: 'Samsung Galaxy M14',
      category: 'Mobiles',
      slug: 'mobiles',
      brand: 'Samsung',
      rating: 4.3,
      reviews: 1535,
      price: 11999,
      originalPrice: 16999,
      discount: 29,
      description: 'Reliable 5G smartphone with a vibrant display and long battery backup for everyday users.',
      image: 'https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?auto=format&fit=crop&w=900&q=80',
      features: ['6.6-inch display', '50MP triple camera', '5000mAh battery', '5G ready'],
      comparison: [
        { marketplace: 'Amazon', price: 11999, discount: 29, url: '#demo-amazon' },
        { marketplace: 'Flipkart', price: 12499, discount: 26, url: 'https://www.flipkart.com/' },
        { marketplace: 'Meesho', price: 11099, discount: 34, url: 'https://www.meesho.com/' },
        { marketplace: 'Myntra', price: 12999, discount: 23, url: 'https://www.myntra.com/' }
      ]
    },
    {
      id: 'lenovo-ideapad',
      name: 'Lenovo IdeaPad 5',
      category: 'Laptops',
      slug: 'laptops',
      brand: 'Lenovo',
      rating: 4.6,
      reviews: 876,
      price: 46999,
      originalPrice: 68999,
      discount: 32,
      description: 'Slim laptop tuned for work, streaming, and casual productivity with strong performance.',
      image: 'https://images.unsplash.com/photo-1496181133206-80ce9b88a853?auto=format&fit=crop&w=900&q=80',
      features: ['16GB RAM', '512GB SSD', 'AMD Ryzen 5', 'FHD display'],
      comparison: [
        { marketplace: 'Amazon', price: 46999, discount: 32, url: '#demo-amazon' },
        { marketplace: 'Flipkart', price: 47999, discount: 30, url: 'https://www.flipkart.com/' },
        { marketplace: 'Meesho', price: 45999, discount: 33, url: 'https://www.meesho.com/' },
        { marketplace: 'Myntra', price: 49999, discount: 27, url: 'https://www.myntra.com/' }
      ]
    },
    {
      id: 'urbanic-coat',
      name: 'Urbanic Everyday Coat',
      category: 'Fashion',
      slug: 'fashion',
      brand: 'Urbanic',
      rating: 4.2,
      reviews: 640,
      price: 1890,
      originalPrice: 3499,
      discount: 46,
      description: 'A polished, lightweight outer layer designed for style and comfort throughout the day.',
      image: 'https://images.unsplash.com/photo-1529139574466-a303027c1d8b?auto=format&fit=crop&w=900&q=80',
      features: ['Soft-touch fabric', 'Relaxed fit', 'Seasonal layering', 'Everyday styling'],
      comparison: [
        { marketplace: 'Amazon', price: 1990, discount: 43, url: '#demo-amazon' },
        { marketplace: 'Flipkart', price: 1890, discount: 46, url: 'https://www.flipkart.com/' },
        { marketplace: 'Meesho', price: 1799, discount: 48, url: 'https://www.meesho.com/' },
        { marketplace: 'Myntra', price: 2099, discount: 40, url: 'https://www.myntra.com/' }
      ]
    },
    {
      id: 'puma-running-shoes',
      name: 'Puma Running Shoes',
      category: 'Shoes',
      slug: 'shoes',
      brand: 'Puma',
      rating: 4.4,
      reviews: 742,
      price: 3499,
      originalPrice: 5999,
      discount: 42,
      description: 'Comfort-focused training shoes with cushioned support and a modern street-ready silhouette.',
      image: 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=900&q=80',
      features: ['Cushioning sole', 'Lightweight feel', 'Flexible traction', 'Daily wear fit'],
      comparison: [
        { marketplace: 'Amazon', price: 3499, discount: 42, url: '#demo-amazon' },
        { marketplace: 'Flipkart', price: 3625, discount: 39, url: 'https://www.flipkart.com/' },
        { marketplace: 'Meesho', price: 3299, discount: 45, url: 'https://www.meesho.com/' },
        { marketplace: 'Myntra', price: 3799, discount: 37, url: 'https://www.myntra.com/' }
      ]
    },
    {
      id: 'lakme-glow-kit',
      name: 'Lakme Glow Essentials',
      category: 'Beauty',
      slug: 'beauty',
      brand: 'Lakme',
      rating: 4.3,
      reviews: 1124,
      price: 1299,
      originalPrice: 2199,
      discount: 41,
      description: 'A curated beauty routine kit with skincare essentials for a polished everyday glow.',
      image: 'https://images.unsplash.com/photo-1522335789203-aabd1fc54bc9?auto=format&fit=crop&w=900&q=80',
      features: ['Hydrating base', 'Skin-friendly formula', 'Travel-friendly set', 'Daily use kit'],
      comparison: [
        { marketplace: 'Amazon', price: 1299, discount: 41, url: '#demo-amazon' },
        { marketplace: 'Flipkart', price: 1399, discount: 36, url: 'https://www.flipkart.com/' },
        { marketplace: 'Meesho', price: 1199, discount: 45, url: 'https://www.meesho.com/' },
        { marketplace: 'Myntra', price: 1499, discount: 32, url: 'https://www.myntra.com/' }
      ]
    },
    {
      id: 'smart-kettle',
      name: 'Smart Electric Kettle',
      category: 'Home & Kitchen',
      slug: 'home-kitchen',
      brand: 'Prestige',
      rating: 4.5,
      reviews: 890,
      price: 2199,
      originalPrice: 3599,
      discount: 39,
      description: 'High-speed heating with auto shutoff, ideal for quick cups and daily kitchen convenience.',
      image: 'https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?auto=format&fit=crop&w=900&q=80',
      features: ['1.5L capacity', 'Auto shutoff', 'Fast boil technology', 'Compact base'],
      comparison: [
        { marketplace: 'Amazon', price: 2199, discount: 39, url: '#demo-amazon' },
        { marketplace: 'Flipkart', price: 2299, discount: 36, url: 'https://www.flipkart.com/' },
        { marketplace: 'Meesho', price: 2099, discount: 42, url: 'https://www.meesho.com/' },
        { marketplace: 'Myntra', price: 2399, discount: 33, url: 'https://www.myntra.com/' }
      ]
    },
    {
      id: 'fossil-chrono',
      name: 'Fossil Chronograph',
      category: 'Watches',
      slug: 'watches',
      brand: 'Fossil',
      rating: 4.6,
      reviews: 631,
      price: 7499,
      originalPrice: 11999,
      discount: 38,
      description: 'A refined statement watch with a bold dial and versatile design for work or evenings out.',
      image: 'https://images.unsplash.com/photo-1523170335258-f5ed11844a49?auto=format&fit=crop&w=900&q=80',
      features: ['Chronograph dial', 'Water resistance', 'Leather strap', 'Premium finish'],
      comparison: [
        { marketplace: 'Amazon', price: 7499, discount: 38, url: '#demo-amazon' },
        { marketplace: 'Flipkart', price: 7799, discount: 35, url: 'https://www.flipkart.com/' },
        { marketplace: 'Meesho', price: 6999, discount: 42, url: 'https://www.meesho.com/' },
        { marketplace: 'Myntra', price: 8299, discount: 31, url: 'https://www.myntra.com/' }
      ]
    }
  ]
};
