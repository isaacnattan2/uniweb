import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { getMyOrders, getOrder } from '../services/api';
import '../styles/orders.css';

const paymentLabels: Record<string, string> = { pix: 'Pix', credit_card: 'Cartão de crédito', debit_card: 'Cartão de débito', wallet: 'Carteira' };
const paymentStatusLabels: Record<string, string> = { pending: 'Pendente', paid: 'Pago', failed: 'Falhou', refunded: 'Reembolsado' };
const deliveryLabels: Record<string, string> = { pickup: 'Retirada na loja', delivery: 'Entrega', shipping: 'Envio' };

export function OrdersPage() {
  const navigate = useNavigate();
  const { orderId } = useParams<{ orderId: string }>();
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    async function loadOrders() {
      try {
        setLoading(true);
        setError('');
        const data = orderId ? [await getOrder(orderId)] : await getMyOrders();
        if (active) setOrders(data);
      } catch (err: any) {
        if (active) setError(err.response?.data?.error || 'Erro ao carregar pedidos');
      } finally {
        if (active) setLoading(false);
      }
    }

    loadOrders();
    return () => { active = false; };
  }, [orderId]);

  if (loading) {
    return <div className="container"><p>Carregando pedidos...</p></div>;
  }

  return (
    <div className="orders-page">
      <div className="container">
        {orderId && <button className="page-back" onClick={() => navigate('/orders')}>← Voltar aos pedidos</button>}
        <h1>{orderId ? '📦 Detalhes do pedido' : '📦 Meus Pedidos'}</h1>

        {error && <div className="error-message">{error}</div>}

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
                    <h3>Pedido #{order.id.substring(0, 8).toUpperCase()}</h3>
                    <p className="order-date">
                      {new Date(order.created_at).toLocaleDateString('pt-BR')}
                    </p>
                  </div>
                  <div className={`order-status status-${order.status}`}>
                    {order.status === 'pending' && '⏳ Pendente'}
                    {order.status === 'confirmed' && '✅ Confirmado'}
                    {order.status === 'processing' && '🔄 Processando'}
                    {order.status === 'completed' && '✓ Entregue'}
                    {order.status === 'cancelled' && '❌ Cancelado'}
                  </div>
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

                {orderId && (
                  <div className="order-delivery">
                    <p><strong>Pagamento:</strong> {paymentLabels[order.payment_method] || order.payment_method} — {paymentStatusLabels[order.payment_status] || order.payment_status}</p>
                    <p><strong>Entrega:</strong> {deliveryLabels[order.delivery_type] || order.delivery_type}</p>
                    {order.delivery_address && <p><strong>Endereço:</strong> {order.delivery_address}</p>}
                  </div>
                )}

                <div className="order-footer">
                  <div className="order-total">
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
