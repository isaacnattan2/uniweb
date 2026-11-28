import { setTimeout as delay } from 'node:timers/promises';
import { DeliveryProviderHttpError, validCoordinate, type RoutePoint } from './DeliveryRouting';

type GeocodedAddress = RoutePoint & { label: string };

interface Geocoder {
  name: string;
  search(address: string, signal: AbortSignal): Promise<RoutePoint | null>;
  autocomplete?(term: string, signal: AbortSignal): Promise<GeocodedAddress[]>;
  reverse?(point: RoutePoint, signal: AbortSignal): Promise<string | null>;
}

interface AddressResult {
  lat?: unknown;
  lon?: unknown;
  formatted?: string;
  display_name?: string;
}

export const geocodingIntervalMs = 1100;
let geocodingQueue: Promise<void> = Promise.resolve();
let nextGeocodingStart = 0;

export function runGeocoding<T>(operation: () => Promise<T>, signal: AbortSignal, parallel: boolean): Promise<T> {
  if (parallel) return operation();
  const lookup = geocodingQueue.then(async () => {
    signal.throwIfAborted();
    const wait = Math.ceil(nextGeocodingStart - performance.now());
    if (wait > 0) await delay(wait, undefined, { signal });
    signal.throwIfAborted();
    nextGeocodingStart = performance.now() + geocodingIntervalMs;
    return operation();
  });
  geocodingQueue = lookup.then(() => {}, () => {});
  return lookup;
}

export async function locateDeliveryAddresses(geocoder: Geocoder, addresses: string[], signal: AbortSignal, parallel: boolean) {
  const lookup = (address: string) => geocoder.search(normalizeAddress(address), signal);
  if (parallel) return Promise.all(addresses.map(lookup));
  const points: (RoutePoint | null)[] = [];
  for (const address of addresses) points.push(await runGeocoding(() => lookup(address), signal, false));
  return points;
}

function normalizeAddress(address: string) {
  const parts = address.split(' · ');
  const postcode = /^CEP (\d{5}-\d{3})$/iu.exec(parts.at(-1) ?? '');
  const cityAndState = /^(.+)\/([A-Z]{2})$/u.exec(parts.at(-2) ?? '');
  return postcode && cityAndState && parts.length >= 3
    ? [parts[0].replace(/, ([^,]+)$/u, ' $1'), cityAndState[1], cityAndState[2], postcode[1]].join(', ')
    : parts.join(', ');
}

async function request<T>(url: URL, signal: AbortSignal, allowNotFound = false): Promise<T | null> {
  const response = await fetch(url, { signal, redirect: 'error', headers: { 'User-Agent': 'Uniweb/1.0' } });
  if (allowNotFound && response.status === 404) return null;
  if (!response.ok) throw new DeliveryProviderHttpError(response.status);
  return await response.json() as T;
}

function coordinate(value: unknown) {
  return typeof value === 'string' && value.trim() ? Number(value) : value;
}

function point(result?: AddressResult): RoutePoint | null {
  const lat = coordinate(result?.lat);
  const lon = coordinate(result?.lon);
  return validCoordinate(lat, 90) && validCoordinate(lon, 180) ? { lat, lon } : null;
}

function suggestions(results: AddressResult[], labelKey: 'formatted' | 'display_name'): GeocodedAddress[] {
  return results.flatMap((result) => {
    const position = point(result);
    const label = result?.[labelKey];
    return position && typeof label === 'string' ? [{ ...position, label }] : [];
  });
}

function geoapify(apiKey: string): Geocoder {
  async function lookup(endpoint: string, params: Record<string, string>, signal: AbortSignal) {
    const url = new URL('https://api.geoapify.com/v1/geocode/' + endpoint);
    url.search = new URLSearchParams({ ...params, apiKey, lang: 'pt', format: 'json' }).toString();
    return (await request<{ results: AddressResult[] }>(url, signal, true))?.results ?? [];
  }
  const filter = 'countrycode:br';
  return {
    name: 'geoapify',
    async search(address, signal) {
      const [result] = await lookup('search', { text: address, filter, limit: '1' }, signal);
      return point(result);
    },
    async autocomplete(text, signal) {
      const results = await lookup('autocomplete', { text, filter, limit: '5' }, signal);
      return suggestions(results, 'formatted');
    },
    async reverse({ lat, lon }, signal) {
      const [result] = await lookup('reverse', { lat: String(lat), lon: String(lon), limit: '1' }, signal);
      return result?.formatted ?? null;
    },
  };
}

function osmSearch(endpoint: string, format: string, key?: string): Geocoder['search'] {
  return async (address, signal) => {
    const url = new URL(endpoint);
    if (!url.searchParams.has('format')) url.searchParams.set('format', format);
    if (key) url.searchParams.set('key', key);
    url.searchParams.set('q', address);
    url.searchParams.set('countrycodes', 'br');
    url.searchParams.set('limit', '1');
    const results = await request<AddressResult[]>(url, signal);
    return point(results?.[0]);
  };
}

function locationIq(key: string): Geocoder {
  return {
    name: 'locationiq',
    search: osmSearch('https://us1.locationiq.com/v1/search', 'json', key),
    async autocomplete(q, signal) {
      const url = new URL('https://api.locationiq.com/v1/autocomplete');
      url.search = new URLSearchParams({ key, q, countrycodes: 'br', limit: '5' }).toString();
      return suggestions(await request<AddressResult[]>(url, signal, true) ?? [], 'display_name');
    },
    async reverse({ lat, lon }, signal) {
      const url = new URL('https://us1.locationiq.com/v1/reverse');
      url.search = new URLSearchParams({ key, lat: String(lat), lon: String(lon), format: 'json' }).toString();
      return (await request<AddressResult>(url, signal, true))?.display_name ?? null;
    },
  };
}

export function getGeocoder(flow: 'ride' | 'delivery'): Geocoder | undefined {
  const geoapifyKey = process.env.GEOAPIFY_API_KEY?.trim();
  const locationIqKey = process.env.UNICORRIDA_LOCATIONIQ_TOKEN?.trim();
  const nominatimUrl = process.env.NOMINATIM_SEARCH_URL?.trim();
  const provider = process.env.GEOCODING_PROVIDER?.trim().toLowerCase()
    || (geoapifyKey ? 'geoapify' : 'legacy');
  const nominatim = () => nominatimUrl ? { name: 'nominatim', search: osmSearch(nominatimUrl, 'jsonv2') } : undefined;
  switch (provider) {
    case 'geoapify': return geoapifyKey ? geoapify(geoapifyKey) : undefined;
    case 'locationiq': return locationIqKey ? locationIq(locationIqKey) : undefined;
    case 'nominatim': return nominatim();
    case 'legacy': return flow === 'ride' && locationIqKey ? locationIq(locationIqKey) : nominatim();
    default: return undefined;
  }
}
