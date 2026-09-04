'use strict';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const admin = { currency: 'A$', threshold: 10, categories: [], view: 'dashboard' };

const money = (n) => `${admin.currency}${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function toast(message, kind = '') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = message;
  $('#toasts').append(el);
  setTimeout(() => el.remove(), 4200);
}

async function api(url, { body, method = 'GET', form } = {}) {
  const options = { method, credentials: 'same-origin' };
  if (form) options.body = form;
  else if (body !== undefined) {
    options.headers = { 'Content-Type': 'application/json' };
    options.body = JSON.stringify(body);
  }
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) { showLogin(); throw new Error('Please sign in again.'); }
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

const STATUS_LABELS = {
  new: 'New', in_progress: 'In progress', ready: 'Ready', completed: 'Completed', cancelled: 'Cancelled',
};
const STATUS_PILL = {
  new: 'amber', in_progress: 'amber', ready: 'green', completed: 'grey', cancelled: 'red',
};

/* --------------------------------------------------------------- dashboard */

async function viewDashboard() {
  const [summary, pick] = await Promise.all([api('/api/admin/summary'), api('/api/admin/orders/pick-list')]);
  admin.threshold = summary.threshold;
  return `
    <div class="cards">
      <div class="card"><small>Open orders</small><b>${summary.openOrders}</b></div>
      <div class="card"><small>Ready to hand over</small><b>${summary.readyOrders}</b></div>
      <div class="card ${summary.outOfStockCount ? 'alert' : ''}"><small>Out of stock</small><b>${summary.outOfStockCount}</b></div>
      <div class="card ${summary.lowStockCount ? 'warn' : ''}"><small>Low (&lt; ${summary.threshold})</small><b>${summary.lowStockCount}</b></div>
      <div class="card"><small>Order value</small><b>${money(summary.revenue)}</b></div>
    </div>
    <section class="panel">
      <header><h2>What open orders need</h2>
        <span class="muted" style="margin-left:auto;font-size:12px">across all new &amp; in-progress orders</span></header>
      <div class="table-scroll">
        <table>
          <thead><tr><th>Piece</th><th>Category</th><th class="num">Needed</th><th class="num">In repo</th><th></th></tr></thead>
          <tbody>${pick.length ? pick.map((r) => `<tr>
            <td>${esc(r.name)} <span class="muted">${esc(r.sku)}</span></td>
            <td>${esc(r.category)}</td>
            <td class="num">${r.needed}</td>
            <td class="num">${r.in_stock}</td>
            <td class="num">${r.in_stock < r.needed
              ? '<span class="pill red">short</span>' : '<span class="pill green">covered</span>'}</td>
          </tr>`).join('') : '<tr><td colspan="5" class="empty">No open orders.</td></tr>'}</tbody>
        </table>
      </div>
    </section>`;
}

/* -------------------------------------------------------------------- repo */

function elementRow(e) {
  const pill = e.quantity <= 0 ? '<span class="pill red">Out of stock</span>'
    : e.quantity < admin.threshold ? `<span class="pill amber">Low · ${e.quantity}</span>`
      : `<span class="pill green">${e.quantity}</span>`;
  return `<tr data-id="${e.id}">
    <td><img class="thumb" src="${esc(e.image_url || '/img/samples/charm-star.svg')}" alt=""></td>
    <td><b>${esc(e.name)}</b><br><span class="muted">${esc(e.sku)}</span>${
      e.active ? '' : ' <span class="pill grey">hidden</span>'}</td>
    <td>${esc(e.category_name)}</td>
    <td class="num">${money(e.price)}</td>
    <td class="num">${pill}</td>
    <td>
      <div class="row-actions">
        <input class="qty-input small" type="number" value="10" step="1" aria-label="Restock amount">
        <button class="small" data-act="restock">Add stock</button>
        <button class="small" data-act="edit">Edit</button>
        <button class="small danger" data-act="delete">Delete</button>
      </div>
    </td>
  </tr>`;
}

async function viewRepo() {
  const [elements, categories] = await Promise.all([api('/api/admin/elements'), api('/api/admin/categories')]);
  admin.categories = categories;
  return `
    <section class="panel">
      <header><h2>Repo — everything I can build with</h2>
        <div class="toolbar">
          <input id="repo-search" placeholder="Search name or SKU" style="width:220px">
          <button class="primary" id="btn-add-element">+ Add piece</button>
        </div>
      </header>
      <div class="table-scroll">
        <table class="repo-table">
          <thead><tr><th></th><th>Piece</th><th>Category</th><th class="num">Price</th><th class="num">In repo</th><th></th></tr></thead>
          <tbody>${elements.length ? elements.map(elementRow).join('')
            : '<tr><td colspan="6" class="empty">Repo is empty — add your first piece.</td></tr>'}</tbody>
        </table>
      </div>
    </section>
    <section class="panel">
      <header><h2>Categories</h2>
        <div class="toolbar">
          <input id="cat-name" placeholder="New category name" style="width:200px">
          <select id="cat-kind" style="width:auto">
            <option value="attachment">Attachment (charm, bangle, chain…)</option>
            <option value="base">Base piece (bracelet, pendant, kaleera…)</option>
          </select>
          <button id="btn-add-category">Add</button>
        </div>
      </header>
      <div class="body">
        ${categories.map((c) => `<span class="pill ${c.kind === 'base' ? 'green' : 'grey'}"
          style="margin:0 6px 6px 0">${esc(c.name)}
          <button class="small" data-cat="${c.id}" style="border:none;background:none;padding:0 0 0 6px">×</button>
        </span>`).join('')}
      </div>
    </section>`;
}

function bindRepo() {
  $('#btn-add-element')?.addEventListener('click', () => openElementDialog());

  $('#repo-search')?.addEventListener('input', (ev) => {
    const q = ev.target.value.toLowerCase();
    $$('.repo-table tbody tr').forEach((tr) => {
      tr.hidden = q && !tr.textContent.toLowerCase().includes(q);
    });
  });

  $$('.repo-table').forEach((table) => table.addEventListener('click', async (ev) => {
    const btn = ev.target.closest('button[data-act]');
    if (!btn) return;
    const tr = btn.closest('tr');
    const id = tr.dataset.id;
    try {
      if (btn.dataset.act === 'edit') {
        const elements = await api('/api/admin/elements');
        openElementDialog(elements.find((e) => String(e.id) === id));
      } else if (btn.dataset.act === 'restock') {
        const delta = parseInt($('.qty-input', tr).value, 10);
        await api(`/api/admin/elements/${id}/restock`, { method: 'POST', body: { delta } });
        toast('Stock updated.', 'ok');
        render();
      } else if (btn.dataset.act === 'delete') {
        if (!confirm('Remove this piece from the repo?')) return;
        const res = await api(`/api/admin/elements/${id}`, { method: 'DELETE' });
        toast(res.retired ? 'Piece hidden (kept for order history).' : 'Piece deleted.', 'ok');
        render();
      }
    } catch (err) { toast(err.message, 'error'); }
  }));

  $('#btn-add-category')?.addEventListener('click', async () => {
    try {
      await api('/api/admin/categories', {
        method: 'POST',
        body: { name: $('#cat-name').value, kind: $('#cat-kind').value, sortOrder: admin.categories.length + 1 },
      });
      toast('Category added.', 'ok');
      render();
    } catch (err) { toast(err.message, 'error'); }
  });

  $$('button[data-cat]').forEach((b) => b.addEventListener('click', async () => {
    try {
      await api(`/api/admin/categories/${b.dataset.cat}`, { method: 'DELETE' });
      render();
    } catch (err) { toast(err.message, 'error'); }
  }));
}

function openElementDialog(element) {
  const form = $('#element-form');
  form.reset();
  $('#element-error').hidden = true;
  $('#element-dialog-title').textContent = element ? `Edit ${element.name}` : 'Add a piece';
  $('#element-category').innerHTML = admin.categories
    .map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');

  if (element) {
    form.id.value = element.id;
    form.name.value = element.name;
    form.sku.value = element.sku;
    form.categoryId.value = element.category_id;
    form.price.value = element.price;
    form.quantity.value = element.quantity;
    form.defaultWidth.value = element.default_width;
    form.description.value = element.description || '';
    form.imageUrl.value = element.image_url || '';
    form.active.checked = Boolean(element.active);
  } else {
    form.id.value = '';
  }
  $('#element-dialog').showModal();
}

function bindElementDialog() {
  $('#element-cancel').onclick = () => $('#element-dialog').close();
  $('#element-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const form = ev.target;
    const data = new FormData(form);
    const id = data.get('id');
    data.delete('id');
    data.set('active', form.active.checked ? 'true' : 'false');
    if (!data.get('image')?.size) data.delete('image');
    try {
      await api(id ? `/api/admin/elements/${id}` : '/api/admin/elements',
        { method: id ? 'PUT' : 'POST', form: data });
      $('#element-dialog').close();
      toast('Saved.', 'ok');
      render();
    } catch (err) {
      $('#element-error').hidden = false;
      $('#element-error').textContent = err.message;
    }
  });
}

/* ------------------------------------------------------------ stock alerts */

function stockTable(rows, emptyText) {
  return `<div class="table-scroll"><table class="repo-table">
    <thead><tr><th></th><th>Piece</th><th>Category</th><th class="num">Price</th><th class="num">In repo</th><th></th></tr></thead>
    <tbody>${rows.length ? rows.map(elementRow).join('') : `<tr><td colspan="6" class="empty">${emptyText}</td></tr>`}</tbody>
  </table></div>`;
}

async function viewStock() {
  const report = await api('/api/admin/stock');
  admin.threshold = report.threshold;
  return `<div class="stack">
    <section class="panel">
      <header><h2>Out of stock</h2><span class="pill red" style="margin-left:auto">${report.outOfStock.length}</span></header>
      ${stockTable(report.outOfStock, 'Nothing is out of stock.')}
    </section>
    <section class="panel">
      <header><h2>Low quantity — fewer than ${report.threshold}</h2>
        <span class="pill amber" style="margin-left:auto">${report.lowStock.length}</span></header>
      ${stockTable(report.lowStock, 'Nothing is running low.')}
    </section>
    <section class="panel">
      <header><h2>Healthy stock</h2><span class="pill green" style="margin-left:auto">${report.healthy.length}</span></header>
      ${stockTable(report.healthy, 'Nothing here yet.')}
    </section>
  </div>`;
}

/* ------------------------------------------------------------------ orders */

async function viewOrders() {
  const orders = await api('/api/admin/orders');
  return `<section class="panel">
    <header><h2>Orders</h2>
      <div class="toolbar">
        <select id="order-filter" style="width:auto">
          <option value="">All statuses</option>
          ${Object.entries(STATUS_LABELS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}
        </select>
      </div>
    </header>
    <div class="table-scroll"><table id="orders-table">
      <thead><tr><th>Order</th><th>Customer</th><th>Fulfilment</th><th>Pieces needed</th>
        <th class="num">Total</th><th>Status</th><th></th></tr></thead>
      <tbody>${orders.length ? orders.map(orderRow).join('')
        : '<tr><td colspan="7" class="empty">No orders yet.</td></tr>'}</tbody>
    </table></div>
  </section>`;
}

function orderRow(o) {
  return `<tr data-id="${o.id}" data-status="${o.status}">
    <td><b>${esc(o.order_number)}</b><br><span class="muted">${esc(o.created_at)}</span></td>
    <td>${esc(o.customer_name)}<br><span class="muted">${esc(o.customer_phone)}</span></td>
    <td>${o.fulfilment === 'ship'
      ? `Ship — ${esc(o.shipping_area || '')}<br><span class="muted">${money(o.shipping_cost)}</span>`
      : 'Collect in studio'}</td>
    <td>${o.items.map((i) => `${esc(i.name)} × ${i.quantity}`).join('<br>')}</td>
    <td class="num"><b>${money(o.total)}</b></td>
    <td><span class="pill ${STATUS_PILL[o.status]}">${STATUS_LABELS[o.status]}</span></td>
    <td><div class="row-actions">
      <select data-act="status" style="width:auto">
        ${Object.entries(STATUS_LABELS).map(([k, v]) =>
          `<option value="${k}" ${k === o.status ? 'selected' : ''}>${v}</option>`).join('')}
      </select>
      <button class="small" data-act="view">Details</button>
    </div></td>
  </tr>`;
}

function bindOrders() {
  $('#order-filter')?.addEventListener('change', (ev) => {
    $$('#orders-table tbody tr').forEach((tr) => {
      tr.hidden = ev.target.value && tr.dataset.status !== ev.target.value;
    });
  });

  $('#orders-table')?.addEventListener('change', async (ev) => {
    const select = ev.target.closest('select[data-act="status"]');
    if (!select) return;
    const id = select.closest('tr').dataset.id;
    try {
      await api(`/api/admin/orders/${id}/status`, { method: 'PUT', body: { status: select.value } });
      toast('Order updated.', 'ok');
      render();
    } catch (err) { toast(err.message, 'error'); render(); }
  });

  $('#orders-table')?.addEventListener('click', async (ev) => {
    if (!ev.target.closest('button[data-act="view"]')) return;
    const id = ev.target.closest('tr').dataset.id;
    try { showOrderDialog(await api(`/api/admin/orders/${id}`)); }
    catch (err) { toast(err.message, 'error'); }
  });
}

function showOrderDialog(order) {
  $('#order-dialog-title').textContent = `Order ${order.order_number}`;
  $('#order-dialog-body').innerHTML = `
    <p><b>${esc(order.customer_name)}</b> · ${esc(order.customer_phone)}
      ${order.customer_email ? `· ${esc(order.customer_email)}` : ''}</p>
    <p>${order.fulfilment === 'ship'
      ? `<b>Ship to ${esc(order.shipping_area)}</b><br>${esc(order.shipping_address || '').replace(/\n/g, '<br>')}`
      : '<b>Collect from studio when ready</b>'}</p>
    ${order.notes ? `<p><b>Notes:</b> ${esc(order.notes)}</p>` : ''}
    <h3 style="font-size:14px;margin-top:14px">Pieces to pull from the repo</h3>
    <table><thead><tr><th>Piece</th><th>SKU</th><th class="num">Qty</th><th class="num">Line</th></tr></thead>
      <tbody>${order.items.map((i) => `<tr><td>${esc(i.name)}</td><td>${esc(i.sku)}</td>
        <td class="num">${i.quantity}</td><td class="num">${money(i.line_total)}</td></tr>`).join('')}</tbody></table>
    <div class="totals">
      <div><span>Items</span><span>${money(order.items_total)}</span></div>
      <div><span>Shipping</span><span>${money(order.shipping_cost)}</span></div>
      <div class="grand"><span>Total</span><span>${money(order.total)}</span></div>
    </div>`;
  $('#order-dialog').showModal();
}

/* ---------------------------------------------------------------- shipping */

async function viewShipping() {
  const zones = await api('/api/admin/shipping-zones');
  return `<section class="panel">
    <header><h2>Delivery areas &amp; charges</h2>
      <div class="toolbar">
        <input id="zone-area" placeholder="Area name" style="width:180px">
        <input id="zone-cost" type="number" min="0" step="0.01" placeholder="Cost" style="width:110px">
        <input id="zone-eta" placeholder="ETA days" style="width:100px">
        <button class="primary" id="btn-add-zone">Add area</button>
      </div>
    </header>
    <div class="table-scroll"><table id="zones-table">
      <thead><tr><th>Area</th><th class="num">Shipping cost</th><th>ETA (days)</th><th>Visible</th><th></th></tr></thead>
      <tbody>${zones.length ? zones.map((z) => `<tr data-id="${z.id}">
        <td><input value="${esc(z.area)}" data-f="area"></td>
        <td class="num"><input type="number" min="0" step="0.01" value="${z.cost}" data-f="cost" style="width:110px"></td>
        <td><input value="${esc(z.eta_days || '')}" data-f="etaDays" style="width:100px"></td>
        <td><input type="checkbox" data-f="active" ${z.active ? 'checked' : ''} style="width:auto"></td>
        <td><div class="row-actions">
          <button class="small" data-act="save">Save</button>
          <button class="small danger" data-act="delete">Delete</button>
        </div></td>
      </tr>`).join('') : '<tr><td colspan="5" class="empty">No delivery areas yet — customers can only collect.</td></tr>'}</tbody>
    </table></div>
  </section>`;
}

function bindShipping() {
  $('#btn-add-zone')?.addEventListener('click', async () => {
    try {
      await api('/api/admin/shipping-zones', {
        method: 'POST',
        body: { area: $('#zone-area').value, cost: $('#zone-cost').value || 0, etaDays: $('#zone-eta').value },
      });
      toast('Area added.', 'ok');
      render();
    } catch (err) { toast(err.message, 'error'); }
  });

  $('#zones-table')?.addEventListener('click', async (ev) => {
    const btn = ev.target.closest('button[data-act]');
    if (!btn) return;
    const tr = btn.closest('tr');
    try {
      if (btn.dataset.act === 'delete') {
        if (!confirm('Delete this delivery area?')) return;
        await api(`/api/admin/shipping-zones/${tr.dataset.id}`, { method: 'DELETE' });
      } else {
        await api(`/api/admin/shipping-zones/${tr.dataset.id}`, {
          method: 'PUT',
          body: {
            area: $('[data-f=area]', tr).value,
            cost: $('[data-f=cost]', tr).value,
            etaDays: $('[data-f=etaDays]', tr).value,
            active: $('[data-f=active]', tr).checked,
          },
        });
      }
      toast('Saved.', 'ok');
      render();
    } catch (err) { toast(err.message, 'error'); }
  });
}

/* ---------------------------------------------------------------- settings */

async function viewSettings() {
  const settings = await api('/api/admin/settings');
  return `<div class="stack">
    <section class="panel">
      <header><h2>Shop settings</h2></header>
      <div class="body">
        <div class="grid-2">
          <label class="field"><span>Business name</span><input id="set-name" value="${esc(settings.businessName)}"></label>
          <label class="field"><span>Currency symbol</span><input id="set-currency" value="${esc(settings.currency)}"></label>
          <label class="field"><span>Low-stock threshold</span>
            <input id="set-threshold" type="number" min="1" step="1" value="${settings.lowStockThreshold}"></label>
        </div>
        <button class="primary" id="btn-save-settings">Save settings</button>
      </div>
    </section>
    <section class="panel">
      <header><h2>Change admin password</h2></header>
      <div class="body">
        <div class="grid-2">
          <label class="field"><span>Current password</span><input id="pw-current" type="password"></label>
          <label class="field"><span>New password (min 6 characters)</span><input id="pw-next" type="password"></label>
        </div>
        <button class="primary" id="btn-save-password">Change password</button>
      </div>
    </section>
  </div>`;
}

function bindSettings() {
  $('#btn-save-settings')?.addEventListener('click', async () => {
    try {
      await api('/api/admin/settings', {
        method: 'PUT',
        body: {
          businessName: $('#set-name').value,
          currency: $('#set-currency').value,
          lowStockThreshold: $('#set-threshold').value,
        },
      });
      toast('Settings saved.', 'ok');
      await loadSettings();
      render();
    } catch (err) { toast(err.message, 'error'); }
  });

  $('#btn-save-password')?.addEventListener('click', async () => {
    try {
      await api('/api/admin/password', {
        method: 'POST', body: { current: $('#pw-current').value, next: $('#pw-next').value },
      });
      toast('Password changed — please sign in again.', 'ok');
      showLogin();
    } catch (err) { toast(err.message, 'error'); }
  });
}

/* -------------------------------------------------------------------- shell */

const VIEWS = {
  dashboard: viewDashboard, repo: viewRepo, stock: viewStock,
  orders: viewOrders, shipping: viewShipping, settings: viewSettings,
};

async function render() {
  $$('#nav .tab').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.view === admin.view)));
  try {
    $('#view').innerHTML = await VIEWS[admin.view]();
  } catch (err) {
    $('#view').innerHTML = `<p class="pill red">${esc(err.message)}</p>`;
    return;
  }
  bindRepo(); bindOrders(); bindShipping(); bindSettings();
  refreshBadges();
}

async function refreshBadges() {
  try {
    const summary = await api('/api/admin/summary');
    admin.threshold = summary.threshold;
    const stockBadge = $('#nav-stock-badge');
    const alerts = summary.outOfStockCount + summary.lowStockCount;
    stockBadge.hidden = !alerts;
    stockBadge.textContent = alerts;
    const orderBadge = $('#nav-orders-badge');
    orderBadge.hidden = !summary.openOrders;
    orderBadge.textContent = summary.openOrders;
  } catch { /* badge refresh is best-effort */ }
}

async function loadSettings() {
  const settings = await api('/api/admin/settings');
  admin.currency = settings.currency;
  admin.threshold = settings.lowStockThreshold;
}

function showLogin() {
  $('#app').hidden = true;
  $('#login-screen').hidden = false;
}

async function showApp() {
  $('#login-screen').hidden = true;
  $('#app').hidden = false;
  await loadSettings();
  await render();
}

async function boot() {
  $$('#nav .tab').forEach((b) => b.addEventListener('click', () => { admin.view = b.dataset.view; render(); }));
  $('#btn-logout').onclick = async () => { await api('/api/admin/logout', { method: 'POST' }); showLogin(); };
  $('#order-dialog-close').onclick = () => $('#order-dialog').close();
  bindElementDialog();

  $('#login-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const error = $('#login-error');
    error.hidden = true;
    try {
      await api('/api/admin/login', { method: 'POST', body: { password: ev.target.password.value } });
      ev.target.reset();
      await showApp();
    } catch (err) {
      error.hidden = false;
      error.textContent = err.message;
    }
  });

  const { signedIn } = await fetch('/api/admin/session').then((r) => r.json());
  if (signedIn) await showApp(); else showLogin();
}

boot();
