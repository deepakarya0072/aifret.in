# AIFRET

A premium product comparison and marketplace deal discovery platform with a Cloudflare Pages API, D1 database, and Admin Product Management system.

## Included Pages

- `index.html` — Homepage with dynamic Best Value spotlight, today's deals, featured products, category navigation, and marketplace comparisons.
- `deals.html` — Deals listing with real-time keyword search, category filter chips, dynamic marketplace filter chips, price range filters, and sorting.
- `product.html` — Product detail page with image gallery thumbnails, product specifications, availability, and multi-marketplace price comparison table.
- `compare.html` — Cross-store marketplace price comparison page.
- `admin.html` — Secure Admin Product Management dashboard with product creation, draft/publish workflow, multi-marketplace offers, affiliate URLs, image upload/preview, catalogue search, filters, and pagination.
- `functions/api/[[path]].js` — Same-origin Cloudflare Pages Function for storefront, customer, and admin APIs.
- `migrations/0001_cloudflare_schema.sql` — D1 schema.
- `server.py` — Optional local Python backend with SQLite database and REST APIs.
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

## Deploy to Cloudflare Pages

The production API runs on the same origin as the static site; no localhost or separate paid Python service is required. Cloudflare Pages, D1, and R2 have usage limits and may incur charges if usage exceeds the account's free allowances. Check current Cloudflare pricing and usage before enabling production traffic.

1. In Cloudflare **Workers & Pages**, open the project that serves `aifret.in`. Confirm it is connected to this GitHub repository and deploys the intended branch. If there is no Pages project, create one from this repository. Use the repository root, no build command, and `.` as the build output directory. Pages Functions must be deployed through the Git integration or Wrangler; a static drag-and-drop upload does not deploy the `functions/` code.
2. Create a D1 database. In its SQL console, execute the contents of [`migrations/0001_cloudflare_schema.sql`](./migrations/0001_cloudflare_schema.sql).
3. In the Pages project settings, add a D1 binding named `AIFRET_DB` and select that database.
4. Create an R2 bucket, then add an R2 binding named `AIFRET_IMAGES` to the Pages project. Product image uploads and customer try-on photos use this bucket.
5. Add `AIFRET_ADMIN_USERNAME` and `AIFRET_ADMIN_PASSWORD` as encrypted production secrets in Pages settings. Choose a unique, strong password; do not reuse a password shared in chat or store either value in the repository. The first successful admin login creates the production admin when D1 contains no admin user. Changing the secrets later does not change an existing database account.

For a Pages project using Wrangler, set the secrets with `wrangler pages secret put AIFRET_ADMIN_USERNAME` and `wrangler pages secret put AIFRET_ADMIN_PASSWORD` for the deployed project. Also confirm the D1 binding is named `AIFRET_DB` (the API temporarily accepts the legacy `DB` name during migration).
6. Optionally set `AIFRET_ALLOWED_AFFILIATE_DOMAINS` to a comma-separated list of approved affiliate hosts and `AI_VIDEO_MAX_GENERATIONS_PER_CUSTOMER` to a generation cap.
7. Deploy the latest commit from the connected branch. Keep the existing DNS/custom-domain configuration unchanged until the Pages deployment is healthy.
8. Verify `https://aifret.in/admin`, `https://aifret.in/api/admin/session` (unauthenticated requests should return 401), and `https://aifret.in/api/products`. Then sign in, check product management and uploads, refresh the page, and log out.

The new D1 database is independent of local `data/aifret.db`. This migration does not transfer existing products, customer accounts, or uploaded images. The static demo catalog remains available on the storefront until D1 has published products, but the admin catalogue starts empty. Import only the product data you intend to publish; customer records and password hashes are not included or copied.

## Admin Panel Credentials

There is no default admin password. Set `AIFRET_ADMIN_USERNAME` and `AIFRET_ADMIN_PASSWORD` before the first startup when the database has no admin account. Existing database accounts are not changed by updating these variables.

## Database Architecture

The production Cloudflare D1 schema is in `migrations/0001_cloudflare_schema.sql`. The optional local Python server stores its separate SQLite database at `data/aifret.db`:

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

The Pages Function sets secure, HTTP-only, same-site cookies for HTTPS. Affiliate URLs must use the same host as their product URL unless explicitly approved in the comma-separated `AIFRET_ALLOWED_AFFILIATE_DOMAINS` Pages setting (for example, `amzn.to,affiliate.example`). Do not put admin credentials or affiliate account credentials in frontend files.

This increment covers the core catalogue create/edit/draft/publish workflow. Scheduled publishing/deal expiry, price history, view/click analytics, CSV import/export, configurable category lifecycle management, and live marketplace synchronization are not implemented by this feature; no demo metrics or marketplace data are presented as real.

## Tests

Run the product-management tests from the repository root:

```powershell
python -m unittest discover -s tests -v
```

The tests use a temporary SQLite database and do not alter `data/aifret.db`.

Validate the Cloudflare Function's JavaScript syntax with:

```powershell
node --check "functions/api/[[path]].js"
```
