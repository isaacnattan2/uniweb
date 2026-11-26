import { randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import type { PoolClient } from 'pg';
import { getClient, query } from '../config/database';
import { getAsaasConfig } from './AsaasCheckout';
import { decryptStoreKey, encryptStoreKey } from './AsaasStoreAccounts';

type AsaasConfig = NonNullable<ReturnType<typeof getAsaasConfig>>;
type SavedCard = { id: string; brand: string; lastFour: string };

export class AsaasCardError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export function getAsaasCardConfig() {
  const config = getAsaasConfig();
  const key = Buffer.from(process.env.ASAAS_STORE_KEY_ENCRYPTION?.trim() ?? '', 'base64');
  return config && key.length === 32 ? { ...config, encryptionKey: key } : null;
}

export async function cardApi<T>(config: AsaasConfig, path: string, body?: object): Promise<T> {
  const response = await fetch(config.apiUrl + path, {
    method: body ? 'POST' : 'GET', redirect: 'error',
    headers: { access_token: config.key, 'Content-Type': 'application/json', 'User-Agent': 'Uniweb' },
    body: body && JSON.stringify(body), signal: AbortSignal.timeout(60000),
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new AsaasCardError(response.status, 'Asaas HTTP ' + response.status);
  }
  return response.json() as Promise<T>;
}

export function cardRemoteIp(value?: string) {
  const ip = value?.replace(/^::ffff:/, '') ?? '';
  if (!isIP(ip)) throw new AsaasCardError(400, 'Não foi possível identificar a conexão do cliente.');
  return ip;
}

const testNumbers = new Set(['4444444444444444', '5184019740373151', '4916561358240741']);
const hexUuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const customerIdPattern = /^cus_[a-z0-9]+$/i;

function parseCard(input: Record<string, unknown>) {
  const field = (name: string) => typeof input[name] === 'string' && input[name].length <= 120 ? input[name].trim() : '';
  const holderName = field('holderName');
  const number = field('number').replace(/[\s-]/g, '');
  const expiryMonth = field('expiryMonth');
  const expiryYear = field('expiryYear');
  const ccv = field('ccv');
  const cpfCnpj = field('cpfCnpj').replace(/\D/g, '');
  const postalCode = field('postalCode').replace(/\D/g, '');
  const addressNumber = field('addressNumber');
  const phone = field('phone').replace(/\D/g, '');
  const month = Number(expiryMonth);
  const year = Number(expiryYear);
  const now = new Date();
  if (!testNumbers.has(number)) throw new AsaasCardError(400, 'Use o cartão de teste 4444 4444 4444 4444 do Sandbox do Asaas, com CVV 123 e validade futura.');
  if (holderName.length < 3 || !/^\d{1,2}$/.test(expiryMonth) || month < 1 || month > 12 ||
      !/^\d{4}$/.test(expiryYear) || year > now.getUTCFullYear() + 30 ||
      year * 12 + month <= now.getUTCFullYear() * 12 + now.getUTCMonth() ||
      !/^\d{3,4}$/.test(ccv) || !/^(?:\d{11}|\d{14})$/.test(cpfCnpj) || !/^\d{8}$/.test(postalCode) ||
      !addressNumber || !/^\d{10,11}$/.test(phone)) {
    throw new AsaasCardError(400, 'Confira os dados fictícios do cartão e do titular.');
  }
  return {
    creditCard: { holderName, number, expiryMonth: expiryMonth.padStart(2, '0'), expiryYear, ccv },
    holder: { name: holderName, cpfCnpj, postalCode, addressNumber, phone },
  };
}

export async function listSavedCards(userId: string) {
  const { rows } = await query(
    'SELECT id, brand, last_four AS "lastFour" FROM customer_saved_cards WHERE user_id = $1 ORDER BY created_at DESC, id', [userId],
  );
  return rows as SavedCard[];
}

export async function removeSavedCard(userId: string, id: string) {
  if (!hexUuid.test(id)) return false;
  return Boolean((await query('DELETE FROM customer_saved_cards WHERE id = $1 AND user_id = $2', [id, userId])).rowCount);
}

async function ensureAsaasCardCustomer(config: AsaasConfig, userId: string, holder: { name: string; cpfCnpj: string }) {
  const client = await getClient();
  let rollbackError: Error | undefined;
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1::text, 934))', [userId]);
    const { rows: [user] } = await client.query<{ email: string; provider_customer_id: string | null }>(
      'SELECT u.email, c.provider_customer_id FROM users u LEFT JOIN asaas_card_customers c ON c.user_id = u.id WHERE u.id = $1', [userId],
    );
    if (!user) throw new AsaasCardError(404, 'Conta não encontrada.');
    let customer = user.provider_customer_id;
    if (!customer) {
      const externalReference = 'uniweb-card:' + userId;
      const options = new URLSearchParams({ externalReference, limit: '2' });
      const existing = await cardApi<{ data: { id: string; externalReference: string }[] }>(config, '/customers?' + options);
      if (existing.data?.length > 1) throw new AsaasCardError(409, 'Há mais de um cadastro Asaas para esta conta.');
      const match = existing.data?.find((entry) => entry.externalReference === externalReference);
      if (existing.data?.length && !match) throw new Error('Cadastro Asaas divergente.');
      customer = match?.id ?? (await cardApi<{ id: string }>(config, '/customers', {
        name: holder.name, cpfCnpj: holder.cpfCnpj, email: user.email,
        externalReference, notificationDisabled: true,
      })).id;
      if (!customerIdPattern.test(customer)) throw new Error('Cadastro Asaas inválido.');
      await client.query('INSERT INTO asaas_card_customers (user_id, provider_customer_id) VALUES ($1, $2)', [userId, customer]);
    }
    await client.query('COMMIT');
    return { customer, email: user.email };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { rollbackError = new Error('Falha ao reverter cadastro do cliente Asaas.'); }
    throw error;
  } finally { client.release(rollbackError); }
}

export async function addSavedCard(userId: string, input: Record<string, unknown>, ip?: string): Promise<SavedCard> {
  const config = getAsaasCardConfig();
  if (!config) throw new AsaasCardError(503, 'Cadastro de cartão Sandbox indisponível.');
  const { creditCard, holder } = parseCard(input);
  const remoteIp = cardRemoteIp(ip);
  const { customer, email } = await ensureAsaasCardCustomer(config, userId, holder);
  const card = await cardApi<{ creditCardToken: string; creditCardBrand: string }>(config, '/creditCard/tokenizeCreditCard', {
    customer, creditCard, creditCardHolderInfo: { ...holder, email }, remoteIp,
  });
  if (typeof card.creditCardToken !== 'string' || !card.creditCardToken || card.creditCardToken.length > 255) {
    throw new Error('Token de cartão Asaas ausente.');
  }
  const id = randomUUID();
  const lastFour = creditCard.number.slice(-4);
  const brand = typeof card.creditCardBrand === 'string' && /^[A-Z0-9_ -]{2,30}$/i.test(card.creditCardBrand) ? card.creditCardBrand : 'Cartão';
  const token = encryptStoreKey(card.creditCardToken, config.encryptionKey, 'customer-card', userId + ':' + id);
  await query('INSERT INTO customer_saved_cards (id, user_id, encrypted_token, brand, last_four) VALUES ($1,$2,$3,$4,$5)',
    [id, userId, token, brand, lastFour]);
  return { id, lastFour, brand };
}

export async function readCardForCheckout(client: PoolClient, userId: string, id: string) {
  const config = getAsaasCardConfig();
  if (!config) throw new AsaasCardError(503, 'Pagamento com cartão salvo indisponível.');
  const { rows: [card] } = await client.query(
    `SELECT s.encrypted_token, c.provider_customer_id FROM customer_saved_cards s
     JOIN asaas_card_customers c ON c.user_id = s.user_id
     WHERE s.id = $1 AND s.user_id = $2 FOR SHARE OF s`, [id, userId],
  );
  if (!card) throw new AsaasCardError(404, 'Selecione um cartão salvo da sua conta.');
  return {
    customer: card.provider_customer_id as string,
    token: decryptStoreKey(card.encrypted_token, config.encryptionKey, 'customer-card', userId + ':' + id),
  };
}
