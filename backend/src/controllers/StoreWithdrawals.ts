import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { asaasStoreRequest, decryptStoreKey, getSandboxStoreAccount, sandboxStoreConfig, storeProductionApi, storeSandboxApi } from '../services/AsaasStoreAccounts';

const pageSize = 20;

interface AsaasTransfer {
  id: string;
  status: string;
  value: number;
  netValue?: number | null;
  transferFee?: number | null;
  dateCreated: string;
  effectiveDate?: string | null;
  operationType?: string | null;
}

export async function getStoreWithdrawals(req: AuthRequest, res: Response) {
  res.set('Cache-Control', 'no-store');
  if (req.userType !== 'business' || !req.userId) return res.sendStatus(403);

  const offset = Number(req.query.offset ?? 0);
  if ((req.query.offset !== undefined && typeof req.query.offset !== 'string') ||
      !Number.isSafeInteger(offset) || offset < 0 || offset % pageSize !== 0) {
    return res.status(400).json({ error: 'Página inválida.' });
  }

  const businessId = req.params.id.toLowerCase();
  const ownerId = req.userId.toLowerCase();
  const configuredKey = process.env['ASAAS_STORE_API_KEY_' + businessId.replace(/-/g, '_') + '__' + ownerId.replace(/-/g, '_')]?.trim();
  const base = process.env.ASAAS_STORE_API_URL?.trim() || storeSandboxApi;
  if (base !== storeSandboxApi && base !== storeProductionApi) {
    return res.status(503).json({ error: 'A consulta de saques está indisponível no momento.' });
  }

  let key = configuredKey === process.env.ASAAS_API_KEY?.trim() ? undefined : configuredKey;
  const config = sandboxStoreConfig();
  try {
    if (!key && config) {
      const account = await getSandboxStoreAccount(businessId, ownerId);
      if (!account) return res.json({ configured: false, canRegister: true });
      if (!account.encrypted_key) return res.json({ configured: false, registrationPending: true });
      key = decryptStoreKey(account.encrypted_key, config.encryptionKey, businessId, ownerId);
      const status = await asaasStoreRequest<{ general: string }>(base, '/myAccount/status', key);
      if (status.general !== 'APPROVED') {
        let onboardingUrls: string[] = [];
        if (Date.now() - account.created_at.getTime() >= 15000) {
          const { data } = await asaasStoreRequest<{ data?: { onboardingUrl?: string }[] }>(base, '/myAccount/documents', key);
          onboardingUrls = [...new Set((data ?? []).flatMap(({ onboardingUrl }) => {
            if (!onboardingUrl || !URL.canParse(onboardingUrl)) return [];
            const url = new URL(onboardingUrl);
            const isAsaas = url.hostname === 'asaas.com' || url.hostname.endsWith('.asaas.com');
            return isAsaas && url.protocol === 'https:' && !url.username && !url.password ? [url.href] : [];
          }))];
        }
        return res.json({ configured: false, approval: status.general, onboardingUrls });
      }
    }
    if (!key) return res.json({ configured: false });
    const [balance, transfers] = await Promise.all([
      asaasStoreRequest<{ balance: number }>(base, '/finance/balance', key),
      asaasStoreRequest<{ data: AsaasTransfer[]; hasMore: boolean }>(base, `/transfers?limit=${pageSize}&offset=${offset}`, key),
    ]);
    if (!Number.isFinite(balance.balance) || !Array.isArray(transfers.data) || typeof transfers.hasMore !== 'boolean') {
      throw new Error('Resposta financeira inválida');
    }
    return res.json({
      configured: true,
      sandbox: base === storeSandboxApi,
      availableBalance: balance.balance,
      previousOffset: offset > 0 ? Math.max(0, offset - pageSize) : null,
      nextOffset: transfers.hasMore ? offset + pageSize : null,
      transfers: transfers.data.map(({ id, status, value, netValue, transferFee, dateCreated, effectiveDate, operationType }) => ({
        id, status, value, netValue, transferFee, dateCreated, effectiveDate, operationType,
      })),
    });
  } catch {
    return res.status(502).json({ error: 'Não foi possível consultar os saques no Asaas. Tente novamente.' });
  }
}