const { v5: uuidV5 } = require('uuid');
const { spawnSync } = require('node:child_process');
const { createHash, randomBytes } = require('node:crypto');
const { copyFileSync, createReadStream, existsSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmdirSync, statSync, unlinkSync, writeFileSync } = require('node:fs');
const { homedir } = require('node:os');
const path = require('node:path');
const { Pool } = require('pg');
const { CopyObjectCommand, DeleteObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } = require('@aws-sdk/client-s3');
const { parse } = require('dotenv');

const backend = path.resolve(__dirname, '..');
const app = path.resolve(backend, '../../unientregador');
const apk = path.join(app, 'android/app/build/outputs/apk/release/app-release.apk');
const windows = process.platform === 'win32';

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: app, encoding: 'utf8', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    if (result.stderr) console.error(result.stderr.trim());
    throw new Error(path.basename(command) + ' terminou com código ' + (result.status ?? result.signal));
  }
  return result.stdout;
}

function getBuildTools() {
  const defaultSdk = windows
    ? path.join(process.env.LOCALAPPDATA || homedir(), 'Android', 'Sdk')
    : path.join(homedir(), process.platform === 'darwin' ? 'Library/Android/sdk' : 'Android/Sdk');
  const folder = path.join(process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || defaultSdk, 'build-tools');
  const executable = windows ? 'aapt.exe' : 'aapt';
  const versions = existsSync(folder) ? readdirSync(folder).sort((a, b) => b.localeCompare(a, 'en', { numeric: true })) : [];
  for (const version of versions) {
    const aapt = path.join(folder, version, executable);
    const signer = path.join(folder, version, 'lib/apksigner.jar');
    if (existsSync(aapt) && existsSync(signer)) return { aapt, signer };
  }
  throw new Error('Instale Android SDK Build Tools com aapt e apksigner e configure ANDROID_HOME.');
}

function readApkMetadata(tools, file) {
  const badging = run(tools.aapt, ['dump', 'badging', file]);
  const info = badging.match(/^package: name='([^']+)' versionCode='(\d+)' versionName='([^']+)'/m);
  if (!info) throw new Error('Não foi possível ler a versão do APK.');
  return {
    packageName: info[1], versionCode: Number(info[2]), versionName: info[3],
    hasArm64: /^native-code:.*'arm64-v8a'/m.test(badging),
  };
}

function readApkSigner(tools, file) {
  const java = process.env.JAVA_HOME
    ? path.join(process.env.JAVA_HOME, 'bin', windows ? 'java.exe' : 'java') : 'java';
  const signature = run(java, ['-jar', tools.signer, 'verify', '--verbose', '--print-certs', file]);
  const signers = new Set([...signature.matchAll(/^(?:V[\d.]+ )?Signer(?: #\d+)?:?(?: certificate)? SHA-256 digest:\s*([0-9a-f]{64})/gim)]
    .map((match) => match[1].toLowerCase()));
  if (!/^Number of signers: 1\s*$/m.test(signature) || signers.size !== 1) {
    throw new Error('O APK precisa ter um único certificado de assinatura válido.');
  }
  return [...signers][0];
}

function verifyApk(tools, expo, expectedSigner) {
  const metadata = readApkMetadata(tools, apk);
  if (metadata.packageName !== expo.android.package || metadata.versionCode !== expo.android.versionCode || metadata.versionName !== expo.version) {
    throw new Error('O pacote e a versão do APK precisam corresponder ao app.json.');
  }
  if (!metadata.hasArm64) throw new Error('O APK de distribuição precisa incluir a arquitetura arm64-v8a.');
  const actualSigner = readApkSigner(tools, apk);
  if (expectedSigner && actualSigner !== expectedSigner) {
    throw new Error('A assinatura do APK difere da registrada. Use o keystore que assinou o APK anterior.');
  }
  return actualSigner;
}

function buildSigningEnv(config) {
  const keys = ['UNI_ANDROID_KEYSTORE', 'UNI_ANDROID_KEYSTORE_PASSWORD', 'UNI_ANDROID_KEY_ALIAS', 'UNI_ANDROID_KEY_PASSWORD'];
  const values = Object.fromEntries(keys.filter((key) => config[key]).map((key) => [key, config[key]]));
  if (!Object.keys(values).length) return values;
  if (Object.keys(values).length !== keys.length || !path.isAbsolute(values.UNI_ANDROID_KEYSTORE) ||
      !existsSync(values.UNI_ANDROID_KEYSTORE) || !statSync(values.UNI_ANDROID_KEYSTORE).isFile()) {
    throw new Error('Configure as quatro variáveis UNI_ANDROID da assinatura e use o caminho absoluto de um keystore existente.');
  }
  return values;
}

function distributionSigning(allowCreate) {
  const directory = path.join(backend, '.env.driver-app-signing');
  const credentialsFile = path.join(directory, 'credentials.json');
  const keystore = path.join(directory, 'unientregador.p12');

  if (!existsSync(directory)) {
    if (!allowCreate) return {};
    const temporary = mkdtempSync(directory + '-');
    const temporaryKey = path.join(temporary, 'unientregador.p12');
    const temporaryCredentials = path.join(temporary, 'credentials.json');
    try {
      const password = randomBytes(32).toString('hex');
      const keytool = process.env.JAVA_HOME
        ? path.join(process.env.JAVA_HOME, 'bin', windows ? 'keytool.exe' : 'keytool') : 'keytool';
      run(keytool, [
        '-genkeypair', '-noprompt', '-storetype', 'PKCS12', '-keystore', temporaryKey,
        '-alias', 'unientregador', '-dname', 'CN=UniEntregador', '-keyalg', 'RSA', '-keysize', '3072',
        '-validity', '10000', '-storepass:env', 'UNI_ANDROID_SIGNING_SETUP_PASSWORD',
      ], { env: { ...process.env, UNI_ANDROID_SIGNING_SETUP_PASSWORD: password } });
      writeFileSync(temporaryCredentials, JSON.stringify({ password }), { mode: 0o600, flag: 'wx' });
      try {
        renameSync(temporary, directory);
      } catch (error) {
        if (!existsSync(directory)) throw error;
      }
    } finally {
      if (existsSync(temporary)) {
        if (existsSync(temporaryKey)) unlinkSync(temporaryKey);
        if (existsSync(temporaryCredentials)) unlinkSync(temporaryCredentials);
        rmdirSync(temporary);
      }
    }
  }

  if (!existsSync(credentialsFile) || !existsSync(keystore)) {
    throw new Error('Restaure o par de arquivos de assinatura em .env.driver-app-signing.');
  }
  const { password } = JSON.parse(readFileSync(credentialsFile, 'utf8'));
  return buildSigningEnv({
    UNI_ANDROID_KEYSTORE: keystore,
    UNI_ANDROID_KEYSTORE_PASSWORD: password,
    UNI_ANDROID_KEY_ALIAS: 'unientregador',
    UNI_ANDROID_KEY_PASSWORD: password,
  });
}

function httpsUrl(value, variable) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error(variable + ' precisa ser uma URL HTTPS sem credenciais ou parâmetros.');
  }
  return url;
}

const managedApk = /^driver-app\/[1-9]\d*\/[0-9a-f]{64}\/unientregador(?:-[a-z0-9]+(?:[._-][a-z0-9]+)*-vc[1-9]\d*(?:-(?:preview|prod))?)?\.apk$/i;

function artifactFilename(expo, channel) {
  const displayVersion = (expo.extra?.displayVersion?.trim() || expo.version)
    .replace(/[^a-z0-9]+/gi, (separator) => separator === '.' ? '.' : '-')
    .replace(/^[.-]+|[.-]+$/g, '');
  if (!displayVersion) throw new Error('Informe um displayVersion válido no app.json.');
  const suffix = channel === 'production' ? '-prod' : channel === 'preview' ? '-preview' : '';
  return `unientregador-${displayVersion}-vc${expo.android.versionCode}${suffix}.apk`;
}

async function readPublishedRelease(database) {
  const { rows: [release] } = await database.query(
    'SELECT version_name, version_code, signer_sha256, download_url, push_sent_at FROM driver_app_release WHERE id = true',
  );
  return release;
}

async function withPublicationLock(database, publish) {
  const client = await database.connect();
  try {
    const { rows: [lock] } = await client.query('SELECT pg_try_advisory_lock(19750215) AS acquired');
    if (!lock.acquired) throw new Error('Já existe uma publicação de APK em andamento. Tente novamente depois.');
    await publish(client);
  } finally {
    // Fechar a conexão libera o lock mesmo se o upload ou a limpeza falhar.
    client.release(true);
  }
}

async function removeOldApks(storage, bucket, currentKey) {
  const oldKeys = [];
  let continuationToken;
  do {
    const page = await storage.send(new ListObjectsV2Command({
      Bucket: bucket, Prefix: 'driver-app/', ContinuationToken: continuationToken,
    }), { abortSignal: AbortSignal.timeout(30000) });
    for (const { Key } of page.Contents ?? []) {
      if (managedApk.test(Key ?? '') && Key !== currentKey) oldKeys.push(Key);
    }
    continuationToken = page.NextContinuationToken;
  } while (continuationToken);

  for (const Key of oldKeys) {
    await storage.send(new DeleteObjectCommand({ Bucket: bucket, Key }), { abortSignal: AbortSignal.timeout(30000) });
  }
}

async function namePublishedArtifact(client, storage, bucket, baseUrl, release, filename) {
  if (!release.download_url.startsWith(baseUrl)) return release;
  const oldKey = release.download_url.slice(baseUrl.length);
  if (!managedApk.test(oldKey) || !oldKey.endsWith('/unientregador.apk')) return release;

  const key = oldKey.slice(0, -'unientregador.apk'.length) + filename;
  const url = baseUrl + key;
  const size = await verifyPublicDownload(release.download_url);
  await storage.send(new CopyObjectCommand({
    Bucket: bucket, Key: key, CopySource: encodeURIComponent(bucket) + '/' + oldKey,
    MetadataDirective: 'REPLACE', ContentType: 'application/vnd.android.package-archive',
    ContentDisposition: `attachment; filename="${filename}"`,
    CacheControl: 'public, max-age=31536000, immutable',
  }), { abortSignal: AbortSignal.timeout(120000) });
  await verifyPublicDownload(url, size);

  const result = await client.query(
    'UPDATE driver_app_release SET download_url = $1 WHERE version_code = $2 AND download_url = $3',
    [url, release.version_code, release.download_url],
  );
  if (!result.rowCount) throw new Error('O link publicado mudou durante a renomeação.');
  console.log('APK publicado com nome versionado: ' + filename);
  return { ...release, download_url: url };
}

async function cleanPublishedRelease(storage, bucket, baseUrl, release) {
  try {
    const currentKey = release.download_url.startsWith(baseUrl) && release.download_url.slice(baseUrl.length);
    if (!currentKey || !managedApk.test(currentKey)) {
      throw new Error('O link publicado não pertence ao bucket de distribuição configurado.');
    }
    await verifyPublicDownload(release.download_url);
    await removeOldApks(storage, bucket, currentKey);
  } catch (error) {
    throw new Error('O link publicado foi preservado, mas a limpeza dos APKs antigos falhou. ' +
      'Execute publishapp novamente com o mesmo versionCode. ' + error.message);
  }
}

function releaseDisplayVersion(release) {
  return release.download_url?.match(/\/unientregador-([a-z0-9][a-z0-9._-]*)-vc[0-9]+(?:-(?:preview|prod))?\.apk$/i)?.[1]
    ?? release.version_name;
}

async function notifyApkRelease(client, config, release) {
  if (release.push_sent_at) return;
  const appId = config.ONESIGNAL_DRIVER_APP_ID?.trim();
  const apiKey = config.ONESIGNAL_DRIVER_API_KEY?.trim();
  if (!appId || !apiKey) throw new Error('Configure ONESIGNAL_DRIVER_APP_ID e ONESIGNAL_DRIVER_API_KEY para avisar os entregadores.');
  if (appId !== config.expectedOneSignalAppId) throw new Error('O App ID do OneSignal difere do configurado no UniEntregador.');
  const segment = config.ONESIGNAL_DRIVER_APK_SEGMENT?.trim() || 'Total Subscriptions';
  const response = await fetch('https://api.onesignal.com/notifications', {
    method: 'POST', signal: AbortSignal.timeout(30000),
    headers: { Authorization: 'Key ' + apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      app_id: appId, target_channel: 'push',
      included_segments: [segment],
      isAndroid: true, isIos: false, isAnyWeb: false, isHuawei: false, isAdm: false,
      idempotency_key: uuidV5('android-apk:' + appId + ':' + release.version_code + ':' + segment, uuidV5.URL),
      headings: { en: 'Nova versão do UniEntregador' },
      contents: { en: `Versão ${releaseDisplayVersion(release)} disponível. Abra o app para baixar e instalar o novo APK.` },
      data: { event: 'android_apk_release', versionCode: release.version_code },
    }),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || typeof result?.id !== 'string' || !result.id.trim()) {
    const errors = result?.errors;
    const messages = typeof errors === 'string' ? [errors] :
      errors && typeof errors === 'object' ? Object.values(errors).flat() : [];
    const reason = messages.filter((value) => typeof value === 'string').join('; ').slice(0, 400);
    throw new Error(`O OneSignal não confirmou o aviso do APK (HTTP ${response.status}, segmento "${segment}"). ` +
      (reason || 'Verifique se há inscrições Android habilitadas para push nesse segmento.'));
  }
  await client.query('UPDATE driver_app_release SET push_sent_at = now() WHERE version_code = $1', [release.version_code]);
  console.log('OneSignal aceitou o aviso do novo APK.');
}

async function finishPublication(client, storage, bucket, baseUrl, config, release) {
  const results = await Promise.allSettled([
    cleanPublishedRelease(storage, bucket, baseUrl, release),
    notifyApkRelease(client, config, release),
  ]);
  const errors = results.filter((result) => result.status === 'rejected').map((result) => result.reason.message);
  if (errors.length) throw new Error(errors.join(' ') + ' O APK está publicado. Rode publishapp com o mesmo versionCode para tentar novamente.');
}

async function verifyPublicDownload(url, size) {
  const response = await fetch(url, {
    headers: { Range: 'bytes=0-0' }, signal: AbortSignal.timeout(15000), redirect: 'error',
  });
  await response.body?.cancel();
  const length = response.status === 206
    ? Number(response.headers.get('content-range')?.match(/^bytes 0-0\/(\d+)$/)?.[1])
    : response.status === 200 ? Number(response.headers.get('content-length')) : 0;
  const accessible = length > 0 && (size === undefined || length === size);
  if (!accessible) throw new Error('O APK não está disponível para download público. Confira o acesso public_read do bucket.');
  return length;
}

async function main() {
  const { androidReleaseTarget } = require(path.join(app, 'scripts/android-release-target.cjs'));
  const { channel } = androidReleaseTarget(process.argv.slice(2));
  const config = { ...parse(readFileSync(path.join(backend, '.env'))), ...process.env };
  const { DATABASE_URL, AWS_ENDPOINT_URL_S3, AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY } = config;
  const bucket = config.DRIVER_APP_APK_BUCKET || config.NEON_STORAGE_BUCKET;
  if (!DATABASE_URL || !AWS_ENDPOINT_URL_S3 || !AWS_REGION || !AWS_ACCESS_KEY_ID || !AWS_SECRET_ACCESS_KEY || !bucket) {
    throw new Error('Configure o banco e o bucket de distribuição em uniweb/backend/.env.');
  }
  const endpoint = httpsUrl(AWS_ENDPOINT_URL_S3, 'AWS_ENDPOINT_URL_S3');
  const apiUrl = httpsUrl(config.DRIVER_APP_RELEASE_API_URL || 'https://uniweb-p7mz.onrender.com/api', 'DRIVER_APP_RELEASE_API_URL');
  const { expo } = JSON.parse(readFileSync(path.join(app, 'app.json'), 'utf8'));
  const appEnv = Object.assign({}, ...['.env', '.env.local'].map((name) => {
    const file = path.join(app, name);
    return existsSync(file) ? parse(readFileSync(file, 'utf8')) : {};
  }));
  config.expectedOneSignalAppId = (process.env.EXPO_PUBLIC_ONESIGNAL_APP_ID ?? appEnv.EXPO_PUBLIC_ONESIGNAL_APP_ID)?.trim()
    || expo.extra.oneSignalAppId;
  const { versionCode } = expo.android;
  if (!Number.isInteger(versionCode) || versionCode < 1) throw new Error('Informe um android.versionCode válido em app.json.');
  const filename = artifactFilename(expo, channel);
  const baseUrl = endpoint.href.replace(/\/+$/, '') + '/' + encodeURIComponent(bucket) + '/';
  const database = new Pool({ connectionString: DATABASE_URL, connectionTimeoutMillis: 10000 });
  const storage = new S3Client({
    endpoint: endpoint.href, region: AWS_REGION, forcePathStyle: true, requestChecksumCalculation: 'WHEN_REQUIRED',
    credentials: { accessKeyId: AWS_ACCESS_KEY_ID, secretAccessKey: AWS_SECRET_ACCESS_KEY },
  });

  try {
    const published = await readPublishedRelease(database);
    if (published?.version_code === versionCode && published.version_name === expo.version) {
      await withPublicationLock(database, async (client) => {
        const current = await readPublishedRelease(client);
        if (current?.version_code !== versionCode || current.version_name !== expo.version) {
          throw new Error('A versão publicada mudou. Confira o APK atual antes de publicar.');
        }
        const named = await namePublishedArtifact(client, storage, bucket, baseUrl, current, artifactFilename(expo));
        await finishPublication(client, storage, bucket, baseUrl, config, named);
      });
      console.log('APK atual preservado e versões anteriores removidas.');
      return;
    }
    const tools = getBuildTools();
    const signingEnv = buildSigningEnv(config);
    let reference = published;
    if (!reference && config.DRIVER_APP_CURRENT_APK) {
      const file = config.DRIVER_APP_CURRENT_APK;
      if (!path.isAbsolute(file) || !existsSync(file)) throw new Error('DRIVER_APP_CURRENT_APK precisa apontar para o APK atual.');
      const metadata = readApkMetadata(tools, file);
      if (metadata.packageName !== expo.android.package) throw new Error('O APK atual pertence a outro pacote Android.');
      reference = { version_code: metadata.versionCode, signer_sha256: readApkSigner(tools, file) };
    }
    if (reference && versionCode <= reference.version_code) {
      throw new Error('Aumente o android.versionCode acima da versão publicada (' + reference.version_code + ').');
    }
    const expectedSigner = reference?.signer_sha256 || config.DRIVER_APP_APK_SIGNER_SHA256?.replaceAll(':', '').trim().toLowerCase();
    if (expectedSigner && !/^[0-9a-f]{64}$/.test(expectedSigner)) {
      throw new Error('DRIVER_APP_APK_SIGNER_SHA256 precisa ser um SHA-256 válido.');
    }
    const releaseSigning = Object.keys(signingEnv).length ? signingEnv : distributionSigning(!expectedSigner);

    const env = { ...process.env, EXPO_PUBLIC_API_URL: apiUrl.href, UNI_UPDATE_CHANNEL: channel };
    console.log('Compilando APK Android para o canal ' + channel + '.');
    run(process.execPath, [require.resolve('expo/bin/cli', { paths: [app] }), 'prebuild', '--platform', 'android', '--no-clean', '--no-install'],
      { stdio: 'inherit', env });
    run(process.execPath, ['scripts/android-release.cjs'], { stdio: 'inherit', env: { ...env, ...releaseSigning } });
    const signer = verifyApk(tools, expo, expectedSigner);

    const artifact = path.join(path.dirname(apk), filename);
    copyFileSync(apk, artifact);
    console.log('APK de distribuição: ' + artifact);

    const size = statSync(artifact).size;
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(artifact)) hash.update(chunk);
    const key = 'driver-app/' + versionCode + '/' + hash.digest('hex') + '/' + filename;
    const url = baseUrl + key;
    const displayVersion = releaseDisplayVersion({ download_url: url, version_name: expo.version });
    await withPublicationLock(database, async (client) => {
      const current = await readPublishedRelease(client);
      if (current && (versionCode <= current.version_code || current.signer_sha256 !== signer)) {
        throw new Error('A versão ou a assinatura publicada mudou durante a compilação. Confira o APK atual antes de publicar.');
      }
      try {
        await storage.send(new PutObjectCommand({
          Bucket: bucket, Key: key, Body: createReadStream(artifact), ContentLength: size,
          ContentType: 'application/vnd.android.package-archive',
          ContentDisposition: `attachment; filename="${filename}"`,
          CacheControl: 'public, max-age=31536000, immutable',
        }), { abortSignal: AbortSignal.timeout(600000) });
        await verifyPublicDownload(url, size);
      } catch (error) {
        try {
          await storage.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }), { abortSignal: AbortSignal.timeout(30000) });
        } catch (cleanupError) {
          console.warn('Falha ao remover o APK não publicado: ' + cleanupError.message);
        }
        throw error;
      }

      const result = await client.query(
        `WITH published AS (
          INSERT INTO driver_app_release (id, version_name, version_code, download_url, signer_sha256)
         VALUES (true, $1, $2, $3, $4)
         ON CONFLICT (id) DO UPDATE SET version_name = EXCLUDED.version_name, version_code = EXCLUDED.version_code,
           download_url = EXCLUDED.download_url, published_at = NOW(), push_sent_at = NULL
         WHERE EXCLUDED.version_code > driver_app_release.version_code
           AND EXCLUDED.signer_sha256 = driver_app_release.signer_sha256
         RETURNING version_name, version_code
        )
        INSERT INTO driver_notifications (id, kind, title, body, data)
        SELECT 'apk:' || version_code, 'android_apk_release', 'Nova versão do UniEntregador',
          'Baixe e instale o novo APK para atualizar o aplicativo.',
          jsonb_build_object('versionCode', version_code, 'versionName', $5::text)
        FROM published`,
        [expo.version, versionCode, url, signer, displayVersion],
      );
      if (!result.rowCount) throw new Error('Outra publicação já registrou essa versão ou uma versão mais recente.');
      console.log(`APK ${displayVersion} (runtime ${expo.version}, código ${versionCode}) publicado no UniWeb: ${url}`);
      await finishPublication(client, storage, bucket, baseUrl, config, {
        download_url: url, version_name: expo.version, version_code: versionCode,
      });
    });
  } finally {
    storage.destroy();
    await database.end();
  }
}

main().catch((error) => {
  if (error.code === '42P01') {
    console.error('Aplique as migrações add_driver_app_release.sql e add_driver_notifications.sql.');
  } else {
    console.error(error.message);
  }
  process.exitCode = 1;
});
