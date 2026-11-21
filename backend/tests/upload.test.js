const { test } = require('node:test');
const assert = require('node:assert/strict');
const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const database = require('../dist/config/database');
const app = require('../dist/app').default;
const { generateToken } = require('../dist/config/jwt');

test('uploads product images to public storage and rejects failures', async (t) => {
  const vars = {
    AWS_ENDPOINT_URL_S3: 'https://storage.example.test',
    AWS_REGION: 'us-east-2',
    AWS_ACCESS_KEY_ID: 'test-key',
    AWS_SECRET_ACCESS_KEY: 'test-secret',
    NEON_STORAGE_BUCKET: 'product-images',
  };
  const originalEnv = Object.fromEntries(Object.keys(vars).map((key) => [key, process.env[key]]));
  Object.assign(process.env, vars);
  const originalQuery = database.query;
  const originalSend = S3Client.prototype.send;
  let userType = 'business';
  let failSecondUpload = false;
  let puts = 0;
  const commands = [];
  database.query = async () => ({ rows: [{ id: 'test-user', user_type: userType }] });
  S3Client.prototype.send = async function (command) {
    commands.push(command);
    if (command instanceof PutObjectCommand && ++puts === 2 && failSecondUpload) throw new Error('test storage failure');
    return {};
  };
  t.after(async () => {
    database.query = originalQuery;
    S3Client.prototype.send = originalSend;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await database.default.end();
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const token = generateToken({ id: 'test-user' });
  const bytes = Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA', 'base64');
  const form = (count = 1) => {
    const data = new FormData();
    for (let i = 0; i < count; i++) data.append('images', new Blob([bytes], { type: 'image/webp' }), 'test.webp');
    return data;
  };
  const send = (body, authorization = token) => fetch(`${base}/api/upload/images`, {
    method: 'POST',
    headers: authorization ? { Authorization: `Bearer ${authorization}` } : {},
    body,
  });

  assert.equal((await send(form(), null)).status, 401);
  userType = 'customer';
  assert.equal((await send(form())).status, 403);
  assert.equal(commands.length, 0);
  userType = 'business';
  assert.equal((await send(form(0))).status, 400);
  const response = await send(form(2));
  assert.equal(response.status, 200);
  const { urls } = await response.json();
  assert.equal(urls.length, 2);
  assert.notEqual(urls[0], urls[1]);
  assert.match(urls[0], /^https:\/\/storage\.example\.test\/product-images\/products\/[\w-]+\.webp$/);
  for (const command of commands) {
    assert.ok(command instanceof PutObjectCommand);
    assert.equal(command.input.ContentType, 'image/webp');
    assert.deepEqual(command.input.Body, bytes);
    assert.equal(command.input.Bucket, 'product-images');
  }

  commands.length = 0;
  puts = 0;
  failSecondUpload = true;
  assert.equal((await send(form(2))).status, 503);
  const uploadedKeys = commands.filter((command) => command instanceof PutObjectCommand).map((command) => command.input.Key);
  const cleanedKeys = commands.filter((command) => command instanceof DeleteObjectCommand).map((command) => command.input.Key);
  assert.deepEqual(cleanedKeys, uploadedKeys);
  commands.length = 0;
  delete process.env.AWS_ACCESS_KEY_ID;
  assert.equal((await send(form())).status, 503);
  assert.equal(commands.length, 0);
});
