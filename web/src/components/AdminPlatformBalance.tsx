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
    <section className="form-box" aria-labelledby="platform-finance-title">
      <h2 id="platform-finance-title">Financeiro da plataforma</h2>
      <div aria-live="polite">
        <h3>Saldo disponível para saque</h3>
        {loading ? <p>Consultando saldo…</p> : failed ? <p>O saldo está indisponível. Tente novamente.</p> : result && (
          <>
            <p><strong>{currency.format(result.balance)}</strong></p>
            <p>{result.sandbox ? 'Conta principal do Asaas · Sandbox' : 'Conta principal do Asaas'}</p>
          </>
        )}
      </div>
      <button type="button" className="btn btn-secondary" disabled={loading} onClick={() => {
        setFailed(false);
        setLoading(true);
        setRevision((value) => value + 1);
      }}>Atualizar saldo</button>
    </section>
  );
}
