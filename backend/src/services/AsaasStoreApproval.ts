import type { AsaasAccountDatabase } from './AsaasStoreAccounts';
import { query } from '../config/database';
import { AsaasStoreError, asaasStoreRequest, decryptStoreKey, getSandboxStoreAccount, sandboxStoreConfig, storeProductionApi, storeSandboxApi } from './AsaasStoreAccounts';

interface AsaasDocumentGroup {
  id?: string;
  type?: string;
  status?: string;
  description?: string;
  onboardingUrl?: string;
}

export async function resolveStoreAsaasAccount(businessId: string, ownerId: string, db?: AsaasAccountDatabase) {
  const base = process.env.ASAAS_STORE_API_URL?.trim() || storeSandboxApi;
  if (base !== storeSandboxApi && base !== storeProductionApi) throw new Error('Ambiente Asaas inválido');

  const suffix = [businessId, ownerId].map((id) => id.toLowerCase().replace(/-/g, '_')).join('__');
  const manualKey = process.env['ASAAS_STORE_API_KEY_' + suffix]?.trim();
  if (manualKey && manualKey !== process.env.ASAAS_API_KEY?.trim()) {
    return { base, key: manualKey, canSimulate: false };
  }

  const config = sandboxStoreConfig();
  if (!config) return { base, canRegister: false };
  const account = await getSandboxStoreAccount(businessId, ownerId, db);
  if (!account) return { base, canRegister: true };
  if (!account.encrypted_key) return { base, registrationPending: true };
  return {
    base,
    key: decryptStoreKey(account.encrypted_key, config.encryptionKey, businessId, ownerId),
    canSimulate: true,
    createdAt: account.created_at,
    walletId: account.wallet_id,
  };
}

export async function resolveDriverAsaasAccount(driverId: string, db: AsaasAccountDatabase = { query }) {
  const base = process.env.ASAAS_STORE_API_URL?.trim() || storeSandboxApi;
  if (base !== storeSandboxApi && base !== storeProductionApi) throw new Error('Ambiente Asaas inválido');
  const config = sandboxStoreConfig();
  if (!config) return { base, canRegister: false };
  const result = await db.query(
    `SELECT a.encrypted_key, a.created_at, a.wallet_id
     FROM drivers d LEFT JOIN asaas_driver_accounts a ON a.driver_id = d.user_id
     WHERE d.user_id = $1 AND d.deleted_at IS NULL`, [driverId],
  );
  const account = result.rows[0];
  if (!account) return { base, canRegister: false };
  if (!account.created_at) return { base, canRegister: true };
  if (!account.encrypted_key) return { base, registrationPending: true };
  return {
    base,
    key: decryptStoreKey(account.encrypted_key, config.encryptionKey, 'driver', driverId),
    canSimulate: true,
    createdAt: account.created_at as Date,
    walletId: account.wallet_id as string | null,
  };
}

export async function readStoreAsaasApproval(base: string, key: string, mode: 'admin' | 'merchant', createdAt?: Date) {
  const { id, general, commercialInfo, bankAccountInfo, documentation } = await readAsaasRegistration(base, key);
  if (typeof general !== 'string') throw new Error('Situa\u00e7\u00e3o Asaas inv\u00e1lida');

  let documents: AsaasDocumentGroup[] = [];
  let documentQuery: 'available' | 'initializing' | 'unavailable' = 'available';
  if (createdAt && Date.now() - createdAt.getTime() < 15000) {
    documentQuery = 'initializing';
  } else {
    try {
      const result = await asaasStoreRequest<{ data: AsaasDocumentGroup[] }>(base, '/myAccount/documents', key);
      if (!Array.isArray(result.data)) throw new Error('Documentos Asaas inválidos');
      documents = result.data;
    } catch (error) {
      documentQuery = 'unavailable';
      if (error instanceof AsaasStoreError) {
        return { id, general, commercialInfo, bankAccountInfo, documentation, documentQuery, documentHttpStatus: error.status, documents: [] };
      }
    }
  }

  return {
    id, general, commercialInfo, bankAccountInfo, documentation, documentQuery, documentHttpStatus: undefined as number | undefined,
    documents: documents.map(({ id: documentId, type, status, description, onboardingUrl }) => ({
      id: documentId, type, status, description,
      onboardingUrl: mode === 'merchant' ? safeOnboardingUrl(onboardingUrl) : undefined,
    })),
  };
}

function readAsaasRegistration(base: string, key: string) {
  return asaasStoreRequest<{
    id?: string; general: string; commercialInfo?: string; bankAccountInfo?: string; documentation?: string;
  }>(base, '/myAccount/status/', key);
}

async function approvedForPayout(account: { base: string; key?: string; walletId?: string | null }, expectedWallet?: string) {
  if (!account.key || !account.walletId || (expectedWallet && expectedWallet !== account.walletId)) return false;
  try {
    const status = await readAsaasRegistration(account.base, account.key);
    return status.general === 'APPROVED' && status.bankAccountInfo === 'APPROVED';
  } catch {
    return false;
  }
}

export async function storeCanReceivePayout(businessId: string, ownerId: string, expectedWallet?: string, db?: AsaasAccountDatabase) {
  return approvedForPayout(await resolveStoreAsaasAccount(businessId, ownerId, db), expectedWallet);
}

export async function driverCanReceivePayout(driverId: string, db?: AsaasAccountDatabase) {
  return approvedForPayout(await resolveDriverAsaasAccount(driverId, db));
}

const driverApprovalCache = new Map<string, { until: number; result: Promise<boolean> }>();

export async function filterDriversEligibleForPayout<T>(drivers: T[], idOf: (driver: T) => string, db?: AsaasAccountDatabase) {
  const now = Date.now();
  for (const [id, entry] of driverApprovalCache) {
    if (entry.until <= now) driverApprovalCache.delete(id);
  }
  const eligible: T[] = [];
  for (let index = 0; index < drivers.length; index += 8) {
    const batch = drivers.slice(index, index + 8);
    const approved = await Promise.all(batch.map((driver) => {
      const id = idOf(driver);
      const cached = driverApprovalCache.get(id);
      if (cached) return cached.result;
      const result = driverCanReceivePayout(id, db).catch(() => false);
      driverApprovalCache.set(id, { until: Date.now() + 30_000, result });
      return result;
    }));
    eligible.push(...batch.filter((_, index) => approved[index]));
  }
  return eligible;
}

function safeOnboardingUrl(value?: string) {
  if (!value || !URL.canParse(value)) return;
  const url = new URL(value);
  const isAsaas = url.hostname === 'asaas.com' || url.hostname.endsWith('.asaas.com');
  if (isAsaas && url.protocol === 'https:' && !url.username && !url.password) return url.href;
}