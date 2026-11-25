import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useFeedback } from '../components/Feedback';
import { createSeller } from '../services/api';

export function AdminNewSellerPage() {
  const navigate = useNavigate();
  const { showToast } = useFeedback();
  const [form, setForm] = useState({ fullName: '', email: '', password: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleCreateSeller(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      await createSeller(form.fullName, form.email, form.password);
      navigate('/admin/lojistas');
      showToast('Lojista cadastrado. Compartilhe a senha inicial com segurança.');
    } catch (err: any) {
      console.error('Erro ao cadastrar lojista:', err);
      setError(err.response?.data?.error || 'Não foi possível cadastrar o lojista.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="form-box">
      <h2>Cadastrar lojista</h2>
      {error && <p className="error-message" role="alert">{error}</p>}
      <form onSubmit={handleCreateSeller}>
        <div className="form-group">
          <label htmlFor="seller-name">Nome</label>
          <input id="seller-name" required value={form.fullName} onChange={(event) => setForm({ ...form, fullName: event.target.value })} />
        </div>
        <div className="form-group">
          <label htmlFor="seller-email">E-mail</label>
          <input id="seller-email" type="email" required value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} />
        </div>
        <div className="form-group">
          <label htmlFor="seller-password">Senha inicial</label>
          <input id="seller-password" type="password" autoComplete="new-password" minLength={8} required value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} />
        </div>
        <div className="form-actions">
          <Link to="/admin/lojistas" className="btn-secondary">Cancelar</Link>
          <button type="submit" className="btn-primary" disabled={saving}>Cadastrar lojista</button>
        </div>
      </form>
    </section>
  );
}
