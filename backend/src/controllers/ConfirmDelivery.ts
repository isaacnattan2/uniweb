import { NextFunction, Response } from 'express';
import { getClient } from '../config/database';
import { AuthRequest } from '../middleware/auth';
import { notifyOrderEvent } from '../services/OrderPush';
import { recordDispatchEarnings, releaseDispatchAssignment } from '../services/DeliveryDispatch';
import { wakeWork } from '../services/WorkEvents';

export async function confirmDelivery(req: AuthRequest, res: Response, next: NextFunction) {
  if (req.userType !== 'driver' || !req.userId) {
    return res.status(403).json({ error: 'Acesso exclusivo para entregadores.' });
  }
  const { orderId } = req.params;
  const code = req.body?.code;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orderId) ||
      typeof code !== 'string' || !/^[0-9]{4}$/.test(code)) {
    return res.status(400).json({ error: 'Informe o código de quatro dígitos do pedido.' });
  }

  res.set('Cache-Control', 'no-store');
  const cooldownError = 'Muitas tentativas. Aguarde cinco minutos e tente novamente.';
  try {
    const client = await getClient();
    try {
      await client.query('BEGIN');
      const { rows: [order] } = await client.query(
        `SELECT delivery_status, order_status, payment_status,
                (SELECT j.state FROM delivery_dispatch j WHERE j.order_id = orders.id) AS dispatch_state,
                delivery_confirmation_code = $3 AS code_matches,
                delivery_confirmation_retry_at > clock_timestamp() AS cooling_down
         FROM orders WHERE id = $1 AND delivery_driver_id = $2
           AND delivery_type = 'delivery' AND deleted_at IS NULL FOR UPDATE`,
        [orderId, req.userId, code]
      );
      if (!order) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Entrega não encontrada.' });
      }
      if (order.delivery_status === 'delivered') {
        await client.query('COMMIT');
        return res.sendStatus(204);
      }
      if (!(order.dispatch_state ? order.dispatch_state === 'in_transit' : ['processing', 'in_transit'].includes(order.delivery_status)) ||
          !['confirmed', 'processing'].includes(order.order_status) || order.payment_status !== 'paid' ||
          order.code_matches === null) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Esta entrega não está disponível para confirmação.' });
      }
      if (order.cooling_down) {
        await client.query('ROLLBACK');
        return res.status(429).json({ error: cooldownError });
      }
      if (!order.code_matches) {
        const { rows: [attempt] } = await client.query(
          `UPDATE orders SET
             delivery_confirmation_attempts = (delivery_confirmation_attempts + 1) % 5,
             delivery_confirmation_retry_at = CASE WHEN delivery_confirmation_attempts = 4
               THEN clock_timestamp() + INTERVAL '5 minutes' ELSE NULL END
           WHERE id = $1 RETURNING delivery_confirmation_retry_at`, [orderId]
        );
        await client.query('COMMIT');
        return attempt.delivery_confirmation_retry_at ? res.status(429).json({ error: cooldownError }) :
          res.status(422).json({ error: 'Código incorreto. Confira os quatro dígitos com o cliente.' });
      }
      const delivery = await client.query(
        `UPDATE deliveries d SET status = 'delivered', completed_at = NOW(), updated_at = NOW(),
           tracking_latitude = NULL, tracking_longitude = NULL, tracking_updated_at = NULL, tracking_route_requested_at = NULL
         FROM drivers p WHERE d.order_id = $1 AND d.deleted_at IS NULL
           AND d.status IN ('processing', 'in_transit') AND d.driver_id = p.id AND p.user_id = $2`,
        [orderId, req.userId]
      );
      if (!delivery.rowCount) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Esta entrega não está disponível para confirmação.' });
      }
      await client.query(
        `UPDATE orders SET order_status = 'completed', delivery_status = 'delivered',
           delivery_confirmation_code = NULL, delivery_confirmation_attempts = 0,
           delivery_confirmation_retry_at = NULL, updated_at = NOW()
         WHERE id = $1 OR id IN (SELECT order_id FROM delivery_route_stops WHERE route_order_id = $1)`, [orderId]
      );
      await client.query("UPDATE delivery_dispatch SET state = 'delivered' WHERE order_id = $1", [orderId]);
      if (order.dispatch_state) await recordDispatchEarnings(client, orderId);
      const { rows: stops } = await client.query(
        'SELECT order_id FROM delivery_route_stops WHERE route_order_id = $1 AND order_id <> $1', [orderId]);
      await client.query('COMMIT');
      notifyOrderEvent('delivered', [orderId, ...stops.map((stop) => stop.order_id)]);
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

export async function cancelDelivery(req: AuthRequest, res: Response, next: NextFunction) {
  if (req.userType !== 'driver' || !req.userId) {
    return res.status(403).json({ error: 'Acesso exclusivo para entregadores.' });
  }
  const { orderId } = req.params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orderId)) {
    return res.status(400).json({ error: 'Pedido inválido.' });
  }

  res.set('Cache-Control', 'no-store');
  try {
    const client = await getClient();
    try {
      await client.query('BEGIN');
      const { rows: [order] } = await client.query(
        `SELECT delivery_status, order_status,
           (SELECT state FROM delivery_dispatch j WHERE j.order_id = orders.id) AS dispatch_state,
           EXISTS (SELECT 1 FROM delivery_route_stops s WHERE s.route_order_id = orders.id AND s.collected_at IS NOT NULL) AS has_collected
         FROM orders
         WHERE id = $1 AND delivery_driver_id = $2 AND delivery_type = 'delivery'
           AND deleted_at IS NULL FOR UPDATE`, [orderId, req.userId]
      );
      if (!order) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Entrega não encontrada.' });
      }
      if (order.delivery_status === 'cancelled') {
        await client.query('COMMIT');
        return res.sendStatus(204);
      }
      if (!['processing', 'in_transit'].includes(order.delivery_status) ||
          !['confirmed', 'processing'].includes(order.order_status)) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Esta entrega não pode mais ser cancelada.' });
      }
      if (order.dispatch_state) {
        if (order.dispatch_state === 'incident') {
          await client.query('COMMIT');
          return res.sendStatus(204);
        }
        if (order.delivery_status === 'in_transit' || order.has_collected) {
          const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 500) : '';
          if (!reason) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Informe o motivo da ocorrência após a retirada.' });
          }
          await client.query("UPDATE delivery_dispatch SET state = 'incident', incident_reason = $2 WHERE order_id = $1", [orderId, reason]);
          await client.query('COMMIT');
          notifyOrderEvent('delivery_incident', [orderId]);
          return res.sendStatus(204);
        }
        await releaseDispatchAssignment(client, orderId, 'retry');
        await client.query('COMMIT');
        wakeWork('dispatch');
        notifyOrderEvent('delivery_reassigned', [orderId]);
        return res.sendStatus(204);
      }
      const delivery = await client.query(
        `UPDATE deliveries d SET status = 'cancelled', updated_at = NOW(),
           tracking_latitude = NULL, tracking_longitude = NULL, tracking_updated_at = NULL, tracking_route_requested_at = NULL
         FROM drivers p WHERE d.order_id = $1 AND d.deleted_at IS NULL
           AND d.status IN ('processing', 'in_transit') AND d.driver_id = p.id AND p.user_id = $2`,
        [orderId, req.userId]
      );
      if (!delivery.rowCount) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Esta entrega não pode mais ser cancelada.' });
      }
      await client.query(
        `UPDATE orders SET delivery_status = 'cancelled', delivery_confirmation_code = NULL,
           delivery_confirmation_attempts = 0, delivery_confirmation_retry_at = NULL, updated_at = NOW()
         WHERE id = $1`, [orderId]
      );
      await client.query('COMMIT');
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
