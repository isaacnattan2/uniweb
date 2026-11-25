import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import type { QueryResult } from 'pg';
import { query } from '../config/database';

export const storeSandboxApi = 'https://api-sandbox.asaas.com/v3';
export const storeProductionApi = 'https://api.asaas.com/v3';

export function sandboxStoreConfig() {
  const parentKey = process.env.ASAAS_API_KEY?.trim();
  const encryptionKey = Buffer.from(process.env.ASAAS_STORE_KEY_ENCRYPTION?.trim() ?? '', 'base64');
  if (process.env.ASAAS_STORE_SANDBOX_ONBOARDING !== 'true' ||
      (process.env.ASAAS_API_URL || storeSandboxApi) !== storeSandboxApi ||
      (process.env.ASAAS_STORE_API_URL || storeSandboxApi) !== storeSandboxApi ||
      !parentKey || encryptionKey.length !== 32) return;
  return { parentKey, encryptionKey };
}

export async function asaasStoreRequest<T>(base: string, path: string, key: string, body?: object): Promise<T> {
  const response = await fetch(base + path, {
    method: body ? 'POST' : 'GET',
    headers: { accept: 'application/json', access_token: key, 'User-Agent': 'Uniweb/1.0',
      ...(body && { 'Content-Type': 'application/json' }) },
    body: body && JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
    redirect: 'error',
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { errors?: unknown; message?: unknown } | null;
    const details = Array.isArray(payload?.errors) ? payload.errors.slice(0, 3) : [];
    if (!details.length && typeof payload?.message === 'string') details.push({ description: payload.message });
    throw new AsaasStoreError(response.status, details);
  }
  if (response.status === 204 || response.headers.get('content-length') === '0') return undefined as T;
  return response.json() as Promise<T>;
}

export class AsaasStoreError extends Error {
  constructor(readonly status: number, readonly details: unknown[] = []) { super('Asaas HTTP ' + status); }
}

export function encryptStoreKey(apiKey: string, secret: Buffer, businessId: string, ownerId: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', secret, iv);
  cipher.setAAD(Buffer.from(businessId + ':' + ownerId));
  const encrypted = Buffer.concat([cipher.update(apiKey, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString('base64')).join('.');
}

export function decryptStoreKey(envelope: string, secret: Buffer, businessId: string, ownerId: string) {
  const [iv, tag, encrypted] = envelope.split('.').map((part) => Buffer.from(part, 'base64'));
  const decipher = createDecipheriv('aes-256-gcm', secret, iv);
  decipher.setAAD(Buffer.from(businessId + ':' + ownerId));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

export type AsaasAccountDatabase = { query: (sql: string, parameters?: unknown[]) => Promise<QueryResult> };

export async function getSandboxStoreAccount(businessId: string, ownerId: string, db: AsaasAccountDatabase = { query }) {
  const result = await db.query(
    'SELECT encrypted_key, created_at, wallet_id FROM asaas_store_accounts WHERE business_id = $1 AND owner_id = $2',
    [businessId, ownerId],
  );
  return result.rows[0] as { encrypted_key: string | null; created_at: Date; wallet_id: string | null } | undefined;
}