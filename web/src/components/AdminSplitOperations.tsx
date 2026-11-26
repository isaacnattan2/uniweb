import { useEffect, useState } from 'react';
import axios from 'axios';
import {
  applyPaymentSplitCondition, formatOrderCode, getAdminBusinesses, getAdminSplitPayments, requestAdminDriverSplitPayment,
  type AdminBusiness, type AdminSplitPayment, type PaymentSplitDraft, type SavedPaymentSplit,
} from '../services/api';
import { useFeedback } from './Feedback';

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const payoutLabels = { sending: 'Envio registrado', processing: 'Em processamento', done: 'Concluído', review: 'Em revisão' };

function message(error: unknown, fallback: string) {
  return axios.isAxiosError(error) && typeof error.response?.data?.error === 'string' ? error.response.data.error : fallback;
}

export function AdminSplitOperations({ draft, requirements, accountCardBands, initialStore, initialMethod, onLoadCondition }: {
  draft: PaymentSplitDraft;
  requirements: string[];
  accountCardBands?: { min: number; max: number }[];
  initialStore: string;
  initialMethod: PaymentSplitDraft['method'];
  onLoadCondition: (condition: SavedPaymentSplit, method: PaymentSplitDraft['method']) => void;
}) {
  const { showToast, confirmAction } = useFeedback();
  const [stores, setStores] = useState<AdminBusiness[]>();
  const [storesFailed, setStoresFailed] = useState(false);
  const [storeRevision, setStoreRevision] = useState(0);
  const [storeId, setStoreId] = useState(initialStore);
  const [saving, setSaving] = useState(false);
  const [payments, setPayments] = useState<{ balance: number | null; orders: AdminSplitPayment[] }>();
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [paying, setPaying] = useState<string>();

  const selectedStore = stores?.find(({ id }) => id === storeId);
  const saved = selectedStore && (draft.method === 'pix'
    ? selectedStore.asaas_pix_split_condition : selectedStore.asaas_card_split_condition);

  const card = draft.method === 'credit_card';
  const configuredCardLimit = selectedStore?.card_payment_configured &&
    selectedStore.payment_methods?.includes('credit_card') ? selectedStore.max_card_installments : undefined;
  const appliedLimit = card ? configuredCardLimit ?? draft.maxInstallments : 1;
  const needsCardSetup = card && configuredCardLimit === undefined;
  const missingCardBand = card && selectedStore && appliedLimit <= 12 && accountCardBands &&
    Array.from({ length: appliedLimit }, (_, index) => index + 1)
      .some((count) => !accountCardBands.some(({ min, max }) => min <= count && count <= max));
  const pending = [
    ...requirements,
    !selectedStore && (storesFailed ? 'As lojas não foram carregadas. Use Tentar novamente.'
      : stores ? 'Selecione a loja que receberá esta condição.' : 'Aguarde o carregamento das lojas.'),
    card && selectedStore && appliedLimit > 12 && 'Escolha até 12 parcelas para configurar a forma de pagamento da loja.',
    card && selectedStore && appliedLimit > 1 && draft.mode === 'fixed' &&
      'Selecione split percentual. O limite de ' + appliedLimit + 'x exige split percentual para o cartão.',
    missingCardBand && 'O Asaas não retornou todas as faixas para o limite real desta loja. Atualize as tarifas ou informe uma tarifa manual.',
  ].filter((value): value is string => typeof value === 'string');

  useEffect(() => {
    let active = true;
    setStoresFailed(false);
    void getAdminBusinesses().then((result) => {
      if (!active) return;
      setStores(result);
      const store = result.find(({ id }) => id === initialStore);
      const condition = initialMethod === 'pix' ? store?.asaas_pix_split_condition : store?.asaas_card_split_condition;
      if (condition) onLoadCondition(condition, initialMethod);
    })
      .catch(() => { if (active) setStoresFailed(true); });
    return () => { active = false; };
  }, [initialStore, initialMethod, onLoadCondition, storeRevision]);

  useEffect(() => {
    const controller = new AbortController();
    setError('');
    void getAdminSplitPayments(controller.signal).then((result) => {
      if (!controller.signal.aborted) setPayments(result);
    }).catch((err) => {
      if (!controller.signal.aborted) setError(message(err, 'Não foi possível consultar os repasses.'));
    });
    return () => controller.abort();
  }, [refresh]);

  async function apply() {
    const store = stores?.find(({ id }) => id === storeId);
    if (!store || pending.length > 0 || saving) return;
    setSaving(true);
    try {
      const payment = card ? 'Cartão até ' + appliedLimit + 'x' : 'Pix';
      const override = draft.mode === 'fixed' ? draft.fixedOverride : draft.rateOverride;
      const text = override === null ? '' : ' O valor ou percentual de split preenchido será usado em todos os próximos pedidos desta loja com a forma de pagamento escolhida.';
      if (!await confirmAction({
        title: needsCardSetup ? 'Autorizar cartão até ' + appliedLimit + 'x em ' + store.name + '?'
          : 'Aplicar condição de ' + payment + ' a ' + store.name + '?',
        message: (needsCardSetup
          ? 'O cartão e o máximo de parcelas ainda não foram confirmados nesta loja. Autorize usar o limite simulado e salvar a forma de pagamento junto com a condição.'
          : 'A condição vale para novos pedidos no Sandbox. ' +
            (card ? 'Será usado o limite de ' + appliedLimit + 'x já configurado na loja.' : '')) + text,
        confirmLabel: needsCardSetup ? 'Autorizar e aplicar' : 'Aplicar condição',
      })) return;
      const result = await applyPaymentSplitCondition(store.id, draft, saved?.version ?? null, needsCardSetup, configuredCardLimit);
      const column = draft.method === 'pix' ? 'asaas_pix_split_condition' : 'asaas_card_split_condition';
      setStores((current) => current?.map((item) => item.id === store.id
        ? {
          ...item, [column]: result.condition,
          ...(result.configuredCard && {
            card_payment_configured: true, max_card_installments: result.maxInstallments,
            payment_methods: [...new Set([...(item.payment_methods ?? []), 'credit_card' as const])],
          }),
        } : item));
      showToast('Condição de ' + payment + ' aplicada aos próximos pedidos de ' + store.name + '.');
    } catch (err) {
      showToast(message(err, 'Não foi possível aplicar a condição.'));
      if (axios.isAxiosError(err) && err.response?.status === 409) {
        void getAdminBusinesses().then(setStores).catch(() => undefined);
      }
    } finally {
      setSaving(false);
    }
  }

  async function pay(order: AdminSplitPayment) {
    if (paying) return;
    setPaying(order.id);
    try {
      if (order.payout_state !== 'processing' && !await confirmAction({
        title: 'Liberar repasse ao entregador no Sandbox?',
        message: 'Valor da entrega ' + currency.format((order.driver_cents ?? 0) / 100) + '.',
        confirmLabel: 'Liberar repasse',
      })) return;
      const result = await requestAdminDriverSplitPayment(order.id);
      showToast(result.state === 'done' ? 'Repasse confirmado pelo Asaas.'
        : result.state === 'review' ? 'Repasse em revisão no Asaas.' : 'Repasse em processamento no Asaas.');
    } catch (err) {
      showToast(message(err, 'Não foi possível liberar o repasse.'));
    } finally {
      setPaying(undefined);
      setRefresh((previous) => previous + 1);
    }
  }

  return (
    <>
      <section className="business-info" aria-labelledby="apply-split-heading">
        <h3 id="apply-split-heading">Aplicar aos próximos pedidos</h3>
        <p>Disponível para pedidos de uma loja no Sandbox. Preço, desconto, frete e ganho do entregador vêm do pedido real.</p>
        <label className="split-field">Loja
          <select value={storeId} onChange={(event) => setStoreId(event.target.value)} disabled={!stores || saving}>
            <option value="">{stores ? 'Selecione a loja' : 'Carregando lojas…'}</option>
            {stores?.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
          </select>
        </label>
        {storesFailed && <button type="button" className="btn-secondary"
          onClick={() => setStoreRevision((value) => value + 1)}>Tentar novamente</button>}
        {card && selectedStore && (
          <div className="split-asaas-fees">
            {needsCardSetup ? (
              <p role="status">Cartão ou máximo de parcelas ainda não confirmado. Você pode autorizar o limite simulado de <strong>{appliedLimit}x</strong> ao aplicar.</p>
            ) : (
              <p>Limite configurado pela loja <strong>{appliedLimit}x</strong>. A simulação de {draft.maxInstallments}x não muda esse limite.</p>
            )}


          </div>
        )}
        {pending.length > 0 && (
          <aside className="split-asaas-fees split-apply-warning" aria-label="Pendências para aplicar" aria-live="polite">
            <strong>Pendências para aplicar</strong>
            <ul>{pending.map((item) => <li key={item}>{item}</li>)}</ul>
          </aside>
        )}
        {saved && <button type="button" className="btn-secondary" disabled={saving}
          onClick={() => onLoadCondition(saved, draft.method)}>Carregar condição aplicada</button>}
        <button type="button" className="btn-primary" disabled={pending.length > 0 || saving} onClick={() => void apply()}>
          {saving ? 'Aplicando…' : saved ? 'Atualizar condição' : 'Aplicar condição'}
        </button>
      </section>
      <section className="business-info" aria-labelledby="split-payments-heading">
        <div className="business-info-heading">
          <h3 id="split-payments-heading">Repasses no Sandbox</h3>
          <button className="btn-secondary" type="button" onClick={() => setRefresh((previous) => previous + 1)}>Atualizar saldos e pedidos</button>
        </div>
        {error ? <p role="status">{error}</p> : !payments ? <p role="status">Consultando saldos e pedidos…</p> : (
          <>
            <p><strong>Saldo Asaas da plataforma</strong> {payments.balance === null ? 'Indisponível' : currency.format(payments.balance)}</p>
            {payments.orders.length === 0 ? <p>Nenhum pedido gerado com uma condição de split.</p> : (
              <div className="store-withdrawals-table list-panel">
                <table>
                  <thead><tr><th scope="col">Pedido</th><th scope="col">Pagamento</th><th scope="col">Repasse à loja</th>
                    <th scope="col">Entregador</th><th scope="col">Uniweb após repasse</th><th scope="col">Repasse</th></tr></thead>
                  <tbody>
                    {payments.orders.map((order) => {
                      const { snapshot, driver_cents: driver, payout_state: payout } = order;
                      const store = Number(order.store_cents ?? snapshot.storeEstimate);
                      const net = Number(order.payment_net_cents ?? snapshot.net);
                      const earnings = order.confirmed_driver_cents === null ? driver : Number(order.confirmed_driver_cents);
                      const canPay = order.payment_status === 'paid' && order.order_status !== 'cancelled' &&
                        order.delivery_status === 'delivered' && driver !== null && driver > 0 && (!payout || payout === 'processing');
                      return (
                        <tr key={order.id}>
                          <th scope="row">{formatOrderCode(order.id)} · {order.store}</th>
                          <td>{order.payment_method === 'pix' ? 'Pix' : 'Cartão'} · {order.payment_status === 'paid' ? 'Pago' : order.payment_status === 'pending' ? 'Pendente' : 'Encerrado'}</td>
                          <td>{currency.format(store / 100)} {order.store_cents === null && <small>estimado</small>}</td>
                          <td>{driver === null ? 'Aguardando entrega' : currency.format(driver / 100)}</td>
                          <td>{earnings === null ? '—' : currency.format((net - store - earnings) / 100)} {earnings !== null && payout !== 'done' && <small>previsto</small>}</td>
                          <td>
                            {payout && <span>{payoutLabels[payout]} </span>}
                            {canPay && <button type="button" className="btn-secondary" disabled={!!paying} onClick={() => void pay(order)}>
                              {payout === 'processing' ? 'Consultar repasse' : 'Liberar repasse'}
                            </button>}
                            {!payout && !canPay && '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </section>
    </>
  );
}
