'use strict';

/* ------------------------------------------------------------------ helpers */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const state = {
  currency: '₹',
  categories: [],
  elements: [],
  byId: new Map(),
  zones: [],
  activeCategory: null,
  baseElementId: null,
  placements: [],   // { uid, elementId, x, y, w, rot, z }  — x/y/w are % of stage
  selected: null,
  zCounter: 1,
};

const money = (n) => `${state.currency}${Number(n || 0).toLocaleString(undefined, {
  minimumFractionDigits: Number.isInteger(Number(n)) ? 0 : 2, maximumFractionDigits: 2 })}`;

function toast(message, kind = '') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = message;
  $('#toasts').append(el);
  setTimeout(() => el.remove(), 4200);
}

async function api(url, options) {
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...options });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body.error || 'Request failed'), { details: body.details });
  return body;
}

/* --------------------------------------------------------- stock accounting */

/** How many of a piece the current design already consumes. */
function usedCount(elementId) {
  let n = state.placements.filter((p) => p.elementId === elementId).length;
  if (state.baseElementId === elementId) n += 1;
  return n;
}

function availableCount(elementId) {
  const el = state.byId.get(elementId);
  return el ? Math.max(0, el.quantity - usedCount(elementId)) : 0;
}

/** Gate every add on live repo stock; returns false and explains when blocked. */
function canAdd(element) {
  if (element.quantity <= 0) {
    toast(`${element.name} is out of stock right now.`, 'error');
    return false;
  }
  if (usedCount(element.id) >= element.quantity) {
    toast(`Only ${element.quantity} of ${element.name} ${element.quantity === 1 ? 'is' : 'are'} available.`, 'error');
    return false;
  }
  return true;
}

/* ----------------------------------------------------------------- palette */

function renderTabs() {
  const tabs = $('#tabs');
  tabs.innerHTML = '';
  for (const cat of state.categories) {
    const b = document.createElement('button');
    b.className = 'tab';
    b.textContent = cat.name;
    b.setAttribute('aria-selected', String(cat.slug === state.activeCategory));
    b.onclick = () => { state.activeCategory = cat.slug; renderTabs(); renderPalette(); };
    tabs.append(b);
  }
}

function renderPalette() {
  const wrap = $('#palette');
  wrap.innerHTML = '';
  const items = state.elements.filter((e) => e.category === state.activeCategory);
  if (!items.length) {
    wrap.innerHTML = '<p class="empty">Nothing in this section yet.</p>';
    return;
  }
  for (const el of items) {
    const isBase = el.categoryKind === 'base';
    const used = usedCount(el.id);
    const left = availableCount(el.id);
    const chip = document.createElement('div');
    chip.className = 'chip' + (isBase ? ' is-base' : '')
      + (isBase && state.baseElementId === el.id ? ' selected' : '')
      + (left <= 0 ? ' depleted' : '');
    chip.draggable = left > 0;
    chip.dataset.elementId = el.id;
    chip.title = el.description || el.name;
    chip.innerHTML = `
      <img src="${el.imageUrl || '/img/samples/charm-star.svg'}" alt="">
      <div>
        <div class="nm">${escapeHtml(el.name)}</div>
        <div class="pr">${money(el.price)}</div>
        <div class="st">${el.quantity <= 0 ? 'Out of stock' : `${left} of ${el.quantity} left`}</div>
      </div>
      ${used ? `<span class="badge-used">${used}</span>` : ''}`;

    chip.addEventListener('dragstart', (ev) => {
      if (left <= 0) return ev.preventDefault();
      ev.dataTransfer.setData('text/plain', String(el.id));
      ev.dataTransfer.effectAllowed = 'copy';
    });
    // Tap-to-add keeps the designer usable on touch devices, where HTML5 drag
    // and drop is not available.
    chip.addEventListener('click', () => (isBase ? chooseBase(el) : addPlacement(el, 50, 50)));

    wrap.append(chip);
  }
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ------------------------------------------------------------------ canvas */

function chooseBase(el) {
  if (state.baseElementId === el.id) return;
  const previous = state.baseElementId;
  state.baseElementId = null;
  if (!canAdd(el)) { state.baseElementId = previous; return; }
  state.baseElementId = el.id;
  renderAll();
}

/**
 * Nudge a new charm off any charm already sitting on that spot, so charms added
 * by tapping the repo (rather than dropped at a point) fan out instead of
 * hiding behind each other.
 */
function spreadFromCollisions(x, y) {
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const clash = state.placements.some((p) => Math.hypot(p.x - x, p.y - y) < 6);
    if (!clash) break;
    const angle = attempt * 0.9;
    const radius = 9 + attempt * 1.4;
    x = clamp(x + Math.cos(angle) * radius, 6, 94);
    y = clamp(y + Math.sin(angle) * radius, 6, 94);
  }
  return { x, y };
}

function addPlacement(el, xPct, yPct) {
  if (!state.baseElementId) { toast('Choose a base piece first.', 'error'); return; }
  if (el.categoryKind === 'base') { chooseBase(el); return; }
  if (!canAdd(el)) return;
  const stage = $('#stage');
  const wPct = ((el.defaultWidth || 90) / stage.clientWidth) * 100;
  const spot = spreadFromCollisions(clamp(xPct, 3, 97), clamp(yPct, 3, 97));
  state.placements.push({
    uid: `p${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
    elementId: el.id,
    x: spot.x, y: spot.y,
    w: clamp(wPct, 3, 60), rot: 0, z: ++state.zCounter,
  });
  state.selected = state.placements.at(-1).uid;
  renderAll();
}

function removePlacement(uid) {
  state.placements = state.placements.filter((p) => p.uid !== uid);
  if (state.selected === uid) state.selected = null;
  renderAll();
}

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

function renderStage() {
  const stage = $('#stage');
  $$('.placement, .stage-base', stage).forEach((n) => n.remove());

  const base = state.byId.get(state.baseElementId);
  $('#stage-empty').hidden = Boolean(base);
  if (base) {
    const img = document.createElement('img');
    img.className = 'stage-base';
    img.src = base.imageUrl;
    img.alt = base.name;
    stage.append(img);
  }

  for (const p of state.placements) {
    const el = state.byId.get(p.elementId);
    if (!el) continue;
    const node = document.createElement('div');
    node.className = 'placement' + (state.selected === p.uid ? ' selected' : '');
    node.dataset.uid = p.uid;
    node.style.left = `${p.x}%`;
    node.style.top = `${p.y}%`;
    node.style.width = `${p.w}%`;
    node.style.aspectRatio = '1';
    node.style.zIndex = String(p.z);
    node.style.transform = `translate(-50%, -50%) rotate(${p.rot}deg)`;
    node.innerHTML = `<img src="${el.imageUrl}" alt="${escapeHtml(el.name)}">
                      <button class="remove" title="Remove" aria-label="Remove ${escapeHtml(el.name)}">×</button>`;
    node.querySelector('.remove').addEventListener('pointerdown', (ev) => {
      ev.stopPropagation();
      removePlacement(p.uid);
    });
    node.addEventListener('pointerdown', (ev) => startDrag(ev, p, node));
    stage.append(node);
  }
}

/** Pointer-based move so the same code path works for mouse, pen and touch. */
function startDrag(ev, placement, node) {
  ev.preventDefault();
  state.selected = placement.uid;
  placement.z = ++state.zCounter;
  node.style.zIndex = String(placement.z);
  $$('.placement').forEach((n) => n.classList.toggle('selected', n.dataset.uid === placement.uid));

  const stage = $('#stage');
  const rect = stage.getBoundingClientRect();
  const startX = ev.clientX;
  const startY = ev.clientY;
  const originX = placement.x;
  const originY = placement.y;
  let moved = false;

  const onMove = (e) => {
    moved = true;
    placement.x = clamp(originX + ((e.clientX - startX) / rect.width) * 100, 2, 98);
    placement.y = clamp(originY + ((e.clientY - startY) / rect.height) * 100, 2, 98);
    node.style.left = `${placement.x}%`;
    node.style.top = `${placement.y}%`;
  };
  const onUp = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    if (!moved) renderStage();
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
}

function setupStageDrop() {
  const stage = $('#stage');
  stage.addEventListener('dragover', (ev) => {
    ev.preventDefault();
    ev.dataTransfer.dropEffect = 'copy';
    stage.classList.add('dragover');
  });
  stage.addEventListener('dragleave', () => stage.classList.remove('dragover'));
  stage.addEventListener('drop', (ev) => {
    ev.preventDefault();
    stage.classList.remove('dragover');
    const el = state.byId.get(Number(ev.dataTransfer.getData('text/plain')));
    if (!el) return;
    const rect = stage.getBoundingClientRect();
    addPlacement(el, ((ev.clientX - rect.left) / rect.width) * 100,
      ((ev.clientY - rect.top) / rect.height) * 100);
  });
  stage.addEventListener('pointerdown', (ev) => {
    if (ev.target === stage || ev.target.classList.contains('stage-base')) {
      state.selected = null;
      renderStage();
    }
  });
}

function setupTools() {
  $$('.stage-tools button').forEach((btn) => btn.addEventListener('click', () => {
    const p = state.placements.find((x) => x.uid === state.selected);
    if (!p) return toast('Select a charm on the piece first.');
    switch (btn.dataset.tool) {
      case 'bigger': p.w = clamp(p.w * 1.15, 3, 60); break;
      case 'smaller': p.w = clamp(p.w / 1.15, 3, 60); break;
      case 'rotate-left': p.rot -= 15; break;
      case 'rotate-right': p.rot += 15; break;
      case 'front': p.z = ++state.zCounter; break;
      case 'delete': return removePlacement(p.uid);
    }
    renderStage();
  }));

  document.addEventListener('keydown', (ev) => {
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(ev.target.tagName)) return;
    if ((ev.key === 'Delete' || ev.key === 'Backspace') && state.selected) {
      ev.preventDefault();
      removePlacement(state.selected);
    }
  });
}

/* ------------------------------------------------------- cost calculations */

/** Aggregate the canvas into priced lines — the same shape the server returns. */
function computeLines() {
  const counts = new Map();
  if (state.baseElementId) counts.set(state.baseElementId, 1);
  for (const p of state.placements) counts.set(p.elementId, (counts.get(p.elementId) || 0) + 1);

  const lines = [];
  for (const [id, qty] of counts) {
    const el = state.byId.get(id);
    if (!el) continue;
    lines.push({ id, name: el.name, unitPrice: el.price, quantity: qty, lineTotal: el.price * qty });
  }
  return lines.sort((a, b) => b.lineTotal - a.lineTotal);
}

function currentShippingCost() {
  const shipping = $('#checkout').open && $('input[name=fulfilment]:checked')?.value === 'ship';
  if (!shipping) return 0;
  const zone = state.zones.find((z) => z.area === $('#shipping-area').value);
  return zone ? zone.cost : 0;
}

function renderCost() {
  const lines = computeLines();
  const itemsTotal = lines.reduce((s, l) => s + l.lineTotal, 0);
  const shipping = currentShippingCost();
  const pieces = lines.reduce((s, l) => s + l.quantity, 0);

  $('#cb-count').textContent = pieces;
  $('#cb-items').textContent = money(itemsTotal);
  $('#cb-ship').textContent = shipping ? money(shipping) : '—';
  $('#cb-total').textContent = money(itemsTotal + shipping);

  const ul = $('#lines');
  ul.innerHTML = lines.length
    ? lines.map((l) => `<li>
        <span>${escapeHtml(l.name)}</span>
        <span class="qty">× ${l.quantity}</span>
        <span class="amt">${money(l.lineTotal)}</span>
      </li>`).join('')
    : '<li class="empty">Nothing added yet.</li>';

  $('#totals').innerHTML = `
    <div><span>Items</span><span>${money(itemsTotal)}</span></div>
    <div><span>Shipping</span><span>${shipping ? money(shipping) : 'Chosen at checkout'}</span></div>
    <div class="grand"><span>Total</span><span>${money(itemsTotal + shipping)}</span></div>`;

  const ready = Boolean(state.baseElementId);
  $('#btn-checkout').disabled = !ready;
  $('#btn-checkout-2').disabled = !ready;
  return { lines, itemsTotal, shipping };
}

function renderAll() {
  renderPalette();
  renderStage();
  renderCost();
}

/* ---------------------------------------------------------------- checkout */

function designPayload() {
  return {
    baseElementId: state.baseElementId,
    placements: state.placements.map(({ elementId, x, y, w, rot, z }) => ({ elementId, x, y, w, rot, z })),
  };
}

function openCheckout() {
  const { lines, itemsTotal } = renderCost();
  $('#checkout-summary').innerHTML = `
    <ul class="lines">${lines.map((l) => `<li><span>${escapeHtml(l.name)}</span>
      <span class="qty">× ${l.quantity}</span><span class="amt">${money(l.lineTotal)}</span></li>`).join('')}</ul>
    <div class="totals" id="ck-totals"></div>`;
  updateCheckoutTotals(itemsTotal);
  $('#checkout-error').hidden = true;
  $('#checkout').showModal();
}

function updateCheckoutTotals(itemsTotal = computeLines().reduce((s, l) => s + l.lineTotal, 0)) {
  const shipping = currentShippingCost();
  const node = $('#ck-totals');
  if (!node) return;
  node.innerHTML = `
    <div><span>Items</span><span>${money(itemsTotal)}</span></div>
    <div><span>Shipping</span><span>${shipping ? money(shipping) : 'Free (collect in studio)'}</span></div>
    <div class="grand"><span>Total payable</span><span>${money(itemsTotal + shipping)}</span></div>`;
  renderCost();
}

function setupCheckout() {
  const dialog = $('#checkout');
  $('#btn-checkout').onclick = openCheckout;
  $('#btn-checkout-2').onclick = openCheckout;
  $('#checkout-cancel').onclick = () => dialog.close();

  $$('input[name=fulfilment]').forEach((input) => input.addEventListener('change', () => {
    const ship = input.value === 'ship' && input.checked;
    $('#ship-fields').hidden = !ship;
    $('#rc-ship').classList.toggle('on', ship);
    $('#rc-pickup').classList.toggle('on', !ship);
    $('textarea[name=shippingAddress]').required = ship;
    updateCheckoutTotals();
  }));
  $('#shipping-area').addEventListener('change', () => updateCheckoutTotals());

  $('#checkout-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const form = new FormData(ev.target);
    const submit = $('#checkout-submit');
    const errorBox = $('#checkout-error');
    submit.disabled = true;
    errorBox.hidden = true;
    try {
      const order = await api('/api/orders', {
        method: 'POST',
        body: JSON.stringify({
          customerName: form.get('customerName'),
          customerPhone: form.get('customerPhone'),
          customerEmail: form.get('customerEmail'),
          fulfilment: form.get('fulfilment'),
          shippingArea: form.get('shippingArea'),
          shippingAddress: form.get('shippingAddress'),
          notes: form.get('notes'),
          design: designPayload(),
        }),
      });
      dialog.close();
      showConfirmation(order, form.get('fulfilment'));
      await loadCatalog();       // stock has moved — refresh the repo view
      resetDesign();
    } catch (err) {
      errorBox.hidden = false;
      errorBox.textContent = [err.message, ...(err.details || []).map((d) => d.error)].join(' ');
      await loadCatalog();
      renderAll();
    } finally {
      submit.disabled = false;
    }
  });
}

function showConfirmation(order, fulfilment) {
  $('#confirmation-body').innerHTML = `
    <p>Thank you! Your order <b>${escapeHtml(order.orderNumber)}</b> is confirmed.</p>
    <div class="totals">
      <div><span>Items</span><span>${money(order.itemsTotal)}</span></div>
      <div><span>Shipping${order.shippingArea ? ` — ${escapeHtml(order.shippingArea)}` : ''}</span>
           <span>${order.shippingCost ? money(order.shippingCost) : 'Free'}</span></div>
      <div class="grand"><span>Total</span><span>${money(order.total)}</span></div>
    </div>
    <p class="muted" style="margin-top:12px">${fulfilment === 'ship'
      ? 'We will ship it to your address as soon as it is ready and message you the tracking details.'
      : 'We will message you as soon as it is ready to collect from the studio.'}</p>`;
  $('#confirmation').showModal();
}

function resetDesign() {
  state.placements = [];
  state.baseElementId = null;
  state.selected = null;
  renderAll();
}

/* -------------------------------------------------------------------- boot */

async function loadCatalog() {
  const data = await api('/api/catalog');
  state.currency = data.currency;
  state.categories = data.categories;
  state.elements = data.elements;
  state.byId = new Map(data.elements.map((e) => [e.id, e]));
  state.zones = data.shippingZones;

  if (!state.activeCategory && state.categories.length) state.activeCategory = state.categories[0].slug;

  // Drop anything the admin retired or that sold out while the tab was open.
  const before = state.placements.length;
  state.placements = state.placements.filter((p) => state.byId.has(p.elementId));
  if (state.placements.length !== before) toast('Some pieces are no longer available and were removed.', 'error');
  if (state.baseElementId && !state.byId.has(state.baseElementId)) state.baseElementId = null;

  $('#shipping-area').innerHTML = state.zones.length
    ? state.zones.map((z) => `<option value="${escapeHtml(z.area)}">${escapeHtml(z.area)} — ${money(z.cost)}${
        z.etaDays ? ` (${escapeHtml(z.etaDays)} days)` : ''}</option>`).join('')
    : '<option value="">No delivery areas configured</option>';
}

async function boot() {
  try {
    const config = await api('/api/config');
    document.title = `Design your piece · ${config.businessName}`;
    $('#brand').textContent = config.businessName;
    await loadCatalog();
    renderTabs();
    renderAll();
  } catch (err) {
    toast(`Could not load the repo: ${err.message}`, 'error');
  }
  setupStageDrop();
  setupTools();
  setupCheckout();
  $('#btn-clear').onclick = resetDesign;
  $('#confirmation-close').onclick = () => $('#confirmation').close();
  window.addEventListener('resize', () => renderStage());
}

boot();
