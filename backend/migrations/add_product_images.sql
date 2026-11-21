-- Criar tabela de imagens de produtos
CREATE TABLE IF NOT EXISTS product_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  image_url TEXT NOT NULL,
  order_index INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Criar índice
CREATE INDEX IF NOT EXISTS idx_product_images_product_id ON product_images(product_id);

-- Adicionar coluna de imagem principal em products (opcional, para fallback)
ALTER TABLE products ADD COLUMN IF NOT EXISTS main_image_url TEXT;
