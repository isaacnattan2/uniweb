import { randomUUID } from 'node:crypto';
import { Request, Response } from 'express';
import { query } from '../config/database';
import { readSplitCondition, worstCardBand } from '../services/AsaasSplit';
import { asaasStoreRequest, decryptStoreKey, sandboxStoreConfig, storeSandboxApi } from '../services/AsaasStoreAccounts';
import { loadAsaasFees } from './AdminAsaasFees';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const paymentId = /^pay_[a-z0-9]+$/i;

export function applyPixSplit(req: Request, res: Response) {
  return applySplit(req, res, 'pix');
}

export function applyCardSplit(req: Request, res: Response) {
  return applySplit(req, res, 'credit_card');
}

async function applySplit(req: Request, res: Response, method: 'pix' | 'credit_card') {
  res.set('Cache-Control', 'no-store');
  const id = req.params.id.toLowerCase();
  const condition = readSplitCondition(req.body);
  const simulatedLimit = req.body?.maxInstallments;
  const fixedPerInstallment = req.body?.fixedFeePerInstallment === true;
  const { expectedVersion } = req.body ?? {};
  if (!uuid.test(id) || !condition || (expectedVersion != null && (typeof expectedVersion !== 'string' || !uuid.test(expectedVersion))) ||
      Math.abs(condition.commissionRate * 100 - Math.round(condition.commissionRate * 100)) > 0.00001 || !['account', 'manual'].includes(req.body?.feeSource)) {
    return res.status(400).json({ error: 'Confira a loja, as parcelas e os valores. Cartão parcelado exige split percentual. A taxa da plataforma aceita até duas casas decimais.' });
  }
  const config = sandboxStoreConfig();
  if (!config) return res.status(503).json({ error: 'O repasse de teste requer o Asaas Sandbox habilitado.' });
  const { rows: [store] } = await query(
    `SELECT b.owner_id, b.max_card_installments, b.card_payment_configured, b.payment_methods, a.wallet_id, a.encrypted_key FROM businesses b
     LEFT JOIN asaas_store_accounts a ON a.business_id = b.id AND a.owner_id = b.owner_id
     WHERE b.id = $1 AND b.deleted_at IS NULL`, [id]);
  if (!store) return res.status(404).json({ error: 'Loja não encontrada.' });
  const card = method === 'credit_card';
  const configured = store.card_payment_configured === true && store.payment_methods?.includes('credit_card') &&
    Number.isInteger(store.max_card_installments) && store.max_card_installments >= 1 && store.max_card_installments <= 12;
  const configureCard = card && !configured;
  if (card && configured && (req.body?.authorizeCardSetup === true ||
      (req.body?.expectedCardLimit !== undefined && req.body.expectedCardLimit !== store.max_card_installments))) {
    return res.status(409).json({ error: 'O cartão já está configurado com outro limite. Confira a configuração atual da loja.' });
  }
  if (configureCard && req.body?.authorizeCardSetup !== true) {
    return res.status(409).json({ error: 'O cartão e o limite da loja precisam ser confirmados antes de aplicar a condição.' });
  }
  const maxInstallments = card ? (configured ? store.max_card_installments : simulatedLimit) : 1;
  if (!Number.isInteger(maxInstallments) || maxInstallments < 1 || maxInstallments > 12 ||
      (maxInstallments > 1 && condition.mode === 'fixed')) {
    return res.status(400).json({ error: 'O limite precisa ser de 1x a 12x. Limites acima de 1x exigem split percentual.' });
  }
  if (!store.encrypted_key || !uuid.test(store.wallet_id)) {
    return res.status(409).json({ error: 'A loja precisa de uma subconta Asaas vinculada e aprovada.' });
  }

  let expiresAt: string | null = null;
  let cardFeeBands: { min: number; max: number; rate: number; fixed: number }[] | undefined;
  const manualCardPricing = card && req.body.feeSource === 'manual';
  const manualFixedPerInstallment = manualCardPricing && fixedPerInstallment ? condition.asaasFixed : undefined;
  if (manualFixedPerInstallment !== undefined) condition.asaasFixed = manualFixedPerInstallment * maxInstallments;
  try {
    const key = decryptStoreKey(store.encrypted_key, config.encryptionKey, id, store.owner_id);
    const status = await asaasStoreRequest<{ general: string }>(storeSandboxApi, '/myAccount/status/', key);
    if (status.general !== 'APPROVED') return res.status(409).json({ error: 'A subconta da loja ainda não foi aprovada pelo Asaas.' });
    if (req.body.feeSource === 'account') {
      const { pix, creditCard } = await loadAsaasFees(storeSandboxApi, config.parentKey);
      const cardBands = creditCard.bands.filter((band) => band.min <= 12);
      const fees = card ? worstCardBand(cardBands, maxInstallments) : pix;
      if (!fees) return res.status(409).json({ error: 'O Asaas não retornou as tarifas para todas as opções da condição.' });
      if (!card && (condition.asaasRate !== fees.rate || condition.asaasFixed !== fees.fixed ||
          condition.asaasMinimum !== pix?.minimum || condition.asaasMaximum !== pix?.maximum)) {
        return res.status(409).json({ error: 'A tarifa Pix mudou desde a simulação. Atualize as tarifas antes de aplicar.' });
      }
      if (card) {
        cardFeeBands = cardBands.map(({ min, max, rate, fixed }) => ({ min, max, rate, fixed }));
        condition.asaasRate = fees.rate;
        condition.asaasFixed = fees.fixed;
      }
      const expirations = card ? cardBands.map((band) => band.promotionExpiresAt) : [pix?.promotionExpiresAt];
      const expiry = expirations.filter((value): value is string => typeof value === 'string').sort()[0];
      if (expiry) {
        const date = new Date(/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/.test(expiry)
          ? expiry.replace(' ', 'T') + '-03:00' : expiry);
        if (Number.isFinite(date.getTime())) expiresAt = date.toISOString();
      }
    }
  } catch {
    return res.status(502).json({ error: 'Não foi possível validar a condição no Asaas.' });
  }

  const version = randomUUID();
  const saved = { ...condition, version, ownerId: store.owner_id, walletId: store.wallet_id, expiresAt, maxInstallments, feeSource: req.body.feeSource, cardFeeBands, manualCardPricing, manualFixedPerInstallment };
  const column = method === 'pix' ? 'asaas_pix_split_condition' : 'asaas_card_split_condition';
  const result = await query(
    `UPDATE businesses SET ${column} = $3::jsonb, platform_fee_basis_points = $4, updated_at = NOW(),
         payment_methods = CASE WHEN $7::boolean AND NOT ('credit_card' = ANY(COALESCE(payment_methods, ARRAY[]::text[])))
           THEN array_append(COALESCE(payment_methods, ARRAY[]::text[]), 'credit_card') ELSE payment_methods END,
         max_card_installments = CASE WHEN $7::boolean THEN $8 ELSE max_card_installments END,
         card_payment_configured = card_payment_configured OR $7::boolean
     WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL
       AND ($5::boolean OR ${column}->>'version' IS NOT DISTINCT FROM $6::text)
       AND (NOT $9::boolean OR (card_payment_configured = $10 AND max_card_installments = $11
         AND payment_methods IS NOT DISTINCT FROM $12::text[]))`,
    [id, store.owner_id, JSON.stringify(saved), Math.round(condition.commissionRate * 100), expectedVersion === undefined,
      expectedVersion ?? null, configureCard, maxInstallments, card, store.card_payment_configured, store.max_card_installments, store.payment_methods]);
  if (!result.rowCount) return res.status(409).json({ error: 'O cadastro ou a condição da loja mudou. Atualize a página antes de salvar.' });
  return res.json({ condition: saved, maxInstallments, configuredCard: configureCard });
}

export async function removeSplitCondition(req: Request, res: Response) {
  res.set('Cache-Control', 'no-store');
  const { id, method, version } = req.params;
  if (!uuid.test(id) || !uuid.test(version) || (method !== 'pix' && method !== 'card')) {
    return res.status(400).json({ error: 'Loja, modalidade ou versão da condição inválida.' });
  }
  const column = method === 'pix' ? 'asaas_pix_split_condition' : 'asaas_card_split_condition';
  const result = await query(
    `UPDATE businesses SET ${column} = NULL, updated_at = NOW()
     WHERE id = $1 AND deleted_at IS NULL AND ${column}->>'version' = $2`, [id, version]);
  if (!result.rowCount) return res.status(409).json({ error: 'A condição mudou ou já foi removida. Atualize a página.' });
  return res.sendStatus(204);
}

export async function readSplitPayments(_req: Request, res: Response) {
  res.set('Cache-Control', 'no-store');
  const config = sandboxStoreConfig();
  if (!config) return res.status(503).json({ error: 'A consulta está disponível para o teste no Sandbox.' });
  const { rows } = await query(
    `SELECT o.id, b.name AS store, o.payment_status, o.order_status, o.delivery_status, o.payment_method,
         o.asaas_split_snapshot AS snapshot, e.amount_cents AS driver_cents,
         p.state AS payout_state, p.provider_status, p.payment_net_cents, p.store_cents, p.driver_cents AS confirmed_driver_cents
     FROM orders o JOIN businesses b ON b.id = o.business_id
     LEFT JOIN delivery_driver_earnings e ON e.order_id = o.id
     LEFT JOIN asaas_driver_payouts p ON p.order_id = o.id
     WHERE o.asaas_split_snapshot IS NOT NULL
     ORDER BY o.created_at DESC LIMIT 30`);
  try {
    const { balance } = await asaasStoreRequest<{ balance: number }>(storeSandboxApi, '/finance/balance', config.parentKey);
    return res.json({ orders: rows, balance: Number.isFinite(balance) ? balance : null });
  } catch {
    return res.json({ orders: rows, balance: null });
  }
}

export async function sendDriverSplitPayment(req: Request, res: Response) {
  res.set('Cache-Control', 'no-store');
  const id = req.params.id;
  if (!uuid.test(id)) return res.status(400).json({ error: 'Pedido inválido.' });
  const config = sandboxStoreConfig();
  if (!config) return res.status(503).json({ error: 'O repasse só está habilitado no Sandbox.' });

  const { rows: [order] } = await query(
    `SELECT o.asaas_split_snapshot AS snapshot, c.provider_id AS checkout_id,
       o.payment_method, e.user_id, e.amount_cents, a.wallet_id, a.encrypted_key, p.state, p.provider_id
     FROM orders o JOIN asaas_checkouts c ON c.id = o.asaas_checkout_id
     JOIN delivery_driver_earnings e ON e.order_id = o.id AND e.user_id = o.delivery_driver_id
     LEFT JOIN asaas_driver_accounts a ON a.driver_id = e.user_id
     LEFT JOIN asaas_driver_payouts p ON p.order_id = o.id
     WHERE o.id = $1 AND o.payment_status = 'paid' AND o.delivery_status = 'delivered'
       AND o.order_status <> 'cancelled' AND o.asaas_split_snapshot IS NOT NULL`, [id]);
  if (!order) return res.status(409).json({ error: 'O pedido precisa estar pago e entregue para liberar o ganho.' });

  const saveTransfer = async (transfer: { id?: string; status?: string }) => {
    const known = typeof transfer.id === 'string' && uuid.test(transfer.id);
    const state = !known ? 'review' : transfer.status === 'DONE' ? 'done'
      : ['PENDING', 'BANK_PROCESSING', 'SCHEDULED'].includes(transfer.status ?? '') ? 'processing' : 'review';
    await query(
      `UPDATE asaas_driver_payouts SET state = $2, provider_id = $3, provider_status = $4, updated_at = NOW()
       WHERE order_id = $1 AND state IN ('sending', 'processing')`,
      [id, state, known ? transfer.id : null, transfer.status ?? null]);
    return res.json({ state });
  };

  if (order.state === 'done') return res.json({ state: 'done' });
  if (order.state === 'review' || order.state === 'sending') {
    return res.status(409).json({ error: 'Já houve uma tentativa de repasse. Confira a referência do pedido no Asaas antes de qualquer nova movimentação.' });
  }

  try {
    if (order.state === 'processing' && order.provider_id) {
      return await saveTransfer(await asaasStoreRequest(storeSandboxApi, '/transfers/' + encodeURIComponent(order.provider_id), config.parentKey));
    }
    const amount = Number(order.amount_cents);
    if (!order.encrypted_key || !uuid.test(order.wallet_id) || !Number.isSafeInteger(amount) || amount <= 0) {
      return res.status(409).json({ error: 'Confira a subconta e o ganho do entregador.' });
    }
    const driverKey = decryptStoreKey(order.encrypted_key, config.encryptionKey, 'driver', order.user_id);
    const status = await asaasStoreRequest<{ general: string }>(storeSandboxApi, '/myAccount/status/', driverKey);
    if (status.general !== 'APPROVED') return res.status(409).json({ error: 'A subconta do entregador ainda está pendente.' });

    type Payment = {
      id: string; checkoutSession?: string; billingType: string; installment?: string | null;
      status: string; value: number; netValue: number;
      split?: { walletId: string; status: string; fixedValue?: number; percentualValue?: number }[];
    };
    const billingType = order.payment_method === 'credit_card' ? 'CREDIT_CARD' : 'PIX';
    const filter = new URLSearchParams({ checkoutSession: order.checkout_id, billingType, limit: '100' });
    const { data } = await asaasStoreRequest<{ data: Payment[] }>(storeSandboxApi, '/payments?' + filter, config.parentKey);
    const candidates = data.some((payment) => payment.checkoutSession === order.checkout_id) ? data
      : (await asaasStoreRequest<{ data: Payment[] }>(storeSandboxApi, '/payments?limit=100&billingType=' + billingType, config.parentKey)).data;
    const matched = candidates.filter((payment) => payment.checkoutSession === order.checkout_id && payment.billingType === billingType);
    const planId = matched.find((payment) => payment.installment)?.installment;
    let payments = matched;
    if (planId) {
      if (billingType !== 'CREDIT_CARD' || !uuid.test(planId) || matched.some((payment) => payment.installment !== planId)) {
        return res.status(409).json({ error: 'O parcelamento retornado pelo Asaas não corresponde ao checkout.' });
      }
      const plan = await asaasStoreRequest<{ data: Payment[]; hasMore: boolean; totalCount: number }>(
        storeSandboxApi, '/installments/' + encodeURIComponent(planId) + '/payments?limit=100', config.parentKey);
      payments = plan.data;
      if (plan.hasMore || plan.totalCount !== payments.length || payments.length > (order.snapshot.condition.maxInstallments ?? 1) ||
          payments.some((payment) => payment.installment !== planId ||
            (payment.checkoutSession && payment.checkoutSession !== order.checkout_id) || payment.billingType !== billingType)) {
        return res.status(409).json({ error: 'Não foi possível conferir todas as parcelas do checkout.' });
      }
    }
    const totalCents = (field: 'value' | 'netValue') => payments.reduce((sum, payment) => sum + Math.round(payment[field] * 100), 0);
    const net = totalCents('netValue');
    if ((!planId && payments.length !== 1) || payments.length === 0 ||
        new Set(payments.map((payment) => payment.id)).size !== payments.length ||
        payments.some((payment) => !paymentId.test(payment.id) || payment.status !== 'RECEIVED' ||
          !Number.isFinite(payment.netValue) || payment.netValue < 0 || payment.netValue > payment.value) ||
        totalCents('value') !== order.snapshot.gross || !Number.isSafeInteger(net)) {
      return res.status(409).json({ error: 'O Asaas ainda não confirmou o recebimento integral deste checkout.' });
    }
    const { split, storeEstimate } = order.snapshot;
    const confirmed = (payment: Payment) => payment.split?.some((item) =>
      item.walletId === split.walletId && item.status === 'DONE' &&
      (typeof split.fixedValue === 'number' ? item.fixedValue === split.fixedValue : item.percentualValue === split.percentualValue));
    if (storeEstimate > 0 && !payments.every(confirmed)) {
      return res.status(409).json({ error: 'O Asaas ainda não confirmou o split da loja em todas as cobranças do pedido.' });
    }
    const store = storeEstimate === 0 ? 0 : typeof split.fixedValue === 'number'
      ? Math.round(split.fixedValue * 100) : payments.reduce((total, payment) =>
        total + Math.round(Math.round(payment.netValue * 100) * split.percentualValue / 100), 0);
    const { balance } = await asaasStoreRequest<{ balance: number }>(storeSandboxApi, '/finance/balance', config.parentKey);
    if (!Number.isSafeInteger(store) || store < 0 || net - store < amount || !Number.isFinite(balance) || Math.round(balance * 100) < amount) {
      return res.status(409).json({ error: 'O líquido do pedido ou o saldo disponível da plataforma não cobre o repasse.' });
    }

    const claimed = await query(
      `INSERT INTO asaas_driver_payouts (order_id, state, payment_net_cents, store_cents, driver_cents)
       SELECT id, 'sending', $2, $3, $4 FROM orders WHERE id = $1 AND payment_status = 'paid'
         AND delivery_status = 'delivered' AND order_status <> 'cancelled'
       ON CONFLICT (order_id) DO NOTHING`, [id, net, store, amount]);
    if (!claimed.rowCount) return res.status(409).json({ error: 'O repasse já foi solicitado ou o pedido mudou.' });
    try {
      const transfer = await asaasStoreRequest<{ id: string; status: string }>(storeSandboxApi, '/transfers/', config.parentKey, {
        walletId: order.wallet_id, value: amount / 100, externalReference: 'uniweb-entrega-' + id,
      });
      return await saveTransfer(transfer);
    } catch {
      await query("UPDATE asaas_driver_payouts SET state = 'review', updated_at = NOW() WHERE order_id = $1 AND state = 'sending'", [id]);
      return res.status(502).json({ error: 'O repasse precisa de conciliação no Asaas. Não será reenviado automaticamente.' });
    }
  } catch {
    return res.status(502).json({ error: 'Não foi possível consultar o Asaas para este repasse.' });
  }
}