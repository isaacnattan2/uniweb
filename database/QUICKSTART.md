# 🚀 APP UNI - Database Setup

## Setup Rápido

### Neon (Cloud - Recomendado)
```bash
# 1. Criar conta em https://neon.tech
# 2. Copiar connection string
# 3. Executar:
psql "postgresql://user:pass@host/db" < DATABASE_SETUP.sql
```

### Docker Local
```bash
docker run --name appuni-db -e POSTGRES_DB=appuni -e POSTGRES_PASSWORD=pass -p 5432:5432 -d postgres:14

sleep 3

PGPASSWORD=pass psql -h localhost -U postgres -d appuni < DATABASE_SETUP.sql
```

### PostgreSQL Local
```bash
psql -U postgres -d your_db < DATABASE_SETUP.sql
```

## ✅ Pronto!

Banco com 14 tabelas:
- users, wallets, businesses, products
- orders, order_items, drivers, rides, deliveries
- urban_issues, transactions, reviews, user_devices, audit_logs

Connection string: `postgresql://user:pass@host/appuni`
