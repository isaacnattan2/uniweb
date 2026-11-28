import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import { query } from '../config/database';
import type { AuthRequest } from '../middleware/auth';
import { storeCanReceivePayout } from '../services/AsaasStoreApproval';
import { formatDeliveryAddress, normalizeDeliveryAddress } from '../services/DeliveryAddress';
import { DeliveryProviderHttpError, routeDeliveryStops, validCoordinate } from '../services/DeliveryRouting';
import { geocodingIntervalMs, getGeocoder, locateDeliveryAddresses } from '../services/Geocoding';
import { ratePickupAddress } from '../services/OrderDeliveryDistance';
import { dispatchTransaction, dispatchUuid, dispatchWindowMinutes, findDispatchCandidates, findDispatchSlotOptions, findDispatchSlots, recordDispatchEarnings, releaseDispatchAssignment, respondToDispatchOffer } from '../services/DeliveryDispatch';
import type { DispatchRoute } from '../services/DeliveryDispatch';
import { notifyAdminDriverPresence, notifyOrderEvent } from '../services/OrderPush';
import { wakeWork } from '../services/WorkEvents';

export async function quoteDelivery(req: AuthRequest, res: Response) {
  if (req.userType !== 'customer' || !req.userId) return res.sendStatus(403);
  const { businessId, address, mode } = req.body ?? {};
  const requested = req.body?.businessIds ?? [businessId];
  const normalized = normalizeDeliveryAddress(address);
  const destination = normalized && formatDeliveryAddress(normalized);
  if (!Array.isArray(requested) || !requested.length || requested.length > 20 ||
      !requested.every((id) => typeof id === 'string' && dispatchUuid.test(id)) || !destination) {
    return res.status(400).json({ error: 'Informe a loja e o endereço completo de entrega.' });
  }
  if (mode !== 'immediate' && mode !== 'scheduled') {
    return res.status(400).json({ error: 'Escolha entrega imediata ou agendada.' });
  }
  const ids = [...new Set<string>(requested.map((id: string) => id.toLowerCase()))];
  const { rows: stores } = await query(
    `SELECT b.id, ${ratePickupAddress} AS pickup_address, b.owner_id, p.default_cents, s.radius_meters, s.subsidy_cents, s.parallel_geocoding
     FROM businesses b JOIN users u ON u.id = b.owner_id AND u.status = 'active'
     CROSS JOIN delivery_dispatch_settings s CROSS JOIN driver_delivery_rate_policy p
     WHERE b.id = ANY($1::uuid[]) AND b.status = 'active' AND b.deleted_at IS NULL ORDER BY b.id`, [ids]
  );
  if (stores.length !== ids.length || stores.some((store) => !store.pickup_address)) {
    return res.status(422).json({ error: 'Uma loja do carrinho ainda não disponibiliza frete para entrega.' });
  }
  const eligibility = await Promise.all(stores.map((store) => storeCanReceivePayout(store.id, store.owner_id)));
  if (eligibility.includes(false)) {
    return res.status(409).json({ error: 'A loja est\u00e1 com o cadastro de recebimentos pendente.' });
  }
  const geocoder = getGeocoder('delivery');
  const router = process.env.VALHALLA_ROUTE_URL?.trim();
  if (!geocoder || !router) return res.status(503).json({ error: 'A cotação de entrega está temporariamente indisponível.' });
  let route: DispatchRoute;
  let stops: { businessId: string; address: string }[];
  let provider = geocoder.name;
  const parallelGeocoding = stores[0].parallel_geocoding === true;
  let signal = AbortSignal.timeout(8000 + (parallelGeocoding ? 0 : stores.length * geocodingIntervalMs));
  try {
    const [dropoff, ...pickups] = await locateDeliveryAddresses(geocoder,
      [destination, ...stores.map((store) => store.pickup_address)], signal, parallelGeocoding);
    if (!dropoff || pickups.some((point) => !point)) {
      return res.status(422).json({ error: 'Não foi possível localizar todos os pontos de coleta e entrega.' });
    }
    const distanceFrom = (a: NonNullable<typeof dropoff>, b: NonNullable<typeof dropoff>) =>
      (a.lat - b.lat) ** 2 + (a.lon - b.lon) ** 2;
    const remaining = stores.map((store, index) => ({ store, point: pickups[index]! }));
    const ordered = [];
    let nextPoint = dropoff;
    while (remaining.length) {
      remaining.sort((a, b) => distanceFrom(a.point, nextPoint) - distanceFrom(b.point, nextPoint));
      const stop = remaining.shift()!;
      ordered.unshift(stop);
      nextPoint = stop.point;
    }
    const { point: pickup, store: settings } = ordered[0];
    stops = ordered.map(({ store }) => ({ businessId: store.id, address: store.pickup_address }));
    provider = 'valhalla';
    signal = AbortSignal.timeout(8000);
    const trip = await routeDeliveryStops(router, [...ordered.map(({ point }) => point), dropoff], signal);
    if (!trip || !Number.isFinite(trip.distance) || trip.distance < 0 || trip.distance > 1000000 ||
        !Number.isFinite(trip.duration) || trip.duration < 0) {
      return res.status(422).json({ error: 'Não foi possível calcular uma rota da loja até este endereço.' });
    }
    const distance = Math.round(trip.distance);
    route = {
      pickup_latitude: pickup.lat, pickup_longitude: pickup.lon, distance_meters: distance,
      duration_minutes: Math.max(1, Math.ceil(trip.duration / 60)) + (stops.length - 1) * 5, rate_cents: settings.default_cents,
      fee_cents: Math.round(settings.default_cents * distance / 1000),
      multiPickup: stops.length > 1,
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
  const slotOptions = mode === 'scheduled' ? await findDispatchSlotOptions(route, { query }, true) : [];
  const slots = slotOptions.map(({ slot }) => slot);
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
    options.push({ id: randomUUID(), feeCents: stops.length > 1
      ? Math.max(...slotOptions.map(({ feeCents }) => feeCents)) : route.fee_cents, estimatedMinutes: null });
  }
  if (options.length) await query(
    `INSERT INTO delivery_quotes (id, user_id, business_id, destination, pickup_address, pickup_latitude, pickup_longitude,
       distance_meters, duration_minutes, rate_cents, fee_cents, subsidy_cents, radius_meters, immediate_minutes, expires_at, pickup_stops)
     SELECT option.id,$1,$2,$3,$4,$5,$6,$7,$8,$9,option.fee_cents,$10,$11,option.estimated_minutes,NOW() + INTERVAL '5 minutes',$15::jsonb
     FROM unnest($12::uuid[], $13::int[], $14::int[]) AS option(id, fee_cents, estimated_minutes)`,
    [req.userId, stops[0].businessId, destination, stops[0].address, route.pickup_latitude, route.pickup_longitude,
      route.distance_meters, route.duration_minutes, route.rate_cents, route.subsidy_cents, route.radius_meters,
      options.map(({ id }) => id), options.map(({ feeCents }) => feeCents), options.map(({ estimatedMinutes }) => estimatedMinutes),
      stops.length > 1 ? JSON.stringify(stops) : null]
  );
  res.set('Cache-Control', 'no-store');
  return res.json({
    options, slots, windowMinutes: dispatchWindowMinutes(route),
  });
}

export async function updateDriverPresence(req: AuthRequest, res: Response) {
  if (req.userType !== 'driver' || !req.userId) return res.sendStatus(403);
  const { action, latitude, longitude } = req.body ?? {};
  const multiPickup = req.body?.multiPickup === true;
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
      'UPDATE driver_dispatch_presence SET latitude = $2, longitude = $3, location_at = NOW(), multi_pickup = $4 WHERE user_id = $1 AND online',
      [req.userId, latitude, longitude, multiPickup]
    );
    if (rowCount) return res.json({ online: true, blockedUntil: null });
    return res.json(await driverBlockStatus(req.userId));
  }
  const { rowCount } = await query(
    `INSERT INTO driver_dispatch_presence (user_id, online, latitude, longitude, location_at, checked_in_at, multi_pickup)
     SELECT user_id, true, $2, $3, NOW(), NOW(), $4 FROM drivers WHERE user_id = $1 AND deleted_at IS NULL
     ON CONFLICT (user_id) DO UPDATE SET online = true, latitude = EXCLUDED.latitude,
       longitude = EXCLUDED.longitude, location_at = NOW(), multi_pickup = EXCLUDED.multi_pickup,
       checked_in_at = NOW(), blocked_until = NULL,
       ignored_offers = CASE WHEN driver_dispatch_presence.blocked_until IS NOT NULL THEN 0 ELSE driver_dispatch_presence.ignored_offers END
     WHERE NOT driver_dispatch_presence.online
       AND (driver_dispatch_presence.blocked_until IS NULL OR driver_dispatch_presence.blocked_until <= NOW())`,
    [req.userId, latitude, longitude, multiPickup]
  );
  if (rowCount) {
    wakeWork('dispatch');
    notifyAdminDriverPresence();
    return res.json({ online: true });
  }
  const refreshed = await query(
    `UPDATE driver_dispatch_presence p SET latitude = $2, longitude = $3, location_at = NOW(), multi_pickup = $4
     WHERE p.user_id = $1 AND p.online AND EXISTS (SELECT 1 FROM drivers d WHERE d.user_id = p.user_id AND d.deleted_at IS NULL)`,
    [req.userId, latitude, longitude, multiPickup],
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
  if (!await respondToDispatchOffer(req.userId, orderId, offerId, accept, req.body?.multiPickup === true)) {
    return res.status(409).json({ error: 'A oferta expirou ou a corrida já não está disponível.' });
  }
  if (accept) notifyOrderEvent('assigned', [orderId]);
  wakeWork('dispatch');
  return res.sendStatus(204);
}

export async function markDeliveryPickedUp(req: AuthRequest, res: Response) {
  if (req.userType !== 'driver' || !req.userId) return res.sendStatus(403);
  if (!dispatchUuid.test(req.params.orderId)) return res.sendStatus(400);
  const stopOrderId = req.body?.stopOrderId;
  if (stopOrderId !== undefined && (typeof stopOrderId !== 'string' || !dispatchUuid.test(stopOrderId))) return res.sendStatus(400);
  const { orderId } = req.params;
  let collectedOrderId = orderId;
  const rowCount = await dispatchTransaction(async (client) => {
    const { rows: [order] } = await client.query(
      `SELECT j.state FROM delivery_dispatch j JOIN orders o ON o.id = j.order_id
       WHERE j.order_id = $1 AND o.delivery_driver_id = $2 FOR UPDATE OF o, j`,
      [req.params.orderId, req.userId]
    );
    if (order?.state === 'in_transit') return 2;
    if (order?.state !== 'assigned') return 0;
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1::text, 1))', [req.userId]);
    const { rows: stops } = await client.query(
      `SELECT order_id, collected_at FROM delivery_route_stops WHERE route_order_id = $1 ORDER BY position`, [orderId]);
    if (stops.length) {
      if (stops.some((stop) => stop.order_id === stopOrderId && stop.collected_at)) return 2;
      const pending = stops.filter((stop) => !stop.collected_at);
      if (pending[0]?.order_id !== stopOrderId) return 0;
      const allowed = await client.query(
        `SELECT 1 FROM delivery_dispatch j JOIN orders lead ON lead.id = j.order_id JOIN orders child ON child.id = $3
         WHERE j.order_id = $1 AND lead.delivery_driver_id = $2 AND child.payment_status = 'paid'
           AND child.order_status IN ('confirmed', 'processing') AND child.deleted_at IS NULL
           AND (j.slot_at IS NULL OR j.slot_at <= NOW())
           AND NOT EXISTS (
             SELECT 1 FROM orders active LEFT JOIN delivery_dispatch dj ON dj.order_id = active.id
             WHERE active.id <> lead.id AND active.delivery_driver_id = $2 AND active.deleted_at IS NULL
               AND (active.delivery_status = 'in_transit' OR (active.delivery_status = 'processing'
                 AND (dj.slot_at IS NULL OR dj.slot_at <= COALESCE(j.slot_at, NOW()))))
           )`, [orderId, req.userId, stopOrderId]);
      if (!allowed.rowCount) return 0;
      collectedOrderId = stopOrderId;
      if (pending.length > 1) {
        await client.query('UPDATE delivery_route_stops SET collected_at = NOW() WHERE order_id = $1', [stopOrderId]);
        return 1;
      }
    }
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
    if (result.rowCount && stops.length) {
      await client.query('UPDATE delivery_route_stops SET collected_at = NOW() WHERE order_id = $1', [stopOrderId]);
      await client.query(
        `UPDATE orders SET delivery_status = 'in_transit', order_status = 'processing'
         WHERE id IN (SELECT order_id FROM delivery_route_stops WHERE route_order_id = $1 AND order_id <> $1)`, [orderId]);
    }
    return result.rowCount;
  });
  if (!rowCount) return res.status(409).json({ error: 'A retirada ainda não está disponível. Verifique o horário e se há outra corrida ativa.' });
  if (rowCount === 1) notifyOrderEvent('collected', [collectedOrderId]);
  return res.sendStatus(204);
}

export async function dispatchSettings(req: Request, res: Response) {
  if (req.method === 'GET') {
    const { rows } = await query('SELECT radius_meters, subsidy_cents, offer_delivery_mode, missed_offer_block_minutes, enforce_delivery_deadline, audit_enabled, allow_lower_offer, parallel_geocoding, debug_started_at IS NOT NULL AS debug_enabled FROM delivery_dispatch_settings WHERE id = true');
    return res.json(rows[0]);
  }
  const { radiusMeters, subsidyCents, offerDeliveryMode, missedOfferBlockMinutes, enforceDeliveryDeadline, auditEnabled, allowLowerOffer, debugEnabled, parallelGeocoding } = req.body ?? {};
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
  if (allowLowerOffer !== undefined && typeof allowLowerOffer !== 'boolean') {
    return res.status(400).json({ error: 'Configuração de ofertas abaixo da tarifa inválida.' });
  }
  if (debugEnabled !== undefined && typeof debugEnabled !== 'boolean') {
    return res.status(400).json({ error: 'Configuração do depurador inválida.' });
  }
  if (parallelGeocoding !== undefined && typeof parallelGeocoding !== 'boolean') {
    return res.status(400).json({ error: 'Modo de consulta de endereços inválido.' });
  }
  const { rows } = await query(
    `UPDATE delivery_dispatch_settings SET radius_meters = $1, subsidy_cents = $2,
     offer_delivery_mode = COALESCE($3, offer_delivery_mode),
     missed_offer_block_minutes = COALESCE($4, missed_offer_block_minutes),
     enforce_delivery_deadline = COALESCE($5, enforce_delivery_deadline),
     audit_enabled = COALESCE($6, audit_enabled),
     allow_lower_offer = COALESCE($7, allow_lower_offer),
     parallel_geocoding = COALESCE($9, parallel_geocoding),
     debug_started_at = CASE WHEN $8::boolean THEN COALESCE(debug_started_at, clock_timestamp())
       WHEN $8::boolean = false THEN NULL ELSE debug_started_at END WHERE id = true
     RETURNING radius_meters, subsidy_cents, offer_delivery_mode, missed_offer_block_minutes, enforce_delivery_deadline, audit_enabled, allow_lower_offer, parallel_geocoding, debug_started_at IS NOT NULL AS debug_enabled`,
    [radiusMeters, subsidyCents, offerDeliveryMode, missedOfferBlockMinutes, enforceDeliveryDeadline, auditEnabled, allowLowerOffer, debugEnabled, parallelGeocoding]
  );
  wakeWork('dispatch');
  return res.json(rows[0]);
}

export async function getCurrentDispatchOffer(req: AuthRequest, res: Response) {
  if (req.userType !== 'driver' || !req.userId) return res.sendStatus(403);
  const { rows: [row] } = await query(
    `SELECT s.offer_delivery_mode, clock_timestamp() AS server_now, pending.*
     FROM delivery_dispatch_settings s LEFT JOIN LATERAL (
       SELECT f.id AS offer_id, f.order_id, f.expires_at, f.fee_cents, f.rate_cents, f.pickup_distance_meters, o.order_number,
              o.created_at, o.delivery_address, o.passenger_ride, j.pickup_address, j.distance_meters, j.slot_at,
              (SELECT json_agg(json_build_object('orderId', s.order_id, 'address', s.address,
                'storeName', store.name, 'collected', false) ORDER BY s.position)
               FROM delivery_route_stops s JOIN orders child ON child.id = s.order_id
               JOIN businesses store ON store.id = child.business_id WHERE s.route_order_id = j.order_id) AS pickups,
              b.id AS store_id, b.name AS store_name
       FROM delivery_dispatch_offers f
       JOIN delivery_dispatch j ON j.order_id = f.order_id AND j.state = 'offered'
       JOIN orders o ON o.id = f.order_id AND o.payment_status = 'paid'
         AND o.order_status IN ('confirmed','processing') AND o.deleted_at IS NULL
       LEFT JOIN businesses b ON b.id = o.business_id
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
      rateCents: row.rate_cents, distanceMeters: row.distance_meters, pickupDistanceMeters: row.pickup_distance_meters, scheduledAt: row.slot_at,
      pickup: { storeId: row.store_id ?? row.order_id, storeName: row.passenger_ride ? 'Corrida de passageiro' : row.store_name, address: row.pickup_address },
      passengerRide: row.passenger_ride,
      ...(row.pickups && { pickups: row.pickups }),
      destinationArea: null, destinationAddress: row.delivery_address,
    } : null,
  });
}

export async function listDeliveryAlternatives(req: AuthRequest, res: Response) {
  if (req.userType !== 'customer' || !req.userId) return res.sendStatus(403);
  if (!dispatchUuid.test(req.params.orderId)) return res.sendStatus(400);
  const { rows: [job] } = await query(
    `SELECT j.*, o.passenger_ride, o.passenger_vehicle_type, s.subsidy_cents AS current_subsidy_cents,
       EXISTS (SELECT 1 FROM delivery_route_stops stop WHERE stop.route_order_id = j.order_id) AS "multiPickup"
     FROM delivery_dispatch j JOIN orders o ON o.id = j.order_id
     JOIN delivery_dispatch_settings s ON s.id = true
     WHERE j.order_id = $1 AND o.user_id = $2 AND j.state = 'needs_choice' AND o.payment_status = 'paid'`,
    [req.params.orderId, req.userId]
  );
  if (!job) return res.sendStatus(404);
  const route = { ...job, subsidy_cents: job.current_subsidy_cents };
  const [immediate, slots] = await Promise.all([findDispatchCandidates({ query }, route, null), findDispatchSlots(route)]);
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
      `SELECT j.*, o.passenger_ride, o.passenger_vehicle_type, s.subsidy_cents AS current_subsidy_cents,
         EXISTS (SELECT 1 FROM delivery_route_stops stop WHERE stop.route_order_id = j.order_id) AS "multiPickup"
       FROM delivery_dispatch j JOIN orders o ON o.id = j.order_id
       JOIN delivery_dispatch_settings s ON s.id = true
       WHERE j.order_id = $1 AND o.user_id = $2 AND j.state = 'needs_choice'
         AND o.order_status = 'confirmed' AND o.payment_status = 'paid' FOR UPDATE OF o, j`, [orderId, req.userId]
    );
    if (!job) return false;
    if (slot) await client.query('SELECT pg_advisory_xact_lock(19750215)');
    const candidates = await findDispatchCandidates(client, { ...job, subsidy_cents: job.current_subsidy_cents }, slot);
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
  if (changed) wakeWork('dispatch');
  return changed ? res.sendStatus(204) : res.status(409).json({ error: 'Esta alternativa de entrega ficou indisponível.' });
}

export async function listDispatchIncidents(_req: Request, res: Response) {
  const { rows } = await query(
    `SELECT j.order_id, j.state, j.incident_reason, j.refund_state, COALESCE(b.name, 'UniCorrida') AS store_name
     FROM delivery_dispatch j JOIN orders o ON o.id = j.order_id LEFT JOIN businesses b ON b.id = o.business_id
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
    const { rows: stops } = await client.query(
      'SELECT order_id, collected_at FROM delivery_route_stops WHERE route_order_id = $1 ORDER BY position', [orderId]);
    const orderIds = stops.length ? stops.map((stop) => stop.order_id) : [orderId];
    const incomplete = stops.some((stop) => !stop.collected_at);
    if (action === 'delivered' && incomplete) return false;
    await client.query(
      'UPDATE delivery_dispatch SET resolution_reason = $2, resolved_by = $3, resolved_at = NOW() WHERE order_id = $1',
      [orderId, reason, req.userId]
    );
    if (action === 'returned') {
      await client.query('UPDATE delivery_route_stops SET collected_at = NULL WHERE route_order_id = $1', [orderId]);
      await client.query(
        `UPDATE orders SET order_status = 'confirmed', delivery_status = 'pending'
         WHERE id = ANY($1::uuid[]) AND id <> $2`, [orderIds, orderId]);
      await releaseDispatchAssignment(client, orderId, 'choice');
    } else if (action === 'resume') {
      await client.query(
        `UPDATE delivery_dispatch SET state = CASE WHEN $2::boolean THEN 'assigned' ELSE 'in_transit' END,
           promised_at = CASE WHEN $2::boolean THEN GREATEST(promised_at, NOW() + make_interval(mins => duration_minutes + 15))
                              ELSE promised_at END WHERE order_id = $1`, [orderId, incomplete]);
    } else if (action === 'delivered') {
      await client.query("UPDATE delivery_dispatch SET state = 'delivered' WHERE order_id = $1", [orderId]);
      await client.query(
        `UPDATE orders SET order_status = 'completed', delivery_status = 'delivered', delivery_confirmation_code = NULL,
         delivery_confirmation_attempts = 0, delivery_confirmation_retry_at = NULL WHERE id = ANY($1::uuid[])`, [orderIds]
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
         delivery_confirmation_code = NULL WHERE id = ANY($1::uuid[])`, [orderIds]
      );
      await client.query(
        `UPDATE deliveries SET status = 'cancelled', tracking_latitude = NULL, tracking_longitude = NULL,
         tracking_updated_at = NULL, tracking_route_requested_at = NULL WHERE order_id = $1`, [orderId]
      );
    }
    return orderIds;
  });
  if (!changed) return res.status(409).json({ error: 'A ocorrência já foi resolvida ou ainda há coletas pendentes.' });
  wakeWork('dispatch');
  if (action === 'cancel') wakeWork('refunds');
  notifyOrderEvent(action === 'returned' ? 'delivery_unavailable' : action === 'delivered' ? 'delivered' :
    action === 'cancel' ? 'cancelled' : 'collected', changed);
  return res.sendStatus(204);
}
