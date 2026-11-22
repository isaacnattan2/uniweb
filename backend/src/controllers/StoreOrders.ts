import { Request, Response } from 'express';
import { query } from '../config/database';

export async function listStoreOrders(req: Request, res: Response) {
  const offset = req.query.offset ?? '0';
  if (typeof offset !== 'string' || !/^[0-9]{1,9}$/.test(offset)) {
    return res.status(400).json({ error: 'Página inválida.' });
  }
  const pageSize = 20;
  const { rows } = await query(
    `SELECT id, order_number, created_at, total, order_status AS status, payment_status,
            delivery_type, delivery_status, (delivery_driver_id IS NOT NULL) AS delivery_assigned
     FROM orders WHERE business_id = $1 AND deleted_at IS NULL
     ORDER BY created_at DESC NULLS LAST, id LIMIT $2 OFFSET $3`,
    [req.params.id, pageSize + 1, Number(offset)]
  );
  res.set('Cache-Control', 'no-store');
  return res.json({ items: rows.slice(0, pageSize), nextOffset: rows.length > pageSize ? Number(offset) + pageSize : null });
}

export async function updateStoreOrder(req: Request, res: Response) {
  const { id, orderId } = req.params;
  const action = req.body?.action;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orderId) ||
      (action !== 'requeue' && action !== 'cancel')) {
    return res.status(400).json({ error: 'Pedido ou ação inválida.' });
  }
  const requeue = action === 'requeue';
  const result = await query(
    `WITH changed AS (
       UPDATE orders SET order_status = ${requeue ? "'confirmed'" : "'cancelled'"},
         delivery_status = ${requeue ? "'pending'" : "'cancelled'"},
         delivery_driver_id = ${requeue ? 'NULL' : 'delivery_driver_id'},
         delivery_confirmation_code = NULL, delivery_confirmation_attempts = 0,
         delivery_confirmation_retry_at = NULL, updated_at = NOW()
       WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL
         AND order_status IN ('pending', 'confirmed', 'processing')
         AND ${requeue
           ? "payment_status = 'paid' AND delivery_type = 'delivery' AND delivery_status = 'cancelled' AND delivery_driver_id IS NOT NULL"
           : "delivery_status IS DISTINCT FROM 'delivered'"}
       RETURNING id
     ), updated_delivery AS (
       UPDATE deliveries d SET status = ${requeue ? "'pending'" : "'cancelled'"},
         driver_id = ${requeue ? 'NULL' : 'd.driver_id'},
         tracking_latitude = NULL, tracking_longitude = NULL, tracking_updated_at = NULL, tracking_route_requested_at = NULL,
         updated_at = NOW()
       FROM changed c WHERE d.order_id = c.id AND d.deleted_at IS NULL
     )${requeue ? '' : `, restock AS (
       SELECT i.product_id, SUM(i.quantity) AS units FROM order_items i
       JOIN changed c ON c.id = i.order_id GROUP BY i.product_id
     ), updated_stock AS (
       UPDATE products p SET stock = p.stock + r.units FROM restock r WHERE p.id = r.product_id
     )`}
     SELECT id FROM changed`,
    [orderId, id]
  );
  if (!result.rowCount) return res.status(409).json({ error: 'O pedido não está mais disponível para esta ação.' });
  return res.sendStatus(204);
}
