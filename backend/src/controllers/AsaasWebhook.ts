import { timingSafeEqual } from 'node:crypto';
import { Request, Response } from 'express';
import { getClient } from '../config/database';
import { notifyAsaasSettlement, settleAsaasOrders } from '../services/AsaasPaymentSettlement';
import { observeDirectCardPayment } from '../services/AsaasCardPayments';

export async function asaasWebhook(req: Request, res: Response) {
  const expected = Buffer.from(process.env.ASAAS_WEBHOOK_TOKEN?.trim() || '');
  const received = Buffer.from(req.get('asaas-access-token') || '');
  if (!expected.length || expected.length !== received.length || !timingSafeEqual(expected, received)) {
    return res.sendStatus(401);
  }

  const { event, checkout, payment } = req.body || {};
  if (['PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED', 'PAYMENT_CREDIT_CARD_CAPTURE_REFUSED'].includes(event)) {
    try {
      await observeDirectCardPayment(payment, event === 'PAYMENT_CREDIT_CARD_CAPTURE_REFUSED');
      return res.sendStatus(200);
    } catch {
      return res.sendStatus(500);
    }
  }
  const paid = event === 'CHECKOUT_PAID' && checkout?.status === 'PAID';
  const ended = (event === 'CHECKOUT_EXPIRED' && checkout?.status === 'EXPIRED') ||
    (event === 'CHECKOUT_CANCELED' && checkout?.status === 'CANCELED');
  if ((!paid && !ended) || typeof checkout?.id !== 'string') return res.sendStatus(200);

  let client;
  let releaseError: Error | undefined;
  let settlement: Awaited<ReturnType<typeof settleAsaasOrders>> | undefined;
  try {
    client = await getClient();
    await client.query('BEGIN');
    const session = await client.query(
      "SELECT id FROM asaas_checkouts WHERE provider_id = $1 AND payment_flow = 'hosted' FOR UPDATE", [checkout.id]
    );
    if (session.rows.length) {
      const id = session.rows[0].id;
      settlement = await settleAsaasOrders(client, id, paid);
    }
    await client.query('COMMIT');
    notifyAsaasSettlement(settlement);
    return res.sendStatus(200);
  } catch {
    try {
      await client?.query('ROLLBACK');
    } catch {
      releaseError = new Error('Asaas webhook rollback failed');
    }
    console.error('Falha ao processar webhook do Asaas.');
    return res.sendStatus(500);
  } finally {
    client?.release(releaseError);
  }
}
