/* Every voice in the catalogue, rendered offline and taken apart.

   The mix harness says how loud a call is against the room; the texture
   harness says whether a *bed* is granular or static. Neither says anything
   about whether a voice sounds like an animal, which is the one thing a
   listener actually judges it on — and for a long time nothing did.

   The measurements themselves live in `tools/lib/dsp.js`, shared with
   `texture.mjs` and with `reference.mjs`, which runs them over real field
   recordings. That sharing is the whole point: a number here is only worth
   having because the same number can be taken off the world and compared.

     harmonics  the share of *harmonic* energy not in the fundamental, summed
                at k·f0 only so background does not count toward it. A pure
                sine reads near 0; a reedy passerine reads 0.3 – 0.6.
     breath     the share of the frame that is at no harmonic at all.
     wobble     scatter of the fundamental about its own trend, per cent.
                Detrended, so an intentional glide is not read as vibrato.
     attack     seconds from -30 dB to peak — only where the call is isolated.
     a/d        attack over decay. Equal rates read 1.0 and sound like a fader.
     crest      peak over rms: how pointed the whole call is.

   The numbers are printed, not asserted. This is a bench, not a gate — the
   right value for a wood pigeon is not the right value for a magpie. What it
   is for is telling a catalogue of sines apart from a catalogue of voices at
   a glance, and seeing which way a change moved things.

     node tools/voice.mjs             # everything
     node tools/voice.mjs owl crow    # just these */
import { chromium } from 'playwright';
import { chromiumPath } from './lib/browser.mjs';

const ONLY = process.argv.slice(2).filter(a => !a.startsWith('-'));
const URL = (process.env.BENCH_URL || 'http://127.0.0.1:8123/') + '?hook=1';
const b = await chromium.launch({ ...chromiumPath(), args: ['--use-gl=swiftshader', '--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
const page = await b.newPage({ viewport: { width: 900, height: 560 } });
const errs = [];
page.on('pageerror', e => errs.push(e.message));
await page.goto(URL, { waitUntil: 'networkidle' });

const rows = await page.evaluate(async (ONLY) => {
  const D = await import('/tools/lib/dsp.js?v=24');
  const { SPECIES, CRITTER_VOICES } = await import('/js/species.js?v=24');
  // the mammals live in their own table and had gone unmeasured entirely
  const ALL = SPECIES.concat(Object.values(CRITTER_VOICES));
  const SR = 48000;
  const out = [];

  /* One call, rendered on its own into eight seconds of silence, on a fixed
     seed so a re-run compares like with like. */
  const render = async (sp, seed) => {
    const oc = new OfflineAudioContext(1, SR*8, SR);
    let a = seed >>> 0;
    const r = () => { a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296; };
    sp.synth(oc, oc.destination, 0.05, r);
    return (await oc.startRendering()).getChannelData(0);
  };

  for (const sp of ALL) {
    if (ONLY.length && !ONLY.includes(sp.id)) continue;
    const got = [];
    for (const seed of [1, 7, 19, 31]) {
      let m = null;
      try { m = D.voiceMetrics(await render(sp, seed), SR); } catch (e) { /* skip */ }
      if (m) got.push(m);
    }
    if (!got.length) { out.push({ id: sp.id, silent: true }); continue; }
    const pick = k => D.median(got.map(g => g[k]).filter(x => typeof x === 'number' && isFinite(x)));
    out.push({ id: sp.id, layer: sp.layer, harmonics: pick('harmonics'),
      breath: pick('breath'), wobble: pick('wobble'), attack: pick('attack'),
      ad: pick('ad'), crest: pick('crest') });
  }
  return out;
}, ONLY);
await b.close();

const f = (x, d, w) => (x === null || x === undefined ? '—' : x.toFixed(d)).padStart(w);
console.log('  ' + 'voice'.padEnd(14) + 'layer'.padEnd(7)
  + 'harmonics   breath  wobble%   attack    a/d   crest');
let flat = 0, n = 0;
for (const r of rows) {
  if (r.silent) { console.log(`  ${r.id.padEnd(14)} — rendered nothing`); continue; }
  n++;
  /* "A sine" means a bare tone with nothing else in it. A voice built out of
     band-passed noise — a squirrel's chatter, a cricket — has no harmonic
     structure to measure and would be libelled by that test, so the breath
     column has to be low too before the charge sticks. A genuinely near-pure
     whistle (a swift, an otter) is left to speak for itself in the numbers. */
  const sine = r.harmonics !== null && r.harmonics < 0.03
    && r.breath !== null && r.breath < 0.30;
  if (sine) flat++;
  console.log(`  ${r.id.padEnd(14)}${String(r.layer || '').padEnd(7)}`
    + f(r.harmonics, 3, 9) + f(r.breath, 3, 9)
    + f(r.wobble === null ? null : r.wobble*100, 2, 9)
    + f(r.attack, 4, 9) + f(r.ad, 2, 7) + f(r.crest, 1, 8)
    + (sine ? '  <- a sine' : ''));
}
console.log(`\n  ${flat} of ${n} carry essentially nothing above the fundamental`);
console.log('  (compare against real recordings with: node tools/reference.mjs)');
if (errs.length) console.log('\n  ERRORS:\n    ' + errs.slice(0, 5).join('\n    '));
