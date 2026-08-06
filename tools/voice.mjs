/* Every voice in the catalogue, rendered offline and taken apart.

   The mix harness says how loud a call is against the room; the texture
   harness says whether a *bed* is granular or static. Neither says anything
   about whether a voice sounds like an animal, which is the one thing a
   listener actually judges it on — and up to now nothing did.

   What a real animal voice has, and a naive synthesised one does not:

   1. **Partials.** A bird is a whistle with a body behind it. Even the
      "purest" flute notes — a blackbird's, a wood pigeon's — carry a second
      and third partial. A single sine oscillator carries none, and that is
      the sound everybody recognises instantly as a synthesiser.
   2. **Movement inside a note.** A held note is never held: it wavers a few
      per cent, and the waver is not a clean sine either.
   3. **An attack and a decay that are not the same shape.** A voice starts
      faster than it stops.
   4. **Breath.** Air going through a syrinx is not silent.

   So: render each call into an OfflineAudioContext, and measure

     partials    energy above the fundamental, as a fraction of the whole.
                 A pure sine reads ~0.00. A real bird is 0.15 – 0.6.
     wobble      how much the dominant frequency moves inside one note, in
                 per cent — measured over frames well inside the note so an
                 onset glide is not counted as vibrato.
     attack      seconds from -30 dB to peak.
     a/d         attack over decay. A voice that starts and stops at the same
                 rate reads 1.0 and sounds like a fader.
     crest       peak over rms: how pointed the whole call is.

   The numbers are printed, not asserted. This is a bench, not a gate — the
   right value for a wood pigeon is not the right value for a magpie. What it
   is for is telling a whole catalogue of sines apart from a catalogue of
   voices at a glance, and seeing which way a change moved things. */
import { chromium } from 'playwright';

const ONLY = process.argv.slice(2).filter(a => !a.startsWith('-'));
const URL = (process.env.BENCH_URL || 'http://127.0.0.1:8123/') + '?hook=1';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=swiftshader', '--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
const page = await b.newPage({ viewport: { width: 900, height: 560 } });
const errs = [];
page.on('pageerror', e => errs.push(e.message));
await page.goto(URL, { waitUntil: 'networkidle' });

const rows = await page.evaluate(async (ONLY) => {
  const { SPECIES, CRITTER_VOICES } = await import('/js/species.js?v=20');
  // The mammals live in their own table and had never been measured at all
  const ALL = SPECIES.concat(Object.values(CRITTER_VOICES));
  const SR = 48000;
  const out = [];

  /* One species, rendered on its own into eight seconds of silence. The
     seeded rng is the same every time so a re-run compares like with like. */
  const render = async (sp, seed) => {
    const oc = new OfflineAudioContext(1, SR*8, SR);
    let a = seed >>> 0;
    const r = () => { a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296; };
    sp.synth(oc, oc.destination, 0.05, r);
    const buf = await oc.startRendering();
    return buf.getChannelData(0);
  };

  const rms = (d, i0, i1) => {
    let s = 0; for (let i = i0; i < i1; i++) s += d[i]*d[i];
    return Math.sqrt(s/Math.max(1, i1 - i0));
  };

  /* The envelope, as the running peak over a hop of a hundred and twenty-eight
     samples. Walking the raw samples for an attack time does not work and the
     way it fails is silent: a sine passes through zero every half cycle, so a
     backward walk from the peak "while the sample is loud" stops at the first
     zero crossing and every voice in the catalogue reports an attack of half a
     millisecond. Which is what the first run of this tool said, and it was
     measuring the waveform, not the note. */
  const HOP = 128;
  const envelope = (d) => {
    const e = new Float64Array(Math.ceil(d.length/HOP));
    for (let i = 0; i < e.length; i++) {
      let m = 0;
      const end = Math.min(d.length, (i + 1)*HOP);
      for (let j = i*HOP; j < end; j++) { const v = Math.abs(d[j]); if (v > m) m = v; }
      e[i] = m;
    }
    return e;
  };

  /* A Goertzel-free, allocation-heavy but perfectly adequate DFT over a
     Hann-windowed frame. N is small and this runs once per frame of one
     call, so clarity beats speed. */
  const spectrum = (d, at, N) => {
    const re = new Float64Array(N/2), im = new Float64Array(N/2);
    for (let k = 1; k < N/2; k++) {
      let sr = 0, si = 0;
      for (let n = 0; n < N; n++) {
        const w = 0.5 - 0.5*Math.cos(2*Math.PI*n/(N - 1));
        const v = (d[at + n] || 0)*w;
        const th = -2*Math.PI*k*n/N;
        sr += v*Math.cos(th); si += v*Math.sin(th);
      }
      re[k] = sr; im[k] = si;
    }
    const mag = new Float64Array(N/2);
    for (let k = 1; k < N/2; k++) mag[k] = Math.hypot(re[k], im[k]);
    return mag;
  };

  for (const sp of ALL) {
    if (ONLY.length && !ONLY.includes(sp.id)) continue;
    let partials = 0, wobble = 0, crest = 0, atk = 0, ad = 0, n = 0, wn = 0, pn = 0;
    for (const seed of [1, 7, 19]) {
      let d;
      try { d = await render(sp, seed); } catch (e) { continue; }
      // where the call actually is
      let pk = 0, pkAt = 0;
      for (let i = 0; i < d.length; i++) {
        const v = Math.abs(d[i]);
        if (v > pk) { pk = v; pkAt = i; }
      }
      if (pk < 1e-4) continue;
      let i0 = 0, i1 = d.length - 1;
      const gate = pk*0.03;
      while (i0 < d.length && Math.abs(d[i0]) < gate) i0++;
      while (i1 > i0 && Math.abs(d[i1]) < gate) i1--;
      if (i1 - i0 < 512) continue;
      const rr = rms(d, i0, i1);
      crest += pk/Math.max(1e-9, rr);

      /* Attack and decay, off the envelope. -30 dB of the peak either side,
         which is where a listener hears a note begin and end. */
      const env = envelope(d);
      const ePk = Math.round(pkAt/HOP);
      const lo = pk*0.0316;
      let a0 = ePk; while (a0 > 0 && env[a0] > lo) a0--;
      let d1 = ePk; while (d1 < env.length - 1 && env[d1] > lo) d1++;
      const ta = (ePk - a0)*HOP/SR, td = (d1 - ePk)*HOP/SR;
      atk += ta;
      ad += ta/Math.max(1e-4, td);

      /* Partials and wobble, over a run of frames stepped across the loudest
         note. Both readings come off the same frames, and the run has to be
         long enough to hold whole cycles of a five-hertz waver — the first
         version of this took three frames twenty-four milliseconds apart,
         which is an eighth of one vibrato cycle, and reported that every
         voice in the catalogue was dead steady. It was measuring nothing. */
      const N = 2048, HOPF = N/4;
      const fr = [];
      for (let at = Math.max(0, pkAt - N); at < Math.min(d.length - N - 1, pkAt + SR*0.30);
           at += HOPF) {
        // stay inside the note: leave when the envelope drops away
        const ei = Math.round((at + N/2)/HOP);
        if (!(env[ei] > pk*0.30)) continue;
        const mag = spectrum(d, at, N);
        let top = 0, topK = 1, tot = 0;
        for (let k = 1; k < N/2; k++) { tot += mag[k]*mag[k];
          if (mag[k] > top) { top = mag[k]; topK = k; } }
        if (top <= 0 || topK < 2 || topK >= N/2 - 1) continue;
        /* Everything that is not within a couple of bins of the dominant
           partial. For a sine that is the analysis window's own skirt and
           nothing else. */
        let above = 0;
        for (let k = 1; k < N/2; k++) {
          if (Math.abs(k - topK) <= 3) continue;
          above += mag[k]*mag[k];
        }
        /* Sub-bin frequency, by fitting a parabola to the peak and its two
           neighbours. Without it the estimate is quantised to 23 Hz, and a
           held note wavering by seven cents at 400 Hz moves a fourteenth of
           one bin — so the tool reported dead-steady zeros for exactly the
           voices whose waver it was built to find. */
        const l = Math.log(Math.max(1e-30, mag[topK - 1]));
        const m0 = Math.log(Math.max(1e-30, mag[topK]));
        const rgt = Math.log(Math.max(1e-30, mag[topK + 1]));
        const den2 = l - 2*m0 + rgt;
        const shift = den2 !== 0 ? 0.5*(l - rgt)/den2 : 0;
        fr.push({ t: (at + N/2)/SR, f: (topK + Math.max(-0.5, Math.min(0.5, shift)))*SR/N,
          p: above/Math.max(1e-12, tot) });
      }
      /* Counted separately: a call too short to yield two analysis frames — a
         cricket's stridulation, a woodpecker's drum — has no partial reading
         at all, and averaging that over the number of *renders* silently
         divided a real number by three and reported band-passed noise as a
         pure sine. */
      if (fr.length >= 2) { partials += fr.reduce((s, x) => s + x.p, 0)/fr.length; pn++; }
      /* A glide is not a waver. Most notes here sweep from f0 to f1 on
         purpose, and the raw spread of the frequency track is mostly that
         sweep. So fit a line through the track and take the scatter about
         it: what is left is the part that is not going anywhere. */
      if (fr.length >= 5) {
        let st = 0, sf = 0;
        for (const x of fr) { st += x.t; sf += x.f; }
        const mt = st/fr.length, mf = sf/fr.length;
        let num = 0, den = 0;
        for (const x of fr) { num += (x.t - mt)*(x.f - mf); den += (x.t - mt)*(x.t - mt); }
        const slope = den > 0 ? num/den : 0;
        let v = 0;
        for (const x of fr) { const e = x.f - (mf + slope*(x.t - mt)); v += e*e; }
        wobble += Math.sqrt(v/fr.length)/Math.max(1, mf);
        wn++;
      }
      n++;
    }
    if (!n) { out.push({ id: sp.id, silent: true }); continue; }
    out.push({ id: sp.id, layer: sp.layer,
      partials: pn ? partials/pn : null, wobble: wn ? wobble/wn : null, crest: crest/n,
      atk: atk/n, ad: ad/n });
  }
  return out;
}, ONLY);
await b.close();

console.log('  ' + 'voice'.padEnd(14) + 'layer'.padEnd(7)
  + 'partials  wobble%   attack    a/d   crest');
let flatSines = 0;
for (const r of rows) {
  if (r.silent) { console.log(`  ${r.id.padEnd(14)} — rendered nothing`); continue; }
  const flag = r.partials !== null && r.partials < 0.03 ? '  <- a sine' : '';
  if (r.partials !== null && r.partials < 0.03) flatSines++;
  console.log(`  ${r.id.padEnd(14)}${String(r.layer || '').padEnd(7)}`
    + `${(r.partials === null ? '  —' : r.partials.toFixed(3)).padStart(8)}`
    + `${(r.wobble === null ? '  —' : (r.wobble*100).toFixed(2)).padStart(9)}`
    + `${r.atk.toFixed(4).padStart(10)}`
    + `${r.ad.toFixed(2).padStart(8)}`
    + `${r.crest.toFixed(2).padStart(8)}${flag}`);
}
console.log(`\n  ${flatSines} of ${rows.length} carry essentially nothing above the fundamental`);
if (errs.length) console.log('\n  ERRORS:\n    ' + errs.slice(0, 5).join('\n    '));
