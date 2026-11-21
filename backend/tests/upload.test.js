const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const app = require('../dist/app').default;
const { generateToken } = require('../dist/config/jwt');
const database = require('../dist/config/database');

test('uploaded images are accessible from the frontend origin', async (t) => {
  const originalQuery = database.query;
  database.query = async () => ({ rows: [{ id: 'test-user', user_type: 'business' }] });
  t.after(async () => {
    database.query = originalQuery;
    await database.default.end();
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const form = new FormData();
  const bytes = Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA', 'base64');
  form.append('images', new Blob([bytes], { type: 'image/webp' }), 'test.webp');
  const uploadResponse = await fetch(`${baseUrl}/api/upload/images`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${generateToken({ id: 'test-user' })}` },
    body: form,
  });
  assert.equal(uploadResponse.status, 200);
  const { urls } = await uploadResponse.json();
  assert.equal(urls.length, 1);
  const filename = path.basename(new URL(urls[0]).pathname);
  t.after(() => fs.unlink(path.join(__dirname, '..', 'uploads', filename)));

  const imageResponse = await fetch(urls[0], { headers: { Origin: 'http://localhost:5173' } });
  assert.equal(imageResponse.status, 200);
  assert.equal(imageResponse.headers.get('cross-origin-resource-policy'), 'cross-origin');
  assert.match(imageResponse.headers.get('content-type'), /^image\/webp/);
  assert.deepEqual(Buffer.from(await imageResponse.arrayBuffer()), bytes);

  const healthResponse = await fetch(`${baseUrl}/health`);
  assert.equal(healthResponse.headers.get('cross-origin-resource-policy'), 'same-origin');
});
