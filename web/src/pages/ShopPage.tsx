import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { getAllBusinesses, getRecentProducts, resolveAssetUrl, searchProducts } from '../services/api';
import type { PublicBusiness, PublicProduct } from '../services/api';
import { useCartStore } from '../context/store';
import '../styles/shop.css';

export function ShopPage() {
  const [params] = useSearchParams();
  const query = (params.get('q') || '').trim();
  const addToCart = useCartStore((state) => state.addToCart);
  const [businesses, setBusinesses] = useState<PublicBusiness[]>([]);
  const [products, setProducts] = useState<PublicProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [storesError, setStoresError] = useState(false);
  const [addedName, setAddedName] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    setStoresError(false);
    setAddedName('');

    if (query && query.length < 2) {
      setLoading(false);
      setError('Digite pelo menos 2 caracteres para buscar.');
      return () => { active = false; };
    }

    const loadProducts = (query ? searchProducts(query) : getRecentProducts()).then((data) => {
      if (active) setProducts(data);
    }).catch(() => {
      if (active) setError(query ? 'Não foi possível buscar produtos.' : 'Não foi possível carregar os produtos recentes.');
    });
    const loadStores = query ? Promise.resolve() : getAllBusinesses().then((data) => {
      if (active) setBusinesses(data);
    }).catch(() => {
      if (active) setStoresError(true);
    });
    void Promise.all([loadProducts, loadStores]).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [query]);

  function handleAddToCart(product: PublicProduct) {
    addToCart({
      productId: product.id,
      name: product.name,
      price: Number(product.price),
      businessId: product.business_id,
      businessName: product.business_name || 'Loja',
      quantity: 1,
    });
    setAddedName(product.name);
  }

  return (
    <div className="shop-page">
      <div className="shop-header">
        <h1>Encontre produtos de várias lojas</h1>
        <p>Pesquise, compare e compre no marketplace UniWeb.</p>
      </div>
      <div className="container">
        {addedName && <p className="shop-notice" role="status">{addedName} adicionado ao carrinho. <Link to="/cart">Ver carrinho</Link></p>}
        {loading ? <p className="shop-feedback">Carregando...</p> : (<>
          <section className="search-results">
            <h2>{query && !error ? 'Resultados para “' + query + '” (' + products.length + ')' : query ? 'Busca de produtos' : 'Últimos produtos'}</h2>
            {error ? (
              <div className="empty-state" role="alert"><p>{error}</p>{query && <Link to="/shop">Voltar ao marketplace</Link>}</div>
            ) : products.length === 0 ? (
              <div className="empty-state">
                <p>{query ? 'Nenhum produto encontrado. Tente outra busca.' : 'Nenhum produto disponível no momento.'}</p>
                {query && <Link to="/shop">Voltar ao marketplace</Link>}
              </div>
            ) : (
              <div className="products-grid card-grid card-grid-7">
                {products.map((product) => {
                  const productUrl = `/store/${product.business_id}?product=${encodeURIComponent(product.id)}`;
                  return (
                    <article key={product.id} className="product-card card-layout">
                      <Link className="product-image card-row-1" to={productUrl} aria-label={`Ver detalhes de ${product.name}`}>
                        {product.images?.length ? <img src={resolveAssetUrl(product.images[0].image_url)} alt="" loading="lazy" /> : <span aria-hidden="true">📦</span>}
                      </Link>
                      <h3 className="card-row-2"><Link to={productUrl}>{product.name}</Link></h3>
                      <p className="product-store card-row-3">{product.business_name || 'Loja'}</p>
                      {product.description && <p className="product-desc card-row-4">{product.description.substring(0, 60)}</p>}
                      <p className="product-price card-row-5">R$ {Number(product.price).toFixed(2)}</p>
                      <p className="product-stock card-row-6">{product.stock > 0 ? `${product.stock} em estoque` : 'Fora de estoque'}</p>
                      <div className="product-actions card-footer card-row-7">
                        <button onClick={() => handleAddToCart(product)} disabled={product.stock <= 0} className="btn-primary">+ Carrinho</button>
                        <Link className="shop-secondary-link" to={`/store/${product.business_id}`}>Ver loja</Link>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
          {!query && <section>
            <h2>Lojas em destaque</h2>
            {storesError ? <div className="empty-state" role="alert"><p>Não foi possível carregar as lojas.</p></div> : businesses.length === 0 ? <div className="empty-state"><p>Nenhuma loja disponível no momento.</p></div> :
              <div className="businesses-grid card-grid card-grid-6">
                {businesses.map((business) => (
                  <article key={business.id} className="business-card card-layout">
                    <Link to={`/store/${business.id}`} className="business-logo card-row-1" aria-label={`Visitar ${business.name}`}>🏬</Link>
                    <h3 className="card-row-2"><Link to={`/store/${business.id}`}>{business.name}</Link></h3>
                    <p className="business-category card-row-3">{business.category}</p>
                    {business.description && <p className="business-desc card-row-4">{business.description.substring(0, 80)}</p>}
                    <div className="business-rating card-row-5">⭐ {business.rating || 'N/A'}</div>
                    <Link className="shop-secondary-link card-footer card-row-6" to={`/store/${business.id}`}>Visitar loja →</Link>
                  </article>
                ))}
              </div>}
          </section>}
        </>)}
      </div>
    </div>
  );
}
