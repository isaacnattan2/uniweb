import { recordDispatchAudit, type DispatchAuditEvent } from './DeliveryDispatchAudit';
import { randomInt, randomUUID } from 'node:crypto';
import type { PoolClient, QueryResult } from 'pg';
import { getClient, query } from '../config/database';
import { driverCanReceivePayout, filterDriversEligibleForPayout } from './AsaasStoreApproval';
import { notifyAdminDriverPresence, notifyDriverCheckinBlocked, notifyDriverOffer, notifyOrderEvent } from './OrderPush';

export const dispatchUuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

export interface DispatchRoute {
  pickup_latitude: number;
  pickup_longitude: number;
  distance_meters: number;
  duration_minutes: number;
  rate_cents: number;
  fee_cents: number;
  subsidy_cents: number;
  radius_meters: number;
}

type DispatchDatabase = { query: (sql: string, parameters?: unknown[]) => Promise<QueryResult> };

export function dispatchWindowMinutes(route: DispatchRoute) {
  return route.duration_minutes + Math.ceil(route.radius_meters / 300) + 30;
}

const eligibleDrivers = (audit: boolean) => `
  SELECT d.user_id, COALESCE(
    CASE WHEN cfg.allow_custom AND NOT d.delivery_rate_locked
      AND (cfg.minimum_cents IS NULL OR d.delivery_rate_cents >= cfg.minimum_cents)
      AND (cfg.maximum_cents IS NULL OR d.delivery_rate_cents <= cfg.maximum_cents)
      THEN d.delivery_rate_cents END, $5::int) AS rate_cents,
    location.latitude, location.longitude,
    CASE WHEN location.latitude IS NOT NULL AND location.longitude IS NOT NULL THEN
      12742000 * asin(sqrt(LEAST(1,
        power(sin(radians(location.latitude - $1::float8)/2), 2)
        + cos(radians($1::float8)) * cos(radians(location.latitude)) * power(sin(radians(location.longitude - $2::float8)/2), 2)
      ))) END AS pickup_meters,
    p.location_at, p.blocked_until,
    array_remove(ARRAY[
    CASE WHEN (a.wallet_id IS NOT NULL AND a.encrypted_key IS NOT NULL) IS NOT TRUE THEN 'financial_account_missing' END,
    CASE WHEN (p.blocked_until IS NULL OR p.blocked_until <= NOW()) IS NOT TRUE THEN 'checkin_blocked' END,
    CASE WHEN ($8::timestamptz IS NOT NULL OR p.online) IS NOT TRUE THEN 'offline' END,
    CASE WHEN (($11::uuid IS NOT NULL OR $9::uuid IS NULL OR NOT EXISTS (
      SELECT 1 FROM delivery_dispatch_offers f JOIN delivery_dispatch j ON j.order_id = f.order_id
      WHERE f.order_id = $9 AND f.user_id = u.id AND f.search_cycle = j.search_cycle
    ))) IS NOT TRUE THEN 'already_offered' END,
    CASE WHEN (($8::timestamptz IS NOT NULL AND $9::uuid IS NULL OR NOT EXISTS (
      SELECT 1 FROM delivery_dispatch_offers f WHERE f.user_id = u.id AND f.state = 'pending'
        AND ($11::uuid IS NULL OR f.order_id IS DISTINCT FROM $9::uuid)
    ))) IS NOT TRUE THEN 'pending_offer' END,
    CASE WHEN (($8::timestamptz IS NOT NULL AND $9::uuid IS NULL OR NOT EXISTS (
      SELECT 1 FROM orders o LEFT JOIN delivery_dispatch j ON j.order_id = o.id
      WHERE o.delivery_driver_id = u.id AND o.deleted_at IS NULL
        AND o.delivery_status IN ('processing', 'in_transit')
        AND (j.slot_at IS NULL OR j.slot_at <= NOW() OR j.state IN ('in_transit', 'incident'))
    ))) IS NOT TRUE THEN 'active_delivery' END,
    CASE WHEN (NOT EXISTS (
      SELECT 1 FROM delivery_dispatch j JOIN orders o ON o.id = j.order_id
      WHERE COALESCE(o.delivery_driver_id, j.capacity_driver_id) = u.id AND j.order_id IS DISTINCT FROM $9::uuid
        AND (j.state IN ('scheduled','searching','offered','assigned','in_transit','incident')
          OR (j.state = 'payment_pending' AND o.created_at > NOW() - INTERVAL '35 minutes'))
        AND (
          (j.slot_at IS NOT NULL
            AND j.slot_at < COALESCE($8, NOW()) + make_interval(mins => $4::int + ($7::int + 299) / 300 + 15)
            AND j.slot_at + make_interval(mins => j.duration_minutes + (j.radius_meters + 299) / 300 + 15) > COALESCE($8, NOW()))
          OR ($8::timestamptz IS NOT NULL AND j.slot_at IS NULL AND j.state IN ('assigned','in_transit','incident')
            AND (j.state = 'incident' OR j.promised_at + INTERVAL '15 minutes' > $8))
        )
    )) IS NOT TRUE THEN 'conflicting_reservation' END
    ], NULL) AS exclusion_reasons
  FROM drivers d JOIN users u ON u.id = d.user_id AND u.status = 'active' AND u.user_type = 'driver'
  LEFT JOIN asaas_driver_accounts a ON a.driver_id = d.user_id
  LEFT JOIN driver_dispatch_presence p ON p.user_id = d.user_id
  LEFT JOIN driver_delivery_rate_policy cfg ON cfg.id = true
  LEFT JOIN LATERAL (
    SELECT s.latitude, s.longitude FROM driver_dispatch_shift_occurrences($8::timestamptz, $8 + INTERVAL '1 second', d.user_id) s
    WHERE s.user_id = d.user_id AND s.starts_at <= $8::timestamptz
      AND s.ends_at >= $8 + make_interval(mins => $4::int + ($7::int + 299) / 300 + 15)
    ORDER BY s.starts_at LIMIT 1
  ) shift ON true
  CROSS JOIN LATERAL (
    SELECT CASE WHEN $8::timestamptz IS NOT NULL THEN shift.latitude
      WHEN p.location_at > NOW() - INTERVAL '2 minutes' THEN p.latitude END AS latitude,
      CASE WHEN $8::timestamptz IS NOT NULL THEN shift.longitude
      WHEN p.location_at > NOW() - INTERVAL '2 minutes' THEN p.longitude END AS longitude
  ) location
  WHERE d.deleted_at IS NULL
    ${audit ? "AND ($8::timestamptz IS NOT NULL OR p.online OR p.blocked_until > NOW())" : ""}
    AND ($11::uuid IS NULL OR d.user_id = $11)
    `;

export async function findDispatchCandidates(
  db: DispatchDatabase, route: DispatchRoute, slot: Date | null,
  orderId: string | null = null, promisedAt: Date | null = null,
  reservedUserId: string | null = null,
  allRates = false,
  audit?: { searchCycle: number; searchUntil: Date; record: (event: DispatchAuditEvent) => void },
) {
  const { rows } = await db.query(
    `WITH eligible AS (${eligibleDrivers(Boolean(audit))}), priced AS (
      SELECT *, ROUND(rate_cents::numeric * $3::int / 1000)::int AS fee_cents,
        CEIL(COALESCE(pickup_meters, $7::int) / 300)::int AS pickup_minutes
      FROM eligible
    ), evaluated AS (
      SELECT *, exclusion_reasons || array_remove(ARRAY[
        CASE WHEN pickup_meters IS NULL THEN CASE WHEN $8::timestamptz IS NULL
          THEN 'location_missing_or_stale' ELSE 'shift_unavailable' END
          WHEN pickup_meters > $7::int THEN 'outside_radius' END,
        CASE WHEN NOT ($12::boolean OR $11::uuid IS NOT NULL OR fee_cents <= $6::int) THEN 'fee_over_limit' END,
        CASE WHEN pickup_meters IS NOT NULL AND $10::timestamptz IS NOT NULL
          AND GREATEST(NOW(), COALESCE($8, NOW())) + make_interval(mins => pickup_minutes + $4::int) > $10
          THEN 'cannot_arrive_in_time' END
      ], NULL) AS reasons FROM priced
    )
    SELECT user_id, rate_cents, fee_cents, pickup_minutes, latitude, longitude,
      pickup_meters, location_at, blocked_until, reasons FROM evaluated
    ${audit ? '' : 'WHERE cardinality(reasons) = 0'}
    ORDER BY pickup_minutes, fee_cents, user_id`,
    [route.pickup_latitude, route.pickup_longitude, route.distance_meters, route.duration_minutes,
      route.rate_cents, route.fee_cents + route.subsidy_cents, route.radius_meters, slot, orderId, promisedAt, reservedUserId, allRates],
  );
  const candidates = rows.filter((row) => row.reasons.length === 0) as {
    user_id: string; rate_cents: number; fee_cents: number; pickup_minutes: number; latitude: number; longitude: number;
  }[];
  if (reservedUserId) return candidates.length && await driverCanReceivePayout(reservedUserId, db) ? candidates : [];
  const eligible = await filterDriversEligibleForPayout(candidates, (candidate) => candidate.user_id, db);
  if (audit) {
    const approved = new Set(eligible.map((driver) => driver.user_id));
    audit.record({
      event: 'dispatch_candidates_evaluated', orderId, searchCycle: audit.searchCycle, searchUntil: audit.searchUntil, slot, promisedAt,
      radiusMeters: route.radius_meters, maxFeeCents: route.fee_cents + route.subsidy_cents,
      selectedDriverId: eligible[0]?.user_id ?? null,
      drivers: rows.map((row) => ({
        driverId: row.user_id, locationAt: row.location_at, blockedUntil: row.blocked_until,
        pickupMeters: row.pickup_meters === null ? null : Math.round(row.pickup_meters),
        feeCents: row.fee_cents, estimatedMinutes: row.pickup_meters === null ? null : row.pickup_minutes + route.duration_minutes,
        reasons: row.reasons.length || approved.has(row.user_id) ? row.reasons : ['financial_approval_unavailable'],
      })),
    });
  }
  return allRates ? eligible : eligible.slice(0, 10);
}

export async function findDispatchSlots(route: DispatchRoute, db: DispatchDatabase = { query }) {
  const { rows } = await db.query(
    `SELECT DISTINCT date_bin('30 minutes', GREATEST(starts_at, NOW() + INTERVAL '45 minutes'), TIMESTAMPTZ '2000-01-01')
      + step * INTERVAL '30 minutes' AS slot
     FROM driver_dispatch_shift_occurrences(NOW(), NOW() + INTERVAL '7 days'), generate_series(0, 48) step
     WHERE ends_at > NOW() + INTERVAL '45 minutes'
       AND starts_at < NOW() + INTERVAL '7 days'
       AND date_bin('30 minutes', GREATEST(starts_at, NOW() + INTERVAL '45 minutes'), TIMESTAMPTZ '2000-01-01')
         + step * INTERVAL '30 minutes' >= GREATEST(starts_at, NOW() + INTERVAL '45 minutes')
       AND date_bin('30 minutes', GREATEST(starts_at, NOW() + INTERVAL '45 minutes'), TIMESTAMPTZ '2000-01-01')
         + step * INTERVAL '30 minutes' + make_interval(mins => $1::int + 15) <= ends_at
       AND date_bin('30 minutes', GREATEST(starts_at, NOW() + INTERVAL '45 minutes'), TIMESTAMPTZ '2000-01-01')
         + step * INTERVAL '30 minutes' <= NOW() + INTERVAL '7 days'
     ORDER BY slot LIMIT 48`, [route.duration_minutes + Math.ceil(route.radius_meters / 300)]
  );
  const available: Date[] = [];
  for (let index = 0; index < rows.length && available.length < 12; index += 8) {
    const batch = await Promise.all(rows.slice(index, index + 8).map(async ({ slot }) =>
      (await findDispatchCandidates(db, route, slot)).length ? slot : null
    ));
    available.push(...batch.filter((slot): slot is Date => slot !== null));
  }
  return available.slice(0, 12);
}

export async function dispatchTransaction<T>(operation: (client: PoolClient) => Promise<T>) {
  const client = await getClient();
  let failedRollback: Error | undefined;
  try {
    await client.query('BEGIN');
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { failedRollback = new Error('Delivery transaction rollback failed'); }
    throw error;
  } finally { client.release(failedRollback); }
}

export async function tickDispatch() {
  const { unavailable, blockedDrivers, events } = await dispatchTransaction(async (client) => {
    const { rows: [lock] } = await client.query('SELECT pg_try_advisory_xact_lock(19750214) AS acquired');
    if (!lock.acquired) return { unavailable: [], blockedDrivers: [], events: [] };
    const { rows } = await client.query(
      `SELECT j.*, o.order_status, o.payment_status FROM delivery_dispatch j JOIN orders o ON o.id = j.order_id
       WHERE (j.state IN ('scheduled','searching','offered') OR (j.state = 'assigned' AND j.promised_at <= NOW())) AND
         (j.state <> 'scheduled' OR j.slot_at <= NOW() + INTERVAL '30 minutes')
         AND COALESCE(j.next_attempt_at, NOW()) <= NOW()
         AND NOT EXISTS (SELECT 1 FROM delivery_dispatch_offers f WHERE f.order_id = j.order_id
           AND f.state = 'pending' AND f.expires_at > NOW())
       ORDER BY j.promised_at LIMIT 25 FOR UPDATE OF o, j SKIP LOCKED`
    );
    const events: DispatchAuditEvent[] = [];
    const record = (event: DispatchAuditEvent) => events.push({ ...event, occurredAt: new Date().toISOString() });
    const unavailable: string[] = [];
    const blockedDrivers: { userId: string; orderId: string }[] = [];
    for (const job of rows) {
      if (job.payment_status !== 'paid' || job.order_status === 'cancelled') {
        await client.query("UPDATE delivery_dispatch_offers SET state = 'withdrawn' WHERE order_id = $1 AND state = 'pending'", [job.order_id]);
        await client.query("UPDATE delivery_dispatch SET state = 'cancelled' WHERE order_id = $1", [job.order_id]);
        continue;
      }
      if (job.state === 'scheduled') {
        await client.query("UPDATE delivery_dispatch SET state = 'searching' WHERE order_id = $1", [job.order_id]);
      }
      if (job.state === 'assigned') {
        await releaseDispatchAssignment(client, job.order_id, 'choice');
        unavailable.push(job.order_id);
        continue;
      }
      const { rows: [offer] } = await client.query(
        "SELECT *, expires_at <= clock_timestamp() AS expired FROM delivery_dispatch_offers WHERE order_id = $1 AND state = 'pending' FOR UPDATE",
        [job.order_id]
      );
      if (offer && !offer.expired) continue;
      if (offer) {
        const { rows: [presence] } = await client.query(
          `WITH counted AS (
             UPDATE driver_dispatch_presence p SET
               ignored_offers = p.ignored_offers + 1,
               online = p.ignored_offers < 2,
               blocked_until = CASE WHEN p.ignored_offers >= 2
                 THEN clock_timestamp() + make_interval(mins => COALESCE(d.missed_offer_block_minutes, s.missed_offer_block_minutes)) ELSE p.blocked_until END,
               latitude = CASE WHEN p.ignored_offers >= 2 THEN NULL ELSE p.latitude END,
               longitude = CASE WHEN p.ignored_offers >= 2 THEN NULL ELSE p.longitude END,
               location_at = CASE WHEN p.ignored_offers >= 2 THEN NULL ELSE p.location_at END
             FROM delivery_dispatch_settings s
             LEFT JOIN drivers d ON d.user_id = $1 AND d.deleted_at IS NULL
             WHERE s.id = true AND p.user_id = $1 AND p.online
               AND p.checked_in_at <= $3::timestamptz
             RETURNING NOT p.online AS checked_out, p.ignored_offers, p.blocked_until
           )
           UPDATE delivery_dispatch_offers SET state = 'expired',
             missed_at = CASE WHEN EXISTS (SELECT 1 FROM counted) THEN expires_at END
           WHERE id = $2 RETURNING COALESCE((SELECT checked_out FROM counted), false) AS checked_out, missed_at,
             (SELECT ignored_offers FROM counted) AS ignored_offers, (SELECT blocked_until FROM counted) AS blocked_until`,
          [offer.user_id, offer.id, offer.offered_at]
        );
        record({
          event: 'dispatch_offer_expired', orderId: job.order_id, searchCycle: job.search_cycle,
          offerId: offer.id, driverId: offer.user_id, expiresAt: offer.expires_at, notifiedAt: offer.notified_at,
          missedAt: presence?.missed_at, ignoredOffers: presence?.ignored_offers, blockedUntil: presence?.blocked_until,
        });
        if (presence?.checked_out) blockedDrivers.push({ userId: offer.user_id, orderId: job.order_id });
      }
      if (job.search_until.getTime() <= Date.now()) {
        await client.query("UPDATE delivery_dispatch SET state = 'needs_choice', capacity_driver_id = NULL WHERE order_id = $1", [job.order_id]);
        unavailable.push(job.order_id);
        record({ event: 'dispatch_search_expired', orderId: job.order_id,
          searchCycle: job.search_cycle, searchUntil: job.search_until });
        continue;
      }
      const candidates = await findDispatchCandidates(client, job, job.slot_at, job.order_id, job.promised_at, null, false, {
        searchCycle: job.search_cycle, searchUntil: job.search_until, record,
      });
      if (!candidates.length) {
        await client.query("UPDATE delivery_dispatch SET state = 'searching', next_attempt_at = NOW() + INTERVAL '10 seconds' WHERE order_id = $1", [job.order_id]);
        continue;
      }
      const candidate = candidates[0];
      const offerId = randomUUID();
      const { rowCount } = await client.query(
        `INSERT INTO delivery_dispatch_offers (id, order_id, user_id, state, rate_cents, fee_cents, expires_at, search_cycle, offered_at)
         VALUES ($1, $2, $3, 'pending', $4, $5,
           LEAST($6::timestamptz, NOW() + CASE WHEN $7::timestamptz IS NULL THEN INTERVAL '60 seconds' ELSE INTERVAL '5 minutes' END), $8, clock_timestamp())
         ON CONFLICT DO NOTHING`,
        [offerId, job.order_id, candidate.user_id, candidate.rate_cents, candidate.fee_cents, job.search_until, job.slot_at, job.search_cycle]
      );
      if (rowCount) await client.query("UPDATE delivery_dispatch SET state = 'offered' WHERE order_id = $1", [job.order_id]);
      record({ event: rowCount ? 'dispatch_offer_created' : 'dispatch_offer_conflict',
        orderId: job.order_id, searchCycle: job.search_cycle, offerId, driverId: candidate.user_id });
    }
    await client.query("DELETE FROM delivery_quotes WHERE expires_at < NOW() - INTERVAL '1 hour'");
    return { unavailable, blockedDrivers, events };
  });
  for (const event of events) console.info(JSON.stringify(event));
  void recordDispatchAudit(events);
  notifyOrderEvent('delivery_unavailable', unavailable);
  if (blockedDrivers.length) {
    notifyAdminDriverPresence();
    void Promise.all(blockedDrivers.map(({ userId, orderId }) => notifyDriverCheckinBlocked(userId, orderId)));
  }
  const { rows } = await query(
    `SELECT f.id, f.order_id, f.user_id, f.expires_at, f.search_cycle FROM delivery_dispatch_offers f
     JOIN delivery_dispatch_settings s ON s.id = true AND s.offer_delivery_mode = 'push'
     WHERE f.state = 'pending' AND f.notified_at IS NULL AND f.expires_at > NOW() LIMIT 25`
  );
  await Promise.all(rows.map(async (offer) => {
    const sent = await notifyDriverOffer(offer.id, offer.order_id, offer.user_id, offer.expires_at);
    const event = { event: 'dispatch_offer_push', offerId: offer.id, searchCycle: offer.search_cycle,
      orderId: offer.order_id, driverId: offer.user_id, acceptedByProvider: sent };
    console.info(JSON.stringify(event));
    void recordDispatchAudit([event]);
    if (sent) {
      await query('UPDATE delivery_dispatch_offers SET notified_at = NOW() WHERE id = $1', [offer.id]);
    }
  }));
}

export async function respondToDispatchOffer(userId: string, orderId: string, offerId: string, accept: boolean) {
  return dispatchTransaction(async (client) => {
    const { rows: [job] } = await client.query(
      `SELECT j.*, o.delivery_driver_id, o.delivery_address, o.payment_status, o.order_status
       FROM delivery_dispatch j JOIN orders o ON o.id = j.order_id
       WHERE j.order_id = $1 FOR UPDATE OF o, j`, [orderId]
    );
    if (!job) return false;
    const { rows: [offer] } = await client.query(
      `SELECT *, expires_at > clock_timestamp() AS live FROM delivery_dispatch_offers
       WHERE id = $1 AND order_id = $2 AND user_id = $3 FOR UPDATE`, [offerId, orderId, userId]
    );
    if (!offer) return false;
    if (accept && offer.state === 'accepted' && job.delivery_driver_id === userId) return true;
    if (job.state !== 'offered' || job.payment_status !== 'paid' || !['confirmed','processing'].includes(job.order_status)
      || offer.state !== 'pending' || !offer.live) return false;
    if (!accept) {
      await client.query("UPDATE delivery_dispatch_offers SET state = 'declined' WHERE id = $1", [offerId]);
      await client.query("UPDATE delivery_dispatch SET state = 'searching' WHERE order_id = $1", [orderId]);
      await client.query('UPDATE driver_dispatch_presence SET ignored_offers = 0 WHERE user_id = $1', [userId]);
      return true;
    }
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1::text, 1))', [userId]);
    const available = await findDispatchCandidates(client, job, job.slot_at, orderId, job.promised_at, userId);
    if (!available.length) return false;
    const { rows: [driver] } = await client.query(
      `SELECT d.id FROM drivers d JOIN users u ON u.id = d.user_id AND u.status = 'active'
       WHERE d.user_id = $1 AND d.deleted_at IS NULL AND NOT EXISTS (
         SELECT 1 FROM orders o LEFT JOIN delivery_dispatch j ON j.order_id = o.id
         WHERE o.delivery_driver_id = $1 AND o.deleted_at IS NULL AND o.delivery_status IN ('processing','in_transit')
           AND (j.slot_at IS NULL OR j.slot_at <= NOW() OR j.state IN ('in_transit','incident') OR
             j.slot_at < COALESCE($2::timestamptz, NOW()) + make_interval(mins => $3::int + 15)
             AND j.slot_at + make_interval(mins => j.duration_minutes + (j.radius_meters + 299) / 300 + 15) > COALESCE($2, NOW()))
       )`, [userId, job.slot_at, job.duration_minutes + Math.ceil(job.radius_meters / 300)]
    );
    if (!driver) return false;
    await client.query(
      `UPDATE orders SET delivery_driver_id = $2, delivery_status = 'processing', order_status = 'processing',
       delivery_confirmation_code = $3, delivery_confirmation_attempts = 0, delivery_confirmation_retry_at = NULL WHERE id = $1`,
      [orderId, userId, String(randomInt(10000)).padStart(4, '0')]
    );
    await client.query(
      `INSERT INTO deliveries (order_id, driver_id, pickup_location, delivery_location, delivery_fee, status, driver_rate_cents, driver_distance_meters)
       VALUES ($1, $2, $3, $4, $5, 'processing', $6, $7)
       ON CONFLICT (order_id) DO UPDATE SET driver_id = EXCLUDED.driver_id, pickup_location = EXCLUDED.pickup_location,
         delivery_location = EXCLUDED.delivery_location, delivery_fee = EXCLUDED.delivery_fee, status = 'processing',
         driver_rate_cents = EXCLUDED.driver_rate_cents, driver_distance_meters = EXCLUDED.driver_distance_meters,
         deleted_at = NULL, tracking_latitude = NULL, tracking_longitude = NULL, tracking_updated_at = NULL, tracking_route_requested_at = NULL`,
      [orderId, driver.id, job.pickup_address, job.delivery_address, offer.fee_cents / 100, offer.rate_cents, job.distance_meters]
    );
    await client.query("UPDATE delivery_dispatch_offers SET state = 'accepted' WHERE id = $1", [offerId]);
    await client.query("UPDATE delivery_dispatch SET state = 'assigned', capacity_driver_id = NULL WHERE order_id = $1", [orderId]);
    await client.query('UPDATE driver_dispatch_presence SET ignored_offers = 0 WHERE user_id = $1', [userId]);
    return true;
  });
}

export async function releaseDispatchAssignment(client: PoolClient, orderId: string, action: 'retry' | 'choice') {
  await client.query(
    `UPDATE delivery_dispatch SET state = CASE WHEN $2 = 'choice' THEN 'needs_choice' ELSE 'searching' END,
       capacity_driver_id = NULL, next_attempt_at = NULL,
       search_until = LEAST(promised_at, CASE WHEN slot_at IS NULL THEN NOW() + INTERVAL '5 minutes' ELSE slot_at + INTERVAL '15 minutes' END)
     WHERE order_id = $1`, [orderId, action]
  );
  await client.query(
    `UPDATE orders SET order_status = 'confirmed', delivery_status = 'pending', delivery_driver_id = NULL,
       delivery_confirmation_code = NULL, delivery_confirmation_attempts = 0, delivery_confirmation_retry_at = NULL WHERE id = $1`, [orderId]
  );
  await client.query(
    `UPDATE deliveries SET status = 'pending', driver_id = NULL, tracking_latitude = NULL, tracking_longitude = NULL,
       tracking_updated_at = NULL, tracking_route_requested_at = NULL WHERE order_id = $1`, [orderId]
  );
}

export async function recordDispatchEarnings(client: PoolClient, orderId: string) {
  await client.query(
    `INSERT INTO delivery_driver_earnings (order_id, user_id, amount_cents, subsidy_cents)
     SELECT j.order_id, o.delivery_driver_id, offer.fee_cents, GREATEST(0, offer.fee_cents - j.fee_cents)
     FROM delivery_dispatch j JOIN orders o ON o.id = j.order_id
     JOIN delivery_dispatch_offers offer ON offer.order_id = j.order_id
       AND offer.user_id = o.delivery_driver_id AND offer.search_cycle = j.search_cycle AND offer.state = 'accepted'
     WHERE j.order_id = $1 AND j.state = 'delivered'
     ON CONFLICT (order_id) DO NOTHING`, [orderId]
  );
}
