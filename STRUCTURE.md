# 🗂️ Estrutura de Diretórios Recomendada - APP UNI (Uniweb)

```
uniweb/
├── 📁 database/                      ← Modelagem e setup do banco
│   ├── README.md                     ← Documentação principal
│   ├── DATABASE_DESIGN.md            ← Especificação de tabelas
│   ├── DATABASE_ER_DIAGRAM.md        ← Diagramas e relacionamentos
│   ├── DATABASE_QUERIES_EXAMPLES.md  ← Exemplos de queries otimizadas
│   ├── DATABASE_SETUP.sql            ← Script SQL pronto para executar
│   ├── setup.sh                      ← Script de setup interativo
│   └── 📁 migrations/                ← Migrações de versão (Flyway/Alembic)
│       ├── V1.0__initial_schema.sql
│       ├── V1.1__add_rls_policies.sql
│       └── ...
│
├── 📁 backend/                       ← API Backend (Node.js/Express)
│   ├── src/
│   │   ├── 📁 config/                ← Configurações
│   │   │   ├── database.ts           ← Conexão com banco
│   │   │   ├── auth.ts               ← Configuração de autenticação
│   │   │   └── env.ts                ← Variáveis de ambiente
│   │   │
│   │   ├── 📁 models/                ← Schemas/Interfaces (TypeScript)
│   │   │   ├── User.ts
│   │   │   ├── Business.ts
│   │   │   ├── Order.ts
│   │   │   ├── Driver.ts
│   │   │   ├── Ride.ts
│   │   │   ├── UrbanIssue.ts
│   │   │   └── ...
│   │   │
│   │   ├── 📁 routes/                ← Endpoints da API
│   │   │   ├── auth.routes.ts        ← Login, registro
│   │   │   ├── users.routes.ts       ← CRUD de usuários
│   │   │   ├── products.routes.ts    ← Produtos
│   │   │   ├── orders.routes.ts      ← Pedidos
│   │   │   ├── rides.routes.ts       ← Corridas
│   │   │   ├── deliveries.routes.ts  ← Entregas
│   │   │   ├── businesses.routes.ts  ← Comércios
│   │   │   ├── drivers.routes.ts     ← Motoristas
│   │   │   ├── wallets.routes.ts     ← Carteiras
│   │   │   ├── urban_issues.routes.ts← Dados urbanos
│   │   │   └── reviews.routes.ts     ← Avaliações
│   │   │
│   │   ├── 📁 controllers/           ← Lógica de negócio
│   │   │   ├── authController.ts
│   │   │   ├── userController.ts
│   │   │   ├── orderController.ts
│   │   │   ├── rideController.ts
│   │   │   ├── driverController.ts
│   │   │   ├── deliveryController.ts
│   │   │   ├── businessController.ts
│   │   │   └── ...
│   │   │
│   │   ├── 📁 services/              ← Serviços (integração com BD)
│   │   │   ├── UserService.ts
│   │   │   ├── OrderService.ts
│   │   │   ├── PaymentService.ts     ← Integração com pagamento
│   │   │   ├── GeolocationService.ts ← Cálculo de distância/GPS
│   │   │   ├── CashbackService.ts    ← Lógica de cashback
│   │   │   ├── NotificationService.ts← Push notifications
│   │   │   └── ...
│   │   │
│   │   ├── 📁 middleware/            ← Middlewares Express
│   │   │   ├── auth.middleware.ts    ← Verificar JWT
│   │   │   ├── errorHandler.ts       ← Tratamento de erros
│   │   │   ├── validation.middleware.ts ← Validação de dados
│   │   │   ├── rateLimit.middleware.ts  ← Rate limiting
│   │   │   └── cors.middleware.ts
│   │   │
│   │   ├── 📁 utils/                 ← Utilitários
│   │   │   ├── logger.ts             ← Logs
│   │   │   ├── validators.ts         ← Validadores
│   │   │   ├── constants.ts          ← Constantes
│   │   │   ├── errors.ts             ← Classes de erro
│   │   │   └── helpers.ts
│   │   │
│   │   ├── 📁 types/                 ← Tipos TypeScript
│   │   │   ├── index.ts              ← Exporta todos os tipos
│   │   │   └── ...
│   │   │
│   │   └── app.ts                    ← Entrada da aplicação
│   │   └── server.ts                 ← Inicialização do servidor
│   │
│   ├── tests/                        ← Testes
│   │   ├── unit/                     ← Testes unitários
│   │   ├── integration/              ← Testes de integração
│   │   └── e2e/                      ← Testes end-to-end
│   │
│   ├── .env.example                  ← Exemplo de variáveis de ambiente
│   ├── .env.test                     ← Variáveis para testes
│   ├── package.json
│   ├── tsconfig.json
│   ├── jest.config.js                ← Configuração de testes
│   └── README.md
│
├── 📁 mobile/                        ← App Mobile (React Native/Flutter)
│   ├── src/
│   │   ├── 📁 screens/               ← Telas
│   │   │   ├── 📁 auth/              ← Login, registro
│   │   │   ├── 📁 customer/          ← Telas do cliente
│   │   │   ├── 📁 driver/            ← Telas do motorista
│   │   │   ├── 📁 business/          ← Telas do comércio
│   │   │   └── ...
│   │   │
│   │   ├── 📁 components/            ← Componentes reutilizáveis
│   │   │   ├── Map.tsx
│   │   │   ├── OrderCard.tsx
│   │   │   ├── DriverCard.tsx
│   │   │   └── ...
│   │   │
│   │   ├── 📁 navigation/            ← Navegação
│   │   │   ├── RootNavigator.tsx
│   │   │   ├── AuthNavigator.tsx
│   │   │   └── AppNavigator.tsx
│   │   │
│   │   ├── 📁 services/              ← Serviços (API calls)
│   │   │   ├── api.ts                ← Cliente HTTP
│   │   │   ├── auth.service.ts
│   │   │   ├── order.service.ts
│   │   │   └── ...
│   │   │
│   │   ├── 📁 redux/ (ou Context)    ← State management
│   │   │   ├── 📁 slices/
│   │   │   │   ├── authSlice.ts
│   │   │   │   ├── orderSlice.ts
│   │   │   │   └── ...
│   │   │   └── store.ts
│   │   │
│   │   ├── 📁 utils/                 ← Utilitários
│   │   │   ├── constants.ts
│   │   │   ├── formatters.ts
│   │   │   └── validators.ts
│   │   │
│   │   └── App.tsx                   ← Entrada principal
│   │
│   └── package.json
│
├── 📁 admin-dashboard/               ← Dashboard Admin (React/Vue/Next.js)
│   ├── src/
│   │   ├── 📁 pages/                 ← Páginas
│   │   │   ├── Dashboard.tsx
│   │   │   ├── Users.tsx
│   │   │   ├── Orders.tsx
│   │   │   ├── Drivers.tsx
│   │   │   ├── Analytics.tsx
│   │   │   └── Settings.tsx
│   │   │
│   │   ├── 📁 components/            ← Componentes
│   │   │   ├── 📁 common/
│   │   │   ├── 📁 forms/
│   │   │   ├── 📁 charts/
│   │   │   └── 📁 tables/
│   │   │
│   │   ├── 📁 services/              ← Chamadas à API
│   │   │   ├── adminApi.ts
│   │   │   └── ...
│   │   │
│   │   └── App.tsx
│   │
│   └── package.json
│
├── 📁 docs/                          ← Documentação geral
│   ├── API.md                        ← Documentação da API
│   ├── ARCHITECTURE.md               ← Arquitetura do projeto
│   ├── DEPLOYMENT.md                 ← Deploy em produção
│   ├── CONTRIBUTING.md               ← Guia de contribuição
│   └── TROUBLESHOOTING.md            ← Resolução de problemas
│
├── .github/                          ← GitHub workflows
│   └── workflows/
│       ├── ci.yml                    ← CI/CD Pipeline
│       ├── test.yml                  ← Testes automáticos
│       └── deploy.yml                ← Deploy automático
│
├── docker-compose.yml                ← Orquestração de serviços
├── .env.example                      ← Template de variáveis
├── .gitignore
├── README.md                         ← Raiz do projeto
└── ROADMAP.md                        ← Roadmap de features

```

---

## 📊 Padrão de Camadas

```
┌─────────────────────────────────────────┐
│          Frontend / Mobile              │
│   (React, React Native, Flutter)        │
└──────────────────┬──────────────────────┘
                   │ HTTP/REST/GraphQL
┌──────────────────▼──────────────────────┐
│          API Layer (Backend)            │
│   ├─ Routes (Express)                   │
│   ├─ Controllers (Lógica)               │
│   └─ Middleware (Auth, Validation)      │
└──────────────────┬──────────────────────┘
                   │
┌──────────────────▼──────────────────────┐
│       Business Logic Layer              │
│   ├─ Services (Regras de negócio)       │
│   ├─ Utils (Helpers)                    │
│   └─ Cache (Redis)                      │
└──────────────────┬──────────────────────┘
                   │
┌──────────────────▼──────────────────────┐
│       Data Access Layer (ORM)           │
│   Prisma / TypeORM / Sequelize          │
└──────────────────┬──────────────────────┘
                   │
┌──────────────────▼──────────────────────┐
│      PostgreSQL Database (Neon)         │
│   ├─ 14 Tabelas                         │
│   ├─ Índices otimizados                 │
│   └─ Triggers & Views                   │
└─────────────────────────────────────────┘
```

---

## 🚀 Fluxo de Desenvolvimento

### 1. Backend (Prioridade 1)
```
database/ ✅
  ↓
backend/src/config/ 
  ↓
backend/src/models/
  ↓
backend/src/services/
  ↓
backend/src/routes/
  ↓
backend/src/controllers/
```

### 2. Mobile (Prioridade 2)
```
backend (completo)
  ↓
mobile/src/services/
  ↓
mobile/src/screens/
  ↓
mobile/src/components/
```

### 3. Admin Dashboard (Prioridade 3)
```
backend (completo)
  ↓
admin-dashboard/src/pages/
  ↓
admin-dashboard/src/components/
```

---

## 📦 Stack Recomendado

### Backend
- **Runtime**: Node.js 18+
- **Framework**: Express.js ou Fastify
- **Language**: TypeScript
- **ORM**: Prisma (recomendado)
- **Testing**: Jest + Supertest
- **API Docs**: Swagger/OpenAPI

### Mobile
- **Framework**: React Native (Expo) ou Flutter
- **State**: Redux Toolkit ou Riverpod
- **Maps**: Google Maps API / Mapbox
- **Auth**: JWT + Secure Storage

### Admin
- **Framework**: Next.js ou React + Vite
- **UI**: Material-UI ou TailwindCSS
- **Charts**: Chart.js ou Recharts
- **API**: SWR ou React Query

---

## 🔧 Configuração Inicial

```bash
# 1. Setup do banco
cd uniweb/database
bash setup.sh

# 2. Criar backend
cd ../backend
npm init -y
npm install express typescript ts-node @types/node @types/express
npm install prisma @prisma/client
npm install dotenv cors helmet

# 3. Inicializar Prisma
npx prisma init
# Configure DATABASE_URL em .env

# 4. Gerar cliente Prisma
npx prisma generate

# 5. Testar conexão
npm run dev
```

---

## 📋 Checklist de Implementação

- [ ] Database setup completo
- [ ] Projeto backend inicializado
- [ ] Conexão com banco de dados
- [ ] Autenticação (JWT)
- [ ] CRUD básico de usuários
- [ ] Endpoints de compras
- [ ] Endpoints de mobilidade
- [ ] Endpoints de entregas
- [ ] Mobile app estruturado
- [ ] Admin dashboard estruturado
- [ ] CI/CD configurado
- [ ] Deploy em produção

---

**Versão**: 1.0  
**Atualizado**: 2024-11-20  
**Status**: Pronto para começar!
