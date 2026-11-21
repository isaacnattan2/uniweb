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
```

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
