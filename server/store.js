'use strict';

const { db, getSetting } = require('./db');

const ORDER_STATUSES = ['new', 'in_progress', 'ready', 'completed', 'cancelled'];

function lowStockThreshold() {
  return Number(getSetting('low_stock_threshold', '10'));
}

function currency() {
  return getSetting('currency', '₹');
}

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

/* ------------------------------------------------------------------ catalog */

function listCategories() {
  return db.prepare('SELECT * FROM categories ORDER BY sort_order, name').all();
}

const ELEMENT_SELECT = `
  SELECT e.*, c.slug AS category_slug, c.name AS category_name, c.kind AS category_kind
  FROM elements e JOIN categories c ON c.id = e.category_id`;

function listElements({ activeOnly = false, inStockOnly = false } = {}) {
  const where = [];
  if (activeOnly) where.push('e.active = 1');
  if (inStockOnly) where.push('e.quantity > 0');
  const sql = `${ELEMENT_SELECT}${where.length ? ' WHERE ' + where.join(' AND ') : ''}
               ORDER BY c.sort_order, c.name, e.name`;
  return db.prepare(sql).all();
}

function getElement(id) {
  return db.prepare(`${ELEMENT_SELECT} WHERE e.id = ?`).get(id);
}

/* ------------------------------------------------------------------ shipping */

function listZones({ activeOnly = false } = {}) {
  const sql = `SELECT * FROM shipping_zones${activeOnly ? ' WHERE active = 1' : ''} ORDER BY area`;
  return db.prepare(sql).all();
}

function getZoneByArea(area) {
  return db.prepare('SELECT * FROM shipping_zones WHERE area = ? AND active = 1').get(area);
}

/* --------------------------------------------------------------- inventory */

function adjustStock(elementId, delta, reason, orderId = null) {
  db.prepare('UPDATE elements SET quantity = quantity + ?, updated_at = datetime(\'now\') WHERE id = ?')
    .run(delta, elementId);
  db.prepare('INSERT INTO stock_moves (element_id, delta, reason, order_id) VALUES (?, ?, ?, ?)')
    .run(elementId, delta, reason, orderId);
}

function stockReport() {
  const threshold = lowStockThreshold();
  const all = listElements();
  return {
    threshold,
    outOfStock: all.filter((e) => e.quantity <= 0),
    lowStock: all.filter((e) => e.quantity > 0 && e.quantity < threshold),
    healthy: all.filter((e) => e.quantity >= threshold),
  };
}

/* ------------------------------------------------------------------ orders */

function nextOrderNumber() {
  const year = new Date().getFullYear();
  const row = db.prepare("SELECT COUNT(*) AS n FROM orders WHERE order_number LIKE ?").get(`CJ-${year}-%`);
  return `CJ-${year}-${String(row.n + 1).padStart(4, '0')}`;
}

/**
 * Turn the raw canvas design into an aggregated element -> quantity map.
 * Each placement on the canvas counts as one unit; the base piece counts as one.
 */
function aggregateDesign(design) {
  const counts = new Map();
  const add = (id) => {
    const key = Number(id);
    if (!Number.isInteger(key) || key <= 0) return;
    counts.set(key, (counts.get(key) || 0) + 1);
  };
  if (design && design.baseElementId) add(design.baseElementId);
  for (const p of (design && design.placements) || []) add(p.elementId);
  return counts;
}

class OrderError extends Error {
  constructor(message, details) {
    super(message);
    this.details = details;
  }
}

/**
 * Price a design without touching stock. Returns the same shape the checkout
 * uses, so the client can show an authoritative total before committing.
 */
function quote({ design, fulfilment, shippingArea }) {
  const counts = aggregateDesign(design);
  if (counts.size === 0) throw new OrderError('Your design is empty — add at least one piece.');

  const lines = [];
  const problems = [];
  let itemsTotal = 0;

  for (const [elementId, qty] of counts) {
    const el = getElement(elementId);
    if (!el || !el.active) {
      problems.push({ elementId, error: 'This piece is no longer available.' });
      continue;
    }
    if (qty > el.quantity) {
      problems.push({
        elementId,
        name: el.name,
        requested: qty,
        available: el.quantity,
        error: el.quantity === 0
          ? `${el.name} is out of stock.`
          : `Only ${el.quantity} of ${el.name} available (you selected ${qty}).`,
      });
      continue;
    }
    const lineTotal = round2(el.price * qty);
    itemsTotal += lineTotal;
    lines.push({
      elementId: el.id,
      sku: el.sku,
      name: el.name,
      category: el.category_name,
      unitPrice: el.price,
      quantity: qty,
      lineTotal,
    });
  }

  if (problems.length) throw new OrderError('Some pieces are not available in the quantity selected.', problems);

  let shippingCost = 0;
  let area = null;
  if (fulfilment === 'ship') {
    const zone = getZoneByArea(shippingArea);
    if (!zone) throw new OrderError('Please choose a delivery area we ship to.');
    shippingCost = zone.cost;
    area = zone.area;
  }

  itemsTotal = round2(itemsTotal);
  return {
    lines,
    itemsTotal,
    shippingCost: round2(shippingCost),
    total: round2(itemsTotal + shippingCost),
    shippingArea: area,
  };
}

/**
 * Validate, price and persist an order, decrementing stock atomically.
 * Re-prices inside the transaction so two shoppers cannot oversell the same charm.
 */
const placeOrder = db.transaction((payload) => {
  const priced = quote(payload);
  const {
    customerName, customerEmail, customerPhone,
    fulfilment, shippingAddress, notes, design,
  } = payload;

  const orderNumber = nextOrderNumber();
  const info = db.prepare(`
    INSERT INTO orders (order_number, customer_name, customer_email, customer_phone,
                        fulfilment, shipping_area, shipping_address, notes,
                        items_total, shipping_cost, total, design_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    orderNumber, customerName, customerEmail || null, customerPhone,
    fulfilment, priced.shippingArea, fulfilment === 'ship' ? shippingAddress : null, notes || null,
    priced.itemsTotal, priced.shippingCost, priced.total, JSON.stringify(design || {})
  );
  const orderId = info.lastInsertRowid;

  const insertItem = db.prepare(`
    INSERT INTO order_items (order_id, element_id, sku, name, category, unit_price, quantity, line_total)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);

  for (const line of priced.lines) {
    insertItem.run(orderId, line.elementId, line.sku, line.name, line.category,
      line.unitPrice, line.quantity, line.lineTotal);
    adjustStock(line.elementId, -line.quantity, 'order', orderId);
  }

  return { id: orderId, orderNumber, ...priced };
});

function listOrders({ status } = {}) {
  const sql = `SELECT * FROM orders${status ? ' WHERE status = ?' : ''} ORDER BY created_at DESC, id DESC`;
  const orders = status ? db.prepare(sql).all(status) : db.prepare(sql).all();
  const items = db.prepare('SELECT * FROM order_items').all();
  return orders.map((o) => ({ ...o, items: items.filter((i) => i.order_id === o.id) }));
}

function getOrder(id) {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  if (!order) return null;
  order.items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(id);
  return order;
}

/**
 * Cancelling an order returns its pieces to the repo; re-opening a cancelled
 * order takes them out again, so stock always mirrors the live order book.
 */
const setOrderStatus = db.transaction((id, status) => {
  if (!ORDER_STATUSES.includes(status)) throw new OrderError('Unknown order status.');
  const order = getOrder(id);
  if (!order) throw new OrderError('Order not found.');
  if (order.status === status) return order;

  if (status === 'cancelled') {
    for (const item of order.items) {
      if (item.element_id) adjustStock(item.element_id, item.quantity, 'order_cancelled', id);
    }
  } else if (order.status === 'cancelled') {
    for (const item of order.items) {
      if (!item.element_id) continue;
      const el = getElement(item.element_id);
      if (!el || el.quantity < item.quantity) {
        throw new OrderError(`Cannot reopen: only ${el ? el.quantity : 0} of ${item.name} left in stock.`);
      }
    }
    for (const item of order.items) {
      if (item.element_id) adjustStock(item.element_id, -item.quantity, 'order_reopened', id);
    }
  }

  db.prepare("UPDATE orders SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, id);
  return getOrder(id);
});

/** What the workbench needs to pull for every order that is not yet done. */
function pickList() {
  return db.prepare(`
    SELECT oi.sku, oi.name, oi.category, SUM(oi.quantity) AS needed,
           COALESCE(e.quantity, 0) AS in_stock
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    LEFT JOIN elements e ON e.id = oi.element_id
    WHERE o.status IN ('new', 'in_progress')
    GROUP BY oi.sku, oi.name, oi.category, e.quantity
    ORDER BY needed DESC, oi.name`).all();
}

module.exports = {
  ORDER_STATUSES, OrderError,
  currency, lowStockThreshold, round2,
  listCategories, listElements, getElement,
  listZones, getZoneByArea,
  adjustStock, stockReport,
  quote, placeOrder, listOrders, getOrder, setOrderStatus, pickList,
};
