import { createHash } from 'node:crypto';
import { query } from '../config/database';
import { routeDelivery } from './DeliveryRouting';
import { getGeocoder, locateDeliveryAddresses } from './Geocoding';

export interface DeliveryDistanceOrder {
  id: string;
  rate_pickup_address: string | null;
  destination_address: string;
}

export const ratePickupAddress = `CASE WHEN NULLIF(TRIM(b.address), '') IS NOT NULL
  THEN CONCAT_WS(', ', TRIM(b.address), NULLIF(TRIM(b.city), ''), NULLIF(TRIM(b.state), ''), NULLIF(TRIM(b.zip_code), ''))
  END`;

const pendingDistances = new Map<string, Promise<number | null>>();

export async function getOrderDeliveryDistance(order: DeliveryDistanceOrder): Promise<number | null> {
  const pickup = order.rate_pickup_address;
  const destination = order.destination_address;
  if (!pickup || !destination) return null;
  const key = createHash('sha256').update(JSON.stringify([pickup, destination])).digest('hex');
  const pendingKey = order.id + ':' + key;
  const pending = pendingDistances.get(pendingKey);
  if (pending) return pending;
  const lookup = loadDistance(order.id, key, pickup, destination);
  pendingDistances.set(pendingKey, lookup);
  try {
    return await lookup;
  } finally {
    pendingDistances.delete(pendingKey);
  }
}

async function loadDistance(orderId: string, key: string, pickup: string, destination: string): Promise<number | null> {
  const { rows: [cached] } = await query(
    `SELECT distance_meters FROM order_delivery_distances
     WHERE order_id = $1 AND address_key = $2
       AND (distance_meters IS NOT NULL OR calculated_at > NOW() - INTERVAL '2 minutes')`,
    [orderId, key]
  );
  if (cached) return cached.distance_meters;

  const routeUrl = process.env.VALHALLA_ROUTE_URL?.trim();
  const geocoder = getGeocoder('delivery');
  if (!routeUrl || !geocoder) return null;
  let distanceMeters = null;
  try {
    const signal = AbortSignal.timeout(8000);
    const { rows: [settings] } = await query('SELECT parallel_geocoding FROM delivery_dispatch_settings WHERE id = true');
    const [from, to] = await locateDeliveryAddresses(geocoder, [pickup, destination], signal, settings?.parallel_geocoding === true);
    if (from && to) {
      const route = await routeDelivery(routeUrl, from, to, signal);
      if (route && Number.isFinite(route.distance) && route.distance >= 0 && route.distance <= 2147483647) {
        distanceMeters = Math.round(route.distance);
      }
    }
  } catch {
    // Keep the delivery visible while the routing service is unavailable.
  }
  await query(
    `INSERT INTO order_delivery_distances (order_id, address_key, distance_meters)
     SELECT id, $2, $3 FROM orders WHERE id = $1
     ON CONFLICT (order_id) DO UPDATE SET address_key = EXCLUDED.address_key,
       distance_meters = EXCLUDED.distance_meters, calculated_at = NOW()
     WHERE order_delivery_distances.address_key <> EXCLUDED.address_key
       OR order_delivery_distances.distance_meters IS NULL`,
    [orderId, key, distanceMeters]
  );
  return distanceMeters;
}
