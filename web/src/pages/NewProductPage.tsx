import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { createProduct, getBusiness } from '../services/api';
import { useProductStore } from '../context/store';
import { ImageDropzone } from '../components/ImageDropzone';
import '../styles/product-form.css';
import '../styles/dropzone.css';

export function NewProductPage() {
  const navigate = useNavigate();
  const { businessId } = useParams<{ businessId: string }>();
  const addProduct = useProductStore((state) => state.addProduct);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    price: '',
    quantity: '',
    category: 'geral',
  });
  const [images, setImages] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [uploadingImages, setUploadingImages] = useState(false);
  const [checkingAccess, setCheckingAccess] = useState(true);
  const [accessError, setAccessError] = useState('');

  useEffect(() => {
    setCheckingAccess(true);
    setAccessError('');
    if (!businessId) {
      setAccessError('Loja não encontrada.');
      setCheckingAccess(false);
      return;
    }
    let active = true;
    getBusiness(businessId).catch((err) => {
      if (active) {
        console.error('Erro ao verificar loja:', err);
        setAccessError(err.response?.data?.error || 'Não foi possível acessar a loja.');
      }
    }).finally(() => { if (active) setCheckingAccess(false); });
    return () => { active = false; };
  }, [businessId]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!businessId || uploadingImages || loading) return;
    setError('');
    setLoading(true);

    try {
      const product = await createProduct(
        businessId,
        formData.name,
        formData.description,
        parseFloat(formData.price),
        parseInt(formData.quantity),
        formData.category,
        images
      );
      addProduct(product);
      navigate(`/business/${businessId}`);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to create product');
    } finally {
      setLoading(false);
    }
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  }

  if (checkingAccess) return <div className="container"><p>Verificando acesso à loja...</p></div>;
  if (accessError || !businessId) return <div className="container"><p role="alert">{accessError || 'Loja não encontrada.'}</p><button onClick={() => navigate(-1)}>Voltar</button></div>;

  return (
    <div className="product-form-container">
      <div className="form-box">
        <h1>Adicionar Novo Produto</h1>
        
        <form onSubmit={handleSubmit}>
          {error && <div className="error-message">{error}</div>}
          
          <div className="form-group">
            <label htmlFor="name">Nome do Produto *</label>
            <input
              id="name"
              name="name"
              type="text"
              value={formData.name}
              onChange={handleChange}
              placeholder="Ex: Camiseta Preta"
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="description">Descrição</label>
            <textarea
              id="description"
              name="description"
              value={formData.description}
              onChange={handleChange}
              placeholder="Descreva seu produto..."
              rows={4}
            />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label htmlFor="price">Preço (R$) *</label>
              <input
                id="price"
                name="price"
                type="number"
                step="0.01"
                value={formData.price}
                onChange={handleChange}
                placeholder="29.90"
                required
              />
            </div>

            <div className="form-group">
              <label htmlFor="quantity">Quantidade *</label>
              <input
                id="quantity"
                name="quantity"
                type="number"
                value={formData.quantity}
                onChange={handleChange}
                placeholder="10"
                required
              />
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="category">Categoria</label>
            <select
              id="category"
              name="category"
              value={formData.category}
              onChange={handleChange}
            >
              <option value="geral">Geral</option>
              <option value="roupas">Roupas</option>
              <option value="alimentos">Alimentos</option>
              <option value="eletronicos">Eletrônicos</option>
              <option value="livros">Livros</option>
              <option value="outros">Outros</option>
            </select>
          </div>

          <div className="form-group">
            <label>Fotos do Produto</label>
            <ImageDropzone
              onImagesAdded={(newUrls) => {
                setImages((prev) => [...prev, ...newUrls]);
              }}
              existingImages={images}
              onUploadingChange={setUploadingImages}
              onRemoveImage={(index) => {
                setImages((prev) => prev.filter((_, i) => i !== index));
              }}
              maxFiles={5}
            />
          </div>

          <div className="form-actions">
            <button
              type="button"
              onClick={() => navigate(`/business/${businessId}`)}
              className="btn-secondary"
            >
              Cancelar
            </button>
            <button type="submit" disabled={loading || uploadingImages} className="btn-primary">
              {loading ? 'Adicionando...' : uploadingImages ? 'Enviando imagens...' : 'Adicionar Produto'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
