const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function runMigration() {
  const client = await pool.connect();
  
  try {
    const migrationSql = fs.readFileSync(path.join(__dirname, 'migrations', 'add_product_images.sql'), 'utf8');
    
    console.log('Executando migration...');
    await client.query(migrationSql);
    console.log('✓ Migration executada com sucesso!');
  } catch (err) {
    console.error('✗ Erro ao executar migration:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

runMigration();
