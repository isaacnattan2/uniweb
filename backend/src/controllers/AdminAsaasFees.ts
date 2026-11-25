import { Request, Response } from 'express';
import { asaasStoreRequest, storeProductionApi, storeSandboxApi } from '../services/AsaasStoreAccounts';

type Fields = Record<string, unknown>;

function nonNegative(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function activePromotion(end: unknown, now: number) {
  if (typeof end !== 'string') return false;
  const localTimestamp = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/.test(end)
    ? end.replace(' ', 'T') + '-03:00' : end;
  const expires = Date.parse(localTimestamp);
  return Number.isFinite(expires) && expires > now;
}

export async function getAdminAsaasFees(_req: Request, res: Response) {
  res.set('Cache-Control', 'no-store');
  const base = process.env.ASAAS_API_URL?.trim() || storeSandboxApi;
  const key = process.env.ASAAS_API_KEY?.trim();
  if (!key || (base !== storeSandboxApi && base !== storeProductionApi)) {
    return res.status(503).json({ error: 'Configure a chave e a URL do mesmo ambiente Asaas para consultar as tarifas.' });
  }

  try {
    return res.json(await loadAsaasFees(base, key));
  } catch {
    return res.status(502).json({ error: 'O Asaas não retornou as tarifas da conta. Confira a chave e tente novamente.' });
  }
}
export async function loadAsaasFees(base: string, key: string) {
  const { payment } = await asaasStoreRequest<{ payment?: { pix?: Fields; creditCard?: Fields } }>(base, '/myAccount/fees/', key);
  if (!payment || (!payment.pix && !payment.creditCard)) throw new Error('Tarifas de pagamento ausentes');
  const now = Date.now();
  const pix = payment.pix;
  const card = payment.creditCard;
  const pixStandard = nonNegative(pix?.fixedFeeValue);
  const pixDiscount = nonNegative(pix?.fixedFeeValueWithDiscount);
  const pixRate = nonNegative(pix?.percentageFee);
  const pixPromotion = pixDiscount !== null && activePromotion(pix?.discountExpiration, now);
  const operationValue = nonNegative(card?.operationValue);
  const cardPromotion = card?.hasValidDiscount === true && activePromotion(card.discountExpiration, now);
  const cardBands = [
    { min: 1, max: 1, rate: 'oneInstallmentPercentage', discount: 'discountOneInstallmentPercentage' },
    { min: 2, max: 6, rate: 'upToSixInstallmentsPercentage', discount: 'discountUpToSixInstallmentsPercentage' },
    { min: 7, max: 12, rate: 'upToTwelveInstallmentsPercentage', discount: 'discountUpToTwelveInstallmentsPercentage' },
    { min: 13, max: 21, rate: 'upToTwentyOneInstallmentsPercentage', discount: 'discountUpToTwentyOneInstallmentsPercentage' },
  ].flatMap(({ min, max, rate, discount }) => {
    const standardRate = nonNegative(card?.[rate]);
    const discountedRate = cardPromotion ? nonNegative(card?.[discount]) : null;
    const activeRate = discountedRate ?? standardRate;
    return activeRate === null || operationValue === null ? [] : [{
      min, max, standardRate, rate: activeRate, fixed: operationValue,
      promotionExpiresAt: discountedRate === null ? null : card?.discountExpiration,
    }];
  });

  return {
    environment: base === storeSandboxApi ? 'sandbox' : 'production',
    fetchedAt: new Date(now).toISOString(),
    pix: pixStandard === null && pixRate === null && !pixPromotion ? null : {
      standardFixed: pixStandard,
      fixed: (pixPromotion ? pixDiscount : pixStandard) ?? 0,
      rate: pixRate ?? 0,
      minimum: nonNegative(pix?.minimumFeeValue),
      maximum: nonNegative(pix?.maximumFeeValue),
      promotionExpiresAt: pixPromotion ? pix?.discountExpiration : null,
    },
    creditCard: { daysToReceive: nonNegative(card?.daysToReceive), bands: cardBands },
  };
}
