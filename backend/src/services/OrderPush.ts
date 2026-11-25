import jwt from 'jsonwebtoken';
import { createHmac, randomUUID } from 'node:crypto';
import { filterDriversEligibleForPayout } from './AsaasStoreApproval';
import { query } from '../config/database';

export function signStorePushIdentity(externalId: string) {
  const appId = process.env.ONESIGNAL_WEB_APP_ID;
  const key = process.env.ONESIGNAL_WEB_IDENTITY_PRIVATE_KEY;
  if (!appId || !key || !process.env.ONESIGNAL_WEB_API_KEY || !process.env.ONESIGNAL_WEB_ORIGIN) return null;
  return jwt.sign({ identity: { external_id: externalId } }, key.replace(/\\n/g, '\n'), {
    algorithm: 'ES256', issuer: appId, expiresIn: '15m',
  });
}

export function driverPushAlias(userId: string) {
  const secret = process.env.JWT_SECRET;
  if (!secret || !process.env.ONESIGNAL_DRIVER_APP_ID || !process.env.ONESIGNAL_DRIVER_API_KEY) return null;
  return createHmac('sha256', secret).update(`onesignal-driver:${userId}`).digest('hex');
}

const titles = {
  new: 'Novo pedido na sua loja',
  ready: 'Pedido pronto para coleta',
  cancelled: 'Pedido cancelado',
  collected: 'Pedido coletado',
  delivered: 'Pedido entregue',
  assigned: 'Entregador confirmado',
  delivery_unavailable: 'Escolha uma nova opção de entrega',
  delivery_offer: 'Nova oferta de entrega',
  delivery_incident: 'Estamos verificando um imprevisto na entrega',
  delivery_reassigned: 'Buscando outro entregador',
};

type OrderEvent = keyof typeof titles;
type PushEvent = OrderEvent | 'driver_presence';

export function notifyAdminDriverPresence() {
  const appId = process.env.ONESIGNAL_WEB_APP_ID;
  const key = process.env.ONESIGNAL_WEB_API_KEY;
  const origin = process.env.ONESIGNAL_WEB_ORIGIN;
  if (!appId || !key || !origin || !process.env.ONESIGNAL_WEB_IDENTITY_PRIVATE_KEY) return;

  void (async () => {
    const { rows } = await query("SELECT id FROM users WHERE user_type = 'admin' AND status = 'active'");
    if (!rows.length) return;
    const url = new URL('/admin/entregadores?presence=updated', origin);
    await sendPush(appId, key, rows.map(({ id }) => id), 'driver_presence',
      'A disponibilidade dos entregadores foi atualizada.', { url: url.href });
  })().catch((error) => console.warn('Falha ao notificar a presença de entregadores', error));
}

export function notifyOrderEvent(event: OrderEvent, orderIds: string[], offeredDriverId?: string | null) {
  if (orderIds.length) {
    void sendOrderEvent(event, orderIds, offeredDriverId).catch((error) => {
      console.warn('Falha ao enviar push de pedido', event, error);
    });
  }
}

async function sendOrderEvent(event: OrderEvent, orderIds: string[], offeredDriverId?: string | null) {
  const webApp = process.env.ONESIGNAL_WEB_APP_ID;
  const webKey = process.env.ONESIGNAL_WEB_API_KEY;
  const origin = process.env.ONESIGNAL_WEB_ORIGIN;
  const driverApp = process.env.ONESIGNAL_DRIVER_APP_ID;
  const driverKey = process.env.ONESIGNAL_DRIVER_API_KEY;
  const web = webApp && webKey && origin && process.env.ONESIGNAL_WEB_IDENTITY_PRIVATE_KEY;
  const mobile = driverApp && driverKey && process.env.JWT_SECRET;
  if (!(web && event !== 'ready') && !(mobile && ['ready', 'cancelled', 'delivered'].includes(event))) return;

  const { rows } = await query(
    `SELECT o.id, o.business_id, o.user_id, o.delivery_driver_id, b.owner_id, (j.order_id IS NOT NULL) AS managed_delivery
     FROM orders o JOIN businesses b ON b.id = o.business_id
     LEFT JOIN delivery_dispatch j ON j.order_id = o.id
     WHERE o.id = ANY($1::uuid[])`, [orderIds],
  );
  if (!rows.length) return;
  const availableDrivers = mobile && event === 'ready' && rows.some((order) => !order.managed_delivery) ? await filterDriversEligibleForPayout((await query(
    `SELECT DISTINCT u.id FROM users u JOIN drivers d ON d.user_id = u.id
     JOIN asaas_driver_accounts a ON a.driver_id = d.user_id AND a.wallet_id IS NOT NULL AND a.encrypted_key IS NOT NULL
     WHERE u.user_type = 'driver' AND u.status = 'active' AND d.deleted_at IS NULL`,
  )).rows, ({ id }) => id) : [];

  await Promise.all(rows.map(async (order) => {
    const orderCode = order.id.slice(0, 8).toUpperCase();
    const body = `Pedido #${orderCode}${event === 'new' ? ' recebido' : ''}.`;
    const sends: Promise<boolean>[] = [];
    if (webApp && webKey && origin && web && event !== 'ready') {
      const storeUrl = new URL(`/business/${order.business_id}`, origin);
      storeUrl.searchParams.set('order', order.id);
      sends.push(sendPush(webApp, webKey, [order.owner_id], event, body, { url: storeUrl.href },
        event === 'new' ? order.id : randomUUID()));
      if (event !== 'new') {
        const customerUrl = new URL(`/order/${order.id}`, origin);
        sends.push(sendPush(webApp, webKey, [order.user_id], event, body, { url: customerUrl.href }));
      }
    }
    if (driverApp && driverKey && mobile && ['ready', 'cancelled', 'delivered'].includes(event)) {
      const assigned = order.delivery_driver_id && driverPushAlias(order.delivery_driver_id);
      const offered = event === 'cancelled' && offeredDriverId ? driverPushAlias(offeredDriverId) : null;
      const recipients = event === 'ready' ? order.managed_delivery ? [] : availableDrivers.map(({ id }) => driverPushAlias(id)!)
        : [...new Set([assigned, offered].filter((alias): alias is string => Boolean(alias)))];
      for (let offset = 0; offset < recipients.length; offset += 20000) {
        sends.push(sendPush(driverApp, driverKey, recipients.slice(offset, offset + 20000), event, body, {
          data: { orderId: order.id, section: event === 'ready' ? 'available' : 'accepted', event },
        }));
      }
    }
    await Promise.all(sends);
  }));
}

export async function notifyDriverOffer(offerId: string, orderId: string, userId: string, expiresAt: Date) {
  const appId = process.env.ONESIGNAL_DRIVER_APP_ID;
  const key = process.env.ONESIGNAL_DRIVER_API_KEY;
  const alias = driverPushAlias(userId);
  const ttl = Math.floor((expiresAt.getTime() - Date.now()) / 1000);
  if (!appId || !key || !alias || ttl < 1) return false;
  return sendPush(appId, key, [alias], 'delivery_offer', `Confira a oferta do pedido #${orderId.slice(0, 8).toUpperCase()}.`,
    { data: { orderId, section: 'available', offerId }, ttl, priority: 10 }, offerId);
}

async function sendPush(appId: string, apiKey: string, recipients: string[], event: PushEvent, body: string,
  destination: { url: string } | { data: { orderId: string; section: string; offerId?: string; event?: OrderEvent }; ttl?: number; priority?: number },
  key: string = randomUUID()) {
  try {
    const response = await fetch('https://api.onesignal.com/notifications', {
      method: 'POST',
      headers: { Authorization: `Key ${apiKey}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(5000),
      body: JSON.stringify({
        app_id: appId,
        include_aliases: { external_id: recipients },
        target_channel: 'push',
        idempotency_key: key,
        headings: { en: event === 'driver_presence' ? 'Presença de entregadores' : titles[event] },
        contents: { en: body },
        ...destination,
      }),
    });
    if (!response.ok) {
      console.warn('OneSignal recusou o envio do pedido', event, response.status);
      return false;
    }
    if (event === 'delivery_offer') {
      const result = await response.json() as { id?: unknown } | null;
      if (typeof result?.id !== 'string' || !result.id.trim()) {
        console.warn('OneSignal não criou o push da oferta. Verifique a inscrição Android ou iOS do entregador.', key);
        return false;
      }
    }
    return true;
  } catch (error) {
    console.warn('Falha no envio do push do pedido', event, error);
    return false;
  }
}
