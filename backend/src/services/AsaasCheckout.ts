export const MAX_CARD_INSTALLMENTS = 12;
export const asaasPaymentIdPattern = /^pay_[a-z0-9_]+$/i;
export const checkoutIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class AsaasCheckoutSetupError extends Error {
  constructor(readonly pixKeyMissing: boolean, readonly splitDisabled: boolean) {
    super('Configuração de checkout Asaas pendente');
  }
}

const sandboxApi = 'https://api-sandbox.asaas.com/v3';

export function checkoutUrl(id: string): string {
  const url = new URL('https://sandbox.asaas.com/checkoutSession/show');
  url.searchParams.set('id', id);
  return url.href;
}

export function getAsaasConfig() {
  const key = process.env.ASAAS_API_KEY?.trim();
  const token = process.env.ASAAS_WEBHOOK_TOKEN?.trim();
  const apiUrl = process.env.ASAAS_API_URL || sandboxApi;
  const origin = process.env.ASAAS_RETURN_ORIGIN || 'https://uniweb-front.onrender.com';
  if (!URL.canParse(origin)) return null;
  const returnUrl = new URL('/orders', origin);
  if (!key || !token || !/^\S{32,255}$/.test(token) || token === key || apiUrl !== sandboxApi || !['http:', 'https:'].includes(returnUrl.protocol)) return null;
  return { key, apiUrl, returnUrl };
}

export async function createAsaasCheckout(
  config: NonNullable<ReturnType<typeof getAsaasConfig>>,
  reference: string,
  method: 'pix' | 'credit_card',
  items: Array<{ name: string; quantity: number; value: number }>,
  maxCardInstallments: number,
  splits: { walletId: string; fixedValue?: number; percentualValue?: number }[] = []
): Promise<string> {
  const card = method === 'credit_card';
  const allowsInstallments = card && maxCardInstallments > 1;
  const callbackUrl = (result: string) => {
    const url = new URL(config.returnUrl);
    url.searchParams.set('checkout', result);
    return url.href;
  };
  const response = await fetch(config.apiUrl + '/checkouts', {
    method: 'POST',
    headers: { access_token: config.key, 'User-Agent': 'Uniweb', 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(15000),
    body: JSON.stringify({
      externalReference: reference,
      billingTypes: [card ? 'CREDIT_CARD' : 'PIX'],
      chargeTypes: allowsInstallments ? ['DETACHED', 'INSTALLMENT'] : ['DETACHED'],
      ...(allowsInstallments && { installment: { maxInstallmentCount: maxCardInstallments } }),
      minutesToExpire: 30,
      callback: {
        successUrl: callbackUrl('success'),
        cancelUrl: callbackUrl('cancelled'),
        expiredUrl: callbackUrl('expired'),
      },
      items,
      ...(splits.length && {
        splits: splits.map(({ percentualValue, ...split }) => ({
          ...split,
          percentageValue: percentualValue,
        })),
      }),
    }),
  });
  if (!response.ok) {
    const failure = await response.json().catch(() => null) as { errors?: unknown } | null;
    const errors = Array.isArray(failure?.errors) ? failure.errors : [];
    const describes = (pattern: RegExp) => errors.some((error) =>
      error?.code === 'invalid_object' && typeof error.description === 'string' && pattern.test(error.description));
    const pixKeyMissing = !card && describes(/necess[aá]rio criar uma chave pix/i);
    const splitDisabled = describes(/cria[çc][aã]o de split de pagamento est[aá] desabilitada/i);
    if (response.status === 400 && (pixKeyMissing || splitDisabled)) {
      throw new AsaasCheckoutSetupError(pixKeyMissing, splitDisabled);
    }
    const codes = errors.slice(0, 5).map((error) => error?.code)
      .filter((code): code is string => typeof code === 'string' && /^[a-z_]{1,60}$/.test(code));
    const suffix = codes.length ? ' (' + [...new Set(codes)].join(', ') + ')' : '';
    throw new Error('Asaas Checkout HTTP ' + response.status + suffix);
  }
  const data: unknown = await response.json();
  if (!data || typeof data !== 'object' || !('id' in data) ||
      typeof data.id !== 'string' || !checkoutIdPattern.test(data.id)) {
    throw new Error('Invalid Asaas checkout id');
  }
  return data.id;
}

export async function getAsaasInstallmentCount(checkoutId: string): Promise<number | null> {
  const key = process.env.ASAAS_API_KEY?.trim();
  const apiUrl = process.env.ASAAS_API_URL || sandboxApi;
  if (!key || apiUrl !== sandboxApi) return null;

  const signal = AbortSignal.timeout(4000);
  const headers = { access_token: key, 'User-Agent': 'Uniweb' };
  type CardPayment = { checkoutSession?: string; installment?: string | null };
  async function listPayments(params: URLSearchParams) {
    params.set('billingType', 'CREDIT_CARD');
    const response = await fetch(apiUrl + '/payments?' + params, { headers, signal });
    if (!response.ok) throw new Error('Asaas payments lookup HTTP ' + response.status);
    return await response.json() as { data?: CardPayment[]; hasMore?: boolean };
  }

  const filtered = await listPayments(new URLSearchParams({ checkoutSession: checkoutId, limit: '20' }));
  let payment = filtered.data?.find((entry) => entry.checkoutSession === checkoutId);
  // Sandbox can omit matching payments when the checkoutSession filter is present.
  for (let offset = 0; !payment && offset < 300; offset += 100) {
    const page = await listPayments(new URLSearchParams({ limit: '100', offset: String(offset) }));
    payment = page.data?.find((entry) => entry.checkoutSession === checkoutId);
    if (!page.hasMore) break;
  }
  if (!payment) return null;
  if (!payment.installment) return 1;

  const plan = await fetch(apiUrl + '/installments/' + encodeURIComponent(payment.installment) + '/payments', {
    headers, signal,
  });
  if (!plan.ok) throw new Error('Asaas installment lookup HTTP ' + plan.status);
  const { totalCount } = await plan.json() as { totalCount?: number };
  return typeof totalCount === 'number' && Number.isInteger(totalCount) && totalCount >= 2 && totalCount <= 21
    ? totalCount : null;
}
