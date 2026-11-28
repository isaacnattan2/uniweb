import { useEffect, useState } from 'react';
import { formatOrderCode, getDispatchDebug, type DispatchDebugEvent, type DispatchDebugFilter } from '../services/api';
import { dispatchAuditLabels, dispatchExclusionReasons } from './AdminDriverAudit';

const labels: Record<string, string> = {
  ...dispatchAuditLabels,
  dispatch_attempt_started: 'Tentativa de busca iniciada',
  dispatch_search_cancelled: 'Busca cancelada',
  dispatch_assignment_expired: 'Prazo da alocação expirado',
  dispatch_waiting_for_response: 'Aguardando resposta à oferta',
  dispatch_retry_scheduled: 'Nova tentativa agendada',
  dispatch_offer_declined: 'Oferta recusada',
  dispatch_offer_accepted: 'Oferta aceita',
  dispatch_acceptance_failed: 'Aceite rejeitado na revalidação',
  ride_quote_candidates_evaluated: 'Motoristas avaliados para cotação',
};

function eventOutcome(details: DispatchDebugEvent['details']) {
  switch (details.event) {
    case 'dispatch_attempt_started':
      return details.state === 'offered' ? 'Verificando oferta anterior' :
        details.state === 'assigned' ? 'Verificando prazo da alocação' : 'Buscando candidatos';
    case 'dispatch_candidates_evaluated':
      return details.selectedDriverId ? 'Selecionado para receber a oferta' : 'Nenhum candidato elegível';
    case 'ride_quote_candidates_evaluated':
      return details.selectedDriverId ? 'Motorista usado na estimativa' : 'Nenhum motorista disponível';
    case 'dispatch_offer_created':
      return 'Aguardando aceitação';
    case 'dispatch_offer_conflict':
      return 'Conflito ao criar a oferta';
    case 'dispatch_offer_push':
      return details.acceptedByProvider ? 'Envio aceito pelo OneSignal' : 'Envio sem confirmação do OneSignal';
    case 'dispatch_offer_expired':
      return details.blockedUntil ? 'Sem resposta, com bloqueio de check-in' :
        details.missedAt ? 'Sem resposta, contabilizada como falta' : 'Oferta encerrada sem aceite';
    case 'dispatch_retry_scheduled':
      return details.retryInSeconds ? `Busca será retomada em ${details.retryInSeconds} s` : 'Busca será retomada';
    case 'dispatch_acceptance_failed':
      return details.reason === 'eligibility_changed' ? 'Entregador deixou de atender aos critérios' :
        details.reason === 'driver_unavailable' ? 'Entregador indisponível no aceite' : undefined;
    default:
      return undefined;
  }
}

const clock = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'medium' });

const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

function describeExclusion(reason: string, driverFeeCents: number | undefined, details: DispatchDebugEvent['details']) {
  const label = dispatchExclusionReasons[reason] ?? reason;
  const { customerFeeCents, subsidyCents, maxFeeCents } = details;
  if (reason !== 'fee_over_limit' || driverFeeCents == null || customerFeeCents == null || subsidyCents == null) {
    return label;
  }
  const limitCents = maxFeeCents ?? customerFeeCents + subsidyCents;
  return `${label}: o entregador cobra ${money.format(driverFeeCents / 100)}. ` +
    `Frete do pedido de ${money.format(customerFeeCents / 100)} + subsídio da plataforma de ${money.format(subsidyCents / 100)} ` +
    `= limite de ${money.format(limitCents / 100)}.`;
}

export function AdminDispatchDebug({ filterEnabled, onDisabled }: { filterEnabled: boolean; onDisabled: () => void }) {
  const [filter, setFilter] = useState<DispatchDebugFilter>('all');
  const requestType = filterEnabled ? filter : 'all';
  const [feed, setFeed] = useState<{ filter: DispatchDebugFilter; data: Awaited<ReturnType<typeof getDispatchDebug>> }>();
  const data = feed?.filter === requestType ? feed.data : undefined;
  const events = data?.events;
  const [error, setError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let loading = false;
    async function refresh() {
      if (loading || document.visibilityState !== 'visible') return;
      loading = true;
      try {
        const result = await getDispatchDebug(controller.signal, requestType);
        if (controller.signal.aborted) return;
        if (!result.enabled) {
          onDisabled();
          return;
        }
        setFeed({ filter: requestType, data: result });
        setError(false);
      } catch {
        if (!controller.signal.aborted) setError(true);
      } finally {
        loading = false;
      }
      if (!controller.signal.aborted && document.visibilityState === 'visible') timer = setTimeout(refresh, 2000);
    }
    function refreshOnVisibility() {
      clearTimeout(timer);
      void refresh();
    }
    void refresh();
    document.addEventListener('visibilitychange', refreshOnVisibility);
    return () => {
      controller.abort();
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', refreshOnVisibility);
    };
  }, [onDisabled, requestType]);

  return (
    <section className="admin-dispatch-debug" aria-labelledby="dispatch-debug-heading">
      <h3 id="dispatch-debug-heading">Depuração de solicitações ao vivo</h3>
      {filterEnabled && <div className="form-group">
        <label htmlFor="dispatch-debug-filter">Tipo de solicitação</label>
        <select id="dispatch-debug-filter" value={filter} onChange={(event) => {
          setError(false);
          setFilter(event.target.value as DispatchDebugFilter);
        }}>
          <option value="all">Entregas e corridas</option>
          <option value="delivery">Somente entregas</option>
          <option value="ride">Somente corridas</option>
        </select>
      </div>}
      {error && <p role="status">Falha ao atualizar os eventos. Tentando reconectar.</p>}
      {!error && !events?.length && <p role="status">{events ? 'Aguardando eventos da busca.' : 'Carregando eventos…'}</p>}
      {!!events?.length && <ol className="list-panel list-panel-inset admin-dispatch-events" tabIndex={0} aria-label="Últimos eventos da busca">
        {events.map(({ key, requestType: kind, details, driverName }) => {
          const driverId = details.driverId ?? details.selectedDriverId;
          const driverLabel = kind === 'ride' ? 'Motorista' : 'Entregador';
          const requestLabel = kind === 'ride' ? 'Corrida' : 'Pedido de entrega';
          const reference = details.orderId ? `${requestLabel} #${formatOrderCode(details.orderId)}` : 'Cotação de corrida';
          const outcome = eventOutcome(details);
          const displayName = (id: string) =>
            data?.driverNames?.[id]?.trim() || (id === driverId ? driverName?.trim() : undefined) || 'Nome indisponível';
          return (
            <li key={key}>
              <details>
                <summary>
                  <time dateTime={details.occurredAt}>{clock.format(new Date(details.occurredAt))}</time>
                  {' · '}{labels[details.event] ?? details.event}
                  {' · '}{reference}
                  {driverId && ` · ${driverLabel} ${displayName(driverId)}`}
                  {outcome && ` · ${outcome}`}
                </summary>
                {details.orderId && <p>{requestLabel} {details.orderId} · Ciclo {details.searchCycle ?? '—'}</p>}
                {details.driverId && <p>{driverLabel} {displayName(details.driverId)}</p>}
                {details.acceptedByProvider != null && <p>{details.acceptedByProvider ? 'Envio aceito pelo OneSignal' : 'Envio sem confirmação do OneSignal'}</p>}
                {details.drivers && <>
                  <p>{details.drivers.length} {kind === 'ride' ? 'motoristas avaliados' : 'entregadores avaliados'}</p>
                  {details.selectedDriverId && <p>Selecionado {displayName(details.selectedDriverId)}</p>}
                  <ul>
                    {details.drivers.map((driver) => <li key={driver.driverId}>
                      {displayName(driver.driverId)} · {driver.reasons.length
                        ? driver.reasons.map((reason) => describeExclusion(reason, driver.feeCents, details)).join(' · ')
                        : driver.offeredFeeCents != null && driver.feeCents != null && driver.offeredFeeCents < driver.feeCents
                          ? `Elegível com oferta limitada a ${money.format(driver.offeredFeeCents / 100)} (tarifa de ${money.format(driver.feeCents / 100)})`
                          : 'Elegível'}
                    </li>)}
                  </ul>
                </>}
                <details>
                  <summary>Dados do evento</summary>
                  <pre>{JSON.stringify(details, null, 2)}</pre>
                </details>
              </details>
            </li>
          );
        })}
      </ol>}
    </section>
  );
}
