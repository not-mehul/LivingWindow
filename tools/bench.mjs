/* Measures The Living Window from outside the app: patches the 2D context
   prototype before any page script runs, so baseline and optimized builds are
   instrumented identically. Reports frame time and rasterization submissions
   per frame, per location. */
import { chromium } from 'playwright';

const URL_BASE = process.env.BENCH_URL || 'http://127.0.0.1:8123/';
const LABEL = process.argv[2] || 'run';
const W = +(process.env.BENCH_W || 1920);
const H = +(process.env.BENCH_H || 1080);
const PLACES = ['meadow', 'forest', 'beach', 'wetland', 'city'];
const SETTLE_MS = 2500;
const SAMPLE_MS = 6000;

const initScript = () => {
  window.__ops = 0;
  window.__frames = [];
  window.__opsPerFrame = [];
  window.__drawMs = [];
  const P = CanvasRenderingContext2D.prototype;
  for (const m of ['stroke', 'fill', 'fillRect', 'strokeRect', 'drawImage', 'fillText', 'clearRect']) {
    const orig = P[m];
    P[m] = function (...a) { window.__ops++; return orig.apply(this, a); };
  }
  // Hand the app a synthetic 60 fps clock. Scene.adaptQuality watches the dt it
  // is given and steps the render scale down when frames run late; under a real
  // clock in a software rasterizer it settles at a different scale for every
  // scene, so no two measurements share a canvas size and none of them can be
  // compared. A fixed dt holds quality at 1.0 and makes the animation itself
  // deterministic. Wall-clock cost is measured separately, below.
  const raf = window.requestAnimationFrame.bind(window);
  let last = 0, virt = 0;
  window.requestAnimationFrame = (cb) => raf((t) => {
    virt += 1000 / 60;
    window.__ops = 0;
    const t0 = performance.now();
    const r = cb(virt);
    // rAF interval alone only reports the vsync cadence — it is flat at 33 ms
    // whatever the scene costs. Time the callback instead, and force the
    // drawing actually to land by reading a pixel back, so the number includes
    // rasterization and not merely the submitting of it.
    const cv = document.getElementById('scene');
    if (cv) { try { cv.getContext('2d').getImageData(0, 0, 1, 1); } catch (e) {} }
    // The sky is on its own canvas now, and reading a pixel back from the 2D
    // one does nothing to make the GL one finish. Without this the sky layer
    // would appear to cost nothing at all, which would be a flattering lie.
    const sk = document.getElementById('sky');
    if (sk) { try { const g = sk.getContext('webgl2'); if (g) g.finish(); } catch (e) {} }
    window.__drawMs.push(performance.now() - t0);
    window.__opsPerFrame.push(window.__ops);
    if (last) window.__frames.push(t - last);
    last = t;
    if (window.__drawMs.length > 4000) {
      window.__drawMs.shift(); window.__opsPerFrame.shift(); window.__frames.shift();
    }
    return r;
  });
};

const stats = (a) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(s.length * p))];
  return {
    n: s.length,
    median: +q(0.5).toFixed(2),
    p95: +q(0.95).toFixed(2),
    mean: +(s.reduce((x, y) => x + y, 0) / s.length).toFixed(2)
  };
};

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--autoplay-policy=no-user-gesture-required', '--enable-gpu', '--use-gl=swiftshader']
});
const page = await browser.newPage({ viewport: { width: W, height: H } });
await page.addInitScript(initScript);
await page.goto(URL_BASE, { waitUntil: 'networkidle' });

// Stand in for fullscreen: the canvas is height:min(56vh,520px) inside an
// 880px container until the window-frame goes :fullscreen. It is the big
// canvas we care about, so take both limits off.
await page.addStyleTag({ content: `
  .container { max-width: none !important; padding: 0 !important; }
  .window-frame { padding: 0 !important; border: none !important; }
  #scene { height: 100vh !important; }
` });

await page.click('#beginBtn');
await page.waitForTimeout(1200);

// Hold the hour still — a drifting sky misses the gradient cache every frame
// and adds variance that has nothing to do with what is being compared.
await page.click('#settingsBtn');
await page.waitForTimeout(300);
if (await page.getAttribute('#timeFlowSwitch', 'aria-checked') === 'true') {
  await page.click('#timeFlowSwitch');
}
await page.click('#settingsClose');
await page.waitForTimeout(400);

const results = {};
for (const place of PLACES) {
  await page.click('#settingsBtn');
  await page.waitForTimeout(250);
  await page.click(`#placeSeg button[data-val="${place}"]`);
  await page.click('#settingsClose');
  await page.waitForTimeout(SETTLE_MS);

  await page.evaluate(() => {
    window.__frames.length = 0; window.__opsPerFrame.length = 0; window.__drawMs.length = 0;
  });
  await page.waitForTimeout(SAMPLE_MS);

  const { drawMs, ops, canvas } = await page.evaluate(() => ({
    drawMs: window.__drawMs.slice(),
    ops: window.__opsPerFrame.slice(),
    canvas: (() => { const c = document.getElementById('scene'); return `${c.width}x${c.height}`; })()
  }));
  results[place] = { drawMs: stats(drawMs), opsPerFrame: stats(ops), canvas };
  console.error(`  ${place.padEnd(8)} ${String(results[place].drawMs?.median).padStart(6)} ms   ${String(results[place].opsPerFrame?.median).padStart(5)} ops   ${canvas}`);
}

await browser.close();
console.log(JSON.stringify({ label: LABEL, viewport: `${W}x${H}`, results }, null, 2));
