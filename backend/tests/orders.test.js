const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const database = require('../dist/config/database');
const controller = require('../dist/controllers/OrderController').default;
const originalGetClient = database.getClient;

const products = [
  { id: '00000000-0000-0000-0000-000000000001', business_id: 'store-1', name: 'Produto A', price: '12.50', stock: 5 },
  { id: '00000000-0000-0000-0000-000000000002', business_id: 'store-2', name: 'Produto B', price: '7.25', stock: 3 },
];

after(async () => {
  database.getClient = originalGetClient;
  await database.default.end();
});

function request() {
  return {
    userId: 'customer-1',
    userType: 'customer',
    body: {
      items: products.map((product) => ({ productId: product.id, quantity: 2, price: Number(product.price) })),
      paymentMethod: 'pix',
      deliveryType: 'delivery',
      deliveryAddress: 'Rua de teste, 10',
    },
  };
}

function response() {
  return { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}

function mockClient(rows = products, failOnUpdate = false) {
  return {
    calls: [],
    released: false,
    async query(sql, values) {
      this.calls.push([sql, values]);
      if (failOnUpdate && sql.includes('UPDATE products')) throw new Error('Falha simulada');
      return { rows: sql.includes('FOR UPDATE OF p') ? rows : [] };
    },
    release() { this.released = true; },
  };
}

test('cria pedidos separados por loja e grava itens e estoque na mesma transação', async () => {
  const client = mockClient();
  database.getClient = async () => client;
  const res = response();
  await controller.createOrder(request(), res);

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.orderIds.length, 2);
  assert.equal(client.calls[0][0], 'BEGIN');
  assert.equal(client.calls.at(-1)[0], 'COMMIT');
  const orders = client.calls.filter(([sql]) => sql.includes('INSERT INTO orders'));
  assert.deepEqual(orders.map(([, values]) => [values[2], values[4], values[5], values[6], values[7]]), [
    ['store-1', '25.00', 'pix', 'delivery', 'Rua de teste, 10'],
    ['store-2', '14.50', 'pix', 'delivery', 'Rua de teste, 10'],
  ]);
  const items = client.calls.filter(([sql]) => sql.includes('INSERT INTO order_items'));
  assert.deepEqual(items.map(([, values]) => values.slice(2)), [
    [products[0].id, 'Produto A', '12.50', 2, '25.00'],
    [products[1].id, 'Produto B', '7.25', 2, '14.50'],
  ]);
  assert.equal(client.calls.filter(([sql]) => sql.includes('UPDATE products')).length, 2);
  assert.equal(client.released, true);
});

test('agrupa produtos da mesma loja e permite retirada sem endereço', async () => {
  const client = mockClient([products[0], { ...products[1], business_id: 'store-1' }]);
  database.getClient = async () => client;
  const req = request();
  req.body.deliveryType = 'pickup';
  req.body.deliveryAddress = '';
  const res = response();
  await controller.createOrder(req, res);
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.orderIds.length, 1);
  const orders = client.calls.filter(([sql]) => sql.includes('INSERT INTO orders'));
  assert.equal(orders[0][1][4], '39.50');
  assert.equal(orders[0][1][7], null);
});

test('rejeita itens, pagamento ou endereço inválidos antes de abrir transação', async () => {
  for (const change of [
    (req) => { req.body.items[0].quantity = 0; },
    (req) => { req.body.items.push(req.body.items[0]); },
    (req) => { req.body.paymentMethod = ''; },
    (req) => { req.body.deliveryAddress = '  '; },
  ]) {
    database.getClient = async () => { throw new Error('Não deveria abrir transação'); };
    const req = request();
    change(req);
    const res = response();
    await controller.createOrder(req, res);
    assert.equal(res.statusCode, 400);
  }
});

test('impede que perfis não clientes criem pedidos', async () => {
  const req = request();
  req.userType = 'business';
  const res = response();
  await controller.createOrder(req, res);
  assert.equal(res.statusCode, 403);
});

test('desfaz a transação quando um produto está indisponível, sem estoque ou com preço alterado', async () => {
  for (const rows of [[{ ...products[0], stock: 1 }, products[1]], [{ ...products[0], price: '13.50' }, products[1]], [products[0]]]) {
    const client = mockClient(rows);
    database.getClient = async () => client;
    const res = response();
    await controller.createOrder(request(), res);
    assert.equal(res.statusCode, 409);
    assert.ok(client.calls.some(([sql]) => sql === 'ROLLBACK'));
    assert.equal(client.calls.some(([sql]) => sql.includes('INSERT INTO orders')), false);
    assert.equal(client.released, true);
  }
});

test('desfaz todos os pedidos se uma gravação falhar', async () => {
  const client = mockClient(products, true);
  database.getClient = async () => client;
  const originalError = console.error;
  console.error = () => {};
  try {
    const res = response();
    await controller.createOrder(request(), res);
    assert.equal(res.statusCode, 500);
    assert.ok(client.calls.some(([sql]) => sql === 'ROLLBACK'));
    assert.equal(client.calls.some(([sql]) => sql === 'COMMIT'), false);
    assert.equal(client.released, true);
  } finally {
    console.error = originalError;
  }
});
