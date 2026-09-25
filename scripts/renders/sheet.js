/* eslint-disable no-console */
/**
 * A review sheet: every charm's original cut-out beside what finish.js made of
 * it, so the renders can be approved before anything goes to the shop.
 *
 *   node scripts/renders/sheet.js            -> assets/review.html
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const RAW = path.join(ROOT, 'assets', 'raw');
const OUT = path.join(ROOT, 'assets', 'renders');
const manifest = JSON.parse(fs.readFileSync(path.join(OUT, 'manifest.json'), 'utf8'));

const uri = (file) => {
  const ext = path.extname(file).slice(1).replace('jpg', 'jpeg').replace('svg', 'svg+xml');
  return `data:image/${ext};base64,${fs.readFileSync(file).toString('base64')}`;
};
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const cards = manifest.flatMap((m) => {
  const meta = JSON.parse(fs.readFileSync(path.join(RAW, m.id, 'meta.json'), 'utf8'));
  return m.renders.map((r, n) => `<figure>
    <div class="pair"><img src="${uri(path.join(RAW, m.id, meta.stickers[n]))}" alt="Original">
      <img src="${uri(path.join(OUT, m.id, r.file))}" alt="Render"></div>
    <figcaption><b>${esc(m.name)}</b>${meta.variants[n] ? ` · ${esc(meta.variants[n])}` : ''}
      <span class="${r.source}">${r.source === 'higgsfield' ? `Higgsfield · match ${Math.round(r.iou * 100)}%` : 'polished cut-out'}</span>
      ${m.fits ? '' : '<span class="warn">too big to store</span>'}</figcaption></figure>`);
}).join('');

fs.writeFileSync(path.join(ROOT, 'assets', 'review.html'), `<!doctype html><html lang="en"><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Charm Renders Review</title>
<style>
:root { --bg: #f6f2ec; --card: #fffdf9; --ink: #241b26; --muted: #756b76; --line: #e2dbd4; --accent: #6d2f4a; --ok: #2f6b52; --warn: #a3302e; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg: #171319; --card: #221b25; --ink: #efe9ec; --muted: #a396a1; --line: #3a303d; --accent: #c9789a; --ok: #7fc0a0; --warn: #ec8280; } }
:root[data-theme="dark"] { --bg: #171319; --card: #221b25; --ink: #efe9ec; --muted: #a396a1; --line: #3a303d; --accent: #c9789a; --ok: #7fc0a0; --warn: #ec8280; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 15px/1.5 system-ui, sans-serif; }
header { padding: 24px 16px 8px; max-width: 1200px; margin: 0 auto; }
h1 { font: 400 28px Georgia, serif; margin: 0 0 4px; }
header p { margin: 0; color: var(--muted); }
main { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 14px; padding: 16px; max-width: 1200px; margin: 0 auto; }
figure { margin: 0; background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 10px; }
.pair { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.pair img { width: 100%; aspect-ratio: 1; object-fit: contain; border-radius: 8px;
  background: radial-gradient(circle at 50% 35%, #fffdf8, #efe7dc); }
figcaption { font-size: 13px; margin-top: 8px; display: grid; gap: 2px; }
figcaption span { color: var(--muted); } .higgsfield { color: var(--ok) !important; } .warn { color: var(--warn) !important; }
</style>
<header><h1>Charm renders for review</h1><p>Left: the cut-out in the shop today. Right: what Create would draw. ${manifest.length} charms.</p></header>
<main>${cards}</main></html>`);
console.log('Wrote assets/review.html');
