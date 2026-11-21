# Frontend - Uniweb E-commerce

React + Vite + TypeScript com Zustand para state management.

## Setup

```bash
npm install
npm run dev
```

Roda em `http://localhost:5173`

## 🎯 Páginas

- `LoginPage` - Login de lojista
- `RegisterPage` - Registrar novo lojista
- `DashboardPage` - Minhas lojas
- `BusinessPage` - Gerenciar loja e produtos
- `NewBusinessPage` - Criar loja
- `NewProductPage` - Adicionar produto

## 🔧 .env

```
VITE_API_URL=http://localhost:3000/api
```

## 📁 Estrutura

- `src/pages/` - Páginas
- `src/components/` - Componentes reutilizáveis
- `src/services/` - API client (Axios)
- `src/context/` - Zustand stores
- `src/styles/` - CSS
- `src/App.tsx` - Rotas

## 🏗️ Build

```bash
npm run build
# Output: dist/
npm run preview
```

---

**Status**: ✅ Pronto | **Port**: 5173
