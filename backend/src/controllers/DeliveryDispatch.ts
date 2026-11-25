import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import { query } from '../config/database';
import type { AuthRequest } from '../middleware/auth';
import { storeCanReceivePayout } from '../services/AsaasStoreApproval';
import { formatDeliveryAddress, normalizeDeliveryAddress } from '../services/DeliveryAddress';
import { DeliveryProviderHttpError, locateDeliveryAddress, routeDelivery, validCoordinate } from '../services/DeliveryRouting';
import { ratePickupAddress } from '../services/OrderDeliveryDistance';
import { dispatchTransaction, dispatchUuid, dispatchWindowMinutes, findDispatchCandidates, findDispatchSlots, recordDispatchEarnings, releaseDispatchAssignment, respondToDispatchOffer } from '../services/DeliveryDispatch';
import type { DispatchRoute } from '../services/DeliveryDispatch';
import { notifyAdminDriverPresence, notifyOrderEvent } from '../services/OrderPush';

export async function quoteDelivery(req: AuthRequest, res: Response) {
  if (req.userType !== 'customer' || !req.userId) return res.sendStatus(403);
  const { businessId, address, mode } = req.body ?? {};
  const normalized = normalizeDeliveryAddress(address);
  const destination = normalized && formatDeliveryAddress(normalized);
  if (typeof businessId !== 'string' || !dispatchUuid.test(businessId) || !destination) {
    return res.status(400).json({ error: 'Informe a loja e o endereço completo de entrega.' });
  }
  if (mode !== 'immediate' && mode !== 'scheduled') {
    return res.status(400).json({ error: 'Escolha entrega imediata ou agendada.' });
  }
  const { rows: [settings] } = await query(
    `SELECT ${ratePickupAddress} AS pickup_address, b.owner_id, p.default_cents, s.radius_meters, s.subsidy_cents
     FROM businesses b JOIN users u ON u.id = b.owner_id AND u.status = 'active'
     CROSS JOIN delivery_dispatch_settings s CROSS JOIN driver_delivery_rate_policy p
     WHERE b.id = $1 AND b.status = 'active' AND b.deleted_at IS NULL`, [businessId]
  );
  if (!settings?.pickup_address) return res.status(422).json({ error: 'A loja ainda não disponibiliza frete para entrega.' });
  if (!await storeCanReceivePayout(businessId, settings.owner_id)) {
    return res.status(409).json({ error: 'A loja est\u00e1 com o cadastro de recebimentos pendente.' });
  }
  const geocoder = process.env.NOMINATIM_SEARCH_URL?.trim();
  const router = process.env.VALHALLA_ROUTE_URL?.trim();
  if (!geocoder || !router) return res.status(503).json({ error: 'A cotação de entrega está temporariamente indisponível.' });
  let route: DispatchRoute;
  let provider = 'nominatim';
  let signal = AbortSignal.timeout(8000);
  try {
    const [pickup, dropoff] = await Promise.all([
      locateDeliveryAddress(geocoder, settings.pickup_address, signal),
      locateDeliveryAddress(geocoder, destination, signal),
    ]);
    provider = 'valhalla';
    signal = AbortSignal.timeout(8000);
    const trip = pickup && dropoff && await routeDelivery(router, pickup, dropoff, signal);
    if (!pickup || !trip || !Number.isFinite(trip.distance) || trip.distance < 0 || trip.distance > 1000000 ||
        !Number.isFinite(trip.duration) || trip.duration < 0) {
      return res.status(422).json({ error: 'Não foi possível calcular uma rota da loja até este endereço.' });
    }
    const distance = Math.round(trip.distance);
    route = {
      pickup_latitude: pickup.lat, pickup_longitude: pickup.lon, distance_meters: distance,
      duration_minutes: Math.max(1, Math.ceil(trip.duration / 60)), rate_cents: settings.default_cents,
      fee_cents: Math.round(settings.default_cents * distance / 1000),
      subsidy_cents: settings.subsidy_cents, radius_meters: settings.radius_meters,
    };
  } catch (error) {
    console.warn('[delivery-quote] Falha no serviço de entrega', {
      provider,
      timedOut: signal.aborted,
      status: error instanceof DeliveryProviderHttpError ? error.status : undefined,
    });
    return res.status(503).json({ error: 'Não foi possível cotar a entrega agora. Tente novamente.' });
  }
  const slots = mode === 'scheduled' ? await findDispatchSlots(route) : [];
  const options: { id: string; feeCents: number; estimatedMinutes: number | null }[] = [];
  if (mode === 'immediate') {
    const candidates = await findDispatchCandidates({ query }, route, null, null, null, null, true);
    const seen = new Set<string>();
    for (const candidate of candidates) {
      const estimatedMinutes = candidate.pickup_minutes + route.duration_minutes + 10;
      const key = `${candidate.fee_cents}:${estimatedMinutes}`;
      if (seen.has(key)) continue;
      seen.add(key);
      options.push({ id: randomUUID(), feeCents: candidate.fee_cents, estimatedMinutes });
    }
    options.sort((a, b) => a.feeCents - b.feeCents);
  } else if (slots.length) {
    options.push({ id: randomUUID(), feeCents: route.fee_cents, estimatedMinutes: null });
  }
  if (options.length) await query(
    `INSERT INTO delivery_quotes (id, user_id, business_id, destination, pickup_address, pickup_latitude, pickup_longitude,
       distance_meters, duration_minutes, rate_cents, fee_cents, subsidy_cents, radius_meters, immediate_minutes, expires_at)
     SELECT option.id,$1,$2,$3,$4,$5,$6,$7,$8,$9,option.fee_cents,$10,$11,option.estimated_minutes,NOW() + INTERVAL '5 minutes'
     FROM unnest($12::uuid[], $13::int[], $14::int[]) AS option(id, fee_cents, estimated_minutes)`,
    [req.userId, businessId, destination, settings.pickup_address, route.pickup_latitude, route.pickup_longitude,
      route.distance_meters, route.duration_minutes, route.rate_cents, route.subsidy_cents, route.radius_meters,
      options.map(({ id }) => id), options.map(({ feeCents }) => feeCents), options.map(({ estimatedMinutes }) => estimatedMinutes)]
  );
  res.set('Cache-Control', 'no-store');
  return res.json({
    options, slots, windowMinutes: dispatchWindowMinutes(route),
  });
}

export async function updateDriverPresence(req: AuthRequest, res: Response) {
  if (req.userType !== 'driver' || !req.userId) return res.sendStatus(403);
  const { action, latitude, longitude } = req.body ?? {};
  if (!['checkin','checkout','location'].includes(action) ||
      (action !== 'checkout' && (!validCoordinate(latitude, 90) || !validCoordinate(longitude, 180)))) {
    return res.status(400).json({ error: 'Informe uma ação e localização válidas.' });
  }
  if (action === 'checkout') {
    const { rowCount } = await query(
      'UPDATE driver_dispatch_presence SET online = false, latitude = NULL, longitude = NULL, location_at = NULL WHERE user_id = $1 AND online',
      [req.userId],
    );
    if (rowCount) notifyAdminDriverPresence();
    return res.json({ online: false });
  }
  if (action === 'location') {
    const { rowCount } = await query(
      'UPDATE driver_dispatch_presence SET latitude = $2, longitude = $3, location_at = NOW() WHERE user_id = $1 AND online',
      [req.userId, latitude, longitude]
    );
    if (rowCount) return res.json({ online: true, blockedUntil: null });
    return res.json(await driverBlockStatus(req.userId));
  }
  const { rowCount } = await query(
    `INSERT INTO driver_dispatch_presence (user_id, online, latitude, longitude, location_at, checked_in_at)
     SELECT user_id, true, $2, $3, NOW(), NOW() FROM drivers WHERE user_id = $1 AND deleted_at IS NULL
     ON CONFLICT (user_id) DO UPDATE SET online = true, latitude = EXCLUDED.latitude,
       longitude = EXCLUDED.longitude, location_at = NOW(),
       checked_in_at = NOW(), blocked_until = NULL,
       ignored_offers = CASE WHEN driver_dispatch_presence.blocked_until IS NOT NULL THEN 0 ELSE driver_dispatch_presence.ignored_offers END
     WHERE NOT driver_dispatch_presence.online
       AND (driver_dispatch_presence.blocked_until IS NULL OR driver_dispatch_presence.blocked_until <= NOW())`,
    [req.userId, latitude, longitude]
  );
  if (rowCount) {
    notifyAdminDriverPresence();
    return res.json({ online: true });
  }
  const refreshed = await query(
    `UPDATE driver_dispatch_presence p SET latitude = $2, longitude = $3, location_at = NOW()
     WHERE p.user_id = $1 AND p.online AND EXISTS (SELECT 1 FROM drivers d WHERE d.user_id = p.user_id AND d.deleted_at IS NULL)`,
    [req.userId, latitude, longitude],
  );
  if (refreshed.rowCount) return res.json({ online: true, blockedUntil: null });
  return res.json(await driverBlockStatus(req.userId));
}

async function driverBlockStatus(userId: string) {
  const { rows: [presence] } = await query(
    'SELECT online, CASE WHEN blocked_until > NOW() THEN blocked_until END AS "blockedUntil", clock_timestamp() AS "serverNow" FROM driver_dispatch_presence WHERE user_id = $1',
    [userId],
  );
  return { online: Boolean(presence?.online), blockedUntil: presence?.blockedUntil ?? null, serverNow: presence?.serverNow };
}

export async function readDriverDispatch(req: AuthRequest, res: Response) {
  if (req.userType !== 'driver' || !req.userId) return res.sendStatus(403);
  const [presence, shifts, weeklyShifts, missed] = await Promise.all([
    driverBlockStatus(req.userId),
    query('SELECT id, starts_at, ends_at FROM driver_dispatch_shifts WHERE user_id = $1 AND ends_at > NOW() ORDER BY starts_at LIMIT 100', [req.userId]),
    query(`SELECT id, days, to_char(start_time, 'HH24:MI') AS start_time,
      to_char(end_time, 'HH24:MI') AS end_time, time_zone
      FROM driver_dispatch_weekly_shifts WHERE user_id = $1 ORDER BY days, start_time, id`, [req.userId]),
    query(`SELECT f.id, f.order_id, o.order_number, f.missed_at FROM delivery_dispatch_offers f
           JOIN orders o ON o.id = f.order_id WHERE f.user_id = $1 AND f.missed_at IS NOT NULL
           ORDER BY f.missed_at DESC, f.id LIMIT 100`, [req.userId]),
  ]);
  res.set('Cache-Control', 'no-store');
  return res.json({ ...presence, shifts: shifts.rows, weeklyShifts: weeklyShifts.rows, missedOffers: missed.rows });
}

export async function changeDriverShift(req: AuthRequest, res: Response) {
  if (req.userType !== 'driver' || !req.userId) return res.sendStatus(403);
  const { id } = req.params;
  if (req.method === 'DELETE') {
    if (!dispatchUuid.test(id)) return res.sendStatus(400);
    const { rowCount } = await query(
      `DELETE FROM driver_dispatch_shifts s WHERE s.id = $1 AND s.user_id = $2 AND NOT EXISTS (
         SELECT 1 FROM orders o JOIN delivery_dispatch j ON j.order_id = o.id
         WHERE o.delivery_driver_id = $2 AND j.state IN ('assigned','in_transit','incident')
           AND j.slot_at >= s.starts_at AND j.slot_at < s.ends_at
       )`, [id, req.userId]
    );
    return rowCount ? res.sendStatus(204) : res.status(409).json({ error: 'O horário está indisponível para exclusão ou tem entrega confirmada.' });
  }
  const parseDate = (value: unknown) => typeof value === 'string' ? Date.parse(value) : NaN;
  const start = parseDate(req.body?.startsAt);
  const end = parseDate(req.body?.endsAt);
  const { latitude, longitude } = req.body ?? {};
  if (!Number.isFinite(start) || !Number.isFinite(end) || start <= Date.now() ||
      end - start < 30 * 60000 || end - start > 24 * 3600000 || start > Date.now() + 30 * 86400000 ||
      !validCoordinate(latitude, 90) || !validCoordinate(longitude, 180)) {
    return res.status(400).json({ error: 'Informe um horário futuro de 30 minutos a 24 horas, dentro dos próximos 30 dias.' });
  }
  const result = await dispatchTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1::text, 1))', [req.userId]);
    return client.query(
      `INSERT INTO driver_dispatch_shifts (id, user_id, starts_at, ends_at, latitude, longitude)
       SELECT $1,$2,$3,$4,$5,$6 WHERE NOT EXISTS (
         SELECT 1 FROM driver_dispatch_shift_occurrences($3, $4, $2)
       ) AND (SELECT COUNT(*) FROM driver_dispatch_shifts WHERE user_id = $2 AND ends_at > NOW()) < 100
       RETURNING id, starts_at, ends_at`, [randomUUID(), req.userId, new Date(start), new Date(end), latitude, longitude]
    );
  });
  return result.rowCount ? res.status(201).json(result.rows[0]) : res.status(409).json({ error: 'O horário sobrepõe outro período ou a agenda está cheia.' });
}

export async function changeDriverWeeklyShift(req: AuthRequest, res: Response) {
  if (req.userType !== 'driver' || !req.userId) return res.sendStatus(403);
  const userId = req.userId;
  if (req.method === 'DELETE') {
    const { id } = req.params;
    if (!dispatchUuid.test(id)) return res.sendStatus(400);
    const removed = await dispatchTransaction(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1::text, 1))', [userId]);
      const { rowCount } = await client.query(
        `DELETE FROM driver_dispatch_weekly_shifts rule WHERE rule.id = $1 AND rule.user_id = $2 AND NOT EXISTS (
           SELECT 1 FROM orders o JOIN delivery_dispatch j ON j.order_id = o.id
           CROSS JOIN LATERAL driver_dispatch_shift_occurrences(j.slot_at, j.slot_at + INTERVAL '1 second', $2) shift
           WHERE o.delivery_driver_id = $2 AND j.state IN ('assigned','in_transit','incident')
             AND shift.id = rule.id AND shift.starts_at <= j.slot_at
         )`, [id, userId]
      );
      return Boolean(rowCount);
    });
    return removed ? res.sendStatus(204) : res.status(409).json({ error: 'O horário não pode ser excluído enquanto houver entrega confirmada nele.' });
  }

  const { days, startsAt, endsAt, timeZone, latitude, longitude } = req.body ?? {};
  const timeFormat = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
  if (!Array.isArray(days) || days.length < 1 || days.length > 7 ||
      !days.every((day) => Number.isInteger(day) && day >= 1 && day <= 7) ||
      typeof startsAt !== 'string' || !timeFormat.test(startsAt) || typeof endsAt !== 'string' || !timeFormat.test(endsAt) ||
      typeof timeZone !== 'string' || timeZone.length > 64 ||
      !validCoordinate(latitude, 90) || !validCoordinate(longitude, 180)) {
    return res.status(400).json({ error: 'Selecione os dias, informe início e fim e confirme a localização.' });
  }
  const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
  if ((minutes(endsAt) - minutes(startsAt) + 1440) % 1440 < 30) {
    return res.status(400).json({ error: 'O turno precisa ter pelo menos 30 minutos e terminar em um horário diferente do início.' });
  }
  const dayNumbers = [...new Set<number>(days)].sort((a, b) => a - b);
  const saved = await dispatchTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1::text, 1))', [userId]);
    const { rows: [zone] } = await client.query('SELECT name FROM pg_timezone_names WHERE name = $1', [timeZone]);
    if (!zone) return 'invalid-zone';
    const id = randomUUID();
    const { rows: [shift] } = await client.query(
      `INSERT INTO driver_dispatch_weekly_shifts (id, user_id, days, start_time, end_time, time_zone, latitude, longitude)
       SELECT $1, $2, $3, $4, $5, $6, $7, $8
       WHERE (SELECT COUNT(*) FROM driver_dispatch_weekly_shifts WHERE user_id = $2) < 32
       RETURNING id, days, to_char(start_time, 'HH24:MI') AS start_time,
         to_char(end_time, 'HH24:MI') AS end_time, time_zone`,
      [id, userId, dayNumbers, startsAt, endsAt, timeZone, latitude, longitude]
    );
    if (!shift) return null;
    const { rows: [overlap] } = await client.query(
      `WITH occurrences AS MATERIALIZED (
         SELECT * FROM driver_dispatch_shift_occurrences(NOW(), NOW() + INTERVAL '32 days', $2)
       )
       SELECT 1 FROM occurrences added JOIN occurrences other ON other.id <> added.id
         AND other.starts_at < added.ends_at AND other.ends_at > added.starts_at
       WHERE added.id = $1 LIMIT 1`, [id, userId]
    );
    if (overlap) {
      await client.query('DELETE FROM driver_dispatch_weekly_shifts WHERE id = $1', [id]);
      return null;
    }
    return shift;
  });
  if (saved === 'invalid-zone') return res.status(400).json({ error: 'O fuso horário do aparelho é inválido.' });
  return saved ? res.status(201).json(saved) : res.status(409).json({ error: 'O horário sobrepõe outro período ou a agenda está cheia.' });
}

export async function respondDispatch(req: AuthRequest, res: Response) {
  if (req.userType !== 'driver' || !req.userId) return res.sendStatus(403);
  const { orderId } = req.params;
  const { offerId, accept } = req.body ?? {};
  if (!dispatchUuid.test(orderId) || typeof offerId !== 'string' || !dispatchUuid.test(offerId) || typeof accept !== 'boolean') {
    return res.status(400).json({ error: 'Oferta inválida.' });
  }
  if (!await respondToDispatchOffer(req.userId, orderId, offerId, accept)) {
    return res.status(409).json({ error: 'A oferta expirou ou a corrida já não está disponível.' });
  }
  if (accept) notifyOrderEvent('assigned', [orderId]);
  return res.sendStatus(204);
}

export async function markDeliveryPickedUp(req: AuthRequest, res: Response) {
  if (req.userType !== 'driver' || !req.userId) return res.sendStatus(403);
  if (!dispatchUuid.test(req.params.orderId)) return res.sendStatus(400);
  const rowCount = await dispatchTransaction(async (client) => {
    const { rows: [order] } = await client.query(
      `SELECT j.state FROM delivery_dispatch j JOIN orders o ON o.id = j.order_id
       WHERE j.order_id = $1 AND o.delivery_driver_id = $2 FOR UPDATE OF o, j`,
      [req.params.orderId, req.userId]
    );
    if (order?.state === 'in_transit') return 2;
    if (order?.state !== 'assigned') return 0;
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1::text, 1))', [req.userId]);
    const result = await client.query(
    `WITH picked_up AS (
       UPDATE orders o SET delivery_status = 'in_transit'
       FROM delivery_dispatch j WHERE j.order_id = o.id AND o.id = $1 AND o.delivery_driver_id = $2
         AND o.payment_status = 'paid' AND o.order_status = 'processing' AND o.deleted_at IS NULL
         AND j.state = 'assigned' AND o.delivery_status = 'processing' AND (j.slot_at IS NULL OR j.slot_at <= NOW())
         AND NOT EXISTS (
           SELECT 1 FROM orders active LEFT JOIN delivery_dispatch dj ON dj.order_id = active.id
           WHERE active.id <> o.id AND active.delivery_driver_id = $2 AND active.deleted_at IS NULL
             AND (active.delivery_status = 'in_transit' OR (active.delivery_status = 'processing'
               AND (dj.slot_at IS NULL OR dj.slot_at <= COALESCE(j.slot_at, NOW()))))
         )
       RETURNING o.id
     ), delivery AS (
       UPDATE deliveries SET status = 'in_transit' WHERE order_id IN (SELECT id FROM picked_up)
     )
     UPDATE delivery_dispatch SET state = 'in_transit' WHERE order_id IN (SELECT id FROM picked_up)`,
      [req.params.orderId, req.userId]
    );
    return result.rowCount;
  });
  if (!rowCount) return res.status(409).json({ error: 'A retirada ainda não está disponível. Verifique o horário e se há outra corrida ativa.' });
  if (rowCount === 1) notifyOrderEvent('collected', [req.params.orderId]);
  return res.sendStatus(204);
}

export async function dispatchSettings(req: Request, res: Response) {
  if (req.method === 'GET') {
    const { rows } = await query('SELECT radius_meters, subsidy_cents, offer_delivery_mode, missed_offer_block_minutes, enforce_delivery_deadline, audit_enabled FROM delivery_dispatch_settings WHERE id = true');
    return res.json(rows[0]);
  }
  const { radiusMeters, subsidyCents, offerDeliveryMode, missedOfferBlockMinutes, enforceDeliveryDeadline, auditEnabled } = req.body ?? {};
  if (!Number.isInteger(radiusMeters) || radiusMeters < 100 || radiusMeters > 100000 ||
      !Number.isInteger(subsidyCents) || subsidyCents < 0 || subsidyCents > 1000000 ||
      (offerDeliveryMode !== undefined && !['push', 'polling'].includes(offerDeliveryMode))) {
    return res.status(400).json({ error: 'Informe um raio, um teto de subsídio e um modo de ofertas válidos.' });
  }
  if (missedOfferBlockMinutes !== undefined && (!Number.isInteger(missedOfferBlockMinutes) || missedOfferBlockMinutes < 1 || missedOfferBlockMinutes > 10080)) {
    return res.status(400).json({ error: 'Informe um bloqueio entre 1 e 10080 minutos.' });
  }
  if (enforceDeliveryDeadline !== undefined && typeof enforceDeliveryDeadline !== 'boolean') {
    return res.status(400).json({ error: 'Informe se o prazo estimado deve ser um critério de elegibilidade.' });
  }
  if (auditEnabled !== undefined && typeof auditEnabled !== 'boolean') {
    return res.status(400).json({ error: 'Informe se a auditoria deve ficar habilitada.' });
  }
  const { rows } = await query(
    `UPDATE delivery_dispatch_settings SET radius_meters = $1, subsidy_cents = $2,
     offer_delivery_mode = COALESCE($3, offer_delivery_mode),
     missed_offer_block_minutes = COALESCE($4, missed_offer_block_minutes),
     enforce_delivery_deadline = COALESCE($5, enforce_delivery_deadline),
     audit_enabled = COALESCE($6, audit_enabled) WHERE id = true
     RETURNING radius_meters, subsidy_cents, offer_delivery_mode, missed_offer_block_minutes, enforce_delivery_deadline, audit_enabled`,
    [radiusMeters, subsidyCents, offerDeliveryMode, missedOfferBlockMinutes, enforceDeliveryDeadline, auditEnabled]
  );
  return res.json(rows[0]);
}

export async function getCurrentDispatchOffer(req: AuthRequest, res: Response) {
  if (req.userType !== 'driver' || !req.userId) return res.sendStatus(403);
  const { rows: [row] } = await query(
    `SELECT s.offer_delivery_mode, clock_timestamp() AS server_now, pending.*
     FROM delivery_dispatch_settings s LEFT JOIN LATERAL (
       SELECT f.id AS offer_id, f.order_id, f.expires_at, f.fee_cents, f.rate_cents, o.order_number,
              o.created_at, o.delivery_address, j.pickup_address, j.distance_meters, j.slot_at,
              b.id AS store_id, b.name AS store_name
       FROM delivery_dispatch_offers f
       JOIN delivery_dispatch j ON j.order_id = f.order_id AND j.state = 'offered'
       JOIN orders o ON o.id = f.order_id AND o.payment_status = 'paid'
         AND o.order_status IN ('confirmed','processing') AND o.deleted_at IS NULL
       JOIN businesses b ON b.id = o.business_id
       WHERE f.user_id = $1 AND f.state = 'pending' AND f.expires_at > clock_timestamp()
         AND NOT EXISTS (SELECT 1 FROM driver_dispatch_presence p WHERE p.user_id = $1 AND p.blocked_until > NOW())
       LIMIT 1
     ) pending ON true WHERE s.id = true`, [req.userId]
  );
  res.set('Cache-Control', 'no-store');
  return res.json({
    mode: row.offer_delivery_mode,
    serverNow: row.server_now,
    offer: row.offer_id ? {
      managed: true, orderId: row.order_id, orderNumber: row.order_number, createdAt: row.created_at,
      offerId: row.offer_id, offerExpiresAt: row.expires_at, deliveryFee: row.fee_cents / 100,
      rateCents: row.rate_cents, distanceMeters: row.distance_meters, scheduledAt: row.slot_at,
      pickup: { storeId: row.store_id, storeName: row.store_name, address: row.pickup_address },
      destinationArea: null, destinationAddress: row.delivery_address,
    } : null,
  });
}

export async function listDeliveryAlternatives(req: AuthRequest, res: Response) {
  if (req.userType !== 'customer' || !req.userId) return res.sendStatus(403);
  if (!dispatchUuid.test(req.params.orderId)) return res.sendStatus(400);
  const { rows: [job] } = await query(
    `SELECT j.* FROM delivery_dispatch j JOIN orders o ON o.id = j.order_id
     WHERE j.order_id = $1 AND o.user_id = $2 AND j.state = 'needs_choice' AND o.payment_status = 'paid'`,
    [req.params.orderId, req.userId]
  );
  if (!job) return res.sendStatus(404);
  const [immediate, slots] = await Promise.all([findDispatchCandidates({ query }, job, null), findDispatchSlots(job)]);
  res.set('Cache-Control', 'no-store');
  return res.json({ immediate: immediate.length > 0, slots, windowMinutes: dispatchWindowMinutes(job) });
}

export async function rescheduleDelivery(req: AuthRequest, res: Response) {
  if (req.userType !== 'customer' || !req.userId) return res.sendStatus(403);
  const { orderId } = req.params;
  const value = req.body?.scheduledAt;
  const slot = typeof value === 'string' ? new Date(value) : null;
  if (!dispatchUuid.test(orderId) || (value !== null && (!slot || !Number.isFinite(slot.getTime()) ||
      slot.getTime() % 1800000 !== 0 || slot.getTime() < Date.now() + 40 * 60000 || slot.getTime() > Date.now() + 7 * 86400000))) {
    return res.status(400).json({ error: 'Selecione um horário disponível.' });
  }
  const changed = await dispatchTransaction(async (client) => {
    const { rows: [job] } = await client.query(
      `SELECT j.* FROM delivery_dispatch j JOIN orders o ON o.id = j.order_id
       WHERE j.order_id = $1 AND o.user_id = $2 AND j.state = 'needs_choice'
         AND o.order_status = 'confirmed' AND o.payment_status = 'paid' FOR UPDATE OF o, j`, [orderId, req.userId]
    );
    if (!job) return false;
    if (slot) await client.query('SELECT pg_advisory_xact_lock(19750215)');
    const candidates = await findDispatchCandidates(client, job, slot);
    if (!candidates.length) return false;
    const promise = new Date((slot?.getTime() ?? Date.now()) +
      (slot ? dispatchWindowMinutes(job) : candidates[0].pickup_minutes + job.duration_minutes + 15) * 60000);
    await client.query(
      `UPDATE delivery_dispatch SET slot_at = $2, state = CASE WHEN $2::timestamptz IS NULL THEN 'searching' ELSE 'scheduled' END,
       promised_at = $3, search_cycle = search_cycle + 1, capacity_driver_id = $4, next_attempt_at = NULL,
       search_until = CASE WHEN $2 IS NULL THEN NOW() + INTERVAL '5 minutes' ELSE $2 + INTERVAL '15 minutes' END
       WHERE order_id = $1`, [orderId, slot, promise, slot ? candidates[0].user_id : null]
    );
    return true;
  });
  return changed ? res.sendStatus(204) : res.status(409).json({ error: 'Esta alternativa de entrega ficou indisponível.' });
}

export async function listDispatchIncidents(_req: Request, res: Response) {
  const { rows } = await query(
    `SELECT j.order_id, j.state, j.incident_reason, j.refund_state, b.name AS store_name
     FROM delivery_dispatch j JOIN orders o ON o.id = j.order_id JOIN businesses b ON b.id = o.business_id
     WHERE j.state = 'incident' OR j.refund_state IN ('pending','processing','review')
     ORDER BY o.updated_at DESC LIMIT 100`
  );
  res.set('Cache-Control', 'no-store');
  return res.json(rows);
}

export async function resolveDispatchIncident(req: AuthRequest, res: Response) {
  const { orderId } = req.params;
  const { action } = req.body ?? {};
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
  if (!dispatchUuid.test(orderId) || !['resume','returned','delivered','cancel'].includes(action)
      || reason.length < 3 || reason.length > 500) {
    return res.status(400).json({ error: 'Informe uma resolução e registre o motivo.' });
  }
  const changed = await dispatchTransaction(async (client) => {
    const { rows: [job] } = await client.query(
      `SELECT j.*, o.delivery_driver_id, o.delivery_status FROM delivery_dispatch j JOIN orders o ON o.id = j.order_id
       WHERE j.order_id = $1 AND j.state = 'incident' AND o.payment_status = 'paid' FOR UPDATE OF o, j`, [orderId]
    );
    if (!job) return false;
    await client.query(
      'UPDATE delivery_dispatch SET resolution_reason = $2, resolved_by = $3, resolved_at = NOW() WHERE order_id = $1',
      [orderId, reason, req.userId]
    );
    if (action === 'returned') {
      await releaseDispatchAssignment(client, orderId, 'choice');
    } else if (action === 'resume') {
      await client.query("UPDATE delivery_dispatch SET state = 'in_transit' WHERE order_id = $1", [orderId]);
    } else if (action === 'delivered') {
      await client.query("UPDATE delivery_dispatch SET state = 'delivered' WHERE order_id = $1", [orderId]);
      await client.query(
        `UPDATE orders SET order_status = 'completed', delivery_status = 'delivered', delivery_confirmation_code = NULL,
         delivery_confirmation_attempts = 0, delivery_confirmation_retry_at = NULL WHERE id = $1`, [orderId]
      );
      await client.query(
        `UPDATE deliveries SET status = 'delivered', completed_at = NOW(), tracking_latitude = NULL,
         tracking_longitude = NULL, tracking_updated_at = NULL, tracking_route_requested_at = NULL WHERE order_id = $1`, [orderId]
      );
      await recordDispatchEarnings(client, orderId);
    } else {
      await client.query("UPDATE delivery_dispatch SET state = 'cancelled', refund_state = 'pending' WHERE order_id = $1", [orderId]);
      await client.query(
        `UPDATE orders SET order_status = 'cancelled', delivery_status = 'cancelled',
         delivery_confirmation_code = NULL WHERE id = $1`, [orderId]
      );
      await client.query(
        `UPDATE deliveries SET status = 'cancelled', tracking_latitude = NULL, tracking_longitude = NULL,
         tracking_updated_at = NULL, tracking_route_requested_at = NULL WHERE order_id = $1`, [orderId]
      );
    }
    return true;
  });
  if (!changed) return res.status(409).json({ error: 'Esta ocorrência já foi resolvida.' });
  notifyOrderEvent(action === 'returned' ? 'delivery_unavailable' : action === 'delivered' ? 'delivered' :
    action === 'cancel' ? 'cancelled' : 'collected', [orderId]);
  return res.sendStatus(204);
}
