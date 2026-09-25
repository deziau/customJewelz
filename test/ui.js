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
  pearl: piece('Pearl', 'charms', 9, [8, 12], 2, { art: 'charm-pearl', order: 4 }),
  bell: piece('Bell', 'charms', 5, [10, 12], 0, { art: 'charm-bell', order: 5 }),
  chain: piece('Cable Chain', 'chains', 30, [2, 20], 300, { art: 'chain-cable', soldBy: 'length', tileCm: 2, order: 6 }),
};

/**
 * Runs in the page before any of its scripts: a stand-in for claude.use('db')
 * and claude.use('user'), enforcing the same access rules the shop is
 * published with, so the tests catch a page that asks for what it may not see.
 */
function installStore({ seed, role = 'customer', uid = 'u_asha', extra = {} }) {
  const sections = [['bangles', 'Bangles'], ['charms', 'Charms'], ['chains', 'Chains']]
    .map(([slug, name]) => ({ slug, name, kind: 'attachment' }));
  const store = {
    'zones/metro': { area: 'Metro', cost: 8, eta: '3' },
    'meta/settings': { businessName: 'CustomJewelz', currency: 'A$', threshold: 10, pin: '2468', sections },
    ...Object.fromEntries(Object.entries(seed).map(([id, d]) => [`catalog/${id}`, d])),
    ...extra,
  };
  window.__store = store;
  window.__refused = [];
  const studio = role === 'studio';
  const canRead = (p) => {
    const [top, who] = p.split('/');
    if (studio) return true;
    if (top === 'people') return who === uid;
    return !['orders', 'restock', 'customers'].includes(top);
  };
  const canWrite = (p) => {
    const [top, who] = p.split('/');
    if (studio) return true;
    if (top === 'people') return who === uid;
    return top === 'holds';
  };
  const listeners = [];
  const clone = (d) => JSON.parse(JSON.stringify(d));
  const snapDoc = (p, d) => ({ id: p.split('/').pop(), exists: Boolean(d), data: () => (d ? clone(d) : undefined) });
  const notify = () => setTimeout(() => listeners.forEach((f) => f()), 0);
  const refuse = (p) => { window.__refused.push(p); const e = new Error('refused'); e.code = 'invalid_argument'; throw e; };
  const read = (p) => (canRead(p) ? store[p] : (window.__refused.push(p), undefined));
  const doc = (p) => ({
    onSnapshot(cb) { const f = () => cb(snapDoc(p, read(p))); listeners.push(f); setTimeout(f, 0); return () => {}; },
    async get() { return snapDoc(p, read(p)); },
    async set(d) { if (!canWrite(p)) refuse(p); store[p] = clone(d); notify(); },
    async update(d) { if (!canWrite(p) || !store[p]) refuse(p); Object.assign(store[p], clone(d)); notify(); },
    async delete() { if (!canWrite(p)) refuse(p); delete store[p]; notify(); },
    collection: (c) => collection(`${p}/${c}`),
  });
  const list = (c) => {
    if (!canRead(`${c}/x`)) { window.__refused.push(c); return []; }
    const depth = c.split('/').length + 1;
    return Object.keys(store).filter((k) => k.startsWith(`${c}/`) && k.split('/').length === depth)
      .map((k) => snapDoc(k, store[k]));
  };
  const collection = (c) => ({
    onSnapshot(cb) { const f = () => cb({ docs: list(c) }); listeners.push(f); setTimeout(f, 0); return () => {}; },
    async get() { return { docs: list(c) }; },
    doc: (id) => doc(`${c}/${id}`),
  });
  const user = { id: async () => uid, canEdit: async () => studio, isOwner: async () => studio };
  window.claude = { use: async (name) => (name === 'db' ? { collection, doc } : name === 'user' ? user : null) };
}

function chromePath() {
  if (process.env.CHROMIUM) return process.env.CHROMIUM;
  const local = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
  return fs.existsSync(local) ? local : undefined;
}

async function run(browser, label, viewport) {
  const ctx = await browser.newContext({ viewport });
  // Another customer's order is already in the shop: a pearl is spoken for,
  // and nothing about that customer may reach this one.
  await ctx.addInitScript(installStore, { seed: CATALOG, extra: {
    'people/u_ravi': { name: 'Ravi Other', email: 'ravi@example.com', phone: '0411 111 111' },
    'people/u_ravi/orders/o_ravi': { no: 'CJ-1', uid: 'u_ravi', status: 'new', items: [{ itemId: 'pearl', variantId: 'v0', qty: 1 }] },
    'holds/o_ravi': { status: 'new', items: [{ itemId: 'pearl', variantId: 'v0', qty: 1 }] },
  } });
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
  assert.match(await text('#bd-panel .bd-on'), /Pearl/);
  // Hanging the pearl on 5 cm of chain adds the chain at A$30/m.
  await page.click('#bd-panel [data-len="5"]');
  assert.match(await text('#bd-total'), /A\$73\.50/);             // 45 + 18 + 9 + 1.50
  assert.equal(await page.$$eval('#bd-stage .hung rect[fill^="url(#bd-ch"], #bd-stage .hung ellipse', (n) => n.length) > 0, true);

  // Mirror copies the left spots of the bangle onto its right.
  await page.click('#bd-panel [data-bd="mirror"]');
  assert.ok(await page.$$eval('#bd-stage .hung', (n) => n.length) >= 4, 'mirror should add pieces');

  // A strand: a length of chain with several charms down it, the last one ending it.
  const empty = await page.evaluate(() => S.build.slots.findIndex((s) => !s));
  assert.ok(empty >= 0, 'a spot is still empty');
  await page.dispatchEvent(`#bd-stage .slot[data-slot="${empty}"]`, 'click');
  await page.click('#bd-panel [data-len="12"]');
  for (const id of ['star', 'heart', 'star']) await page.click(`#bd-panel [data-charm="${id}"]`);
  const ys = await page.evaluate((i) => layout().slots[i].charms.map((c) => c.box.y), empty);
  assert.equal(ys.length, 3, 'three charms on the strand');
  assert.ok(ys[0] < ys[1] && ys[1] < ys[2], `charms spread down the strand: ${ys}`);
  // Tapping one charm on the strand and picking another swaps just that one.
  await page.click('#bd-panel .bd-on [data-at="1"]');
  await page.click('#bd-panel [data-charm="star"]');
  assert.deepEqual(await page.evaluate((i) => S.build.slots[i].charms.map((c) => c.itemId), empty), ['star', 'star', 'star']);
  const hung = await page.$$eval('#bd-stage .hung', (n) => n.length);
  await shot('2-built');

  // The right hand is designed on its own; here it starts as a copy of the left.
  const left = await page.evaluate(() => hungCount('left'));
  await page.click('#bd-panel [data-hand="right"]');
  await page.click('#bd-panel [data-bd="copy-back"]');
  const [l2, right] = await page.evaluate(() => [hungCount('left'), hungCount('right')]);
  assert.equal(l2, left, 'the left hand is untouched');
  assert.equal(right, left - 1, 'the right hand copies all but the last pearl');
  assert.match(await text('#bd-count'), /A pair/);
  await shot('2b-pair');

  // Nothing sideways-scrolls, at any width.
  const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
  assert.ok(sw <= iw, `page overflows sideways: ${sw} > ${iw}`);

  // The tray always equals the piece, so checkout never asks about leftovers.
  const trayVsPiece = await page.evaluate(() => S.tray.every((r) => placedQty(r.itemId, r.variantId) === r.qty));
  assert.ok(trayVsPiece, 'tray and piece disagree');

  // Ordering asks for contact details once, then carries straight on to checkout.
  const totalBefore = await text('#bd-total');
  await page.click('#bd-order');
  await page.waitForSelector('#dlg-auth[open]');
  await page.fill('input[name=upName]', 'Asha Test');
  await page.fill('input[name=upEmail]', 'asha@example.com');
  await page.fill('input[name=upPhone]', '0400 000 000');
  await page.click('#auth-submit');
  await page.waitForSelector('#dlg-checkout[open]');
  assert.equal(await page.inputValue('#form-checkout input[name=email]'), 'asha@example.com', 'contact prefilled');
  await shot('3-checkout');
  await page.click('#ck-submit');
  await page.waitForSelector('#dlg-done[open]');
  await shot('4-done');

  // The order is in the customer's own corner, with a names-free hold beside it.
  const [orderId, order] = await page.evaluate(() => {
    const k = Object.keys(window.__store).find((p) => p.startsWith('people/u_asha/orders/'));
    return [k.split('/').pop(), window.__store[k]];
  });
  assert.ok(order, 'order saved');
  const hold = await page.evaluate((id) => window.__store[`holds/${id}`], orderId);
  assert.ok(hold && hold.items.length && !JSON.stringify(hold).includes('asha'), 'the hold claims stock without naming anyone');
  assert.equal(await page.evaluate(() => window.__store['people/u_asha'].email), 'asha@example.com', 'details kept privately');

  // Nothing about the other customer reached this one, and nothing asked for it.
  assert.ok(!(await page.evaluate(() => JSON.stringify(S.orders) + JSON.stringify(S.account))).includes('ravi'), 'no one else\'s order');
  assert.deepEqual(await page.evaluate(() => window.__refused), [], 'the page asked only for what it may see');
  // The other customer's hold counts: two pearls, one theirs, one on Asha's piece.
  assert.equal(await page.evaluate(() => freeToSell(itemOf('pearl'), 'v0')), 0, 'holds count against stock');
  assert.ok(order.snapshot && order.snapshot.startsWith('data:image/'), 'order carries a picture');
  const { hands } = order.design.build || {};
  assert.ok(hands && hands.left.baseId === 'kada' && hands.right.baseId === 'kada', 'order remembers both hands');
  assert.ok(hands.left.slots.some((s) => s && s.charms.length === 3 && s.chain.lenCm === 12), 'order remembers the strand');
  assert.equal(`A$${order.total.toFixed(2)}`.replace('.00', ''), totalBefore.replace('.00', ''));
  // 5 cm under the pearl, and a 12 cm strand on each hand.
  assert.ok(order.items.some((i) => i.itemId === 'chain' && i.qty === 29), 'chain billed by the cm');
  assert.ok(order.items.some((i) => i.itemId === 'kada' && i.qty === 2), 'a bangle for each hand');

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

  // The studio is only for the shop's owner and editors, even at #studio.
  assert.equal(await page.isHidden('#mode-studio'), true, 'studio hidden from shoppers');
  await page.evaluate(() => { location.hash = '#studio'; });
  await page.waitForTimeout(50);
  assert.equal(await page.isHidden('#studio'), true, 'a shopper cannot open the studio');

  assert.deepEqual(errors, [], `page errors: ${errors.join('; ')}`);
  await ctx.close();
  console.log(`✓ ${label}`);
}

/** The studio can say what a piece is and where its loop is, and Create uses it. */
async function studio(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(installStore, { seed: CATALOG, role: 'studio', uid: 'u_owner', extra: {
    'people/u_ravi': { name: 'Ravi Other', touched: 't1' },
    'people/u_ravi/orders/o_ravi': { no: 'CJ-1', uid: 'u_ravi', status: 'new', createdAt: '2026-09-01', items: [] },
    'orders/o_old': { no: 'CJ-0', status: 'done', createdAt: '2026-08-01', items: [] },
  } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${PAGE}#studio`);
  await page.waitForSelector('#studio:not([hidden])');
  // The studio sees every customer's orders, old shared ones included.
  await page.waitForFunction(() => S.orders.length === 2);
  // The old PIN, readable by every visitor, is taken out of the shared settings.
  await page.waitForFunction(() => !('pin' in window.__store['meta/settings']));
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
  const saved = await page.evaluate(() => window.__store['catalog/star']);
  assert.ok(saved.loop && Math.abs(saved.loop.x - 50) < 3 && Math.abs(saved.loop.y - 10) < 3, `loop saved: ${JSON.stringify(saved.loop)}`);
  assert.equal(saved.name, 'Star', 'the rest of the component survives the save');

  await page.evaluate(() => openPieceDialog(itemOf('kada')));
  assert.equal(await page.isVisible('#slots-field'), true, 'a bangle offers spots');
  await page.fill('#form-piece input[name=slots]', '5');
  await page.click('#form-piece button[type=submit]');
  await page.waitForSelector('#dlg-piece[open]', { state: 'detached' }).catch(async () => { throw new Error('save failed: ' + await page.textContent('#piece-error')); });
  assert.equal(await page.evaluate(() => window.__store['catalog/kada'].slots), 5);

  // Create picks the new spot count up.
  await page.click('#mode-build');
  await page.waitForSelector('#bd-stage svg');
  assert.equal(await page.$$eval('#bd-stage .slot', (n) => n.length), 5, 'five spots after the studio said so');
  assert.deepEqual(errors, [], `page errors: ${errors.join('; ')}`);
  await ctx.close();
  console.log('✓ studio');
}

/** A bangle with its own loops: the studio marks them, and Create hangs a charm from each. */
async function fixedLoops(browser) {
  const { kada, ...rest } = CATALOG;
  const catalog = { ...rest, loopy: piece('Loop Bangle', 'bangles', 40, [70, 70], 3, { art: 'bangle-loops', colour: 'Gold', order: 1 }) };
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(installStore, { seed: catalog, role: 'studio', uid: 'u_owner' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  // Unmarked, it is spaced along the band like any bangle.
  await page.goto(PAGE);
  await page.waitForSelector('#bd-stage svg');
  assert.equal(await page.$$eval('#bd-stage .slot', (n) => n.length), 7);

  // The studio finds its seven loops, and one is taken away by hand.
  await page.goto(`${PAGE}#studio`);
  await page.evaluate(() => openPieceDialog(itemOf('loopy')));
  await page.waitForSelector('#spots-field:not([hidden])');
  await page.click('#spots-auto');
  await page.waitForFunction(() => S.draft.spotsAt.length === 7);
  await page.locator('#spots-pick [data-spot]').first().scrollIntoViewIfNeeded();
  await page.locator('#spots-pick [data-spot]').first().click();
  assert.equal(await page.evaluate(() => S.draft.spotsAt.length), 6, 'a clicked marker is removed');
  assert.equal(await page.isVisible('#slots-field'), false, 'the spot count comes from the loops');
  await page.click('#form-piece button[type=submit]');
  await page.waitForSelector('#dlg-piece[open]', { state: 'detached' });
  assert.equal(await page.evaluate(() => window.__store['catalog/loopy'].spotsAt.length), 6);

  // Create now offers one spot per marked loop, each ring sitting on its loop.
  await page.click('#mode-build');
  await page.waitForSelector('#bd-stage svg');
  assert.equal(await page.$$eval('#bd-stage .slot', (n) => n.length), 6, 'one spot per loop');
  const off = await page.evaluate(async () => {
    const base = itemOf('loopy');
    const info = await analyseArt(charmArt(base, S.build.baseVariant).src);
    paintBuilder();
    const L = layout();
    return L.slots.map((s, i) => {
      const p = base.spotsAt[i];
      const want = { x: L.baseImg.x + (p.x / 100) * L.baseImg.w, y: L.baseImg.y + (p.y / 100) * L.baseImg.h };
      const near = info.loops.some((q) => Math.abs(q.x - p.x) < 1.5 && Math.abs(q.y - p.y) < 1.5);
      return near ? Math.hypot(s.P.x - want.x, s.P.y - want.y) : 99;
    });
  });
  assert.ok(off.every((d) => d < 1), `spots sit on the loops (mm off: ${off.map((d) => d.toFixed(2)).join(', ')})`);

  // A charm hung there hangs below its loop.
  await page.click('#bd-panel [data-charm="heart"]');
  const below = await page.evaluate(() => {
    const s = layout().slots.find((x) => x.filled);
    return s.charms[0].box.y > s.P.y;
  });
  assert.ok(below, 'the charm hangs below its loop');
  assert.deepEqual(errors, [], `page errors: ${errors.join('; ')}`);
  await ctx.close();
  console.log('✓ fixed loops');
}

(async () => {
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch({ executablePath: chromePath() });
  try {
    await run(browser, 'desktop', { width: 1440, height: 900 });
    await run(browser, 'phone', { width: 390, height: 844 });
    await studio(browser);
    await fixedLoops(browser);
    console.log('UI tests passed');
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
