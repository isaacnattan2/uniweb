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

  const order = await cancelOwnedOrder(orderId, req.userId);
  if (!order.found) return res.status(404).json({ error: 'Pedido não encontrado.' });
  if (order.shared_route) return res.status(409).json({ error: 'Entre em contato com o suporte para cancelar uma entrega com várias coletas.' });
  if (order.awaiting_card) return res.status(409).json({ error: 'Aguarde a confirmação do pagamento com cartão.' });
  if (order.blocked && !order.changed) return res.status(409).json({ error: 'A retirada já ocorreu. Entre em contato com o suporte para tratar este pedido.' });
  if (order.changed) notifyOrderEvent('cancelled', [orderId], order.offered_driver_id);
  return res.sendStatus(204);
}

export async function cancelOwnedOrder(orderId: string, owner: string, managedStoreOrder = false) {
  const { rows: [order] } = await query(
    `WITH owned AS (
       SELECT o.id, o.order_status, o.delivery_status, j.state AS dispatch_state,
          COALESCE(c.payment_flow = 'saved_card' AND o.payment_status = 'pending', false) AS awaiting_card,
          EXISTS (SELECT 1 FROM delivery_route_stops s WHERE s.order_id = o.id) AS shared_route
       FROM orders o LEFT JOIN asaas_checkouts c ON c.id = o.asaas_checkout_id
       LEFT JOIN delivery_dispatch j ON j.order_id = o.id
       WHERE o.id = $1 AND o.deleted_at IS NULL
         AND CASE WHEN $3::boolean THEN o.business_id = $2 AND NOT o.passenger_ride AND (j.order_id IS NOT NULL OR
           EXISTS (SELECT 1 FROM delivery_route_stops s WHERE s.order_id = o.id)) ELSE o.user_id = $2 END
       FOR UPDATE OF o
     ), changed AS (
       UPDATE orders o SET order_status = 'cancelled',
         delivery_status = CASE WHEN owned.delivery_status = 'delivered' THEN o.delivery_status ELSE 'cancelled' END,
         delivery_confirmation_code = NULL, delivery_confirmation_attempts = 0,
         delivery_confirmation_retry_at = NULL, updated_at = NOW()
       FROM owned WHERE o.id = owned.id AND owned.order_status IS DISTINCT FROM 'cancelled'
         AND NOT owned.awaiting_card AND NOT owned.shared_route
         AND (owned.dispatch_state IS NULL OR (
           owned.dispatch_state IN ('payment_pending','scheduled','searching','offered','assigned','needs_choice')
           AND owned.delivery_status IN ('pending','processing')
         ))
       RETURNING o.id, o.payment_status, owned.order_status AS previous_status, owned.delivery_status AS previous_delivery
     ), withdrawn AS (
       UPDATE delivery_dispatch_offers f SET state = 'withdrawn' FROM changed c
       WHERE f.order_id = c.id AND f.state = 'pending'
       RETURNING f.user_id, f.expires_at
     ), dispatch AS (
       UPDATE delivery_dispatch j SET state = 'cancelled',
         refund_state = CASE WHEN c.payment_status = 'paid' THEN 'pending' ELSE j.refund_state END
       FROM changed c WHERE j.order_id = c.id
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
     SELECT EXISTS (SELECT 1 FROM owned WHERE awaiting_card) AS awaiting_card,
       EXISTS (SELECT 1 FROM owned WHERE shared_route) AS shared_route,
       EXISTS (SELECT 1 FROM owned) AS found, EXISTS (SELECT 1 FROM changed) AS changed,
       (SELECT user_id FROM withdrawn WHERE expires_at > NOW() LIMIT 1) AS offered_driver_id,
       EXISTS (SELECT 1 FROM owned WHERE dispatch_state IS NOT NULL AND
         (delivery_status IN ('in_transit','delivered') OR dispatch_state = 'incident')) AS blocked`,
    [orderId, owner, managedStoreOrder],
  );
  return order as { found: boolean; changed: boolean; blocked: boolean; awaiting_card: boolean; shared_route: boolean; offered_driver_id: string | null };
}
