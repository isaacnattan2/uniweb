import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createOrder } from '../services/api';
import { useCartStore, useAuthStore } from '../context/store';
import '../styles/cart.css';

export function CartPage() {
  const navigate = useNavigate();
  const cart = useCartStore((state) => state.items);
  const getTotal = useCartStore((state) => state.getTotal);
  const removeFromCart = useCartStore((state) => state.removeFromCart);
  const updateQuantity = useCartStore((state) => state.updateQuantity);
  const clearCart = useCartStore((state) => state.clearCart);
  const { userId, token, userType } = useAuthStore();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('');
  const [deliveryType, setDeliveryType] = useState('');
  const [deliveryAddress, setDeliveryAddress] = useState('');

  const total = getTotal();
  const storeCount = new Set(cart.map((item) => item.businessId)).size;

  async function handleCheckout() {
    if (!token || !userId) {
      navigate('/login', { state: { from: '/cart' } });
      return;
    }
    if (userType !== 'customer') {
      setError('Entre com uma conta de cliente para finalizar a compra.');
      return;
    }
    if (paymentMethod !== 'pix' && paymentMethod !== 'credit_card' && paymentMethod !== 'debit_card' && paymentMethod !== 'wallet') {
      setError('Selecione uma forma de pagamento.');
      return;
    }
    if (deliveryType !== 'pickup' && deliveryType !== 'delivery' && deliveryType !== 'shipping') {
      setError('Selecione uma forma de entrega.');
      return;
    }
    if (deliveryType !== 'pickup' && !deliveryAddress.trim()) {
      setError('Informe o endereço de entrega.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const items = cart.map((item) => ({
        productId: item.productId,
        quantity: item.quantity,
        price: item.price,
      }));

      const { orderIds } = await createOrder(items, paymentMethod, deliveryType, deliveryAddress.trim());
      clearCart();
      alert(`${orderIds.length === 1 ? 'Pedido criado' : `${orderIds.length} pedidos criados`}. Pagamento pendente: nenhuma cobrança foi realizada.`);
      navigate('/orders');
    } catch (err: any) {
      setError(err.response?.data?.error || 'Erro ao criar pedido');
    } finally {
      setLoading(false);
    }
  }

  if (cart.length === 0) {
    return (
      <div className="cart-page">
        <div className="container">
          <h1>🛒 Meu Carrinho</h1>
          <div className="empty-cart">
            <p>Seu carrinho está vazio</p>
            <button onClick={() => navigate('/shop')} className="btn-primary">
              Voltar às Compras
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="cart-page">
      <div className="container">
        <h1>🛒 Meu Carrinho ({cart.length} itens)</h1>

        {error && <div className="error-message" role="alert">{error}</div>}

        <div className="cart-content">
          <div className="cart-items">
            <table>
              <thead>
                <tr>
                  <th>Produto</th>
                  <th>Loja</th>
                  <th>Preço</th>
                  <th>Quantidade</th>
                  <th>Subtotal</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {cart.map((item) => (
                  <tr key={item.productId}>
                    <td>{item.name}</td>
                    <td>{item.businessName || 'Loja'}</td>
                    <td>R$ {Number(item.price).toFixed(2)}</td>
                    <td>
                      <div className="quantity-control">
                        <button disabled={loading} aria-label={`Diminuir quantidade de ${item.name}`} onClick={() => updateQuantity(item.productId, item.quantity - 1)}>-</button>
                        <input
                          type="number"
                          min="1"
                          step="1"
                          disabled={loading}
                          value={item.quantity}
                          onChange={(e) => {
                            const quantity = Number(e.target.value);
                            if (Number.isInteger(quantity) && quantity > 0) updateQuantity(item.productId, quantity);
                          }}
                          aria-label={`Quantidade de ${item.name}`}
                        />
                        <button disabled={loading} aria-label={`Aumentar quantidade de ${item.name}`} onClick={() => updateQuantity(item.productId, item.quantity + 1)}>+</button>
                      </div>
                    </td>
                    <td>R$ {(item.price * item.quantity).toFixed(2)}</td>
                    <td>
                      <button
                        onClick={() => removeFromCart(item.productId)}
                        disabled={loading}
                        className="btn-remove"
                        aria-label={`Remover ${item.name}`}
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="cart-summary">
            <div className="summary-box">
              <h3>Resumo da Compra</h3>
              <div className="summary-row">
                <span>Itens:</span>
                <span>{cart.length}</span>
              </div>
              <div className="summary-row">
                <span>Subtotal:</span>
                <span>R$ {total.toFixed(2)}</span>
              </div>
              <div className="summary-row">
                <span>Frete:</span>
                <span>Não calculado</span>
              </div>
              <div className="summary-row total">
                <span>Total:</span>
                <span>R$ {total.toFixed(2)}</span>
              </div>

              {token && userType === 'customer' && (
                <div className="checkout-options">
                  {storeCount > 1 && <p>Será criado um pedido separado para cada loja.</p>}
                  <label htmlFor="payment-method">Forma de pagamento</label>
                  <select id="payment-method" value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)} disabled={loading}>
                    <option value="">Selecione</option>
                    <option value="pix">Pix</option>
                    <option value="credit_card">Cartão de crédito</option>
                    <option value="debit_card">Cartão de débito</option>
                    <option value="wallet">Carteira</option>
                  </select>
                  <label htmlFor="delivery-type">Forma de entrega</label>
                  <select id="delivery-type" value={deliveryType} onChange={(event) => setDeliveryType(event.target.value)} disabled={loading}>
                    <option value="">Selecione</option>
                    <option value="pickup">Retirada na loja</option>
                    <option value="delivery">Entrega</option>
                    <option value="shipping">Envio</option>
                  </select>
                  {(deliveryType === 'delivery' || deliveryType === 'shipping') && (
                    <>
                      <label htmlFor="delivery-address">Endereço de entrega</label>
                      <textarea id="delivery-address" value={deliveryAddress} onChange={(event) => setDeliveryAddress(event.target.value)} maxLength={1000} disabled={loading} />
                    </>
                  )}
                  <p>O pagamento ficará pendente e não será cobrado agora. O total não inclui frete.</p>
                </div>
              )}

              {!token ? (
                <>
                  <div style={{ marginTop: '15px', padding: '15px', background: '#fff3cd', borderRadius: '5px', textAlign: 'center', marginBottom: '15px' }}>
                    <p style={{ margin: '0 0 10px 0', color: '#856404' }}>
                      ✓ Faça login para finalizar a compra
                    </p>
                  </div>
                  <button
                    onClick={handleCheckout}
                    className="btn-checkout"
                  >
                    🔐 Fazer Login e Finalizar Compra
                  </button>
                </>
              ) : userType === 'customer' ? (
                <button
                  onClick={handleCheckout}
                  disabled={loading || cart.length === 0}
                  className="btn-checkout"
                >
                  {loading ? 'Processando...' : '✓ Finalizar Compra'}
                </button>
              ) : (
                <p>Entre com uma conta de cliente para finalizar a compra.</p>
              )}

              <button
                onClick={() => navigate('/shop')}
                className="btn-secondary"
              >
                ← Continuar Comprando
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
