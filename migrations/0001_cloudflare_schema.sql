CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  product_code TEXT UNIQUE,
  name TEXT NOT NULL,
  brand TEXT NOT NULL,
  category TEXT NOT NULL,
  subcategory TEXT DEFAULT '',
  description TEXT DEFAULT '',
  short_description TEXT DEFAULT '',
  detailed_description TEXT DEFAULT '',
  key_features TEXT DEFAULT '[]',
  specifications TEXT DEFAULT '{}',
  model_number TEXT DEFAULT '',
  variants TEXT DEFAULT '[]',
  color TEXT DEFAULT '',
  size TEXT DEFAULT '',
  material TEXT DEFAULT '',
  weight TEXT DEFAULT '',
  dimensions TEXT DEFAULT '',
  manufacturer TEXT DEFAULT '',
  country_of_origin TEXT DEFAULT '',
  product_video_url TEXT DEFAULT '',
  warranty_info TEXT DEFAULT '',
  image TEXT NOT NULL DEFAULT '',
  additional_images TEXT DEFAULT '[]',
  mrp REAL NOT NULL,
  selling_price REAL NOT NULL,
  discount REAL NOT NULL,
  marketplace TEXT NOT NULL,
  product_url TEXT NOT NULL,
  rating REAL DEFAULT 0,
  review_count INTEGER DEFAULT 0,
  availability TEXT DEFAULT 'In Stock',
  stock_status TEXT DEFAULT 'in_stock',
  featured INTEGER DEFAULT 0,
  best_value INTEGER DEFAULT 0,
  status TEXT DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS product_offers (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  marketplace TEXT NOT NULL,
  marketplace_slug TEXT DEFAULT '',
  store_name TEXT DEFAULT '',
  price REAL NOT NULL,
  mrp REAL DEFAULT 0,
  discount REAL DEFAULT 0,
  product_url TEXT NOT NULL,
  affiliate_url TEXT DEFAULT '',
  availability TEXT DEFAULT 'In Stock',
  variant_info TEXT DEFAULT '',
  data_source TEXT DEFAULT 'manual',
  verification_status TEXT DEFAULT 'needs_verification',
  last_verified_at TEXT DEFAULT '',
  updated_at TEXT NOT NULL,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS admin_users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES admin_users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  admin_user_id TEXT,
  admin_username TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY (admin_user_id) REFERENCES admin_users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS affiliate_clicks (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  offer_id TEXT NOT NULL,
  marketplace TEXT NOT NULL,
  clicked_at TEXT NOT NULL,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS customer_users (
  id TEXT PRIMARY KEY,
  customer_id TEXT UNIQUE NOT NULL,
  full_name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  mobile TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  status TEXT DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS customer_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES customer_users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS customer_wishlist (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  product_name TEXT DEFAULT '',
  product_image TEXT DEFAULT '',
  added_at TEXT NOT NULL,
  UNIQUE (customer_id, product_id),
  FOREIGN KEY (customer_id) REFERENCES customer_users(customer_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS customer_recently_viewed (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  product_name TEXT DEFAULT '',
  product_image TEXT DEFAULT '',
  viewed_at TEXT NOT NULL,
  FOREIGN KEY (customer_id) REFERENCES customer_users(customer_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS customer_ai_previews (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  preview_id TEXT NOT NULL,
  title TEXT DEFAULT '',
  prompt TEXT DEFAULT '',
  result TEXT DEFAULT '',
  created_at TEXT NOT NULL,
  FOREIGN KEY (customer_id) REFERENCES customer_users(customer_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS customer_ai_tryon_jobs (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  product_name TEXT DEFAULT '',
  product_image TEXT DEFAULT '',
  uploaded_photo TEXT DEFAULT '',
  video_url TEXT DEFAULT '',
  provider_job_id TEXT DEFAULT '',
  provider TEXT DEFAULT 'mock',
  status TEXT DEFAULT 'queued',
  progress INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  completed_at TEXT DEFAULT '',
  error_message TEXT DEFAULT '',
  FOREIGN KEY (customer_id) REFERENCES customer_users(customer_id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_products_status ON products(status);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
CREATE INDEX IF NOT EXISTS idx_products_brand ON products(brand);
CREATE INDEX IF NOT EXISTS idx_products_marketplace ON products(marketplace);
CREATE INDEX IF NOT EXISTS idx_products_featured ON products(featured);
CREATE INDEX IF NOT EXISTS idx_products_best_value ON products(best_value);
CREATE INDEX IF NOT EXISTS idx_offers_product_id ON product_offers(product_id);
CREATE INDEX IF NOT EXISTS idx_offers_marketplace ON product_offers(marketplace);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_affiliate_clicks_product ON affiliate_clicks(product_id);
CREATE INDEX IF NOT EXISTS idx_affiliate_clicks_marketplace ON affiliate_clicks(marketplace);
CREATE INDEX IF NOT EXISTS idx_customer_users_email ON customer_users(email);
CREATE INDEX IF NOT EXISTS idx_customer_users_mobile ON customer_users(mobile);
CREATE INDEX IF NOT EXISTS idx_customer_sessions_user ON customer_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_customer_wishlist_customer ON customer_wishlist(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_recently_viewed_customer ON customer_recently_viewed(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_ai_previews_customer ON customer_ai_previews(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_ai_tryon_customer ON customer_ai_tryon_jobs(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_ai_tryon_product ON customer_ai_tryon_jobs(product_id);
