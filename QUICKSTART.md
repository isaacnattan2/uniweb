# 🚀 Quickstart - Teste Rápido

## ⚡ 2 Minutos para Testar

### Passo 1: Instalar dependências
```bash
# Terminal 1 - Backend
cd backend
npm install

# Terminal 2 - Frontend  
cd web
npm install
```

### Passo 2: Iniciar servidores
```bash
# Terminal 1
cd backend && npm run dev

# Terminal 2
cd web && npm run dev
```

✅ Aguarde ver:
- Backend: `🚀 Server running on http://localhost:3000`
- Frontend: `➜ Local: http://localhost:5173/`

---

## 🎯 Teste Completo do Marketplace

### 1️⃣ Acesse http://localhost:5173

Você verá a página **pública de marketplace** - nenhum login necessário!

### 2️⃣ Veja Lojas e Produtos

Clique em qualquer loja para ver seus produtos:
- Sem login ✅
- Sem registrar ✅
- 100% anônimo ✅

### 3️⃣ Busca Global

Use a barra de busca no topo para procurar produtos em **TODAS** as lojas:
```
Buscar: "blusa"
Resultado: Produtos de qualquer loja com "blusa" no nome/descrição
```

### 4️⃣ Adicione ao Carrinho

Clique em **+ Carrinho** num produto:
- Item adicionado (sem login)
- Salvo em localStorage
- Persiste ao recarregar página
- Mostra qual loja é cada item

### 5️⃣ Vá ao Carrinho

Clique em **🛒 Meu Carrinho** no header:
- Veja seus itens
- Edite quantidades
- Veja total da compra
- Veja qual loja cada item vem

### 6️⃣ Checkout com Login

Clique **🔐 Fazer Login e Finalizar Compra**:
- Será redirecionado para /login
- Registre-se ou faça login
- Volte a /cart automaticamente
- Clique novamente "Finalizar Compra"
- ✅ Pedido criado!

### 7️⃣ Veja Histórico

Acesse **/orders** (protegido):
- Veja todos seus pedidos
- Clique num pedido para detalhes
- Veja itens, total, data

---

## 🧑‍💼 Teste como Lojista

### 1️⃣ Registre-se
Clique em **Registrar** e marque:
- ☐ "Vou vender nessa plataforma"

### 2️⃣ Acesse Dashboard
Clique em **👨‍💼 Dashboard** no header

### 3️⃣ Crie uma Loja
- Clique **Nova Loja**
- Preencha nome, descrição, categoria
- Clique **Criar Loja**

### 4️⃣ Adicione Produtos
- Clique na loja criada
- Clique **Novo Produto**
- Preencha nome, descrição, preço, stock
- Clique **Criar Produto**

### 5️⃣ Veja na Loja Pública
- Acesse **/shop**
- Sua loja aparece em "Lojas em Destaque"
- Clique para ver produtos públicos

### 6️⃣ Teste Busca Global
- Faça logout (ou use outra aba anônima)
- Vá a **/shop**
- Busque pelo nome do seu produto
- Será encontrado na busca global!
- Verá o nome da loja junto com o produto

---

## 🧪 API Tests (PowerShell)

```powershell
# Listar lojas
$businesses = Invoke-WebRequest -Uri "http://localhost:3000/api/shop/businesses" -UseBasicParsing | ConvertFrom-Json
$businesses | ConvertTo-Json

# Buscar produtos em TODAS as lojas
$search = Invoke-WebRequest -Uri "http://localhost:3000/api/shop/search?q=blusa" -UseBasicParsing | ConvertFrom-Json
$search | ConvertTo-Json

# Ver produtos de uma loja específica
$products = Invoke-WebRequest -Uri "http://localhost:3000/api/shop/businesses/:businessId/products" -UseBasicParsing | ConvertFrom-Json
$products | ConvertTo-Json
```

---

## 📱 Fluxo Visual Completo

```
Acesso Público (sem login)
    ↓
[ShopPage] - Marketplace com busca global
    ↓ 
[Resultado Busca] - Produtos de TODAS as lojas com nome da loja
    ↓
[StorePublicPage] - Detalhes completa da loja
    ↓
[Adicionar Carrinho] - Anônimo, localStorage, mostra "Loja de roupas..."
    ↓
[CartPage] - Vê itens SEM login, agrupa por loja
    ↓
[Finalizar Compra] ← 🔐 LOGIN AQUI
    ↓
[OrdersPage] - Histórico de pedidos (protegido)
```

---

## ✅ Funcionalidades Implementadas

- [x] **Marketplace público** (sem login necessário)
- [x] **Busca global** em TODAS as lojas
- [x] **Carrinho anônimo** (localStorage, persiste)
- [x] **Business Name** no carrinho (mostra qual loja)
- [x] **Adicionar/remover itens** sem login
- [x] **Editar quantidades** no carrinho
- [x] **Resumo de compra** com totais
- [x] **Login obrigatório** no checkout
- [x] **Criar pedido** com decrement automático de stock
- [x] **Histórico de pedidos** (protegido)
- [x] **Lojista criar loja**
- [x] **Lojista adicionar produtos** com stock
- [x] **Produtos aparecem** na busca global com business_name
- [x] **Header** com navegação e link de carrinho
- [x] **Routes protegidas** (/orders, /cart no checkout)
- [x] **Validação de estoque** (não vende se stock = 0)

---

## 🐛 Se der erro

| Erro | Solução |
|------|---------|
| "Port 5173 already in use" | Feche outro terminal ou kill do servidor anterior |
| "Cannot GET /api/shop/businesses" | Backend não está rodando - `npm run dev` na pasta backend |
| Busca vazia | Certifique-se que há produtos na loja com `status = 'active'` |
| "Cannot find module" | Execute `npm install` novamente em ambas pastas |
| Carrinho não persiste | Limpe cache (Ctrl+Shift+Del) e recarregue a página |
| Busca traz business_name null | Reinicie o backend para compilar as mudanças |

---

**Pronto? Abra http://localhost:5173 e teste! 🚀**
