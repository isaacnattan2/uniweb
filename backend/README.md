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
