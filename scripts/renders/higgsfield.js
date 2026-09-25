/* eslint-disable no-console */
/**
 * Turns each charm's cut-out into a studio render with Higgsfield: the same
 * charm, front-on, evenly lit, loop at the top. Results land in
 * assets/renders/<id>/ai-<n>.png for scripts/renders/finish.js to check.
 *
 *   HF_KEY=<key_id:secret> node scripts/renders/higgsfield.js [--only id,id] [--limit 3] [--probe]
 *
 * The key is read from the environment only — never pass it on the command
 * line of a shared machine, and never commit it.
 *
 * REST shape, from Higgsfield's own client (higgsfield-client 0.2.0):
 *   Authorization: Key <key_id:secret>
 *   POST /files/generate-upload-url {content_type} -> {public_url, upload_url}; PUT the bytes
 *   POST /<model path> {arguments}                  -> {request_id, status_url, ...}
 *   GET  /requests/<id>/status                      -> {status: queued|in_progress|completed|failed, ...}
 *
 * The model path and argument names differ per model. They are overridable:
 *   HF_MODEL   default "bytedance/seedream/v4/edit"
 *   HF_IMAGES  the field that takes input image URLs, default "image_urls"
 * Run with --probe first: it sends one charm and prints every raw response.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const RAW = path.join(ROOT, 'assets', 'raw');
const OUT = path.join(ROOT, 'assets', 'renders');
const BASE = process.env.HF_BASE || 'https://api.higgsfield.ai';
const MODEL = process.env.HF_MODEL || 'bytedance/seedream/v4/edit';
const IMAGES_FIELD = process.env.HF_IMAGES || 'image_urls';
const KEY = process.env.HF_KEY || (process.env.HF_API_KEY && process.env.HF_API_SECRET
  ? `${process.env.HF_API_KEY}:${process.env.HF_API_SECRET}` : '');

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : null; };
const PROBE = flag('probe');
const ONLY = (opt('only') || '').split(',').filter(Boolean);
const LIMIT = Number(opt('limit')) || (PROBE ? 1 : Infinity);

const PROMPT = [
  'The exact same jewellery charm as the reference image — same shape, same outline, same enamel colours,',
  'same gold rim and the same hanging loop at the top. Keep every detail and proportion identical.',
  'Professional studio product photograph, front-on, centred, filling the frame, soft even light from the top left,',
  'crisp polished gold metal with gentle highlights, glossy enamel, true colours, sharp focus,',
  'plain pure white seamless background, no shadow on the background, no props, no text, no hands.',
].join(' ');

if (!KEY) {
  console.error('Set HF_KEY (key_id:secret) in the environment first.');
  process.exit(1);
}

const headers = { Authorization: `Key ${KEY}`, 'Content-Type': 'application/json' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(method, url, body) {
  const res = await fetch(url.startsWith('http') ? url : `${BASE}${url}`, {
    method, headers, body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  if (PROBE) console.log(`${method} ${url} -> ${res.status}\n${text.slice(0, 1500)}\n`);
  if (!res.ok) throw new Error(`${method} ${url}: ${res.status} ${text.slice(0, 300)}`);
  return json;
}

async function upload(file) {
  const type = file.endsWith('.webp') ? 'image/webp' : file.endsWith('.jpg') ? 'image/jpeg' : 'image/png';
  const slot = await call('POST', '/files/generate-upload-url', { content_type: type });
  const put = await fetch(slot.upload_url, {
    method: 'PUT', body: fs.readFileSync(file),
    headers: { 'Content-Type': type, ...(slot.upload_headers || slot.headers || {}) },
  });
  if (!put.ok) throw new Error(`upload PUT ${put.status}`);
  return slot.public_url;
}

/** Wherever the finished picture's URL is in the response, find it. */
function imageUrls(obj) {
  const out = [];
  const walk = (v) => {
    if (typeof v === 'string' && /^https?:\/\/\S+\.(png|jpe?g|webp)(\?|$)/i.test(v)) out.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(obj);
  return [...new Set(out)];
}

async function render(id, meta, stickerFile, n) {
  const url = await upload(stickerFile);
  const job = await call('POST', `/${MODEL}`, { prompt: PROMPT, [IMAGES_FIELD]: [url] });
  const reqId = job.request_id || job.id;
  const statusUrl = job.status_url || `/requests/${reqId}/status`;
  for (let t = 0; t < 120; t++) {
    await sleep(t < 5 ? 2000 : 4000);
    const st = await call('GET', statusUrl);
    const state = String(st.status || '').toLowerCase();
    if (state === 'completed') {
      const [img] = imageUrls(st);
      if (!img) throw new Error(`completed but no image in ${JSON.stringify(st).slice(0, 300)}`);
      const res = await fetch(img);
      const dir = path.join(OUT, id);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `ai-${n}.png`), Buffer.from(await res.arrayBuffer()));
      return;
    }
    if (['failed', 'nsfw', 'cancelled', 'canceled'].includes(state)) throw new Error(`${state}: ${JSON.stringify(st).slice(0, 300)}`);
  }
  throw new Error('timed out');
}

(async () => {
  const ids = fs.readdirSync(RAW).filter((id) => !ONLY.length || ONLY.includes(id));
  let done = 0;
  for (const id of ids) {
    if (done >= LIMIT) break;
    const meta = JSON.parse(fs.readFileSync(path.join(RAW, id, 'meta.json'), 'utf8'));
    if (meta.role !== 'charm') continue;
    for (const [n, s] of meta.stickers.entries()) {
      const target = path.join(OUT, id, `ai-${n}.png`);
      if (fs.existsSync(target) && !flag('again')) continue;
      process.stdout.write(`${id} ${meta.name} [${n}] … `);
      try {
        await render(id, meta, path.join(RAW, id, s), n);
        console.log('ok');
      } catch (e) {
        console.log(`failed — ${e.message}`);
        if (PROBE) process.exit(1);
      }
    }
    done++;
  }
})();
