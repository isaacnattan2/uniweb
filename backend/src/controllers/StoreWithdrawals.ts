import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { asaasStoreRequest, storeSandboxApi } from '../services/AsaasStoreAccounts';
import { readStoreAsaasApproval, resolveStoreAsaasAccount } from '../services/AsaasStoreApproval';

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

  try {
    const account = await resolveStoreAsaasAccount(req.params.id.toLowerCase(), req.userId.toLowerCase());
    const { base, key } = account;
    if (!key) return res.json({ configured: false, canRegister: account.canRegister, registrationPending: account.registrationPending });

    const approval = await readStoreAsaasApproval(base, key, 'merchant', account.createdAt);
    if (approval.general !== 'APPROVED') return res.json({ configured: false, approval });
    const [balance, transfers] = await Promise.all([
      asaasStoreRequest<{ balance: number }>(base, '/finance/balance', key),
      asaasStoreRequest<{ data: AsaasTransfer[]; hasMore: boolean }>(base, `/transfers?limit=${pageSize}&offset=${offset}`, key),
    ]);
    if (!Number.isFinite(balance.balance) || !Array.isArray(transfers.data) || typeof transfers.hasMore !== 'boolean') {
      throw new Error('Resposta financeira inválida');
    }
    return res.json({
      configured: true,
      approval,
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