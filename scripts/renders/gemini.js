/* eslint-disable no-console */
/**
 * Turns each charm's cut-out into a studio render with Gemini's image model,
 * through the Antigravity CLI (agy) the studio is signed in to. Results land in
 * assets/renders/<id>/ai-<n>.png, the same place higgsfield.js writes, for
 * scripts/renders/finish.js to check against the cut-out's outline.
 *
 *   node scripts/renders/gemini.js [--only id,id] [--limit 3]
 *   AGY=/path/to/agy.exe AGY_MODEL="Gemini 3.6 Flash (High)" node scripts/renders/gemini.js
 *
 * Each charm is worked on in its own scratch folder holding only its two
 * pictures, so the model sees nothing else. Charms that already have a render
 * are skipped; delete ai-<n>.png to redo one.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const sharp = require('sharp');

const ROOT = path.join(__dirname, '..', '..');
const RAW = path.join(ROOT, 'assets', 'raw');
const OUT = path.join(ROOT, 'assets', 'renders');
const AGY = process.env.AGY || path.join(os.homedir(), 'AppData', 'Local', 'agy', 'bin', 'agy.exe');
const MODEL = process.env.AGY_MODEL || 'Gemini 3.6 Flash (High)';

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : null; };
const ONLY = (opt('only') || '').split(',').filter(Boolean);
const LIMIT = Number(opt('limit')) || Infinity;

const prompt = (meta, colour) => [
  `In this folder, cutout.png is a transparent cut-out of a real jewellery piece: ${meta.name}`,
  `${meta.note ? ` (${meta.note})` : ''}, about ${meta.widthMm || '?'} mm wide by ${meta.heightMm || '?'} mm tall`,
  `${colour ? `, in ${colour}` : ''}.${fs.existsSync('photo.png') ? ' photo.png is a phone photo of the same piece.' : ''}`,
  ' Using your image generation tool, create ONE photorealistic studio product photograph of this exact',
  ' same piece: identical outline, proportions, stone and bead count, enamel colours and hanging loop(s);',
  ' true metal colour with soft highlights, front-on, centred and filling most of the frame, soft even light',
  ' from the top left, on a plain pure white seamless background, no shadow on the background, no props,',
  ' no text, no hands. Save it in this folder as render.png, then reply with only the file name.',
].join('');

async function main() {
  const ids = fs.readdirSync(RAW).filter((id) => !ONLY.length || ONLY.includes(id));
  let done = 0;
  for (const id of ids) {
    if (done >= LIMIT) break;
    const meta = JSON.parse(fs.readFileSync(path.join(RAW, id, 'meta.json'), 'utf8'));
    if (meta.role !== 'charm') continue;
    for (const [n, sticker] of meta.stickers.entries()) {
      const target = path.join(OUT, id, `ai-${n}.png`);
      if (fs.existsSync(target)) continue;
      process.stdout.write(`${id} ${meta.name} [${n}] … `);
      const work = fs.mkdtempSync(path.join(os.tmpdir(), 'cj-render-'));
      try {
        await sharp(path.join(RAW, id, sticker)).png().toFile(path.join(work, 'cutout.png'));
        const photo = meta.photos[n] || meta.photos[0];
        if (photo && !photo.endsWith('.svg')) await sharp(path.join(RAW, id, photo)).png().toFile(path.join(work, 'photo.png'));
        process.chdir(work);
        execFileSync(AGY, ['--model', MODEL, '--dangerously-skip-permissions', '--print-timeout', '8m',
          '-p', prompt(meta, meta.variants[n])], { stdio: 'pipe', timeout: 9 * 60 * 1000 });
        const made = path.join(work, 'render.png');
        if (!fs.existsSync(made)) throw new Error('no render.png came back');
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(made, target);
        console.log('ok');
      } catch (e) {
        console.log(`failed: ${String(e.message || e).split('\n')[0]}`);
      } finally {
        process.chdir(ROOT);
        fs.rmSync(work, { recursive: true, force: true });
      }
    }
    done++;
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
