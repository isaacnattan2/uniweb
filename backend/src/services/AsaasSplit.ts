export interface SplitCondition {
  mode: 'fixed' | 'percentage';
  feeOwner: 'store' | 'platform' | 'proportional';
  discountOwner: 'store' | 'platform';
  commissionBase: 'gross' | 'net';
  commissionRate: number;
  commissionFixed: number;
  asaasRate: number;
  asaasFixed: number;
  asaasMinimum: number | null;
  asaasMaximum: number | null;
  fixedOverride: number | null;
  rateOverride: number | null;
}

export interface SavedSplitCondition extends SplitCondition {
  version: string;
  ownerId: string;
  walletId: string;
  expiresAt: string | null;
  maxInstallments?: number;
  cardFeeBands?: { min: number; max: number; rate: number; fixed: number }[];
  manualFixedPerInstallment?: number;
  manualCardPricing?: boolean;
}

export function worstCardBand<T extends { min: number; max: number; rate: number; fixed: number }>(bands: T[], limit: number) {
  const eligible = bands.filter((band) => band.min <= limit);
  if (Array.from({ length: limit }, (_, index) => index + 1)
    .some((count) => !eligible.some((band) => band.min <= count && band.max >= count))) return;
  return eligible.reduce<T | undefined>((worst, band) => !worst || band.rate > worst.rate ||
    (band.rate === worst.rate && band.fixed > worst.fixed) ? band : worst, undefined);
}

export function resolveCardSplitLimit(condition: SavedSplitCondition, limit: number): SavedSplitCondition | null {
  if (limit > 1 && condition.mode === 'fixed') return null;
  if (condition.cardFeeBands) {
    const band = worstCardBand(condition.cardFeeBands, limit);
    return band ? { ...condition, asaasRate: band.rate, asaasFixed: band.fixed, maxInstallments: limit } : null;
  }
  if (condition.manualFixedPerInstallment !== undefined) {
    return { ...condition, asaasFixed: condition.manualFixedPerInstallment * limit, maxInstallments: limit };
  }
  if (!condition.manualCardPricing && condition.maxInstallments !== undefined && limit > condition.maxInstallments) return null;
  return { ...condition, maxInstallments: limit };
}

export function readSplitCondition(body: unknown): SplitCondition | null {
  if (!body || typeof body !== 'object') return null;
  const raw = body as Record<string, unknown>;
  const { mode, feeOwner, discountOwner, commissionBase } = raw;
  if ((mode !== 'fixed' && mode !== 'percentage') ||
      (feeOwner !== 'store' && feeOwner !== 'platform' && feeOwner !== 'proportional') ||
      (discountOwner !== 'store' && discountOwner !== 'platform') ||
      (commissionBase !== 'gross' && commissionBase !== 'net')) return null;

  const valid = (value: unknown, max: number, precision: number): value is number =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max &&
    Math.abs(value * precision - Math.round(value * precision)) < 0.00001;
  const { commissionRate, commissionFixed, asaasRate, asaasFixed, asaasMinimum, asaasMaximum, fixedOverride, rateOverride } = raw;
  if (!valid(commissionRate, 100, 10000) || !valid(commissionFixed, 1000000, 100) ||
      !valid(asaasRate, 100, 10000) || !valid(asaasFixed, 1000000, 100) ||
      (asaasMinimum !== null && !valid(asaasMinimum, 1000000, 100)) ||
      (asaasMaximum !== null && !valid(asaasMaximum, 1000000, 100)) ||
      (typeof asaasMinimum === 'number' && typeof asaasMaximum === 'number' && asaasMinimum > asaasMaximum) ||
      (fixedOverride !== null && !valid(fixedOverride, 1000000, 100)) ||
      (rateOverride !== null && !valid(rateOverride, 100, 10000))) return null;
  return { mode, feeOwner, discountOwner, commissionBase, commissionRate, commissionFixed,
    asaasRate, asaasFixed, asaasMinimum, asaasMaximum, fixedOverride, rateOverride };
}

export function calculateCheckoutSplit(condition: SavedSplitCondition, subtotal: number, discount: number, freight: number, maxDriver: number) {
  const productsPaid = subtotal - discount;
  const gross = productsPaid + freight;
  if (!Number.isSafeInteger(gross) || gross <= 0) return null;
  const toCents = (amount: number) => Math.round(amount * 100);
  const percentage = (value: number, rate: number) => Math.round(value * rate / 100);
  const fee = Math.min(condition.asaasMaximum === null ? Infinity : toCents(condition.asaasMaximum),
    Math.max(toCents(condition.asaasMinimum ?? 0), percentage(gross, condition.asaasRate) + toCents(condition.asaasFixed)));
  const net = gross - fee;
  if (net <= 0) return null;
  const storeFee = condition.feeOwner === 'store' ? fee : condition.feeOwner === 'proportional' ? Math.round(fee * (productsPaid / gross)) : 0;
  const storeBase = condition.discountOwner === 'store' ? productsPaid : subtotal;
  const basis = condition.commissionBase === 'gross' ? storeBase : Math.max(0, storeBase - storeFee);
  const commission = percentage(basis, condition.commissionRate) + toCents(condition.commissionFixed);
  const storeEstimate = storeBase - storeFee - commission;
  const fixedValue = condition.fixedOverride === null ? storeEstimate : toCents(condition.fixedOverride);
  const rate = condition.rateOverride ?? Math.round(storeEstimate / net * 1000000) / 10000;
  const payable = condition.mode === 'fixed' ? fixedValue : percentage(net, rate);
  if (payable < 0 || payable + maxDriver > net ||
      (condition.mode === 'percentage' && (rate < 0 || rate > 100))) return null;

  const split = condition.mode === 'fixed'
    ? { walletId: condition.walletId, fixedValue: fixedValue / 100 }
    : { walletId: condition.walletId, percentualValue: rate };
  return { condition, split, gross, fee, net, storeEstimate: payable, maxDriver, commission };
}