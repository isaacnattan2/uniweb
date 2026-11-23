import { query } from '../config/database';

export interface DeliveryRatePolicy {
  minimumCents: number | null;
  maximumCents: number | null;
  defaultCents: number;
  allowCustom: boolean;
}

export function validRate(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 1000000;
}

const policyColumns = `minimum_cents AS "minimumCents", maximum_cents AS "maximumCents",
  default_cents AS "defaultCents", allow_custom AS "allowCustom"`;

export async function getDeliveryRatePolicy(): Promise<DeliveryRatePolicy | null> {
  const { rows } = await query(`SELECT ${policyColumns} FROM driver_delivery_rate_policy WHERE id = true`);
  return rows[0] ?? null;
}

export async function saveDeliveryRatePolicy(policy: DeliveryRatePolicy): Promise<DeliveryRatePolicy> {
  const { rows } = await query(
    `INSERT INTO driver_delivery_rate_policy (id, minimum_cents, maximum_cents, default_cents, allow_custom)
     VALUES (true, $1, $2, $3, $4)
     ON CONFLICT (id) DO UPDATE SET minimum_cents = EXCLUDED.minimum_cents,
       maximum_cents = EXCLUDED.maximum_cents, default_cents = EXCLUDED.default_cents, allow_custom = EXCLUDED.allow_custom
     RETURNING ${policyColumns}`,
    [policy.minimumCents, policy.maximumCents, policy.defaultCents, policy.allowCustom]
  );
  return rows[0];
}

export async function getDriverDeliveryRate(userId: string) {
  const { rows: [row] } = await query(
    `SELECT ${policyColumns}, d.delivery_rate_cents AS "customCents",
            COALESCE(d.delivery_rate_locked, false) AS locked, d.id IS NOT NULL AS "hasProfile"
     FROM (SELECT $1::uuid AS user_id) u
     LEFT JOIN drivers d ON d.user_id = u.user_id AND d.deleted_at IS NULL
     LEFT JOIN driver_delivery_rate_policy p ON p.id = true`,
    [userId]
  );
  const { customCents, locked, hasProfile, ...values } = row;
  const policy: DeliveryRatePolicy | null = values.defaultCents == null ? null : values;
  const canEdit = hasProfile === true && policy?.allowCustom === true && !locked;
  const effectiveCents = policy
    ? canEdit && customCents != null &&
      (policy.minimumCents === null || customCents >= policy.minimumCents) &&
      (policy.maximumCents === null || customCents <= policy.maximumCents)
      ? customCents : policy.defaultCents
    : null;
  return { policy, customCents: customCents as number | null, locked: locked as boolean, canEdit, effectiveCents: effectiveCents as number | null };
}

export function calculateDeliveryFee(rateCents: number, distanceMeters: number) {
  return Math.round(rateCents * distanceMeters / 1000) / 100;
}
