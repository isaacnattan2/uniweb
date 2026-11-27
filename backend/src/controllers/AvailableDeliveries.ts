import { NextFunction, Response } from 'express';
import { randomInt } from 'node:crypto';
import { getClient, query } from '../config/database';
import { driverCanReceivePayout } from '../services/AsaasStoreApproval';
import { AuthRequest } from '../middleware/auth';
import { notifyOrderEvent } from '../services/OrderPush';
import { calculateDeliveryFee, getDriverDeliveryRate } from '../services/DriverDeliveryRates';
import { getOrderDeliveryDistance, ratePickupAddress } from '../services/OrderDeliveryDistance';
import type { DeliveryDistanceOrder } from '../services/OrderDeliveryDistance';

const availableOrder = `o.deleted_at IS NULL AND o.payment_status = 'paid'
  AND NOT EXISTS (SELECT 1 FROM delivery_route_stops s WHERE s.order_id = o.id AND s.route_order_id <> o.id)
  AND o.order_status IN ('confirmed', 'processing')
  AND o.delivery_type = 'delivery' AND o.delivery_status = 'pending'
  AND o.delivery_driver_id IS NULL
  AND NULLIF(TRIM(o.delivery_address), '') IS NOT NULL
  AND (d.id IS NULL OR (d.status = 'pending' AND d.driver_id IS NULL))`;

export async function listAvailableDeliveries(req: AuthRequest, res: Response, next: NextFunction) {
  return listDeliveries(req, res, next, false);
}

export async function listAcceptedDeliveries(req: AuthRequest, res: Response, next: NextFunction) {
  return listDeliveries(req, res, next, true);
}

async function listDeliveries(req: AuthRequest, res: Response, next: NextFunction, accepted: boolean) {
  if (req.userType !== 'driver' || !req.userId) {
    return res.status(403).json({ error: 'Acesso exclusivo para entregadores.' });
  }

  const { limit = '20', offset = '0', history } = req.query;
  if (typeof limit !== 'string' || !/^[0-9]{1,2}$/.test(limit) || Number(limit) < 1 || Number(limit) > 50 ||
      typeof offset !== 'string' || !/^[0-9]{1,9}$/.test(offset)) {
    return res.status(400).json({ error: 'Informe um limite entre 1 e 50 e um offset não negativo.' });
  }

  if (history !== undefined && (!accepted || (history !== 'all' && history !== 'missed' && history !== 'declined'))) {
    return res.status(400).json({ error: 'Filtro de histórico inválido.' });
  }
  const pageSize = Number(limit);
  const start = Number(offset);
  res.set('Cache-Control', 'no-store');
  try {
    if (!accepted && !await driverCanReceivePayout(req.userId)) return res.json({ items: [], nextOffset: null });
    const result = await query(
      `${accepted ? `WITH history AS (
         SELECT o.id AS order_id, NULL::uuid AS history_offer_id, NULL::text AS offer_status, NULL::timestamptz AS missed_at,
                o.created_at AS activity_at
         FROM orders o WHERE COALESCE($4::text, 'all') = 'all'
           AND o.delivery_driver_id = $3 AND o.deleted_at IS NULL AND o.delivery_type = 'delivery'
           AND o.delivery_status IN ('processing', 'in_transit', 'delivered', 'cancelled')
         UNION ALL
         SELECT f.order_id, f.id, 'missed', f.missed_at, f.missed_at
         FROM delivery_dispatch_offers f WHERE f.user_id = $3 AND f.missed_at IS NOT NULL AND $4::text IN ('all', 'missed')
         UNION ALL
         SELECT f.order_id, f.id, 'declined', NULL, f.offered_at
         FROM delivery_dispatch_offers f WHERE f.user_id = $3 AND f.state = 'declined' AND $4::text = 'declined'
       )` : ''} SELECT o.id, o.order_number, o.created_at, o.delivery_status, o.order_status, b.id AS store_id, b.name AS store_name,
              COALESCE(j.pickup_address, NULLIF(TRIM(b.address), '')) AS pickup_address,
              (SELECT json_agg(json_build_object('orderId', s.order_id, 'address', s.address,
                'storeName', store.name, 'collected', s.collected_at IS NOT NULL) ORDER BY s.position)
                FROM delivery_route_stops s JOIN orders child ON child.id = s.order_id
                JOIN businesses store ON store.id = child.business_id WHERE s.route_order_id = o.id) AS pickups,
              ${ratePickupAddress} AS rate_pickup_address,
              TRIM(o.delivery_address) AS destination_address,
              SUBSTRING(o.delivery_address FROM ' · ([[:alpha:] .''-]+/[A-Z]{2}) · CEP [0-9]{5}-[0-9]{3}$') AS destination_area,
              CASE WHEN d.driver_rate_cents IS NOT NULL THEN d.delivery_fee
                ELSE COALESCE(NULLIF(d.delivery_fee, 0), NULLIF(o.delivery_fee, 0)) END AS delivery_fee,
              d.driver_rate_cents, d.driver_distance_meters, j.order_id IS NOT NULL AS managed_delivery,
              j.slot_at, j.state AS dispatch_state, j.distance_meters AS offer_distance,
              f.id AS offer_id, f.fee_cents AS offer_fee_cents, f.rate_cents AS offer_rate_cents, f.expires_at AS offer_expires_at,
              CASE WHEN ${accepted} THEN accepted_offer.pickup_distance_meters ELSE f.pickup_distance_meters END AS pickup_distance_meters
              ${accepted ? ', h.history_offer_id, h.offer_status, h.missed_at' : ''}
       FROM orders o
       ${accepted ? 'JOIN history h ON h.order_id = o.id' : ''}
       JOIN businesses b ON b.id = o.business_id
       LEFT JOIN deliveries d ON d.order_id = o.id AND d.deleted_at IS NULL
       LEFT JOIN delivery_dispatch j ON j.order_id = o.id
       LEFT JOIN delivery_dispatch_offers f ON f.order_id = o.id AND f.user_id = $3 AND f.state = 'pending' AND f.expires_at > NOW()
       LEFT JOIN LATERAL (
         SELECT a.pickup_distance_meters FROM delivery_dispatch_offers a
         WHERE a.order_id = o.id AND a.user_id = $3 AND a.search_cycle = j.search_cycle AND a.state = 'accepted'
         LIMIT 1
       ) accepted_offer ON ${accepted}
       WHERE ${accepted
         ? 'o.deleted_at IS NULL'
         : `(${availableOrder}) AND NOT EXISTS (SELECT 1 FROM driver_dispatch_presence p WHERE p.user_id = $3 AND p.blocked_until > NOW()) AND (j.order_id IS NULL OR (j.state = 'offered' AND f.id IS NOT NULL))`}
       ORDER BY ${accepted ? 'h.activity_at DESC NULLS LAST, o.id, h.history_offer_id' : 'o.created_at DESC NULLS LAST, o.id'}
       LIMIT $1 OFFSET $2`,
      accepted ? [pageSize + 1, start, req.userId, history ?? null] : [pageSize + 1, start, req.userId]
    );

    const rows = result.rows.slice(0, pageSize);
    const rate = !accepted && rows.length ? (await getDriverDeliveryRate(req.userId)).effectiveCents : null;
    const distances: (number | null)[] = [];
    if (rate !== null) {
      for (let index = 0; index < rows.length; index += 8) {
        distances.push(...await Promise.all(rows.slice(index, index + 8).map((row) =>
          row.managed_delivery ? row.offer_distance : getOrderDeliveryDistance(row)
        )));
      }
    }

    return res.json({
      items: rows.map((row, index) => {
        const distance = distances[index] ?? null;
        if (row.history_offer_id) {
          return {
            orderId: row.id, orderNumber: row.order_number, createdAt: row.created_at,
            pickup: { storeId: row.store_id, storeName: row.store_name, address: null },
            destinationArea: null, deliveryFee: null,
            ...(row.offer_status === 'declined' ? { declinedOfferId: row.history_offer_id, status: 'declined' } :
              { missedOfferId: row.history_offer_id, missedAt: row.missed_at, status: 'missed' }),
          };
        }
        return {
          orderId: row.id,
          orderNumber: row.order_number,
          createdAt: row.created_at,
          pickup: { storeId: row.store_id, storeName: row.store_name, address: row.pickup_address },
          ...(row.pickups && { pickups: row.pickups }),
          destinationArea: row.destination_area,
          destinationAddress: row.destination_address,
          deliveryFee: row.offer_id && !accepted ? row.offer_fee_cents / 100 :
            rate === null ? row.delivery_fee : distance === null ? null : calculateDeliveryFee(rate, distance),
          distanceMeters: accepted ? row.driver_distance_meters : row.offer_id ? row.offer_distance : distance,
          pickupDistanceMeters: row.pickup_distance_meters,
          rateCents: accepted ? row.driver_rate_cents : row.offer_id ? row.offer_rate_cents : rate,
          managed: row.managed_delivery, scheduledAt: row.slot_at, dispatchState: row.dispatch_state,
          ...(row.offer_id && !accepted && { offerId: row.offer_id, offerExpiresAt: row.offer_expires_at }),
          ...(accepted && { status: row.order_status === 'cancelled' ? 'cancelled_by_store' :
            ['delivered', 'cancelled'].includes(row.delivery_status) ? row.delivery_status : 'in_progress' }),
        };
      }),
      nextOffset: result.rows.length > pageSize ? start + pageSize : null,
    });
  } catch (error) {
    next(error);
  }
}

export async function acceptDelivery(req: AuthRequest, res: Response, next: NextFunction) {
  if (req.userType !== 'driver' || !req.userId) {
    return res.status(403).json({ error: 'Acesso exclusivo para entregadores.' });
  }
  const { orderId } = req.params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orderId)) {
    return res.status(400).json({ error: 'Pedido inválido.' });
  }
  try {
    if (!await driverCanReceivePayout(req.userId)) {
      return res.status(409).json({ error: 'Regularize sua conta Asaas e seus dados banc\u00e1rios para aceitar entregas.' });
    }
    const rate = (await getDriverDeliveryRate(req.userId)).effectiveCents;
    let candidate: DeliveryDistanceOrder | undefined;
    let distance = null;
    if (rate !== null) {
      const { rows: [order] } = await query(
        `SELECT o.id, ${ratePickupAddress} AS rate_pickup_address, TRIM(o.delivery_address) AS destination_address
         FROM orders o JOIN businesses b ON b.id = o.business_id
         LEFT JOIN deliveries d ON d.order_id = o.id AND d.deleted_at IS NULL
         WHERE o.id = $1 AND ${availableOrder} AND NOT EXISTS (SELECT 1 FROM delivery_dispatch WHERE order_id = o.id)`,
        [orderId]
      );
      candidate = order;
      if (candidate) distance = await getOrderDeliveryDistance(candidate);
    }
    const client = await getClient();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1::text, 1))', [req.userId]);
      const { rows: [order] } = await client.query(
        `UPDATE orders o SET delivery_driver_id = $2, delivery_status = 'processing',
           order_status = 'processing', delivery_confirmation_code = $3,
           delivery_confirmation_attempts = 0, delivery_confirmation_retry_at = NULL, updated_at = NOW()
         FROM businesses b LEFT JOIN deliveries d ON d.order_id = $1 AND d.deleted_at IS NULL
         WHERE o.id = $1 AND b.id = o.business_id AND ${availableOrder}
           AND EXISTS (SELECT 1 FROM users WHERE id = $2 AND user_type = 'driver' AND status = 'active')
           AND NOT EXISTS (SELECT 1 FROM delivery_dispatch WHERE order_id = o.id)
           AND NOT EXISTS (SELECT 1 FROM driver_dispatch_presence p WHERE p.user_id = $2 AND p.blocked_until > NOW())
           AND NOT EXISTS (SELECT 1 FROM orders current_order WHERE current_order.delivery_driver_id = $2
             AND current_order.id <> o.id AND current_order.deleted_at IS NULL AND current_order.delivery_status IN ('processing','in_transit'))
         RETURNING o.delivery_address, o.delivery_fee, b.address, ${ratePickupAddress} AS rate_pickup_address`,
        [orderId, req.userId, String(randomInt(10000)).padStart(4, '0')]
      );
      if (!order) {
        const alreadyAccepted = await client.query(
          `SELECT 1 FROM orders WHERE id = $1 AND deleted_at IS NULL
             AND delivery_driver_id = $2 AND delivery_status = 'processing'`, [orderId, req.userId]
        );
        await client.query('ROLLBACK');
        return alreadyAccepted.rowCount ? res.sendStatus(204) :
          res.status(409).json({ error: 'Esta entrega não está mais disponível.' });
      }
      if (candidate?.rate_pickup_address !== order.rate_pickup_address ||
          candidate?.destination_address !== order.delivery_address?.trim()) distance = null;
      const fee = rate === null ? order.delivery_fee : distance === null ? null : calculateDeliveryFee(rate, distance);
      const delivery = await client.query(
        `INSERT INTO deliveries (order_id, driver_id, pickup_location, delivery_location, delivery_fee, status, driver_rate_cents, driver_distance_meters)
         SELECT $1, id, $3, $4, $5, 'processing', $6, $7 FROM drivers WHERE user_id = $2 AND deleted_at IS NULL
         ON CONFLICT (order_id) DO UPDATE SET driver_id = EXCLUDED.driver_id,
           delivery_location = EXCLUDED.delivery_location, status = 'processing', deleted_at = NULL, updated_at = NOW(),
           delivery_fee = CASE WHEN EXCLUDED.driver_rate_cents IS NOT NULL OR deliveries.driver_rate_cents IS NOT NULL
             THEN EXCLUDED.delivery_fee ELSE deliveries.delivery_fee END,
           driver_rate_cents = EXCLUDED.driver_rate_cents, driver_distance_meters = EXCLUDED.driver_distance_meters,
           tracking_latitude = NULL, tracking_longitude = NULL, tracking_updated_at = NULL, tracking_route_requested_at = NULL
         WHERE deliveries.deleted_at IS NOT NULL OR (deliveries.status = 'pending' AND deliveries.driver_id IS NULL)`,
        [orderId, req.userId, order.address?.trim() || 'Endereço não informado pela loja', order.delivery_address, fee, rate, distance]
      );
      if (!delivery.rowCount) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Não foi possível reservar a entrega. Confira seu cadastro de entregador e atualize a lista.' });
      }
      await client.query('COMMIT');
      notifyOrderEvent('collected', [orderId]);
      return res.sendStatus(204);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    next(error);
  }
}
