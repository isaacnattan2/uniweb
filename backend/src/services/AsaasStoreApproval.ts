import { query } from '../config/database';
import { AsaasStoreError, asaasStoreRequest, decryptStoreKey, getSandboxStoreAccount, sandboxStoreConfig, storeProductionApi, storeSandboxApi } from './AsaasStoreAccounts';

interface AsaasDocumentGroup {
  id?: string;
  type?: string;
  status?: string;
  description?: string;
  onboardingUrl?: string;
}

export async function resolveStoreAsaasAccount(businessId: string, ownerId: string) {
  const base = process.env.ASAAS_STORE_API_URL?.trim() || storeSandboxApi;
  if (base !== storeSandboxApi && base !== storeProductionApi) throw new Error('Ambiente Asaas inválido');

  const suffix = [businessId, ownerId].map((id) => id.toLowerCase().replace(/-/g, '_')).join('__');
  const manualKey = process.env['ASAAS_STORE_API_KEY_' + suffix]?.trim();
  if (manualKey && manualKey !== process.env.ASAAS_API_KEY?.trim()) {
    return { base, key: manualKey, canSimulate: false };
  }

  const config = sandboxStoreConfig();
  if (!config) return { base, canRegister: false };
  const account = await getSandboxStoreAccount(businessId, ownerId);
  if (!account) return { base, canRegister: true };
  if (!account.encrypted_key) return { base, registrationPending: true };
  return {
    base,
    key: decryptStoreKey(account.encrypted_key, config.encryptionKey, businessId, ownerId),
    canSimulate: true,
    createdAt: account.created_at,
  };
}

export async function resolveDriverAsaasAccount(driverId: string) {
  const base = process.env.ASAAS_STORE_API_URL?.trim() || storeSandboxApi;
  if (base !== storeSandboxApi && base !== storeProductionApi) throw new Error('Ambiente Asaas inválido');
  const config = sandboxStoreConfig();
  if (!config) return { base, canRegister: false };
  const result = await query(
    `SELECT a.encrypted_key, a.created_at
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
  };
}

export async function readStoreAsaasApproval(base: string, key: string, mode: 'admin' | 'merchant', createdAt?: Date) {
  const { id, general, commercialInfo, bankAccountInfo, documentation } = await asaasStoreRequest<{
    id?: string; general: string; commercialInfo?: string; bankAccountInfo?: string; documentation?: string;
  }>(base, '/myAccount/status/', key);
  if (typeof general !== 'string') throw new Error('Situação Asaas inválida');

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

function safeOnboardingUrl(value?: string) {
  if (!value || !URL.canParse(value)) return;
  const url = new URL(value);
  const isAsaas = url.hostname === 'asaas.com' || url.hostname.endsWith('.asaas.com');
  if (isAsaas && url.protocol === 'https:' && !url.username && !url.password) return url.href;
}