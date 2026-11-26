import { useEffect, useState } from 'react';
import { getDriverDispatchAudit, formatOrderCode, type AdminDriver, type DriverAuditEntry } from '../services/api';

const labels: Record<string, string> = {
  dispatch_candidates_evaluated: 'Elegibilidade avaliada',
  dispatch_offer_created: 'Oferta criada',
  dispatch_offer_conflict: 'Oferta não criada por conflito',
  dispatch_offer_expired: 'Oferta expirada',
  dispatch_search_expired: 'Busca encerrada por tempo',
  dispatch_offer_push: 'Envio ao OneSignal',
};

const reasons: Record<string, string> = {
  financial_account_missing: 'Cadastro financeiro ausente',
  financial_approval_unavailable: 'Aprovação financeira pendente ou indisponível',
  checkin_blocked: 'Check-in bloqueado',
  offline: 'Sem check-in ativo',
  already_offered: 'Já recebeu oferta nesta tentativa',
  pending_offer: 'Oferta pendente',
  active_delivery: 'Entrega em andamento',
  conflicting_reservation: 'Conflito de horário com outra entrega',
  location_missing_or_stale: 'Localização ausente ou desatualizada',
  shift_unavailable: 'Sem horário de trabalho compatível',
  outside_radius: 'Fora do raio da loja',
  fee_over_limit: 'Frete acima do limite',
  cannot_arrive_in_time: 'Tempo estimado excede o prazo',
};

const dateTime = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'medium' });
const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const date = (value: string) => dateTime.format(new Date(value));

export function AdminDriverAudit({ driver, onClose }: { driver: AdminDriver; onClose: () => void }) {
  const [entries, setEntries] = useState<DriverAuditEntry[]>([]);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [period, setPeriod] = useState<{ start?: string; end?: string }>({});
  const [filterError, setFilterError] = useState('');
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    const controller = new AbortController();
    void getDriverDispatchAudit(driver.id, controller.signal, period)
      .then((data) => { if (!controller.signal.aborted) { setEntries(data); setStatus('ready'); } })
      .catch(() => { if (!controller.signal.aborted) setStatus('error'); });
    return () => controller.abort();
  }, [driver.id, period]);

  return (
    <section className="form-box" aria-labelledby="driver-audit-heading">
      <div className="admin-section-heading">
        <h3 id="driver-audit-heading">Auditoria de {driver.full_name}</h3>
        <div className="card-actions">
          <button className="btn-secondary" type="button" disabled={status === 'loading'}
            onClick={() => { setStatus('loading'); setPeriod((current) => ({ ...current })); }}>Atualizar</button>
          <button className="btn-secondary" type="button" onClick={onClose}>Fechar</button>
        </div>
      </div>
      <form onSubmit={(event) => {
        event.preventDefault();
        const startTime = start ? new Date(start).getTime() : undefined;
        const endTime = end ? new Date(end).getTime() : undefined;
        if ((startTime !== undefined && !Number.isFinite(startTime)) ||
            (endTime !== undefined && !Number.isFinite(endTime)) ||
            (startTime !== undefined && endTime !== undefined && startTime > endTime)) {
          setFilterError('Informe um intervalo válido. O início deve ser anterior ou igual ao fim.');
          return;
        }
        setFilterError('');
        setStatus('loading');
        setPeriod({
          start: startTime === undefined ? undefined : new Date(startTime).toISOString(),
          end: endTime === undefined ? undefined : new Date(endTime + 60_000).toISOString(),
        });
      }}>
        <div className="admin-rate-fields">
          <div className="form-group">
            <label htmlFor="driver-audit-start">Início</label>
            <input id="driver-audit-start" type="datetime-local" value={start} onChange={(event) => setStart(event.target.value)} />
          </div>
          <div className="form-group">
            <label htmlFor="driver-audit-end">Fim</label>
            <input id="driver-audit-end" type="datetime-local" value={end} onChange={(event) => setEnd(event.target.value)} />
          </div>
        </div>
        <div className="card-actions">
          <button className="btn-primary" type="submit">Filtrar</button>
          <button className="btn-secondary" type="button" onClick={() => {
            setStart('');
            setEnd('');
            setFilterError('');
            setStatus('loading');
            setPeriod({});
          }}>Limpar filtro</button>
        </div>
        {filterError && <p role="alert" className="error-message">{filterError}</p>}
      </form>
      {status === 'ready' && entries.length === 50 && <p>Exibindo os 50 registros mais recentes do período.</p>}
      {status === 'loading' && <p role="status">Carregando auditoria…</p>}
      {status === 'error' && <p role="alert" className="error-message">Não foi possível carregar a auditoria.</p>}
      {status === 'ready' && !entries.length && <p>Nenhum registro de auditoria para este entregador no período.</p>}
      {status === 'ready' && entries.length > 0 && (
        <div className="admin-driver-audit-list" role="region" tabIndex={0} aria-labelledby="driver-audit-heading">
          {entries.map(({ id, order_id, search_cycle, created_at, details }) => {
            const { decision } = details;
            return (
              <details key={id} className="admin-seller-shop">
                <summary>{date(created_at)} · Pedido #{formatOrderCode(order_id)} · {labels[details.event] ?? details.event}</summary>
                <div className="admin-seller-shop-details">
                  {search_cycle !== null && <p>Tentativa {search_cycle + 1}</p>}
                  {decision && <p>{decision.reasons.length ? decision.reasons.map((reason) => reasons[reason] ?? reason).join(' · ')
                    : details.selected ? 'Entregador selecionado' : 'Entregador elegível. Outra pessoa ficou em primeiro lugar.'}</p>}
                  {decision?.locationAt && <p>Localização atualizada em {date(decision.locationAt)}</p>}
                  {decision?.pickupMeters != null && <p>Distância para coleta {(decision.pickupMeters / 1000).toLocaleString('pt-BR')} km</p>}
                  {decision?.estimatedMinutes != null && <p>Tempo estimado {decision.estimatedMinutes} min</p>}
                  {details.promisedAt && <p>Prazo da entrega {date(details.promisedAt)}</p>}
                  {details.customerFeeCents != null && details.subsidyCents != null && <p>
                    Frete pago pelo cliente {money.format(details.customerFeeCents / 100)} · Teto de subsídio {money.format(details.subsidyCents / 100)}
                  </p>}
                  {decision?.feeCents != null && details.maxFeeCents != null && <p>Frete {money.format(decision.feeCents / 100)} · Limite {money.format(details.maxFeeCents / 100)}</p>}
                  {details.selected && decision?.offeredFeeCents != null && decision.offeredFeeCents !== decision.feeCents &&
                    <p>Valor oferecido {money.format(decision.offeredFeeCents / 100)}</p>}
                  {details.acceptedByProvider != null && <p>{details.acceptedByProvider ? 'Envio aceito pelo OneSignal' : 'Envio sem confirmação do OneSignal'}</p>}
                  {details.notifiedAt && <p>Envio registrado em {date(details.notifiedAt)}</p>}
                  {details.expiresAt && <p>Oferta expirou em {date(details.expiresAt)}</p>}
                  {details.event === 'dispatch_offer_expired' && <p>{details.missedAt ? 'Contou como oferta sem resposta' : 'A expiração não contou como falta de resposta'}</p>}
                  {details.ignoredOffers != null && <p>Ofertas sem resposta acumuladas {details.ignoredOffers}</p>}
                  {(details.blockedUntil || decision?.blockedUntil) && <p>Fim do bloqueio {date((details.blockedUntil || decision?.blockedUntil)!)}</p>}
                </div>
              </details>
            );
          })}
        </div>
      )}
    </section>
  );
}
