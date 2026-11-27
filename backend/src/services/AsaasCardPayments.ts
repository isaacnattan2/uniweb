import { getClient, query } from '../config/database';
import { asaasPaymentIdPattern, getAsaasConfig } from './AsaasCheckout';
import { cardApi, AsaasCardError } from './AsaasSavedCards';
import { notifyAsaasSettlement, settleAsaasOrders } from './AsaasPaymentSettlement';

type AsaasConfig = NonNullable<ReturnType<typeof getAsaasConfig>>;
export type CardPaymentState = 'paid' | 'pending' | 'failed';
type ProviderPayment = { id?: string; externalReference?: string; customer?: string; billingType?: string; status?: string; installment?: string };
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

export async function observeDirectCardPayment(payment?: ProviderPayment, refused = false) {
  const reference = payment?.externalReference;
  if (!reference || !uuid.test(reference) || typeof payment?.id !== 'string' || !asaasPaymentIdPattern.test(payment.id) ||
      payment.billingType !== 'CREDIT_CARD' || typeof payment.customer !== 'string') return 'pending';
  const paid = payment.status === 'CONFIRMED' || payment.status === 'RECEIVED';
  const failed = refused || payment.status === 'REFUSED';
  const client = await getClient();
  let rollbackError: Error | undefined;
  let settlement;
  try {
    await client.query('BEGIN');
    const { rows: [session] } = await client.query(
      `SELECT c.user_id, c.provider_id, a.provider_customer_id FROM asaas_checkouts c
       JOIN asaas_card_customers a ON a.user_id = c.user_id
       WHERE c.id = $1 AND c.payment_flow = 'saved_card' FOR UPDATE OF c`, [reference],
    );
    if (session && session.provider_customer_id === payment.customer) {
      // Any confirmed installment belongs to the same card authorization and reference.
      await client.query("UPDATE asaas_checkouts SET provider_id = $2 WHERE id = $1 AND provider_id = 'card:' || id", [reference, payment.id]);
      if (paid || failed) settlement = await settleAsaasOrders(client, reference, paid, session.user_id);
    }
    await client.query('COMMIT');
    notifyAsaasSettlement(settlement);
    return !session || session.provider_customer_id !== payment.customer ? 'pending' : paid ? 'paid' : failed ? 'failed' : 'pending';
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { rollbackError = new Error('Falha ao conciliar cobrança Asaas.'); }
    throw error;
  } finally { client.release(rollbackError); }
}

async function declineAttempt(reference: string) {
  const client = await getClient();
  let rollbackError: Error | undefined;
  try {
    await client.query('BEGIN');
    await client.query("SELECT id FROM asaas_checkouts WHERE id = $1 AND payment_flow = 'saved_card' FOR UPDATE", [reference]);
    const settlement = await settleAsaasOrders(client, reference, false);
    await client.query('COMMIT');
    notifyAsaasSettlement(settlement);
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { rollbackError = new Error('Falha ao reverter cobrança recusada.'); }
    throw error;
  } finally { client.release(rollbackError); }
}

export async function submitDirectCardPayment(config: AsaasConfig, reference: string, card: { customer: string; token: string },
  total: number, installments: number, remoteIp: string,
  split: { walletId: string; fixedValue?: number; percentualValue?: number; totalFixedValue?: number }[]
): Promise<CardPaymentState> {
  let payment: ProviderPayment;
  try {
    payment = await cardApi<ProviderPayment>(config, '/payments', {
      customer: card.customer, billingType: 'CREDIT_CARD', externalReference: reference,
      dueDate: new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()),
      ...(installments > 1 ? { installmentCount: installments, totalValue: total } : { value: total }),
      creditCardToken: card.token, remoteIp, ...(split.length && { split }),
    });
  } catch (error) {
    if (error instanceof AsaasCardError && [400, 401, 403, 422].includes(error.status)) {
      await declineAttempt(reference);
      return 'failed';
    }
    return 'pending';
  }
  return observeDirectCardPayment(payment);
}

export async function reconcileDirectCardPayments() {
  const config = getAsaasConfig();
  if (!config) return;
  const { rows } = await query(
    `WITH batch AS (
       SELECT c.id FROM asaas_checkouts c
       WHERE c.payment_flow = 'saved_card'
         AND (c.card_checked_at IS NULL OR c.card_checked_at < NOW() - INTERVAL '1 minute')
         AND EXISTS (SELECT 1 FROM orders o WHERE o.asaas_checkout_id = c.id AND o.payment_status = 'pending')
       ORDER BY c.card_checked_at NULLS FIRST LIMIT 5 FOR UPDATE SKIP LOCKED
     )
     UPDATE asaas_checkouts c SET card_checked_at = NOW() FROM batch WHERE c.id = batch.id RETURNING c.id`,
  );
  await Promise.all(rows.map(async ({ id }) => {
    try {
      const params = new URLSearchParams({ externalReference: id, limit: '30' });
      const result = await cardApi<{ data?: ProviderPayment[] }>(config, '/payments?' + params);
      const payment = result.data?.find((entry) => entry.externalReference === id && ['CONFIRMED', 'RECEIVED', 'REFUSED'].includes(entry.status ?? ''));
      if (payment) await observeDirectCardPayment(payment);
    } catch {
      // A consulta é somente de leitura. Uma resposta incerta mantém o pedido pendente.
    }
  }));
}
