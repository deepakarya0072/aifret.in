# AIFRET

A premium product comparison and marketplace deal discovery platform with an integrated SQLite database and Admin Product Management system.

## Included Pages

- `index.html` — Homepage with dynamic Best Value spotlight, today's deals, featured products, category navigation, and marketplace comparisons.
- `deals.html` — Deals listing with real-time keyword search, category filter chips, dynamic marketplace filter chips, price range filters, and sorting.
- `product.html` — Product detail page with image gallery thumbnails, product specifications, availability, and multi-marketplace price comparison table.
- `compare.html` — Cross-store marketplace price comparison page.
- `admin.html` — Secure Admin Product Management dashboard with product creation (22 fields), multi-marketplace offers editor, image upload/preview, live discount calculator, and catalog management table.
- `server.py` — Python backend server with SQLite database and REST APIs.
- `assets/css/styles.css` — Site styling maintaining AIFRET's premium aesthetics.
- `assets/js/admin.js` — Admin panel controller interacting with REST API.
- `assets/js/app.js` — Client-side dynamic rendering and filtering engine.

## Run Locally

From the project root:

```bash
cd "c:/Users/hp/Desktop/AIFRET"
$env:AIFRET_ADMIN_USERNAME = "admin"
$env:AIFRET_ADMIN_PASSWORD = "choose-a-strong-password"
python server.py
```

Then open in your browser:

- Storefront: `http://localhost:8000/`
- Deals: `http://localhost:8000/deals.html`
- Compare Prices: `http://localhost:8000/compare.html`
- Admin Panel: `http://localhost:8000/admin.html`

## Admin Panel Credentials

There is no default admin password. Set `AIFRET_ADMIN_USERNAME` and `AIFRET_ADMIN_PASSWORD` before the first startup when the database has no admin account. Existing database accounts are not changed by updating these variables.

## Database Architecture

A persistent SQLite database is located at `data/aifret.db`:

- `products`: id, name, brand, category, subcategory, description, image, additional_images, mrp, selling_price, discount, marketplace, product_url, rating, review_count, availability, stock_status, featured, best_value, status, created_at, updated_at.
- `product_offers`: id, product_id, marketplace, marketplace_slug, store_name, price, mrp, discount, product_url, affiliate_url, availability, updated_at.
- `admin_users`: id, username, password_hash (PBKDF2-SHA256), salt, created_at.
- `admin_sessions`: token, user_id, created_at, expires_at.

Indexes are created on `status`, `category`, `brand`, `marketplace`, `featured`, `best_value`, and `product_id`.

## REST API Endpoints

- `GET /api/products` — List active products (supports `search`, `category`, `marketplace`, `min_price`, `max_price`, `sort`, `featured`, `best_value`, `limit`, `offset`).
- `GET /api/products/<id>` — Get single product with all marketplace offers.
- `POST /api/products` — Add a new product with offers (Admin authenticated).
- `PUT /api/products/<id>` — Update an existing product and offers (Admin authenticated).
- `PATCH /api/products/<id>/status` — Toggle product status (active/inactive) (Admin authenticated).
- `PATCH /api/products/<id>/featured` — Toggle featured status (Admin authenticated).
- `PATCH /api/products/<id>/best-value` — Toggle Best Value status (Admin authenticated).
- `DELETE /api/products/<id>` — Soft-delete or permanently delete product (Admin authenticated).
- `POST /api/upload` — Upload product image to `uploads/` directory (Admin authenticated).
- `POST /api/admin/login` — Authenticate admin and receive session token / cookie.
- `POST /api/admin/logout` — Terminate admin session.
- `GET /api/admin/session` — Verify current session.
- `GET /api/categories` — List distinct categories and product counts.
- `GET /api/marketplaces` — List distinct marketplaces present in active catalog.
