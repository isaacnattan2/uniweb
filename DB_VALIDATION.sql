-- Verificação de Integridade do Banco de Dados

-- 1. Verificar se todas as tabelas necessárias existem
SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'public' 
ORDER BY table_name;

-- 2. Verificar estrutura da tabela users
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'users' 
ORDER BY ordinal_position;

-- 3. Verificar estrutura da tabela businesses
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'businesses' 
ORDER BY ordinal_position;

-- 4. Verificar estrutura da tabela products
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'products' 
ORDER BY ordinal_position;

-- 5. Verificar estrutura da tabela orders
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'orders' 
ORDER BY ordinal_position;

-- 6. Verificar estrutura da tabela order_items
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'order_items' 
ORDER BY ordinal_position;

-- 7. Contar registros em cada tabela
SELECT 
  'users' as table_name, COUNT(*) as count FROM users
UNION ALL
SELECT 'businesses', COUNT(*) FROM businesses
UNION ALL
SELECT 'products', COUNT(*) FROM products
UNION ALL
SELECT 'orders', COUNT(*) FROM orders
UNION ALL
SELECT 'order_items', COUNT(*) FROM order_items;

-- 8. Verificar se há índices
SELECT indexname FROM pg_indexes 
WHERE schemaname = 'public';

-- 9. Verificar foreign keys
SELECT constraint_name, table_name, column_name, foreign_table_name, foreign_column_name
FROM information_schema.referential_constraints rc
JOIN information_schema.key_column_usage kcu USING(constraint_name)
WHERE rc.constraint_schema = 'public';
