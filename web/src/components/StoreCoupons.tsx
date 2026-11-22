import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { deleteStoreCoupon, getStoreCoupons, saveStoreCoupon } from '../services/api';
import type { StoreCoupon, StoreCouponInput } from '../services/api';
import { CategoryOptions } from './CategoryOptions';

const emptyForm = {
  code: '', discountType: 'percent' as StoreCoupon['discount_type'], value: '',
  scope: 'store' as StoreCoupon['scope'], category: '', productIds: [] as string[], active: true,
};
const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const scopeLabels = { store: 'Loja inteira', category: 'Categoria', products: 'Produtos específicos' };

export function StoreCoupons({ businessId, products }: { businessId: string; products: Array<{ id: string; name: string }> }) {
  const [coupons, setCoupons] = useState<StoreCoupon[]>([]);
  const [editing, setEditing] = useState<string>();
  const [form, setForm] = useState(emptyForm);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    getStoreCoupons(businessId).then((rows) => {
      if (active) setCoupons(rows);
    }).catch(() => {
      if (active) setError('Não foi possível carregar os cupons.');
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [businessId]);

  function clearForm() {
    setEditing(undefined);
    setForm(emptyForm);
  }

  async function update(action: () => Promise<void>, success: string) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
      setNotice(success);
    } catch (err) {
      setError(axios.isAxiosError(err) ? err.response?.data?.error || 'Não foi possível atualizar os cupons.' : 'Não foi possível atualizar os cupons.');
    } finally {
      setBusy(false);
    }
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (form.scope === 'products' && !form.productIds.length) {
      setError('Selecione pelo menos um produto.');
      return;
    }
    const input: StoreCouponInput = { ...form, discountValue: Math.round(Number(form.value) * 100) };
    void update(async () => {
      const saved = await saveStoreCoupon(businessId, input, editing);
      setCoupons((rows) => [...rows.filter((coupon) => coupon.id !== saved.id), saved]);
      clearForm();
    }, editing ? 'Cupom atualizado.' : 'Cupom cadastrado.');
  }

  function startEdit(coupon: StoreCoupon) {
    setEditing(coupon.id);
    setForm({
      code: coupon.code, discountType: coupon.discount_type, value: String(coupon.discount_value / 100),
      scope: coupon.scope, category: coupon.category || '', productIds: coupon.product_ids, active: coupon.active,
    });
    setError('');
    setNotice('');
    document.getElementById('store-coupon-code')?.focus();
  }

  function remove(coupon: StoreCoupon) {
    if (busy || !window.confirm('Excluir o cupom ' + coupon.code + '?')) return;
    void update(async () => {
      await deleteStoreCoupon(businessId, coupon.id);
      setCoupons((rows) => rows.filter((item) => item.id !== coupon.id));
      if (editing === coupon.id) clearForm();
    }, 'Cupom excluído.');
  }

  return (
    <section className="business-info store-coupons" aria-labelledby="store-coupons-heading">
      <h2 id="store-coupons-heading">Cupons de desconto</h2>
      <form onSubmit={submit}>
        <fieldset disabled={busy || loading}>
          <legend>{editing ? 'Editar cupom' : 'Cadastrar cupom'}</legend>
          <div className="store-coupon-fields">
            <div className="form-group">
              <label htmlFor="store-coupon-code">Código</label>
              <input id="store-coupon-code" value={form.code} required minLength={3} maxLength={30}
                pattern="[A-Za-z0-9][A-Za-z0-9_\-]{2,29}" onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} />
            </div>
            <div className="form-group">
              <label htmlFor="store-coupon-type">Tipo de desconto</label>
              <select id="store-coupon-type" value={form.discountType}
                onChange={(e) => setForm({ ...form, discountType: e.target.value === 'fixed' ? 'fixed' : 'percent', value: '' })}>
                <option value="percent">Porcentagem</option>
                <option value="fixed">Valor fixo</option>
              </select>
            </div>
            <div className="form-group">
              <label htmlFor="store-coupon-value">{form.discountType === 'percent' ? 'Desconto (%)' : 'Desconto por pedido (R$)'}</label>
              <input id="store-coupon-value" type="number" min="0.01" step="0.01" required
                max={form.discountType === 'percent' ? 100 : 21474836.47} value={form.value}
                onChange={(e) => setForm({ ...form, value: e.target.value })} />
            </div>
            <div className="form-group">
              <label htmlFor="store-coupon-scope">Aplicar a</label>
              <select id="store-coupon-scope" value={form.scope}
                onChange={(e) => setForm({ ...form, scope: e.target.value as StoreCoupon['scope'] })}>
                {Object.entries(scopeLabels).map(([key, label]) => <option value={key} key={key}>{label}</option>)}
              </select>
            </div>
          </div>
          {form.scope === 'category' && (
            <div className="form-group">
              <label htmlFor="store-coupon-category">Categoria de produto</label>
              <select id="store-coupon-category" value={form.category} required onChange={(e) => setForm({ ...form, category: e.target.value })}>
                <option value="">Selecione uma categoria</option>
                <CategoryOptions kind="product" current={form.category} />
              </select>
            </div>
          )}
          {form.scope === 'products' && (
            <fieldset className="store-coupon-products">
              <legend>Produtos elegíveis</legend>
              {!products.length && <p>Nenhum produto cadastrado.</p>}
              {products.map((product) => (
                <label key={product.id}>
                  <input type="checkbox" checked={form.productIds.includes(product.id)} onChange={(e) => setForm({
                    ...form, productIds: e.target.checked ? [...form.productIds, product.id] : form.productIds.filter((id) => id !== product.id),
                  })} />
                  {product.name}
                </label>
              ))}
            </fieldset>
          )}
          <label className="store-coupon-enabled">
            <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> Cupom ativo
          </label>
          <div className="store-coupon-actions">
            <button className="btn-primary" type="submit">{editing ? 'Salvar alterações' : 'Adicionar cupom'}</button>
            {editing && <button className="btn-secondary" type="button" onClick={clearForm}>Cancelar</button>}
          </div>
        </fieldset>
      </form>
      {error && <p className="error-message" role="alert">{error}</p>}
      {notice && <p className="business-notice" role="status">{notice}</p>}
      {loading && <p role="status">Carregando cupons…</p>}
      {!loading && !coupons.length && !error && <p>Nenhum cupom cadastrado.</p>}
      {!!coupons.length && <ul className="store-coupon-list">
        {[...coupons].sort((a, b) => a.code.localeCompare(b.code)).map((coupon) => (
          <li key={coupon.id}>
            <div>
              <strong>{coupon.code}</strong>
              <p>{coupon.discount_type === 'percent' ? (coupon.discount_value / 100).toLocaleString('pt-BR') + '%' : currency.format(coupon.discount_value / 100)}
                {' · '}{scopeLabels[coupon.scope]}{coupon.category ? ' (' + coupon.category + ')' : ''}{coupon.scope === 'products' ? ' (' + coupon.product_ids.length + ')' : ''}
                {' · '}{coupon.active ? 'Ativo' : 'Inativo'}</p>
            </div>
            <div className="store-coupon-actions">
              <button className="btn-secondary" type="button" aria-label={'Editar ' + coupon.code} disabled={busy} onClick={() => startEdit(coupon)}>Editar</button>
              <button className="btn-secondary" type="button" aria-label={'Excluir ' + coupon.code} disabled={busy} onClick={() => remove(coupon)}>Excluir</button>
            </div>
          </li>
        ))}
      </ul>}
    </section>
  );
}
