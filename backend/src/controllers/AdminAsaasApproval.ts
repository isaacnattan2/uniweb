import { Request, Response } from 'express';
import { query } from '../config/database';
import { AsaasStoreError, asaasStoreRequest, storeSandboxApi } from '../services/AsaasStoreAccounts';
import { readStoreAsaasApproval, resolveStoreAsaasAccount } from '../services/AsaasStoreApproval';

export async function adminAsaasApproval(req: Request, res: Response) {
  res.set('Cache-Control', 'no-store');
  const id = req.params.id.toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) {
    return res.status(400).json({ error: 'ID de loja inválido.' });
  }

  const { rows: [business] } = await query('SELECT owner_id FROM businesses WHERE id = $1', [id]);
  if (!business) return res.status(404).json({ error: 'Loja não encontrada.' });

  try {
    const account = await resolveStoreAsaasAccount(id, business.owner_id);
    const sandbox = account.base === storeSandboxApi;
    if (req.method === 'POST' && (!sandbox || !account.canSimulate || !account.key)) {
      return res.status(403).json({ error: 'A simulação só está disponível para subcontas criadas pelo Uniweb no Sandbox.' });
    }
    if (!account.key) return res.json({ sandbox, registrationPending: account.registrationPending });

    if (req.method === 'POST') {
      const current = await asaasStoreRequest<{ general: string }>(storeSandboxApi, '/myAccount/status/', account.key);
      if (current.general !== 'APPROVED') {
        await asaasStoreRequest<unknown>(storeSandboxApi, '/sandbox/myAccount/approve', account.key, {});
      }
    }
    const approval = await readStoreAsaasApproval(account.base, account.key, 'admin', account.createdAt);
    return res.json({ sandbox, approval, canSimulate: Boolean(account.canSimulate && sandbox && approval.general !== 'APPROVED') });
  } catch (error) {
    const detail = error instanceof AsaasStoreError ? ' (HTTP ' + error.status + ')' : '';
    return res.status(502).json({ error: 'Não foi possível concluir a operação no Asaas' + detail + '.' });
  }
}