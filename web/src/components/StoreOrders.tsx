import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { getStoreOrders, updateStoreOrder } from '../services/api';
import type { StoreOrder, StoreOrderAction } from '../services/api';
import { OrderStatus } from './OrderStatus';
import '../styles/orders.css';

const amount = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const timestamp = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
const payments: Record<string, string> = { pending: 'Pendente', paid: 'Pago', failed: 'Falhou', refunded: 'Reembolsado' };

export function StoreOrders({ businessId }: { businessId: string }) {
  const [page, setPage] = useState({ items: [] as StoreOrder[], nextOffset: null as number | null });
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setLoadError('');
    void getStoreOrders(businessId, offset, controller.signal).then((data) => {
      if (!controller.signal.aborted) setPage(data);
    }).catch(() => {
      if (!controller.signal.aborted) setLoadError('Não foi possível carregar os pedidos da loja.');
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [businessId, offset, revision]);

  async function changeOrder(order: StoreOrder, action: StoreOrderAction) {
    if (action === 'cancel' && !window.confirm(order.payment_status === 'paid'
      ? 'Cancelar este pedido? O pagamento já foi recebido e o cancelamento não emite estorno automático.'
      : 'Cancelar este pedido?')) return;
    setActionError('');
    setNotice('');
    setUpdating(true);
    try {
      await updateStoreOrder(businessId, order.id, action);
      setNotice(action === 'requeue' ? 'Pedido confirmado e disponível para entrega.' : 'Pedido cancelado.');
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
      {notice && <p role="status">{notice}</p>}
      {actionError && <p role="alert">{actionError}</p>}
      {loadError && <p role="alert">{loadError}</p>}
      {loading && <p role="status">Carregando pedidos…</p>}
      {!loading && !loadError && page.items.length === 0 && <p>Nenhum pedido nesta página.</p>}
      {!loadError && page.items.length > 0 && (
        <ul className="store-order-list">
          {page.items.map((order) => {
            const canCancel = ['pending', 'confirmed', 'processing'].includes(order.status) && order.delivery_status !== 'delivered';
            const canRequeue = canCancel && order.payment_status === 'paid' && order.delivery_type === 'delivery' &&
              order.delivery_status === 'cancelled' && order.delivery_assigned;
            return (
              <li key={order.id} className="store-order">
                <div>
                  <h3>Pedido #{order.order_number || order.id.slice(0, 8).toUpperCase()}</h3>
                  {order.created_at && <time dateTime={order.created_at}>{timestamp.format(new Date(order.created_at))}</time>}
                </div>
                <div className="store-order-state">
                  <OrderStatus order={order} />
                  <span>Pagamento: {payments[order.payment_status] || order.payment_status}</span>
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
      {(offset > 0 || page.nextOffset !== null) && (
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
