import { Response } from 'express';
import { query } from '../config/database';
import { AuthRequest } from '../middleware/auth';
import { notifyOrderEvent } from '../services/OrderPush';

export async function cancelCustomerOrder(req: AuthRequest, res: Response) {
  if (req.userType !== 'customer' || !req.userId) {
    return res.status(403).json({ error: 'Acesso exclusivo para clientes.' });
  }
  const { orderId } = req.params;
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(orderId)) {
    return res.status(400).json({ error: 'Pedido inválido.' });
  }

  const { rows: [order] } = await query(
    `WITH owned AS (
       SELECT id, order_status, delivery_status FROM orders
       WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL FOR UPDATE
     ), changed AS (
       UPDATE orders o SET order_status = 'cancelled',
         delivery_status = CASE WHEN owned.delivery_status = 'delivered' THEN o.delivery_status ELSE 'cancelled' END,
         delivery_confirmation_code = NULL, delivery_confirmation_attempts = 0,
         delivery_confirmation_retry_at = NULL, updated_at = NOW()
       FROM owned WHERE o.id = owned.id AND owned.order_status IS DISTINCT FROM 'cancelled'
       RETURNING o.id, owned.order_status AS previous_status, owned.delivery_status AS previous_delivery
     ), updated_delivery AS (
       UPDATE deliveries d SET status = 'cancelled', updated_at = NOW(),
         tracking_latitude = NULL, tracking_longitude = NULL, tracking_updated_at = NULL, tracking_route_requested_at = NULL
       FROM changed c WHERE d.order_id = c.id AND d.deleted_at IS NULL AND d.status IS DISTINCT FROM 'delivered'
     ), restock AS (
       SELECT i.product_id, SUM(i.quantity) AS units FROM order_items i
       JOIN changed c ON c.id = i.order_id
       WHERE c.previous_status IS DISTINCT FROM 'completed' AND c.previous_delivery IS DISTINCT FROM 'delivered'
       GROUP BY i.product_id
     ), updated_stock AS (
       UPDATE products p SET stock = p.stock + r.units FROM restock r WHERE p.id = r.product_id
     )
     SELECT EXISTS (SELECT 1 FROM owned) AS found, EXISTS (SELECT 1 FROM changed) AS changed`,
    [orderId, req.userId],
  );
  if (!order.found) return res.status(404).json({ error: 'Pedido não encontrado.' });
  if (order.changed) notifyOrderEvent('cancelled', [orderId]);
  return res.sendStatus(204);
}
