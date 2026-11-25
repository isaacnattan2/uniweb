import { AdminPlatformBalance } from '../components/AdminPlatformBalance';
import { AdminSplitSimulator } from '../components/AdminSplitSimulator';
import React, { useEffect, useState } from 'react';
import { useFeedback } from '../components/Feedback';
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { AdminBusiness, Seller, createSeller, getAdminBusinesses, getSellers, setAdminBlock, transferBusiness, updateSeller } from '../services/api';
import { AdminAds } from '../components/AdminAds';
import { AdminAppTheme } from '../components/AdminAppTheme';
import { AdminCategories } from '../components/AdminCategories';
import { AdminDrivers } from '../components/AdminDrivers';
import '../styles/dashboard.css';
import '../styles/product-form.css';

export const adminSections = [
  { path: 'lojas', label: 'Lojas' },
  { path: 'lojistas', label: 'Lojistas' },
  { path: 'cadastrar-lojista', label: 'Cadastrar lojista' },
  { path: 'entregadores', label: 'Entregadores' },
  { path: 'categorias', label: 'Categorias' },
  { path: 'anuncios', label: 'Anúncios' },
  { path: 'financeiro', label: 'Financeiro' },
  { path: 'simulador-split', label: 'Simulador de split' },
  { path: 'cores-do-app', label: 'Cores do app' },
] as const;

type AdminSectionPath = typeof adminSections[number]['path'];

export function AdminIndex() {
  const { hash } = useLocation();
  return <Navigate to={hash === '#cadastrar-lojista' ? '/admin/cadastrar-lojista' : '/admin/lojas'} replace />;
}

export function AdminPage() {
  return (
    <main className="dashboard admin-dashboard">
      <div className="container">
        <h1>Administração do marketplace</h1>
        <nav className="admin-menu" aria-label="Menu administrativo">
          {adminSections.map(({ path, label }) => (
            <NavLink key={path} to={path}>{label}</NavLink>
          ))}
        </nav>
        <Outlet />
      </div>
    </main>
  );
}

export function AdminSection({ section }: { section: AdminSectionPath }) {
  if (section === 'entregadores') return <AdminDrivers />;
  if (section === 'categorias') return <AdminCategories />;
  if (section === 'financeiro') return <AdminPlatformBalance />;
  if (section === 'simulador-split') return <AdminSplitSimulator />;
  if (section === 'cores-do-app') return <AdminAppTheme />;
  return <AdminManagementSection section={section} />;
}

function AdminManagementSection({ section }: { section: Exclude<AdminSectionPath, 'entregadores' | 'categorias' | 'cores-do-app' | 'simulador-split' | 'financeiro'> }) {
  const navigate = useNavigate();
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
  const { confirmAction, showToast } = useFeedback();

  async function loadData() {
    const [businessData, sellerData] = await Promise.all([
      section === 'lojas' || section === 'anuncios' ? getAdminBusinesses() : [],
      section === 'lojas' || section === 'lojistas' ? getSellers(true) : [],
    ]);
    setBusinesses(businessData);
    setSellers(sellerData);
    setOwners(Object.fromEntries(businessData.map((business) => [business.id, business.owner_id])));
  }

  useEffect(() => {
    if (section === 'cadastrar-lojista') return;
    loadData().catch((err) => {
      console.error('Erro ao carregar painel administrativo:', err);
      setError('Não foi possível carregar os dados desta tela.');
    }).finally(() => setLoading(false));
  }, [section]);

  async function handleCreateSeller(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      await createSeller(form.fullName, form.email, form.password);
      setForm({ fullName: '', email: '', password: '' });
      showToast('Lojista cadastrado. Compartilhe a senha inicial com segurança.');
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
    try {
      await transferBusiness(businessId, owners[businessId]);
      showToast('Loja transferida com sucesso.');
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
    try {
      await action();
      await loadData();
      showToast(successMessage);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Não foi possível concluir a alteração.');
    } finally {
      setSaving(false);
    }
  }

  async function handleBlock(resource: 'sellers' | 'businesses', id: string, name: string, blocked: boolean) {
    const message = resource === 'sellers'
      ? 'O lojista perderá o acesso e todas as suas lojas sairão do catálogo.'
      : 'A loja sairá do catálogo e deixará de aceitar novos pedidos.';
    if (blocked && !(await confirmAction({ title: `Bloquear ${name}?`, message, confirmLabel: 'Bloquear' }))) return;
    void changeAdminData(
      () => setAdminBlock(resource, id, blocked),
      blocked ? 'Bloqueio aplicado.' : 'Bloqueio removido.'
    );
  }

  return (
    <>
        {error && <p className="error-message" role="alert">{error}</p>}
        {section === 'cadastrar-lojista' && (
          <section className="form-box">
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
        )}

        {section === 'anuncios' && <AdminAds businesses={businesses} />}

        {section === 'lojistas' && <section aria-labelledby="sellers-heading">
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
        </section>}

        {section === 'lojas' && <section aria-labelledby="businesses-heading">
          <div className="admin-section-heading">
            <h2 id="businesses-heading">Lojas do marketplace</h2>
            <Link to="/new-business" className="btn-primary">Nova loja</Link>
          </div>
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
        </section>}
    </>
  );
}
