import jwt from 'jsonwebtoken';
import { query } from '../config/database';

export function signStorePushIdentity(externalId: string) {
  const appId = process.env.ONESIGNAL_WEB_APP_ID;
  const key = process.env.ONESIGNAL_WEB_IDENTITY_PRIVATE_KEY;
  if (!appId || !key || !process.env.ONESIGNAL_WEB_API_KEY || !process.env.ONESIGNAL_WEB_ORIGIN) return null;
  return jwt.sign({ identity: { external_id: externalId } }, key.replace(/\\n/g, '\n'), {
    algorithm: 'ES256', issuer: appId, expiresIn: '15m',
  });
}

export async function notifyStoreOrders(orderIds: string[]) {
  const appId = process.env.ONESIGNAL_WEB_APP_ID;
  const apiKey = process.env.ONESIGNAL_WEB_API_KEY;
  const origin = process.env.ONESIGNAL_WEB_ORIGIN;
  if (!appId || !apiKey || !origin || !process.env.ONESIGNAL_WEB_IDENTITY_PRIVATE_KEY) return;

  const { rows } = await query(
    `SELECT o.id, o.business_id, o.order_number, b.owner_id
     FROM orders o JOIN businesses b ON b.id = o.business_id
     WHERE o.id = ANY($1::uuid[])`, [orderIds],
  );
  await Promise.all(rows.map(async (order) => {
    const url = new URL(`/business/${order.business_id}`, origin);
    url.searchParams.set('order', order.id);
    try {
      const response = await fetch('https://api.onesignal.com/notifications', {
        method: 'POST',
        headers: { Authorization: `Key ${apiKey}`, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(5000),
        body: JSON.stringify({
          app_id: appId,
          include_aliases: { external_id: [order.owner_id] },
          target_channel: 'push',
          idempotency_key: order.id,
          headings: { en: 'Novo pedido na sua loja' },
          contents: { en: `Pedido #${order.order_number} recebido. Toque para abrir.` },
          url: url.href,
        }),
      });
      if (!response.ok) console.warn('OneSignal recusou o envio do pedido', order.id, response.status);
    } catch (error) {
      console.warn('Falha no envio do push do pedido', order.id, error);
    }
  }));
}
