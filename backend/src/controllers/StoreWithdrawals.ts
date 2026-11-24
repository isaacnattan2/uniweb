import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';

const pageSize = 20;
const sandboxApi = 'https://api-sandbox.asaas.com/v3';
const productionApi = 'https://api.asaas.com/v3';

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

async function readAsaas<T>(base: string, path: string, key: string): Promise<T> {
  const response = await fetch(base + path, {
    headers: { accept: 'application/json', access_token: key, 'User-Agent': 'Uniweb/1.0' },
    signal: AbortSignal.timeout(8000),
    redirect: 'error',
  });
  if (!response.ok) throw new Error('Asaas HTTP ' + response.status);
  return response.json() as Promise<T>;
}

export async function getStoreWithdrawals(req: AuthRequest, res: Response) {
  res.set('Cache-Control', 'no-store');
  if (req.userType !== 'business' || !req.userId) return res.sendStatus(403);

  const offset = Number(req.query.offset ?? 0);
  if ((req.query.offset !== undefined && typeof req.query.offset !== 'string') ||
      !Number.isSafeInteger(offset) || offset < 0 || offset % pageSize !== 0) {
    return res.status(400).json({ error: 'Página inválida.' });
  }

  const storeId = req.params.id.toLowerCase().replace(/-/g, '_');
  const ownerId = req.userId.toLowerCase().replace(/-/g, '_');
  const key = process.env['ASAAS_STORE_API_KEY_' + storeId + '__' + ownerId]?.trim();
  if (!key || key === process.env.ASAAS_API_KEY?.trim()) return res.json({ configured: false });

  const base = process.env.ASAAS_STORE_API_URL?.trim() || sandboxApi;
  if (base !== sandboxApi && base !== productionApi) {
    return res.status(503).json({ error: 'A consulta de saques está indisponível no momento.' });
  }

  try {
    const [balance, transfers] = await Promise.all([
      readAsaas<{ balance: number }>(base, '/finance/balance', key),
      readAsaas<{ data: AsaasTransfer[]; hasMore: boolean }>(base, `/transfers?limit=${pageSize}&offset=${offset}`, key),
    ]);
    if (!Number.isFinite(balance.balance) || !Array.isArray(transfers.data) || typeof transfers.hasMore !== 'boolean') {
      throw new Error('Resposta financeira inválida');
    }
    return res.json({
      configured: true,
      sandbox: base === sandboxApi,
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