import { query } from '../config/database';

export type DispatchAuditEvent = {
  event: string;
  orderId: string | null;
  searchCycle?: number;
  driverId?: string;
  occurredAt?: string;
  drivers?: { driverId: string }[];
  [field: string]: unknown;
};

export async function recordDispatchAudit(events: DispatchAuditEvent[]) {
  const entries = events.filter((entry) => entry.orderId).map((entry) => ({
    order_id: entry.orderId,
    search_cycle: entry.searchCycle ?? null,
    driver_ids: entry.driverId ? [entry.driverId] : entry.drivers?.map(({ driverId }) => driverId) ?? [],
    details: entry,
    created_at: entry.occurredAt ?? new Date().toISOString(),
  }));
  if (!entries.length) return;
  try {
    await query(
      `INSERT INTO delivery_dispatch_audit (order_id, search_cycle, driver_ids, details, created_at)
       SELECT order_id, search_cycle, driver_ids, details, created_at FROM jsonb_to_recordset($1::jsonb)
       AS entry(order_id uuid, search_cycle integer, driver_ids uuid[], details jsonb, created_at timestamptz)`,
      [JSON.stringify(entries)],
    );
  } catch (error) {
    console.warn('Could not persist dispatch audit events', error instanceof Error ? error.message : 'Unknown error');
  }
}
