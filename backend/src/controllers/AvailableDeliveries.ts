import { NextFunction, Response } from 'express';
import { randomInt } from 'node:crypto';
import { getClient, query } from '../config/database';
import { AuthRequest } from '../middleware/auth';
import { notifyOrderEvent } from '../services/OrderPush';

const availableOrder = `o.deleted_at IS NULL AND o.payment_status = 'paid'
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
  if (req.userType !== 'driver') {
    return res.status(403).json({ error: 'Acesso exclusivo para entregadores.' });
  }

  const { limit = '20', offset = '0' } = req.query;
  if (typeof limit !== 'string' || !/^[0-9]{1,2}$/.test(limit) || Number(limit) < 1 || Number(limit) > 50 ||
      typeof offset !== 'string' || !/^[0-9]{1,9}$/.test(offset)) {
    return res.status(400).json({ error: 'Informe um limite entre 1 e 50 e um offset não negativo.' });
  }

  const pageSize = Number(limit);
  const start = Number(offset);
  res.set('Cache-Control', 'no-store');
  try {
    const result = await query(
      `SELECT o.id, o.order_number, o.created_at, o.delivery_status, o.order_status, b.id AS store_id, b.name AS store_name,
              NULLIF(TRIM(b.address), '') AS pickup_address,
              TRIM(o.delivery_address) AS destination_address,
              SUBSTRING(o.delivery_address FROM ' · ([[:alpha:] .''-]+/[A-Z]{2}) · CEP [0-9]{5}-[0-9]{3}$') AS destination_area,
              COALESCE(NULLIF(d.delivery_fee, 0), NULLIF(o.delivery_fee, 0)) AS delivery_fee
       FROM orders o
       JOIN businesses b ON b.id = o.business_id
       LEFT JOIN deliveries d ON d.order_id = o.id AND d.deleted_at IS NULL
       WHERE ${accepted
         ? "o.deleted_at IS NULL AND o.delivery_type = 'delivery' AND o.delivery_driver_id = $3 AND o.delivery_status IN ('processing', 'in_transit', 'delivered', 'cancelled')"
         : availableOrder}
       ORDER BY ${accepted ? "(o.delivery_status IN ('delivered', 'cancelled')), o.updated_at DESC" : 'o.created_at ASC'} NULLS LAST, o.id
       LIMIT $1 OFFSET $2`,
      accepted ? [pageSize + 1, start, req.userId] : [pageSize + 1, start]
    );

    return res.json({
      items: result.rows.slice(0, pageSize).map((row) => ({
        orderId: row.id,
        orderNumber: row.order_number,
        createdAt: row.created_at,
        pickup: { storeId: row.store_id, storeName: row.store_name, address: row.pickup_address },
        destinationArea: row.destination_area,
        destinationAddress: row.destination_address,
        deliveryFee: row.delivery_fee,
        ...(accepted && { status: row.order_status === 'cancelled' ? 'cancelled_by_store' :
          ['delivered', 'cancelled'].includes(row.delivery_status) ? row.delivery_status : 'in_progress' }),
      })),
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
    const client = await getClient();
    try {
      await client.query('BEGIN');
      const { rows: [order] } = await client.query(
        `UPDATE orders o SET delivery_driver_id = $2, delivery_status = 'processing',
           order_status = 'processing', delivery_confirmation_code = $3,
           delivery_confirmation_attempts = 0, delivery_confirmation_retry_at = NULL, updated_at = NOW()
         FROM businesses b LEFT JOIN deliveries d ON d.order_id = $1 AND d.deleted_at IS NULL
         WHERE o.id = $1 AND b.id = o.business_id AND ${availableOrder}
         RETURNING o.delivery_address, o.delivery_fee, b.address`,
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
      const delivery = await client.query(
        `INSERT INTO deliveries (order_id, driver_id, pickup_location, delivery_location, delivery_fee, status)
         SELECT $1, id, $3, $4, $5, 'processing' FROM drivers WHERE user_id = $2 AND deleted_at IS NULL
         ON CONFLICT (order_id) DO UPDATE SET driver_id = EXCLUDED.driver_id,
           delivery_location = EXCLUDED.delivery_location, status = 'processing', deleted_at = NULL, updated_at = NOW(),
           tracking_latitude = NULL, tracking_longitude = NULL, tracking_updated_at = NULL, tracking_route_requested_at = NULL
         WHERE deliveries.deleted_at IS NOT NULL OR (deliveries.status = 'pending' AND deliveries.driver_id IS NULL)`,
        [orderId, req.userId, order.address?.trim() || 'Endereço não informado pela loja', order.delivery_address, order.delivery_fee]
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
