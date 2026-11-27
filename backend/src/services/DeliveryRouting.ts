import { setTimeout as delay } from 'node:timers/promises';

export const geocodingIntervalMs = 1100;
let geocodingQueue: Promise<void> = Promise.resolve();
let nextGeocodingStart = 0;

export function validCoordinate(value: unknown, limit: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= limit;
}

export interface RoutePoint { lat: number; lon: number }

export class DeliveryProviderHttpError extends Error {
  constructor(readonly status: number) {
    super(`Delivery provider returned HTTP ${status}`);
  }
}

export async function locateDeliveryAddresses(geocoderUrl: string, addresses: string[], signal: AbortSignal, parallel: boolean) {
  if (parallel) return Promise.all(addresses.map((address) => fetchDeliveryAddress(geocoderUrl, address, signal)));
  const points: (RoutePoint | null)[] = [];
  for (const address of addresses) points.push(await locateDeliveryAddress(geocoderUrl, address, signal));
  return points;
}

function locateDeliveryAddress(geocoderUrl: string, address: string, signal: AbortSignal): Promise<RoutePoint | null> {
  const lookup = geocodingQueue.then(async () => {
    signal.throwIfAborted();
    const wait = Math.ceil(nextGeocodingStart - performance.now());
    if (wait > 0) await delay(wait, undefined, { signal });
    signal.throwIfAborted();
    nextGeocodingStart = performance.now() + geocodingIntervalMs;
    return fetchDeliveryAddress(geocoderUrl, address, signal);
  });
  geocodingQueue = lookup.then(() => {}, () => {});
  return lookup;
}

async function fetchDeliveryAddress(geocoderUrl: string, address: string, signal: AbortSignal): Promise<RoutePoint | null> {
  const parts = address.split(' · ');
  const postcode = /^CEP (\d{5}-\d{3})$/iu.exec(parts.at(-1) ?? '');
  const cityAndState = /^(.+)\/([A-Z]{2})$/u.exec(parts.at(-2) ?? '');
  const searchAddress = postcode && cityAndState && parts.length >= 3
    ? [parts[0].replace(/, ([^,]+)$/u, ' $1'), cityAndState[1], cityAndState[2], postcode[1]].join(', ')
    : parts.join(', ');
  const search = new URL(geocoderUrl);
  search.searchParams.set('q', searchAddress);
  if (!search.searchParams.has('format')) search.searchParams.set('format', 'jsonv2');
  search.searchParams.set('countrycodes', 'br');
  search.searchParams.set('limit', '1');
  const response = await fetch(search, { signal, redirect: 'error', headers: { 'User-Agent': 'Uniweb/1.0' } });
  if (!response.ok) throw new DeliveryProviderHttpError(response.status);
  const [location] = await response.json() as Array<{ lat: string; lon: string }>;
  const lat = Number(location?.lat);
  const lon = Number(location?.lon);
  return validCoordinate(lat, 90) && validCoordinate(lon, 180) ? { lat, lon } : null;
}

export async function routeDelivery(routeUrl: string, pickup: RoutePoint, destination: RoutePoint, signal: AbortSignal) {
  return routeDeliveryStops(routeUrl, [pickup, destination], signal);
}

export async function routeDeliveryStops(routeUrl: string, locations: RoutePoint[], signal: AbortSignal) {
  const response = await fetch(routeUrl, {
    method: 'POST',
    redirect: 'error',
    signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      locations: locations.map((point) => ({ ...point, type: 'break' })),
      costing: 'motorcycle',
      format: 'osrm',
      shape_format: 'geojson',
    }),
  });
  const result = await response.json().catch((error: unknown) => {
    if (!response.ok && !signal.aborted) throw new DeliveryProviderHttpError(response.status);
    throw error;
  }) as {
    error_code?: number;
    routes?: Array<{ distance: number; duration: number; geometry: { coordinates: number[][] } }>;
  };
  if (!response.ok && ![170, 171, 442].includes(result?.error_code ?? 0)) throw new DeliveryProviderHttpError(response.status);
  return result.routes?.[0];
}
