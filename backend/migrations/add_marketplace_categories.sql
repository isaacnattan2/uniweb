CREATE TABLE IF NOT EXISTS marketplace_categories (
  kind TEXT NOT NULL CHECK (kind IN ('business', 'product')),
  value TEXT NOT NULL CHECK (char_length(value) BETWEEN 1 AND 100),
  label TEXT NOT NULL CHECK (char_length(label) BETWEEN 1 AND 100),
  PRIMARY KEY (kind, value)
);

INSERT INTO marketplace_categories (kind, value, label)
SELECT kind, value, label
FROM (VALUES ('business'), ('product')) AS kinds(kind)
CROSS JOIN (VALUES
  ('geral', 'Geral'), ('roupas', 'Roupas'), ('alimentos', 'Alimentos'),
  ('eletronicos', 'Eletrônicos'), ('livros', 'Livros'), ('informatica', 'Informática')
) AS defaults(value, label)
UNION ALL SELECT 'business', 'servicos', 'Serviços'
UNION ALL SELECT 'product', 'outros', 'Outros'
ON CONFLICT (kind, value) DO NOTHING;
