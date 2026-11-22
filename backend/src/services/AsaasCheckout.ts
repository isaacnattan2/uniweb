export const MAX_INSTALLMENTS = 3;
export const checkoutIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  items: Array<{ name: string; quantity: number; value: number }>
): Promise<string> {
  const card = method === 'credit_card';
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
      chargeTypes: card ? ['DETACHED', 'INSTALLMENT'] : ['DETACHED'],
      ...(card && { installment: { maxInstallmentCount: MAX_INSTALLMENTS } }),
      minutesToExpire: 30,
      callback: {
        successUrl: callbackUrl('success'),
        cancelUrl: callbackUrl('cancelled'),
        expiredUrl: callbackUrl('expired'),
      },
      items,
    }),
  });
  if (!response.ok) {
    const failure = await response.json().catch(() => null) as { errors?: unknown } | null;
    const codes = Array.isArray(failure?.errors)
      ? failure.errors.slice(0, 5).map((error) => error?.code)
        .filter((code): code is string => typeof code === 'string' && /^[a-z_]{1,60}$/.test(code))
      : [];
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
