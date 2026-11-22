import React, { useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { getBusinessPublic, getProductsPublic, resolveAssetUrl } from '../services/api';
import type { PublicBusiness, PublicProduct } from '../services/api';
import { useCartStore } from '../context/store';
import { ImageGallery } from '../components/ImageGallery';
import { RatingControl, RatingLabel } from '../components/RatingControl';
import '../styles/store-public.css';

export function StorePublicPage() {
  const { businessId } = useParams<{ businessId: string }>();
  const [params, setParams] = useSearchParams();
  const productId = params.get('product');
  const addToCart = useCartStore((state) => state.addToCart);
  const [business, setBusiness] = useState<PublicBusiness | null>(null);
  const [products, setProducts] = useState<PublicProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [addedName, setAddedName] = useState('');
  const closeRef = useRef<HTMLButtonElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const selectedProduct = products.find((product) => product.id === productId);

  useEffect(() => {
    if (!businessId) {
      setLoading(false);
      setError('Loja não encontrada.');
      return;
    }
    let active = true;
    setLoading(true);
    setError('');
    Promise.all([getBusinessPublic(businessId), getProductsPublic(businessId)])
      .then(([businessData, productsData]) => {
        if (active) {
          setBusiness(businessData);
          setProducts(productsData);
        }
      })
      .catch((err: unknown) => {
        if (active) {
          console.error('Erro ao carregar loja:', err);
          setError('Não foi possível carregar a loja. Tente novamente.');
        }
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [businessId]);

  const selectedProductId = selectedProduct?.id;

  useEffect(() => {
    if (!selectedProductId) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setParams({}, { replace: true });
      if (event.key === 'Tab' && modalRef.current) {
        const controls = modalRef.current.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), [tabindex]:not([tabindex="-1"])');
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [selectedProductId, setParams]);

  function handleAddToCart(product: PublicProduct) {
    if (!businessId || !business) return;
    addToCart({
      productId: product.id,
      name: product.name,
      price: Number(product.price),
      businessId,
      businessName: business.name,
      quantity: 1,
    });
    setAddedName(product.name);
  }

  if (loading) return <div className="container"><p>Carregando loja...</p></div>;
  if (error || !business) return <div className="container"><p role="alert">{error || 'Loja não encontrada.'}</p><Link to="/shop">Voltar às lojas</Link></div>;

  return (
    <div className="store-public-page">
      <div className="container">
        <Link to="/shop" className="store-back">← Voltar às lojas</Link>
        <div className="store-heading">
          <div className="store-info">
            <div className="store-logo" aria-hidden="true">🏬</div>
            <div>
              <h1>{business.name}</h1>
              <p className="store-category">{business.category}</p>
              <p className="store-rating"><RatingLabel {...business} /></p>
            </div>
          </div>
        </div>
        {addedName && <p className="store-notice" role="status">{addedName} adicionado ao carrinho. <Link to="/cart">Ver carrinho</Link></p>}
        {productId && !selectedProduct && <p role="alert">Produto não encontrado nesta loja. <Link to={`/store/${businessId}`}>Ver produtos da loja</Link></p>}
        <div className="store-description">
          <h2>Sobre a loja</h2>
          <p>{business.description}</p>
          <RatingControl key={business.id} kind="business" id={business.id}
            onRated={(summary) => setBusiness((current) => current?.id === business.id ? { ...current, ...summary } : current)} />
        </div>
        <div className="products-section">
          <h2>Produtos ({products.length})</h2>
          {products.length === 0 ? <div className="empty-state"><p>Nenhum produto disponível</p></div> :
            <div className="products-grid card-grid card-grid-7">
              {products.map((product) => (
                <article key={product.id} className="product-card card-layout">
                  <Link className="product-image card-row-1" to={`?product=${encodeURIComponent(product.id)}`} aria-label={`Ver detalhes de ${product.name}`}>
                    {product.images?.length ? <img src={resolveAssetUrl(product.images[0].image_url)} alt="" /> : <span aria-hidden="true">📦</span>}
                  </Link>
                  <h3 className="card-row-2"><Link to={`?product=${encodeURIComponent(product.id)}`}>{product.name}</Link></h3>
                  {product.description && <p className="product-desc card-row-3">{product.description.substring(0, 60)}</p>}
                  <p className="product-category card-row-4">{product.category}</p>
                  <p className="product-price card-row-5">R$ {Number(product.price).toFixed(2)}</p>
                  <p className="product-stock card-row-6">{product.stock > 0 ? `${product.stock} em estoque` : 'Fora de estoque'}</p>
                  <button onClick={() => handleAddToCart(product)} disabled={product.stock <= 0} className="btn-primary card-footer card-row-7">+ Carrinho</button>
                </article>
              ))}
            </div>}
        </div>
      </div>

      {selectedProduct && (
        <div ref={modalRef} className="product-detail-modal" role="dialog" aria-modal="true" aria-labelledby="product-detail-title">
          <div className="modal-content">
            <button ref={closeRef} onClick={() => setParams({}, { replace: true })} className="btn-close" aria-label="Fechar detalhes do produto">✕</button>
            <div className="modal-body">
              <div className="modal-images">
                {selectedProduct.images?.length ? <ImageGallery images={selectedProduct.images} productName={selectedProduct.name} /> : <div className="no-image">📦</div>}
              </div>
              <div className="modal-info">
                <h2 id="product-detail-title">{selectedProduct.name}</h2>
                <p className="product-category">{selectedProduct.category}</p>
                <p className="product-description">{selectedProduct.description}</p>
                <p><RatingLabel {...selectedProduct} /></p>
                <RatingControl key={selectedProduct.id} kind="product" id={selectedProduct.id}
                  onRated={(summary) => setProducts((items) => items.map((item) =>
                    item.id === selectedProduct.id ? { ...item, ...summary } : item
                  ))} />
                <p className="product-price-large">R$ {Number(selectedProduct.price).toFixed(2)}</p>
                <p className="product-stock">{selectedProduct.stock > 0 ? `${selectedProduct.stock} em estoque` : 'Fora de estoque'}</p>
                <button onClick={() => { handleAddToCart(selectedProduct); setParams({}, { replace: true }); }} disabled={selectedProduct.stock <= 0} className="btn-primary btn-large">+ Adicionar ao carrinho</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
