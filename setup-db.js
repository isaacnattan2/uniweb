#!/usr/bin/env node

const fs = require('fs');
const { Client } = require('pg');

const connectionString = process.argv[2] || process.env.DATABASE_URL;
const sqlFile = process.argv[3] || './database/DATABASE_SETUP.sql';

if (!connectionString) {
  console.error('❌ Connection string is required as argument or DATABASE_URL env var');
  process.exit(1);
}

(async () => {
  const client = new Client({ connectionString });
  
  try {
    console.log('📡 Connecting to Neon...');
    await client.connect();
    console.log('✅ Connected!');
    
    console.log(`📖 Reading SQL file: ${sqlFile}`);
    const sql = fs.readFileSync(sqlFile, 'utf-8');
    
    console.log('⏳ Executing DATABASE_SETUP.sql...');
    await client.query(sql);
    console.log('✅ Database setup completed!');
    
    // Verify tables
    console.log('\n📊 Verifying tables...');
    const result = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name
    `);
    
    console.log(`\n✅ Created ${result.rows.length} tables:\n`);
    result.rows.forEach((row, i) => {
      console.log(`  ${i + 1}. ${row.table_name}`);
    });
    
    await client.end();
    console.log('\n✅ All done! 🎉');
  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  }
})();
