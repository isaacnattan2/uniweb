# 📸 Teste de Múltiplas Imagens para Produtos

## Checklist de Teste Funcional

### 1. Backend - Verificar Migration
- [x] Migration SQL executada com sucesso
- [x] Tabela `product_images` criada
- [x] Coluna `main_image_url` adicionada em `products`
- [x] Índice criado em `product_id`

### 2. Backend - Endpoints
Testar endpoints usando curl ou Postman:

```bash
# Criar produto COM imagens
curl -X POST http://localhost:3000/api/products \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "businessId": "uuid-da-loja",
    "name": "Produto Teste",
    "description": "Descrição",
    "price": 99.90,
    "quantity": 10,
    "category": "teste",
    "images": [
      "https://via.placeholder.com/400?text=Frente",
      "https://via.placeholder.com/400?text=Costas"
    ]
  }'

# Buscar produtos COM imagens
curl http://localhost:3000/api/shop/search?q=teste

# Resposta esperada: produto com array "images" contendo objects com "image_url" e "order_index"
```

### 3. Frontend - Novo Produto
1. Acesse: http://localhost:5173/dashboard
2. Clique na sua loja
3. Clique em "Novo Produto"
4. Preencha nome, preço, quantidade
5. **Na seção "Fotos do Produto"**:
   - Cole uma URL: `https://via.placeholder.com/400?text=Produto+1`
   - Clique "Adicionar Foto"
   - Cole outra: `https://via.placeholder.com/400?text=Produto+2`
   - Clique "Adicionar Foto" novamente
   - Veja o preview das imagens adicionadas
6. Clique "Adicionar Produto"

### 4. Frontend - Visualizar Galeria
1. Acesse: http://localhost:5173/shop
2. Procure sua loja (clique em "🏪 Lojas em Destaque" ou busque)
3. Clique na loja
4. **Veja a primeira imagem** no card do produto
5. **Clique no produto** → Abre modal com galeria
6. **Na galeria**:
   - Veja a imagem grande
   - Use setas ◀ ▶ para navegar
   - Clique nas miniaturas abaixo para ir direto à foto

### 5. Frontend - Busca Global
1. Volte a http://localhost:5173/shop
2. Use a barra de busca no topo
3. Digite o nome do seu produto
4. **Veja o resultado com a primeira imagem**
5. Clique no resultado para ver a galeria

### 6. Frontend - Carrinho
1. Clique "+ Carrinho" em um produto
2. Acesse http://localhost:5173/cart
3. **Verifique se a imagem aparece no carrinho** (se implementado)

---

## URLs de Teste Rápidas

**Placeholder images (Cole uma URL de cada vez e clique "Adicionar Foto"):**
```
https://via.placeholder.com/400?text=Produto+Frente
https://via.placeholder.com/400?text=Produto+Costas
https://via.placeholder.com/400?text=Produto+Detalhe
https://via.placeholder.com/400?text=Produto+Zoom
```

**Ou use imagens reais:**
```
https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=400
https://images.unsplash.com/photo-1476445671549-5e1f8ea40a4b?w=400
```

---

## Pontos de Falha Esperados

| Cenário | Comportamento Esperado |
|---------|------------------------|
| URL de imagem inválida | Modal abre mas imagem não carrega |
| Sem imagens | Modal mostra "📦" ou "Nenhuma foto disponível" |
| Múltiplas imagens | Setas e miniaturas funcionam |
| Remover imagem | Clique X no preview e ela desaparece |

---

## Arquivos Modificados

### Backend
- `src/controllers/ProductController.ts` - Integração com ProductImageService
- `src/controllers/ShopController.ts` - Retorna array de imagens
- `src/services/ProductImageService.ts` - **NOVO** - Gerencia imagens
- `migrations/add_product_images.sql` - **NOVO** - Schema

### Frontend
- `src/pages/NewProductPage.tsx` - Upload de múltiplas imagens
- `src/pages/StorePublicPage.tsx` - Galeria com modal
- `src/pages/ShopPage.tsx` - Mostra primeira imagem em busca
- `src/components/ImageGallery.tsx` - **NOVO** - Galeria interativa
- `src/services/api.ts` - Aceita `images` array
- `src/styles/product-form.css` - Estilos de upload
- `src/styles/image-gallery.css` - **NOVO** - Estilos de galeria
- `src/styles/store-public.css` - Modal de detalhes
- `src/styles/shop.css` - Thumbnails em busca

### Config
- `README.md` - Documentação atualizada

---

## Troubleshooting

| Problema | Solução |
|----------|---------|
| Imagens não aparecem na busca | Verifique se produto foi criado COM imagens |
| Galeria não abre | Veja console do navegador (F12) |
| Erro ao adicionar imagem | URL pode estar inválida ou inacessível |
| Backend não retorna images | Verifique se migration foi executada (tabela product_images existe) |
| Frontend não envia images | Verifique form em NewProductPage.tsx |

---

**Teste completo esperado:** ~5-10 minutos
**Versão:** v1.1.0 com suporte a múltiplas fotos
