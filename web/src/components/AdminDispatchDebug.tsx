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

const clock = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'medium' });

export function AdminDispatchDebug({ onDisabled }: { onDisabled: () => void }) {
  const [events, setEvents] = useState<DispatchDebugEvent[]>();
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
        setEvents(result.events);
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
        {events.map(({ key, details }) => (
          <li key={key}>
            <details>
              <summary>
                <time dateTime={details.occurredAt}>{clock.format(new Date(details.occurredAt))}</time>
                {' · '}{labels[details.event] ?? details.event}
                {' · Pedido #'}{formatOrderCode(details.orderId)}
              </summary>
              <p>Pedido {details.orderId} · Ciclo {details.searchCycle ?? '—'}</p>
              {details.driverId && <p>Entregador {details.driverId}</p>}
              {details.acceptedByProvider != null && <p>{details.acceptedByProvider ? 'Envio aceito pelo OneSignal' : 'Envio sem confirmação do OneSignal'}</p>}
              {details.drivers && <>
                <p>{details.drivers.length} entregadores avaliados</p>
                {details.selectedDriverId && <p>Selecionado {details.selectedDriverId}</p>}
                <ul>
                  {details.drivers.map((driver) => <li key={driver.driverId}>
                    {driver.driverId} · {driver.reasons.length
                      ? driver.reasons.map((reason) => dispatchExclusionReasons[reason] ?? reason).join(', ')
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
        ))}
      </ol>}
    </section>
  );
}
