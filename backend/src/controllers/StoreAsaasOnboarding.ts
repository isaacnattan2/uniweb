import { Response } from 'express';
import { query } from '../config/database';
import { AuthRequest } from '../middleware/auth';
import { AsaasStoreError, asaasStoreRequest, encryptStoreKey, sandboxStoreConfig, storeSandboxApi } from '../services/AsaasStoreAccounts';

function readRegistration(body: Record<string, unknown>) {
  const text = (field: string) => typeof body[field] === 'string' ? (body[field] as string).trim() : '';
  const name = text('name');
  const email = text('email');
  const cpfCnpj = text('cpfCnpj').replace(/[.\-/]/g, '');
  const mobilePhone = text('mobilePhone').replace(/[()\s-]/g, '');
  const postalCode = text('postalCode').replace(/-/g, '');
  const address = text('address');
  const addressNumber = text('addressNumber');
  const province = text('province');
  const complement = text('complement');
  const incomeValue = body.incomeValue;
  const birthDate = text('birthDate');
  const companyType = text('companyType');
  if (!name || name.length > 150 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 255 ||
      !/^(\d{11}|\d{14})$/.test(cpfCnpj) || !/^\d{11}$/.test(mobilePhone) ||
      !/^\d{8}$/.test(postalCode) || !address || !addressNumber || !province ||
      [address, addressNumber, province, complement].some((value) => value.length > 150) ||
      typeof incomeValue !== 'number' || !Number.isFinite(incomeValue) || incomeValue <= 0) return;

  if (cpfCnpj.length === 11) {
    const date = new Date(birthDate);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate) || !Number.isFinite(+date) ||
        date.toISOString().slice(0, 10) !== birthDate || +date >= Date.now()) return;
  } else if (!['MEI', 'LIMITED', 'INDIVIDUAL', 'ASSOCIATION'].includes(companyType)) return;

  return { name, email, cpfCnpj, mobilePhone, postalCode, address, addressNumber, province,
    complement: complement || undefined, incomeValue, ...(cpfCnpj.length === 11 ? { birthDate } : { companyType }) };
}

function describeAsaasRejection(error: AsaasStoreError, submitted: object, parentKey: string) {
  const sensitive = [parentKey, ...Object.values(submitted).filter((value): value is string =>
    typeof value === 'string' && value.length >= 3)].sort((a, b) => b.length - a.length);
  const details = error.details.flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null) return [];
    const { code, description } = entry as Record<string, unknown>;
    const safeCode = typeof code === 'string' && /^[a-z][a-z0-9_]{1,63}$/i.test(code) ? code : undefined;
    if (typeof description !== 'string') return safeCode ? [safeCode] : [];
    let message = description;
    for (const value of sensitive) {
      message = message.replace(new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '[omitido]');
    }
    message = message.replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, '[omitido]')
      .replace(/\b(?:\d[ ./()-]?){8,}\b/g, '[omitido]')
      .replace(/\$aact_[^\s]+/gi, '[omitido]')
      .replace(/https?:\/\/\S+/gi, '[link omitido]')
      .replace(/\s+/g, ' ').trim().slice(0, 240);
    return message ? [message] : safeCode ? [safeCode] : [];
  });
  if (details.length) return 'Asaas (HTTP ' + error.status + '): ' + [...new Set(details)].join(' ');
  switch (error.status) {
    case 401: return 'O Asaas rejeitou a autenticação da conta-pai no Sandbox (HTTP 401).';
    case 403: return 'O Asaas bloqueou a criação da subconta (HTTP 403) e não informou o motivo. Confira as permissões da conta-pai.';
    case 429: return 'O Asaas limitou as solicitações (HTTP 429). Aguarde e tente novamente.';
    default: return 'O Asaas recusou o cadastro (HTTP ' + error.status + '). Confira os dados do titular.';
  }
}

export async function createStoreAsaasAccount(req: AuthRequest, res: Response) {
  res.set('Cache-Control', 'no-store');
  if (req.userType !== 'business' || !req.userId) return res.sendStatus(403);
  const config = sandboxStoreConfig();
  if (!config) return res.status(503).json({ error: 'A criação de subcontas no Sandbox está indisponível.' });
  const registration = readRegistration(req.body ?? {});
  if (!registration) return res.status(400).json({ error: 'Confira os dados cadastrais do titular.' });
  const businessId = req.params.id.toLowerCase();
  const ownerId = req.userId.toLowerCase();
  const ids = [businessId, ownerId];
  const reserved = await query(
    `INSERT INTO asaas_store_accounts (business_id, owner_id)
     SELECT id, owner_id FROM businesses WHERE id = $1 AND owner_id = $2
     ON CONFLICT (business_id, owner_id) DO NOTHING`, ids,
  );
  if (!reserved.rowCount) return res.status(409).json({ error: 'Já existe uma solicitação para esta loja.' });

  try {
    const account = await asaasStoreRequest<{ id: string; walletId: string; apiKey: string }>(
      storeSandboxApi, '/accounts', config.parentKey, registration,
    );
    if (![account.id, account.walletId, account.apiKey].every((value) => typeof value === 'string' && value.trim()) ||
        account.apiKey === config.parentKey) throw new Error('Resposta de criação incompleta');

    await query(
      `UPDATE asaas_store_accounts SET provider_id = $3, wallet_id = $4, encrypted_key = $5, created_at = NOW()
       WHERE business_id = $1 AND owner_id = $2`,
      [...ids, account.id, account.walletId, encryptStoreKey(account.apiKey, config.encryptionKey, businessId, ownerId)],
    );
    return res.sendStatus(201);
  } catch (error) {
    if (error instanceof AsaasStoreError && [400, 401, 403, 422, 429].includes(error.status)) {
      await query('DELETE FROM asaas_store_accounts WHERE business_id = $1 AND owner_id = $2 AND provider_id IS NULL', ids);
      return res.status(error.status === 400 || error.status === 422 ? 422 : 502).json({
        error: describeAsaasRejection(error, registration, config.parentKey),
      });
    }
    return res.status(502).json({ error: 'A criação não pôde ser confirmada. A administração precisa verificar a solicitação no Asaas.' });
  }
}