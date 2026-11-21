#!/bin/bash
# ============================================================================
# APP UNI - Database Setup Script
# Facilita o setup do banco de dados em diferentes ambientes
# ============================================================================

set -e

echo "🚀 APP UNI - Database Setup Assistant"
echo "===================================="
echo ""

# Cores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Detectar sistema operacional
if [[ "$OSTYPE" == "linux-gnu"* ]]; then
  OS="linux"
elif [[ "$OSTYPE" == "darwin"* ]]; then
  OS="macos"
elif [[ "$OSTYPE" == "msys" || "$OSTYPE" == "cygwin" ]]; then
  OS="windows"
else
  OS="unknown"
fi

# Menu de opções
echo "Escolha a opção desejada:"
echo "1. Setup com Neon (Cloud PostgreSQL) - RECOMENDADO"
echo "2. Setup com PostgreSQL Local (Docker)"
echo "3. Setup com PostgreSQL Local (Instalado)"
echo "4. Apenas visualizar schema"
echo ""
read -p "Digite a opção (1-4): " option

case $option in
  1)
    echo ""
    echo -e "${YELLOW}📋 Setup com Neon${NC}"
    echo "Pré-requisitos: Conta no Neon (https://neon.tech)"
    echo ""
    read -p "Digite a connection string do Neon: " NEON_URL
    
    if [[ -z "$NEON_URL" ]]; then
      echo -e "${RED}❌ Connection string vazia!${NC}"
      exit 1
    fi
    
    echo -e "${YELLOW}Executando script SQL no Neon...${NC}"
    psql "$NEON_URL" < DATABASE_SETUP.sql
    
    if [ $? -eq 0 ]; then
      echo -e "${GREEN}✅ Database setup completo no Neon!${NC}"
      echo ""
      echo "Próximos passos:"
      echo "1. Aguarde 30 segundos para propagação DNS"
      echo "2. Teste a conexão: psql \"$NEON_URL\" -c \"SELECT * FROM users LIMIT 1;\""
      echo "3. Configure suas variáveis de ambiente:"
      echo "   export DATABASE_URL=\"$NEON_URL\""
    else
      echo -e "${RED}❌ Erro ao executar script SQL${NC}"
      exit 1
    fi
    ;;
    
  2)
    echo ""
    echo -e "${YELLOW}🐳 Setup com Docker${NC}"
    echo ""
    
    if ! command -v docker &> /dev/null; then
      echo -e "${RED}❌ Docker não está instalado!${NC}"
      echo "Instale em: https://www.docker.com/products/docker-desktop"
      exit 1
    fi
    
    # Parar container anterior se existir
    if docker ps -a | grep -q appuni-db; then
      echo "Parando container anterior..."
      docker stop appuni-db 2>/dev/null || true
      docker rm appuni-db 2>/dev/null || true
    fi
    
    echo "Iniciando PostgreSQL em container..."
    docker run --name appuni-db \
      -e POSTGRES_DB=appuni \
      -e POSTGRES_USER=appuni_user \
      -e POSTGRES_PASSWORD=appuni_password \
      -p 5432:5432 \
      -d postgres:14 alpine
    
    echo "Aguardando inicialização do banco (5 segundos)..."
    sleep 5
    
    echo -e "${YELLOW}Executando script SQL...${NC}"
    PGPASSWORD=appuni_password psql -h localhost -U appuni_user -d appuni < DATABASE_SETUP.sql
    
    if [ $? -eq 0 ]; then
      echo -e "${GREEN}✅ Database setup completo!${NC}"
      echo ""
      echo "Conexão local:"
      echo "  Host: localhost"
      echo "  Port: 5432"
      echo "  Database: appuni"
      echo "  User: appuni_user"
      echo "  Password: appuni_password"
      echo ""
      echo "Connection string:"
      echo "  postgresql://appuni_user:appuni_password@localhost:5432/appuni"
      echo ""
      echo "Parar container: docker stop appuni-db"
      echo "Remover container: docker rm appuni-db"
    else
      echo -e "${RED}❌ Erro ao executar script SQL${NC}"
      docker stop appuni-db
      docker rm appuni-db
      exit 1
    fi
    ;;
    
  3)
    echo ""
    echo -e "${YELLOW}🖥️ Setup com PostgreSQL Local${NC}"
    echo ""
    
    if ! command -v psql &> /dev/null; then
      echo -e "${RED}❌ PostgreSQL não está instalado!${NC}"
      echo "Instale em: https://www.postgresql.org/download/"
      exit 1
    fi
    
    read -p "Digite o host (padrão: localhost): " PG_HOST
    PG_HOST=${PG_HOST:-localhost}
    
    read -p "Digite a porta (padrão: 5432): " PG_PORT
    PG_PORT=${PG_PORT:-5432}
    
    read -p "Digite o usuário (padrão: postgres): " PG_USER
    PG_USER=${PG_USER:-postgres}
    
    read -p "Digite o nome do banco (padrão: appuni): " PG_DB
    PG_DB=${PG_DB:-appuni}
    
    read -sp "Digite a senha: " PG_PASSWORD
    echo ""
    
    echo -e "${YELLOW}Testando conexão...${NC}"
    if PGPASSWORD=$PG_PASSWORD psql -h $PG_HOST -p $PG_PORT -U $PG_USER -d postgres -c "\q" 2>/dev/null; then
      echo -e "${GREEN}✅ Conexão bem-sucedida!${NC}"
    else
      echo -e "${RED}❌ Falha ao conectar ao banco${NC}"
      exit 1
    fi
    
    echo ""
    read -p "Deseja criar o banco de dados '$PG_DB'? (s/n): " create_db
    
    if [[ $create_db == "s" || $create_db == "S" ]]; then
      echo -e "${YELLOW}Criando banco de dados...${NC}"
      PGPASSWORD=$PG_PASSWORD psql -h $PG_HOST -p $PG_PORT -U $PG_USER -d postgres \
        -c "CREATE DATABASE $PG_DB;" 2>/dev/null || echo "Banco já existe"
    fi
    
    echo -e "${YELLOW}Executando script SQL...${NC}"
    PGPASSWORD=$PG_PASSWORD psql -h $PG_HOST -p $PG_PORT -U $PG_USER -d $PG_DB < DATABASE_SETUP.sql
    
    if [ $? -eq 0 ]; then
      echo -e "${GREEN}✅ Database setup completo!${NC}"
      echo ""
      echo "Connection string:"
      echo "  postgresql://$PG_USER:***@$PG_HOST:$PG_PORT/$PG_DB"
      echo ""
      echo "Variável de ambiente (adicione ao .env):"
      echo "  DATABASE_URL=\"postgresql://$PG_USER:$PG_PASSWORD@$PG_HOST:$PG_PORT/$PG_DB\""
    else
      echo -e "${RED}❌ Erro ao executar script SQL${NC}"
      exit 1
    fi
    ;;
    
  4)
    echo ""
    echo -e "${YELLOW}📋 Visualizando Schema${NC}"
    echo ""
    echo "Tabelas incluídas:"
    echo "  1. users"
    echo "  2. wallets"
    echo "  3. businesses"
    echo "  4. products"
    echo "  5. orders"
    echo "  6. order_items"
    echo "  7. drivers"
    echo "  8. rides"
    echo "  9. deliveries"
    echo "  10. urban_issues"
    echo "  11. transactions"
    echo "  12. reviews"
    echo "  13. user_devices"
    echo "  14. audit_logs"
    echo ""
    echo "Para ver o esquema completo, abra DATABASE_DESIGN.md"
    exit 0
    ;;
    
  *)
    echo -e "${RED}❌ Opção inválida!${NC}"
    exit 1
    ;;
esac

echo ""
echo -e "${GREEN}✅ Setup finalizado com sucesso!${NC}"
echo ""
echo "Próximas etapas:"
echo "1. Revisar a documentação em database/README.md"
echo "2. Configurar variáveis de ambiente (.env)"
echo "3. Implementar ORM (Prisma, TypeORM, etc)"
echo "4. Criar API endpoints"
echo ""
