import type { Response } from 'express';
import { query } from '../config/database';

export async function getRideAppRelease(res: Response, download = false, preview = false) {
  res.set('Cache-Control', 'no-store');
  const table = preview ? 'ride_app_preview_release' : 'ride_app_release';
  const { rows: [release] } = await query(
    `SELECT version_name, version_code, download_url FROM ${table} WHERE id = true`,
  );
  const url = release && URL.canParse(release.download_url) ? new URL(release.download_url) : null;
  const downloadUrl = url?.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  if (download) {
    return downloadUrl ? res.redirect(302, downloadUrl) : res.status(404).json({ error: 'APK do UniCorrida ainda indisponível.' });
  }
  const asset = url?.pathname.match(/\/ride-app\/(\d+)\/([a-f0-9]{64})\/[^/]+-(preview|prod)\.apk$/i);
  const update = downloadUrl && asset && Number(asset[1]) === release.version_code ? {
    downloadUrl, sha256: asset[2].toLowerCase(), versionCode: release.version_code,
    versionName: release.version_name, channel: asset[3].toLowerCase() === 'prod' ? 'production' : 'preview',
  } : null;
  return res.json({ downloadUrl, update });
}
