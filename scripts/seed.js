'use strict';

/**
 * Seeds a demo repo: categories, sample pieces (with generated SVG artwork),
 * and a few shipping areas. Safe to re-run — it skips anything already there.
 * Pass --reset to wipe orders, stock history and the catalog first.
 */

const fs = require('fs');
const path = require('path');
const { db } = require('../server/db');

const SAMPLE_DIR = path.join(__dirname, '..', 'public', 'img', 'samples');
fs.mkdirSync(SAMPLE_DIR, { recursive: true });

if (process.argv.includes('--reset')) {
  db.exec(`DELETE FROM order_items; DELETE FROM orders; DELETE FROM stock_moves;
           DELETE FROM elements; DELETE FROM categories; DELETE FROM shipping_zones;`);
  console.log('Cleared existing catalog and orders.');
}

/* ------------------------------------------------------- placeholder art */

const gold = ['#d4af37', '#f2d675', '#b8860b'];

function svg(inner, w = 200, h = 200) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${gold[1]}"/><stop offset="55%" stop-color="${gold[0]}"/>
      <stop offset="100%" stop-color="${gold[2]}"/>
    </linearGradient>
  </defs>
  ${inner}
</svg>`;
}

const ART = {
  'base-bracelet': svg(`<circle cx="100" cy="100" r="72" fill="none" stroke="url(#g)" stroke-width="13"/>
    <circle cx="100" cy="100" r="72" fill="none" stroke="#00000022" stroke-width="2"/>`),
  'base-pendant-chain': svg(`<path d="M100 12 C40 60 40 120 100 188 C160 120 160 60 100 12 Z" fill="none" stroke="url(#g)" stroke-width="8"/>
    <circle cx="100" cy="24" r="12" fill="none" stroke="url(#g)" stroke-width="7"/>`),
  'base-kaleera': svg(`<path d="M100 10 v40" stroke="url(#g)" stroke-width="8" fill="none"/>
    <path d="M60 50 h80 l-12 40 h-56 z" fill="url(#g)"/>
    <path d="M72 90 q28 60 56 0" fill="none" stroke="url(#g)" stroke-width="6"/>
    <circle cx="72" cy="94" r="7" fill="url(#g)"/><circle cx="128" cy="94" r="7" fill="url(#g)"/>`),
  'charm-heart': svg(`<path d="M100 170 C20 110 30 40 78 40 c14 0 22 8 22 18 0-10 8-18 22-18 48 0 58 70-22 130 z" fill="url(#g)"/>`),
  'charm-evil-eye': svg(`<circle cx="100" cy="100" r="70" fill="#2b6cb0"/><circle cx="100" cy="100" r="46" fill="#fff"/>
    <circle cx="100" cy="100" r="26" fill="#1a365d"/><circle cx="92" cy="90" r="7" fill="#ffffffaa"/>`),
  'charm-pearl': svg(`<circle cx="100" cy="100" r="62" fill="#f7f2ea"/><circle cx="80" cy="80" r="18" fill="#ffffffcc"/>
    <circle cx="100" cy="100" r="62" fill="none" stroke="#00000018" stroke-width="3"/>`),
  'charm-om': svg(`<circle cx="100" cy="100" r="66" fill="url(#g)"/>
    <text x="100" y="132" font-size="88" text-anchor="middle" fill="#7a5c00" font-family="serif">&#2384;</text>`),
  'charm-star': svg(`<path d="M100 18 l24 52 57 7-42 39 11 57-50-28-50 28 11-57-42-39 57-7z" fill="url(#g)"/>`),
  'charm-bell': svg(`<path d="M100 22 a44 44 0 0 1 44 44 v46 l16 22 h-120 l16-22 v-46 a44 44 0 0 1 44-44z" fill="url(#g)"/>
    <circle cx="100" cy="150" r="14" fill="${gold[2]}"/>`),
  'charm-flower': svg(`<g fill="url(#g)"><circle cx="100" cy="52" r="28"/><circle cx="148" cy="86" r="28"/>
    <circle cx="130" cy="142" r="28"/><circle cx="70" cy="142" r="28"/><circle cx="52" cy="86" r="28"/></g>
    <circle cx="100" cy="102" r="22" fill="#f7f2ea"/>`),
  'charm-initial': svg(`<rect x="34" y="34" width="132" height="132" rx="28" fill="url(#g)"/>
    <text x="100" y="132" font-size="82" text-anchor="middle" fill="#7a5c00" font-family="Georgia, serif">A</text>`),
  'bangle-kada': svg(`<circle cx="100" cy="100" r="76" fill="none" stroke="url(#g)" stroke-width="22"/>`),
  'bangle-thin': svg(`<circle cx="100" cy="100" r="78" fill="none" stroke="url(#g)" stroke-width="7"/>`),
  'chain-cable': svg(`<g fill="none" stroke="url(#g)" stroke-width="9">
    <ellipse cx="100" cy="40" rx="22" ry="14"/><ellipse cx="100" cy="80" rx="22" ry="14"/>
    <ellipse cx="100" cy="120" rx="22" ry="14"/><ellipse cx="100" cy="160" rx="22" ry="14"/></g>`),
  'chain-tassel': svg(`<path d="M100 20 v30" stroke="url(#g)" stroke-width="8"/>
    <path d="M70 50 h60 l-8 22 h-44z" fill="url(#g)"/>
    <g stroke="url(#g)" stroke-width="5">${[74, 87, 100, 113, 126].map((x) => `<path d="M${x} 72 v96"/>`).join('')}</g>`),
};

for (const [name, content] of Object.entries(ART)) {
  fs.writeFileSync(path.join(SAMPLE_DIR, `${name}.svg`), content);
}

/* --------------------------------------------------------------- catalog */

const CATEGORIES = [
  { slug: 'bases', name: 'Base pieces', kind: 'base', sort_order: 1 },
  { slug: 'charms', name: 'Charms', kind: 'attachment', sort_order: 2 },
  { slug: 'bangles', name: 'Bangles', kind: 'attachment', sort_order: 3 },
  { slug: 'chains', name: 'Chains & tassels', kind: 'attachment', sort_order: 4 },
];

const upsertCategory = db.prepare(`
  INSERT INTO categories (slug, name, kind, sort_order) VALUES (@slug, @name, @kind, @sort_order)
  ON CONFLICT(slug) DO UPDATE SET name = excluded.name, kind = excluded.kind, sort_order = excluded.sort_order`);
CATEGORIES.forEach((c) => upsertCategory.run(c));

const catId = Object.fromEntries(
  db.prepare('SELECT slug, id FROM categories').all().map((c) => [c.slug, c.id]));

const ELEMENTS = [
  ['BASE-BR-01', 'Classic gold bracelet band', 'bases',  1800, 12, 'base-bracelet',      320, 'Adjustable 18k-plated band — the canvas for your charms.'],
  ['BASE-PD-01', 'Teardrop pendant frame',     'bases',  2200,  8, 'base-pendant-chain', 300, 'Open teardrop frame on a 18" chain.'],
  ['BASE-KL-01', 'Kaleera frame',              'bases',  3500,  5, 'base-kaleera',       340, 'Traditional kaleera dome and hoop frame.'],
  ['CHM-HRT-01', 'Heart charm',        'charms',  450, 40, 'charm-heart',    80, null],
  ['CHM-EYE-01', 'Evil eye charm',     'charms',  520, 25, 'charm-evil-eye', 72, 'Enamel evil eye for protection.'],
  ['CHM-PRL-01', 'Freshwater pearl',   'charms',  680, 18, 'charm-pearl',    64, null],
  ['CHM-OM-01',  'Om charm',           'charms',  600,  9, 'charm-om',       76, 'Low stock demo piece.'],
  ['CHM-STR-01', 'Star charm',         'charms',  380, 60, 'charm-star',     72, null],
  ['CHM-BEL-01', 'Ghungroo bell',      'charms',  250,  0, 'charm-bell',     60, 'Out of stock demo piece.'],
  ['CHM-FLR-01', 'Enamel flower',      'charms',  540, 22, 'charm-flower',   78, null],
  ['CHM-INI-01', 'Initial letter tile', 'charms', 750, 30, 'charm-initial',  74, 'Tell us the letter in order notes.'],
  ['BNG-KAD-01', 'Gold kada',   'bangles', 2600, 6, 'bangle-kada', 300, null],
  ['BNG-THN-01', 'Thin bangle', 'bangles',  900, 34, 'bangle-thin', 300, null],
  ['CHN-CBL-01', 'Cable chain drop', 'chains', 700, 20, 'chain-cable',  90, null],
  ['CHN-TSL-01', 'Tassel drop',      'chains', 850, 14, 'chain-tassel', 96, null],
];

const insertElement = db.prepare(`
  INSERT INTO elements (sku, name, category_id, price, quantity, image_url, description, default_width)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(sku) DO NOTHING`);

let added = 0;
for (const [sku, name, cat, price, qty, art, width, desc] of ELEMENTS) {
  const info = insertElement.run(sku, name, catId[cat], price, qty, `/img/samples/${art}.svg`, desc, width);
  added += info.changes;
}

const ZONES = [
  ['Local city (same day)', 80, '1'],
  ['Within state', 150, '2-3'],
  ['Rest of country', 250, '4-7'],
  ['International', 1800, '10-15'],
];
const insertZone = db.prepare('INSERT INTO shipping_zones (area, cost, eta_days) VALUES (?, ?, ?) ON CONFLICT(area) DO NOTHING');
let zones = 0;
for (const z of ZONES) zones += insertZone.run(...z).changes;

console.log(`Seeded ${CATEGORIES.length} categories, ${added} new pieces, ${zones} new shipping areas.`);
console.log('Sample artwork written to public/img/samples/');
