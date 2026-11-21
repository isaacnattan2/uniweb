# 🚀 Setup Neon - Passo a Passo

## 1. Abrir Console Neon
```
https://console.neon.tech
```

## 2. Criar Projeto (se não tiver)
- **Novo Projeto**
- Nome: `app-uni`
- Database name: `appuni` (auto-preenchido)
- Region: US East (ou sua preferência)
- Click: **Create project**

## 3. Pegar Connection String
Após criar, você verá a tela com:
```
Connection string:
postgresql://[user]:[password]@[host]/[dbname]?sslmode=require
```

**Copie essa string!**

## 4. Executar Schema
```bash
# Cole sua connection string aqui:
psql "COLE_A_CONNECTION_STRING_AQUI" < database/DATABASE_SETUP.sql
```

Exemplo:
```bash
psql "postgresql://neondb_owner:abc123@ep-xyz.us-east-1.neon.tech/appuni?sslmode=require" < database/DATABASE_SETUP.sql
```

## 5. Verificar Setup
```bash
# Conecte e verifique
psql "postgresql://..."

# No psql, digite:
\dt
# Deve aparecer 14 tabelas!
```

## Pronto! 🎉
Você agora tem:
- ✅ 14 tabelas
- ✅ Enums e constraints
- ✅ Indices otimizados
- ✅ Triggers automáticos

**Connection string para .env:**
```
DATABASE_URL=postgresql://user:pass@host/appuni?sslmode=require
```
