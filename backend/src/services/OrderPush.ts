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
  driver_checkin_blocked: 'Check-in bloqueado',
  delivery_offer: 'Nova oferta de entrega',
  delivery_incident: 'Estamos verificando um imprevisto na entrega',
  delivery_reassigned: 'Buscando outro entregador',
};

type OrderEvent = keyof typeof titles;
type PushEvent = OrderEvent | 'driver_presence';

function pushTitle(event: PushEvent, passengerRide = false) {
  if (event === 'driver_presence') return 'Presença de entregadores';
  if (event === 'cancelled' && passengerRide) return 'Corrida cancelada';
  return titles[event];
}

async function recordDriverPush(driverIds: string[], kind: OrderEvent, orderId: string, body: string,
  data: { section: string; offerId?: string; offerExpiresAtMs?: number; event?: OrderEvent; passengerRide?: boolean }) {
  if (!driverIds.length) return;
  try {
    await query(
      `INSERT INTO driver_notifications (id, driver_id, kind, title, body, data)
       SELECT $1 || ':' || driver_id, driver_id, $2, $3, $4, $5 FROM unnest($6::uuid[]) AS recipients(driver_id)
       ON CONFLICT (id) DO NOTHING`,
      [kind + ':' + (data.offerId ?? orderId), kind, pushTitle(kind, data.passengerRide), body,
        JSON.stringify({ orderId, ...data }), driverIds],
    );
  } catch (error) {
    console.warn('Falha ao registrar notificação do entregador', kind, error instanceof Error ? error.message : error);
  }
}

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
    `SELECT o.id, o.business_id, o.user_id, o.delivery_driver_id, o.passenger_ride, b.owner_id, (j.order_id IS NOT NULL) AS managed_delivery
     FROM orders o LEFT JOIN businesses b ON b.id = o.business_id
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
    const body = order.passenger_ride
      ? `Corrida #${orderCode}${event === 'cancelled' ? ' foi cancelada' : ''}.`
      : `Pedido #${orderCode}${event === 'new' ? ' recebido' : ''}.`;
    const sends: Promise<boolean>[] = [];
    if (webApp && webKey && origin && web && event !== 'ready' && !order.passenger_ride) {
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
      const driverIds: string[] = event === 'ready' ? order.managed_delivery ? [] : availableDrivers.map(({ id }) => id)
        : [...new Set<string>([order.delivery_driver_id, event === 'cancelled' && offeredDriverId]
          .filter((id): id is string => typeof id === 'string'))];
      const section = event === 'ready' ? 'available' : 'accepted';
      const data = { section, event, passengerRide: order.passenger_ride === true };
      await recordDriverPush(driverIds, event, order.id, body, data);
      const recipients = driverIds.map((id) => driverPushAlias(id)!);
      for (let offset = 0; offset < recipients.length; offset += 20000) {
        sends.push(sendPush(driverApp, driverKey, recipients.slice(offset, offset + 20000), event, body, {
          data: { orderId: order.id, ...data },
          ...(event === 'cancelled' && data.passengerRide && { priority: 10 }),
        }));
      }
    }
    await Promise.all(sends);
  }));
}

const offerCurrency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const offerDeadline = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

export async function notifyDriverOffer(offerId: string, orderId: string, userId: string, expiresAt: Date,
  feeCents: number, distanceMeters: number, passengerRide = false) {
  const appId = process.env.ONESIGNAL_DRIVER_APP_ID;
  const key = process.env.ONESIGNAL_DRIVER_API_KEY;
  const alias = driverPushAlias(userId);
  const offerExpiresAtMs = expiresAt.getTime();
  const ttl = Math.floor((offerExpiresAtMs - Date.now()) / 1000);
  if (!appId || !key || !alias || !Number.isFinite(ttl) || ttl < 1) return false;

  const perKm = distanceMeters > 0 && Number.isFinite(feeCents)
    ? ` · ${offerCurrency.format((feeCents / 100) / (distanceMeters / 1000))}/km estimado` : '';
  const body = `${passengerRide ? 'Corrida' : 'Pedido'} #${orderId.slice(0, 8).toUpperCase()}${perKm}\nAceite até ${offerDeadline.format(expiresAt)} (Brasília).`;
  const data = { orderId, section: 'available', offerId, offerExpiresAtMs };
  await recordDriverPush([userId], 'delivery_offer', orderId, body, data);
  const remaining = Math.floor((offerExpiresAtMs - Date.now()) / 1000);
  if (remaining < 1) return false;
  return sendPush(appId, key, [alias], 'delivery_offer', body, { data, ttl: remaining, priority: 10 }, offerId);
}

export async function notifyDriverCheckinBlocked(userId: string, orderId: string) {
  const appId = process.env.ONESIGNAL_DRIVER_APP_ID;
  const key = process.env.ONESIGNAL_DRIVER_API_KEY;
  const alias = driverPushAlias(userId);
  if (!appId || !key || !alias) return;
  const body = 'Seu check-out foi feito automaticamente após 3 pedidos sem resposta.';
  await recordDriverPush([userId], 'driver_checkin_blocked', orderId, body, { section: 'available' });
  await sendPush(appId, key, [alias], 'driver_checkin_blocked', body,
    { data: { orderId, section: 'available', event: 'driver_checkin_blocked' } });
}

async function sendPush(appId: string, apiKey: string, recipients: string[], event: PushEvent, body: string,
  destination: { url: string } | { data: { orderId: string; section: string; offerId?: string; offerExpiresAtMs?: number; event?: OrderEvent; passengerRide?: boolean }; ttl?: number; priority?: number },
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
        headings: { en: pushTitle(event, 'data' in destination && destination.data.passengerRide) },
        contents: { en: body },
        ...(event === 'delivery_offer' && {
          ios_sound: 'uni_delivery_offer.wav',
          existing_android_channel_id: 'uni_delivery_offers_v1',
        }),
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
