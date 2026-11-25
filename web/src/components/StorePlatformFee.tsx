import { useState, type FormEvent } from 'react';
import axios from 'axios';
import { useFeedback } from './Feedback';
import { updateBusinessPlatformFee } from '../services/api';

const formatPercent = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });

export function StorePlatformFee({ businessId, fee, admin, onSave, hasAppliedCondition }: {
  businessId: string;
  fee: number | null;
  admin: boolean;
  onSave: (fee: number | null) => void;
  hasAppliedCondition: boolean;
}) {
  const { showToast } = useFeedback();
  const [input, setInput] = useState(() => fee === null ? '' : formatPercent.format(fee / 100));
  const [saving, setSaving] = useState(false);
  const raw = input.trim();
  const validInput = raw === '' || /^\d{1,3}(?:[.,]\d{1,2})?$/.test(raw) && Number(raw.replace(',', '.')) <= 100;
  const nextFee = raw === '' ? null : Math.round(Number(raw.replace(',', '.')) * 100);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!admin || saving || !validInput || fee === nextFee) return;
    setSaving(true);
    try {
      const savedFee = await updateBusinessPlatformFee(businessId, nextFee);
      onSave(savedFee);
      setInput(savedFee === null ? '' : formatPercent.format(savedFee / 100));
      showToast('Taxa da plataforma atualizada.');
    } catch (error) {
      showToast(axios.isAxiosError(error) && typeof error.response?.data?.error === 'string'
        ? error.response.data.error : 'Não foi possível salvar a taxa da plataforma.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="business-info" aria-labelledby="platform-fee-heading">
      <h2 id="platform-fee-heading">Taxa da plataforma</h2>
      {admin ? (
        <form className="business-edit-form" onSubmit={save}>
          <div className="business-edit-grid">
            <div className="form-group">
              <label htmlFor="platform-fee-rate">Percentual negociado (%)</label>
              <input id="platform-fee-rate" inputMode="decimal" autoComplete="off" maxLength={6}
                value={input} disabled={saving} onChange={(event) => setInput(event.target.value)}
                aria-invalid={!validInput} aria-describedby="platform-fee-hint" />
              <small id="platform-fee-hint">{validInput
                ? 'Deixe em branco para indicar que a taxa ainda não foi definida.'
                : 'Informe um percentual de 0 a 100 com até duas casas decimais.'}</small>
            </div>
          </div>
          <button type="submit" className="btn-primary" disabled={saving || !validInput || fee === nextFee}>
            {saving ? 'Salvando…' : 'Salvar taxa'}
          </button>
        </form>
      ) : (
        <p>{hasAppliedCondition ? 'Taxa negociada de referência: ' : ''}{fee === null ? 'Ainda não definida.' : <strong>{formatPercent.format(fee / 100)}%</strong>}</p>
      )}
    </section>
  );
}