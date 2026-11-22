const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const database = require('../dist/config/database');
const controller = require('../dist/controllers/OrderController').default;
const originalGetClient = database.getClient;

const products = [
  { id: '00000000-0000-0000-0000-000000000001', business_id: 'store-1', name: 'Produto A', price: '12.50', stock: 5, max_card_installments: 8, payment_methods: ['pix', 'credit_card'] },
  { id: '00000000-0000-0000-0000-000000000002', business_id: 'store-2', name: 'Produto B', price: '7.25', stock: 3, max_card_installments: 3, payment_methods: ['pix', 'credit_card'] },
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

test('abre checkout Sandbox de cartao com o preco do banco e ate 3 parcelas', async (t) => {
  const providerId = '10000000-0000-0000-0000-000000000001';
  const checkoutId = '20000000-0000-0000-0000-000000000002';
  const oldKey = process.env.ASAAS_API_KEY;
  const oldToken = process.env.ASAAS_WEBHOOK_TOKEN;
  t.after(() => {
    if (oldKey === undefined) delete process.env.ASAAS_API_KEY;
    else process.env.ASAAS_API_KEY = oldKey;
    if (oldToken === undefined) delete process.env.ASAAS_WEBHOOK_TOKEN;
    else process.env.ASAAS_WEBHOOK_TOKEN = oldToken;
  });
  process.env.ASAAS_API_KEY = 'sandbox-test-key';
  process.env.ASAAS_WEBHOOK_TOKEN = 'mock-webhook-token-for-uniweb-tests';
  const client = mockClient();
  database.getClient = async () => client;
  const provider = t.mock.method(globalThis, 'fetch', async () =>
    new Response(JSON.stringify({ id: providerId }), { status: 200 })
  );

  const req = request();
  req.body.paymentMethod = 'credit_card';
  req.body.checkoutId = checkoutId;
  const res = response();
  await controller.createOrder(req, res, true);

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.orderIds.length, 2);
  assert.equal(new URL(res.body.checkoutUrl).searchParams.get('id'), providerId);
  assert.equal(provider.mock.callCount(), 1);
  const [url, options] = provider.mock.calls[0].arguments;
  assert.equal(url, 'https://api-sandbox.asaas.com/v3/checkouts');
  const payload = JSON.parse(options.body);
  assert.equal(payload.externalReference, checkoutId);
  assert.deepEqual(payload.billingTypes, ['CREDIT_CARD']);
  assert.deepEqual(payload.installment, { maxInstallmentCount: 3 });
  assert.deepEqual(payload.items.map(({ value, quantity }) => [value, quantity]), [[12.50, 2], [7.25, 2]]);
  assert.ok(client.calls.some(([sql]) => sql.startsWith('INSERT INTO asaas_checkouts')));
  assert.equal(client.calls.at(-1)[0], 'COMMIT');
});

test('valida o token do webhook e confirma ou cancela os pedidos em transacao', async (t) => {
  const { asaasWebhook } = require('../dist/controllers/AsaasWebhook');
  const oldToken = process.env.ASAAS_WEBHOOK_TOKEN;
  t.after(() => {
    if (oldToken === undefined) delete process.env.ASAAS_WEBHOOK_TOKEN;
    else process.env.ASAAS_WEBHOOK_TOKEN = oldToken;
  });
  process.env.ASAAS_WEBHOOK_TOKEN = 'mock-webhook-token-for-uniweb-tests';
  const calls = [];
  database.getClient = async () => ({
    async query(sql) {
      calls.push(sql);
      return { rows: sql.includes('FOR UPDATE') ? [{ id: 'checkout-session' }] : [] };
    },
    release() {},
  });
  const req = {
    get: () => 'invalid-token',
    body: { event: 'CHECKOUT_PAID', checkout: { id: 'provider-id', status: 'PAID' } },
  };
  const res = { sendStatus(status) { return status; } };
  assert.equal(await asaasWebhook(req, res), 401);
  assert.equal(calls.length, 0);

  req.get = () => process.env.ASAAS_WEBHOOK_TOKEN;
  assert.equal(await asaasWebhook(req, res), 200);
  assert.ok(calls.some((sql) => sql.includes("SET payment_status = 'paid'")));
  assert.equal(calls.at(-1), 'COMMIT');

  req.body = { event: 'CHECKOUT_EXPIRED', checkout: { id: 'provider-id', status: 'EXPIRED' } };
  assert.equal(await asaasWebhook(req, res), 200);
  assert.ok(calls.some((sql) => sql.includes('stock = p.stock + r.units') && sql.includes("payment_status = 'pending'")));
  assert.equal(calls.at(-1), 'COMMIT');
});

test('bloqueia um meio de pagamento desativado por uma loja do carrinho', async () => {
  const client = mockClient([
    products[0],
    { ...products[1], payment_methods: ['credit_card'] },
  ]);
  database.getClient = async () => client;

  const res = response();
  await controller.createOrder(request(), res);

  assert.equal(res.statusCode, 409);
  assert.ok(client.calls.some(([sql]) => sql.includes('FOR SHARE OF b')));
  assert.equal(client.calls.some(([sql]) => sql.includes('INSERT INTO orders')), false);
  assert.equal(client.calls.at(-1)[0], 'ROLLBACK');
});

test('envia ao Asaas o limite da loja e omite parcelamento quando aceita apenas cartao a vista', async (t) => {
  const { createAsaasCheckout } = require('../dist/services/AsaasCheckout');
  const providerId = '10000000-0000-0000-0000-000000000001';
  const provider = t.mock.method(globalThis, 'fetch', async () =>
    new Response(JSON.stringify({ id: providerId }), { status: 200 })
  );
  const config = {
    key: 'sandbox-test-key',
    apiUrl: 'https://api-sandbox.asaas.com/v3',
    returnUrl: new URL('https://example.com/orders'),
  };
  const items = [{ name: 'Produto', quantity: 1, value: 300 }];

  await createAsaasCheckout(config, 'checkout-1', 'credit_card', items, 1);
  await createAsaasCheckout(config, 'checkout-2', 'credit_card', items, 12);
  const [single, multiple] = provider.mock.calls.map(({ arguments: [, options] }) => JSON.parse(options.body));

  assert.deepEqual(single.chargeTypes, ['DETACHED']);
  assert.equal(single.installment, undefined);
  assert.deepEqual(multiple.chargeTypes, ['DETACHED', 'INSTALLMENT']);
  assert.deepEqual(multiple.installment, { maxInstallmentCount: 12 });
});

test('calcula descontos em centavos e aplica apenas aos itens elegiveis', () => {
  const { applyCoupon, CouponError } = require('../dist/services/StoreCoupons');
  const items = [
    { product: { id: 'a', category: 'Roupas' }, subtotal: 999n },
    { product: { id: 'b', category: 'roupas' }, subtotal: 1999n },
    { product: { id: 'c', category: 'livros' }, subtotal: 500n },
  ];
  const base = { code: 'TESTE', discount_type: 'fixed', discount_value: 1000, scope: 'category', category: 'roupas', product_ids: [] };
  assert.deepEqual(applyCoupon(items, base).map((x) => x.discount), [333n, 667n, 0n]);
  assert.deepEqual(applyCoupon(items, { ...base, scope: 'products', product_ids: ['c'], discount_value: 600 })
    .map((x) => x.discount), [0n, 0n, 500n]);
  assert.equal(applyCoupon(items, { ...base, scope: 'store', discount_type: 'percent' })
    .reduce((sum, x) => sum + x.discount, 0n), 350n);
  assert.throws(() => applyCoupon(items, { ...base, category: 'outros' }), CouponError);
});

test('checkout com cupom grava subtotal e desconto e envia o mesmo total ao Asaas', async (t) => {
  const oldKey = process.env.ASAAS_API_KEY;
  const oldToken = process.env.ASAAS_WEBHOOK_TOKEN;
  t.after(() => {
    if (oldKey === undefined) delete process.env.ASAAS_API_KEY;
    else process.env.ASAAS_API_KEY = oldKey;
    if (oldToken === undefined) delete process.env.ASAAS_WEBHOOK_TOKEN;
    else process.env.ASAAS_WEBHOOK_TOKEN = oldToken;
  });
  process.env.ASAAS_API_KEY = 'sandbox-test-key';
  process.env.ASAAS_WEBHOOK_TOKEN = 'mock-webhook-token-for-uniweb-tests';
  const client = mockClient([products[0]]);
  const query = client.query.bind(client);
  client.query = async (sql, values) => {
    const result = await query(sql, values);
    if (sql.includes('FROM business_coupons')) {
      assert.deepEqual(values, ['store-1', 'TESTE101']);
      return { rows: [{ code: 'TESTE101', discount_type: 'fixed', discount_value: 101, scope: 'store', product_ids: [] }] };
    }
    return result;
  };
  database.getClient = async () => client;
  const provider = t.mock.method(globalThis, 'fetch', async () =>
    new Response(JSON.stringify({ id: '10000000-0000-0000-0000-000000000001' }), { status: 200 })
  );
  const req = request();
  req.body.items = [req.body.items[0]];
  req.body.checkoutId = '20000000-0000-0000-0000-000000000002';
  req.body.couponCode = 'teste101';
  const res = response();
  await controller.createOrder(req, res, true);

  assert.equal(res.statusCode, 201);
  const orderValues = client.calls.find(([sql]) => sql.includes('INSERT INTO orders'))[1];
  assert.equal(orderValues[4], '25.00');
  assert.deepEqual(orderValues.slice(8), ['23.99', '1.01', 'TESTE101']);
  const payload = JSON.parse(provider.mock.calls[0].arguments[1].body);
  assert.deepEqual(payload.items.map(({ value, quantity }) => [value, quantity]), [[11.99, 1], [12, 1]]);
});

test('consulta CEP no ViaCEP e normaliza o endereco de entrega sem exigir complemento', async (t) => {
  const { lookupPostalCode, formatDeliveryAddress } = require('../dist/services/DeliveryAddress');
  const viaCep = t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({
    logradouro: 'Praca da Se', bairro: 'Se', localidade: 'Sao Paulo', uf: 'SP',
  })));
  const invalid = response();
  await lookupPostalCode({ params: { cep: '01001' } }, invalid);
  assert.equal(invalid.statusCode, 400);
  assert.equal(viaCep.mock.callCount(), 0);

  const result = response();
  await lookupPostalCode({ params: { cep: '01001000' } }, result);
  assert.equal(viaCep.mock.calls[0].arguments[0], 'https://viacep.com.br/ws/01001000/json/');
  const address = { ...result.body, cep: '01001-000', number: 'S/N' };
  assert.equal(formatDeliveryAddress(address), 'Praca da Se, S/N \u00b7 Se \u00b7 Sao Paulo/SP \u00b7 CEP 01001-000');
  assert.equal(formatDeliveryAddress({ ...address, uf: 'SP', state: 'XX' }), null);
  assert.equal(formatDeliveryAddress({ ...address, number: '' }), null);

  viaCep.mock.mockImplementation(async () => new Response(JSON.stringify({ erro: true })));
  const missing = response();
  await lookupPostalCode({ params: { cep: '99999999' } }, missing);
  assert.equal(missing.statusCode, 404);
});

test('salva o endereco estruturado no pedido e rejeita dados incompletos', async () => {
  const req = request();
  req.body.deliveryAddress = { cep: '01001-000', street: 'Praca da Se', city: 'Sao Paulo', state: 'SP' };
  const rejected = response();
  await controller.createOrder(req, rejected);
  assert.equal(rejected.statusCode, 400);

  req.body.deliveryAddress.number = '1';
  const client = mockClient();
  database.getClient = async () => client;
  const accepted = response();
  await controller.createOrder(req, accepted);
  assert.equal(accepted.statusCode, 201);
  const address = client.calls.find(([sql]) => sql.includes('INSERT INTO orders'))[1][7];
  const saved = client.calls.find(([sql]) => sql.includes('INSERT INTO customer_addresses'))[1];
  assert.equal(saved[0], req.userId);
  assert.equal(JSON.parse(saved[1]).cep, '01001-000');
  assert.equal(address, 'Praca da Se, 1 \u00b7 Sao Paulo/SP \u00b7 CEP 01001-000');
});
