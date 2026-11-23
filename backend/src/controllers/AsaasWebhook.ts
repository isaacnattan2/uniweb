import { timingSafeEqual } from 'node:crypto';
import { Request, Response } from 'express';
import { getClient } from '../config/database';
import { notifyOrderEvent } from '../services/OrderPush';

export async function asaasWebhook(req: Request, res: Response) {
  const expected = Buffer.from(process.env.ASAAS_WEBHOOK_TOKEN?.trim() || '');
  const received = Buffer.from(req.get('asaas-access-token') || '');
  if (!expected.length || expected.length !== received.length || !timingSafeEqual(expected, received)) {
    return res.sendStatus(401);
  }

  const { event, checkout } = req.body || {};
  const paid = event === 'CHECKOUT_PAID' && checkout?.status === 'PAID';
  const ended = (event === 'CHECKOUT_EXPIRED' && checkout?.status === 'EXPIRED') ||
    (event === 'CHECKOUT_CANCELED' && checkout?.status === 'CANCELED');
  if ((!paid && !ended) || typeof checkout?.id !== 'string') return res.sendStatus(200);

  let client;
  let releaseError: Error | undefined;
  let changedIds: string[] = [];
  let newDeliveries: string[] = [];
  try {
    client = await getClient();
    await client.query('BEGIN');
    const session = await client.query(
      'SELECT id FROM asaas_checkouts WHERE provider_id = $1 FOR UPDATE', [checkout.id]
    );
    if (session.rows.length) {
      const id = session.rows[0].id;
      if (paid) {
        const { rows } = await client.query(
          `UPDATE orders SET payment_status = 'paid',
             order_status = CASE WHEN order_status = 'pending' THEN 'confirmed' ELSE order_status END
           WHERE asaas_checkout_id = $1 AND order_status IN ('pending', 'cancelled') AND
             (payment_status = 'pending' OR (payment_status = 'failed' AND order_status = 'cancelled'
               AND EXISTS (SELECT 1 FROM delivery_dispatch j WHERE j.order_id = orders.id)))
           RETURNING id, order_status, delivery_type, delivery_status`, [id]
        );
        changedIds = rows.filter((order) => order.order_status === 'confirmed' &&
          order.delivery_type === 'delivery' && order.delivery_status === 'pending').map((order) => order.id);
        const dispatch = await client.query(
          `UPDATE delivery_dispatch j SET
             state = CASE WHEN o.order_status = 'cancelled' THEN 'cancelled'
               WHEN j.slot_at IS NULL THEN 'searching' WHEN j.slot_at < NOW() + INTERVAL '10 minutes' THEN 'needs_choice' ELSE 'scheduled' END,
             search_until = CASE WHEN j.slot_at IS NULL THEN NOW() + INTERVAL '5 minutes' ELSE j.slot_at + INTERVAL '15 minutes' END,
             promised_at = CASE WHEN j.slot_at IS NULL THEN NOW() + GREATEST(j.promised_at - o.created_at, make_interval(mins => j.duration_minutes + 5))
               ELSE j.promised_at END,
             refund_state = CASE WHEN o.order_status = 'cancelled' THEN 'pending' ELSE j.refund_state END
           FROM orders o WHERE o.id = j.order_id AND o.id = ANY($1::uuid[]) AND j.state IN ('payment_pending','cancelled')
           RETURNING j.order_id, j.state`,
          [rows.map((order) => order.id)]
        );
        newDeliveries = dispatch.rows.filter((job) => job.state !== 'cancelled').map((job) => job.order_id);
      } else {
        const { rows } = await client.query(
          `WITH cancelled AS (
             UPDATE orders SET payment_status = 'failed', order_status = 'cancelled'
             WHERE asaas_checkout_id = $1 AND payment_status = 'pending' AND order_status = 'pending'
             RETURNING id
           ), restock AS (
             SELECT i.product_id, SUM(i.quantity) AS units FROM order_items i
             JOIN cancelled c ON c.id = i.order_id GROUP BY i.product_id
           ), updated_stock AS (
             UPDATE products p SET stock = p.stock + r.units FROM restock r WHERE p.id = r.product_id
           )
           SELECT id FROM cancelled`, [id]
        );
        changedIds = rows.map((order) => order.id);
        await client.query("UPDATE delivery_dispatch SET state = 'cancelled' WHERE order_id = ANY($1::uuid[]) AND state = 'payment_pending'", [changedIds]);
        await client.query(
          `UPDATE orders SET payment_status = 'failed' WHERE asaas_checkout_id = $1
           AND payment_status = 'pending' AND order_status = 'cancelled'`, [id]
        );
      }
    }
    await client.query('COMMIT');
    notifyOrderEvent('new', newDeliveries);
    notifyOrderEvent(paid ? 'ready' : 'cancelled', changedIds);
    return res.sendStatus(200);
  } catch {
    try {
      await client?.query('ROLLBACK');
    } catch {
      releaseError = new Error('Asaas webhook rollback failed');
    }
    console.error('Falha ao processar webhook do Asaas.');
    return res.sendStatus(500);
  } finally {
    client?.release(releaseError);
  }
}
