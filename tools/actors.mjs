/* Drives every species that can take the stage through both halves of the
   actor split — updateActors and drawActors — including each way of leaving.

   This exists to cover a hole in tools/trajectory.mjs. Singers arrive only when
   the audio schedulers call for them, and the recorder has to silence those
   schedulers to be deterministic at all (they run on real timers and draw from
   the same Math.random stream the critters spawn from). So the recorder never
   sees a single actor, and a recording can come out byte-identical while
   drawActors is in fact broken — which is exactly what happened: `sing` was
   left behind in the update pass and every recording still matched.

   Here the actors are spawned directly through Scene.spawnForCall, the same
   entry point the audio engine uses, and then stepped long enough to enter,
   settle, sing, fidget, forage and leave. */
import { chromium } from 'playwright';
import { chromiumPath } from './lib/browser.mjs';
import { writeFileSync } from 'fs';

const URL = (process.env.BENCH_URL || 'http://127.0.0.1:8123/') + '?perf=1';

/* Optional second argument: a file to write every painter's arguments to, so two
   builds can be compared value for value and not merely for whether they threw.
   The recorder in tools/trajectory.mjs cannot do this — it silences the audio
   schedulers to be deterministic, and singers only arrive when audio calls for
   them, so no recording it makes contains a single bird on a perch. */
const LOG = process.argv[2] || null;

const browser = await chromium.launch({
  ...chromiumPath(), args: ['--use-gl=swiftshader']
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
// Seeded, because an actor's build — its scale, its plumpness, which way it
// looks and when — is drawn from Math.random at the moment it is spawned.
await page.addInitScript(() => {
  let a = 0x9e3779b9;
  Math.random = function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
  window.__reseedRandom = () => { a = 0x9e3779b9; };
});
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(e.message));
await page.goto(URL, { waitUntil: 'networkidle' });
await page.click('#beginBtn');
await page.waitForTimeout(1200);
if (!await page.evaluate(() => !!window.__lw)) throw new Error('no window.__lw — is ?perf=1 wired?');

/* Stop the voices. This tool spawns its own actors through spawnForCall, so it
   has no use for the schedulers — and they fire on real setTimeout, which means
   birds of their choosing would arrive on stage at moments that differ from run
   to run. Harmless when all we ask is whether anything threw; fatal once we
   start comparing recorded values. */
await page.evaluate(() => { window.__lw.audio.gen++; window.__lw.audio.running = false; });
await page.waitForTimeout(300);
await page.evaluate(() => {
  /* And stop the scene's own frame loop. This tool calls updateActors and
     drawActors itself, so the loop is not needed — and while it runs it paints
     whatever critters the land has spawned on its own timers, at a count that
     depends on how long the page happened to be open. */
  window.__lw.scene.setActive(false);
  window.__lw.scene.clearLife();
  /* Put the stream back to its seed. Between page load and this line the frame
     loop has been spawning critters, and every one of them drew from it — a
     count that depends on how long the page took to settle. Every bird built
     after this point is built from the same numbers on every run. */
  window.__reseedRandom();
});

if (LOG) {
  await page.evaluate(() => {
    const proto = Object.getPrototypeOf(window.__lw.scene);
    const q = (v) => typeof v === 'number' ? Math.round(v * 1e4) / 1e4
                   : typeof v === 'object' && v ? JSON.stringify(v, (k, x) =>
                       typeof x === 'number' ? Math.round(x * 1e4) / 1e4 : x)
                   : v;
    window.__paint = [];
    window.__armPaint = () => { window.__paint.length = 0; };
    for (const name of Object.getOwnPropertyNames(proto)) {
      if (!/^(paint|contactShadow|drawPerchFooting)/.test(name)) continue;
      if (typeof proto[name] !== 'function') continue;
      const orig = proto[name];
      proto[name] = function (...a) {
        window.__paint.push(name + ':' + a.slice(1).map(q).join(','));
        return orig.apply(this, a);
      };
    }
  });
}

if (LOG) await page.evaluate(() => window.__armPaint && window.__armPaint());

const results = await page.evaluate(async () => {
  const { scene: s, state } = window.__lw;
  const mod = await import('./js/species.js?v=7');
  const SPECIES = mod.SPECIES;
  const PHASES = ['dawn', 'day', 'dusk', 'night'];
  const out = [];

  const step = (frames) => {
    for (let f = 0; f < frames; f++) {
      s.updateActors(1 / 60);
      s.drawActors(s.ctx, s.W, s.H, s.skyColors()[1], s.nightness());
    }
  };

  for (const sp of SPECIES) {
    // Try each place, since the perch a species gets handed depends on the land
    // (a branch, a reed, a rooftop, a stone) and so does the code that paints it.
    for (const loc of ['meadow', 'forest', 'beach', 'wetland', 'city']) {
      for (const hour of ['dawn', 'night']) {
        state.location = loc;
        s.reseed(state.seed);
        for (const ph of PHASES) s.timeMix[ph] = (ph === hour) ? 1 : 0;
        s.clearLife();
        try {
          // enter → settle → sing → linger → leave, at several depths and both
          // facings, and with an entrance flight as well as a standing start
          for (const depth of [0, 6, 12]) {
            for (const x of [0.2, 0.8]) {
              for (const enter of [0, 0.9]) {
                s.spawnForCall(sp, x, 0.5, depth, 1.4, enter, null);
                step(40);
              }
            }
          }
          step(200);
          // force every exit the piece knows about, so each is painted
          for (const leave of ['fly','glide','dive','flush','walkoff','heronoff','sink','fade']) {
            for (const a of s.actors) {
              a.leave = leave; a.leaveT = 0;
              a.launchX = a.x; a.launchY = a.y; a.flyDir = a.flip ? -1 : 1;
            }
            step(60);
            if (!s.actors.length) {
              s.spawnForCall(sp, 0.5, 0.5, 4, 1.2, 0, null);
              step(20);
            }
          }
          step(400);
        } catch (e) {
          out.push({ id: sp.id, where: `${loc}/${hour}`, err: e.message });
        }
      }
    }
  }
  return out;
});

if (LOG) {
  const paint = await page.evaluate(() => window.__paint);
  writeFileSync(LOG, paint.join('\n'));
  console.log(`  recorded ${paint.length} painter calls to ${LOG}`);
}
await browser.close();
const seen = new Set();
for (const r of results) {
  const key = r.id + r.err;
  if (seen.has(key)) continue;
  seen.add(key);
  console.log(`  ${r.id.padEnd(14)} @${r.where.padEnd(14)} THREW: ${r.err}`);
}
if (pageErrors.length) console.log('\npage errors:\n  ' + pageErrors.slice(0, 5).join('\n  '));
const bad = seen.size + pageErrors.length;
console.log(bad ? `\n${bad} failing` : '\nevery species and every exit clean');
process.exit(bad ? 1 : 0);
