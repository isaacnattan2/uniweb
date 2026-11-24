import { CategoryOptions } from '../components/CategoryOptions';
import React, { useState, useEffect } from 'react';
import { useFeedback } from '../components/Feedback';
import { useNavigate, useParams } from 'react-router-dom';
import { getProductsByBusiness, resolveAssetUrl, updateProduct } from '../services/api';
import { ImageDropzone } from '../components/ImageDropzone';
import '../styles/product-form.css';
import '../styles/dropzone.css';

export function EditProductPage() {
  const { showToast } = useFeedback();
  const navigate = useNavigate();
  const { productId, businessId } = useParams<{ productId: string; businessId?: string }>();
  
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    price: '',
    quantity: '',
    category: '',
  });
  const [images, setImages] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [uploadingImages, setUploadingImages] = useState(false);

  useEffect(() => {
    setLoading(true);
    setLoadError('');
    if (!productId || !businessId) {
      setLoadError('Produto ou loja não encontrado.');
      setLoading(false);
      return;
    }

    async function loadProduct() {
      try {
        const products = await getProductsByBusiness(businessId);
        const product = products.find((p: any) => p.id === productId);
        
        if (!product) {
          setLoadError('Produto não encontrado');
          return;
        }

        setFormData({
          name: product.name,
          description: product.description || '',
          price: product.price.toString(),
          quantity: product.stock?.toString() || '',
          category: product.category || '',
        });

        if (product.images && Array.isArray(product.images)) {
          setImages(product.images.map((img: any) => resolveAssetUrl(img.image_url)));
        }
      } catch (err: any) {
        setLoadError(err.response?.data?.error || 'Erro ao carregar produto');
        console.error(err);
      } finally {
        setLoading(false);
      }
    }

    loadProduct();
  }, [productId, businessId]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (uploadingImages || submitting) return;
    setError('');
    setSubmitting(true);

    try {
      if (!productId) {
        setError('ID do produto não encontrado');
        return;
      }

      await updateProduct(productId, {
        name: formData.name,
        description: formData.description,
        price: parseFloat(formData.price),
        quantity: parseInt(formData.quantity),
        category: formData.category,
        images,
      });

      showToast('Produto atualizado com sucesso!');
      navigate(-1);
    } catch (err: any) {
      console.error('Erro ao atualizar produto:', err);
      setError(err.response?.data?.error || 'Erro ao atualizar produto');
    } finally {
      setSubmitting(false);
    }
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  }

  if (loading) {
    return <div className="container"><p>Carregando produto...</p></div>;
  }
  if (loadError) {
    return <div className="container"><p role="alert">{loadError}</p><button onClick={() => navigate(-1)}>Voltar</button></div>;
  }

  return (
    <div className="product-form-container">
      <div className="form-box">
        <h1>Editar Produto</h1>
        
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
              <option value="">Selecione uma categoria</option>
              <CategoryOptions kind="product" current={formData.category} />
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
              onClick={() => navigate(-1)}
              className="btn-secondary"
            >
              Cancelar
            </button>
            <button type="submit" disabled={submitting || uploadingImages} className="btn-primary">
              {submitting ? 'Salvando...' : uploadingImages ? 'Enviando imagens...' : 'Salvar Alterações'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
