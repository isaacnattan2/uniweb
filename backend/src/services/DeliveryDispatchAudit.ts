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

export async function recordDispatchDebug(events: DispatchAuditEvent[]) {
  if (!events.length) return;
  try {
    await query(
      `WITH inserted AS (
         INSERT INTO delivery_dispatch_debug_events (created_at, details)
         SELECT entry.created_at, entry.details
         FROM jsonb_to_recordset($1::jsonb) AS entry(created_at timestamptz, details jsonb)
         JOIN delivery_dispatch_settings s ON s.id = true AND entry.created_at >= s.debug_started_at
       )
       DELETE FROM delivery_dispatch_debug_events
       WHERE id IN (SELECT id FROM delivery_dispatch_debug_events ORDER BY id DESC OFFSET 100)`,
      [JSON.stringify(events.map((details) => ({ created_at: details.occurredAt, details })))],
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
