export function validCoordinate(value: unknown, limit: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= limit;
}

export interface RoutePoint { lat: number; lon: number }

export class DeliveryProviderHttpError extends Error {
  constructor(readonly status: number) {
    super(`Delivery provider returned HTTP ${status}`);
  }
}

export async function routeDelivery(routeUrl: string, pickup: RoutePoint, destination: RoutePoint, signal: AbortSignal) {
  return routeDeliveryStops(routeUrl, [pickup, destination], signal);
}

export async function routeDeliveryStops(routeUrl: string, locations: RoutePoint[], signal: AbortSignal, costing: 'motorcycle' | 'auto' = 'motorcycle') {
  const response = await fetch(routeUrl, {
    method: 'POST',
    redirect: 'error',
    signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      locations: locations.map((point) => ({ ...point, type: 'break' })),
      costing,
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
