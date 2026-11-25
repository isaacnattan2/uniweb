import type { Request, Response } from 'express';
import { asaasStoreRequest, storeProductionApi, storeSandboxApi } from '../services/AsaasStoreAccounts';

export async function getAdminAsaasBalance(_req: Request, res: Response) {
  res.set('Cache-Control', 'no-store');
  const base = process.env.ASAAS_API_URL?.trim() || storeSandboxApi;
  const key = process.env.ASAAS_API_KEY?.trim();
  if (!key || (base !== storeSandboxApi && base !== storeProductionApi)) {
    return res.status(503).json({ error: 'Configure a conta principal do Asaas para consultar o saldo.' });
  }

  try {
    const { balance } = await asaasStoreRequest<{ balance: number }>(base, '/finance/balance', key);
    if (typeof balance !== 'number' || !Number.isFinite(balance)) throw new Error('Invalid Asaas balance');
    return res.json({ balance, sandbox: base === storeSandboxApi });
  } catch {
    return res.status(502).json({ error: 'Não foi possível consultar o saldo da plataforma no Asaas.' });
  }
}
