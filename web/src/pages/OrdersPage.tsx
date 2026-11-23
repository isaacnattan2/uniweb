import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { cancelMyOrder, formatOrderCode, getMyOrders, getOrder } from '../services/api';
import { useCartStore } from '../context/store';
import { OrderStatus } from '../components/OrderStatus';
import { LiveDelivery } from '../components/LiveDelivery';
import { DeliveryAlternatives } from '../components/DeliveryAlternatives';
import '../styles/orders.css';

const paymentLabels: Record<string, string> = { pix: 'Pix', credit_card: 'Cartão de crédito', debit_card: 'Cartão de débito', wallet: 'Carteira' };
const paymentStatusLabels: Record<string, string> = { pending: 'Pendente', paid: 'Pago', failed: 'Falhou', refunded: 'Reembolsado' };
const deliveryLabels: Record<string, string> = { pickup: 'Retirada na loja', delivery: 'Entrega', shipping: 'Envio' };
const dispatchLabels: Record<string, string> = {
  payment_pending: 'Aguardando confirmação do pagamento',
  scheduled: 'Entrega agendada',
  searching: 'Buscando um entregador',
  offered: 'Aguardando aceite do entregador',
  assigned: 'Entregador confirmado',
  in_transit: 'Entrega em andamento',
  incident: 'O suporte está verificando um imprevisto na entrega',
  delivered: 'Entrega concluída',
  cancelled: 'Entrega cancelada',
};
const refundLabels: Record<string, string> = {
  pending: 'Estorno solicitado', processing: 'Estorno em processamento', review: 'Estorno em análise', refunded: 'Estorno concluído',
};

export function OrdersPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const checkoutResult = searchParams.get('checkout');
  const hasCartItems = useCartStore((state) => state.items.length > 0);
  const { orderId } = useParams<{ orderId: string }>();
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [trackingOrder, setTrackingOrder] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [cancellationError, setCancellationError] = useState('');
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let active = true;
    let requesting = false;
    async function loadOrders(initial = false) {
      if (requesting) return;
      requesting = true;
      try {
        if (initial) {
          setLoading(true);
          setError('');
        }
        const data = orderId ? [await getOrder(orderId)] : await getMyOrders();
        if (active) {
          setOrders(data);
          setError('');
        }
      } catch (err: any) {
        if (active && initial) setError(err.response?.data?.error || 'Erro ao carregar pedidos');
      } finally {
        requesting = false;
        if (active && initial) setLoading(false);
      }
    }

    function refreshVisibleOrders() {
      if (document.visibilityState === 'visible') void loadOrders();
    }
    void loadOrders(true);
    const interval = window.setInterval(refreshVisibleOrders, 15000);
    document.addEventListener('visibilitychange', refreshVisibleOrders);
    return () => {
      active = false;
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', refreshVisibleOrders);
    };
  }, [orderId, revision]);

  async function cancelOrder(order: { id: string; payment_status: string; dispatch_state?: string }) {
    const message = order.payment_status === 'paid'
      ? order.dispatch_state ? 'Cancelar o pedido e solicitar o estorno?' : 'Cancelar este pedido? O cancelamento não emite estorno automático.'
      : 'Cancelar este pedido?';
    if (cancellingId || !window.confirm(message)) return;
    setCancellationError('');
    setCancellingId(order.id);
    try {
      await cancelMyOrder(order.id);
      setTrackingOrder((current) => current === order.id ? null : current);
      setRevision((current) => current + 1);
    } catch (err) {
      setCancellationError(axios.isAxiosError(err) && typeof err.response?.data?.error === 'string'
        ? err.response.data.error : 'Não foi possível cancelar o pedido. Tente novamente.');
    } finally {
      setCancellingId(null);
    }
  }

  if (loading) {
    return <div className="container"><p>Carregando pedidos...</p></div>;
  }

  return (
    <div className="orders-page">
      <div className="container">
        {orderId && <button className="page-back" onClick={() => navigate('/orders')}>← Voltar aos pedidos</button>}
        <h1>{orderId ? '📦 Detalhes do pedido' : '📦 Meus Pedidos'}</h1>

        {checkoutResult === 'success' && <p role="status">Consulte abaixo a confirmação do pagamento. Atualize a página se o status ainda estiver pendente.</p>}
        {checkoutResult === 'cancelled' && <p role="status">Você saiu da página de pagamento. Consulte o status nos detalhes do pedido.</p>}
        {checkoutResult === 'expired' && <p role="status">O prazo de pagamento terminou.</p>}
        {checkoutResult && hasCartItems && (
          <button type="button" className="btn-primary" onClick={() => navigate('/cart')}>Voltar ao carrinho para pagar outra loja</button>
        )}
        {error && <div className="error-message">{error}</div>}
        {cancellationError && <div className="error-message" role="alert">{cancellationError}</div>}

        {!error && (orders.length === 0 ? (
          <div className="empty-state">
            <p>Você ainda não fez nenhum pedido</p>
            <button onClick={() => navigate('/shop')} className="btn-primary">
              Ir para a Loja
            </button>
          </div>
        ) : (
          <div className="orders-list">
            {orders.map((order) => (
              <div key={order.id} className="order-card">
                <div className="order-header">
                  <div>
                    <h3>Pedido #{formatOrderCode(order.id)}</h3>
                    <p className="order-date">
                      {orderId && 'Pedido realizado em '}
                      {new Date(order.created_at).toLocaleString('pt-BR', {
                        dateStyle: 'short', timeStyle: 'short',
                      })}
                    </p>
                  </div>
                  <OrderStatus order={order} />
                </div>

                <div className="order-items">
                  <h4>Itens:</h4>
                  <ul>
                    {order.items?.map((item: any, idx: number) => (
                      <li key={idx}>
                        {item.productName} x{item.quantity} - R$ {Number(item.unitPrice).toFixed(2)}
                      </li>
                    ))}
                  </ul>
                </div>

                {!orderId && <p>Pagamento: {paymentStatusLabels[order.payment_status] || order.payment_status}</p>}
                {order.dispatch_state && dispatchLabels[order.dispatch_state] && <p role="status">{dispatchLabels[order.dispatch_state]}</p>}
                {order.refund_state && <p role="status">{refundLabels[order.refund_state]}</p>}
                {!!order.slot_at && !['needs_choice','cancelled'].includes(order.dispatch_state) &&
                  <p>Entrega a partir de {new Date(order.slot_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</p>}
                {order.payment_status === 'paid' && order.promised_at && ['scheduled','searching','offered','assigned','in_transit'].includes(order.dispatch_state) &&
                  <p>Previsão até {new Date(order.promised_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</p>}
                {order.dispatch_state === 'needs_choice' && order.payment_status === 'paid' && (
                  <DeliveryAlternatives orderId={order.id} onChanged={() => setRevision((current) => current + 1)} />
                )}
                {orderId && (
                  <div className="order-delivery">
                    <p><strong>Pagamento:</strong> {paymentLabels[order.payment_method] || order.payment_method} — {paymentStatusLabels[order.payment_status] || order.payment_status}</p>
                    {order.payment_method === 'credit_card' && order.installment_count != null && (
                      <p><strong>Parcelamento:</strong> {order.installment_count === 1 ? 'À vista (1×)' : order.installment_count + '×'}</p>
                    )}
                    <p><strong>Entrega:</strong> {deliveryLabels[order.delivery_type] || order.delivery_type}</p>
                    {order.delivery_address && <p><strong>Endereço:</strong> {order.delivery_address}</p>}
                    {order.delivery_confirmation_code && (
                      <div className="order-confirmation-code">
                        <p><strong>Código de entrega</strong></p>
                        <strong className="order-code-digits">{order.delivery_confirmation_code}</strong>
                        <p>Informe este código ao entregador somente ao receber seu pedido.</p>
                      </div>
                    )}
                  </div>
                )}

                {order.delivery_type === 'delivery' && order.status !== 'cancelled' &&
                  (order.dispatch_state ? order.dispatch_state === 'in_transit' : ['processing', 'in_transit'].includes(order.delivery_status)) && (
                  <div className="order-tracking">
                    <button type="button" className="btn-secondary"
                      aria-expanded={trackingOrder === order.id} aria-controls={'tracking-' + order.id}
                      onClick={() => setTrackingOrder((current) => current === order.id ? null : order.id)}>
                      {trackingOrder === order.id ? 'Fechar acompanhamento' : 'Entrega em tempo real'}
                    </button>
                    {trackingOrder === order.id && <LiveDelivery key={order.id} orderId={order.id} panelId={'tracking-' + order.id} />}
                  </div>
                )}

                <div className="order-footer">
                  {order.status !== 'cancelled' && !['in_transit','incident','delivered'].includes(order.dispatch_state) &&
                    <button type="button" className="btn-secondary"
                    disabled={cancellingId !== null} onClick={() => void cancelOrder(order)}>
                    {cancellingId === order.id ? 'Cancelando…' : 'Cancelar pedido'}
                  </button>}
                  {orderId && order.checkoutUrl && <a href={order.checkoutUrl} className="btn-secondary">Continuar pagamento</a>}
                  <div className="order-total">
                    {order.dispatch_state && <p>Frete: R$ {Number(order.delivery_fee).toFixed(2)}</p>}
                    {orderId && Number(order.discount) > 0 && (
                      <>
                        <p>Subtotal: R$ {Number(order.subtotal).toFixed(2)}</p>
                        <p>Desconto{order.coupon_code ? ' (' + order.coupon_code + ')' : ''}: − R$ {Number(order.discount).toFixed(2)}</p>
                      </>
                    )}
                    <strong>Total: R$ {Number(order.total_amount).toFixed(2)}</strong>
                  </div>
                  {!orderId && <button
                    onClick={() => navigate(`/order/${order.id}`)}
                    className="btn-secondary"
                  >
                    Ver Detalhes →
                  </button>}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
