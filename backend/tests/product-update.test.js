const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const database = require('../dist/config/database');
const productImages = require('../dist/services/ProductImageService').default;
const controller = require('../dist/controllers/ProductController').default;

const originalQuery = database.query;
const originalDeleteImages = productImages.deleteProductImages;
const originalAddImages = productImages.addImages;

after(async () => {
  database.query = originalQuery;
  productImages.deleteProductImages = originalDeleteImages;
  productImages.addImages = originalAddImages;
  await database.default.end();
});

function response() {
  return {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test('updating quantity uses the stock column and replaces images', async () => {
  let executed;
  const imageCalls = [];
  database.query = async (sql, params) => {
    executed = { sql, params };
    return { rows: [{ id: 'product-id', stock: 0 }] };
  };
  productImages.deleteProductImages = async (id) => imageCalls.push(['delete', id]);
  productImages.addImages = async (id, images) => imageCalls.push(['add', id, images]);
  const res = response();

  await controller.updateProduct({
    params: { id: 'product-id' },
    body: { name: 'Produto', quantity: 0, images: ['/uploads/photo.webp'] },
  }, res);

  assert.equal(res.statusCode, 200);
  assert.match(executed.sql, /stock = \$3/);
  assert.doesNotMatch(executed.sql, /quantity/);
  assert.deepEqual(executed.params, ['product-id', 'Produto', 0]);
  assert.deepEqual(imageCalls, [
    ['delete', 'product-id'],
    ['add', 'product-id', ['/uploads/photo.webp']],
  ]);
});

test('an empty images array removes all photos; omitted images leave them unchanged', async () => {
  let deletes = 0;
  database.query = async () => ({ rows: [{ id: 'product-id' }] });
  productImages.deleteProductImages = async () => { deletes++; };
  productImages.addImages = async () => { throw new Error('Unexpected image insertion'); };

  await controller.updateProduct({ params: { id: 'product-id' }, body: { name: 'Produto', images: [] } }, response());
  await controller.updateProduct({ params: { id: 'product-id' }, body: { name: 'Produto' } }, response());
  assert.equal(deletes, 1);
});
