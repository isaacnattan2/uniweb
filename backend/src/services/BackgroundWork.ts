import { nextDirectCardCheck, reconcileDirectCardPayments } from './AsaasCardPayments';
import { nextDispatchCheck, tickDispatch } from './DeliveryDispatch';
import { nextRefundCheck, reconcileDeliveryRefunds } from './DeliveryRefunds';
import { onWork } from './WorkEvents';

export function startBackgroundWork() {
  schedule('dispatch', tickDispatch, nextDispatchCheck);
  schedule('refunds', reconcileDeliveryRefunds, nextRefundCheck);
  schedule('cards', reconcileDirectCardPayments, nextDirectCardCheck);
}

function schedule(work: Parameters<typeof onWork>[0], run: (triggeredByEvent: boolean) => Promise<void>,
  nextCheck: () => Promise<Date | null>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  let requested = false;
  let retryDelay = 5 * 60_000;

  function arm(delay: number) {
    clearTimeout(timer);
    timer = setTimeout(() => void execute(), Math.min(delay, 2_147_483_647)).unref();
  }

  async function execute() {
    running = true;
    const triggeredByEvent = requested;
    requested = false;
    try {
      await run(triggeredByEvent);
      const next = await nextCheck();
      retryDelay = 5 * 60_000;
      // A job locked by another transaction may still appear due in the snapshot.
      if (next) arm(Math.max(1000, next.getTime() - Date.now()));
    } catch (error) {
      console.error('Falha ao processar trabalho pendente.', work, error);
      arm(retryDelay);
      retryDelay = Math.min(retryDelay * 2, 30 * 60_000);
    } finally {
      running = false;
      if (requested) arm(0);
    }
  }

  onWork(work, () => {
    requested = true;
    if (!running) arm(0);
  });
  arm(0);
}
