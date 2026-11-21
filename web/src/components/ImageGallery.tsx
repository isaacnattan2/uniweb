import React, { useState } from 'react';
import { resolveAssetUrl } from '../services/api';
import '../styles/image-gallery.css';

interface ImageGalleryProps {
  images: Array<{ id?: string; image_url: string; order_index?: number }>;
  productName?: string;
}

export function ImageGallery({ images, productName = 'Produto' }: ImageGalleryProps) {
  const [currentImageIndex, setCurrentImageIndex] = useState(0);

  if (!images || images.length === 0) {
    return (
      <div className="image-gallery-container">
        <div className="no-image">
          <p>Nenhuma foto disponível</p>
        </div>
      </div>
    );
  }

  const currentImage = images[currentImageIndex];

  function goToPrevious() {
    setCurrentImageIndex((prev) => (prev === 0 ? images.length - 1 : prev - 1));
  }

  function goToNext() {
    setCurrentImageIndex((prev) => (prev === images.length - 1 ? 0 : prev + 1));
  }

  return (
    <div className="image-gallery-container">
      <div className="main-image">
        <img src={resolveAssetUrl(currentImage.image_url)} alt={`${productName} - Foto ${currentImageIndex + 1}`} />
        {images.length > 1 && (
          <>
            <button onClick={goToPrevious} className="gallery-nav prev">
              ◀
            </button>
            <button onClick={goToNext} className="gallery-nav next">
              ▶
            </button>
          </>
        )}
      </div>

      {images.length > 1 && (
        <div className="thumbnails">
          {images.map((img, index) => (
            <button
              key={index}
              className={`thumbnail ${index === currentImageIndex ? 'active' : ''}`}
              onClick={() => setCurrentImageIndex(index)}
            >
              <img src={resolveAssetUrl(img.image_url)} alt={`Miniatura ${index + 1}`} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
