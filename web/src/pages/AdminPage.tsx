import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AdminBusiness, Seller, createSeller, getAdminBusinesses, getSellers, setAdminBlock, transferBusiness, updateSeller } from '../services/api';
import { AdminCategories } from '../components/AdminCategories';
import '../styles/dashboard.css';
import '../styles/product-form.css';

export function AdminPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [businesses, setBusinesses] = useState<AdminBusiness[]>([]);
  const [sellers, setSellers] = useState<Seller[]>([]);
  const [owners, setOwners] = useState<Record<string, string>>({});
  const [form, setForm] = useState({ fullName: '', email: '', password: '' });
  const [editingSeller, setEditingSeller] = useState<string | null>(null);
  const [sellerForm, setSellerForm] = useState({ fullName: '', email: '', phone: '' });
  const activeSellers = sellers.filter((seller) => seller.status === 'active');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function loadData() {
    const [businessData, sellerData] = await Promise.all([getAdminBusinesses(), getSellers(true)]);
    setBusinesses(businessData);
    setSellers(sellerData);
    setOwners(Object.fromEntries(businessData.map((business) => [business.id, business.owner_id])));
  }

  useEffect(() => {
    loadData().catch((err) => {
      console.error('Erro ao carregar painel administrativo:', err);
      setError('Não foi possível carregar lojas e lojistas.');
    }).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (location.hash !== '#cadastrar-lojista' && location.hash !== '#transferir-loja') return;
    const section = document.getElementById(location.hash.slice(1));
    if (!section) return;
    section.focus({ preventScroll: true });
    const headerHeight = document.querySelector('.header')?.getBoundingClientRect().height || 0;
    window.scrollTo({ top: window.scrollY + section.getBoundingClientRect().top - headerHeight - 16, behavior: 'smooth' });
  }, [location.hash, location.key]);

  async function handleCreateSeller(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError('');
    setNotice('');
    try {
      await createSeller(form.fullName, form.email, form.password);
      setForm({ fullName: '', email: '', password: '' });
      setNotice('Lojista cadastrado. Compartilhe a senha inicial com segurança.');
      await loadData();
    } catch (err: any) {
      console.error('Erro ao cadastrar lojista:', err);
      setError(err.response?.data?.error || 'Não foi possível cadastrar o lojista.');
    } finally {
      setSaving(false);
    }
  }

  async function handleTransfer(businessId: string) {
    setSaving(true);
    setError('');
    setNotice('');
    try {
      await transferBusiness(businessId, owners[businessId]);
      setNotice('Loja transferida com sucesso.');
      await loadData();
    } catch (err: any) {
      console.error('Erro ao transferir loja:', err);
      setError(err.response?.data?.error || 'Não foi possível transferir a loja.');
    } finally {
      setSaving(false);
    }
  }

  async function changeAdminData(action: () => Promise<unknown>, successMessage: string) {
    setSaving(true);
    setError('');
    setNotice('');
    try {
      await action();
      await loadData();
      setNotice(successMessage);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Não foi possível concluir a alteração.');
    } finally {
      setSaving(false);
    }
  }

  function handleBlock(resource: 'sellers' | 'businesses', id: string, name: string, blocked: boolean) {
    const message = resource === 'sellers'
      ? 'Bloquear ' + name + '? O lojista perderá o acesso e todas as suas lojas sairão do catálogo.'
      : 'Bloquear ' + name + '? A loja sairá do catálogo e deixará de aceitar novos pedidos.';
    if (blocked && !window.confirm(message)) return;
    void changeAdminData(
      () => setAdminBlock(resource, id, blocked),
      blocked ? 'Bloqueio aplicado.' : 'Bloqueio removido.'
    );
  }

  return (
    <div className="dashboard">
      <div className="container">
        <div className="page-heading">
          <h1>Administração do marketplace</h1>
          <button onClick={() => navigate('/new-business')} className="btn-primary">+ Nova loja</button>
        </div>
        {error && <p className="error-message" role="alert">{error}</p>}
        {notice && <p role="status">{notice}</p>}
        <section id="cadastrar-lojista" className="form-box" tabIndex={-1}>
          <h2>Cadastrar lojista</h2>
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
            <button type="submit" className="btn-primary" disabled={saving}>Cadastrar lojista</button>
          </form>
        </section>

        <AdminCategories />

        <section aria-labelledby="sellers-heading">
          <h2 id="sellers-heading">Lojistas</h2>
          {loading ? <p>Carregando...</p> : sellers.length === 0 ? <p>Nenhum lojista cadastrado.</p> : (
            <div className="business-grid card-grid card-grid-5">
              {sellers.map((seller) => (
                <article key={seller.id} className="business-card card-layout">
                  <h3 className="card-row-1">{seller.full_name}</h3>
                  <p className="card-row-2">{seller.email}</p>
                  <p className="card-row-3">{seller.phone || 'Telefone não cadastrado'}</p>
                  <p className="card-row-4">{seller.status === 'active' ? 'Ativo' : seller.status === 'suspended' ? 'Bloqueado' : 'Inativo'}</p>
                  <div className="card-footer card-row-5">
                    {editingSeller === seller.id ? (
                      <form onSubmit={(event) => {
                        event.preventDefault();
                        void changeAdminData(async () => {
                          await updateSeller(seller.id, sellerForm);
                          setEditingSeller(null);
                        }, 'Dados do lojista atualizados.');
                      }}>
                        <div className="form-group">
                          <label htmlFor="edit-seller-name">Nome</label>
                          <input id="edit-seller-name" required maxLength={255} disabled={saving} value={sellerForm.fullName}
                            onChange={(event) => setSellerForm({ ...sellerForm, fullName: event.target.value })} />
                        </div>
                        <div className="form-group">
                          <label htmlFor="edit-seller-email">E-mail</label>
                          <input id="edit-seller-email" type="email" required maxLength={255} disabled={saving} value={sellerForm.email}
                            onChange={(event) => setSellerForm({ ...sellerForm, email: event.target.value })} />
                        </div>
                        <div className="form-group">
                          <label htmlFor="edit-seller-phone">Telefone</label>
                          <input id="edit-seller-phone" type="tel" maxLength={20} disabled={saving} value={sellerForm.phone}
                            onChange={(event) => setSellerForm({ ...sellerForm, phone: event.target.value })} />
                        </div>
                        <div className="card-actions">
                          <button type="submit" className="btn-primary" disabled={saving}>Salvar</button>
                          <button type="button" className="btn-secondary" disabled={saving} onClick={() => setEditingSeller(null)}>Cancelar</button>
                        </div>
                      </form>
                    ) : (
                      <div className="card-actions">
                        <button type="button" className="btn-primary" disabled={saving} onClick={() => {
                          setSellerForm({ fullName: seller.full_name, email: seller.email, phone: seller.phone || '' });
                          setEditingSeller(seller.id);
                        }}>Editar dados</button>
                        <button type="button" className="btn-secondary" disabled={saving}
                          onClick={() => handleBlock('sellers', seller.id, seller.full_name, seller.status === 'active')}>
                          {seller.status === 'active' ? 'Bloquear lojista' : 'Reativar lojista'}
                        </button>
                      </div>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        <section id="transferir-loja" tabIndex={-1}>
          <h2>Lojas do marketplace</h2>
          {loading ? <p>Carregando...</p> : businesses.length === 0 ? <p>Nenhuma loja cadastrada.</p> :
            <div className="business-grid card-grid card-grid-6">
              {businesses.map((business) => (
                <div className="business-card card-layout" key={business.id}>
                  <h3 className="card-row-1">{business.name}</h3>
                  <p className="category card-row-2">{business.category}</p>
                  <p className="description card-row-3">{business.description}</p>
                  <p className="business-owner card-row-4">Lojista atual: {business.owner_name} ({business.owner_email})</p>
                  <p className="card-row-5">
                    {business.status === 'suspended' ? 'Bloqueio individual ativo' : business.status === 'inactive' ? 'Loja inativa' : business.owner_status === 'active' ? 'Loja ativa' : 'Bloqueada pelo status do lojista'}
                    {business.status !== 'active' && business.owner_status !== 'active' && ' · Lojista sem acesso'}
                  </p>
                  <div className="card-footer card-row-6">
                    <div className="form-group">
                      <label htmlFor={`owner-${business.id}`}>Transferir para</label>
                      <select id={`owner-${business.id}`} value={owners[business.id] || ''} onChange={(event) => setOwners({ ...owners, [business.id]: event.target.value })}>
                        {!activeSellers.some((seller) => seller.id === business.owner_id) && <option value={business.owner_id}>{business.owner_name} (proprietário atual)</option>}
                        {activeSellers.map((seller) => <option key={seller.id} value={seller.id}>{seller.full_name} ({seller.email})</option>)}
                      </select>
                    </div>
                    <div className="card-actions">
                      <button className="btn-primary" onClick={() => navigate(`/business/${business.id}`)}>Gerenciar</button>
                      <button type="button" className="btn-secondary" disabled={saving}
                        onClick={() => handleBlock('businesses', business.id, business.name, business.status === 'active')}>
                        {business.status === 'active' ? 'Bloquear loja' : 'Reativar loja'}
                      </button>
                      <button className="btn-secondary" disabled={saving || owners[business.id] === business.owner_id || !owners[business.id]} onClick={() => handleTransfer(business.id)}>Transferir</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>}
        </section>
      </div>
    </div>
  );
}
