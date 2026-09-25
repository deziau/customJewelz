/* eslint-disable no-console */
/**
 * Makes the picture Create draws for every charm, and checks it.
 *
 *   node scripts/renders/finish.js [--only id,id]
 *
 * For each sticker in assets/raw/<id>/:
 *   - if Higgsfield made a studio render (assets/renders/<id>/ai-<n>.png), its
 *     white background is lifted off, it is trimmed to the metal, and its outline
 *     is compared with the original cut-out: a render whose shape has drifted
 *     (a missing loop, a changed outline) is rejected and the sticker is used;
 *   - otherwise the sticker itself is polished — levels, a little colour and
 *     clarity — so the whole collection reads as one set.
 * Output: assets/renders/<id>/render-<n>.webp and assets/renders/manifest.json.
 * Nothing leaves this machine; uploading is a separate, approved step.
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ROOT = path.join(__dirname, '..', '..');
const RAW = path.join(ROOT, 'assets', 'raw');
const OUT = path.join(ROOT, 'assets', 'renders');
const EDGE = 640;              // long side of the finished render, px
const MIN_IOU = 0.86;          // how closely a render's outline must match the cut-out
const DOC_LIMIT = 240000;      // a catalogue document must stay under this

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : null; };
const ONLY = (opt('only') || '').split(',').filter(Boolean);

/** RGBA pixels of an image. */
async function rgba(input) {
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height };
}

/** Lifts a plain light background off by flooding in from the edges. */
function liftBackground({ data, w, h }) {
  const idx = (x, y) => (y * w + x) * 4;
  const corner = [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]].map(([x, y]) => data.subarray(idx(x, y), idx(x, y) + 3));
  const bg = [0, 1, 2].map((c) => corner.reduce((s, p) => s + p[c], 0) / 4);
  const far = (i) => Math.max(Math.abs(data[i] - bg[0]), Math.abs(data[i + 1] - bg[1]), Math.abs(data[i + 2] - bg[2]));
  const seen = new Uint8Array(w * h);
  const stack = [];
  for (let x = 0; x < w; x++) stack.push([x, 0], [x, h - 1]);
  for (let y = 0; y < h; y++) stack.push([0, y], [w - 1, y]);
  while (stack.length) {
    const [x, y] = stack.pop();
    if (x < 0 || y < 0 || x >= w || y >= h) continue;
    const k = y * w + x;
    if (seen[k]) continue;
    const i = k * 4;
    const d = far(i);
    if (d > 38) continue;
    seen[k] = 1;
    // Soft edge: nearly-background pixels fade rather than cut.
    data[i + 3] = d < 18 ? 0 : Math.round(((d - 18) / 20) * 255);
    stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }
  return { data, w, h };
}

/** A small binary picture of where the metal is, trimmed and centred. */
async function mask(input, size = 96) {
  const trimmed = await sharp(input).ensureAlpha().trim({ threshold: 1 }).toBuffer();
  const { data } = await sharp(trimmed).resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const m = new Uint8Array(size * size);
  for (let k = 0; k < m.length; k++) m[k] = data[k * 4 + 3] > 100 ? 1 : 0;
  return m;
}

const iou = (a, b) => {
  let inter = 0; let union = 0;
  for (let k = 0; k < a.length; k++) { inter += a[k] & b[k]; union += a[k] | b[k]; }
  return union ? inter / union : 0;
};

/** Levels, a touch of colour and clarity, on the colour only — the cut stays as it was. */
async function polish(input) {
  const img = sharp(input).ensureAlpha();
  const alpha = await img.clone().extractChannel(3).toBuffer();
  const rgb = await img.clone().removeAlpha()
    .normalise({ lower: 1, upper: 99.4 })
    .modulate({ saturation: 1.1 })
    .sharpen({ sigma: 0.7 })
    .toBuffer();
  return sharp(rgb).joinChannel(alpha);
}

async function finishOne(id, meta) {
  const dir = path.join(OUT, id);
  fs.mkdirSync(dir, { recursive: true });
  const out = [];
  for (const [n, s] of meta.stickers.entries()) {
    const sticker = path.join(RAW, id, s);
    const ai = path.join(dir, `ai-${n}.png`);
    let source = 'sticker';
    let score = null;
    let pipeline;
    if (fs.existsSync(ai)) {
      const lifted = liftBackground(await rgba(ai));
      const png = await sharp(lifted.data, { raw: { width: lifted.w, height: lifted.h, channels: 4 } }).png().toBuffer();
      score = iou(await mask(sticker), await mask(png));
      if (score >= MIN_IOU) { source = 'higgsfield'; pipeline = sharp(png); }
    }
    if (!pipeline) pipeline = await polish(sticker);
    const file = `render-${n}.webp`;
    await pipeline.trim({ threshold: 1 })
      .resize(EDGE, EDGE, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 84, alphaQuality: 90 })
      .toFile(path.join(dir, file));
    out.push({ file, source, iou: score === null ? null : Math.round(score * 1000) / 1000,
      bytes: fs.statSync(path.join(dir, file)).size });
  }
  const added = out.reduce((s, r) => s + Math.ceil(r.bytes * 4 / 3) + 40, 0);
  return { id, name: meta.name, renders: out, docBytesAfter: meta.docBytes + added, fits: meta.docBytes + added < DOC_LIMIT };
}

(async () => {
  const manifest = [];
  for (const id of fs.readdirSync(RAW)) {
    if (ONLY.length && !ONLY.includes(id)) continue;
    const meta = JSON.parse(fs.readFileSync(path.join(RAW, id, 'meta.json'), 'utf8'));
    if (meta.role !== 'charm' || !meta.stickers.length) continue;
    const r = await finishOne(id, meta);
    manifest.push(r);
    console.log(`${id} ${meta.name}: ${r.renders.map((x) => `${x.source}${x.iou === null ? '' : ` iou ${x.iou}`}`).join(', ')}${r.fits ? '' : '  (too big for its document)'}`);
  }
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
  const ai = manifest.flatMap((m) => m.renders).filter((x) => x.source === 'higgsfield').length;
  console.log(`\n${manifest.length} charms finished — ${ai} from Higgsfield renders, the rest polished stickers.`);
})();
