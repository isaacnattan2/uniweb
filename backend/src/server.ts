import dotenv from 'dotenv';

// Load .env FIRST before importing anything that uses environment variables
dotenv.config();

import app from './app';
import { startBackgroundWork } from './services/BackgroundWork';

const PORT = process.env.PORT || 3000;

console.log('🔗 DATABASE_URL loaded:', process.env.DATABASE_URL ? 'YES' : 'NO');

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📊 Database: Connected to Neon`);
  startBackgroundWork();
});
