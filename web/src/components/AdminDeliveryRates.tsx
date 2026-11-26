import React, { useEffect, useState } from 'react';
import { useFeedback } from './Feedback';
import { getAdminDeliveryRatePolicy, saveAdminDeliveryRatePolicy } from '../services/api';
import type { DeliveryRatePolicy } from '../services/api';

const fields = [
  ['defaultCents', 'Taxa padrão (R$/km)'],
  ['minimumCents', 'Taxa mínima (R$/km, opcional)'],
  ['maximumCents', 'Taxa máxima (R$/km, opcional)'],
] as const;

const initialForm = { minimumCents: '', maximumCents: '', defaultCents: '', allowCustom: false };

function toForm(policy: DeliveryRatePolicy) {
  return {
    minimumCents: policy.minimumCents === null ? '' : (policy.minimumCents / 100).toFixed(2),
    maximumCents: policy.maximumCents === null ? '' : (policy.maximumCents / 100).toFixed(2),
    defaultCents: (policy.defaultCents / 100).toFixed(2),
    allowCustom: policy.allowCustom,
  };
}

export function AdminDeliveryRates() {
  const [form, setForm] = useState<typeof initialForm>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const { showToast } = useFeedback();

  useEffect(() => {
    const controller = new AbortController();
    void getAdminDeliveryRatePolicy(controller.signal)
      .then((policy) => setForm(policy ? toForm(policy) : initialForm))
      .catch(() => {
        if (!controller.signal.aborted) setError('Não foi possível carregar as regras da taxa de corrida.');
      });
    return () => controller.abort();
  }, []);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!form || saving) return;
    const minimumCents = form.minimumCents === '' ? null : Math.round(Number(form.minimumCents) * 100);
    const maximumCents = form.maximumCents === '' ? null : Math.round(Number(form.maximumCents) * 100);
    const defaultCents = Math.round(Number(form.defaultCents) * 100);
    setError('');
    if (minimumCents !== null && maximumCents !== null && minimumCents > maximumCents) {
      setError('A taxa mínima deve ser menor ou igual à máxima.');
      return;
    }
    setSaving(true);
    try {
      setForm(toForm(await saveAdminDeliveryRatePolicy({ minimumCents, maximumCents, defaultCents, allowCustom: form.allowCustom })));
      showToast('Regras da taxa de corrida salvas.');
    } catch {
      setError('Não foi possível salvar as regras da taxa de corrida.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="admin-settings" aria-labelledby="delivery-rates-heading">
      <h2 id="delivery-rates-heading">Tarifas de entrega</h2>
      {error && <p className="error-message" role="alert">{error}</p>}
      {!form && !error && <p role="status">Carregando regras da taxa…</p>}
      {form && (
        <form onSubmit={(event) => void save(event)}>
          <p>A taxa padrão vale quando a personalização está bloqueada ou o entregador está sem uma taxa própria válida.</p>
          <div className="admin-rate-fields">
            {fields.map(([key, label]) => (
              <div key={key} className="form-group">
                <label htmlFor={'rate-' + key}>{label}</label>
                <input id={'rate-' + key} type="number" min="0" max="10000" step="0.01" required={key === 'defaultCents'}
                  disabled={saving} value={form[key]} onChange={(event) => setForm({ ...form, [key]: event.target.value })} />
              </div>
            ))}
          </div>
          <label className="admin-rate-checkbox">
            <input type="checkbox" checked={form.allowCustom} disabled={saving}
              onChange={(event) => setForm({ ...form, allowCustom: event.target.checked })} />
            Permitir que os entregadores definam a própria taxa
          </label>
          <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Salvando…' : 'Salvar regras da taxa'}</button>
        </form>
      )}
    </section>
  );
}
