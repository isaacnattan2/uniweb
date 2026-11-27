import { cardLabel, SavedCardForm } from '../components/CustomerSavedCards';
import { BlockingLoader } from '../components/BlockingLoader';
import type { SavedCustomerCard } from '../services/api';
import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { StorePaymentMethod } from '../context/store';
import { createOrder, getBusinessPublic, getCustomerCards, getDeliveryQuote, getSavedDeliveryAddresses } from '../services/api';
import type { DeliveryQuote, DeliveryQuoteMode, SavedDeliveryAddress } from '../services/api';
import { DEFAULT_CARD_INSTALLMENTS, useCartStore, useAuthStore } from '../context/store';
import { CheckoutAddress, emptyDeliveryAddress, isDeliveryAddressComplete } from '../components/CheckoutAddress';
import '../styles/cart.css';

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const slotLabel = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
const hourLabel = new Intl.DateTimeFormat('pt-BR', { timeStyle: 'short' });

export function CartPage() {
  const navigate = useNavigate();
  const cart = useCartStore((state) => state.items);
  const getTotal = useCartStore((state) => state.getTotal);
  const removeFromCart = useCartStore((state) => state.removeFromCart);
  const updateQuantity = useCartStore((state) => state.updateQuantity);
  const cartReady = useCartStore((state) => state.ready);
  const cartSyncing = useCartStore((state) => state.syncing);
  const cartError = useCartStore((state) => state.error);
  const refreshCart = useCartStore((state) => state.refresh);
  const { userId, token, userType } = useAuthStore();
  const [loading, setLoading] = useState(false);
  const [quotingKey, setQuotingKey] = useState<string>();
  const [error, setError] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('');
  const [checkoutStore, setCheckoutStore] = useState('');
  const [payTogether, setPayTogether] = useState(true);
  const [couponCode, setCouponCode] = useState('');
  const [availability, setAvailability] = useState<{ key: string; stores: Record<string, {
    methods: StorePaymentMethod[]; maxCardInstallments?: number; pickupAddress?: string | null;
  }>; failed?: boolean }>();
  const [deliveryType, setDeliveryType] = useState('');
  const [deliveryMode, setDeliveryMode] = useState<DeliveryQuoteMode>();
  const [deliveryQuotes, setDeliveryQuotes] = useState<Record<string, { key: string; data?: DeliveryQuote; error?: string }>>({});
  const [quoteRefresh, setQuoteRefresh] = useState(0);
  const [deliverySelections, setDeliverySelections] = useState<Record<string, { key: string; value: string }>>({});
  const [acceptedFee, setAcceptedFee] = useState('');
  const [deliveryAddress, setDeliveryAddress] = useState(emptyDeliveryAddress);
  const [addressBook, setAddressBook] = useState<{ userId: string; entries: SavedDeliveryAddress[]; failed?: boolean }>();
  const [selectedAddressId, setSelectedAddressId] = useState('');
  const savedAddresses = addressBook?.userId === userId ? addressBook : undefined;
  const activeAddressId = selectedAddressId || savedAddresses?.entries[0]?.id || 'new';
  const activeAddress = activeAddressId === 'new' ? deliveryAddress : savedAddresses?.entries.find((entry) => entry.id === activeAddressId)?.address;
  const [cardBook, setCardBook] = useState<{ userId: string; enabled: boolean; items: SavedCustomerCard[] }>();
  const [selectedCard, setSelectedCard] = useState('hosted');
  const [addingCard, setAddingCard] = useState(false);
  const [installments, setInstallments] = useState(1);
  const checkoutAttempt = useRef<{ signature: string; id: string } | null>(null);
  const submitting = useRef(false);

  const total = getTotal();
  const storeIds = [...new Set(cart.map((item) => item.businessId))].sort();
  const storeCount = storeIds.length;
  const cards = cardBook?.userId === userId ? cardBook : undefined;
  const grouped = storeCount > 1 && Boolean(cards?.enabled) && payTogether;
  const selectedStore = storeIds.includes(checkoutStore) ? checkoutStore : storeIds[0];
  const checkoutStores = grouped ? storeIds : selectedStore ? [selectedStore] : [];
  const checkoutStoresKey = JSON.stringify(checkoutStores);
  const storeItems = grouped ? cart : cart.filter((item) => item.businessId === selectedStore);
  const storeTotal = storeItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const storeName = (id: string) => cart.find((item) => item.businessId === id)?.businessName || 'Loja';
  const available = availability?.key === checkoutStoresKey ? availability : undefined;
  const methods = (['pix', 'credit_card'] as const).filter((method) =>
    (method === 'credit_card' || !grouped) && checkoutStores.every((id) => available?.stores[id]?.methods.includes(method)));
  const maxCardInstallments = Math.min(...checkoutStores.map((id) => available?.stores[id]?.maxCardInstallments ?? DEFAULT_CARD_INSTALLMENTS));
  const selectedMethod = methods.find((method) => method === (grouped ? 'credit_card' : paymentMethod));
  const card = selectedMethod === 'credit_card' ? cards?.items.find(({ id }) => id === selectedCard) : undefined;
  const chargeInstallments = Math.min(installments, maxCardInstallments);
  const addressComplete = !!savedAddresses && !!activeAddress && isDeliveryAddressComplete(activeAddress);
  const quoteKey = JSON.stringify([checkoutStoresKey, activeAddress, userId, deliveryType, deliveryMode, quoteRefresh]);
  const deliveryOptions = (grouped ? ['all'] : checkoutStores).map((id) => {
    const result = deliveryQuotes[id]?.key === quoteKey ? deliveryQuotes[id] : undefined;
    const quote = result?.data;
    const selection = deliverySelections[id]?.key === quoteKey ? deliverySelections[id].value : '';
    const option = deliveryMode === 'immediate'
      ? quote?.options.find((entry) => entry.id === selection)
      : quote?.slots.includes(selection) ? quote.options[0] : undefined;
    return { id, result, quote, selection, option };
  });
  const deliveryFees = deliveryOptions.reduce((sum, { option }) => sum + (option?.feeCents ?? 0), 0);
  const allFreightSelected = deliveryOptions.every(({ option }) => Boolean(option));
  const allQuotesLoaded = deliveryOptions.every(({ result }) => Boolean(result));
  const hasQuoteOptions = deliveryOptions.every(({ quote }) => Boolean(quote?.options.length));
  const consentKey = allFreightSelected ? JSON.stringify(deliveryOptions.map(({ option, selection }) => [option?.id, selection])) : '';
  const feeAccepted = !!consentKey && acceptedFee === consentKey;
  useEffect(() => {
    setSelectedCard('hosted');
    setAddingCard(false);
    setInstallments(1);
    if (!token || userType !== 'customer' || !userId) return;
    const request = new AbortController();
    void getCustomerCards(request.signal).then((result) => {
      if (!request.signal.aborted) setCardBook({ userId, enabled: result.enabled, items: result.cards });
    }).catch(() => {
      if (!request.signal.aborted) setCardBook({ userId, enabled: false, items: [] });
    });
    return () => request.abort();
  }, [token, userType, userId]);

  let checkoutBlocker = '';
  if (cartSyncing > 0) checkoutBlocker = 'Aguarde a atualização do carrinho.';
  else if (!available) checkoutBlocker = 'Aguarde a consulta das formas de pagamento.';
  else if (available.failed) checkoutBlocker = 'Atualize a página para consultar as formas de pagamento novamente.';
  else if (!methods.length) checkoutBlocker = grouped ? 'Todas as lojas precisam aceitar cartão para pagar juntas.' : 'Esta loja está sem formas de pagamento disponíveis.';
  else if (selectedMethod === 'credit_card' && addingCard) checkoutBlocker = 'Salve ou cancele o cadastro do cartão.';
  else if (grouped && !card) checkoutBlocker = 'Selecione ou cadastre um cartão para pagar todas as lojas.';
  else if (!selectedMethod) checkoutBlocker = 'Selecione uma forma de pagamento.';
  else if (!deliveryType) checkoutBlocker = 'Selecione uma forma de entrega.';
  else if (deliveryType !== 'pickup' && !addressComplete) checkoutBlocker = 'Informe o endereço de entrega completo.';
  else if (deliveryType === 'delivery') {
    if (!deliveryMode) checkoutBlocker = 'Escolha entrega imediata ou agendada.';
    else if (!allQuotesLoaded) checkoutBlocker = 'Aguarde o cálculo do frete.';
    else if (!hasQuoteOptions) checkoutBlocker = 'Atualize o frete ou escolha outra modalidade.';
    else if (!allFreightSelected) checkoutBlocker = deliveryMode === 'immediate' ? 'Escolha uma opção de frete.' : 'Escolha um horário de entrega.';
    else if (!feeAccepted) checkoutBlocker = 'Marque a opção “Aceito o frete” para continuar.';
  }

  function changeDeliveryMode(mode?: DeliveryQuoteMode) {
    setDeliveryMode(mode);
    setDeliveryQuotes({});
    setDeliverySelections({});
    setAcceptedFee('');
    setError('');
  }

  useEffect(() => {
    if (!token || userType !== 'customer' || !activeAddress || !addressComplete || deliveryType !== 'delivery' || !deliveryMode) return;
    const request = new AbortController();
    const timer = setTimeout(() => {
      const ids = JSON.parse(checkoutStoresKey) as string[];
      if (!ids.length) return;
      const id = grouped ? 'all' : ids[0];
      setQuotingKey(quoteKey);
      void getDeliveryQuote(grouped ? ids : id, activeAddress, deliveryMode, request.signal).then((data) => {
        if (!request.signal.aborted) setDeliveryQuotes({ [id]: { key: quoteKey, data } });
      }).catch((err) => {
        if (!request.signal.aborted) setDeliveryQuotes({
          [id]: { key: quoteKey, error: err.response?.data?.error || 'Não foi possível calcular o frete.' },
        });
      }).finally(() => {
        if (!request.signal.aborted) setQuotingKey(undefined);
      });
    }, 350);
    return () => {
      clearTimeout(timer);
      request.abort();
      setQuotingKey((current) => current === quoteKey ? undefined : current);
    };
  }, [token, userType, checkoutStoresKey, grouped, activeAddress, addressComplete, deliveryType, deliveryMode, quoteKey]);

  useEffect(() => {
    if (!token || userType !== 'customer') return;

    let active = true;
    Promise.all((JSON.parse(checkoutStoresKey) as string[]).map(async (id) => {
      const business = await getBusinessPublic(id);
      return [id, { methods: business.payment_methods ?? ['pix', 'credit_card'], maxCardInstallments: business.max_card_installments, pickupAddress: business.address }] as const;
    })).then((entries) => {
      if (active) setAvailability({ key: checkoutStoresKey, stores: Object.fromEntries(entries) });
    }).catch(() => {
      if (active) setAvailability({ key: checkoutStoresKey, stores: {}, failed: true });
    });
    return () => { active = false; };
  }, [checkoutStoresKey, token, userType]);

  useEffect(() => {
    setAddressBook(undefined);
    setSelectedAddressId('');
    setDeliveryAddress(emptyDeliveryAddress);
    if (!token || userType !== 'customer' || !userId) return;
    const request = new AbortController();
    getSavedDeliveryAddresses(request.signal).then((entries) => {
      if (!request.signal.aborted) setAddressBook({ userId, entries });
    }).catch(() => {
      if (!request.signal.aborted) setAddressBook({ userId, entries: [], failed: true });
    });
    return () => request.abort();
  }, [token, userId, userType]);

  async function handleCheckout() {
    if (submitting.current || useCartStore.getState().syncing > 0) return;
    if (!token || !userId) {
      navigate('/login', { state: { from: '/cart' } });
      return;
    }
    if (userType !== 'customer') {
      setError('Entre com uma conta de cliente para finalizar a compra.');
      return;
    }
    if (!selectedStore || !selectedMethod) {
      setError('Selecione uma forma de pagamento.');
      return;
    }
    if (deliveryType !== 'pickup' && deliveryType !== 'delivery') {
      setError('Selecione uma forma de entrega.');
      return;
    }
    if (deliveryType !== 'pickup' && (!savedAddresses || !activeAddress || !isDeliveryAddressComplete(activeAddress))) {
      setError('Informe CEP, logradouro, número, cidade e UF para continuar.');
      return;
    }
    if (checkoutBlocker) {
      setError(checkoutBlocker);
      return;
    }
    if (deliveryType === 'delivery' && (!allFreightSelected || !feeAccepted)) {
      setError('Calcule o frete, escolha o prazo e aceite o valor da entrega.');
      return;
    }

    const address = deliveryType === 'pickup' ? '' : activeAddress ?? '';
    const selections = deliveryType === 'delivery' ? deliveryOptions.flatMap(({ option, selection }) => option ? [{
      deliveryQuoteId: option.id, scheduledAt: deliveryMode === 'scheduled' ? selection : null, deliveryFeeAccepted: true as const,
    }] : []) : [];
    const dispatch = selections[0];
    const appliedCoupon = grouped ? '' : couponCode.trim();
    submitting.current = true;
    setLoading(true);
    setError('');

    try {
      const items = storeItems.map((item) => ({
        productId: item.productId,
        quantity: item.quantity,
        price: item.price,
      }));

      const signature = JSON.stringify([userId, items, selectedMethod, deliveryType, address, appliedCoupon, dispatch, card?.id, chargeInstallments]);
      if (checkoutAttempt.current?.signature !== signature) {
        checkoutAttempt.current = { signature, id: crypto.randomUUID() };
      }
      const { checkoutUrl, paymentStatus } = await createOrder(
        items, selectedMethod, deliveryType, address, checkoutAttempt.current.id, appliedCoupon, dispatch, card ? { savedCardId: card.id, installments: chargeInstallments } : undefined
      );
      if (useAuthStore.getState().userId !== userId) return;
      if (paymentStatus === 'failed') {
        checkoutAttempt.current = null;
        setError('O pagamento foi recusado. Selecione outro cartão ou tente Pix.');
        if (deliveryType === 'delivery') {
          setAcceptedFee('');
          setQuoteRefresh((value) => value + 1);
        }
        return;
      }
      if (checkoutUrl) {
        window.location.assign(checkoutUrl);
        return;
      }
      await refreshCart();
      navigate('/orders');
    } catch (err: any) {
      setError(err.response?.data?.error || 'Erro ao criar pedido');
    } finally {
      submitting.current = false;
      setLoading(false);
    }
  }

  if (!cartReady) {
    return <div className="cart-page"><div className="container">
      <h1>Meu carrinho</h1>
      {cartError ? <>
        <p className="error-message" role="alert">{cartError}</p>
        <button type="button" className="btn-secondary" disabled={cartSyncing > 0} onClick={() => void refreshCart()}>Tentar novamente</button>
      </> : <p role="status">Carregando seu carrinho…</p>}
    </div></div>;
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
      {(loading || quotingKey === quoteKey) && (
        <BlockingLoader message={loading ? 'Processando pagamento…' : 'Calculando frete…'} />
      )}
      <div className="container">
        <h1>🛒 Meu Carrinho ({cart.length} itens)</h1>

        {(error || cartError) && <div className="error-message" role="alert">{error || cartError}</div>}

        <div className="cart-content">
          <div className="cart-items list-panel list-panel-inset">
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
                        <button type="button" disabled={loading || cartSyncing > 0} aria-label={`Diminuir quantidade de ${item.name}`} onClick={() => updateQuantity(item.productId, item.quantity - 1)} />
                        <input
                          type="number"
                          min="1"
                          step="1"
                          key={item.quantity}
                          disabled={loading || cartSyncing > 0}
                          defaultValue={item.quantity}
                          onBlur={(event) => {
                            const quantity = Number(event.currentTarget.value);
                            if (Number.isInteger(quantity) && quantity > 0 && quantity !== item.quantity) {
                              const input = event.currentTarget;
                              void updateQuantity(item.productId, quantity).then((updated) => {
                                if (!updated) input.value = String(item.quantity);
                              });
                            } else event.currentTarget.value = String(item.quantity);
                          }}
                          onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }}
                          aria-label={`Quantidade de ${item.name}`}
                        />
                        <button type="button" className="quantity-increase" disabled={loading || cartSyncing > 0}
                          aria-label={`Aumentar quantidade de ${item.name}`} onClick={() => updateQuantity(item.productId, item.quantity + 1)} />
                      </div>
                    </td>
                    <td>R$ {(item.price * item.quantity).toFixed(2)}</td>
                    <td>
                      <button
                        onClick={() => removeFromCart(item.productId)}
                        disabled={loading || cartSyncing > 0}
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
                <span>{deliveryType === 'pickup' ? 'Sem frete' : allFreightSelected ? currency.format(deliveryFees / 100) : 'A selecionar'}</span>
              </div>
              <div className="summary-row total">
                <span>Total:</span>
                <span>{currency.format(total + deliveryFees / 100)}</span>
              </div>

              {token && userType === 'customer' && (
                <div className="checkout-options">
                  {storeCount > 1 && cards?.enabled && (
                    <label className="checkout-fee-consent">
                      <input type="checkbox" checked={grouped} disabled={loading} onChange={(event) => {
                        setPayTogether(event.target.checked);
                        setAddingCard(false);
                        setError('');
                      }} />
                      <span>Pagar todas as lojas em uma única cobrança no cartão</span>
                    </label>
                  )}
                  {grouped && (
                    <ul className="checkout-store-list">
                      {checkoutStores.map((id) => {
                        const subtotal = cart.reduce((sum, item) => item.businessId === id ? sum + item.price * item.quantity : sum, 0);
                        return <li key={id}>{storeName(id)} · {currency.format(subtotal)}</li>;
                      })}
                    </ul>
                  )}
                  {storeCount > 1 && !grouped && (
                    <>
                      <label htmlFor="checkout-store">Loja que você quer pagar</label>
                      <select id="checkout-store" value={selectedStore} disabled={loading} onChange={(event) => {
                        setCheckoutStore(event.target.value);
                        setPaymentMethod('');
                        setCouponCode('');
                        setError('');
                      }}>
                        {storeIds.map((id) => (
                          <option key={id} value={id}>{storeName(id)}</option>
                        ))}
                      </select>
                      <p><strong>Total desta cobrança:</strong> {currency.format(storeTotal + deliveryFees / 100)}. Os itens das outras lojas ficam no carrinho.</p>
                    </>
                  )}
                  {!grouped && <><label htmlFor="checkout-coupon">Cupom da loja (opcional)</label>
                  <input id="checkout-coupon" type="text" value={couponCode} maxLength={30} disabled={loading}
                    onChange={(event) => setCouponCode(event.target.value.toUpperCase())} />
                  {couponCode.trim() && <p>O desconto será validado ao continuar e o valor final aparecerá no Asaas.</p>}</>}
                  {!grouped && <><label htmlFor="payment-method">Forma de pagamento</label>
                  <select id="payment-method" value={selectedMethod || ''} onChange={(event) => setPaymentMethod(event.target.value)} disabled={loading || !methods.length}>
                    <option value="">Selecione</option>
                    {methods.includes('pix') && <option value="pix">Pix</option>}
                    {methods.includes('credit_card') && <option value="credit_card">Cartão de crédito</option>}

                  </select></>}
                  {!available && <p role="status">Consultando formas de pagamento da loja…</p>}
                  {available?.failed && <p role="alert">Não foi possível consultar as formas de pagamento. Atualize a página para tentar novamente.</p>}
                  <label htmlFor="delivery-type">Forma de entrega</label>
                  <select id="delivery-type" value={deliveryType} onChange={(event) => { setDeliveryType(event.target.value); changeDeliveryMode(); }} disabled={loading}>
                    <option value="">Selecione</option>
                    <option value="pickup">Retirada na loja</option>
                    <option value="delivery">Entrega</option>
                  </select>
                  {deliveryType === 'delivery' && (
                    <fieldset className="checkout-radio-group" disabled={loading}>
                      <legend>Modalidade de entrega</legend>
                      <label><input type="radio" name="delivery-mode" checked={deliveryMode === 'immediate'} onChange={() => changeDeliveryMode('immediate')} />Entrega imediata</label>
                      <label><input type="radio" name="delivery-mode" checked={deliveryMode === 'scheduled'} onChange={() => changeDeliveryMode('scheduled')} />Agendar entrega</label>
                    </fieldset>
                  )}
                  {deliveryType === 'pickup' && checkoutStores.map((id) => available?.stores[id]?.pickupAddress && (
                    <p key={id}><strong>{grouped ? storeName(id) : 'Endereço para retirada'}:</strong> {available.stores[id].pickupAddress}</p>
                  ))}
                  {deliveryType === 'delivery' && (
                    <div className="checkout-saved-address">
                      {!savedAddresses ? <p role="status">Consultando endereços da conta…</p> : (
                        <>
                          {savedAddresses.failed && <p role="status">Não foi possível carregar seus endereços. Você pode informar o endereço abaixo.</p>}
                          {!!savedAddresses.entries.length && (
                            <>
                              <label htmlFor="checkout-saved-address">Endereço de entrega</label>
                              <select id="checkout-saved-address" value={activeAddressId} disabled={loading}
                                onChange={(event) => setSelectedAddressId(event.target.value)}>
                                {savedAddresses.entries.map(({ id, address }, index) => (
                                  <option key={id} value={id}>{index === 0 ? 'Padrão — ' : ''}{address.street}, {address.number}{address.complement && ' · ' + address.complement} · {address.city}/{address.state} · {address.cep}</option>
                                ))}
                                <option value="new">Usar outro endereço</option>
                              </select>
                            </>
                          )}
                          {activeAddressId === 'new' ? (
                            <CheckoutAddress address={deliveryAddress} onChange={setDeliveryAddress} disabled={loading} />
                          ) : activeAddress && (
                            <p>{activeAddress.street}, {activeAddress.number}{activeAddress.complement && ' · ' + activeAddress.complement}
                              {activeAddress.neighborhood && ' · ' + activeAddress.neighborhood}
                              {' · ' + activeAddress.city + '/' + activeAddress.state + ' · CEP ' + activeAddress.cep}</p>
                          )}
                        </>
                      )}
                    </div>
                  )}
                  {deliveryType === 'delivery' && deliveryMode && addressComplete && (
                    <>
                      {deliveryOptions.map(({ id, result, quote, selection }) => (
                        <React.Fragment key={id}>
                      {grouped && <p>Um entregador far? as coletas nas lojas do carrinho.</p>}
                      {!result && <p role="status">Consultando opções de entrega…</p>}
                      {result?.error && <p className="error-message" role="alert">{result.error}</p>}
                      {quote && !quote.options.length && (
                        <p role="status">{deliveryMode === 'immediate' ? 'Nenhum entregador disponível para este endereço agora.' : 'Nenhum horário disponível para este endereço.'}</p>
                      )}
                      {quote && quote.options.length > 0 && deliveryMode === 'immediate' && (
                        <fieldset className="checkout-radio-group" disabled={loading}>
                          <legend>Opções de frete</legend>
                          {quote.options.map((option) => (
                            <label key={option.id}>
                              <input type="radio" name={`delivery-freight-${id}`} checked={selection === option.id} onChange={() => {
                                setAcceptedFee('');
                                setDeliverySelections((current) => ({ ...current, [id]: { key: quoteKey, value: option.id } }));
                              }} />
                              <span><strong>{currency.format(option.feeCents / 100)}</strong> · cerca de {option.estimatedMinutes} min após o pagamento</span>
                            </label>
                          ))}
                        </fieldset>
                      )}
                      {quote && quote.slots.length > 0 && deliveryMode === 'scheduled' && (
                        <>
                          <label htmlFor={`checkout-delivery-slot-${id}`}>Horário de entrega</label>
                          <select id={`checkout-delivery-slot-${id}`} value={selection} disabled={loading} onChange={(event) => {
                            const value = event.target.value;
                            setAcceptedFee('');
                            setDeliverySelections((current) => ({ ...current, [id]: { key: quoteKey, value } }));
                          }}>
                            <option value="">Selecione</option>
                            {quote.slots.map((slot) => <option key={slot} value={slot}>
                              {slotLabel.format(new Date(slot))} até {hourLabel.format(new Date(Date.parse(slot) + quote.windowMinutes * 60000))}
                            </option>)}
                          </select>
                        </>
                      )}
                        </React.Fragment>
                      ))}
                      {consentKey && (
                        <label className="checkout-fee-consent">
                          <input type="checkbox" disabled={loading} checked={feeAccepted}
                            onChange={(event) => setAcceptedFee(event.target.checked ? consentKey : '')} />
                          <span>Aceito o frete {grouped ? 'total ' : ''}de {currency.format(deliveryFees / 100)}.</span>
                        </label>
                      )}
                      {allQuotesLoaded && <button type="button" className="btn-secondary" disabled={loading} onClick={() => {
                        setError('');
                        setQuoteRefresh((current) => current + 1);
                      }}>Atualizar frete</button>}
                    </>
                  )}
                  {selectedMethod === 'credit_card' && (
                    <>
                      <p>{maxCardInstallments === 1 ? 'Cartão à vista.' : `Até ${maxCardInstallments}× no cartão.`}</p>
                      {cards?.enabled && (
                        <div className="checkout-saved-card">
                          <div className="form-group">
                            <label htmlFor="checkout-card">Cartão de crédito</label>
                            <select id="checkout-card" value={selectedCard} disabled={loading || addingCard} onChange={(event) => {
                              setSelectedCard(event.target.value);
                              setInstallments(1);
                            }}>
                              <option value="hosted">{grouped ? 'Selecione um cartão' : 'Inserir cartão na página do Asaas'}</option>
                              {cards.items.map((saved) => <option key={saved.id} value={saved.id}>{cardLabel(saved)}</option>)}
                            </select>
                          </div>
                          {addingCard ? <SavedCardForm addresses={savedAddresses?.entries}
                            checkoutAddress={deliveryType === 'delivery' && activeAddressId === 'new' && addressComplete ? activeAddress : undefined}
                            onCancel={() => setAddingCard(false)} onSaved={(saved) => {
                            if (useAuthStore.getState().userId !== userId) return;
                            setCardBook({ ...cards, items: [saved, ...cards.items] });
                            setSelectedCard(saved.id);
                            setInstallments(1);
                            setAddingCard(false);
                          }} /> : <button type="button" className="btn-secondary" disabled={loading}
                            onClick={() => setAddingCard(true)}>Cadastrar cartão de teste</button>}
                        </div>
                      )}
                      {card && maxCardInstallments > 1 && <div className="form-group">
                        <label htmlFor="checkout-installments">Parcelas</label>
                        <select id="checkout-installments" value={chargeInstallments} disabled={loading}
                          onChange={(event) => setInstallments(Number(event.target.value))}>
                          {Array.from({ length: maxCardInstallments }, (_, index) => index + 1)
                            .map((number) => <option key={number} value={number}>{number}×</option>)}
                        </select>
                      </div>}
                    </>
                  )}
                  {(!grouped || card) && <p>{card ? 'O Asaas vai processar o pagamento com o cartão salvo selecionado.' :
                    'Você vai concluir o pagamento na página do Asaas.'}</p>}
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
                <>
                  {!loading && checkoutBlocker && <p id="checkout-blocker" className="checkout-blocker" role="status">{checkoutBlocker}</p>}
                  <button
                    onClick={handleCheckout}
                    disabled={loading || !!checkoutBlocker}
                    aria-describedby={!loading && checkoutBlocker ? 'checkout-blocker' : undefined}
                    className="btn-checkout"
                  >
                    {loading ? 'Processando...' : grouped ? `Pagar ${currency.format(storeTotal + deliveryFees / 100)}` : storeCount > 1 ? 'Pagar esta loja' : '✓ Finalizar Compra'}
                  </button>
                </>
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
