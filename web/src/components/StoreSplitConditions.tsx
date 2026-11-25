import { useState } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import type { Business } from '../context/store';
import { removePaymentSplitCondition, type PaymentSplitDraft, type SavedPaymentSplit } from '../services/api';
import { useFeedback } from './Feedback';

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const percent = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 4 });
const date = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo' });

const feeOwners: Record<string, string> = {
  store: 'Lojista',
  platform: 'Uniweb',
  proportional: 'Lojista pelos produtos, Uniweb pelo restante',
};

function showRule(condition: SavedPaymentSplit) {
  if (condition.mode === 'fixed') {
    return condition.fixedOverride === null ? 'Valor calculado a partir de cada pedido'
      : currency.format(condition.fixedOverride) + ' por pedido';
  }
  return condition.rateOverride === null ? 'Percentual calculado a partir de cada pedido'
    : percent.format(condition.rateOverride) + '% do líquido da cobrança';
}

export function StoreSplitConditions({ business, admin, onRemove }: {
  business: Business;
  admin: boolean;
  onRemove: (method: PaymentSplitDraft['method'], version: string) => void;
}) {
  const { showToast, confirmAction } = useFeedback();
  const [removing, setRemoving] = useState(false);
  const conditions = [
    { method: 'pix', label: 'Pix', condition: business.asaas_pix_split_condition },
    { method: 'credit_card', label: 'Cartão de crédito', condition: business.asaas_card_split_condition },
  ] as const;

  async function remove(method: PaymentSplitDraft['method'], label: string, version: string) {
    if (!admin || removing) return;
    setRemoving(true);
    try {
      if (!await confirmAction({
        title: 'Remover a condição de ' + label + '?',
        message: 'Os próximos pedidos voltarão ao fluxo sem a condição de split desta modalidade. Os pedidos existentes preservam a regra registrada.',
        confirmLabel: 'Remover condição',
      })) return;
      await removePaymentSplitCondition(business.id, method, version);
      onRemove(method, version);
      showToast('Condição removida.');
    } catch (error) {
      showToast(axios.isAxiosError(error) && typeof error.response?.data?.error === 'string'
        ? error.response.data.error : 'Não foi possível remover a condição.');
    } finally {
      setRemoving(false);
    }
  }

  return (
    <section className="business-info" aria-labelledby="store-split-heading">
      <h2 id="store-split-heading">Condições de repasse</h2>
      <div className="store-split-grid">
        {conditions.map(({ method, label, condition }) => {
          const ownerChanged = Boolean(condition && business.owner_id && condition.ownerId !== business.owner_id);
          const visible = ownerChanged && !admin ? null : condition;
          const expires = visible?.expiresAt ? Date.parse(visible.expiresAt) : NaN;
          const limit = business.max_card_installments ?? 3;
          const cardBand = method === 'credit_card' ? visible?.cardFeeBands?.filter((band) => band.min <= limit)
            .sort((a, b) => b.rate - a.rate || b.fixed - a.fixed)[0] : undefined;
          const fixedFee = method === 'credit_card' && visible?.manualFixedPerInstallment !== undefined
            ? visible.manualFixedPerInstallment * limit : cardBand?.fixed ?? visible?.asaasFixed;
          return (
            <article className="store-split-card" key={method}>
              <h3>{label}</h3>
              {visible ? (
                <>
                  {ownerChanged && <p>O titular mudou. A condição precisa ser reaplicada.</p>}
                  {expires <= Date.now() && <p>Tarifa de referência vencida. A condição precisa ser atualizada.</p>}
                  <dl>
                    <div><dt>Taxa da plataforma</dt><dd>{percent.format(visible.commissionRate)}%
                      {visible.commissionFixed > 0 && ' + ' + currency.format(visible.commissionFixed)}</dd></div>
                    <div><dt>Base da taxa</dt><dd>{visible.commissionBase === 'net' ? 'Produtos após a parcela da tarifa Asaas' : 'Produtos antes da parcela da tarifa Asaas'}</dd></div>
                    <div><dt>Split</dt><dd>{visible.mode === 'fixed' ? 'Fixo' : 'Percentual'} · {showRule(visible)}</dd></div>
                    <div><dt>Tarifa Asaas de referência</dt><dd>{percent.format(cardBand?.rate ?? visible.asaasRate)}% + {currency.format(fixedFee ?? 0)}</dd></div>
                    {(visible.asaasMinimum != null || visible.asaasMaximum != null) && (
                      <div><dt>Limites da tarifa Asaas</dt><dd>{[visible.asaasMinimum == null ? '' : 'Mínimo ' + currency.format(visible.asaasMinimum),
                        visible.asaasMaximum == null ? '' : 'Máximo ' + currency.format(visible.asaasMaximum)].filter(Boolean).join(' · ')}</dd></div>
                    )}
                    <div><dt>Quem absorve o processamento</dt><dd>{feeOwners[visible.feeOwner]}</dd></div>
                    <div><dt>Quem financia os descontos</dt><dd>{visible.discountOwner === 'store' ? 'Lojista' : 'Uniweb'}</dd></div>
                    {method === 'credit_card' && <div><dt>Parcelas oferecidas</dt><dd>Até {business.max_card_installments ?? 3}x</dd></div>}
                    {Number.isFinite(expires) && <div><dt>Validade da tarifa de referência</dt><dd>{date.format(expires)}</dd></div>}
                  </dl>
                </>
              ) : <p>Sem condição de split aplicada.</p>}
              {admin && <div className="store-split-actions">
                <Link to={'/admin/simulador-split?' + new URLSearchParams({ loja: business.id, pagamento: method === 'pix' ? 'pix' : 'card' })}
                  className="btn-primary">{condition ? 'Editar condição' : 'Criar condição'}</Link>
                {condition && <button type="button" className="btn-secondary" disabled={removing}
                  onClick={() => void remove(method, label, condition.version)}>Remover</button>}
              </div>}
            </article>
          );
        })}
      </div>
    </section>
  );
}