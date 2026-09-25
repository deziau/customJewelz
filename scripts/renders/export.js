/* eslint-disable no-console */
/**
 * Unpacks a catalogue export into assets/raw/<id>/ — the sticker (and photo)
 * of every component as files, plus the few facts the render steps need.
 *
 *   node scripts/renders/export.js <dir-of-catalog-json>
 *
 * The directory holds one JSON file per catalogue document, as the artifact
 * database hands them out (either the bare document or { data: {...} }).
 * assets/ is git-ignored: the shop's pictures are not published with the code.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, 'assets', 'raw');

const src = process.argv[2];
if (!src || !fs.existsSync(src)) {
  console.error('Usage: node scripts/renders/export.js <dir-of-catalog-json>');
  process.exit(1);
}

const fromDataUrl = (url) => {
  const m = /^data:image\/([a-z+]+);base64,(.*)$/i.exec(url || '');
  if (!m) return null;
  const ext = m[1] === 'svg+xml' ? 'svg' : m[1] === 'jpeg' ? 'jpg' : m[1];
  return { ext, buf: Buffer.from(m[2], 'base64') };
};

let n = 0;
for (const file of fs.readdirSync(src).filter((f) => f.endsWith('.json'))) {
  const raw = JSON.parse(fs.readFileSync(path.join(src, file), 'utf8'));
  const d = raw.data || raw;
  const id = file.replace(/\.json$/, '');
  const dir = path.join(OUT, id);
  fs.mkdirSync(dir, { recursive: true });
  const stickers = d.stickers || d.cutouts || [];
  const saved = { stickers: [], photos: [] };
  stickers.forEach((u, i) => {
    const f = fromDataUrl(u);
    if (!f) return;
    const name = `sticker-${i}.${f.ext}`;
    fs.writeFileSync(path.join(dir, name), f.buf);
    saved.stickers.push(name);
  });
  (d.images || []).forEach((u, i) => {
    const f = fromDataUrl(u);
    if (!f) return;
    const name = `photo-${i}.${f.ext}`;
    fs.writeFileSync(path.join(dir, name), f.buf);
    saved.photos.push(name);
  });
  const role = d.role || (d.soldBy === 'length' ? 'chain' : /bangle|kada|kara|chud/i.test(d.category || '') ? 'bangle' : 'charm');
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({
    id, name: d.name, category: d.category, role,
    widthMm: d.widthMm || 0, heightMm: d.heightMm || 0, note: d.note || '',
    variants: (d.variants || []).map((v) => v.name || ''),
    docBytes: JSON.stringify(d).length,
    ...saved,
  }, null, 2));
  n++;
}
console.log(`Exported ${n} components to ${path.relative(ROOT, OUT)}/`);
