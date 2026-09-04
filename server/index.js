'use strict';

const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');

const { db, getSetting, setSetting, UPLOAD_DIR } = require('./db');
const auth = require('./auth');
const store = require('./store');
const publicRoutes = require('./routes/public');
const adminRoutes = require('./routes/admin');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());

app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '7d' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use('/api', publicRoutes);
app.use('/api/admin', adminRoutes);

app.get('/admin', (_req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'admin.html')));

app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  if (err instanceof store.OrderError) {
    return res.status(400).json({ error: err.message, details: err.details });
  }
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: 'Image is too large (max 4 MB).' });
  }
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server.' });
});

const initialPassword = auth.ensureAdminPassword();
if (!getSetting('currency')) setSetting('currency', process.env.CURRENCY || 'A$');
if (!getSetting('low_stock_threshold')) setSetting('low_stock_threshold', '10');
if (!getSetting('business_name')) setSetting('business_name', process.env.BUSINESS_NAME || 'CustomJewelz');

const elementCount = db.prepare('SELECT COUNT(*) AS n FROM elements').get().n;

app.listen(PORT, () => {
  console.log(`\n  ${getSetting('business_name')} running at http://localhost:${PORT}`);
  console.log(`  Admin console:            http://localhost:${PORT}/admin`);
  if (initialPassword) console.log(`  Admin password (change it): ${initialPassword}`);
  if (elementCount === 0) console.log('  Repo is empty — run `npm run seed` for sample charms.\n');
  else console.log('');
});

module.exports = app;
