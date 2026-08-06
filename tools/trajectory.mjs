/* Records the trajectory of every living thing in the scene: not what it
   looked like, but what it was — position, state, timers, phase — sampled
   every frame for a fixed number of frames.

   This is the test that matters for splitting update from render. Pixels
   cannot see whether a deer still decides to stop grazing on the same tick;
   the deer can. If two builds produce identical trajectories, the update
   logic came through untouched, whatever happened to the drawing. */
import { chromium } from 'playwright';
import { chromiumPath } from './lib/browser.mjs';
import { writeFileSync, mkdirSync } from 'fs';

const OUT = process.argv[2];   // e.g. node tools/trajectory.mjs before/
const FRAMES = +(process.env.TRAJ_FRAMES || 900);
const PLACES = ['meadow', 'forest', 'beach', 'wetland', 'city'];
mkdirSync(OUT, { recursive: true });

const initScript = () => {
  let a = 0x9e3779b9;
  Math.random = function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
  window.__reseedRandom = () => { a = 0x9e3779b9; };
  const raf = window.requestAnimationFrame.bind(window);
  let virt = 0, lastReal = -1, lastLoggedT = null;
  performance.now = () => virt;
  window.__frameNo = 0;
  window.__log = [];
  /* Rewinding the scene has to happen on a frame boundary, not whenever an
     evaluate() happens to land. Dropped in mid-frame it lands before or after
     that frame's callback depending on the wind, and the recording then begins
     one frame early or late — which shifts this.t by a sixtieth for the whole
     run and, since nearly every motion is a sine of it, changes every number
     downstream. So the harness asks, and the wrapper performs it here. */
  window.__resetPending = false;
  window.__doReset = () => {
    const s = window.__lw.scene;
    window.__reseedRandom();
    s.reseed(window.__lw.state.seed);
    window.__reseedRandom();
    s.t = 0;
    s.mistX = 0;
    s.clearLife();
    for (const k of Object.keys(s)) if (/^last[A-Z]/.test(k)) s[k] = -999;
    for (const ph of ['dawn', 'day', 'dusk', 'night']) {
      s.timeMix[ph] = (window.__lw.state.time === ph) ? 1 : 0;
    }
    lastLoggedT = null;
    window.__log = []; window.__paint = []; window.__recording = true;
  };

  window.requestAnimationFrame = (cb) => raf((t) => {
    if (t !== lastReal) { lastReal = t; virt += 1000 / 60; window.__frameNo++; }
    if (window.__resetPending && window.__lw) {
      window.__resetPending = false;
      window.__doReset();
    }
    const r = cb(virt);
    const lw = window.__lw;
    /* One entry per simulation step, not per callback. This wrapper sees every
       rAF anybody registers — the scene's, and Playwright's own waitForFunction,
       which polls on rAF — so logging unconditionally recorded some frames twice
       and left two runs misaligned by an entry for no reason of their own.
       Keying on the scene's own clock ties each line to one step of the world. */
    if (lw && window.__recording && lw.scene.t !== lastLoggedT) {
      const s = lw.scene;
      lastLoggedT = s.t;
      // Round hard: these are floats accumulated in a slightly different order
      // after the refactor, and the question is whether the behaviour matches,
      // not whether the last bit of a double does.
      const q = (v) => (typeof v === 'number' ? Math.round(v * 1e4) / 1e4
                     : typeof v === 'boolean' ? (v ? 1 : 0) : v);
      const dump = (arr, keys) => arr.map(o => keys.map(k => q(o[k])).join(','));
      window.__log.push([
        Math.round(s.t * 1e4) / 1e4,
        dump(s.critters, ['kind','x','y','z','t','state','mode','timer','dir','head','lp','bp','cycles','vx','vy','turn','life','sz','ph','drift']).join('|'),
        dump(s.actors,   ['id','x','y','t','alpha','leave','leaveT','beh','restX','restY','act','actT','linger','dur']).join('|'),
        dump(s.flyers,   ['kind','x','y','ph','vx','hold','age','ang','size']).join('|'),
        dump(s.ripples,  ['x','y','age']).join('|'),
        dump(s.meteors,  ['x','y','age']).join('|')
      ].join('§'));
      /* Stop on the exact frame, in here rather than from outside. Waiting for
         the count to reach its mark and then switching off over the wire lets
         however many frames run in the meantime slip into the log, so two runs
         end up different lengths for no reason of their own. */
      if (window.__log.length >= (window.__frameTarget || 0)) window.__recording = false;
    }
    return r;
  });
};

const browser = await chromium.launch({
  ...chromiumPath(), args: ['--use-gl=swiftshader']
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
/* Say so, loudly. A throw inside frame() breaks the rAF chain and the world
   simply stops; without this the only symptom is the recording quietly failing
   to fill, and the timeout that follows says nothing about why. */
const pageErrors = [];
page.on('pageerror', e => {
  pageErrors.push(e.message);
  console.error('  PAGEERROR: ' + (e.stack || e.message).split('\n').slice(0, 4).join('\n     '));
});
await page.addInitScript(initScript);
await page.goto((process.env.BENCH_URL || 'http://127.0.0.1:8123/') + '?perf=1',
  { waitUntil: 'networkidle' });
await page.addStyleTag({ content: `
  .container { max-width: none !important; padding: 0 !important; }
  #scene { height: 100vh !important; }
` });
await page.waitForTimeout(400);

await page.click('#settingsBtn');
await page.waitForTimeout(200);
if (await page.getAttribute('#timeFlowSwitch', 'aria-checked') === 'true') {
  await page.click('#timeFlowSwitch');
}
for (const id of ['#activitySlider', '#volumeSlider']) {
  await page.$eval(id, el => {
    el.value = el.min || 0;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
await page.click('#settingsClose');
await page.waitForTimeout(200);
await page.click('#beginBtn');
await page.waitForTimeout(600);

if (!await page.evaluate(() => !!window.__lw)) throw new Error('no window.__lw — is ?perf=1 wired?');

/* Silence the voices for good. Every scheduler in audio.js is stamped with a
   generation and gives up the moment the stamp moves, so bumping it once stops
   the lot. They run on real setTimeout, which the synthetic clock does not
   govern, and each firing draws from the same Math.random stream the critters
   spawn from — so left running they walk the seeded stream forward by a
   different amount on every run, and no two recordings can agree. */
await page.evaluate(() => { window.__lw.audio.gen++; window.__lw.audio.running = false; });
await page.waitForTimeout(400);

/* Record what every painter is asked to draw, not just what the entities are.
   Splitting update from render moves a great many derived values — how far
   through its flight a bird is, how deep its crouch, how wide its wings are
   flared — across the boundary, and those are invisible to a state dump and
   lost in the noise of a pixel diff. The arguments handed to paintBird are
   exactly the quantity in question, so record those. */
await page.evaluate(() => {
  const proto = Object.getPrototypeOf(window.__lw.scene);
  const q = (v) => typeof v === 'number' ? Math.round(v * 1e3) / 1e3
                 : typeof v === 'object' && v ? JSON.stringify(v, (k, x) =>
                     typeof x === 'number' ? Math.round(x * 1e3) / 1e3 : x)
                 : v;
  window.__paint = [];
  for (const name of Object.getOwnPropertyNames(proto)) {
    if (!/^(paint|contactShadow|drawPerchFooting|drawGlow)/.test(name)) continue;
    if (typeof proto[name] !== 'function') continue;
    const orig = proto[name];
    proto[name] = function (...a) {
      if (window.__recording) {
        // arg 0 is the drawing context; everything after it is the picture
        window.__paint.push(name + ':' + a.slice(1).map(q).join(','));
      }
      return orig.apply(this, a);
    };
  }
});

for (const place of PLACES) {
  for (const hour of ['dawn', 'night']) {
    await page.click('#settingsBtn');
    await page.waitForTimeout(150);
    await page.click(`#placeSeg button[data-val="${place}"]`);
    await page.click(`#timeSeg button[data-val="${hour}"]`);
    await page.click('#settingsClose');
    await page.waitForTimeout(300);

    /* Ask for the rewind, and let the frame loop perform it (see __doReset).
       clearLife() empties the stage but deliberately leaves the weather and the
       scenery alone: fireflies, motes, clouds, sky birds, rain, dapples, leaves,
       cattle and lit windows all belong to the land, are built in reseed, and go
       on drifting from the moment the page loaded. reseed() rebuilds every one
       of those arrays, from mulberry32 rather than Math.random, so one call puts
       the whole landscape back to a known state. */
    await page.evaluate((n) => {
      window.__frameTarget = n;
      window.__resetPending = true;
    }, FRAMES);
    // Both halves matter: the rewind must have happened (so this is not the
    // previous scene's finished log being mistaken for this one's) and the new
    // log must have filled to its mark.
    await page.waitForFunction(
      () => window.__resetPending === false && window.__log.length >= window.__frameTarget,
      null, { timeout: 120000 });
    const log = await page.evaluate(() => window.__log.slice());
    const paint = await page.evaluate(() => window.__paint.slice());
    writeFileSync(`${OUT}/${place}-${hour}.txt`, log.join('\n'));
    writeFileSync(`${OUT}/${place}-${hour}.paint.txt`, paint.join('\n'));
    const live = log[log.length - 1].split('§').slice(1).filter(s => s).length;
    console.error(`  ${place}-${hour}: ${log.length} frames, ${live} pools, ${paint.length} paint calls`);
  }
}
await browser.close();
if (pageErrors.length) {
  console.error(`\n${pageErrors.length} page error(s) — the recording cannot be trusted.`);
  process.exit(1);
}
