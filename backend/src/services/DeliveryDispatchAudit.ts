import { query } from '../config/database';

export type DispatchAuditEvent = {
  event: string;
  orderId: string | null;
  searchCycle?: number;
  driverId?: string;
  occurredAt?: string;
  requestType?: 'delivery' | 'ride';
  drivers?: { driverId: string }[];
  [field: string]: unknown;
};

export async function recordDispatchDebug(events: DispatchAuditEvent[]) {
  if (!events.length) return;
  try {
    await query(
      `WITH inserted AS (
         INSERT INTO delivery_dispatch_debug_events (created_at, details, request_type)
         SELECT created_at, details, request_type FROM (
           SELECT entry.*, row_number() OVER (PARTITION BY request_type ORDER BY entry.created_at DESC) AS position
           FROM jsonb_to_recordset($1::jsonb) AS entry(created_at timestamptz, details jsonb, request_type text)
           JOIN delivery_dispatch_settings s ON s.id = true AND entry.created_at >=
             CASE entry.request_type WHEN 'ride' THEN s.ride_debug_started_at ELSE s.debug_started_at END
         ) recent WHERE position <= 100
         ORDER BY created_at
         RETURNING request_type
       ), batch AS (
         SELECT request_type, count(*) AS count FROM inserted GROUP BY request_type
       ), previous AS (
         SELECT e.id, row_number() OVER (PARTITION BY e.request_type ORDER BY e.id DESC) AS position, batch.count
         FROM delivery_dispatch_debug_events e JOIN batch USING (request_type)
       )
       DELETE FROM delivery_dispatch_debug_events
       WHERE id IN (SELECT id FROM previous WHERE position > 100 - count)`,
      [JSON.stringify(events.map((details) => ({
        created_at: details.occurredAt, details, request_type: details.requestType ?? 'delivery',
      })))],
    );
  } catch (error) {
    console.warn('Could not record dispatch debug events', error instanceof Error ? error.message : 'Unknown error');
  }
}

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
       AS entry(order_id uuid, search_cycle integer, driver_ids uuid[], details jsonb, created_at timestamptz)
       WHERE EXISTS (SELECT 1 FROM delivery_dispatch_settings WHERE id = true AND audit_enabled)`,
      [JSON.stringify(entries)],
    );
  } catch (error) {
    console.warn('Could not persist dispatch audit events', error instanceof Error ? error.message : 'Unknown error');
  }
}
