# AIFRET

A premium product comparison and marketplace deal discovery platform with an integrated SQLite database and Admin Product Management system.

## Included Pages

- `index.html` — Homepage with dynamic Best Value spotlight, today's deals, featured products, category navigation, and marketplace comparisons.
- `deals.html` — Deals listing with real-time keyword search, category filter chips, dynamic marketplace filter chips, price range filters, and sorting.
- `product.html` — Product detail page with image gallery thumbnails, product specifications, availability, and multi-marketplace price comparison table.
- `compare.html` — Cross-store marketplace price comparison page.
- `admin.html` — Secure Admin Product Management dashboard with product creation, draft/publish workflow, multi-marketplace offers, affiliate URLs, image upload/preview, catalogue search, filters, and pagination.
- `server.py` — Python backend server with SQLite database and REST APIs.
- `assets/css/styles.css` — Site styling maintaining AIFRET's premium aesthetics.
- `assets/js/admin.js` — Admin panel controller interacting with REST API.
- `assets/js/app.js` — Client-side dynamic rendering and filtering engine.

## Run Locally

Open PowerShell in the project folder (the folder containing `server.py`) and run:

```powershell
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

- `products`: id (public slug), immutable product_code, name, brand, category, subcategory, description, image, additional_images, pricing, availability, display flags, status, and timestamps.
- `product_offers`: id, product_id, marketplace, marketplace_slug, store_name, price, mrp, discount, product_url, affiliate_url, availability, updated_at.
- `admin_users`: id, username, password_hash (PBKDF2-SHA256), salt, created_at.
- `admin_sessions`: token, user_id, created_at, expires_at.
- `audit_logs`: admin account, action, record reference, minimal change details, and timestamp.

Indexes are created on `status`, `category`, `brand`, `marketplace`, `featured`, `best_value`, and `product_id`.

## REST API Endpoints

- `GET /api/products` — List public products (published only); admins can query draft records too. Supports search, filters, sorting, and pagination (maximum 100 per page).
- `GET /api/products/<id>` — Get a published product; authenticated admins can also retrieve drafts.
- `POST /api/products` — Add a new product with offers (Admin authenticated).
- `PUT /api/products/<id>` — Update an existing product and offers (Admin authenticated).
- `PATCH /api/products/<id>/status` — Toggle product status (published/draft) (Admin authenticated; stored as `active`/`inactive` for compatibility).
- `PATCH /api/products/<id>/featured` — Toggle featured status (Admin authenticated).
- `PATCH /api/products/<id>/best-value` — Toggle Best Value status (Admin authenticated).
- `DELETE /api/products/<id>` — Soft-delete or permanently delete product (Admin authenticated).
- `POST /api/upload` — Upload product image to `uploads/` directory (Admin authenticated).
- `POST /api/admin/login` — Authenticate admin and set an `HttpOnly` session cookie.
- `POST /api/admin/logout` — Terminate admin session.
- `GET /api/admin/session` — Verify current session.
- `GET /api/categories` — List distinct categories and product counts.
- `GET /api/marketplaces` — List distinct marketplaces present in active catalog.
- `GET /api/admin/audit-logs` — List paginated product-management audit events (Admin authenticated).

## Add and publish products

1. Start the server and sign in at `http://localhost:8000/admin.html`.
2. Choose **+ Add Product**, enter the product details, and add the marketplace product URL.
3. Add an optional affiliate URL separately for the primary store and for each additional store offer. Affiliate destinations are never used as the normal product URL by default.
4. Upload JPEG, PNG, or WebP images up to 10 MB. The server checks the file signature, generates its own filename, and stores the file in `uploads/`.
5. Save as **Draft** to keep the product hidden, or choose **Published** to make it available through the site's existing product APIs. Publishing requires a product image.
6. Search/filter the catalogue and use **Edit** to update a product. Every product receives an immutable `AIFRET-PROD-######` catalogue code while its existing slug remains the public lookup ID.

The admin catalogue loads 50 products per page. Admin listing, product changes, image uploads, and audit-log APIs require an authenticated admin session. Existing database rows receive product codes during startup without replacing product records.

To use secure cookies behind HTTPS, set `AIFRET_COOKIE_SECURE=true` in the server environment. Affiliate URLs must use the same host as their product URL unless explicitly approved in the comma-separated `AIFRET_ALLOWED_AFFILIATE_DOMAINS` server setting (for example, `amzn.to,affiliate.example`). Do not put admin credentials or affiliate account credentials in frontend files.

This increment covers the core catalogue create/edit/draft/publish workflow. Scheduled publishing/deal expiry, price history, view/click analytics, CSV import/export, configurable category lifecycle management, and live marketplace synchronization are not implemented by this feature; no demo metrics or marketplace data are presented as real.

## Tests

Run the product-management tests from the repository root:

```powershell
python -m unittest discover -s tests -v
```

The tests use a temporary SQLite database and do not alter `data/aifret.db`.
