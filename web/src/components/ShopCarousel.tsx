import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { resolveAssetUrl } from '../services/api';
import type { MarketplaceAd } from '../services/api';
import '../styles/shop-carousel.css';

export function ShopCarousel({ ads, preview = false, initialId }: { ads: MarketplaceAd[]; preview?: boolean; initialId?: string }) {
  const [selectedId, setSelectedId] = useState(initialId);
  if (!ads.length) return null;
  const index = Math.max(ads.findIndex((ad) => ad.id === selectedId), 0);
  const ad = ads[index];
  const image = <img src={resolveAssetUrl(ad.image_url)} alt={ad.title} />;
  const navigate = (offset: number) => setSelectedId(ads[(index + offset + ads.length) % ads.length].id);

  return (
    <section className="shop-carousel" aria-label={preview ? 'Prévia do carrossel' : 'Publicidades das lojas'}
      aria-roledescription="carrossel" onKeyDown={(event) => {
        if (ads.length < 2) return;
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          event.preventDefault();
          navigate(event.key === 'ArrowLeft' ? -1 : 1);
        }
      }}>
      <div className="shop-carousel-slide" aria-live="polite">
        {preview ? image : <Link to={'/store/' + ad.business_id}>{image}</Link>}
      </div>
      {ads.length > 1 && (
        <>
          <button type="button" className="shop-carousel-arrow shop-carousel-prev" aria-label="Publicidade anterior" onClick={() => navigate(-1)} />
          <button type="button" className="shop-carousel-arrow shop-carousel-next" aria-label="Próxima publicidade" onClick={() => navigate(1)} />
          <div className="shop-carousel-dots" aria-label="Posições do carrossel">
            {ads.map((item, itemIndex) => (
              <button key={item.id} type="button" aria-current={index === itemIndex ? 'true' : undefined}
                aria-label={'Publicidade ' + (itemIndex + 1) + ': ' + item.title}
                onClick={() => setSelectedId(item.id)} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}
