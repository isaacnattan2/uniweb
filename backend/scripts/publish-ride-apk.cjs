const { createHash } = require('node:crypto');
const { createReadStream, existsSync, readFileSync, statSync } = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { parse } = require('dotenv');
const { artifactFilename, getBuildTools, readApkMetadata, readApkSigner, verifyPublicDownload } = require('./publish-driver-apk.cjs');

const backend = path.resolve(__dirname, '..');
const app = path.resolve(backend, '../../unicorrida');
const { updatePushConfig, sendRideUpdatePush } = require(path.join(app, 'scripts/ride-update-push.cjs'));
const managedApk = /^(?:preview\/)?ride-app\/[1-9]\d*\/[0-9a-f]{64}\/unicorrida-[a-z0-9]+(?:[.-][a-z0-9]+)*-vc[1-9]\d*-(preview|prod)\.apk$/i;

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log('npm run publishapp -- [--channel preview|production] [--apk caminho-do-release.apk]');
    return;
  }
  let channel = 'preview';
  let file = path.join(app, 'android/app/build/outputs/apk/release/app-release.apk');
  for (let index = 0; index < args.length; index += 2) {
    const [option, value] = args.slice(index, index + 2);
    if (option === '--channel' && ['production', 'preview'].includes(value)) channel = value;
    else if (option === '--apk' && value && !value.startsWith('--')) file = path.resolve(value);
    else throw new Error('Opção inválida. Use npm run publishapp -- --help.');
  }
  if (!existsSync(file) || !statSync(file).isFile()) throw new Error('Compile o APK de release antes de publicar ou informe o caminho com --apk.');
  const { expo } = JSON.parse(readFileSync(path.join(app, 'app.json'), 'utf8'));
  const code = channel === 'preview' && process.env.UNICORRIDA_PREVIEW_VERSION_CODE !== undefined
    ? Number(process.env.UNICORRIDA_PREVIEW_VERSION_CODE) : expo.android.versionCode;
  if (!Number.isInteger(code) || code < 1) throw new Error('Configure android.versionCode no app.json do UniCorrida.');
  const tools = getBuildTools();
  const metadata = readApkMetadata(tools, file);
  if (metadata.packageName !== expo.android.package || metadata.versionCode !== code || metadata.versionName !== expo.version || !metadata.hasArm64) {
    throw new Error('O APK precisa incluir ARM64 e corresponder ao pacote, versionCode e versão do app.json.');
  }
  const signer = readApkSigner(tools, file);
  const preview = channel === 'preview';
  const table = preview ? 'ride_app_preview_release' : 'ride_app_release';
  const prefix = preview ? 'preview/ride-app/' : 'ride-app/';
  const filename = artifactFilename({ ...expo, android: { ...expo.android, versionCode: code } }, channel, 'unicorrida');
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  const sha256 = hash.digest('hex');
  const key = prefix + code + '/' + sha256 + '/' + filename;
  if (!managedApk.test(key)) throw new Error('O nome do APK não corresponde ao padrão de distribuição.');
  const config = { ...parse(readFileSync(path.join(backend, '.env'))), ...process.env };
  const push = updatePushConfig(config);
  const { DATABASE_URL, AWS_ENDPOINT_URL_S3, AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY } = config;
  const bucket = config.RIDE_APP_APK_BUCKET || config.DRIVER_APP_APK_BUCKET || config.NEON_STORAGE_BUCKET;
  if (!DATABASE_URL || !AWS_ENDPOINT_URL_S3 || !AWS_REGION || !AWS_ACCESS_KEY_ID || !AWS_SECRET_ACCESS_KEY || !bucket) {
    throw new Error('Configure o banco e o bucket de distribuição em uniweb/backend/.env.');
  }
  const endpoint = new URL(AWS_ENDPOINT_URL_S3);
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new Error('AWS_ENDPOINT_URL_S3 precisa ser uma URL HTTPS sem credenciais ou parâmetros.');
  }
  const url = endpoint.href.replace(/\/+$/, '') + '/' + encodeURIComponent(bucket) + '/' + key;
  const database = new Pool({ connectionString: DATABASE_URL, connectionTimeoutMillis: 10000 });
  const storage = new S3Client({
    endpoint: endpoint.href, region: AWS_REGION, forcePathStyle: true, requestChecksumCalculation: 'WHEN_REQUIRED',
    credentials: { accessKeyId: AWS_ACCESS_KEY_ID, secretAccessKey: AWS_SECRET_ACCESS_KEY },
  });
  let client;
  try {
    client = await database.connect();
    const { rows: [lock] } = await client.query('SELECT pg_try_advisory_lock(19750216, $1) AS acquired', [preview ? 2 : 1]);
    if (!lock.acquired) throw new Error('Já existe uma publicação do UniCorrida em andamento.');
    const { rows: [previous] } = await client.query(`SELECT version_code, download_url, signer_sha256 FROM ${table} WHERE id = true`);
    if (previous && previous.signer_sha256 !== signer) throw new Error('Use a mesma assinatura do APK do UniCorrida já publicado.');
    if (previous && (code < previous.version_code || (code === previous.version_code && previous.download_url !== url))) {
      throw new Error('Aumente o android.versionCode para publicar um APK diferente.');
    }
    const size = statSync(file).size;
    if (previous?.download_url !== url) {
      await storage.send(new PutObjectCommand({
        Bucket: bucket, Key: key, Body: createReadStream(file), ContentLength: size,
        ContentType: 'application/vnd.android.package-archive',
        ContentDisposition: `attachment; filename="${filename}"`,
        CacheControl: 'public, max-age=31536000, immutable',
      }), { abortSignal: AbortSignal.timeout(600000) });
      await verifyPublicDownload(url, size);
      await client.query(
        `INSERT INTO ${table} (id, version_name, version_code, download_url, signer_sha256)
         VALUES (true, $1, $2, $3, $4)
         ON CONFLICT (id) DO UPDATE SET version_name = EXCLUDED.version_name, version_code = EXCLUDED.version_code,
           download_url = EXCLUDED.download_url, signer_sha256 = EXCLUDED.signer_sha256, published_at = now()`,
        [expo.version, code, url, signer]);
    } else {
      await verifyPublicDownload(url, size);
    }
    if (preview) {
      const manifestKey = prefix + 'latest.json';
      await storage.send(new PutObjectCommand({
        Bucket: bucket, Key: manifestKey, ContentType: 'application/json', CacheControl: 'no-store',
        Body: JSON.stringify({ update: { versionCode: code, versionName: expo.version, downloadUrl: url, sha256, channel } }),
      }), { abortSignal: AbortSignal.timeout(30000) });
      const manifestUrl = endpoint.href.replace(/\/+$/, '') + '/' + encodeURIComponent(bucket) + '/' + manifestKey;
      const response = await fetch(manifestUrl, { cache: 'no-store', signal: AbortSignal.timeout(30000) });
      if (!response.ok || (await response.json()).update?.sha256 !== sha256) throw new Error('O manifesto público de preview não confirmou o APK.');
    }
    console.log('APK atual do UniCorrida publicado: ' + url);
    try {
      await sendRideUpdatePush(push, { channel, versionCode: code, sha256 });
    } catch (error) {
      throw new Error('APK publicado, mas o aviso do OneSignal falhou: ' + error.message);
    }
  } finally {
    client?.release(true);
    storage.destroy();
    await database.end();
  }
}

main().catch((error) => {
  console.error(error.code === '42P01' ? 'Aplique add_ride_app_release.sql e add_ride_app_preview_release.sql.' : error.message);
  process.exitCode = 1;
});
