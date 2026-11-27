const { test } = require('node:test');
const assert = require('node:assert/strict');
const { findDispatchCandidates } = require('../dist/services/DeliveryDispatch');
const routing = require('../dist/services/DeliveryRouting');
const approval = require('../dist/services/AsaasStoreApproval');

test('calcula a corrida com a distância de aproximação pela via e todas as coletas', async (t) => {
  const oldRouter = process.env.VALHALLA_ROUTE_URL;
  process.env.VALHALLA_ROUTE_URL = 'https://routing.example/route';
  t.after(() => {
    if (oldRouter === undefined) delete process.env.VALHALLA_ROUTE_URL;
    else process.env.VALHALLA_ROUTE_URL = oldRouter;
  });
  t.mock.method(approval, 'filterDriversEligibleForPayout', async (drivers) => drivers);
  t.mock.method(routing, 'routeDelivery', async () => ({ distance: 2500, duration: 360 }));
  const db = {
    query: async () => ({ rows: [{
      user_id: 'driver', rate_cents: 250, fee_cents: 2250, offer_fee_cents: 2250,
      latitude: -10.1, longitude: -37, pickup_meters: 1000, pickup_minutes: 4, reasons: [],
    }] }),
  };
  const route = {
    pickup_latitude: -10, pickup_longitude: -37, distance_meters: 8000,
    duration_minutes: 30, rate_cents: 250, fee_cents: 2500, subsidy_cents: 200, radius_meters: 3000,
    multiPickup: true,
  };
  const [offer] = await findDispatchCandidates(db, route, null);
  assert.equal(offer.pickup_meters, 2500);
  assert.equal(offer.pickup_minutes, 6);
  assert.equal(offer.offer_fee_cents, 2625);
  assert.deepEqual(await findDispatchCandidates(db, { ...route, subsidy_cents: 0 }, null), []);
});
