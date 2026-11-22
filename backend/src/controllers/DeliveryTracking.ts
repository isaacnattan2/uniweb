import { Response } from 'express';
import { query } from '../config/database';
import { AuthRequest } from '../middleware/auth';

const validOrderId = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const activeOrder = `o.delivery_type = 'delivery' AND o.deleted_at IS NULL
  AND o.payment_status = 'paid' AND o.order_status IN ('confirmed', 'processing')
  AND o.delivery_status IN ('processing', 'in_transit')`;
const assignedDelivery = `d.deleted_at IS NULL AND d.status IN ('processing', 'in_transit')
  AND EXISTS (SELECT 1 FROM drivers p WHERE p.id = d.driver_id AND p.user_id = o.delivery_driver_id AND p.deleted_at IS NULL)`;

function validCoordinate(value: unknown, limit: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= limit;
}

function trackingRequest(req: AuthRequest, res: Response, role: 'customer' | 'driver') {
  res.set('Cache-Control', 'no-store');
  if (req.userType !== role || !req.userId) {
    res.sendStatus(403);
    return false;
  }
  if (!validOrderId.test(req.params.orderId)) {
    res.status(400).json({ error: 'Pedido inválido.' });
    return false;
  }
  return true;
}

export async function getDeliveryTracking(req: AuthRequest, res: Response) {
  if (!trackingRequest(req, res, 'customer')) return;
  const { rows: [order] } = await query(
    `SELECT COALESCE(${activeOrder}, false) AND o.delivery_driver_id IS NOT NULL AS active,
            d.tracking_latitude, d.tracking_longitude, d.tracking_updated_at
     FROM orders o
     LEFT JOIN deliveries d ON d.order_id = o.id AND ${assignedDelivery}
       AND d.tracking_updated_at > NOW() - INTERVAL '45 seconds'
     WHERE o.id = $1 AND o.user_id = $2 AND o.deleted_at IS NULL`, [req.params.orderId, req.userId]
  );
  if (!order) return res.sendStatus(404);
  return res.json({
    active: order.active,
    position: order.active && order.tracking_updated_at ? {
      latitude: order.tracking_latitude, longitude: order.tracking_longitude, updatedAt: order.tracking_updated_at,
    } : null,
  });
}

export async function updateDeliveryTracking(req: AuthRequest, res: Response) {
  if (!trackingRequest(req, res, 'driver')) return;
  const { latitude, longitude } = req.body || {};
  if (!validCoordinate(latitude, 90) || !validCoordinate(longitude, 180)) {
    return res.status(400).json({ error: 'Localização inválida.' });
  }
  const result = await query(
    `UPDATE deliveries d SET tracking_latitude = CASE WHEN
         d.tracking_updated_at > NOW() - INTERVAL '3 seconds' THEN d.tracking_latitude ELSE $3 END,
       tracking_longitude = CASE WHEN
         d.tracking_updated_at > NOW() - INTERVAL '3 seconds' THEN d.tracking_longitude ELSE $4 END,
       tracking_updated_at = CASE WHEN
         d.tracking_updated_at > NOW() - INTERVAL '3 seconds' THEN d.tracking_updated_at ELSE NOW() END
     FROM orders o WHERE o.id = $1 AND o.delivery_driver_id = $2 AND d.order_id = o.id
       AND ${activeOrder} AND ${assignedDelivery}`,
    [req.params.orderId, req.userId, latitude, longitude]
  );
  return res.sendStatus(result.rowCount ? 204 : 404);
}

export async function clearDeliveryTracking(req: AuthRequest, res: Response) {
  if (!trackingRequest(req, res, 'driver')) return;
  await query(
    `UPDATE deliveries d SET tracking_latitude = NULL, tracking_longitude = NULL, tracking_updated_at = NULL
     FROM orders o WHERE o.id = $1 AND o.delivery_driver_id = $2 AND d.order_id = o.id
       AND ${activeOrder} AND ${assignedDelivery}`,
    [req.params.orderId, req.userId]
  );
  return res.sendStatus(204);
}

export async function getDeliveryRoute(req: AuthRequest, res: Response) {
  if (!trackingRequest(req, res, 'driver')) return;
  const key = process.env.GOOGLE_ROUTES_API_KEY?.trim();
  if (!key) return res.status(503).json({ error: 'O cálculo de rotas ainda não está configurado.' });
  const { rows: [delivery] } = await query(
    `UPDATE deliveries d SET tracking_route_requested_at = NOW()
     FROM orders o WHERE o.id = $1 AND o.delivery_driver_id = $2 AND d.order_id = o.id
       AND ${activeOrder} AND ${assignedDelivery}
       AND d.tracking_updated_at > NOW() - INTERVAL '45 seconds'
       AND (d.tracking_route_requested_at IS NULL OR d.tracking_route_requested_at <= NOW() - INTERVAL '30 seconds')
     RETURNING d.tracking_latitude, d.tracking_longitude, o.delivery_address`,
    [req.params.orderId, req.userId]
  );
  if (!delivery) return res.status(409).json({ error: 'Rota indisponível no momento. Aguarde a atualização da localização.' });

  try {
    const response = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(8000),
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': key,
        'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration,routes.polyline.geoJsonLinestring',
      },
      body: JSON.stringify({
        origin: { location: { latLng: { latitude: delivery.tracking_latitude, longitude: delivery.tracking_longitude } } },
        destination: { address: delivery.delivery_address.replaceAll(' · ', ', ') },
        travelMode: 'TWO_WHEELER', routingPreference: 'TRAFFIC_AWARE',
        regionCode: 'BR', languageCode: 'pt-BR', polylineEncoding: 'GEO_JSON_LINESTRING',
      }),
    });
    if (!response.ok) throw new Error('Routes API request failed');
    const { routes } = await response.json() as {
      routes?: Array<{ distanceMeters: number; duration: string; polyline: { geoJsonLinestring: { coordinates: number[][] } } }>;
    };
    const route = routes?.[0];
    const points = route?.polyline?.geoJsonLinestring?.coordinates;
    if (!Array.isArray(points) || points.length < 2 || !points.every(([lng, lat]) => validCoordinate(lng, 180) && validCoordinate(lat, 90))) {
      return res.status(422).json({ error: 'Nenhuma rota encontrada para o endereço do pedido.' });
    }
    return res.json({
      points: points.map(([longitude, latitude]) => ({ latitude, longitude })),
      distanceMeters: route!.distanceMeters,
      durationSeconds: Number.parseFloat(route!.duration),
    });
  } catch {
    return res.status(502).json({ error: 'Não foi possível calcular a rota agora.' });
  }
}
