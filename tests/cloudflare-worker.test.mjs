import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

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

const workerText = await readFile(new URL('../functions/api/[[path]].js', import.meta.url), 'utf8');
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
