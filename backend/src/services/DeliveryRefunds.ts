import { query } from '../config/database';
import { asaasPaymentIdPattern, getAsaasConfig } from './AsaasCheckout';
import { dispatchUuid } from './DeliveryDispatch';
import { wakeWork } from './WorkEvents';

interface AsaasPayment {
  id: string;
  checkoutSession?: string;
  externalReference?: string;
  status: string;
  value: number;
  installment?: string | null;
  refunds?: Array<{ status: string; value: number }>;
}

const pendingRefund = `(
  (o.payment_status = 'paid' AND (j.refund_state IN ('pending','processing')
    OR (j.refund_state = 'review' AND j.refund_checked_at IS NULL)))
  OR (j.state = 'cancelled' AND o.payment_status = 'pending' AND o.created_at > NOW() - INTERVAL '35 minutes')
) AND NOT EXISTS (SELECT 1 FROM orders other WHERE other.asaas_checkout_id = c.id AND other.id <> o.id)`;

const refundDueAt = `COALESCE(j.refund_checked_at + CASE WHEN j.refund_state = 'processing'
  THEN INTERVAL '15 minutes' ELSE INTERVAL '1 minute' END, NOW())`;

export async function nextRefundCheck(): Promise<Date | null> {
  if (!getAsaasConfig()) return null;
  const { rows: [row] } = await query(
    `SELECT MIN(${refundDueAt}) AS due_at
     FROM delivery_dispatch j JOIN orders o ON o.id = j.order_id
     JOIN asaas_checkouts c ON c.id = o.asaas_checkout_id WHERE ${pendingRefund}`
  );
  return row.due_at;
}

export async function observeDeliveryRefund(payment: { id?: unknown; checkoutSession?: unknown; externalReference?: unknown } | undefined) {
  const references = [payment?.checkoutSession, payment?.externalReference]
    .flatMap((value) => typeof value === 'string' && dispatchUuid.test(value) ? [value] : []);
  const paymentId = typeof payment?.id === 'string' && asaasPaymentIdPattern.test(payment.id) ? payment.id : null;
  if (!references.length && !paymentId) return;
  const result = await query(
    `UPDATE delivery_dispatch j SET refund_checked_at = NULL
     FROM orders o JOIN asaas_checkouts c ON c.id = o.asaas_checkout_id
     WHERE j.order_id = o.id AND o.payment_status = 'paid' AND j.refund_state IN ('pending','processing','review')
       AND (c.id = ANY($1::uuid[]) OR c.provider_id = ANY($1::text[]) OR c.provider_id = $2)`,
    [references, paymentId],
  );
  if (result.rowCount) wakeWork('refunds');
}

export async function reconcileDeliveryRefunds() {
  const config = getAsaasConfig();
  if (!config) return;
  await query(
    `UPDATE delivery_dispatch j SET refund_state = 'review'
     FROM orders o WHERE o.id = j.order_id AND o.payment_status = 'paid' AND j.refund_state = 'pending'
       AND o.asaas_split_snapshot @> '{"sharedCard":true}'::jsonb`,
  );
  const { rows } = await query(
    `WITH batch AS (
       SELECT j.order_id, c.provider_id, c.payment_flow, c.id AS checkout_reference, o.total, o.updated_at
       FROM delivery_dispatch j JOIN orders o ON o.id = j.order_id
       JOIN asaas_checkouts c ON c.id = o.asaas_checkout_id
       WHERE ${pendingRefund}
         AND ${refundDueAt} <= NOW()
       ORDER BY j.refund_checked_at NULLS FIRST LIMIT 5 FOR UPDATE OF j SKIP LOCKED
     )
     UPDATE delivery_dispatch j SET refund_checked_at = NOW() FROM batch b
     WHERE j.order_id = b.order_id RETURNING j.order_id, b.provider_id, b.payment_flow, b.checkout_reference, b.total, b.updated_at, j.refund_state`
  );
  const headers = { access_token: config.key, 'User-Agent': 'Uniweb' };
  for (const job of rows) {
    try {
      const direct = job.payment_flow === 'saved_card';
      if (direct ? !dispatchUuid.test(job.checkout_reference) : !dispatchUuid.test(job.provider_id)) continue;
      if (!job.refund_state) {
        if (direct) continue;
        await fetch(config.apiUrl + '/checkouts/' + job.provider_id + '/cancel', {
          method: 'POST', headers, signal: AbortSignal.timeout(8000),
        });
        continue;
      }
      const params = new URLSearchParams(direct
        ? { externalReference: job.checkout_reference, limit: '100' }
        : { checkoutSession: job.provider_id, limit: '100' });
      const response = await fetch(config.apiUrl + '/payments?' + params, { headers, signal: AbortSignal.timeout(8000) });
      if (!response.ok) continue;
      let result = await response.json() as { data?: AsaasPayment[]; hasMore?: boolean };
      let payments = result.data?.filter((entry) => direct ? entry.externalReference === job.checkout_reference : entry.checkoutSession === job.provider_id) ?? [];
      if (!direct && !payments.length && dispatchUuid.test(job.checkout_reference)) {
        const fallback = new URLSearchParams({ externalReference: job.checkout_reference, limit: '100' });
        const response = await fetch(config.apiUrl + '/payments?' + fallback, { headers, signal: AbortSignal.timeout(8000) });
        if (response.ok) {
          result = await response.json() as { data?: AsaasPayment[]; hasMore?: boolean };
          payments = result.data?.filter((entry) => entry.checkoutSession === job.provider_id) ?? [];
        }
      }
      const total = payments.reduce((sum, payment) => sum + Math.round(payment.value * 100), 0);
      if (result.hasMore || !payments.length || total !== Math.round(Number(job.total) * 100) ||
          new Set(payments.map((payment) => payment.id)).size !== payments.length ||
          payments.some(({ id }) => !asaasPaymentIdPattern.test(id))) {
        if (Date.now() - new Date(job.updated_at).getTime() > 300000) await markRefundForReview(job.order_id);
        continue;
      }
      if (payments.every((payment) => payment.status === 'REFUNDED')) {
        await query(
          `WITH changed AS (UPDATE delivery_dispatch SET refund_state = 'refunded' WHERE order_id = $1 RETURNING order_id)
           UPDATE orders SET payment_status = 'refunded' WHERE id IN (SELECT order_id FROM changed)`, [job.order_id]
        );
        continue;
      }
      if (job.refund_state === 'review') continue;
      const plan = payments[0].installment;
      const singlePayment = !plan && payments.length === 1;
      if (!(singlePayment || (plan && /^[a-z0-9_-]{1,100}$/i.test(plan) && payments.every((payment) => payment.installment === plan)))) {
        await markRefundForReview(job.order_id);
        continue;
      }
      let review = false;
      const hasRefund = payments.some((payment) =>
        ['REFUNDED','REFUND_IN_PROGRESS','REFUND_REQUESTED'].includes(payment.status) || payment.refunds?.length);
      if (!hasRefund && payments.every((payment) => ['CONFIRMED','RECEIVED'].includes(payment.status))) {
        const key = plan ? 'installment:' + plan : payments[0].id;
        const path = plan ? '/installments/' + encodeURIComponent(plan) : '/payments/' + payments[0].id;
        const claimed = await query(
          'INSERT INTO delivery_refund_submissions (payment_id, order_id) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING attempted_at',
          [key, job.order_id]
        );
        if (!claimed.rowCount) {
          const { rows: [attempt] } = await query(
            "SELECT attempted_at < NOW() - INTERVAL '5 minutes' AS stale FROM delivery_refund_submissions WHERE payment_id = $1", [key]
          );
          review = Boolean(attempt?.stale);
        } else {
          try {
            const refund = await fetch(config.apiUrl + path + '/refund', {
              method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: '{}',
              signal: AbortSignal.timeout(8000),
            });
            review = !refund.ok;
          } catch { review = true; }
        }
      } else if (!hasRefund || payments.some((payment) =>
        payment.refunds?.some((refund) => ['DENIED','CANCELLED'].includes(refund.status)))) {
        review = true;
      }
      await query('UPDATE delivery_dispatch SET refund_state = $2 WHERE order_id = $1 AND refund_state <> \'refunded\'',
        [job.order_id, review ? 'review' : 'processing']);
    } catch (error) {
      console.warn('Falha na conciliação de estorno', job.order_id, error instanceof Error ? error.name : 'erro');
    }
  }
}

async function markRefundForReview(orderId: string) {
  await query("UPDATE delivery_dispatch SET refund_state = 'review' WHERE order_id = $1 AND refund_state <> 'refunded'", [orderId]);
}
