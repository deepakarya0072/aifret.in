# AIFRET

A demo affiliate shopping and product comparison website built in HTML, CSS, and JavaScript for Stage 1.

## Included pages

- `index.html` — homepage with search, categories, deals, marketplace cards, and featured products
- `deals.html` — deals listing with category and marketplace filter UI
- `product.html` — individual product detail page with comparison table/cards
- `assets/css/styles.css` — site styling
- `assets/js/config.js` — configurable demo data and affiliate placeholders
- `assets/js/app.js` — rendering logic for pages and filters

## Run locally

From the project folder:

```bash
cd "c:/Users/hp/Desktop/AIFRET"
py -m http.server 8000
```

Then open:

```text
http://localhost:8000/
```

Alternatively, if `py` is not available on your machine:

```bash
python -m http.server 8000
```

## Notes

- This is a static Stage 1 build using demo/sample products.
- No fake live prices, fake APIs, or actual paid affiliate credentials are used.
- Affiliate links are intentionally lightweight and configurable in `assets/js/config.js`.

## Optional AI media providers

The admin product flow stores `productVideoUrl`, `videoStatus`, `videoJobId`, and `videoGeneratedAt` on the existing local product record. AI video and customer preview calls are disabled by default because this static project has no server-side provider or secret store.

To enable real generation, configure `window.AIFRET_CONFIG.ai.video.endpoint` and/or `window.AIFRET_CONFIG.ai.preview.endpoint` to protected server-side endpoints in the deployment architecture. Keep provider API keys and authentication secrets in server-side environment secrets, never in this repository or frontend JavaScript. The endpoint must return JSON with `status` and a validated `videoUrl`, `previewUrl`, or `mediaUrl`; pending jobs may return `status: "pending"` with a `jobId` for the server-side job system to complete.

## Optional customer authentication

Customer routes are available at `login.html`, `signup.html`, `forgot-password.html`, and `account.html`. They use `window.AIFRET_CONFIG.auth.endpoint` with secure cookie sessions and never store passwords, hashes, roles, or tokens in the browser. The endpoint must provide server-side `/session`, `/login`, `/signup`, `/forgot-password`, `/logout`, and `/account/*` handlers, hash passwords, assign new users the `customer` role, and enforce admin authorization separately. It is intentionally empty until a real authenticated backend is deployed; the static site cannot provide secure authentication by itself.
