import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createBusiness, getSellers, Seller } from '../services/api';
import '../styles/product-form.css';

export function NewBusinessPage() {
  const navigate = useNavigate();
  const [sellers, setSellers] = useState<Seller[]>([]);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    category: 'geral',
    ownerId: '',
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    getSellers().then(setSellers).catch((err) => {
      console.error('Erro ao carregar lojistas:', err);
      setError('Não foi possível carregar os lojistas.');
    });
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await createBusiness(formData.name, formData.description, formData.category, formData.ownerId);
      navigate('/admin');
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to create business');
    } finally {
      setLoading(false);
    }
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  }

  return (
    <div className="product-form-container">
      <div className="form-box">
        <h1>Criar Nova Loja</h1>
        
        <form onSubmit={handleSubmit}>
          {error && <div className="error-message">{error}</div>}
          <div className="form-group">
            <label htmlFor="ownerId">Lojista responsável *</label>
            <select id="ownerId" name="ownerId" value={formData.ownerId} onChange={handleChange} required>
              <option value="">Selecione um lojista</option>
              {sellers.map((seller) => <option key={seller.id} value={seller.id}>{seller.full_name} ({seller.email})</option>)}
            </select>
          </div>
          
          <div className="form-group">
            <label htmlFor="name">Nome da Loja *</label>
            <input
              id="name"
              name="name"
              type="text"
              value={formData.name}
              onChange={handleChange}
              placeholder="Ex: Loja de Roupas ABC"
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="description">Descrição *</label>
            <textarea
              id="description"
              name="description"
              value={formData.description}
              onChange={handleChange}
              placeholder="Descreva sua loja..."
              rows={4}
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="category">Categoria *</label>
            <select
              id="category"
              name="category"
              value={formData.category}
              onChange={handleChange}
              required
            >
              <option value="">Selecione uma categoria</option>
              <option value="roupas">Roupas</option>
              <option value="alimentos">Alimentos</option>
              <option value="eletronicos">Eletrônicos</option>
              <option value="livros">Livros</option>
              <option value="servicos">Serviços</option>
              <option value="geral">Geral</option>
            </select>
          </div>

          <div className="form-actions">
            <button
              type="button"
              onClick={() => navigate('/admin')}
              className="btn-secondary"
            >
              Cancelar
            </button>
            <button type="submit" disabled={loading} className="btn-primary">
              {loading ? 'Criando...' : 'Criar Loja'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
