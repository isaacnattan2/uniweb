import type { Response } from 'express';
import { query } from '../config/database';

export async function getRideAppRelease(res: Response, download = false) {
  res.set('Cache-Control', 'no-store');
  const { rows: [release] } = await query(
    'SELECT download_url FROM ride_app_release WHERE id = true',
  );
  const url = release && URL.canParse(release.download_url) ? new URL(release.download_url) : null;
  const downloadUrl = url?.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  if (download) {
    return downloadUrl ? res.redirect(302, downloadUrl) : res.status(404).json({ error: 'APK do UniCorrida ainda indisponível.' });
  }
  return res.json({ downloadUrl });
}
