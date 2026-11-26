import { useEffect, useState } from 'react';
import { getPlatformAsaasBalance } from '../services/api';

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export function AdminPlatformBalance() {
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<Awaited<ReturnType<typeof getPlatformAsaasBalance>>>();
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    void getPlatformAsaasBalance(controller.signal).then((data) => {
      if (!controller.signal.aborted) setResult(data);
    }).catch(() => {
      if (!controller.signal.aborted) setFailed(true);
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [revision]);

  return (
    <section aria-labelledby="platform-finance-title">
      <div className="admin-section-heading">
        <h2 id="platform-finance-title">Saldo e Saques</h2>
        <button type="button" className="btn btn-secondary" disabled={loading} onClick={() => {
          setFailed(false);
          setLoading(true);
          setRevision((value) => value + 1);
        }}>Atualizar saldo</button>
      </div>
      <div aria-live="polite">
        <dl className="admin-rate-fields admin-platform-balance">
          <div>
            <dt>Saldo disponível para saque</dt>
            <dd>
              {loading ? 'Consultando saldo…' : failed ? 'O saldo está indisponível. Tente novamente.' :
                result && <strong>{currency.format(result.balance)}</strong>}
            </dd>
          </div>
          {!loading && !failed && result && (
            <div>
              <dt>Conta vinculada</dt>
              <dd>{result.sandbox ? 'Conta principal do Asaas · Sandbox' : 'Conta principal do Asaas'}</dd>
            </div>
          )}
        </dl>
      </div>
    </section>
  );
}
