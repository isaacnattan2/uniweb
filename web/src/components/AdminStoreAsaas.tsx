import { useEffect, useState } from 'react';
import axios from 'axios';
import { getAdminStoreAsaasAccount, simulateAdminStoreAsaasApproval, type AdminStoreAsaasAccount } from '../services/api';
import { useFeedback } from './Feedback';
import { StoreAsaasApprovalDetails } from './StoreAsaasApprovalDetails';

export function AdminStoreAsaas({ businessId }: { businessId: string }) {
  const { showToast, confirmAction } = useFeedback();
  const [data, setData] = useState<AdminStoreAsaasAccount>();
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [simulating, setSimulating] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const request = new AbortController();
    setLoading(true);
    setFailed(false);
    getAdminStoreAsaasAccount(businessId, request.signal).then((account) => {
      if (!request.signal.aborted) setData(account);
    }).catch((error) => {
      if (!request.signal.aborted) {
        setFailed(true);
        showToast(errorMessage(error));
      }
    }).finally(() => {
      if (!request.signal.aborted) setLoading(false);
    });
    return () => request.abort();
  }, [businessId, revision, showToast]);

  async function simulate() {
    setSimulating(true);
    try {
      if (!await confirmAction({ title: 'Simular a aprovação desta subconta no Sandbox?', confirmLabel: 'Simular aprovação' })) return;
      const account = await simulateAdminStoreAsaasApproval(businessId);
      setData(account);
      showToast(account.approval?.general === 'APPROVED'
        ? 'O Asaas confirmou a aprovação no Sandbox.'
        : 'Simulação enviada. Confira a situação retornada pelo Asaas.');
    } catch (error) {
      showToast(errorMessage(error));
    } finally {
      setSimulating(false);
    }
  }

  return (
    <section id="situacao-asaas" className="business-info store-withdrawals" aria-labelledby="admin-asaas-heading" aria-busy={loading || simulating}>
      <div className="business-info-heading">
        <h2 id="admin-asaas-heading">Cadastro Asaas da loja</h2>
        <button type="button" className="btn-secondary" disabled={loading || simulating} onClick={() => setRevision((value) => value + 1)}>Atualizar consulta</button>
      </div>
      {loading ? <p role="status">Consultando cadastro…</p> : failed ? <p>Consulta indisponível.</p> : (
        <>
          {data?.approval ? (
            <>
              <p><strong>{data.sandbox ? 'Sandbox do Asaas' : 'Produção Asaas'}</strong></p>
              <StoreAsaasApprovalDetails approval={data.approval} admin />
            </>
          ) : data?.registrationPending ? <p>Criação em processamento ou aguardando conferência.</p> : <p>Esta loja ainda não tem uma conta Asaas vinculada.</p>}
          {data?.canSimulate && <button type="button" className="btn-primary" disabled={simulating} onClick={simulate}>Simular aprovação no Sandbox</button>}
        </>
      )}
    </section>
  );
}

function errorMessage(error: unknown) {
  return axios.isAxiosError(error) && typeof error.response?.data?.error === 'string'
    ? error.response.data.error
    : 'Não foi possível consultar o cadastro Asaas.';
}