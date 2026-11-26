import React, { useEffect, useState } from 'react';
import { useFeedback } from './Feedback';
import axios from 'axios';
import { useSearchParams } from 'react-router-dom';
import { formatOrderCode, getStoreOrders, updateStoreOrder } from '../services/api';
import type { StoreOrder, StoreOrderAction } from '../services/api';
import { OrderStatus } from './OrderStatus';
import '../styles/orders.css';

const amount = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const timestamp = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
const payments: Record<string, string> = { pending: 'Pendente', paid: 'Pago', failed: 'Falhou', refunded: 'Reembolsado' };

export function StoreOrders({ businessId }: { businessId: string }) {
  const [search, setSearch] = useSearchParams();
  const orderId = search.get('order') || undefined;
  const [page, setPage] = useState({ items: [] as StoreOrder[], nextOffset: null as number | null });
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const { confirmAction, showToast } = useFeedback();

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setLoadError('');
    void getStoreOrders(businessId, offset, controller.signal, orderId).then((data) => {
      if (!controller.signal.aborted) setPage(data);
    }).catch(() => {
      if (!controller.signal.aborted) setLoadError('Não foi possível carregar os pedidos da loja.');
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [businessId, offset, revision, orderId]);

  useEffect(() => {
    if (orderId && !loading && !loadError && page.items[0]?.id === orderId) {
      document.getElementById('store-orders-title')?.scrollIntoView();
    }
  }, [orderId, loading, loadError, page]);

  async function changeOrder(order: StoreOrder, action: StoreOrderAction) {
    if (action === 'cancel' && !(await confirmAction({
      title: 'Cancelar pedido?',
      message: order.payment_status === 'paid'
        ? order.dispatch_state ? 'O estorno será solicitado.' : 'O pagamento já foi recebido. O cancelamento não emite estorno automático.'
        : undefined,
      confirmLabel: 'Cancelar pedido', dismissLabel: 'Manter pedido',
    }))) return;
    setActionError('');
    setUpdating(true);
    try {
      await updateStoreOrder(businessId, order.id, action);
      showToast(action === 'requeue' ? 'Pedido confirmado e disponível para entrega.' : 'Pedido cancelado.');
    } catch (error) {
      setActionError(axios.isAxiosError(error) && typeof error.response?.data?.error === 'string'
        ? error.response.data.error : 'Não foi possível atualizar o pedido.');
    } finally {
      setLoading(true);
      setRevision((previous) => previous + 1);
      setUpdating(false);
    }
  }

  const busy = loading || updating;
  return (
    <section className="business-info store-orders" aria-labelledby="store-orders-title" aria-busy={busy}>
      <div className="business-info-heading">
        <h2 id="store-orders-title">Pedidos da loja</h2>
        <button className="btn-secondary" type="button" disabled={busy}
          onClick={() => setRevision((previous) => previous + 1)}>Atualizar pedidos</button>
      </div>
      {actionError && <p role="alert">{actionError}</p>}
      {loadError && <p role="alert">{loadError}</p>}
      {orderId && <button type="button" className="btn-secondary" onClick={() => {
        setOffset(0);
        setSearch((params) => {
          params.delete('order');
          params.set('aba', 'pedidos');
          return params;
        });
      }}>Ver todos os pedidos</button>}
      {loading && <p role="status">Carregando pedidos…</p>}
      {!loading && !loadError && page.items.length === 0 && <p>Nenhum pedido nesta página.</p>}
      {!loadError && page.items.length > 0 && (!orderId || page.items[0].id === orderId) && (
        <ul className="store-order-list list-panel list-panel-inset">
          {page.items.map((order) => {
            const canCancel = ['pending', 'confirmed', 'processing'].includes(order.status) && order.delivery_status !== 'delivered' &&
              (!order.dispatch_state || !['in_transit','incident'].includes(order.dispatch_state));
            const canRequeue = !order.dispatch_state && canCancel && order.payment_status === 'paid' && order.delivery_type === 'delivery' &&
              order.delivery_status === 'cancelled' && order.delivery_assigned;
            return (
              <li key={order.id} className="store-order">
                <div>
                  <h3>Pedido #{formatOrderCode(order.id)}</h3>
                  {order.created_at && <time dateTime={order.created_at}>{timestamp.format(new Date(order.created_at))}</time>}
                </div>
                <div className="store-order-state">
                  <OrderStatus order={order} />
                  <span>Pagamento: {payments[order.payment_status] || order.payment_status}</span>
                  {order.slot_at && order.dispatch_state !== 'cancelled' && (
                    <span>Retirada agendada a partir de {timestamp.format(new Date(order.slot_at))}</span>
                  )}
                  <strong>{amount.format(Number(order.total))}</strong>
                </div>
                <div className="store-order-actions">
                  {canRequeue && <button className="btn-primary" type="button" disabled={busy}
                    onClick={() => void changeOrder(order, 'requeue')}>Confirmar novamente</button>}
                  {canCancel && <button className="btn-secondary store-order-cancel" type="button" disabled={busy}
                    onClick={() => void changeOrder(order, 'cancel')}>Cancelar pedido</button>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {!orderId && (offset > 0 || page.nextOffset !== null) && (
        <nav className="store-order-pagination" aria-label="Páginas de pedidos">
          <button className="btn-secondary" type="button" disabled={busy || offset === 0}
            onClick={() => setOffset((previous) => Math.max(0, previous - 20))}>Anterior</button>
          <button className="btn-secondary" type="button" disabled={busy || page.nextOffset === null}
            onClick={() => { if (page.nextOffset !== null) setOffset(page.nextOffset); }}>Próxima</button>
        </nav>
      )}
    </section>
  );
}
