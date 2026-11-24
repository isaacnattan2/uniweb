import { useState, type FormEvent } from 'react';
import axios from 'axios';
import { createStoreAsaasAccount } from '../services/api';
import { useFeedback } from './Feedback';

const fields = [
  { name: 'name', label: 'Nome ou razão social' },
  { name: 'email', label: 'E-mail', type: 'email' },
  { name: 'mobilePhone', label: 'Celular com DDD', type: 'tel' },
  { name: 'postalCode', label: 'CEP' },
  { name: 'address', label: 'Logradouro' },
  { name: 'addressNumber', label: 'Número' },
  { name: 'province', label: 'Bairro' },
  { name: 'complement', label: 'Complemento (opcional)', optional: true },
];

export function StoreAsaasRegistration({ businessId, onCreated }: { businessId: string; onCreated: () => void }) {
  const [organization, setOrganization] = useState(false);
  const [saving, setSaving] = useState(false);
  const { showToast } = useFeedback();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const form = new FormData(event.currentTarget);
    const value = (name: string) => String(form.get(name) ?? '').trim();
    setSaving(true);
    try {
      await createStoreAsaasAccount(businessId, {
        name: value('name'), email: value('email'), cpfCnpj: value('cpfCnpj'),
        mobilePhone: value('mobilePhone'), postalCode: value('postalCode'),
        address: value('address'), addressNumber: value('addressNumber'),
        province: value('province'), complement: value('complement'),
        incomeValue: Number(value('incomeValue')), birthDate: value('birthDate'), companyType: value('companyType'),
      });
      showToast('Subconta de teste criada. Confira a situação cadastral.');
      onCreated();
    } catch (error) {
      showToast(axios.isAxiosError(error) && typeof error.response?.data?.error === 'string'
        ? error.response.data.error : 'Não foi possível criar a subconta no Asaas.');
      if (axios.isAxiosError(error) && [409, 502].includes(error.response?.status ?? 0)) onCreated();
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="business-edit-form" onSubmit={submit}>
      <p>Use dados destinados a teste. O Asaas recebe os dados para cadastrar a subconta no Sandbox.</p>
      <div className="business-edit-grid">
        <label className="form-group">
          Tipo de titular
          <select value={organization ? 'company' : 'individual'} onChange={(event) => setOrganization(event.target.value === 'company')} disabled={saving}>
            <option value="individual">Pessoa física</option>
            <option value="company">Pessoa jurídica</option>
          </select>
        </label>
        <label className="form-group">
          {organization ? 'CNPJ' : 'CPF'}
          <input name="cpfCnpj" inputMode="numeric" maxLength={18} required disabled={saving} />
        </label>
        {organization ? (
          <label className="form-group">
            Tipo de empresa
            <select name="companyType" required disabled={saving}>
              <option value="">Selecione</option>
              <option value="MEI">MEI</option>
              <option value="LIMITED">Limitada</option>
              <option value="INDIVIDUAL">Empresário individual</option>
              <option value="ASSOCIATION">Associação</option>
            </select>
          </label>
        ) : (
          <label className="form-group">
            Data de nascimento
            <input name="birthDate" type="date" required disabled={saving} />
          </label>
        )}
        <label className="form-group">
          {organization ? 'Faturamento mensal em reais' : 'Renda mensal em reais'}
          <input name="incomeValue" type="number" min="0.01" step="0.01" required disabled={saving} />
        </label>
        {fields.map(({ name, label, type, optional }) => (
          <label className="form-group" key={name}>
            {label}
            <input name={name} type={type ?? 'text'} maxLength={name === 'email' ? 255 : 150} required={!optional} disabled={saving} />
          </label>
        ))}
      </div>
      <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Criando subconta…' : 'Criar subconta de teste no Asaas'}</button>
    </form>
  );
}