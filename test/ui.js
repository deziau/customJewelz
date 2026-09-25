/* eslint-disable no-console */
/**
 * End-to-end check of the hosted shop (hosted/index.html) in a real browser.
 *
 * The page normally talks to the Claude artifact database through
 * `claude.use('db')`. Here that is replaced by a small in-memory store seeded
 * with the sample artwork in public/img/samples, so the whole customer journey
 * can run offline: choose a bangle, hang charms, add a chain drop, sign up,
 * check out, and reopen the order for changes.
 *
 *   npm run test:ui                      # uses Playwright's Chromium
 *   CHROMIUM=/path/to/chrome npm run test:ui
 *   SHOTS=out/ npm run test:ui           # also saves screenshots
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { chromium } = require('playwright-core');

const ROOT = path.join(__dirname, '..');
const PAGE = `file://${path.join(ROOT, 'hosted', 'index.html')}`;
const SHOTS = process.env.SHOTS || '';

const art = (name) => 'data:image/svg+xml;base64,'
  + fs.readFileSync(path.join(ROOT, 'public', 'img', 'samples', `${name}.svg`)).toString('base64');

const piece = (name, category, price, mm, qty, extra = {}) => ({
  name, category, price, widthMm: mm[0], heightMm: mm[1], images: [art(extra.art)], stickers: [art(extra.art)],
  variants: [{ id: 'v0', name: extra.colour || '', quantity: qty }], ...extra,
});

const CATALOG = {
  kada: piece('Gold Kada', 'bangles', 45, [70, 70], 5, { art: 'bangle-kada', colour: 'Gold', order: 1 }),
  heart: piece('Heart', 'charms', 6, [12, 12], 20, { art: 'charm-heart', order: 2 }),
  star: piece('Star', 'charms', 6, [12, 12], 20, { art: 'charm-star', order: 3 }),
  pearl: piece('Pearl', 'charms', 9, [8, 12], 1, { art: 'charm-pearl', order: 4 }),
  bell: piece('Bell', 'charms', 5, [10, 12], 0, { art: 'charm-bell', order: 5 }),
  chain: piece('Cable Chain', 'chains', 30, [2, 20], 300, { art: 'chain-cable', soldBy: 'length', tileCm: 2, order: 6 }),
};

/** Runs in the page before any of its scripts: a stand-in for claude.use('db'). */
function installStore(seed) {
  const sections = [['bangles', 'Bangles'], ['charms', 'Charms'], ['chains', 'Chains']]
    .map(([slug, name]) => ({ slug, name, kind: 'attachment' }));
  const store = {
    catalog: seed, zones: { metro: { area: 'Metro', cost: 8, eta: '3' } }, orders: {}, restock: {}, customers: {},
    meta: { settings: { businessName: 'CustomJewelz', currency: 'A$', threshold: 10, pin: '2468', sections } },
  };
  window.__store = store;
  const listeners = [];
  const snapDoc = (id, d) => ({ id, exists: Boolean(d), data: () => (d ? JSON.parse(JSON.stringify(d)) : undefined) });
  const notify = () => setTimeout(() => listeners.forEach((f) => f()), 0);
  const doc = (p) => {
    const [c, id] = p.split('/');
    return {
      onSnapshot(cb) { const f = () => cb(snapDoc(id, (store[c] || {})[id])); listeners.push(f); setTimeout(f, 0); return () => {}; },
      async get() { return snapDoc(id, (store[c] || {})[id]); },
      async set(d) { (store[c] ||= {})[id] = JSON.parse(JSON.stringify(d)); notify(); },
      async update(d) { Object.assign(store[c][id], JSON.parse(JSON.stringify(d))); notify(); },
      async delete() { delete store[c][id]; notify(); },
    };
  };
  const collection = (name) => ({
    onSnapshot(cb) {
      const f = () => cb({ docs: Object.entries(store[name] || {}).map(([id, d]) => snapDoc(id, d)) });
      listeners.push(f); setTimeout(f, 0); return () => {};
    },
    doc: (id) => doc(`${name}/${id}`),
  });
  window.claude = { use: async () => ({ collection, doc }) };
}

function chromePath() {
  if (process.env.CHROMIUM) return process.env.CHROMIUM;
  const local = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
  return fs.existsSync(local) ? local : undefined;
}

async function run(browser, label, viewport) {
  const ctx = await browser.newContext({ viewport });
  await ctx.addInitScript(installStore, CATALOG);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const shot = async (name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${label}-${name}.png`) }); };
  const text = (sel) => page.textContent(sel);

  await page.goto(PAGE);
  await page.waitForSelector('#builder:not([hidden])');

  // One bangle in stock, so Create starts on it without asking.
  await page.waitForSelector('#bd-stage svg');
  assert.match(await text('#bd-panel'), /Gold Kada/);
  assert.match(await text('#bd-total'), /A\$45/);
  assert.equal(await page.$$eval('#bd-stage .slot', (n) => n.length), 7, 'seven empty spots');
  await shot('1-start');

  // Hang three charms; each fills the next spot, from the middle outwards.
  for (const id of ['heart', 'star', 'heart']) await page.click(`#bd-panel [data-charm="${id}"]`);
  assert.equal(await page.$$eval('#bd-stage .hung', (n) => n.length), 3);
  assert.match(await text('#bd-total'), /A\$63/);                 // 45 + 3 × 6

  // Sold out is not offered; the last pearl can be hung once and only once.
  assert.equal(await page.$eval('#bd-panel [data-charm="bell"]', (b) => b.disabled), true);
  await page.click('#bd-panel [data-charm="pearl"]');
  assert.equal(await page.$eval('#bd-panel [data-charm="pearl"]', (b) => b.disabled), true, 'pearl now all used');

  // Hanging moves on to the next empty spot; tap the pearl to dress it.
  await page.dispatchEvent('#bd-stage .hung[aria-label*="Pearl"] .halo', 'click');
  assert.match(await text('#bd-panel .bd-chosen'), /Pearl/);
  // A drop of chain under the pearl adds 4 cm of chain at A$30/m.
  await page.click('#bd-panel [data-drop="mid"]');
  assert.match(await text('#bd-total'), /A\$73\.20/);             // 45 + 18 + 9 + 1.20
  assert.equal(await page.$$eval('#bd-stage .hung rect[fill^="url(#bd-ch"], #bd-stage .hung ellipse', (n) => n.length) > 0, true);

  // Mirror copies the left spots onto the right.
  await page.click('#bd-panel [data-bd="mirror"]');
  const hung = await page.$$eval('#bd-stage .hung', (n) => n.length);
  assert.ok(hung >= 4, `mirror should add pieces (${hung})`);
  await shot('2-built');

  // Nothing sideways-scrolls, at any width.
  const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
  assert.ok(sw <= iw, `page overflows sideways: ${sw} > ${iw}`);

  // The tray always equals the piece, so checkout never asks about leftovers.
  const trayVsPiece = await page.evaluate(() => S.tray.every((r) => placedQty(r.itemId, r.variantId) === r.qty));
  assert.ok(trayVsPiece, 'tray and piece disagree');

  // Ordering asks for an account, then carries straight on to checkout.
  const totalBefore = await text('#bd-total');
  await page.click('#bd-order');
  await page.waitForSelector('#dlg-auth[open]');
  await page.click('#auth-up');
  await page.fill('input[name=upName]', 'Asha Test');
  await page.fill('input[name=upEmail]', 'asha@example.com');
  await page.fill('input[name=upPhone]', '0400 000 000');
  await page.fill('input[name=upPin]', '2468');
  await page.click('#auth-submit');
  await page.waitForSelector('#dlg-checkout[open]');
  assert.equal(await page.inputValue('#form-checkout input[name=email]'), 'asha@example.com', 'contact prefilled');
  await shot('3-checkout');
  await page.click('#ck-submit');
  await page.waitForSelector('#dlg-done[open]');
  await shot('4-done');

  const order = await page.evaluate(() => Object.values(window.__store.orders)[0]);
  assert.ok(order, 'order saved');
  assert.ok(order.snapshot && order.snapshot.startsWith('data:image/'), 'order carries a picture');
  assert.ok(order.design.build && order.design.build.baseId === 'kada', 'order remembers the build');
  assert.equal(`A$${order.total.toFixed(2)}`.replace('.00', ''), totalBefore.replace('.00', ''));
  assert.ok(order.items.some((i) => i.itemId === 'chain' && i.qty === 4), 'chain billed by the cm');

  // Create starts fresh after an order.
  await page.click('#done-close');
  assert.match(await text('#bd-count'), /add charms/);

  // Editing the order within the hour reopens it in Create, exactly as it was.
  await page.click('#mode-mine');
  await page.click('.order-card [data-cust="amend"]').catch(async () => {
    await page.click('.order-card');
    await page.click('#order-body [data-cust="amend"]');
  });
  await page.waitForSelector('#builder:not([hidden])');
  assert.equal(await page.$$eval('#bd-stage .hung', (n) => n.length), hung, 'amend restores every charm');
  assert.equal(await page.isHidden('#bd-amend'), false, 'amend banner shows');

  // The studio is not in a shopper's way.
  assert.equal(await page.isHidden('#mode-studio'), true, 'studio hidden from shoppers');

  assert.deepEqual(errors, [], `page errors: ${errors.join('; ')}`);
  await ctx.close();
  console.log(`✓ ${label}`);
}

/** The studio can say what a piece is and where its loop is, and Create uses it. */
async function studio(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(installStore, CATALOG);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${PAGE}#studio`);
  await page.waitForSelector('#dlg-pin[open]');
  await page.fill('#form-pin input[name=pin]', '2468');
  await page.click('#form-pin button[type=submit]');
  await page.waitForSelector('#studio:not([hidden])');
  await page.click('#admin-tabs [data-view="repo"]');
  await page.evaluate(() => openPieceDialog(itemOf('star')));
  await page.waitForSelector('#dlg-piece[open]');
  assert.equal(await page.isVisible('#loop-field'), true, 'a charm offers the loop picker');
  assert.equal(await page.isVisible('#slots-field'), false, 'a charm has no spots');
  await page.locator('#loop-pick img').scrollIntoViewIfNeeded();
  const box = await page.locator('#loop-pick img').boundingBox();
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.1);
  await page.click('#form-piece button[type=submit]');
  await page.waitForSelector('#dlg-piece[open]', { state: 'detached' }).catch(async () => { throw new Error('save failed: ' + await page.textContent('#piece-error')); });
  const saved = await page.evaluate(() => window.__store.catalog.star);
  assert.ok(saved.loop && Math.abs(saved.loop.x - 50) < 3 && Math.abs(saved.loop.y - 10) < 3, `loop saved: ${JSON.stringify(saved.loop)}`);
  assert.equal(saved.name, 'Star', 'the rest of the component survives the save');

  await page.evaluate(() => openPieceDialog(itemOf('kada')));
  assert.equal(await page.isVisible('#slots-field'), true, 'a bangle offers spots');
  await page.fill('#form-piece input[name=slots]', '5');
  await page.click('#form-piece button[type=submit]');
  await page.waitForSelector('#dlg-piece[open]', { state: 'detached' }).catch(async () => { throw new Error('save failed: ' + await page.textContent('#piece-error')); });
  assert.equal(await page.evaluate(() => window.__store.catalog.kada.slots), 5);

  // Create picks the new spot count up.
  await page.click('#mode-build');
  await page.waitForSelector('#bd-stage svg');
  assert.equal(await page.$$eval('#bd-stage .slot', (n) => n.length), 5, 'five spots after the studio said so');
  assert.deepEqual(errors, [], `page errors: ${errors.join('; ')}`);
  await ctx.close();
  console.log('✓ studio');
}

(async () => {
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch({ executablePath: chromePath() });
  try {
    await run(browser, 'desktop', { width: 1440, height: 900 });
    await run(browser, 'phone', { width: 390, height: 844 });
    await studio(browser);
    console.log('UI tests passed');
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
