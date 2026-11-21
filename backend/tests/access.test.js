const { test } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const database = require('../dist/config/database');
const app = require('../dist/app').default;
const { generateToken } = require('../dist/config/jwt');

test('admin and sellers can manage only their permitted stores', async (t) => {
  const ids = {
    admin: '00000000-0000-4000-8000-000000000001',
    seller1: '00000000-0000-4000-8000-000000000002',
    seller2: '00000000-0000-4000-8000-000000000003',
    customer: '00000000-0000-4000-8000-000000000004',
    store: '00000000-0000-4000-8000-000000000005',
    product: '00000000-0000-4000-8000-000000000006',
  };
  const users = {
    [ids.admin]: 'admin',
    [ids.seller1]: 'business',
    [ids.seller2]: 'business',
    [ids.customer]: 'customer',
  };
  const passwordHash = await bcrypt.hash('test-password', 4);
  let owner = ids.seller1;
  let createdSeller;
  let createdStore;
  let updatedStore;
  let transferDuringUpdate = false;
  const originalQuery = database.query;
  database.query = async (sql, params = []) => {
    if (sql.includes('SELECT id, user_type FROM users')) {
      return { rows: users[params[0]] ? [{ id: params[0], user_type: users[params[0]] }] : [] };
    }
    if (sql.includes('SELECT * FROM users WHERE email')) {
      return { rows: [{ id: ids.seller1, email: params[0], full_name: 'Lojista', user_type: 'business', password_hash: passwordHash }] };
    }
    if (sql.includes("SELECT id FROM users WHERE id = $1 AND user_type = 'business'")) {
      return { rows: users[params[0]] === 'business' ? [{ id: params[0] }] : [] };
    }
    if (sql.includes('SELECT owner_id FROM businesses')) {
      return { rows: params[0] === ids.store ? [{ owner_id: owner }] : [] };
    }
    if (sql.includes('SELECT b.owner_id FROM products')) {
      return { rows: params[0] === ids.product ? [{ owner_id: owner }] : [] };
    }
    if (sql.includes('SELECT * FROM businesses WHERE id')) {
      return { rows: [{ id: ids.store, owner_id: owner }] };
    }
    if (sql.includes('UPDATE businesses SET owner_id')) {
      owner = params[0];
      return { rows: [{ id: ids.store, owner_id: owner }] };
    }
    if (sql.includes('UPDATE businesses SET')) {
      if (transferDuringUpdate) {
        owner = ids.seller2;
        transferDuringUpdate = false;
      }
      if (sql.includes('AND owner_id =') && params[params.length - 1] !== owner) return { rows: [] };
      updatedStore = { id: params[0], name: params[1], category: params[2], description: params[3], owner_id: owner };
      return { rows: [updatedStore] };
    }
    if (sql.includes('UPDATE products SET')) {
      return { rows: [{ id: ids.product, stock: params[1] }] };
    }
    if (sql.includes('INSERT INTO users')) {
      createdSeller = { id: params[0], email: params[1], full_name: params[3], user_type: params[5] };
      return { rows: [createdSeller] };
    }
    if (sql.includes('INSERT INTO businesses')) {
      createdStore = { id: params[0], owner_id: params[1], name: params[2] };
      return { rows: [createdStore] };
    }
    throw new Error(`Unexpected query: ${sql}`);
  };
  t.after(async () => {
    database.query = originalQuery;
    await database.default.end();
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(url, userId, method = 'GET', body) {
    const headers = {};
    if (userId) headers.Authorization = `Bearer ${generateToken({ id: userId })}`;
    if (body) headers['Content-Type'] = 'application/json';
    const result = await fetch(base + url, { method, headers, body: body && JSON.stringify(body) });
    return { status: result.status, body: await result.json() };
  }

  const login = await request('/api/auth/login', null, 'POST', { email: 'seller@example.test', password: 'test-password' });
  assert.equal(login.body.user.user_type, 'business');
  assert.equal((await request('/api/auth/register', null, 'POST', { email: 'x@example.test', password: 'test-password', fullName: 'X', userType: 'admin' })).status, 403);
  assert.equal((await request('/api/auth/register', null, 'POST', { email: 'x@example.test', password: 'test-password', fullName: 'X', userType: 'business' })).status, 403);
  assert.equal((await request('/api/admin/sellers', ids.seller1)).status, 403);
  assert.equal((await request('/api/admin/sellers', ids.admin, 'POST', { fullName: 'Novo', email: 'novo@example.test', password: 'short' })).status, 400);
  assert.equal((await request('/api/admin/sellers', ids.admin, 'POST', { fullName: 'Novo', email: 'novo@example.test', password: 'test-password' })).status, 201);
  assert.equal(createdSeller.user_type, 'business');
  assert.equal((await request('/api/businesses', ids.seller1, 'POST', { name: 'Loja nova', ownerId: ids.seller1 })).status, 403);
  assert.equal((await request('/api/businesses', ids.admin, 'POST', { name: 'Loja nova', ownerId: ids.seller1 })).status, 201);
  assert.equal(createdStore.owner_id, ids.seller1);
  assert.equal((await request(`/api/businesses/${ids.store}`, ids.seller1)).status, 200);
  assert.equal((await request(`/api/businesses/${ids.store}`, ids.seller2)).status, 403);
  assert.equal((await request(`/api/businesses/${ids.store}`, ids.customer)).status, 403);
  assert.equal((await request(`/api/businesses/${ids.store}`, ids.admin)).status, 200);
  assert.equal((await request('/api/products', ids.seller2, 'POST', { businessId: ids.store })).status, 403);
  assert.equal((await request(`/api/products/${ids.product}`, ids.seller2, 'PUT', { quantity: 3 })).status, 403);
  assert.equal((await request(`/api/products/${ids.product}`, ids.seller1, 'PUT', { quantity: 0 })).status, 200);
  assert.equal((await request(`/api/businesses/${ids.store}`, ids.seller1, 'PUT', { owner_id: ids.seller2 })).status, 400);
  const edits = { name: ' Loja atualizada ', category: ' roupas ', description: ' Nova descrição ' };
  assert.equal((await request(`/api/businesses/${ids.store}`, ids.seller1, 'PUT', edits)).status, 200);
  assert.deepEqual(updatedStore, { id: ids.store, name: 'Loja atualizada', category: 'roupas', description: 'Nova descrição', owner_id: ids.seller1 });
  assert.equal((await request(`/api/businesses/${ids.store}`, ids.seller2, 'PUT', edits)).status, 403);
  assert.equal((await request(`/api/businesses/${ids.store}`, ids.customer, 'PUT', edits)).status, 403);
  assert.equal((await request(`/api/businesses/${ids.store}`, ids.admin, 'PUT', edits)).status, 200);
  for (const invalid of [{ name: '  ' }, { name: 123 }, { category: {} }, { description: 1 }, {}]) {
    assert.equal((await request(`/api/businesses/${ids.store}`, ids.seller1, 'PUT', invalid)).status, 400);
  }
  transferDuringUpdate = true;
  assert.equal((await request(`/api/businesses/${ids.store}`, ids.seller1, 'PUT', edits)).status, 403);
  owner = ids.seller1;
  assert.equal((await request(`/api/admin/businesses/${ids.store}/owner`, ids.seller1, 'PUT', { ownerId: ids.seller2 })).status, 403);
  assert.equal((await request(`/api/admin/businesses/${ids.store}/owner`, ids.admin, 'PUT', { ownerId: ids.customer })).status, 400);
  assert.equal((await request(`/api/admin/businesses/${ids.store}/owner`, ids.admin, 'PUT', { ownerId: ids.seller2 })).status, 200);
  assert.equal((await request(`/api/products/${ids.product}`, ids.seller1, 'PUT', { quantity: 2 })).status, 403);
  assert.equal((await request(`/api/products/${ids.product}`, ids.seller2, 'PUT', { quantity: 2 })).status, 200);
});
