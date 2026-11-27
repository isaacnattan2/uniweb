import { useEffect, useState } from 'react';
import { getDriverDispatchAudit, formatOrderCode, type AdminDriver, type DriverAuditEntry } from '../services/api';

export const dispatchAuditLabels: Record<string, string> = {
  dispatch_candidates_evaluated: 'Elegibilidade avaliada',
  dispatch_offer_created: 'Oferta criada',
  dispatch_offer_conflict: 'Oferta não criada por conflito',
  dispatch_offer_expired: 'Oferta expirada',
  dispatch_search_expired: 'Busca encerrada por tempo',
  dispatch_offer_push: 'Envio ao OneSignal',
};

export const dispatchExclusionReasons: Record<string, string> = {
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
  app_update_required: 'App sem suporte a múltiplas coletas',
  passenger_vehicle_required: 'Veículo diferente do selecionado para a corrida',
  route_unavailable: 'Rota até a primeira coleta indisponível',
  cannot_arrive_in_time: 'Tempo estimado excede o prazo',
};

const dateTime = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'medium' });
const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const date = (value: string) => dateTime.format(new Date(value));

export function AdminDriverAudit({ driver, drivers, onDriverChange }: {
  driver?: AdminDriver;
  drivers: AdminDriver[];
  onDriverChange: (id: string) => void;
}) {
  const driverId = driver?.id;
  const [entries, setEntries] = useState<DriverAuditEntry[]>([]);
  const [pageSize, setPageSize] = useState(50);
  const [page, setPage] = useState(1);
  const [hasNext, setHasNext] = useState(false);
  const [supportsPagination, setSupportsPagination] = useState(true);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [eventType, setEventType] = useState('');
  const [filters, setFilters] = useState<{ start?: string; end?: string; eventType?: string }>({});
  const [filterError, setFilterError] = useState('');
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    if (!driverId) return;
    setStatus('loading');
    const controller = new AbortController();
    void getDriverDispatchAudit(driverId, controller.signal, { ...filters, page, pageSize })
      .then((data) => {
        if (controller.signal.aborted) return;
        setEntries(data.entries);
        setHasNext(data.hasNext);
        setSupportsPagination(data.supportsPagination);
        if (!data.supportsPagination) {
          setPage(1);
          setPageSize(50);
        }
        setStatus('ready');
      })
      .catch(() => { if (!controller.signal.aborted) setStatus('error'); });
    return () => controller.abort();
  }, [driverId, filters, page, pageSize]);

  return (
    <div className="admin-driver-audit">
      <form onSubmit={(event) => {
        event.preventDefault();
        if (!driverId) return;
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
        setPage(1);
        setFilters({
          start: startTime === undefined ? undefined : new Date(startTime).toISOString(),
          end: endTime === undefined ? undefined : new Date(endTime + 60_000).toISOString(),
          eventType: eventType || undefined,
        });
      }}>
        <div className="admin-rate-fields">
          <div className="form-group">
            <label htmlFor="audit-driver">Entregador</label>
            <select id="audit-driver" value={driverId ?? ''} onChange={(event) => {
              setStatus('loading');
              setPage(1);
              onDriverChange(event.target.value);
            }}>
              <option value="">Selecione um entregador</option>
              {drivers.map((item) => <option key={item.id} value={item.id}>{item.full_name}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label htmlFor="driver-audit-start">Início</label>
            <input id="driver-audit-start" type="datetime-local" value={start} disabled={!driverId} onChange={(event) => setStart(event.target.value)} />
          </div>
          <div className="form-group">
            <label htmlFor="driver-audit-end">Fim</label>
            <input id="driver-audit-end" type="datetime-local" value={end} disabled={!driverId} onChange={(event) => setEnd(event.target.value)} />
          </div>
          <div className="form-group">
            <label htmlFor="driver-audit-event-type">Tipo de evento</label>
            <select id="driver-audit-event-type" value={eventType} disabled={!driverId} onChange={(event) => setEventType(event.target.value)}>
              <option value="">Todos os tipos</option>
              {Object.entries(dispatchAuditLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label htmlFor="driver-audit-page-size">Registros por página</label>
            <select id="driver-audit-page-size" value={pageSize} disabled={!supportsPagination} onChange={(event) => {
              setPageSize(Number(event.target.value));
              setPage(1);
              if (driverId) setStatus('loading');
            }}>
              {[50, 100, 200, 500].map((size) => <option key={size} value={size}>{size}</option>)}
            </select>
          </div>
        </div>
        <div className="card-actions admin-driver-audit-actions">
          <button className="btn-primary" type="submit" disabled={!driverId}>Filtrar</button>
          <button className="btn-secondary" type="button" disabled={!driverId} onClick={() => {
            setStart('');
            setEnd('');
            setEventType('');
            setFilterError('');
            setStatus('loading');
            setPage(1);
            setFilters({});
          }}>Limpar filtro</button>
          <button className="btn-secondary" type="button" disabled={!driverId || status === 'loading'}
            onClick={() => { setStatus('loading'); setFilters((current) => ({ ...current })); }}>Atualizar</button>
        </div>
        {filterError && <p role="alert" className="error-message">{filterError}</p>}
      </form>
      {driverId && <>
      {status === 'loading' && <p role="status">Carregando auditoria…</p>}
      {status === 'ready' && !supportsPagination && <p role="status">
        Exibindo até 50 registros. Atualize o backend para habilitar a paginação.
      </p>}
      {status === 'error' && <p role="alert" className="error-message">Não foi possível carregar a auditoria.</p>}
      {status === 'ready' && !entries.length && <p>{page === 1
        ? 'Nenhum registro de auditoria para este entregador com os filtros aplicados.'
        : 'Nenhum registro nesta página.'}</p>}
      {status === 'ready' && entries.length > 0 && (
        <div className="admin-driver-audit-list list-panel list-panel-inset"
          role="region" aria-label="Registros da auditoria" tabIndex={0}>
          {entries.map(({ id, order_id, search_cycle, created_at, details }) => {
            const { decision } = details;
            return (
              <details key={id}>
                <summary>{date(created_at)} · Pedido #{formatOrderCode(order_id)} · {dispatchAuditLabels[details.event] ?? details.event}</summary>
                <div className="admin-seller-shop-details">
                  {search_cycle !== null && <p>Tentativa {search_cycle + 1}</p>}
                  {decision && <p>{decision.reasons.length ? decision.reasons.map((reason) => dispatchExclusionReasons[reason] ?? reason).join(' · ')
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
      {(page > 1 || (status === 'ready' && hasNext)) && (
        <nav className="card-actions admin-driver-audit-actions" aria-label="Paginação da auditoria">
          <button className="btn-secondary" type="button" disabled={page === 1 || status === 'loading'}
            onClick={() => { setStatus('loading'); setPage(page - 1); }}>Anterior</button>
          <span aria-live="polite">Página {page}</span>
          <button className="btn-secondary" type="button" disabled={status !== 'ready' || !hasNext}
            onClick={() => { setStatus('loading'); setPage(page + 1); }}>Próxima</button>
        </nav>
      )}
      </>}
    </div>
  );
}
