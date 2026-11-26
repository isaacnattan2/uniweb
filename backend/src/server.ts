import dotenv from 'dotenv';

// Load .env FIRST before importing anything that uses environment variables
dotenv.config();

import app from './app';
import { reconcileDirectCardPayments } from './services/AsaasCardPayments';
import { tickDispatch } from './services/DeliveryDispatch';
import { reconcileDeliveryRefunds } from './services/DeliveryRefunds';

const PORT = process.env.PORT || 3000;

console.log('🔗 DATABASE_URL loaded:', process.env.DATABASE_URL ? 'YES' : 'NO');

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📊 Database: Connected to Neon`);
});

let dispatchRunning = false;
let refundsRunning = false;
let directPaymentsRunning = false;
setInterval(async () => {
  if (dispatchRunning) return;
  dispatchRunning = true;
  try { await tickDispatch(); }
  catch (error) { console.error('Falha no despacho de entregas.', error); }
  finally { dispatchRunning = false; }
}, 5000).unref();

setInterval(async () => {
  if (refundsRunning) return;
  refundsRunning = true;
  try { await reconcileDeliveryRefunds(); }
  catch (error) { console.error('Falha na conciliação de entregas.', error); }
  finally { refundsRunning = false; }
}, 15000).unref();

setInterval(async () => {
  if (directPaymentsRunning) return;
  directPaymentsRunning = true;
  try { await reconcileDirectCardPayments(); }
  catch { console.warn('Não foi possível consultar cobranças com cartão salvo.'); }
  finally { directPaymentsRunning = false; }
}, 20000).unref();
