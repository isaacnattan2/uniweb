import { createHash, randomUUID } from 'node:crypto';
import type { Response } from 'express';
import jwt from 'jsonwebtoken';
import { query } from '../config/database';
import type { AuthRequest } from '../middleware/auth';
import { checkoutUrl, createAsaasCheckout, getAsaasConfig } from '../services/AsaasCheckout';
import { AsaasCardError, cardRemoteIp, readCardForCheckout } from '../services/AsaasSavedCards';
import { submitDirectCardPayment } from '../services/AsaasCardPayments';
import { lockCart } from '../services/CustomerCart';
import { dispatchTransaction, dispatchUuid, findDispatchCandidates } from '../services/DeliveryDispatch';
import { geocodingIntervalMs, locateDeliveryAddresses, passengerGeocoderUrl, queueGeocoding, routeDeliveryStops, validCoordinate, type RoutePoint } from '../services/DeliveryRouting';

class RideError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

function address(value: unknown) {
  return typeof value === 'string' && value.trim().length >= 8 && value.trim().length <= 300 ? value.trim() : null;
}

type RideAddress = RoutePoint & { label: string };

function selectedAddress(value: unknown, userId: string): RideAddress | null {
  if (typeof value !== 'string' || !process.env.JWT_SECRET || value.length > 2000) return null;
  try {
    const data = jwt.verify(value, process.env.JWT_SECRET, { algorithms: ['HS256'], audience: 'unicorrida-address', subject: userId });
    if (typeof data !== 'string' && address(data.label) && validCoordinate(data.lat, 90) && validCoordinate(data.lon, 180)) {
      return { label: data.label, lat: data.lat, lon: data.lon };
    }
  } catch { /* The client can select the address again. */ }
  return null;
}

export async function autocompletePassengerAddress(req: AuthRequest, res: Response) {
  res.set('Cache-Control', 'no-store');
  if (req.userType !== 'customer' || !req.userId) return res.sendStatus(403);
  const userId = req.userId;
  const term = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (term.length < 5 || term.length > 200) return res.json([]);
  const secret = process.env.JWT_SECRET;
  let key: string | null = null;
  try {
    const configured = new URL(passengerGeocoderUrl() ?? '');
    if (configured.hostname.endsWith('.locationiq.com')) key = configured.searchParams.get('key');
  } catch { /* A LocationIQ configuration is required for suggestions. */ }
  if (!secret || !key) return res.status(503).json({ error: 'Sugestões indisponíveis. Você pode digitar o endereço completo.' });
  const target = new URL('https://api.locationiq.com/v1/autocomplete');
  target.search = new URLSearchParams({ key, q: term, countrycodes: 'br', limit: '5' }).toString();
  const signal = AbortSignal.timeout(8000);
  try {
    const { rows: [settings] } = await query('SELECT parallel_geocoding FROM delivery_dispatch_settings WHERE id = true');
    const lookup = async () => {
      const response = await fetch(target, { signal, redirect: 'error' });
      if (response.status === 404) return [];
      if (!response.ok) {
        console.warn('[ride-autocomplete] LocationIQ indisponível', { status: response.status });
        throw new Error('LocationIQ autocomplete unavailable');
      }
      return await response.json() as { display_name?: string; lat?: string; lon?: string }[];
    };
    const entries = settings?.parallel_geocoding ? await lookup() : await queueGeocoding(lookup, signal);
    const suggestions = entries.flatMap((entry) => {
      const label = address(entry.display_name);
      const lat = Number(entry.lat);
      const lon = Number(entry.lon);
      if (!label || !validCoordinate(lat, 90) || !validCoordinate(lon, 180)) return [];
      return [{ label, token: jwt.sign({ label, lat, lon }, secret, {
        audience: 'unicorrida-address', subject: userId, algorithm: 'HS256', expiresIn: '20m',
      }) }];
    });
    return res.json(suggestions);
  } catch {
    return res.status(503).json({ error: 'Sugestões indisponíveis. Você pode digitar o endereço completo.' });
  }
}

export async function reversePassengerAddress(req: AuthRequest, res: Response) {
  res.set('Cache-Control', 'no-store');
  if (req.userType !== 'customer' || !req.userId) return res.sendStatus(403);
  const { latitude, longitude } = req.body ?? {};
  if (!validCoordinate(latitude, 90) || !validCoordinate(longitude, 180)) return res.sendStatus(400);
  try {
    const configured = new URL(passengerGeocoderUrl() ?? '');
    const key = configured.hostname.endsWith('.locationiq.com') && configured.searchParams.get('key');
    if (!key) return res.sendStatus(503);
    const target = new URL('/v1/reverse', configured.origin);
    target.search = new URLSearchParams({ key, lat: String(latitude), lon: String(longitude), format: 'json' }).toString();
    const signal = AbortSignal.timeout(6000);
    const { rows: [settings] } = await query('SELECT parallel_geocoding FROM delivery_dispatch_settings WHERE id = true');
    const lookup = async () => {
      const response = await fetch(target, { signal, redirect: 'error' });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error('LocationIQ reverse geocoding unavailable');
      return address((await response.json() as { display_name?: string }).display_name);
    };
    const label = settings?.parallel_geocoding ? await lookup() : await queueGeocoding(lookup, signal);
    return res.json({ label });
  } catch {
    return res.sendStatus(503);
  }
}

export async function quotePassengerRide(req: AuthRequest, res: Response) {
  res.set('Cache-Control', 'no-store');
  if (req.userType !== 'customer' || !req.userId) return res.sendStatus(403);
  const destinationChoice = selectedAddress(req.body?.destinationToken, req.userId);
  const originChoice = selectedAddress(req.body?.originToken, req.userId);
  const target = destinationChoice?.label ?? address(req.body?.destination);
  const origin = originChoice?.label ?? address(req.body?.origin);
  const point = req.body?.location;
  const gps: RoutePoint | null = validCoordinate(point?.latitude, 90) && validCoordinate(point?.longitude, 180)
    ? { lat: point.latitude, lon: point.longitude } : null;
  if (!target || (!origin && !gps)) return res.status(400).json({ error: 'Informe o embarque e o destino completos.' });
  const geocoder = passengerGeocoderUrl();
  const router = process.env.VALHALLA_ROUTE_URL?.trim();
  if (!geocoder || !router || !getAsaasConfig()) {
    return res.status(503).json({ error: 'O serviço de corridas ainda não está configurado.' });
  }
  const { rows: [settings] } = await query(
    `SELECT p.default_cents, s.radius_meters, s.subsidy_cents, s.parallel_geocoding
     FROM delivery_dispatch_settings s CROSS JOIN driver_delivery_rate_policy p WHERE s.id = true AND p.id = true`);
  if (!settings) return res.status(503).json({ error: 'O serviço de corridas ainda não está disponível.' });

  let coordinates;
  try {
    const addresses = [...(destinationChoice ? [] : [target]), ...(origin && !originChoice ? [origin] : [])];
    coordinates = await locateDeliveryAddresses(geocoder, addresses,
      AbortSignal.timeout(8000 + geocodingIntervalMs), settings.parallel_geocoding === true);
  } catch {
    return res.status(503).json({ error: 'Não foi possível localizar os endereços agora.' });
  }
  const dropoff = destinationChoice ?? coordinates.shift();
  const pickup = originChoice ?? (origin ? coordinates.shift() : gps);
  if (!pickup || !dropoff) return res.status(422).json({ error: 'Confira o número, bairro, cidade e CEP dos endereços.' });
  const trip = await routeDeliveryStops(router, [pickup, dropoff], AbortSignal.timeout(8000), 'auto').catch(() => null);
  if (!trip || !Number.isFinite(trip.distance) || trip.distance <= 0 || trip.distance > 1000000 ||
      !Number.isFinite(trip.duration) || trip.duration <= 0) {
    return res.status(422).json({ error: 'Não foi possível traçar uma rota entre os pontos informados.' });
  }
  const route = {
    passenger_ride: true, pickup_latitude: pickup.lat, pickup_longitude: pickup.lon, distance_meters: Math.round(trip.distance),
    duration_minutes: Math.ceil(trip.duration / 60), rate_cents: settings.default_cents,
    fee_cents: 0, subsidy_cents: settings.subsidy_cents, radius_meters: settings.radius_meters,
  };
  const candidates = await findDispatchCandidates({ query }, route, null, null, null, null, true);
  const candidate = candidates.filter((entry) => entry.fee_cents > 0)
    .sort((a, b) => a.fee_cents - b.fee_cents || a.pickup_minutes - b.pickup_minutes)[0];
  const points = (trip.geometry?.coordinates ?? []).flatMap(([longitude, latitude]) =>
    validCoordinate(latitude, 90) && validCoordinate(longitude, 180) ? [{ latitude, longitude }] : []);
  const preview = {
    origin: { latitude: pickup.lat, longitude: pickup.lon }, destination: { latitude: dropoff.lat, longitude: dropoff.lon },
    points, distanceMeters: route.distance_meters, estimatedMinutes: route.duration_minutes,
  };
  if (!candidate) return res.json({ ...preview, quoteId: null, fareCents: null, unavailable: 'Nenhum motorista disponível para esse embarque agora.' });
  const quoteId = randomUUID();
  const pickupAddress = origin ?? `${pickup.lat.toFixed(6)}, ${pickup.lon.toFixed(6)}`;
  const estimatedMinutes = candidate.pickup_minutes + route.duration_minutes + 10;
  await query(
    `INSERT INTO delivery_quotes (id, user_id, destination, pickup_address, pickup_latitude, pickup_longitude,
       distance_meters, duration_minutes, rate_cents, fee_cents, subsidy_cents, radius_meters, immediate_minutes, expires_at, passenger_ride)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW() + INTERVAL '5 minutes',true)`,
    [quoteId, req.userId, target, pickupAddress, pickup.lat, pickup.lon, route.distance_meters,
      route.duration_minutes, route.rate_cents, candidate.fee_cents, route.subsidy_cents, route.radius_meters, estimatedMinutes]);
  return res.json({ ...preview, quoteId, fareCents: candidate.fee_cents, estimatedMinutes });
}

export async function createPassengerRide(req: AuthRequest, res: Response) {
  res.set('Cache-Control', 'no-store');
  if (req.userType !== 'customer' || !req.userId) return res.sendStatus(403);
  const userId = req.userId;
  const { quoteId, checkoutId, method, savedCardId } = req.body ?? {};
  if (![quoteId, checkoutId].every((id) => typeof id === 'string' && dispatchUuid.test(id)) ||
      !['pix', 'credit_card'].includes(method) ||
      (method === 'credit_card' && (typeof savedCardId !== 'string' || !dispatchUuid.test(savedCardId)))) {
    return res.status(400).json({ error: 'Confirme a cotação e selecione Pix ou um cartão salvo.' });
  }
  const config = getAsaasConfig();
  if (!config) return res.status(503).json({ error: 'Pagamento indisponível.' });
  const requestHash = createHash('sha256').update(JSON.stringify(['ride', quoteId, method, savedCardId])).digest('hex');
  try {
    const ip = method === 'credit_card' ? cardRemoteIp(req.ip) : '';
    const attempt = await dispatchTransaction(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))', [checkoutId]);
      const { rows: [existing] } = await client.query(
        `SELECT c.user_id, c.request_hash, c.provider_id, c.payment_flow, o.id, o.payment_status, o.passenger_ride
         FROM asaas_checkouts c JOIN orders o ON o.asaas_checkout_id = c.id WHERE c.id = $1`, [checkoutId]);
      if (existing) {
        if (!existing.passenger_ride || existing.user_id !== userId || existing.request_hash !== requestHash) {
          throw new RideError(409, 'O identificador do pagamento já está em uso.');
        }
        return { orderId: existing.id, paymentStatus: existing.payment_status,
          checkoutUrl: existing.payment_status === 'pending' && existing.payment_flow === 'hosted' ? checkoutUrl(existing.provider_id) : null };
      }
      await lockCart(client, userId);
      const { rowCount } = await client.query(
        `SELECT 1 FROM orders WHERE user_id = $1 AND deleted_at IS NULL AND
         (passenger_ride AND order_status IN ('pending','confirmed','processing') OR
          payment_status = 'pending' AND asaas_checkout_id IN (SELECT id FROM asaas_checkouts WHERE payment_flow = 'saved_card')) LIMIT 1`, [userId]);
      if (rowCount) throw new RideError(409, 'Você tem uma corrida ou um pagamento em andamento. Confira o histórico.');
      const { rows: [quote] } = await client.query(
        'SELECT * FROM delivery_quotes WHERE id = $1 AND user_id = $2 AND passenger_ride AND expires_at > NOW() FOR UPDATE',
        [quoteId, userId]);
      if (!quote) throw new RideError(409, 'A cotação expirou. Calcule novamente o valor da corrida.');
      const promised = new Date(Date.now() + quote.immediate_minutes * 60000);
      if (!(await findDispatchCandidates(client, quote, null, null, promised)).length) {
        throw new RideError(409, 'Nenhum motorista está disponível para esta cotação. Calcule novamente.');
      }
      const fare = quote.fee_cents / 100;
      const card = method === 'credit_card' ? await readCardForCheckout(client, userId, savedCardId) : null;
      const providerId = card ? 'card:' + checkoutId : await createAsaasCheckout(config, checkoutId, 'pix',
        [{ name: 'Corrida UniCorrida', value: fare, quantity: 1 }], 1);
      const orderId = randomUUID();
      await client.query(
        `INSERT INTO asaas_checkouts (id, user_id, request_hash, provider_id, payment_flow, installment_count)
         VALUES ($1,$2,$3,$4,$5,$6)`, [checkoutId, userId, requestHash, providerId, card ? 'saved_card' : 'hosted', card ? 1 : null]);
      await client.query(
        `INSERT INTO orders (id, user_id, order_number, subtotal, total, delivery_fee, payment_method, delivery_type,
          delivery_address, asaas_checkout_id, passenger_ride, asaas_split_snapshot)
         VALUES ($1::uuid,$2,$1::uuid::text,0,$3,$3,$4,'delivery',$5,$6,true,$7::jsonb)`,
        [orderId, userId, fare, method, quote.destination, checkoutId, JSON.stringify({
          gross: quote.fee_cents, fee: 0, net: quote.fee_cents, storeEstimate: 0, split: {},
          maxDriver: quote.fee_cents + quote.subsidy_cents, condition: { maxInstallments: 1, mode: 'fixed', version: 'unicorrida' },
        })]);
      await client.query(
        `INSERT INTO delivery_dispatch (order_id,state,promised_at,pickup_address,pickup_latitude,pickup_longitude,
          distance_meters,duration_minutes,rate_cents,fee_cents,subsidy_cents,radius_meters)
         VALUES ($1,'payment_pending',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [orderId, promised, quote.pickup_address, quote.pickup_latitude, quote.pickup_longitude, quote.distance_meters,
          quote.duration_minutes, quote.rate_cents, quote.fee_cents, quote.subsidy_cents, quote.radius_meters]);
      await client.query('DELETE FROM delivery_quotes WHERE id = $1', [quoteId]);
      return { orderId, paymentStatus: 'pending', checkoutUrl: card ? null : checkoutUrl(providerId), card, fare };
    });
    const { card, fare, ...result } = attempt;
    if (card) result.paymentStatus = await submitDirectCardPayment(config, checkoutId, card, fare, 1, ip, []).catch(() => 'pending');
    return res.status(201).json(result);
  } catch (error) {
    if (error instanceof RideError || error instanceof AsaasCardError) return res.status(error.status).json({ error: error.message });
    return res.status(502).json({ error: 'Não foi possível iniciar o pagamento da corrida.' });
  }
}

export async function listPassengerRides(req: AuthRequest, res: Response) {
  res.set('Cache-Control', 'no-store');
  if (req.userType !== 'customer' || !req.userId) return res.sendStatus(403);
  const { rows } = await query(
    `SELECT o.id, o.created_at AS "createdAt", o.order_status AS status, o.payment_status AS "paymentStatus",
       o.payment_method AS "paymentMethod", o.delivery_address AS destination, j.pickup_address AS origin, j.state AS "dispatchState",
       (o.total * 100)::int AS "fareCents", driver.full_name AS "driverName", c.provider_id,
       CASE WHEN j.state = 'in_transit' AND o.payment_status = 'paid' THEN o.delivery_confirmation_code END AS "confirmationCode"
     FROM orders o JOIN delivery_dispatch j ON j.order_id = o.id
     LEFT JOIN asaas_checkouts c ON c.id = o.asaas_checkout_id AND c.payment_flow = 'hosted'
     LEFT JOIN users driver ON driver.id = o.delivery_driver_id
     WHERE o.user_id = $1 AND o.passenger_ride AND o.deleted_at IS NULL ORDER BY o.created_at DESC LIMIT 50`, [req.userId]);
  return res.json(rows.map(({ provider_id, ...row }) => ({
    ...row, checkoutUrl: provider_id && row.paymentStatus === 'pending' ? checkoutUrl(provider_id) : null,
  })));
}
