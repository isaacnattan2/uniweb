import { StoreSplitConditions } from '../components/StoreSplitConditions';
import { AdminStoreAsaas } from '../components/AdminStoreAsaas';
import { CategoryOptions } from '../components/CategoryOptions';
import { useFeedback } from '../components/Feedback';
import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { CheckoutAddress, emptyDeliveryAddress, isDeliveryAddressComplete } from '../components/CheckoutAddress';
import type { DeliveryAddress } from '../services/api';
import { StoreCoupons } from '../components/StoreCoupons';
import { StoreOrders } from '../components/StoreOrders';
import { StoreWithdrawals } from '../components/StoreWithdrawals';
import { StorePlatformFee } from '../components/StorePlatformFee';
import { StorePaymentSettings } from '../components/StorePaymentSettings';
import { Link, useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { getBusiness, getProductsByBusiness, updateBusiness } from '../services/api';
import { useAuthStore, useBusinessStore, useProductStore } from '../context/store';
import '../styles/dashboard.css';
import '../styles/business.css';
import '../styles/product-form.css';

const businessSections = [
  { id: 'dados', label: 'Dados da loja' },
  { id: 'pedidos', label: 'Pedidos' },
  { id: 'produtos', label: 'Produtos' },
  { id: 'cupons', label: 'Cupons' },
  { id: 'pagamentos', label: 'Pagamentos' },
  { id: 'asaas', label: 'Saques Asaas' },
] as const;

function parseStoreAddress(value: string): DeliveryAddress | null {
  const match = /^([^·]+), ([^,·]+)(?: · Complemento: ([^·]+))?(?: · Bairro: ([^·]+))? · ([^·]+)\/([A-Z]{2}) · CEP (\d{5}-\d{3})$/.exec(value);
  if (!match) return null;
  const [, street, number, complement = '', neighborhood = '', city, state, cep] = match;
  const address = { street, number, complement, neighborhood, city, state, cep };
  return isDeliveryAddressComplete(address) ? address : null;
}

export function BusinessPage() {
  const { businessId } = useParams<{ businessId: string }>();
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const sectionId = search.get('aba');
  const activeSection = search.get('order') ? 'pedidos'
    : businessSections.find(({ id }) => id === sectionId)?.id ?? 'dados';
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
  const { showToast } = useFeedback();
  const [form, setForm] = useState({ name: '', category: '', description: '' });
  const [address, setAddress] = useState(emptyDeliveryAddress);
  const [previousAddress, setPreviousAddress] = useState('');
  const [addressVersion, setAddressVersion] = useState(0);

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
    const savedAddress = currentBusiness.address || '';
    const parsedAddress = parseStoreAddress(savedAddress);
    setAddress(parsedAddress ?? emptyDeliveryAddress);
    setPreviousAddress(parsedAddress ? '' : savedAddress);
    setEditError('');
    setEditing(true);
  }

  async function handleSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!businessId || saving) return;
    if (!form.name.trim() || !form.category.trim()) {
      setEditError('Informe o nome e a categoria da loja.');
      return;
    }
    let storeAddress = previousAddress;
    if (Object.values(address).some((value) => value.trim())) {
      if (!isDeliveryAddressComplete(address)) {
        setEditError('Preencha CEP, logradouro, número, cidade e UF para salvar o endereço.');
        return;
      }
      const { street, number, complement, neighborhood, city, state, cep } = address;
      if (Object.values(address).some((value) => value.includes('·')) || number.includes(',')) {
        setEditError('Evite usar o caractere “·” nos campos de endereço e vírgulas no número.');
        return;
      }
      storeAddress = [
        street.trim() + ', ' + number.trim(),
        complement.trim() && 'Complemento: ' + complement.trim(),
        neighborhood.trim() && 'Bairro: ' + neighborhood.trim(),
        city.trim() + '/' + state,
        'CEP ' + cep,
      ].filter(Boolean).join(' · ');
      if (storeAddress.length > 300) {
        setEditError('O endereço da loja deve ter até 300 caracteres no total.');
        return;
      }
    }
    setSaving(true);
    setEditError('');
    try {
      const business = await updateBusiness(businessId, { ...form, address: storeAddress || null });
      setCurrentBusiness(business);
      setEditing(false);
      showToast('Dados da loja atualizados com sucesso.');
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

        {userType === 'admin' && (
          <nav className="admin-menu" aria-label="Gerenciamento da loja">
            {businessSections.map(({ id, label }) => (
              <Link key={id} to={'?aba=' + id} aria-current={activeSection === id ? 'page' : undefined}>
                {id === 'asaas' ? 'Cadastro Asaas' : label}
              </Link>
            ))}
          </nav>
        )}

        {activeSection === 'dados' && <div className="business-info">
          <div className="business-info-heading">
            <h2>Informações da Loja</h2>
            {!editing && <button type="button" className="btn-secondary" onClick={startEditing}>Editar dados</button>}
          </div>
          {editing ? (
            <form className="business-edit-form" onSubmit={handleSave}>
              {editError && <div className="error-message" role="alert">{editError}</div>}
              <div className="business-edit-grid">
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
              </div>
              <div className="form-group">
                <label htmlFor="business-description">Descrição</label>
                <textarea id="business-description" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} rows={4} disabled={saving} />
              </div>
              <CheckoutAddress key={addressVersion} address={address} onChange={setAddress} disabled={saving}
                title="Endereço da loja (opcional)"
                description="Exibido na página pública da loja e na opção de retirada." />
              {previousAddress && <p><strong>Endereço atual:</strong> {previousAddress}</p>}
              {(previousAddress || Object.values(address).some(Boolean)) && (
                <button type="button" className="btn-secondary business-address-clear" disabled={saving}
                  onClick={() => {
                    setAddress(emptyDeliveryAddress);
                    setPreviousAddress('');
                    setAddressVersion((version) => version + 1);
                  }}>Limpar endereço</button>
              )}
              <div className="form-actions business-edit-actions">
                <button type="button" className="btn-secondary" onClick={() => setEditing(false)} disabled={saving}>Cancelar</button>
                <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Salvando...' : 'Salvar alterações'}</button>
              </div>
            </form>
          ) : (
            <dl className="business-edit-grid business-details">
              <div><dt>Categoria</dt><dd>{currentBusiness.category || 'N/A'}</dd></div>
              <div><dt>Status</dt><dd>{currentBusiness.status}</dd></div>
              <div><dt>Descrição</dt><dd>{currentBusiness.description || 'Não informada'}</dd></div>
              <div><dt>Endereço</dt><dd>{currentBusiness.address || 'Não informado'}</dd></div>
            </dl>
          )}
        </div>}

        {activeSection === 'pedidos' && <StoreOrders key={currentBusiness.id} businessId={currentBusiness.id} />}
        {activeSection === 'pagamentos' && (
          <>
            <StorePlatformFee key={currentBusiness.id} businessId={currentBusiness.id} admin={userType === 'admin'}
              fee={currentBusiness.platform_fee_basis_points ?? null}
              hasAppliedCondition={Boolean(currentBusiness.asaas_pix_split_condition || currentBusiness.asaas_card_split_condition)}
              onSave={(fee) => {
                const business = useBusinessStore.getState().currentBusiness;
                if (business?.id === currentBusiness.id) setCurrentBusiness({ ...business, platform_fee_basis_points: fee });
              }} />
            <StoreSplitConditions key={currentBusiness.id} business={currentBusiness} admin={userType === 'admin'}
              onRemove={(method, version) => {
                const column = method === 'pix' ? 'asaas_pix_split_condition' : 'asaas_card_split_condition';
                const business = useBusinessStore.getState().currentBusiness;
                if (business?.id === currentBusiness.id && business[column]?.version === version) {
                  setCurrentBusiness({ ...business, [column]: null });
                }
              }} />
            <StorePaymentSettings key={currentBusiness.id} business={currentBusiness} onSave={setCurrentBusiness} />
          </>
        )}
        {activeSection === 'asaas' && (userType === 'admin'
          ? <AdminStoreAsaas key={currentBusiness.id} accountId={currentBusiness.id} />
          : <StoreWithdrawals key={currentBusiness.id} businessId={currentBusiness.id} />)}
        {activeSection === 'cupons' && <StoreCoupons key={currentBusiness.id} businessId={currentBusiness.id} products={products ?? []} />}

        {activeSection === 'produtos' && <div className="products-section">
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
            <div className="products-table list-panel">
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
        </div>}
      </div>
    </div>
  );
}
