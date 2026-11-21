# 🧪 Teste Rápido - Múltiplas Imagens para Produtos

## ⚡ Começar em 5 Minutos

### **Passo 1: Verificar Servidores**
```bash
# Backend deve estar rodando em :3000
# Frontend deve estar rodando em :5173
# Se não estiverem, execute:
cd backend && npm run dev  # Terminal 1
cd web && npm run dev      # Terminal 2 (novo)
```

✅ **Status Esperado**:
- Backend: `🚀 Server running on http://localhost:3000`
- Frontend: `➜ Local: http://localhost:5173/`

---

## 📸 Teste 1: Adicionar Produto com Múltiplas Fotos

### **1. Registre como Lojista**
1. Abra: http://localhost:5173/register
2. Preencha email, senha, nome
3. **Marque**: "Vou vender nessa plataforma" ✓
4. Clique "Registrar"

### **2. Crie uma Loja**
1. Acesse: http://localhost:5173/dashboard
2. Clique "Nova Loja"
3. Preencha nome, descrição, categoria
4. Clique "Criar Loja"
5. Copie o ID da loja (ou clique nela)

### **3. Adicione um Produto com Fotos**
1. Na loja, clique "Novo Produto"
2. Preencha:
   - Nome: `Camiseta Premium`
   - Descrição: `Camiseta de qualidade`
   - Preço: `49.90`
   - Quantidade: `10`
   - Categoria: `Roupas`

3. **Cole as URLs de fotos** (uma por vez):
   ```
   https://via.placeholder.com/400?text=Frente
   ```
   Clique "Adicionar Foto"

   ```
   https://via.placeholder.com/400?text=Costas
   ```
   Clique "Adicionar Foto"

   ```
   https://via.placeholder.com/400?text=Detalhe
   ```
   Clique "Adicionar Foto"

4. **Veja o preview** das 3 fotos adicionadas
5. Clique "Adicionar Produto"

✅ **Esperado**: Redirecionado para a loja com o produto listado

---

## 👁️ Teste 2: Visualizar Galeria de Fotos

### **1. Acesse a Loja Pública**
1. Vá a: http://localhost:5173/shop
2. Clique em "🏪 Lojas em Destaque"
3. Clique na sua loja

✅ **Esperado**: Ver o produto com a **primeira foto** como thumbnail

### **2. Clique no Produto**
1. Clique na foto do produto (ou no produto)
2. Um **modal** abre com galeria grande

✅ **Esperado**: Ver a galeria com:
- Imagem grande da primeira foto
- Setas ◀ ▶ para navegar
- Miniaturas (3 fotos) abaixo

### **3. Teste a Navegação**
1. Clique na seta **▶** (direita)
   ✅ Deve mostrar segunda foto

2. Clique em uma **miniatura** (ex: a terceira)
   ✅ Deve pular direto para essa foto

3. Clique na seta **◀** (esquerda)
   ✅ Deve voltar para foto anterior

4. Clique **X** ou fora da galeria
   ✅ Modal deve fechar

---

## 🔍 Teste 3: Busca Global

### **1. Busca por Termo**
1. Volte a: http://localhost:5173/shop
2. Use a barra "Buscar produtos..."
3. Digite: `camiseta`
4. Clique "Buscar"

✅ **Esperado**:
- Ver resultado com seu produto
- **Primeira foto aparece** no card
- Nome e preço visíveis

### **2. Clique no Resultado**
1. Clique no card do produto
2. Clique na foto

✅ **Esperado**: Galeria interativa aparece (mesmo modal de antes)

---

## 🛒 Teste 4: Adicionar ao Carrinho

1. Na galeria ou no card, clique **"+ Carrinho"**
2. Acesse: http://localhost:5173/cart
3. Veja o item no carrinho

✅ **Esperado**: Carrinho mostra produto com dados corretos

---

## ⚙️ Verificações Técnicas

### **1. Verificar Migration no Banco**
No Neon dashboard:
1. Acesse seu projeto
2. Vá a **SQL Editor**
3. Execute:
```sql
SELECT * FROM product_images LIMIT 5;
```

✅ **Esperado**: Ver tabela com suas imagens (order_index, product_id, image_url)

### **2. Verificar Backend Logs**
```bash
# Terminal do backend
# Deve ver logs de queries quando você:
# - Adiciona produto
# - Busca produtos
# - Visualiza loja

tail -f backend/server.log
```

### **3. Verificar Frontend**
1. Abra DevTools (F12)
2. Vá a **Console**
3. Não deve haver erros vermelho

✅ **Esperado**: Console limpo ou apenas warnings do React

---

## 🎯 Checklist Final

| Funcionalidade | ✓ |
|----------------|---|
| Registrar como lojista | ☐ |
| Criar loja | ☐ |
| Adicionar produto com 3+ fotos | ☐ |
| Ver primeira foto no card | ☐ |
| Abrir modal com galeria | ☐ |
| Navegar com setas ◀ ▶ | ☐ |
| Clique em miniaturas funciona | ☐ |
| Busca global mostra fotos | ☐ |
| Fechar modal com X | ☐ |
| Adicionar ao carrinho | ☐ |
| Nenhum erro no console | ☐ |

---

## ❌ Se Algo Falhar

| Erro | Solução |
|------|---------|
| "Tabela product_images não existe" | Execute migration: `cd backend && node run-migration.js` |
| Fotos não carregam | URL pode ser inválida; teste com https://via.placeholder.com |
| Galeria não abre | Recarregue página e verifique console (F12) |
| Build falha | Execute `npm install` no diretório (frontend/backend) |
| Backend mostra erro de conexão | Verifique DATABASE_URL no .env |
| Servidor não sobe | Verifique se porta já está em uso: `lsof -i :3000` / `lsof -i :5173` |

---

## 📞 Suporte Rápido

**Se precisar reiniciar:**
```bash
# Parar todos os Node
killall node  # Mac/Linux
taskkill /F /IM node.exe  # Windows

# Reiniciar
cd backend && npm run dev  # Terminal 1
cd web && npm run dev      # Terminal 2
```

---

**Tempo estimado de teste**: 10 minutos
**Dificuldade**: Fácil ✅
**Resultado esperado**: Galeria completamente funcional com múltiplas imagens por produto
