'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, '..', 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// DB_PATH lets the smoke test (and any staging copy) run against its own file.
const DB_FILE = process.env.DB_PATH || path.join(DATA_DIR, 'customjewelz.db');
const db = new Database(DB_FILE);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS categories (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  slug        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'attachment',  -- 'base' | 'attachment'
  sort_order  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS elements (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  sku          TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL,
  category_id  INTEGER NOT NULL REFERENCES categories(id),
  price        REAL NOT NULL DEFAULT 0,
  quantity     INTEGER NOT NULL DEFAULT 0,
  image_url    TEXT,
  description  TEXT,
  -- default on-canvas footprint in px, lets admins size a charm sensibly
  default_width INTEGER NOT NULL DEFAULT 90,
  active       INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS shipping_zones (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  area     TEXT NOT NULL UNIQUE,
  cost     REAL NOT NULL DEFAULT 0,
  eta_days TEXT,
  active   INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS orders (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  order_number   TEXT NOT NULL UNIQUE,
  customer_name  TEXT NOT NULL,
  customer_email TEXT,
  customer_phone TEXT NOT NULL,
  fulfilment     TEXT NOT NULL,               -- 'pickup' | 'ship'
  shipping_area  TEXT,
  shipping_address TEXT,
  notes          TEXT,
  items_total    REAL NOT NULL DEFAULT 0,
  shipping_cost  REAL NOT NULL DEFAULT 0,
  total          REAL NOT NULL DEFAULT 0,
  status         TEXT NOT NULL DEFAULT 'new', -- new|in_progress|ready|completed|cancelled
  design_json    TEXT,                        -- canvas snapshot for re-creating the piece
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS order_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id    INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  element_id  INTEGER REFERENCES elements(id),
  sku         TEXT NOT NULL,
  name        TEXT NOT NULL,
  category    TEXT NOT NULL,
  unit_price  REAL NOT NULL,
  quantity    INTEGER NOT NULL,
  line_total  REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS stock_moves (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  element_id  INTEGER NOT NULL REFERENCES elements(id),
  delta       INTEGER NOT NULL,
  reason      TEXT NOT NULL,
  order_id    INTEGER REFERENCES orders(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_elements_category ON elements(category_id);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_stock_moves_element ON stock_moves(element_id);
`);

function getSetting(key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

function setSetting(key, value) {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, String(value));
}

module.exports = { db, getSetting, setSetting, DATA_DIR, UPLOAD_DIR, DB_FILE };
