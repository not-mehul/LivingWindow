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

const URL = (process.env.BENCH_URL || 'http://127.0.0.1:8123/') + '?perf=1';

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader']
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(e.message));
await page.goto(URL, { waitUntil: 'networkidle' });
await page.click('#beginBtn');
await page.waitForTimeout(1200);
if (!await page.evaluate(() => !!window.__lw)) throw new Error('no window.__lw — is ?perf=1 wired?');

const results = await page.evaluate(async () => {
  const { scene: s, state } = window.__lw;
  const mod = await import('./js/species.js?v=4');
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
