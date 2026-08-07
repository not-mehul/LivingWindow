/* Measures banding in the sky, and holds the GPU to what the canvas already
   managed.

   A smooth ramp written to an 8-bit buffer has to step somewhere, and where the
   ramp is shallow those steps are wide enough to see. The canvas never showed
   them because Skia dithers its gradients — and dithers the radial sprite the
   old glow was blitted from — so the 2D path got it free, twice over. The GPU
   had to be told, and until it was, the sun and moon wore visible rings and the
   dusk halo stepped in bands two hundred pixels wide.

   Banding is easy to see and easy to miss, so this measures it. Along a line
   across a smooth ramp, count how far you travel before the colour changes at
   all: short runs read as smooth, and a long run *is* a visible band. Then run
   the same lines against both backends and require the GPU to do no worse than
   the canvas. That is the assertion that was missing, and the reason a
   regression here went unnoticed — comparing whole pictures could not find it,
   because a dither is a difference of one level and the comparison that passed
   was counting differences greater than two.

   Two things make the number mean anything. The scene is pinned — seeded
   randomness, a synthetic clock, and a reseed before each capture — so both
   backends photograph the same sky with the clouds in the same places. And each
   figure is a median over dozens of lines rather than one, because a single
   column that happens to pass behind a cloud will say whatever it likes. */
import { chromium } from 'playwright';
import { chromiumPath } from './lib/browser.mjs';

const URL = (process.env.BENCH_URL || 'http://127.0.0.1:8123/') + '?perf=1';
const PLACES = ['meadow', 'forest', 'beach', 'wetland', 'city'];
const HOURS = ['dawn', 'day', 'dusk', 'night'];
/* How much worse than Canvas 2D the GPU may be before this fails. A ratio with
   a floor, not an equality: short runs are already smooth and their ratios are
   noise. Tight enough that the missing dither — eight- to twenty-fold — could
   not have slipped through. */
const TOLERANCE = 1.6;
const FLOOR_PX = 6.0;
const SETTLE_FRAMES = 150;

const initScript = () => {
  let a = 0x9e3779b9;
  Math.random = function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
  window.__reseedRandom = () => { a = 0x9e3779b9; };
  // One clock for the app and the timestamps, advanced once per real frame, so
  // the clouds have drifted exactly as far in both backends when the shutter
  // falls. (The same trick, and the same reasons, as tools/trajectory.mjs.)
  const raf = window.requestAnimationFrame.bind(window);
  let virt = 0, lastReal = -1;
  performance.now = () => virt;
  window.__frameNo = 0;
  window.requestAnimationFrame = (cb) => raf((t) => {
    if (t !== lastReal) { lastReal = t; virt += 1000 / 60; window.__frameNo++; }
    return cb(virt);
  });
};

const hideGL = () => {
  const orig = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (t, ...r) {
    if (t === 'webgl2' || t === 'webgl') return null;
    return orig.call(this, t, ...r);
  };
};

/* Mean distance travelled along a line before the colour changes. */
function meanRun(series) {
  let changes = 0;
  for (let i = 1; i < series.length; i++) if (series[i] !== series[i - 1]) changes++;
  return series.length / (changes + 1);
}
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[s.length >> 1];
};

async function measure(browser, nogl) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  if (nogl) await page.addInitScript(hideGL);
  await page.addInitScript(initScript);
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.addStyleTag({ content: `
    .container { max-width: none !important; padding: 0 !important; }
    .window-frame { padding: 0 !important; border: none !important; }
    #scene { height: 100vh !important; }
  ` });
  await page.click('#settingsBtn');
  await page.waitForTimeout(250);
  if (await page.getAttribute('#timeFlowSwitch', 'aria-checked') === 'true') {
    await page.click('#timeFlowSwitch');
  }
  await page.click('#settingsClose');
  await page.click('#beginBtn');
  await page.waitForTimeout(800);
  if (!await page.evaluate(() => !!window.__lw)) throw new Error('no window.__lw — is ?perf=1 wired?');
  // The chrome would sit in the screenshot; the sky is the subject.
  await page.addStyleTag({ content:
    '.casement, .caption, .window-tools, .begin-overlay { display: none !important; }' });
  const onGL = await page.evaluate(() => !!document.getElementById('sky').getContext('webgl2'));
  if (onGL === nogl) throw new Error(`wanted ${nogl ? 'Canvas2D' : 'WebGL2'}, got the other`);

  const out = {};
  for (const place of PLACES) {
    for (const hour of HOURS) {
      await page.click('#settingsBtn');
      await page.waitForTimeout(150);
      await page.click(`#placeSeg button[data-val="${place}"]`);
      await page.click(`#timeSeg button[data-val="${hour}"]`);
      await page.click('#settingsClose');
      // Pin the sky: same seed, same clock, hour settled rather than fading.
      await page.evaluate((hr) => {
        const s = window.__lw.scene;
        window.__reseedRandom();
        s.reseed(window.__lw.state.seed);
        window.__reseedRandom();
        s.t = 0;
        s.clearLife();
        for (const ph of ['dawn', 'day', 'dusk', 'night']) s.timeMix[ph] = (ph === hr) ? 1 : 0;
        window.__mark = window.__frameNo;
      }, hour);
      await page.waitForFunction((n) => window.__frameNo - window.__mark >= n,
        SETTLE_FRAMES, { timeout: 60000 });

      // The composited stack, because two layers make one picture.
      const shot = await page.locator('.scene-stack').screenshot();
      out[`${place}/${hour}`] = await page.evaluate(async (b64) => {
        const img = new Image();
        await new Promise(r => { img.onload = r; img.src = 'data:image/png;base64,' + b64; });
        const cv = new OffscreenCanvas(img.width, img.height);
        const cx = cv.getContext('2d');
        cx.drawImage(img, 0, 0);
        const px = cx.getImageData(0, 0, img.width, img.height).data;
        const W = img.width, H = img.height;
        const at = (x, y) => px[((y | 0) * W + (x | 0)) * 4];   // red is enough
        const run = (a) => {
          let ch = 0;
          for (let i = 1; i < a.length; i++) if (a[i] !== a[i - 1]) ch++;
          return a.length / (ch + 1);
        };
        const top = 6, bot = Math.floor(H * 0.34);
        /* Down the sky: catches the top-to-bottom ramp. Forty columns spread
           across the frame, so one passing behind a cloud cannot dominate. */
        const cols = [];
        for (let k = 0; k < 40; k++) {
          const x = Math.floor(W * (0.02 + 0.96 * k / 39));
          const s = [];
          for (let y = top; y < bot; y++) s.push(at(x, y));
          cols.push(run(s));
        }
        /* Across the sky: catches the radial ramps, which is where the sun's and
           moon's halos and the cloud edges live. Thirty rows through the band
           that holds them, whichever hour it is. */
        const rows = [];
        for (let k = 0; k < 30; k++) {
          const y = Math.floor(top + (bot - top) * k / 29);
          const s = [];
          for (let x = Math.floor(W * 0.02); x < Math.floor(W * 0.98); x++) s.push(at(x, y));
          rows.push(run(s));
        }
        return { cols, rows };
      }, shot.toString('base64'));
    }
  }
  await page.close();
  if (errs.length) throw new Error('page error: ' + errs[0]);
  return out;
}

const browser = await chromium.launch({
  ...chromiumPath(), args: ['--use-gl=swiftshader']
});
const gl = await measure(browser, false);
const c2d = await measure(browser, true);
await browser.close();

console.log('                    down the sky            across the sky');
console.log('scene            GL med  2D med  ratio    GL med  2D med  ratio');
console.log('-'.repeat(68));
let failures = 0;
for (const key of Object.keys(gl)) {
  const cells = [];
  for (const band of ['cols', 'rows']) {
    const g = median(gl[key][band]), c = median(c2d[key][band]);
    const ratio = g / c;
    const bad = g > FLOOR_PX && ratio > TOLERANCE;
    if (bad) failures++;
    cells.push(`${g.toFixed(1).padStart(7)} ${c.toFixed(1).padStart(7)} ${(ratio.toFixed(2) + (bad ? ' !' : '  ')).padStart(8)}`);
  }
  console.log(`${key.padEnd(16)}${cells.join(' ')}`);
}
console.log('-'.repeat(68));
console.log(failures
  ? `\n${failures} band(s) materially worse on the GPU than on the canvas — marked !`
  : `\nthe GPU is within ${TOLERANCE}x of the canvas everywhere`);
process.exit(failures ? 1 : 0);
