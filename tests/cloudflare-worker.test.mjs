import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

class MemoryD1 {
  admins = [];
  sessions = [];

  prepare(query) {
    const sql = query.replace(/\s+/g, ' ').trim().toLowerCase();
    const params = [];
    const statement = {
      bind: (...values) => {
        params.push(...values);
        return statement;
      },
      first: async () => {
        if (sql.includes('select count(*) as count from admin_users')) {
          return { count: this.admins.length };
        }
        if (sql.includes('select count(*) as total from products p')) return { total: 0 };
        if (sql.includes('select count(*) as total, sum(case when status')) {
          return { total: 0, published: 0, drafts: 0, featured: 0, best_value: 0 };
        }
        if (sql.includes('from admin_users where username=?')) {
          const user = this.admins.find((admin) => admin.username === params[0]);
          return user ? { ...user } : null;
        }
        if (sql.includes('from admin_sessions s join admin_users u')) {
          const session = this.sessions.find(
            (entry) => entry.token_hash === params[0] && entry.expires_at > params[1]
          );
          if (!session) return null;
          const user = this.admins.find((admin) => admin.id === session.user_id);
          return user ? { user_id: user.id, username: user.username } : null;
        }
        if (sql.includes('from customer_sessions s join customer_users u')) return null;
        throw new Error(`Unsupported D1 first() query in test: ${sql}`);
      },
      run: async () => {
        if (sql.startsWith('insert or ignore into admin_users')) {
          if (!this.admins.some((admin) => admin.username === params[1])) {
            this.admins.push({
              id: params[0], username: params[1], password_hash: params[2],
              salt: params[3], created_at: params[4]
            });
          }
          return { success: true };
        }
        if (sql.startsWith('insert into admin_sessions')) {
          this.sessions.push({
            token_hash: params[0], user_id: params[1], created_at: params[2], expires_at: params[3]
          });
          return { success: true };
        }
        if (sql.startsWith('delete from admin_sessions')) {
          this.sessions = this.sessions.filter((session) => session.token_hash !== params[0]);
          return { success: true };
        }
        throw new Error(`Unsupported D1 run() query in test: ${sql}`);
      },
      all: async () => {
        if (sql.includes('from products where product_url')) return { results: [] };
        if (sql.startsWith('select p.* from products p')) return { results: [] };
        if (sql.startsWith('select distinct category from products')) return { results: [] };
        if (sql.startsWith('select distinct marketplace from product_offers')) return { results: [] };
        throw new Error(`Unsupported D1 all() query in test: ${sql}`);
      }
    };
    return statement;
  }
}

class SqliteD1 {
  constructor(schema) {
    this.sqlite = new DatabaseSync(':memory:');
    this.sqlite.exec(schema);
  }

  prepare(query) {
    const values = [];
    const statement = {
      bind: (...bound) => {
        values.push(...bound);
        return statement;
      },
      first: async () => this.sqlite.prepare(query).get(...values) || null,
      all: async () => ({ results: this.sqlite.prepare(query).all(...values) }),
      run: async () => this.sqlite.prepare(query).run(...values)
    };
    return statement;
  }

  async batch(statements) {
    for (const statement of statements) await statement.run();
    return { success: true };
  }
}

const workerText = await readFile(new URL('../functions/api/[[path]].js', import.meta.url), 'utf8');
test('product creation SQL keeps D1 product columns and placeholders aligned', () => {
  const insert = workerText.match(/INSERT INTO products \([\s\S]*?\) VALUES \([\s\S]*?\)`/i);
  assert.ok(insert, 'product creation INSERT statement should exist');
  assert.equal((insert[0].match(/\?/g) || []).length, 39);
});

test('product update SQL keeps D1 product columns and placeholders aligned', () => {
  const update = workerText.match(/UPDATE products SET[\s\S]*?WHERE id=\?/i);
  assert.ok(update, 'product update UPDATE statement should exist');
  assert.equal((update[0].match(/\?/g) || []).length, 37);
});

test('PUT product update succeeds against a real SQLite schema and updates offers atomically', async () => {
  const schema = [
    await readFile(new URL('../migrations/0001_cloudflare_schema.sql', import.meta.url), 'utf8'),
    await readFile(new URL('../migrations/0002_affiliate_import_currency.sql', import.meta.url), 'utf8')
  ];
  const db = new SqliteD1(schema.join('\n'));
  const token = 'test-update-session';
  const tokenHash = Buffer.from(await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(token))).toString('hex');
  const timestamp = new Date().toISOString();
  db.sqlite.prepare('INSERT INTO admin_users (id, username, password_hash, salt, created_at) VALUES (?, ?, ?, ?, ?)')
    .run('admin-1', 'test-admin', 'unused', 'unused', timestamp);
  db.sqlite.prepare('INSERT INTO admin_sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .run(tokenHash, 'admin-1', timestamp, '2999-01-01T00:00:00.000Z');
  db.sqlite.prepare(`INSERT INTO products
    (id, name, brand, category, subcategory, description, key_features, specifications,
     variants, image, additional_images, mrp, selling_price, discount, marketplace,
     product_url, rating, review_count, availability, stock_status, featured, best_value,
     status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run('collared-neck-5bdc30', 'Collared Neck', 'AIFRET', 'Fashion', '', '', '["old"]', '{"old":true}',
      '[]', 'https://images.example.test/collared.jpg', '[]', 2199, 638, 71, 'Amazon',
      'https://www.amazon.in/dp/TEST', 0, 0, 'In Stock', 'in_stock', 1, 1, 'active', timestamp, timestamp);
  db.sqlite.prepare(`INSERT INTO product_offers
    (id, product_id, marketplace, price, mrp, product_url, affiliate_url, availability, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run('offer-old', 'collared-neck-5bdc30', 'Amazon', 638, 2199, 'https://www.amazon.in/dp/TEST',
      'https://www.amazon.in/dp/TEST?tag=aifret-21', 'In Stock', timestamp);

  const response = await request({ AIFRET_DB: db }, '/api/products/collared-neck-5bdc30', {
    method: 'PUT',
    cookie: `aifret_session=${token}`,
    body: {
      name: 'Collared Neck Updated', brand: 'AIFRET', category: 'Fashion', marketplace: 'Amazon',
      mrp: 2499, selling_price: 749, product_url: 'https://www.amazon.in/dp/TEST',
      affiliate_url: 'https://www.amazon.in/dp/TEST?tag=aifret-21', image: 'https://images.example.test/collared.jpg',
      stock_status: 'in_stock', status: 'active', featured: 1, best_value: 1,
      offers: [{ marketplace: 'Flipkart', price: 799, mrp: 2499,
        product_url: 'https://www.flipkart.com/item/TEST', affiliate_url: 'https://www.flipkart.com/item/TEST?affid=aifret' }]
    }
  });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.success, true);
  assert.equal(result.product.name, 'Collared Neck Updated');
  assert.equal(result.product.discount, 70);
  assert.deepEqual(result.product.offers.map((offer) => offer.marketplace), ['Amazon', 'Flipkart']);

  const invalidImage = await request({ AIFRET_DB: db }, '/api/products/collared-neck-5bdc30', {
    method: 'PUT', cookie: `aifret_session=${token}`,
    body: { image: 'https://amzn.in/d/08klyARP', status: 'active' }
  });
  assert.equal(invalidImage.status, 400);
  const invalidImageResult = await invalidImage.json();
  assert.match(invalidImageResult.message, /marketplace short link/i);
  assert.equal('stack' in invalidImageResult, false);
});
const runnableWorker = workerText
  .replace('export async function onRequest(context)', 'async function onRequest(context)')
  .concat('\nglobalThis.worker = onRequest;');
const workerErrors = [];
const context = vm.createContext({
  atob: (value) => Buffer.from(value, 'base64').toString('binary'),
  console: { error(...args) { workerErrors.push(args); } },
  crypto: webcrypto,
  Headers,
  Request,
  Response,
  TextEncoder,
  URL,
  Uint8Array
});
vm.runInContext(runnableWorker, context);

async function request(env, pathname, { method = 'GET', body, cookie } = {}) {
  const headers = new Headers();
  if (body !== undefined) headers.set('Content-Type', 'application/json');
  if (cookie) headers.set('Cookie', cookie);
  return context.worker({
    request: new Request(`https://aifret.in${pathname}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    }),
    env
  });
}

test('Cloudflare admin login, session persistence, protected APIs, and logout', async () => {
  const db = new MemoryD1();
  const env = {
    AIFRET_DB: db,
    AIFRET_ADMIN_USERNAME: 'test-admin',
    AIFRET_ADMIN_PASSWORD: 'test-password-never-used-in-production'
  };

  const unauthenticatedSession = await request(env, '/api/admin/session');
  assert.equal(unauthenticatedSession.status, 401);
  const publicProducts = await request(env, '/api/products');
  assert.equal(publicProducts.status, 200);
  assert.deepEqual((await publicProducts.json()).products, []);

  const invalidLogin = await request(env, '/api/admin/login', {
    method: 'POST',
    body: { username: 'test-admin', password: 'wrong-password' }
  });
  assert.equal(invalidLogin.status, 401);

  const login = await request(env, '/api/admin/login', {
    method: 'POST',
    body: { username: 'test-admin', password: env.AIFRET_ADMIN_PASSWORD }
  });
  assert.equal(login.status, 200);
  const setCookie = login.headers.get('Set-Cookie');
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /Secure/);
  const cookie = setCookie.split(';', 1)[0];

  const refreshedSession = await request(env, '/api/admin/session', { cookie });
  assert.equal(refreshedSession.status, 200);
  assert.equal((await refreshedSession.json()).authenticated, true);
  const dashboardProducts = await request(env, '/api/products?status=all', { cookie });
  assert.equal(dashboardProducts.status, 200);
  const dashboardData = await dashboardProducts.json();
  assert.deepEqual(dashboardData.products, []);
  assert.deepEqual(dashboardData.stats, { total: 0, published: 0, drafts: 0, featured: 0, best_value: 0 });

  const protectedApi = await request(env, '/api/admin/audit-logs');
  assert.equal(protectedApi.status, 401);
  const protectedWrite = await request(env, '/api/products', { method: 'POST', body: {} });
  assert.equal(protectedWrite.status, 401);
  const privateCustomerPhoto = await request(env, '/api/uploads/customer-uploads/AIFRET-CUS-000001/photo.jpg');
  assert.equal(privateCustomerPhoto.status, 404);

  const logout = await request(env, '/api/admin/logout', { method: 'POST', cookie });
  assert.equal(logout.status, 200);
  const invalidatedSession = await request(env, '/api/admin/session', { cookie });
  assert.equal(invalidatedSession.status, 401);
});

test('unexpected backend errors are logged privately and return a correlatable generic error', async () => {
  const response = await request({}, '/api/admin/session');
  const result = await response.json();

  assert.equal(response.status, 503);
  assert.equal(response.headers.get('X-Request-ID'), result.requestId);
  assert.match(result.message, /database is not ready/i);
  assert.equal('stack' in result, false);
  assert.match(JSON.stringify(workerErrors), /D1 binding AIFRET_DB is missing/);
  assert.match(JSON.stringify(workerErrors), new RegExp(result.requestId));
});

test('affiliate import validates marketplace URLs and exposes manual fallback', async () => {
  const db = new MemoryD1();
  const env = {
    AIFRET_DB: db,
    AIFRET_ADMIN_USERNAME: 'test-admin',
    AIFRET_ADMIN_PASSWORD: 'test-password-never-used-in-production'
  };
  const login = await request(env, '/api/admin/login', {
    method: 'POST', body: { username: 'test-admin', password: env.AIFRET_ADMIN_PASSWORD }
  });
  const cookie = login.headers.get('Set-Cookie').split(';', 1)[0];

  const amazon = await request(env, '/api/admin/import-preview', {
    method: 'POST', cookie, body: { url: 'https://link.amazon/B00PdedXH?tag=aifret-21' }
  });
  assert.equal(amazon.status, 424);
  const amazonResult = await amazon.json();
  assert.equal(amazonResult.marketplace, 'Amazon');
  assert.equal(amazonResult.affiliate_url, 'https://link.amazon/B00PdedXH?tag=aifret-21');
  assert.equal(amazonResult.manual_fallback, true);

  const unsupported = await request(env, '/api/admin/import-preview', {
    method: 'POST', cookie, body: { url: 'https://unsupported.example/item' }
  });
  assert.equal(unsupported.status, 422);
  assert.match((await unsupported.json()).message, /unsupported marketplace/i);
});
