import { useEffect, useState } from 'react';
import { formatOrderCode, getDispatchDebug, type DispatchDebugEvent } from '../services/api';
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
};

function eventOutcome(details: DispatchDebugEvent['details']) {
  switch (details.event) {
    case 'dispatch_attempt_started':
      return details.state === 'offered' ? 'Verificando oferta anterior' :
        details.state === 'assigned' ? 'Verificando prazo da alocação' : 'Buscando candidatos';
    case 'dispatch_candidates_evaluated':
      return details.selectedDriverId ? 'Selecionado para receber a oferta' : 'Nenhum candidato elegível';
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

export function AdminDispatchDebug({ onDisabled }: { onDisabled: () => void }) {
  const [feed, setFeed] = useState<Awaited<ReturnType<typeof getDispatchDebug>>>();
  const events = feed?.events;
  const [error, setError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const result = await getDispatchDebug(controller.signal);
        if (controller.signal.aborted) return;
        if (!result.enabled) {
          onDisabled();
          return;
        }
        setFeed(result);
        setError(false);
      } catch {
        if (!controller.signal.aborted) setError(true);
      }
      if (!controller.signal.aborted) timer = setTimeout(refresh, 2000);
    }
    void refresh();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [onDisabled]);

  return (
    <section className="admin-dispatch-debug" aria-labelledby="dispatch-debug-heading">
      <h3 id="dispatch-debug-heading">Busca de entregadores ao vivo</h3>
      {error && <p role="status">Falha ao atualizar os eventos. Tentando reconectar.</p>}
      {!error && !events?.length && <p role="status">{events ? 'Aguardando eventos da busca.' : 'Carregando eventos…'}</p>}
      {!!events?.length && <ol className="list-panel list-panel-inset admin-dispatch-events" tabIndex={0} aria-label="Últimos eventos da busca">
        {events.map(({ key, details, driverName }) => {
          const driverId = details.driverId ?? details.selectedDriverId;
          const outcome = eventOutcome(details);
          const displayName = (id: string) =>
            feed?.driverNames?.[id]?.trim() || (id === driverId ? driverName?.trim() : undefined) || 'Nome indisponível';
          return (
            <li key={key}>
              <details>
                <summary>
                  <time dateTime={details.occurredAt}>{clock.format(new Date(details.occurredAt))}</time>
                  {' · '}{labels[details.event] ?? details.event}
                  {' · Pedido #'}{formatOrderCode(details.orderId)}
                  {driverId ? ` · Entregador ${displayName(driverId)}` : ' · Sem entregador alvo'}
                  {outcome && ` · ${outcome}`}
                </summary>
                <p>Pedido {details.orderId} · Ciclo {details.searchCycle ?? '—'}</p>
                {details.driverId && <p>Entregador {displayName(details.driverId)}</p>}
                {details.acceptedByProvider != null && <p>{details.acceptedByProvider ? 'Envio aceito pelo OneSignal' : 'Envio sem confirmação do OneSignal'}</p>}
                {details.drivers && <>
                  <p>{details.drivers.length} entregadores avaliados</p>
                  {details.selectedDriverId && <p>Selecionado {displayName(details.selectedDriverId)}</p>}
                  <ul>
                    {details.drivers.map((driver) => <li key={driver.driverId}>
                      {displayName(driver.driverId)} · {driver.reasons.length
                        ? driver.reasons.map((reason) => describeExclusion(reason, driver.feeCents, details)).join(' · ')
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
