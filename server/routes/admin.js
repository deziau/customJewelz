'use strict';

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');

const { db, getSetting, setSetting, UPLOAD_DIR } = require('../db');
const auth = require('../auth');
const store = require('../store');

const router = express.Router();

const ALLOWED_IMAGE = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg']);
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`);
    },
  }),
  limits: { fileSize: 4 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_IMAGE.has(ext)) return cb(new Error('Only PNG, JPG, WEBP, GIF or SVG images are allowed.'));
    cb(null, true);
  },
});

/* -------------------------------------------------------------------- auth */

router.post('/login', (req, res) => {
  if (!auth.verifyPassword(req.body?.password)) {
    return res.status(401).json({ error: 'Incorrect password.' });
  }
  const { token } = auth.createSession();
  res.cookie(auth.SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: auth.SESSION_TTL_HOURS * 3600 * 1000,
  });
  res.json({ ok: true });
});

router.post('/logout', (req, res) => {
  auth.destroySession(req.cookies?.[auth.SESSION_COOKIE]);
  res.clearCookie(auth.SESSION_COOKIE);
  res.json({ ok: true });
});

router.get('/session', (req, res) => {
  res.json({ signedIn: auth.sessionValid(req.cookies?.[auth.SESSION_COOKIE]) });
});

router.use(auth.requireAdmin);

router.post('/password', (req, res) => {
  const result = auth.changePassword(req.body?.current, req.body?.next);
  if (!result.ok) return res.status(400).json({ error: result.error });
  res.clearCookie(auth.SESSION_COOKIE);
  res.json({ ok: true });
});

/* ---------------------------------------------------------------- settings */

router.get('/settings', (_req, res) => {
  res.json({
    businessName: getSetting('business_name', 'CustomJewelz'),
    currency: store.currency(),
    lowStockThreshold: store.lowStockThreshold(),
  });
});

router.put('/settings', (req, res) => {
  const b = req.body || {};
  if (b.businessName) setSetting('business_name', String(b.businessName).trim());
  if (b.currency) setSetting('currency', String(b.currency).trim());
  if (b.lowStockThreshold !== undefined) {
    const t = parseInt(b.lowStockThreshold, 10);
    if (!Number.isInteger(t) || t < 1) return res.status(400).json({ error: 'Low-stock threshold must be a positive whole number.' });
    setSetting('low_stock_threshold', t);
  }
  res.json({ ok: true });
});

/* -------------------------------------------------------------- categories */

router.get('/categories', (_req, res) => res.json(store.listCategories()));

router.post('/categories', (req, res) => {
  const { name, kind = 'attachment', sortOrder = 0 } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Category name is required.' });
  const slug = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  try {
    const info = db.prepare('INSERT INTO categories (slug, name, kind, sort_order) VALUES (?, ?, ?, ?)')
      .run(slug, String(name).trim(), kind === 'base' ? 'base' : 'attachment', Number(sortOrder) || 0);
    res.status(201).json({ id: info.lastInsertRowid, slug });
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) return res.status(400).json({ error: 'That category already exists.' });
    throw err;
  }
});

router.delete('/categories/:id', (req, res) => {
  const used = db.prepare('SELECT COUNT(*) AS n FROM elements WHERE category_id = ?').get(req.params.id).n;
  if (used) return res.status(400).json({ error: `Category still has ${used} piece(s) in the repo.` });
  db.prepare('DELETE FROM categories WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

/* ---------------------------------------------------------------- elements */

router.get('/elements', (_req, res) => res.json(store.listElements()));

function elementFromBody(body, file) {
  const price = Number(body.price);
  const quantity = parseInt(body.quantity, 10);
  if (!String(body.name || '').trim()) throw new store.OrderError('Name is required.');
  if (!body.categoryId) throw new store.OrderError('Category is required.');
  if (!Number.isFinite(price) || price < 0) throw new store.OrderError('Price must be zero or more.');
  if (!Number.isInteger(quantity) || quantity < 0) throw new store.OrderError('Quantity must be a whole number, zero or more.');
  return {
    name: String(body.name).trim(),
    sku: String(body.sku || '').trim() || `SKU-${Date.now().toString(36).toUpperCase()}`,
    categoryId: Number(body.categoryId),
    price,
    quantity,
    description: String(body.description || '').trim() || null,
    defaultWidth: parseInt(body.defaultWidth ?? body.default_width, 10) || 90,
    active: body.active === undefined ? 1 : (body.active === 'false' || body.active === false ? 0 : 1),
    imageUrl: file ? `/uploads/${file.filename}` : (String(body.imageUrl || '').trim() || null),
  };
}

router.post('/elements', upload.single('image'), (req, res, next) => {
  try {
    const e = elementFromBody(req.body, req.file);
    const info = db.prepare(`
      INSERT INTO elements (sku, name, category_id, price, quantity, image_url, description, default_width, active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      e.sku, e.name, e.categoryId, e.price, e.quantity, e.imageUrl, e.description, e.defaultWidth, e.active);
    if (e.quantity > 0) store.adjustStock(info.lastInsertRowid, 0, 'created');
    res.status(201).json(store.getElement(info.lastInsertRowid));
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) return res.status(400).json({ error: 'That SKU already exists.' });
    next(err);
  }
});

router.put('/elements/:id', upload.single('image'), (req, res, next) => {
  try {
    const existing = store.getElement(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Piece not found.' });
    const e = elementFromBody({ ...existing, categoryId: existing.category_id, ...req.body }, req.file);
    const imageUrl = req.file ? e.imageUrl : (req.body.imageUrl !== undefined ? e.imageUrl : existing.image_url);
    db.prepare(`
      UPDATE elements SET sku = ?, name = ?, category_id = ?, price = ?, image_url = ?,
        description = ?, default_width = ?, active = ?, updated_at = datetime('now')
      WHERE id = ?`).run(
      e.sku, e.name, e.categoryId, e.price, imageUrl, e.description, e.defaultWidth, e.active, req.params.id);

    // Quantity changes are logged as stock moves so the repo has an audit trail.
    if (e.quantity !== existing.quantity) {
      store.adjustStock(existing.id, e.quantity - existing.quantity, 'manual_adjustment');
    }
    res.json(store.getElement(req.params.id));
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) return res.status(400).json({ error: 'That SKU already exists.' });
    next(err);
  }
});

/** Quick "+10 arrived" restock button in the repo table. */
router.post('/elements/:id/restock', (req, res) => {
  const delta = parseInt(req.body?.delta, 10);
  const el = store.getElement(req.params.id);
  if (!el) return res.status(404).json({ error: 'Piece not found.' });
  if (!Number.isInteger(delta) || delta === 0) return res.status(400).json({ error: 'Enter how many arrived.' });
  if (el.quantity + delta < 0) return res.status(400).json({ error: `Cannot go below zero (only ${el.quantity} in repo).` });
  store.adjustStock(el.id, delta, delta > 0 ? 'restock' : 'manual_adjustment');
  res.json(store.getElement(el.id));
});

router.delete('/elements/:id', (req, res) => {
  const used = db.prepare('SELECT COUNT(*) AS n FROM order_items WHERE element_id = ?').get(req.params.id).n;
  if (used) {
    // Keep order history intact — retire the piece instead of deleting it.
    db.prepare("UPDATE elements SET active = 0, updated_at = datetime('now') WHERE id = ?").run(req.params.id);
    return res.json({ ok: true, retired: true });
  }
  db.prepare('DELETE FROM stock_moves WHERE element_id = ?').run(req.params.id);
  db.prepare('DELETE FROM elements WHERE id = ?').run(req.params.id);
  res.json({ ok: true, deleted: true });
});

/* ------------------------------------------------------------------- stock */

router.get('/stock', (_req, res) => res.json(store.stockReport()));

router.get('/stock/moves', (_req, res) => {
  res.json(db.prepare(`
    SELECT sm.*, e.name, e.sku FROM stock_moves sm
    JOIN elements e ON e.id = sm.element_id
    ORDER BY sm.created_at DESC, sm.id DESC LIMIT 200`).all());
});

/* ------------------------------------------------------------------ orders */

router.get('/orders', (req, res) => res.json(store.listOrders({ status: req.query.status })));
router.get('/orders/pick-list', (_req, res) => res.json(store.pickList()));

router.get('/orders/:id', (req, res) => {
  const order = store.getOrder(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found.' });
  res.json(order);
});

router.put('/orders/:id/status', (req, res, next) => {
  try {
    res.json(store.setOrderStatus(Number(req.params.id), req.body?.status));
  } catch (err) { next(err); }
});

/* ---------------------------------------------------------------- shipping */

router.get('/shipping-zones', (_req, res) => res.json(store.listZones()));

router.post('/shipping-zones', (req, res) => {
  const { area, cost, etaDays } = req.body || {};
  if (!String(area || '').trim()) return res.status(400).json({ error: 'Area name is required.' });
  if (!Number.isFinite(Number(cost)) || Number(cost) < 0) return res.status(400).json({ error: 'Shipping cost must be zero or more.' });
  try {
    const info = db.prepare('INSERT INTO shipping_zones (area, cost, eta_days) VALUES (?, ?, ?)')
      .run(String(area).trim(), Number(cost), etaDays || null);
    res.status(201).json({ id: info.lastInsertRowid });
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) return res.status(400).json({ error: 'That area already exists.' });
    throw err;
  }
});

router.put('/shipping-zones/:id', (req, res) => {
  const { area, cost, etaDays, active } = req.body || {};
  const existing = db.prepare('SELECT * FROM shipping_zones WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Area not found.' });
  db.prepare('UPDATE shipping_zones SET area = ?, cost = ?, eta_days = ?, active = ? WHERE id = ?').run(
    String(area ?? existing.area).trim(),
    cost === undefined ? existing.cost : Number(cost),
    etaDays === undefined ? existing.eta_days : etaDays,
    active === undefined ? existing.active : (active ? 1 : 0),
    req.params.id);
  res.json({ ok: true });
});

router.delete('/shipping-zones/:id', (req, res) => {
  db.prepare('DELETE FROM shipping_zones WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

/* --------------------------------------------------------------- dashboard */

router.get('/summary', (_req, res) => {
  const stock = store.stockReport();
  const orders = db.prepare(`
    SELECT status, COUNT(*) AS n, COALESCE(SUM(total), 0) AS value
    FROM orders GROUP BY status`).all();
  const byStatus = Object.fromEntries(orders.map((r) => [r.status, r]));
  res.json({
    outOfStockCount: stock.outOfStock.length,
    lowStockCount: stock.lowStock.length,
    threshold: stock.threshold,
    openOrders: (byStatus.new?.n || 0) + (byStatus.in_progress?.n || 0),
    readyOrders: byStatus.ready?.n || 0,
    revenue: store.round2(orders.filter((r) => r.status !== 'cancelled').reduce((s, r) => s + r.value, 0)),
    byStatus,
  });
});

module.exports = router;
