'use strict';

const express = require('express');
const { getSetting } = require('../db');
const store = require('../store');

const router = express.Router();

router.get('/config', (_req, res) => {
  res.json({
    businessName: getSetting('business_name', 'CustomJewelz'),
    currency: store.currency(),
  });
});

/** Everything the designer needs in one call: categories, in-stock pieces, zones. */
router.get('/catalog', (_req, res) => {
  const elements = store.listElements({ activeOnly: true }).map((e) => ({
    id: e.id,
    sku: e.sku,
    name: e.name,
    price: e.price,
    quantity: e.quantity,
    imageUrl: e.image_url,
    description: e.description,
    defaultWidth: e.default_width,
    category: e.category_slug,
    categoryName: e.category_name,
    categoryKind: e.category_kind,
  }));
  res.json({
    categories: store.listCategories(),
    elements,
    shippingZones: store.listZones({ activeOnly: true })
      .map((z) => ({ area: z.area, cost: z.cost, etaDays: z.eta_days })),
    currency: store.currency(),
  });
});

/** Live re-price / stock check for the design currently on the canvas. */
router.post('/quote', (req, res, next) => {
  try {
    const { design, fulfilment, shippingArea } = req.body || {};
    res.json(store.quote({ design, fulfilment, shippingArea }));
  } catch (err) { next(err); }
});

router.post('/orders', (req, res, next) => {
  try {
    const b = req.body || {};
    const name = String(b.customerName || '').trim();
    const phone = String(b.customerPhone || '').trim();
    if (!name) throw new store.OrderError('Please enter your name.');
    if (!phone) throw new store.OrderError('Please enter a contact number.');
    if (!['pickup', 'ship'].includes(b.fulfilment)) {
      throw new store.OrderError('Choose collect-when-ready or ship-when-ready.');
    }
    if (b.fulfilment === 'ship' && !String(b.shippingAddress || '').trim()) {
      throw new store.OrderError('Please enter a delivery address.');
    }

    const order = store.placeOrder({
      customerName: name,
      customerEmail: String(b.customerEmail || '').trim(),
      customerPhone: phone,
      fulfilment: b.fulfilment,
      shippingArea: b.shippingArea,
      shippingAddress: String(b.shippingAddress || '').trim(),
      notes: String(b.notes || '').trim(),
      design: b.design,
    });
    res.status(201).json(order);
  } catch (err) { next(err); }
});

module.exports = router;
