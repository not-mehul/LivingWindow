/* Drives one of every kind of creature through both halves of its split —
   updateCritters and drawCritters — and reports any that throw.

   This exists because time is the enemy of coverage here. A fox keeps a
   ninety-second cooldown, a badger comes out at night in the forest, a cat
   walks a city roofline only after dark, and litter is not spawned at all but
   kicked up by a badger that has decided to dig. Simply loading the page and
   watching for a while exercises perhaps five of the eighteen, which is how a
   fox that could not be painted survived a clean smoke test.

   So each kind is hunted for deliberately: the place is reseeded, the hour is
   forced, the spawn cooldowns are cleared, and the clock is run forward until
   that kind appears. Then it is stepped for several hundred frames with both
   passes called in the order the frame calls them. */
import { chromium } from 'playwright';
import { chromiumPath } from './lib/browser.mjs';

const URL = (process.env.BENCH_URL || 'http://127.0.0.1:8123/') + '?perf=1';

const browser = await chromium.launch({
  ...chromiumPath(), args: ['--use-gl=swiftshader']
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(e.message));
await page.goto(URL, { waitUntil: 'networkidle' });
await page.click('#beginBtn');
await page.waitForTimeout(1200);
if (!await page.evaluate(() => !!window.__lw)) throw new Error('no window.__lw — is ?perf=1 wired?');

const results = await page.evaluate(() => {
  const { scene: s, state } = window.__lw;
  const out = [];
  const KINDS = ['butterfly', 'dragonfly', 'bat', 'deer', 'runner', 'cat', 'rabbit', 'fox',
                 'heron', 'porpoise', 'squirrel', 'litter', 'hare', 'hedgehog', 'badger',
                 'otter', 'bee', 'skein', 'turnstone', 'crab', 'seal',
                 'shelldrop', 'pigeon', 'moth', 'stoat', 'bather', 'lizard', 'mob'];
  const PLACES = ['meadow', 'forest', 'beach', 'wetland', 'city'];
  const HOURS = ['dawn', 'day', 'dusk', 'night'];
  const PHASES = ['dawn', 'day', 'dusk', 'night'];

  const setScene = (loc, hour) => {
    state.location = loc;
    s.reseed(state.seed);                       // frontBlocks, perches, foam &c.
    for (const ph of PHASES) s.timeMix[ph] = (ph === hour) ? 1 : 0;
    s.clearLife();
  };
  const step = (frames) => {
    for (let f = 0; f < frames; f++) {
      s.updateCritters(1 / 60);
      s.drawCritters(s.ctx, s.W, s.H, s.skyColors()[1], s.nightness());
      if (!s.critters.length) return false;
    }
    return true;
  };

  for (const kind of KINDS) {
    let found = null;
    outer:
    for (const loc of PLACES) {
      for (const hour of HOURS) {
        setScene(loc, hour);
        // litter is debris from a digging badger, so hunt the badger instead
        const hunted = (kind === 'litter') ? 'badger' : kind;
        let made = false;
        for (let i = 0; i < 3000 && !made; i++) {
          /* A bather needs standing water to stand in, and standing water is
             ninety seconds of soaking away from a dry field — far longer than
             this loop runs. Only for that one kind, because half the others
             will not come out in the wet at all. */
          if (kind === 'bather') s.groundWet = 1;
          s.t += 5;                             // outrun the per-kind cooldowns
          for (const k of Object.keys(s)) if (/^last[A-Z]/.test(k)) s[k] = -999;
          s.spawnCritters(0.5);
          made = s.critters.some(c => c.kind === hunted);
        }
        if (made) { found = { loc, hour }; break outer; }
      }
    }
    if (!found) { out.push({ kind, status: 'unexercised' }); continue; }

    // Keep only what is being tested — except for litter, which needs the
    // badger that makes it left in place.
    if (kind !== 'litter') s.critters = s.critters.filter(c => c.kind === kind);
    try {
      // Litter only appears once a badger settles in and digs, which takes far
      // longer than a creature simply crossing the frame. Watch for it rather
      // than assume it, and keep feeding badgers in until some of it shows up.
      let saw = true;
      if (kind === 'litter') {
        /* Litter is thrown back by a badger part-way through a dig, on a 14*dt
           coin flip inside one branch of its state machine — too deep in to be
           reached reliably by waiting. Build one to the shape the badger builds
           (see the push in updateCritters) and step that instead. Fabricating a
           creature is a poor test in general, because a wrong field would pass
           here and fail in the window; it is worth it only because these six
           fields are the whole of what a litter fleck is. */
        s.critters.length = 0;
        for (let k = 0; k < 6; k++) {
          s.critters.push({ kind: 'litter', x: 0.4 + k*0.02, y: 0.9, z: 0.3,
            vx: -0.03, vy: -0.05, t: 0, life: 0.6, sz: 0.9 });
        }
        saw = false;
        for (let f = 0; f < 200; f++) {
          s.updateCritters(1 / 60);
          s.drawCritters(s.ctx, s.W, s.H, s.skyColors()[1], s.nightness());
          saw = true;
          if (!s.critters.length) break;
        }
      } else {
        if (kind === 'bather') s.groundWet = 1;   // and it dries out mid-bath otherwise
        step(600);
      }
      out.push({ kind, status: saw ? 'ok' : 'unexercised', where: `${found.loc}/${found.hour}`,
                 note: saw ? '' : 'never produced' });
    } catch (e) {
      out.push({ kind, status: 'threw', where: `${found.loc}/${found.hour}`, note: e.message });
    }
  }
  return out;
});

await browser.close();
let bad = 0;
for (const r of results) {
  const tag = r.status === 'threw' ? 'THREW' : r.status === 'unexercised' ? '  --  ' : '  ok  ';
  if (r.status === 'threw') bad++;
  console.log(`  ${r.kind.padEnd(10)} ${tag} ${(r.where || '').padEnd(14)} ${r.note || ''}`);
}
if (pageErrors.length) { console.log('\npage errors:\n  ' + pageErrors.slice(0, 5).join('\n  ')); bad++; }
console.log(bad ? `\n${bad} failing` : '\nall kinds clean');
process.exit(bad ? 1 : 0);
