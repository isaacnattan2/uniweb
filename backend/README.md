# Backend - Uniweb E-commerce

API REST com Express + TypeScript + PostgreSQL.

## Setup

```bash
npm install
npm run dev
```

Roda em `http://localhost:3000`

## 📡 Endpoints

```
POST   /api/auth/register
POST   /api/auth/login
POST   /api/businesses
GET    /api/businesses/my-businesses
GET    /api/businesses/:id
PUT    /api/businesses/:id
POST   /api/products
GET    /api/products/business/:businessId
GET    /api/products/:id
PUT    /api/products/:id
DELETE /api/products/:id
```

## 🔧 .env

```
DATABASE_URL=postgresql://...
NODE_ENV=development
PORT=3000
JWT_SECRET=secret-key
JWT_EXPIRE=7d
AWS_ENDPOINT_URL_S3=https://YOUR-BRANCH.storage.example.com
AWS_REGION=us-east-2
AWS_ACCESS_KEY_ID=your-storage-access-key
AWS_SECRET_ACCESS_KEY=your-storage-secret-key
NEON_STORAGE_BUCKET=uniweb-product-images
```

As variáveis `AWS_*` são credenciais do Neon Object Storage para o bucket público de fotos de produtos. Configure-as somente no backend, inclusive nas variáveis de ambiente do Render. Os novos uploads vão para o bucket; imagens antigas em `/uploads` não são migradas automaticamente.

## 📁 Estrutura

- `src/config/` - Database, JWT
- `src/controllers/` - Lógica de negócio
- `src/services/` - Operações de BD
- `src/routes/` - Endpoints
- `src/middleware/` - Auth, Error handler

## 🏗️ Build

```bash
npm run build
npm start
```

---

**Status**: ✅ Pronto | **Port**: 3000

## Checkout Asaas em desenvolvimento

1. Aplique `migrations/add_asaas_checkout.sql` com uma conexão direta ao banco de desenvolvimento.
2. No `.env` do backend, preencha `ASAAS_API_KEY` com a chave do Sandbox. Mantenha `ASAAS_API_URL=https://api-sandbox.asaas.com/v3` e aponte `ASAAS_RETURN_ORIGIN` para o endereço do frontend, por exemplo `https://uniweb-front.onrender.com`.
3. No painel Sandbox, configure o webhook com uma URL HTTPS pública que chegue ao backend em `/api/orders/asaas/webhook`. Escolha envio sequencial e os eventos `CHECKOUT_PAID`, `CHECKOUT_CANCELED` e `CHECKOUT_EXPIRED`. Use o mesmo token em `ASAAS_WEBHOOK_TOKEN` e no campo de autenticação do Asaas.
4. Reinicie o backend e finalize uma compra fictícia. Use os cartões de teste do Sandbox. O pedido aparece como pago após o webhook, e uma sessão cancelada ou expirada devolve os itens ao estoque.

O checkout hospedado aceita Pix e cartão em até 3 parcelas sem juros. Um carrinho com várias lojas gera um pedido por loja e uma cobrança única na conta Asaas configurada. Os repasses aos lojistas precisam de uma integração de split.

## Entregas disponíveis para o UniEntregador

`GET /api/orders/available-deliveries?limit=20&offset=0`

Envie `Authorization: Bearer <token do entregador>` com o JWT do login Uniweb. A consulta lista pedidos pagos para entrega local, com entrega pendente e sem entregador atribuído, do mais antigo ao mais recente. `limit` aceita de 1 a 50 registros.

O retorno contém `items` e `nextOffset` (nulo na última página). Cada item contém `orderId`, `orderNumber`, `createdAt`, `pickup` com os dados da loja, `destinationArea` com cidade/UF quando disponível, e `deliveryFee` com a taxa de entrega registrada, como decimal em reais ou `null` quando ainda não definida. O endereço completo do cliente fica fora da listagem.

## Download do UniEntregador

No serviço do backend no Render, defina `DRIVER_APP_DOWNLOAD_URL` com a URL HTTPS do APK. A área `/driver` do Uniweb usa essa URL depois do login. Para trocar o arquivo, atualize a variável no backend. Se ela estiver vazia ou inválida, a área do entregador mostra que o download está indisponível.
