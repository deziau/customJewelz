'use strict';

/**
 * End-to-end smoke test: boots the server against a throwaway database, seeds
 * it, then drives the real HTTP API through the whole customer + admin flow.
 * Run with `npm test`.
 */

const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cj-test-')), 'test.db');
const PORT = process.env.TEST_PORT || 3987;
const BASE = `http://127.0.0.1:${PORT}`;
const env = { ...process.env, DB_PATH, PORT: String(PORT), ADMIN_PASSWORD: 'admin123' };

spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'seed.js')], { env, stdio: 'ignore' });
const server = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], { env, stdio: 'ignore' });
// Detach the handle so a finished test run exits instead of waiting on the server.
server.unref();

let cleanedUp = false;
function cleanup() {
  if (cleanedUp) return;
  cleanedUp = true;
  server.kill();
  fs.rmSync(path.dirname(DB_PATH), { recursive: true, force: true });
}
process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(130); });

async function waitForServer() {
  for (let i = 0; i < 50; i += 1) {
    if (server.exitCode !== null) {
      throw new Error(`Test server exited early (code ${server.exitCode}) — is port ${PORT} already in use?`);
    }
    try { if ((await fetch(`${BASE}/api/config`)).ok) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Server did not start.');
}

let cookie = '';
async function call(path, opts = {}) {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...(opts.headers || {}) },
  });
  const setC = res.headers.get('set-cookie');
  if (setC) cookie = setC.split(';')[0];
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}
const assert = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); process.exitCode = 1; } else console.log('  ok –', msg); };

(async () => {
  await waitForServer();
  console.log('\n== public catalog ==');
  const cat = await call('/api/catalog');
  assert(cat.status === 200 && cat.body.elements.length === 15, 'catalog returns 15 pieces');
  const byS = Object.fromEntries(cat.body.elements.map(e => [e.sku, e]));
  assert(byS['CHM-BEL-01'].quantity === 0, 'bell charm is out of stock');
  assert(cat.body.shippingZones.length === 4, '4 shipping zones exposed');

  console.log('\n== quote & stock limits ==');
  const design = { baseElementId: byS['BASE-BR-01'].id, placements: [
    { elementId: byS['CHM-HRT-01'].id }, { elementId: byS['CHM-HRT-01'].id }, { elementId: byS['CHM-STR-01'].id }] };
  const q = await call('/api/quote', { method: 'POST', body: JSON.stringify({ design, fulfilment: 'pickup' }) });
  assert(q.body.itemsTotal === 1800 + 900 + 380, `pickup quote = ${q.body.itemsTotal}`);
  assert(q.body.total === q.body.itemsTotal, 'no shipping on pickup');

  const qs = await call('/api/quote', { method: 'POST', body: JSON.stringify({ design, fulfilment: 'ship', shippingArea: 'Within state' }) });
  assert(qs.body.total === q.body.itemsTotal + 150, `ship quote adds 150 -> ${qs.body.total}`);

  const over = { baseElementId: byS['BASE-BR-01'].id, placements: Array.from({ length: 11 }, () => ({ elementId: byS['CHM-OM-01'].id })) };
  const ov = await call('/api/quote', { method: 'POST', body: JSON.stringify({ design: over, fulfilment: 'pickup' }) });
  assert(ov.status === 400 && /Only 9 of Om charm/.test(ov.body.details[0].error), `oversell blocked: ${ov.body.details?.[0]?.error}`);

  const oos = { baseElementId: byS['BASE-BR-01'].id, placements: [{ elementId: byS['CHM-BEL-01'].id }] };
  const o2 = await call('/api/quote', { method: 'POST', body: JSON.stringify({ design: oos, fulfilment: 'pickup' }) });
  assert(o2.status === 400 && /out of stock/i.test(o2.body.details[0].error), 'out-of-stock piece blocked');

  const noArea = await call('/api/quote', { method: 'POST', body: JSON.stringify({ design, fulfilment: 'ship', shippingArea: 'Mars' }) });
  assert(noArea.status === 400, 'unknown shipping area rejected');

  console.log('\n== place order & stock decrement ==');
  const order = await call('/api/orders', { method: 'POST', body: JSON.stringify({
    customerName: 'Simran', customerPhone: '9876543210', fulfilment: 'ship',
    shippingArea: 'Within state', shippingAddress: '12 Mall Road', notes: 'Initial S', design }) });
  assert(order.status === 201 && order.body.orderNumber.startsWith('CJ-'), `order ${order.body.orderNumber} created`);
  assert(order.body.total === 3230, `order total ${order.body.total}`);

  const cat2 = await call('/api/catalog');
  const byS2 = Object.fromEntries(cat2.body.elements.map(e => [e.sku, e]));
  assert(byS2['CHM-HRT-01'].quantity === 38, `heart charm 40 -> ${byS2['CHM-HRT-01'].quantity}`);
  assert(byS2['BASE-BR-01'].quantity === 11, `base bracelet 12 -> ${byS2['BASE-BR-01'].quantity}`);

  const missingName = await call('/api/orders', { method: 'POST', body: JSON.stringify({ customerPhone: '1', fulfilment: 'pickup', design }) });
  assert(missingName.status === 400, 'order without name rejected');

  console.log('\n== admin auth ==');
  const noAuth = await call('/api/admin/elements');
  assert(noAuth.status === 401, 'admin API requires sign-in');
  const badLogin = await call('/api/admin/login', { method: 'POST', body: JSON.stringify({ password: 'nope' }) });
  assert(badLogin.status === 401, 'wrong password rejected');
  const login = await call('/api/admin/login', { method: 'POST', body: JSON.stringify({ password: 'admin123' }) });
  assert(login.status === 200, 'login succeeds');

  console.log('\n== admin views ==');
  const stock = await call('/api/admin/stock');
  assert(stock.body.outOfStock.some(e => e.sku === 'CHM-BEL-01'), 'bell charm appears in out-of-stock');
  assert(stock.body.lowStock.some(e => e.sku === 'CHM-OM-01'), 'om charm appears in low quantity');
  assert(stock.body.threshold === 10, 'threshold is 10');
  assert(!stock.body.lowStock.some(e => e.quantity === 0), 'out-of-stock not double-listed as low');

  const orders = await call('/api/admin/orders');
  assert(orders.body[0].items.length === 3, 'admin sees 3 line items for the order');
  const pick = await call('/api/admin/orders/pick-list');
  assert(pick.body.find(r => r.sku === 'CHM-HRT-01').needed === 2, 'pick list shows 2 heart charms needed');

  console.log('\n== restock + cancel restores stock ==');
  const bell = stock.body.outOfStock.find(e => e.sku === 'CHM-BEL-01');
  const re = await call(`/api/admin/elements/${bell.id}/restock`, { method: 'POST', body: JSON.stringify({ delta: 25 }) });
  assert(re.body.quantity === 25, `bell restocked to ${re.body.quantity}`);
  const neg = await call(`/api/admin/elements/${bell.id}/restock`, { method: 'POST', body: JSON.stringify({ delta: -99 }) });
  assert(neg.status === 400, 'cannot restock below zero');

  const cancel = await call(`/api/admin/orders/${orders.body[0].id}/status`, { method: 'PUT', body: JSON.stringify({ status: 'cancelled' }) });
  assert(cancel.body.status === 'cancelled', 'order cancelled');
  const cat3 = await call('/api/catalog');
  const byS3 = Object.fromEntries(cat3.body.elements.map(e => [e.sku, e]));
  assert(byS3['CHM-HRT-01'].quantity === 40, `cancel returned heart charms to 40 (got ${byS3['CHM-HRT-01'].quantity})`);
  const reopen = await call(`/api/admin/orders/${orders.body[0].id}/status`, { method: 'PUT', body: JSON.stringify({ status: 'in_progress' }) });
  assert(reopen.body.status === 'in_progress', 'order reopened');
  const cat4 = await call('/api/catalog');
  assert(cat4.body.elements.find(e => e.sku === 'CHM-HRT-01').quantity === 38, 'reopen re-deducted stock');

  console.log('\n== settings / shipping / summary ==');
  const zone = await call('/api/admin/shipping-zones', { method: 'POST', body: JSON.stringify({ area: 'Local city (same day)', cost: 10 }) });
  assert(zone.status === 400, 'duplicate shipping area rejected');
  const set = await call('/api/admin/settings', { method: 'PUT', body: JSON.stringify({ lowStockThreshold: 20 }) });
  assert(set.status === 200, 'threshold updated');
  const stock2 = await call('/api/admin/stock');
  assert(stock2.body.threshold === 20 && stock2.body.lowStock.some(e => e.sku === 'CHN-TSL-01'), 'threshold change re-buckets pieces');
  await call('/api/admin/settings', { method: 'PUT', body: JSON.stringify({ lowStockThreshold: 10 }) });
  const summary = await call('/api/admin/summary');
  assert(summary.body.openOrders === 1, 'summary counts 1 open order');

  const badSet = await call('/api/admin/settings', { method: 'PUT', body: JSON.stringify({ lowStockThreshold: 0 }) });
  assert(badSet.status === 400, 'invalid threshold rejected');

  console.log(process.exitCode ? '\nSOME CHECKS FAILED\n' : '\nALL CHECKS PASSED\n');
})().catch((err) => { console.error(err); process.exitCode = 1; }).finally(cleanup);
