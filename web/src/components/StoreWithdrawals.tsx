import { StoreAsaasApprovalDetails } from './StoreAsaasApprovalDetails';
import { useEffect, useState } from 'react';
import axios from 'axios';
import { StoreAsaasRegistration } from './StoreAsaasRegistration';
import { useFeedback } from './Feedback';
import { getStoreWithdrawals, type StoreWithdrawalsResponse } from '../services/api';

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const date = new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' });
const statuses: Record<string, string> = {
  DONE: 'Realizado',
  PENDING: 'Pendente',
  SCHEDULED: 'Agendado',
  BANK_PROCESSING: 'Em processamento bancário',
  BLOCKED: 'Bloqueado',
  CANCELLED: 'Cancelado',
  FAILED: 'Com falha',
};

function formatDate(value?: string | null) {
  const time = Date.parse(value?.slice(0, 10) ?? '');
  return Number.isFinite(time) ? date.format(time) : '—';
}

export function StoreWithdrawals({ businessId }: { businessId?: string }) {
  const { showToast } = useFeedback();
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);
  const [data, setData] = useState<StoreWithdrawalsResponse>();
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [registering, setRegistering] = useState(false);

  useEffect(() => {
    const request = new AbortController();
    setLoading(true);
    setFailed(false);
    getStoreWithdrawals(businessId, offset, request.signal).then((result) => {
      if (!request.signal.aborted) setData(result);
    }).catch((error: unknown) => {
      if (request.signal.aborted) return;
      const message = axios.isAxiosError(error) && typeof error.response?.data?.error === 'string'
        ? error.response.data.error
        : 'Não foi possível consultar os saques. Tente novamente.';
      setFailed(true);
      showToast(message);
    }).finally(() => {
      if (!request.signal.aborted) setLoading(false);
    });
    return () => request.abort();
  }, [businessId, offset, revision, showToast]);

  return (
    <section className="business-info store-withdrawals" aria-labelledby="store-withdrawals-heading" aria-busy={loading}>
      <div className="business-info-heading">
        <h2 id="store-withdrawals-heading">{businessId ? 'Saques Asaas' : 'Recebimentos e saques Asaas'}</h2>
        <button type="button" className="btn-secondary" disabled={loading} onClick={() => setRevision((value) => value + 1)}>
          Atualizar consulta
        </button>
      </div>
      {loading ? <p role="status">Consultando saques…</p> : failed ? (
        <p>Consulta indisponível. Use Atualizar consulta para tentar novamente.</p>
      ) : data?.configured ? (
        <>
          {data.sandbox && <p><strong>Ambiente de testes do Asaas</strong></p>}
          {data.approval && <StoreAsaasApprovalDetails approval={data.approval} />}
          <p><strong>Saldo disponível na conta Asaas</strong> {currency.format(data.availableBalance)}</p>
          <h3>Histórico de transferências</h3>
          {data.transfers.length === 0 ? <p>Nenhuma transferência nesta página.</p> : (
            <div className="store-withdrawals-table">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Solicitação</th>
                    <th scope="col">Efetivação</th>
                    <th scope="col">Modalidade</th>
                    <th scope="col">Status</th>
                    <th scope="col">Valor</th>
                    <th scope="col">Taxa</th>
                    <th scope="col">Líquido</th>
                  </tr>
                </thead>
                <tbody>
                  {data.transfers.map((transfer) => (
                    <tr key={transfer.id}>
                      <td>{formatDate(transfer.dateCreated)}</td>
                      <td>{formatDate(transfer.effectiveDate)}</td>
                      <td>{transfer.operationType || '—'}</td>
                      <td>{statuses[transfer.status] ?? transfer.status}</td>
                      <td>{currency.format(transfer.value)}</td>
                      <td>{transfer.transferFee == null ? '—' : currency.format(transfer.transferFee)}</td>
                      <td>{transfer.netValue == null ? '—' : currency.format(transfer.netValue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {(data.previousOffset !== null || data.nextOffset !== null) && (
            <div className="store-withdrawals-pages">
              {data.previousOffset !== null && <button type="button" className="btn-secondary" onClick={() => setOffset(data.previousOffset ?? 0)}>Anterior</button>}
              {data.nextOffset !== null && <button type="button" className="btn-secondary" onClick={() => setOffset(data.nextOffset ?? offset)}>Próxima</button>}
            </div>
          )}
        </>
      ) : data?.registrationPending ? (
        <p>A solicitação está em processamento ou precisa de conferência pela administração no Asaas.</p>
      ) : data?.approval ? (
        <StoreAsaasApprovalDetails approval={data.approval} />
      ) : data?.canRegister ? (
        registering ? <StoreAsaasRegistration businessId={businessId} onCreated={() => setRevision((value) => value + 1)} /> : (
          <button type="button" className="btn-primary" onClick={() => setRegistering(true)}>Ativar conta de teste</button>
        )
      ) : <p>A conta Asaas ainda precisa ser vinculada pela administração.</p>}
      <h3>Regras de saque</h3>
      <ul>
        <li>O valor da transferência deve caber no saldo disponível da conta.</li>
        <li>Taxas, limites e eventuais autorizações dependem da conta e da modalidade. Confira as condições na sua conta Asaas antes de transferir.</li>
        <li>Uma transferência só está concluída quando aparece como realizada.</li>
      </ul>
      <p><a href="https://docs.asaas.com/docs/transferencias" target="_blank" rel="noreferrer">Consultar as regras de transferência do Asaas</a></p>
    </section>
  );
}