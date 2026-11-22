import { CategoryOptions } from '../components/CategoryOptions';
import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { StoreCoupons } from '../components/StoreCoupons';
import { StorePaymentSettings } from '../components/StorePaymentSettings';
import { useParams, useNavigate } from 'react-router-dom';
import { getBusiness, getProductsByBusiness, updateBusiness } from '../services/api';
import { useAuthStore, useBusinessStore, useProductStore } from '../context/store';
import '../styles/business.css';
import '../styles/product-form.css';

export function BusinessPage() {
  const { businessId } = useParams<{ businessId: string }>();
  const navigate = useNavigate();
  const userType = useAuthStore((state) => state.userType);
  const dashboardPath = userType === 'admin' ? '/admin' : '/dashboard';
  const currentBusiness = useBusinessStore((state) => state.currentBusiness);
  const setCurrentBusiness = useBusinessStore((state) => state.setCurrentBusiness);
  const products = useProductStore((state) => state.products);
  const setProducts = useProductStore((state) => state.setProducts);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState('');
  const [notice, setNotice] = useState('');
  const [form, setForm] = useState({ name: '', category: '', description: '' });

  useEffect(() => {
    if (!businessId) return;

    async function loadBusiness() {
      try {
        setLoading(true);
        const business = await getBusiness(businessId);
        setCurrentBusiness(business);

        const productsData = await getProductsByBusiness(businessId);
        setProducts(productsData || []);
      } catch (err: any) {
        console.error('Failed to load business:', err);
        setError(err.response?.data?.error || 'Erro ao carregar loja');
      } finally {
        setLoading(false);
      }
    }

    loadBusiness();
  }, [businessId, setCurrentBusiness, setProducts]);

  function startEditing() {
    if (!currentBusiness) return;
    setForm({
      name: currentBusiness.name,
      category: currentBusiness.category || '',
      description: currentBusiness.description || '',
    });
    setEditError('');
    setNotice('');
    setEditing(true);
  }

  async function handleSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!businessId || saving) return;
    if (!form.name.trim() || !form.category.trim()) {
      setEditError('Informe o nome e a categoria da loja.');
      return;
    }
    setSaving(true);
    setEditError('');
    try {
      const business = await updateBusiness(businessId, form);
      setCurrentBusiness(business);
      setEditing(false);
      setNotice('Dados da loja atualizados com sucesso.');
    } catch (err: unknown) {
      console.error('Erro ao atualizar loja:', err);
      const message = axios.isAxiosError(err) && typeof err.response?.data?.error === 'string'
        ? err.response.data.error
        : 'Não foi possível atualizar a loja. Tente novamente.';
      setEditError(message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="container"><p>Carregando...</p></div>;
  }

  if (error) {
    return (
      <div className="container">
        <div style={{ padding: '20px', color: 'red' }}>
          <p>Erro: {error}</p>
          <button onClick={() => navigate(dashboardPath)}>Voltar</button>
        </div>
      </div>
    );
  }

  if (!currentBusiness) {
    return <div className="container"><p>Loja não encontrada</p></div>;
  }

  return (
    <div className="business-page">
      <div className="container">
        <button className="page-back" onClick={() => navigate(dashboardPath)}>← Voltar</button>
        <div className="page-heading">
          <h1>{currentBusiness.name}</h1>
        </div>
        <div className="business-info">
          <div className="business-info-heading">
            <h2>Informações da Loja</h2>
            {!editing && <button type="button" className="btn-secondary" onClick={startEditing}>Editar dados</button>}
          </div>
          {notice && <p className="business-notice" role="status">{notice}</p>}
          {editing ? (
            <form onSubmit={handleSave}>
              {editError && <div className="error-message" role="alert">{editError}</div>}
              <div className="form-group">
                <label htmlFor="business-name">Nome da loja *</label>
                <input id="business-name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} maxLength={255} required disabled={saving} />
              </div>
              <div className="form-group">
                <label htmlFor="business-category">Categoria *</label>
                <select id="business-category" value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} required disabled={saving}>
                  <option value="">Selecione uma categoria</option>
                  <CategoryOptions kind="business" current={form.category} />
                </select>
              </div>
              <div className="form-group">
                <label htmlFor="business-description">Descrição</label>
                <textarea id="business-description" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} rows={4} disabled={saving} />
              </div>
              <div className="form-actions business-edit-actions">
                <button type="button" className="btn-secondary" onClick={() => setEditing(false)} disabled={saving}>Cancelar</button>
                <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Salvando...' : 'Salvar alterações'}</button>
              </div>
            </form>
          ) : (
            <>
              <p><strong>Categoria:</strong> {currentBusiness.category || 'N/A'}</p>
              <p><strong>Descrição:</strong> {currentBusiness.description || 'Não informada'}</p>
              <p><strong>Status:</strong> {currentBusiness.status}</p>
            </>
          )}
        </div>

        <StorePaymentSettings key={currentBusiness.id} business={currentBusiness} onSave={setCurrentBusiness} />

        <StoreCoupons key={currentBusiness.id} businessId={currentBusiness.id} products={products ?? []} />

        <div className="products-section">
          <div className="business-info-heading">
            <h2>Produtos ({products?.length || 0})</h2>
            {!!products?.length && <button onClick={() => navigate('/business/' + businessId + '/new-product')} className="btn-primary">
              + Adicionar produto
            </button>}
          </div>
          
          {!products || products.length === 0 ? (
            <div className="empty-state">
              <p>Nenhum produto cadastrado</p>
              <button onClick={() => navigate(`/business/${businessId}/new-product`)} className="btn-primary">
                Adicionar Primeiro Produto
              </button>
            </div>
          ) : (
            <div className="products-table">
              <table>
                <thead>
                  <tr>
                    <th>Nome</th>
                    <th>Categoria</th>
                    <th>Preço</th>
                    <th>Quantidade</th>
                    <th>Status</th>
                    <th>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {products.map((product: any) => (
                    <tr key={product.id}>
                      <td>{product.name}</td>
                      <td>{product.category}</td>
                      <td>R$ {Number(product.price).toFixed(2)}</td>
                      <td>{product.stock}</td>
                      <td>{product.status}</td>
                      <td>
                        <button
                          onClick={() => navigate(`/business/${businessId}/product/${product.id}/edit`)}
                          className="btn-small"
                        >
                          Editar
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
