import type { Response } from 'express';
import { query } from '../config/database';
import type { AuthRequest } from '../middleware/auth';

const visibility = `(n.driver_id = $1 OR (n.driver_id IS NULL AND $2 = 'android' AND (
  n.kind = 'android_apk_release' OR
  (n.kind = 'android_app_update' AND n.data->>'channel' = $3 AND n.data->>'runtimeVersion' = $4)
)))`;

function audience(req: AuthRequest) {
  return [req.userId, req.query.platform === 'android' ? 'android' : '',
    typeof req.query.channel === 'string' ? req.query.channel : '',
    typeof req.query.runtimeVersion === 'string' ? req.query.runtimeVersion : ''];
}

export async function listDriverNotifications(req: AuthRequest, res: Response) {
  if (req.userType !== 'driver' || !req.userId) return res.sendStatus(403);
  const read = req.query.read === '1';
  const offset = Number(req.query.offset ?? 0);
  if (!Number.isSafeInteger(offset) || offset < 0) return res.sendStatus(400);
  const limit = read ? 30 : 6;
  const { rows: [result] } = await query(
    `WITH feed AS (
       SELECT n.id, n.kind, n.title, n.body, n.data, n.created_at AS "createdAt",
         r.notification_id IS NOT NULL AS read
       FROM driver_notifications n LEFT JOIN driver_notification_reads r
         ON r.notification_id = n.id AND r.driver_id = $1
       WHERE ${visibility}
     )
     SELECT COALESCE((SELECT jsonb_agg(page ORDER BY page."createdAt" DESC, page.id DESC) FROM (
       SELECT * FROM feed WHERE read = $5 ORDER BY "createdAt" DESC, id DESC LIMIT $6 OFFSET $7
     ) page), '[]'::jsonb) AS items,
     (SELECT COUNT(*)::int FROM feed WHERE NOT read) AS "unreadCount",
     (SELECT jsonb_build_object('versionName', COALESCE(
         substring(download_url FROM '/unientregador-([a-zA-Z0-9][a-zA-Z0-9._-]*)-vc[0-9]+(?:-(?:preview|prod))?[.]apk$'), version_name
       ), 'versionCode', version_code,
       'downloadUrl', download_url, 'sha256', substring(download_url FROM '/driver-app/[0-9]+/([0-9a-f]{64})/'))
      FROM driver_app_release WHERE id = true AND $2 = 'android') AS release,
     EXISTS (
       SELECT 1 FROM orders o LEFT JOIN delivery_dispatch j ON j.order_id = o.id
       WHERE o.delivery_driver_id = $1 AND o.deleted_at IS NULL AND (
         o.delivery_status = 'in_transit' OR
         (o.delivery_status = 'processing' AND (j.slot_at IS NULL OR j.slot_at <= NOW()))
       )
     ) AS "hasActiveDelivery"`,
    [...audience(req), read, limit + 1, offset],
  );
  res.set('Cache-Control', 'no-store').json({
    ...result, items: result.items.slice(0, limit),
    nextOffset: result.items.length > limit ? offset + limit : null,
  });
}

export async function markDriverNotificationRead(req: AuthRequest, res: Response) {
  if (req.userType !== 'driver' || !req.userId) return res.sendStatus(403);
  await query(
    `INSERT INTO driver_notification_reads (driver_id, notification_id)
     SELECT $1, n.id FROM driver_notifications n WHERE n.id = $5 AND ${visibility}
     ON CONFLICT DO NOTHING`, [...audience(req), req.params.id],
  );
  res.sendStatus(204);
}
