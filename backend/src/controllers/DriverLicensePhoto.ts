import type { Response } from 'express';
import { query } from '../config/database';
import type { AuthRequest } from '../middleware/auth';

function detectImageType(bytes: Buffer) {
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
}

export async function saveDriverLicensePhoto(req: AuthRequest, res: Response) {
  const file = req.file;
  const contentType = file && detectImageType(file.buffer);
  if (!file || !contentType) return res.status(400).json({ error: 'Envie uma foto JPEG, PNG ou WebP de até 5 MB.' });
  const { rows: [record] } = await query(
    `INSERT INTO driver_license_photos (driver_user_id, content_type, image)
     SELECT user_id, $2, $3 FROM drivers WHERE user_id = $1 AND deleted_at IS NULL
     ON CONFLICT (driver_user_id) DO UPDATE
       SET content_type = EXCLUDED.content_type, image = EXCLUDED.image, uploaded_at = NOW()
     RETURNING uploaded_at AS "uploadedAt"`,
    [req.userId, contentType, file.buffer],
  );
  if (!record) return res.sendStatus(404);
  res.set('Cache-Control', 'no-store');
  return res.json(record);
}

export async function downloadDriverLicensePhoto(driverId: string, res: Response) {
  const { rows: [record] } = await query(
    `SELECT p.content_type, p.image FROM driver_license_photos p
     JOIN drivers d ON d.user_id = p.driver_user_id AND d.deleted_at IS NULL WHERE p.driver_user_id = $1`, [driverId],
  );
  if (!record) return res.sendStatus(404);
  const extension = record.content_type.split('/')[1];
  return res.set({
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Disposition': 'attachment; filename="cnh.' + extension + '"',
    'Content-Type': record.content_type,
  }).send(record.image);
}
