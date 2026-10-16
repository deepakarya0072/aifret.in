const SESSION_COOKIE = 'aifret_session';
const CUSTOMER_COOKIE = 'aifret_customer_session';
const PASSWORD_ITERATIONS = 100000;
const MAX_JSON_BYTES = 15 * 1024 * 1024;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...headers
    }
  });
}

function error(message, status = 400) {
  return json({ error: true, message }, status);
}

function database(env) {
  if (!env.AIFRET_DB) throw new Error('D1 binding AIFRET_DB is missing.');
  return env.AIFRET_DB;
}

function now() {
  return new Date().toISOString();
}

function randomHex(bytes = 32) {
  const value = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(value, (part) => part.toString(16).padStart(2, '0')).join('');
}

function bytesToHex(bytes) {
  return Array.from(new Uint8Array(bytes), (part) => part.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(value) {
  if (!/^(?:[0-9a-f]{2})+$/i.test(value)) throw new Error('Invalid password hash.');
  return new Uint8Array(value.match(/.{2}/g).map((part) => parseInt(part, 16)));
}

async function digest(value) {
  return bytesToHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
}

async function hashPassword(password, salt = randomHex(16)) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const result = await crypto.subtle.deriveBits({
    name: 'PBKDF2',
    hash: 'SHA-256',
    salt: new TextEncoder().encode(salt),
    iterations: PASSWORD_ITERATIONS
  }, key, 256);
  return { hash: bytesToHex(result), salt };
}

function constantTimeEqual(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

async function verifyPassword(password, expectedHash, salt) {
  const actual = await hashPassword(password, salt);
  return constantTimeEqual(actual.hash, expectedHash);
}

function cookieValue(request, name) {
  const cookieHeader = request.headers.get('Cookie') || '';
  for (const cookie of cookieHeader.split(';')) {
    const separator = cookie.indexOf('=');
    if (separator < 0) continue;
    if (cookie.slice(0, separator).trim() === name) {
      return cookie.slice(separator + 1).trim();
    }
  }
  return '';
}

function cookieHeader(name, value, maxAge) {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=${maxAge}`;
}

function sameOrigin(request) {
  const origin = request.headers.get('Origin');
  return !origin || origin === new URL(request.url).origin;
}

async function requestBody(request) {
  const length = Number(request.headers.get('Content-Length') || 0);
  if (length > MAX_JSON_BYTES) throw new Error('Request body exceeds the allowed size.');
  try {
    const value = await request.json();
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('Invalid JSON body.');
    }
    return value;
  } catch {
    throw new Error('Invalid JSON body.');
  }
}

async function adminSession(request, db) {
  const token = cookieValue(request, SESSION_COOKIE);
  if (!token) return null;
  return db.prepare(`
    SELECT u.id AS user_id, u.username
    FROM admin_sessions s
    JOIN admin_users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ?
  `).bind(await digest(token), now()).first();
}

async function customerSession(request, db) {
  const token = cookieValue(request, CUSTOMER_COOKIE);
  if (!token) return null;
  return db.prepare(`
    SELECT u.id, u.customer_id AS customerId, u.full_name AS fullName,
           u.email, u.mobile, u.status
    FROM customer_sessions s
    JOIN customer_users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ?
  `).bind(await digest(token), now()).first();
}

async function provisionFirstAdmin(env, db) {
  const count = await db.prepare('SELECT COUNT(*) AS count FROM admin_users').first();
  if (count.count > 0) return;
  const username = String(env.AIFRET_ADMIN_USERNAME || '').trim();
  const password = String(env.AIFRET_ADMIN_PASSWORD || '');
  if (!username || !password) {
    throw new Error('Set AIFRET_ADMIN_USERNAME and AIFRET_ADMIN_PASSWORD as Cloudflare secrets before the first admin login.');
  }
  const { hash, salt } = await hashPassword(password);
  await db.prepare(`
    INSERT OR IGNORE INTO admin_users (id, username, password_hash, salt, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).bind('admin-1', username, hash, salt, now()).run();
}

function validateWebUrl(value, fieldName, required = true) {
  const result = String(value || '').trim();
  if (!result && !required) return '';
  let parsed;
  try {
    parsed = new URL(result);
  } catch {
    throw new Error(`${fieldName} must be a valid HTTP or HTTPS URL`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password) {
    throw new Error(`${fieldName} must be a valid HTTP or HTTPS URL`);
  }
  return result;
}

function validateImageReference(value) {
  const result = String(value || '').trim();
  if (!result) return '';
  if (result.startsWith('/api/uploads/') || result.startsWith('/uploads/')) {
    const filename = result.slice(result.lastIndexOf('/') + 1);
    if (!filename || filename.includes('..') || filename.includes('\\')) {
      throw new Error('Image path is invalid');
    }
    return result;
  }
  return validateWebUrl(result, 'Image URL');
}

function validateAffiliateUrl(value, fieldName, productUrl, env) {
  const affiliateUrl = validateWebUrl(value, fieldName, false);
  if (!affiliateUrl) return '';
  const affiliateHost = new URL(affiliateUrl).hostname.toLowerCase().replace(/\.$/, '');
  const productHost = new URL(productUrl).hostname.toLowerCase().replace(/\.$/, '');
  const allowedHosts = String(env.AIFRET_ALLOWED_AFFILIATE_DOMAINS || '')
    .split(',').map((host) => host.trim().toLowerCase().replace(/\.$/, '')).filter(Boolean);
  if (![productHost, ...allowedHosts].some((host) => affiliateHost === host || affiliateHost.endsWith(`.${host}`))) {
    throw new Error(`${fieldName} must use the product domain or a domain in AIFRET_ALLOWED_AFFILIATE_DOMAINS`);
  }
  return affiliateUrl;
}

function normalizeStatus(value) {
  if (['active', 'published', 1, '1'].includes(value)) return 'active';
  if (['inactive', 'draft', 0, '0'].includes(value)) return 'inactive';
  throw new Error('Select Draft or Published as the product status');
}

function truthy(value) {
  return [true, 1, '1', 'true'].includes(value);
}

function finiteNumber(value, label, { min = -Infinity, max = Infinity } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    throw new Error(`Enter a valid ${label}`);
  }
  return number;
}

async function productWithOffers(db, id) {
  const product = await db.prepare('SELECT * FROM products WHERE id = ?').bind(id).first();
  if (!product) return null;
  try {
    product.additional_images = JSON.parse(product.additional_images || '[]');
  } catch {
    product.additional_images = [];
  }
  const result = await db.prepare(`
    SELECT * FROM product_offers WHERE product_id = ? ORDER BY price ASC
  `).bind(id).all();
  product.offers = result.results || [];
  product.comparison = product.offers;
  return product;
}

function validateOffers(offers, primaryMarketplace, primaryAvailability, env) {
  if (!Array.isArray(offers)) throw new Error('Marketplace offers must be a list');
  return offers.map((offer) => {
    if (!offer || typeof offer !== 'object' || Array.isArray(offer)) {
      throw new Error('Each marketplace offer must be an object');
    }
    const marketplace = String(offer.marketplace || '').trim();
    if (!marketplace || marketplace.toLowerCase() === primaryMarketplace.toLowerCase()) return null;
    const price = finiteNumber(offer.price, `prices for the ${marketplace} offer`, { min: Number.MIN_VALUE });
    const mrp = finiteNumber(offer.mrp || 0, `MRP for the ${marketplace} offer`, { min: 0 });
    const productUrl = validateWebUrl(offer.product_url, `${marketplace} product URL`);
    return {
      marketplace,
      store_name: String(offer.store_name || '').trim(),
      price,
      mrp,
      product_url: productUrl,
      affiliate_url: validateAffiliateUrl(offer.affiliate_url, `${marketplace} affiliate URL`, productUrl, env),
      availability: String(offer.availability || primaryAvailability).trim() || primaryAvailability
    };
  }).filter(Boolean);
}

function offerStatements(productId, primary, additional) {
  const timestamp = now();
  return [primary, ...additional].map((offer) => {
    const discount = offer.mrp > 0 && offer.price <= offer.mrp
      ? Math.round(((offer.mrp - offer.price) / offer.mrp) * 100)
      : 0;
    return {
      sql: `INSERT INTO product_offers
        (id, product_id, marketplace, marketplace_slug, store_name, price, mrp, discount,
         product_url, affiliate_url, availability, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      values: [
        `offer-${randomHex(6)}`, productId, offer.marketplace,
        offer.marketplace.toLowerCase().replaceAll(' ', '-'), offer.store_name || '',
        offer.price, offer.mrp, discount, offer.product_url, offer.affiliate_url || '',
        offer.availability || 'In Stock', timestamp
      ]
    };
  });
}

async function writeAudit(db, admin, action, entityType, entityId, details = {}) {
  await db.prepare(`
    INSERT INTO audit_logs (id, admin_user_id, admin_username, action, entity_type, entity_id, details, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    `audit-${randomHex(8)}`, admin.user_id, admin.username, action, entityType,
    String(entityId), JSON.stringify(details), now()
  ).run();
}

async function listProducts(request, env, db, admin) {
  const url = new URL(request.url);
  const search = (url.searchParams.get('search') || '').trim().toLowerCase();
  const category = (url.searchParams.get('category') || '').trim();
  const marketplace = (url.searchParams.get('marketplace') || '').trim();
  const sort = url.searchParams.get('sort') || 'featured';
  const status = url.searchParams.get('status') || 'active';
  const featured = url.searchParams.get('featured') || '';
  const bestValue = url.searchParams.get('best_value') || '';
  const minPrice = url.searchParams.get('min_price') || '';
  const maxPrice = url.searchParams.get('max_price') || '';
  const limit = Math.max(1, Math.min(100, Number.parseInt(url.searchParams.get('limit') || '50', 10)));
  const offset = Math.max(0, Number.parseInt(url.searchParams.get('offset') || '0', 10));
  if (!Number.isInteger(limit) || !Number.isInteger(offset)) return error('Invalid pagination values');

  const filters = [];
  const values = [];
  if (!admin || status === 'active') filters.push("p.status = 'active'");
  else if (status === 'inactive') filters.push("p.status = 'inactive'");
  if (search) {
    filters.push(`(
      LOWER(p.name) LIKE ? OR LOWER(p.brand) LIKE ? OR LOWER(p.category) LIKE ? OR
      LOWER(p.subcategory) LIKE ? OR LOWER(p.marketplace) LIKE ? OR
      EXISTS (SELECT 1 FROM product_offers o WHERE o.product_id = p.id AND LOWER(o.marketplace) LIKE ?)
    )`);
    values.push(...Array(6).fill(`%${search}%`));
  }
  if (category && category.toLowerCase() !== 'all') {
    filters.push('(LOWER(p.category) = LOWER(?) OR LOWER(p.subcategory) = LOWER(?))');
    values.push(category, category);
  }
  if (marketplace && marketplace.toLowerCase() !== 'all') {
    filters.push(`(LOWER(p.marketplace) = LOWER(?) OR EXISTS (
      SELECT 1 FROM product_offers o WHERE o.product_id = p.id AND
      (LOWER(o.marketplace) = LOWER(?) OR o.marketplace_slug = ?)
    ))`);
    values.push(marketplace, marketplace, marketplace.toLowerCase().replaceAll(' ', '-'));
  }
  if (minPrice) {
    const value = Number(minPrice);
    if (Number.isFinite(value)) { filters.push('p.selling_price >= ?'); values.push(value); }
  }
  if (maxPrice) {
    const value = Number(maxPrice);
    if (Number.isFinite(value)) { filters.push('p.selling_price <= ?'); values.push(value); }
  }
  if (featured === '1') filters.push('p.featured = 1');
  if (bestValue === '1') filters.push('p.best_value = 1');

  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const ordering = {
    'price-asc': 'p.selling_price ASC',
    'price-desc': 'p.selling_price DESC',
    discount: 'p.discount DESC',
    rating: 'p.rating DESC',
    newest: 'p.created_at DESC',
    name: 'p.name ASC'
  }[sort] || 'p.featured DESC, p.created_at DESC';
  const count = await db.prepare(`SELECT COUNT(*) AS total FROM products p ${where}`).bind(...values).first();
  const rows = await db.prepare(`SELECT p.* FROM products p ${where} ORDER BY ${ordering} LIMIT ? OFFSET ?`)
    .bind(...values, limit, offset).all();
  const products = await Promise.all((rows.results || []).map((row) => productWithOffers(db, row.id)));
  const response = { products, total: count.total, count: products.length, limit, offset };
  if (admin) {
    const stats = await db.prepare(`
      SELECT COUNT(*) AS total,
        SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS published,
        SUM(CASE WHEN status = 'inactive' THEN 1 ELSE 0 END) AS drafts,
        SUM(CASE WHEN featured = 1 THEN 1 ELSE 0 END) AS featured,
        SUM(CASE WHEN best_value = 1 THEN 1 ELSE 0 END) AS best_value
      FROM products
    `).first();
    response.stats = Object.fromEntries(
      ['total', 'published', 'drafts', 'featured', 'best_value'].map((key) => [key, stats[key] || 0])
    );
    response.categories = (await db.prepare(
      "SELECT DISTINCT category FROM products WHERE category != '' ORDER BY category COLLATE NOCASE"
    ).all()).results.map((row) => row.category);
    response.marketplaces = (await db.prepare(
      "SELECT DISTINCT marketplace FROM product_offers WHERE marketplace != '' ORDER BY marketplace COLLATE NOCASE"
    ).all()).results.map((row) => row.marketplace);
  }
  return json(response);
}

async function addProduct(body, env, db, admin) {
  const name = String(body.name || '').trim();
  const brand = String(body.brand || '').trim();
  const category = String(body.category || '').trim();
  const subcategory = String(body.subcategory || '').trim();
  const description = String(body.description || '').trim();
  const image = validateImageReference(body.image);
  const additionalImages = body.additional_images || [];
  const marketplace = String(body.marketplace || '').trim();
  const productUrl = validateWebUrl(body.product_url, 'Marketplace product URL');
  const affiliateUrl = validateAffiliateUrl(body.affiliate_url, 'Affiliate URL', productUrl, env);
  let availability = String(body.availability || 'In Stock').trim();
  const stockStatus = String(body.stock_status || 'in_stock').trim();
  if (!['in_stock', 'limited', 'out_of_stock'].includes(stockStatus)) throw new Error('Select a valid stock status');
  if (stockStatus === 'out_of_stock') availability = 'Out of Stock';
  if (!Array.isArray(additionalImages)) throw new Error('Additional images must be a list of image URLs');
  const parsedImages = additionalImages.map(validateImageReference);
  const featured = truthy(body.featured) ? 1 : 0;
  const bestValue = truthy(body.best_value) ? 1 : 0;
  const status = normalizeStatus(body.status ?? 'active');
  const mrp = finiteNumber(body.mrp, 'MRP', { min: Number.MIN_VALUE });
  const sellingPrice = finiteNumber(body.selling_price, 'selling price', { min: Number.MIN_VALUE });
  const rating = finiteNumber(body.rating ?? 0, 'rating', { min: 0, max: 5 });
  const reviewCount = finiteNumber(body.review_count ?? 0, 'review count', { min: 0 });
  if (!Number.isInteger(reviewCount)) throw new Error('Review count must be a whole number');
  if (!name || !description || !category || !marketplace || !productUrl) {
    throw new Error('Product name, description, category, marketplace, and product URL are required');
  }
  if (status === 'active' && !image) throw new Error('A product image is required before publishing');
  const additionalOffers = validateOffers(body.offers ?? body.comparison ?? [], marketplace, availability, env);
  const productId = String(body.id || '')
    .trim() || `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'product'}-${randomHex(3)}`;
  if (productId.length > 120 || !/^[a-z0-9_-]+$/i.test(productId)) {
    throw new Error('Product ID may contain only letters, numbers, hyphens, and underscores');
  }
  const timestamp = now();
  const codeRow = await db.prepare(`
    SELECT COALESCE(MAX(CAST(SUBSTR(product_code, 13) AS INTEGER)), 0) + 1 AS next_code
    FROM products WHERE product_code LIKE 'AIFRET-PROD-%'
  `).first();
  const productCode = `AIFRET-PROD-${String(codeRow.next_code).padStart(6, '0')}`;
  const discount = mrp > 0 && sellingPrice <= mrp ? Math.round(((mrp - sellingPrice) / mrp) * 100) : 0;
  const statements = [{
    sql: `INSERT INTO products (
      id, product_code, name, brand, category, subcategory, description, image, additional_images,
      mrp, selling_price, discount, marketplace, product_url, rating, review_count, availability,
      stock_status, featured, best_value, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    values: [
      productId, productCode, name, brand, category, subcategory, description, image,
      JSON.stringify(parsedImages), mrp, sellingPrice, discount, marketplace, productUrl,
      rating, reviewCount, availability, stockStatus, featured, bestValue, status, timestamp, timestamp
    ]
  }];
  const primaryOffer = {
    marketplace, store_name: '', price: sellingPrice, mrp, product_url: productUrl,
    affiliate_url: affiliateUrl, availability
  };
  statements.push(...offerStatements(productId, primaryOffer, additionalOffers));
  statements.push({
    sql: `INSERT INTO audit_logs
      (id, admin_user_id, admin_username, action, entity_type, entity_id, details, created_at)
      VALUES (?, ?, ?, 'create', 'product', ?, ?, ?)`,
    values: [`audit-${randomHex(8)}`, admin.user_id, admin.username, productId, JSON.stringify({ product_code: productCode }), timestamp]
  });
  try {
    await db.batch(statements.map((statement) => db.prepare(statement.sql).bind(...statement.values)));
  } catch (error) {
    if (/unique|constraint/i.test(error.message)) throw Object.assign(new Error('This product ID or catalogue code is already in use'), { status: 409 });
    throw error;
  }
  return json({ success: true, id: productId, product_code: productCode, status });
}

async function updateProduct(productId, body, env, db, admin) {
  const existing = await db.prepare('SELECT * FROM products WHERE id = ?').bind(productId).first();
  if (!existing) return error('Product not found', 404);
  const primary = await db.prepare(`
    SELECT affiliate_url FROM product_offers
    WHERE product_id = ? AND LOWER(marketplace) = LOWER(?) ORDER BY updated_at DESC LIMIT 1
  `).bind(productId, existing.marketplace).first();
  const name = String(body.name ?? existing.name).trim();
  const brand = String(body.brand ?? existing.brand).trim();
  const category = String(body.category ?? existing.category).trim();
  const subcategory = String(body.subcategory ?? existing.subcategory).trim();
  const description = String(body.description ?? existing.description).trim();
  const image = validateImageReference(body.image ?? existing.image);
  const additionalImages = body.additional_images ?? JSON.parse(existing.additional_images || '[]');
  if (!Array.isArray(additionalImages)) throw new Error('Additional images must be a list of image URLs');
  const parsedImages = additionalImages.map(validateImageReference);
  const marketplace = String(body.marketplace ?? existing.marketplace).trim();
  const productUrl = validateWebUrl(body.product_url ?? existing.product_url, 'Marketplace product URL');
  const affiliateUrl = validateAffiliateUrl(body.affiliate_url ?? primary?.affiliate_url, 'Affiliate URL', productUrl, env);
  let availability = String(body.availability ?? existing.availability).trim();
  const stockStatus = String(body.stock_status ?? existing.stock_status).trim();
  if (!['in_stock', 'limited', 'out_of_stock'].includes(stockStatus)) throw new Error('Select a valid stock status');
  if (stockStatus === 'out_of_stock') availability = 'Out of Stock';
  const status = normalizeStatus(body.status ?? existing.status);
  const mrp = finiteNumber(body.mrp ?? existing.mrp, 'MRP', { min: Number.MIN_VALUE });
  const sellingPrice = finiteNumber(body.selling_price ?? existing.selling_price, 'selling price', { min: Number.MIN_VALUE });
  const rating = finiteNumber(body.rating ?? existing.rating, 'rating', { min: 0, max: 5 });
  const reviewCount = finiteNumber(body.review_count ?? existing.review_count, 'review count', { min: 0 });
  if (!Number.isInteger(reviewCount)) throw new Error('Review count must be a whole number');
  if (!name || !description || !category || !marketplace) {
    throw new Error('Name, description, category, marketplace, and positive prices are required');
  }
  if (status === 'active' && !image) throw new Error('A product image is required before publishing');
  const featured = truthy(body.featured ?? existing.featured) ? 1 : 0;
  const bestValue = truthy(body.best_value ?? existing.best_value) ? 1 : 0;
  const discount = sellingPrice <= mrp ? Math.round(((mrp - sellingPrice) / mrp) * 100) : 0;
  const statements = [{
    sql: `UPDATE products SET name=?, brand=?, category=?, subcategory=?, description=?, image=?,
      additional_images=?, mrp=?, selling_price=?, discount=?, marketplace=?, product_url=?,
      rating=?, review_count=?, availability=?, stock_status=?, featured=?, best_value=?, status=?, updated_at=?
      WHERE id=?`,
    values: [
      name, brand, category, subcategory, description, image, JSON.stringify(parsedImages), mrp,
      sellingPrice, discount, marketplace, productUrl, rating, reviewCount, availability,
      stockStatus, featured, bestValue, status, now(), productId
    ]
  }];
  const hasOffers = Object.hasOwn(body, 'offers') || Object.hasOwn(body, 'comparison');
  if (hasOffers) {
    const additionalOffers = validateOffers(body.offers ?? body.comparison ?? [], marketplace, availability, env);
    statements.push({ sql: 'DELETE FROM product_offers WHERE product_id=?', values: [productId] });
    statements.push(...offerStatements(productId, {
      marketplace, store_name: '', price: sellingPrice, mrp, product_url: productUrl,
      affiliate_url: affiliateUrl, availability
    }, additionalOffers));
  }
  statements.push({
    sql: `INSERT INTO audit_logs
      (id, admin_user_id, admin_username, action, entity_type, entity_id, details, created_at)
      VALUES (?, ?, ?, 'update', 'product', ?, '{}', ?)`,
    values: [`audit-${randomHex(8)}`, admin.user_id, admin.username, productId, now()]
  });
  await db.batch(statements.map((statement) => db.prepare(statement.sql).bind(...statement.values)));
  return json({ success: true, product: await productWithOffers(db, productId) });
}

function decodeDataUrl(dataUrl) {
  if (typeof dataUrl !== 'string') return null;
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  if (!match) return null;
  let binary;
  try { binary = atob(match[2]); } catch { return null; }
  if (!binary.length || binary.length > MAX_IMAGE_BYTES) return null;
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const extension = match[1] === 'image/jpeg' ? 'jpg' : match[1].slice('image/'.length);
  const valid = extension === 'jpg'
    ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
    : extension === 'png'
      ? bytes.slice(0, 8).join(',') === '137,80,78,71,13,10,26,10'
      : bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF'
        && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP';
  return valid ? { bytes, mimeType: match[1], extension } : null;
}

async function putImage(env, image, prefix) {
  if (!env.AIFRET_IMAGES) throw Object.assign(new Error('Cloudflare R2 binding AIFRET_IMAGES is not configured.'), { status: 503 });
  const key = `${prefix}/${randomHex(16)}.${image.extension}`;
  const cacheControl = prefix.startsWith('customer-uploads/')
    ? 'private, no-store'
    : 'public, max-age=31536000, immutable';
  await env.AIFRET_IMAGES.put(key, image.bytes, {
    httpMetadata: { contentType: image.mimeType, cacheControl }
  });
  return `/api/uploads/${key}`;
}

function customerView(row) {
  return {
    id: row.id,
    customerId: row.customer_id,
    fullName: row.full_name,
    email: row.email,
    mobile: row.mobile,
    status: row.status
  };
}

async function createCustomerSession(db, user, request) {
  const token = randomHex(32);
  const created = now();
  const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  await db.prepare(`
    INSERT INTO customer_sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)
  `).bind(await digest(token), user.id, created, expires).run();
  return json(
    { success: true, user: customerView(user) },
    200,
    { 'Set-Cookie': cookieHeader(CUSTOMER_COOKIE, token, 2592000) }
  );
}

async function signup(body, db) {
  const fullName = String(body.fullName || body.full_name || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  const mobile = String(body.mobile || '').trim();
  const password = String(body.password || '');
  if (!fullName || !email || !mobile || !password) return error('Full name, email, mobile, and password are required');
  if (password.length < 8) return error('Password must be at least 8 characters long');
  const existing = await db.prepare(
    'SELECT id FROM customer_users WHERE LOWER(email)=LOWER(?) OR mobile=?'
  ).bind(email, mobile).first();
  if (existing) return error('An account with this email or mobile already exists', 409);
  const customerRow = await db.prepare(`
    SELECT COALESCE(MAX(CAST(SUBSTR(customer_id, 15) AS INTEGER)), 0) + 1 AS next_id
    FROM customer_users WHERE customer_id LIKE 'AIFRET-CUS-%'
  `).first();
  const id = `customer-${randomHex(8)}`;
  const customerId = `AIFRET-CUS-${String(customerRow.next_id).padStart(6, '0')}`;
  const { hash, salt } = await hashPassword(password);
  const created = now();
  try {
    await db.prepare(`
      INSERT INTO customer_users
        (id, customer_id, full_name, email, mobile, password_hash, salt, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
    `).bind(id, customerId, fullName, email, mobile, hash, salt, created, created).run();
  } catch (exception) {
    if (/unique|constraint/i.test(exception.message)) return error('An account with this email or mobile already exists', 409);
    throw exception;
  }
  return createCustomerSession(db, {
    id, customer_id: customerId, full_name: fullName, email, mobile, status: 'active'
  });
}

async function customerLogin(body, db) {
  const identifier = String(body.identifier || '').trim();
  const password = String(body.password || '');
  if (!identifier || !password) {
    return error('Customer ID, email, or mobile number and password are required');
  }
  const user = await db.prepare(`
    SELECT * FROM customer_users
    WHERE LOWER(customer_id)=LOWER(?) OR LOWER(email)=LOWER(?) OR mobile=?
    LIMIT 1
  `).bind(identifier, identifier, identifier).first();
  if (!user || !await verifyPassword(password, user.password_hash, user.salt)) {
    return error('Invalid customer ID, email, mobile number, or password', 401);
  }
  return createCustomerSession(db, user);
}

async function imageObjectResponse(env, key) {
  if (!env.AIFRET_IMAGES) return error('Cloudflare R2 binding AIFRET_IMAGES is not configured.', 503);
  const object = await env.AIFRET_IMAGES.get(key);
  if (!object) return error('Image not found', 404);
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('ETag', object.httpEtag);
  headers.set('X-Content-Type-Options', 'nosniff');
  return new Response(object.body, { headers });
}

async function handleGet(request, env, db, route, url) {
  if (route === 'admin/session') {
    const admin = await adminSession(request, db);
    return admin ? json({ authenticated: true, user: { user_id: admin.user_id, username: admin.username } })
      : json({ authenticated: false }, 401);
  }
  if (route === 'admin/audit-logs') {
    if (!await adminSession(request, db)) return error('Unauthorized', 401);
    const limit = Math.max(1, Math.min(100, Number.parseInt(url.searchParams.get('limit') || '50', 10)));
    const offset = Math.max(0, Number.parseInt(url.searchParams.get('offset') || '0', 10));
    if (!Number.isInteger(limit) || !Number.isInteger(offset)) return error('Invalid pagination values');
    const result = await db.prepare(`
      SELECT id, admin_username, action, entity_type, entity_id, details, created_at
      FROM audit_logs ORDER BY created_at DESC LIMIT ? OFFSET ?
    `).bind(limit, offset).all();
    return json({
      logs: (result.results || []).map((row) => ({ ...row, details: JSON.parse(row.details || '{}') })),
      limit, offset
    });
  }
  if (route === 'products') return listProducts(request, env, db, await adminSession(request, db));
  if (route.startsWith('products/')) {
    const productId = decodeURIComponent(route.slice('products/'.length));
    if (!productId || productId.includes('/')) return error('Product not found', 404);
    const product = await productWithOffers(db, productId);
    if (!product || (product.status !== 'active' && !await adminSession(request, db))) {
      return error('Product not found', 404);
    }
    return json({ product });
  }
  if (route === 'categories') {
    const result = await db.prepare(`
      SELECT category, COUNT(*) AS count FROM products WHERE status='active'
      GROUP BY category ORDER BY count DESC, category ASC
    `).all();
    return json({
      categories: (result.results || []).map((row) => ({
        ...row, slug: row.category.toLowerCase().replaceAll(' ', '-')
      }))
    });
  }
  if (route === 'marketplaces') {
    const result = await db.prepare(`
      SELECT DISTINCT marketplace FROM (
        SELECT marketplace FROM products WHERE status='active'
        UNION
        SELECT o.marketplace FROM product_offers o JOIN products p ON p.id=o.product_id WHERE p.status='active'
      ) WHERE marketplace IS NOT NULL AND marketplace != '' ORDER BY marketplace ASC
    `).all();
    return json({ marketplaces: (result.results || []).map((row) => row.marketplace) });
  }
  if (route === 'customer/session') {
    const customer = await customerSession(request, db);
    return customer ? json({ authenticated: true, user: customer }) : json({ authenticated: false }, 401);
  }
  if (route.startsWith('customer/account/')) {
    const customer = await customerSession(request, db);
    if (!customer) return error('Please login to your AIFRET account to continue.', 401);
    const resource = route.slice('customer/account/'.length);
    if (resource === 'profile') return json({ user: customer });
    if (resource === 'wishlist' || resource === 'recently-viewed' || resource === 'ai-previews') {
      const tables = {
        wishlist: ['customer_wishlist', 'added_at'],
        'recently-viewed': ['customer_recently_viewed', 'viewed_at'],
        'ai-previews': ['customer_ai_previews', 'created_at']
      };
      const [table, sortColumn] = tables[resource];
      const result = await db.prepare(
        `SELECT * FROM ${table} WHERE customer_id=? ORDER BY ${sortColumn} DESC${resource === 'recently-viewed' ? ' LIMIT 12' : ''}`
      ).bind(customer.customerId).all();
      return json({ items: result.results || [] });
    }
  }
  if (route.startsWith('ai-tryon/status/')) {
    const customer = await customerSession(request, db);
    if (!customer) return error('Please login to your AIFRET account to continue.', 401);
    const jobId = decodeURIComponent(route.slice('ai-tryon/status/'.length));
    const job = await db.prepare(`
      SELECT * FROM customer_ai_tryon_jobs WHERE id=? AND customer_id=?
    `).bind(jobId, customer.customerId).first();
    if (!job) return error('AI try-on job not found.', 404);
    const progress = job.status === 'completed' ? 100 : Math.min(95, Math.max(job.progress || 18, 18 + (job.id.length % 6) * 11));
    if (job.status === 'completed') {
      return json({ status: job.status, progress: 100, video_url: job.video_url || null });
    }
    await db.prepare('UPDATE customer_ai_tryon_jobs SET progress=? WHERE id=?').bind(progress, job.id).run();
    return json({ status: job.status, progress });
  }
  if (route.startsWith('uploads/')) {
    const key = route.slice('uploads/'.length);
    if (!/^[a-z0-9/_-]+\.(?:jpg|png|webp)$/i.test(key) || key.includes('..')) return error('Image not found', 404);
    if (key.startsWith('customer-uploads/')) {
      const customer = await customerSession(request, db);
      if (!customer || !key.startsWith(`customer-uploads/${customer.customerId}/`)) {
        return error('Image not found', 404);
      }
    }
    return imageObjectResponse(env, key);
  }
  return error('Not Found', 404);
}

async function handlePost(request, env, db, route) {
  const body = ['admin/logout', 'customer/logout'].includes(route) ? {} : await requestBody(request);
  if (route === 'admin/login') {
    await provisionFirstAdmin(env, db);
    const username = String(body.username || '').trim();
    const password = String(body.password || '');
    if (!username || !password) return error('Username and password required');
    const user = await db.prepare('SELECT id, username, password_hash, salt FROM admin_users WHERE username=?')
      .bind(username).first();
    if (!user || !await verifyPassword(password, user.password_hash, user.salt)) {
      return error('Invalid username or password', 401);
    }
    const token = randomHex(32);
    const created = now();
    const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    await db.prepare(`
      INSERT INTO admin_sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)
    `).bind(await digest(token), user.id, created, expires).run();
    return json({ success: true, username: user.username }, 200, {
      'Set-Cookie': cookieHeader(SESSION_COOKIE, token, 604800)
    });
  }
  if (route === 'admin/logout') {
    const token = cookieValue(request, SESSION_COOKIE);
    if (token) await db.prepare('DELETE FROM admin_sessions WHERE token_hash=?').bind(await digest(token)).run();
    return json({ success: true }, 200, { 'Set-Cookie': cookieHeader(SESSION_COOKIE, '', 0) });
  }
  if (route === 'customer/signup') return signup(body, db);
  if (route === 'customer/login') return customerLogin(body, db);
  if (route === 'customer/logout') {
    const token = cookieValue(request, CUSTOMER_COOKIE);
    if (token) await db.prepare('DELETE FROM customer_sessions WHERE token_hash=?').bind(await digest(token)).run();
    return json({ success: true }, 200, { 'Set-Cookie': cookieHeader(CUSTOMER_COOKIE, '', 0) });
  }
  if (route === 'customer/forgot-password') {
    return json({ success: true, message: 'If the account exists, password reset instructions have been sent.' });
  }
  if (route === 'customer/account/wishlist' || route === 'customer/account/recently-viewed') {
    const customer = await customerSession(request, db);
    if (!customer) return error('Please login to your AIFRET account to continue.', 401);
    const productId = String(body.productId || body.product_id || '').trim();
    if (!productId) return error('Product ID is required');
    if (route.endsWith('/wishlist')) {
      await db.prepare(`
        INSERT OR IGNORE INTO customer_wishlist (id, customer_id, product_id, product_name, product_image, added_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).bind(
        `wishlist-${randomHex(8)}`, customer.customerId, productId,
        String(body.productName || '').trim(), String(body.productImage || '').trim(), now()
      ).run();
      return json({ success: true, saved: true });
    }
    const exists = await db.prepare(
      'SELECT id FROM customer_recently_viewed WHERE customer_id=? AND product_id=? LIMIT 1'
    ).bind(customer.customerId, productId).first();
    if (!exists) {
      await db.prepare(`
        INSERT INTO customer_recently_viewed (id, customer_id, product_id, product_name, product_image, viewed_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).bind(
        `recent-${randomHex(8)}`, customer.customerId, productId,
        String(body.productName || '').trim(), String(body.productImage || '').trim(), now()
      ).run();
    }
    return json({ success: true });
  }
  if (route === 'ai-tryon/generate') {
    const customer = await customerSession(request, db);
    if (!customer) return error('Please login to your AIFRET account to continue.', 401);
    const customerId = String(body.customer_id || body.customerId || customer.customerId).trim();
    const productId = String(body.product_id || body.productId || '').trim();
    const productImage = String(body.product_image || body.productImage || '').trim();
    const productName = String(body.product_name || body.productName || '').trim();
    if (!productId) return error('Product ID is required');
    if (customerId !== customer.customerId) return error('Customer identity mismatch.', 403);
    const image = decodeDataUrl(body.customer_photo || body.customerPhoto || '');
    if (!image) return error('Uploaded photo must be a valid JPG, PNG, or WebP image under 10MB.');
    const product = await db.prepare('SELECT * FROM products WHERE id=?').bind(productId).first();
    if (!product) return error('Selected product was not found.', 404);
    const inProgress = await db.prepare(`
      SELECT COUNT(*) AS count FROM customer_ai_tryon_jobs WHERE customer_id=? AND status IN ('queued','processing')
    `).bind(customer.customerId).first();
    if (inProgress.count > 0) return error('A try-on generation is already in progress for your account. Please wait for it to finish.', 409);
    const completed = await db.prepare(`
      SELECT COUNT(*) AS count FROM customer_ai_tryon_jobs WHERE customer_id=? AND status='completed'
    `).bind(customer.customerId).first();
    const limit = Math.max(1, Number.parseInt(env.AI_VIDEO_MAX_GENERATIONS_PER_CUSTOMER || '3', 10));
    if (completed.count >= limit) return error(`You have reached the generation limit of ${limit} videos for this account.`, 429);
    const photoUrl = await putImage(env, image, `customer-uploads/${customer.customerId}`);
    const jobId = `ai-tryon-${randomHex(12)}`;
    const providerJobId = `mock-tryon-${randomHex(10)}`;
    await db.prepare(`
      INSERT INTO customer_ai_tryon_jobs
        (id, customer_id, product_id, product_name, product_image, uploaded_photo, video_url,
         provider_job_id, provider, status, progress, created_at, completed_at, error_message)
      VALUES (?, ?, ?, ?, ?, ?, '', ?, 'mock', 'processing', 18, ?, '', '')
    `).bind(
      jobId, customer.customerId, productId, productName || product.name,
      productImage || product.image, photoUrl, providerJobId, now()
    ).run();
    return json({ success: true, job_id: jobId, status: 'processing', progress: 18, message: 'Queued for AI fashion video generation.' });
  }
  if (route === 'upload') {
    if (!await adminSession(request, db)) return error('Unauthorized', 401);
    const image = decodeDataUrl(body.data);
    if (!image) return error('Image content must be a valid JPEG, PNG, or WebP file smaller than 10 MB');
    return json({ url: await putImage(env, image, 'products') });
  }
  if (route === 'products') {
    const admin = await adminSession(request, db);
    if (!admin) return error('Unauthorized', 401);
    return addProduct(body, env, db, admin);
  }
  return error('Not Found', 404);
}

async function handlePut(request, env, db, route) {
  const body = await requestBody(request);
  if (route === 'customer/account/profile') {
    const customer = await customerSession(request, db);
    if (!customer) return error('Please login to your AIFRET account to continue.', 401);
    const fullName = String(body.fullName ?? customer.fullName).trim();
    const email = String(body.email ?? customer.email).trim().toLowerCase();
    const mobile = String(body.mobile ?? customer.mobile).trim();
    if (!fullName || !email || !mobile) return error('Full name, email, and mobile are required');
    try {
      await db.prepare(`
        UPDATE customer_users SET full_name=?, email=?, mobile=?, updated_at=? WHERE id=?
      `).bind(fullName, email, mobile, now(), customer.id).run();
    } catch (exception) {
      if (/unique|constraint/i.test(exception.message)) return error('This email or mobile number is already in use.', 409);
      throw exception;
    }
    return json({ success: true, user: { ...customer, fullName, email, mobile } });
  }
  if (route.startsWith('products/')) {
    const admin = await adminSession(request, db);
    if (!admin) return error('Unauthorized', 401);
    const id = decodeURIComponent(route.slice('products/'.length));
    if (!id || id.includes('/')) return error('Not Found', 404);
    return updateProduct(id, body, env, db, admin);
  }
  return error('Not Found', 404);
}

async function handlePatch(request, db, route) {
  const admin = await adminSession(request, db);
  if (!admin) return error('Unauthorized', 401);
  const match = /^products\/([^/]+)\/(status|featured|best-value)$/.exec(route);
  if (!match) return error('Not Found', 404);
  const productId = decodeURIComponent(match[1]);
  const field = { status: 'status', featured: 'featured', 'best-value': 'best_value' }[match[2]];
  const product = await db.prepare('SELECT * FROM products WHERE id=?').bind(productId).first();
  if (!product) return error('Product not found', 404);
  let value;
  if (field === 'status') {
    value = product.status === 'active' ? 'inactive' : 'active';
    if (value === 'active' && !product.image) return error('A product image is required before publishing');
    await db.prepare('UPDATE products SET status=?, updated_at=? WHERE id=?').bind(value, now(), productId).run();
  } else {
    value = product[field] ? 0 : 1;
    await db.prepare(`UPDATE products SET ${field}=?, updated_at=? WHERE id=?`).bind(value, now(), productId).run();
  }
  await writeAudit(db, admin, field === 'status' ? (value === 'active' ? 'publish' : 'unpublish') : 'toggle', 'product', productId, { field, value });
  return json({ success: true, field, value });
}

async function handleDelete(request, db, route, url) {
  if (route === 'customer/account/wishlist') {
    const customer = await customerSession(request, db);
    if (!customer) return error('Please login to your AIFRET account to continue.', 401);
    const body = await requestBody(request);
    const productId = String(body.productId || body.product_id || '').trim();
    if (!productId) return error('Product ID is required');
    await db.prepare('DELETE FROM customer_wishlist WHERE customer_id=? AND product_id=?')
      .bind(customer.customerId, productId).run();
    return json({ success: true, saved: false });
  }
  if (route.startsWith('customer/account/ai-previews/')) {
    const customer = await customerSession(request, db);
    if (!customer) return error('Please login to your AIFRET account to continue.', 401);
    const previewId = decodeURIComponent(route.slice('customer/account/ai-previews/'.length));
    await db.prepare('DELETE FROM customer_ai_previews WHERE customer_id=? AND preview_id=?')
      .bind(customer.customerId, previewId).run();
    return json({ success: true });
  }
  if (!route.startsWith('products/')) return error('Not Found', 404);
  const admin = await adminSession(request, db);
  if (!admin) return error('Unauthorized', 401);
  const productId = decodeURIComponent(route.slice('products/'.length));
  if (!productId || productId.includes('/')) return error('Not Found', 404);
  const product = await db.prepare('SELECT id FROM products WHERE id=?').bind(productId).first();
  if (!product) return error('Product not found', 404);
  const permanent = url.searchParams.get('permanent') === 'true';
  if (permanent) {
    await db.batch([
      db.prepare('DELETE FROM product_offers WHERE product_id=?').bind(productId),
      db.prepare('DELETE FROM products WHERE id=?').bind(productId),
      db.prepare(`INSERT INTO audit_logs
        (id, admin_user_id, admin_username, action, entity_type, entity_id, details, created_at)
        VALUES (?, ?, ?, 'delete', 'product', ?, ?, ?)`)
        .bind(`audit-${randomHex(8)}`, admin.user_id, admin.username, productId, JSON.stringify({ permanent: true }), now())
    ]);
    return json({ success: true, message: 'Product permanently deleted', permanent: true });
  }
  await db.batch([
    db.prepare("UPDATE products SET status='inactive', updated_at=? WHERE id=?").bind(now(), productId),
    db.prepare(`INSERT INTO audit_logs
      (id, admin_user_id, admin_username, action, entity_type, entity_id, details, created_at)
      VALUES (?, ?, ?, 'unpublish', 'product', ?, ?, ?)`)
      .bind(`audit-${randomHex(8)}`, admin.user_id, admin.username, productId, JSON.stringify({ permanent: false }), now())
  ]);
  return json({ success: true, message: 'Product deactivated (soft-deleted)', permanent: false });
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const route = url.pathname.replace(/^\/api\/?/, '');
  const method = request.method.toUpperCase();

  if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].includes(method)) {
    return error('Method Not Allowed', 405);
  }
  if (method === 'OPTIONS') return new Response(null, { status: 204, headers: { Allow: 'GET, POST, PUT, PATCH, DELETE, OPTIONS' } });
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) && !sameOrigin(request)) {
    return error('Cross-origin request rejected', 403);
  }

  try {
    const db = database(env);
    if (method === 'GET') return await handleGet(request, env, db, route, url);
    if (method === 'POST') return await handlePost(request, env, db, route);
    if (method === 'PUT') return await handlePut(request, env, db, route);
    if (method === 'PATCH') return await handlePatch(request, db, route);
    return await handleDelete(request, db, route, url);
  } catch (exception) {
    if (exception.status) return error(exception.message, exception.status);
    console.error('AIFRET API request failed:', exception.message);
    return error('The server could not complete the request. Please try again later.', 500);
  }
}
