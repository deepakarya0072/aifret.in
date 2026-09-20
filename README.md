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
