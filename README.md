# 🛍️ Uniweb - E-commerce Marketplace

MVP completo com backend Node.js + Express, frontend React + Vite e database PostgreSQL (Neon).

**Features**: Autenticação JWT | Administração de lojas e lojistas | Lojista (gerenciar suas lojas e produtos) | Marketplace público

---

## 🚀 Como Inicializar (Rápido)

### ✅ Pré-requisitos
- Node.js 16+ instalado
- npm (vem com Node.js)

### 📋 Passo 1: Instalar dependências

```bash
# Backend
cd backend
npm install

# Frontend (novo terminal)
cd web
npm install
```

### 📋 Passo 2: Iniciar servidores

**Terminal 1 - Backend:**
```bash
cd backend
npm run dev
```
✅ Deve aparecer: `🚀 Server running on http://localhost:3000`

**Terminal 2 - Frontend:**
```bash
cd web
npm run dev
```
✅ Deve aparecer: `➜ Local: http://localhost:5173/`

### Criar o primeiro administrador

No terminal, dentro de `backend`, execute `npm run create-admin` e informe nome, e-mail e senha. A senha não é exibida no terminal. Em seguida, acesse `/login` com essa conta.

---

## 🎯 URLs Importantes

| Função | URL |
|--------|-----|
| **Marketplace** | http://localhost:5173/shop |
| **Carrinho** | http://localhost:5173/cart |
| **Meus Pedidos** | http://localhost:5173/orders |
| **Administração** | http://localhost:5173/admin |
| **Dashboard Lojista** | http://localhost:5173/dashboard |
| **Nova Loja (admin)** | http://localhost:5173/new-business |
| **Loja Específica** | http://localhost:5173/business/:businessId |
| **Novo Produto** | http://localhost:5173/business/:businessId/new-product |
| **Login** | http://localhost:5173/login |
| **Cadastro de cliente** | http://localhost:5173/register |

---

## 🛒 Fluxo de Cliente (Tipo Mercado Livre)

**100% PÚBLICO até o checkout:**

1. **Navegação Pública** - Acesse **/shop** (nenhum login necessário)
2. **Ver Lojas** - Clique em qualquer loja para ver produtos
3. **Buscar em Todas as Lojas** - Use barra de busca para procurar produtos em TODAS as lojas de uma vez
4. **Adicionar ao Carrinho** - Clique "+ Carrinho" (totalmente anônimo, salva em localStorage)
5. **Ver Carrinho** - Acesse **/cart** para revisar itens
6. **Login no Checkout** - Ao clicar "Finalizar Compra", será pedido login/registro
7. **Histórico** - Após comprar, acesse **/orders** para ver suas compras

**Resumo:**
- ✅ Navegação pública: **/shop**, **/store/:id**
- ✅ Carrinho anônimo: **/cart** (funciona sem login até "Finalizar Compra")
- ✅ Login obrigatório: Apenas no checkout

---

## 📸 Produtos com Múltiplas Fotos (Novo!)

Ao adicionar um produto, você pode agora adicionar várias fotos:

1. **Acesse**: `/business/:businessId/new-product`
2. **Arraste imagens** para a área de fotos ou clique para selecioná-las
3. **Aguarde o envio** das imagens
4. **Veja preview** das fotos adicionadas
5. **Remova fotos** clicando o X sobre a imagem
6. **Ao salvar**, todas as fotos são armazenadas e aparecem na galeria do produto

**Visualização de Fotos:**
- Na listagem de produtos: primeira foto aparece como thumbnail
- Clique em um produto: abre modal com galeria interativa
- Na galeria: setas para navegar entre fotos + clique em miniaturas
- Responsive: funciona em desktop e mobile

---

## 👨‍💼 Fluxo de Lojista

1. O administrador cadastra o lojista com uma senha inicial no painel `/admin`.
2. O administrador cria a loja vinculada ao lojista ou transfere uma loja existente.
3. O lojista entra em `/login` e gerencia apenas as lojas vinculadas à sua conta em `/dashboard`.
4. Adicione produtos e fotos na loja.
5. **Seus produtos aparecem:**
   - Na loja pública: `/store/:id` com galeria de fotos
   - Na busca global quando alguém busca

---

## 📱 Teste Rápido

### Cliente Anônimo
1. Abra http://localhost:5173
2. Clique em "🏪 Lojas em Destaque"
3. Clique em uma loja
4. Clique em um produto para ver a galeria de fotos
5. Clique "+ Carrinho" num produto
6. Vá a **/cart** (note que nenhum login foi feito)
7. Clique "Finalizar Compra" → Será pedido login

### Testar Múltiplas Fotos
1. Cadastre um lojista e vincule uma loja no painel administrativo.
2. Entre com a conta do lojista e abra a loja.
3. Adicione um produto arrastando ou selecionando imagens.
4. **Visite a loja pública** e clique nos produtos para ver a galeria
5. **Use as setas** ◀ ▶ para navegar entre fotos
6. **Clique nas miniaturas** para ir direto para a foto

### Busca Global
1. Na página inicial, use a barra "Buscar produtos..."
2. Digite algo (ex: "blusa", "camiseta")
3. Verá produtos de TODAS as lojas com esse termo e suas fotos
4. Pode adicionar ao carrinho direto dos resultados

---

## 📡 API Endpoints

**Públicos (sem login):**
- `GET /api/shop/businesses` - Listar todas as lojas ativas
- `GET /api/shop/businesses/:id` - Detalhes de uma loja
- `GET /api/shop/businesses/:id/products` - Produtos de uma loja (com array de imagens)
- `GET /api/shop/search?q=termo` - Buscar produtos em TODAS as lojas (com imagens)

**Autenticados (com JWT):**
- `POST /api/auth/register` - Registro
- `POST /api/auth/login` - Login
- `POST /api/orders` - Criar pedido
- `GET /api/orders/my-orders` - Listar meus pedidos
- `GET /api/orders/:id` - Detalhes do pedido

**Administrador:**
- `POST /api/admin/sellers` - Cadastrar lojista
- `GET /api/admin/sellers` - Listar lojistas
- `GET /api/admin/businesses` - Listar lojas
- `PUT /api/admin/businesses/:id/owner` - Transferir loja
- `POST /api/businesses` - Criar loja para um lojista

**Lojista e administrador:**
- `GET /api/businesses/my-businesses` - Minhas lojas
- `POST /api/products` - Adicionar produto (com `images` array de URLs)
- `GET /api/products/business/:id` - Produtos da loja (com `images` array)
- `PUT /api/products/:id` - Editar produto e fotos

---

## 🗄️ Database (Neon)

Tabelas:
- `users` - usuários (clientes + lojistas)
- `businesses` - lojas
- `products` - produtos com stock
- `product_images` - fotos dos produtos (múltiplas por produto, ordenadas)
- `orders` - pedidos
- `order_items` - itens do pedido (histórico de compra)

**product_images:**
```
id: UUID (PK)
product_id: UUID (FK → products)
image_url: TEXT (URL da imagem)
order_index: INT (ordem na galeria)
created_at: TIMESTAMP
updated_at: TIMESTAMP
```

**Fluxo de Stock:**
- Produto criado com `stock` inicial
- Cliente compra → stock é decrementado automaticamente
- Sem overselling

---

## 🏗️ Stack

| Camada | Tecnologia |
|--------|-----------|
| Frontend | React 18 + Vite + TypeScript + Zustand |
| State | Zustand (auth, cart, business, product) + localStorage |
| Backend | Node.js + Express + TypeScript |
| Auth | JWT (HttpOnly não é possível com express puro, usa header + localStorage) |
| Database | PostgreSQL (Neon, sem pool necessário para dev) |
| HTTP | Axios com interceptor de JWT |
| Componentes | ImageGallery (galeria interativa de fotos) |

---

## 📁 Estrutura

```
uniweb/
├── backend/
│   ├── src/
│   │   ├── controllers/
│   │   │   ├── ShopController.ts (públicos: listLojas, busca com imagens)
│   │   │   ├── ProductController.ts (criar/atualizar produtos com imagens)
│   │   │   ├── OrderController.ts (autenticados: criar, listar)
│   │   │   ├── AuthController.ts (register, login)
│   │   │   └── BusinessController.ts (criar loja)
│   │   ├── routes/
│   │   │   ├── shop.routes.ts
│   │   │   ├── product.routes.ts
│   │   │   ├── orders.routes.ts
│   │   │   ├── auth.routes.ts
│   │   │   └── business.routes.ts
│   │   ├── middleware/
│   │   │   ├── auth.ts (verifica JWT)
│   │   │   └── errorHandler.ts
│   │   ├── services/
│   │   │   ├── ProductImageService.ts (gerenciar múltiplas fotos)
│   │   │   ├── AuthService.ts
│   │   │   ├── BusinessService.ts
│   │   │   └── ProductService.ts
│   │   └── config/
│   │       └── database.ts
│   ├── migrations/
│   │   └── add_product_images.sql (cria tabela product_images)
│   └── package.json
│
├── web/
│   ├── src/
│   │   ├── pages/
│   │   │   ├── ShopPage.tsx (público - marketplace com busca)
│   │   │   ├── StorePublicPage.tsx (público - detalhes da loja com galeria)
│   │   │   ├── NewProductPage.tsx (lojista - novo produto com múltiplas fotos)
│   │   │   ├── CartPage.tsx (público até checkout, pede login no finalizar)
│   │   │   ├── OrdersPage.tsx (autenticado)
│   │   │   ├── DashboardPage.tsx (autenticado - lojista)
│   │   │   ├── LoginPage.tsx
│   │   │   ├── RegisterPage.tsx
│   │   │   └── NotFoundPage.tsx
│   │   ├── components/
│   │   │   ├── ImageGallery.tsx (galeria interativa de fotos)
│   │   │   ├── Header.tsx (navegação com link "🛒 Meu Carrinho")
│   │   │   ├── ProtectedRoute.tsx (guards em /orders)
│   │   │   └── BusinessForm.tsx
│   │   ├── context/
│   │   │   └── store.ts (Zustand: authStore, cartStore, businessStore)
│   │   ├── services/
│   │   │   └── api.ts (fetch com interceptor JWT)
│   │   ├── styles/
│   │   │   ├── global.css
│   │   │   ├── header.css
│   │   │   ├── product-form.css (incluindo estilos de upload de fotos)
│   │   │   ├── image-gallery.css (galeria de fotos)
│   │   │   ├── shop.css (estilo do marketplace)
│   │   │   ├── cart.css
│   │   │   ├── orders.css
│   │   │   └── store-public.css (incluindo modal de detalhes com galeria)
│   │   └── App.tsx (rotas públicas + protegidas)
│   └── package.json
│
└── README.md
```

---

## ✅ Funcionalidades Implementadas

| Feature | Status |
|---------|--------|
| Autenticação JWT | ✅ |
| Admin: Criar loja | ✅ |
| Lojista: Adicionar produtos | ✅ |
| **Lojista: Múltiplas fotos por produto** | ✅ |
| Lojista: Gerenciar estoque | ✅ |
| Cliente: Navegar lojas públicas | ✅ |
| Cliente: Buscar em TODAS as lojas | ✅ |
| **Cliente: Galeria interativa de fotos** | ✅ |
| Cliente: Carrinho anônimo (localStorage) | ✅ |
| Cliente: Checkout com login | ✅ |
| Cliente: Histórico de pedidos | ✅ |
| Stock: Redução automática | ✅ |
| Header com navegação | ✅ |
| Routes protegidas | ✅ |

---

## Acompanhamento de entregas

Configure `GOOGLE_ROUTES_API_KEY` em `backend/.env` com acesso à Routes API.
Configure `VITE_GOOGLE_MAPS_WEB_KEY` em `web/.env` com acesso à Maps JavaScript API e restrição aos domínios do Uniweb.
Aplique `backend/migrations/add_delivery_tracking.sql` e reinicie o backend e o Vite.
O botão **Entrega em tempo real** aparece nos pedidos em andamento e consulta a última posição publicada pelo UniEntregador.

## 🔧 Troubleshooting

| Problema | Solução |
|----------|---------|
| Porta 3000/5173 em uso | Feche outro programa ou reinicie |
| "Cannot find module" | Execute `npm install` novamente |
| Sem conexão com banco | Verifique internet (banco na nuvem Neon) |
| Fotos não aparecem | Certifique-se que as URLs são válidas e acessíveis |
| Galeria não carrega | Verifique console do navegador para erros |
| Busca não retorna resultados | Certifique-se que há produtos cadastrados na loja |
| Carrinho vazio | Recarregue página ou limpe localStorage |

---

**Status**: ✅ MVP Marketplace Completo com Galeria de Fotos | **v1.1.0** | Pronto para deploy em Render

