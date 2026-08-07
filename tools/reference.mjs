/* The piece, held against the world.

   Everything else in `tools/` measures this application against itself: is
   the mix balanced, did the frame get slower, is that bed still static. None
   of it can answer the only question that matters for a piece pretending to
   be a window onto a field — does it sound like the thing it is imitating.

   So this fetches real field recordings, runs the *same* instrument over them
   that `voice.mjs` and `texture.mjs` run over the synthesis (`tools/lib/dsp.js`,
   imported by all three), and prints the two columns side by side.

   The recordings are ESC-50 — two thousand five-second environmental clips,
   drawn from Freesound, assembled by Karol Piczak, and the standard reference
   set for this kind of work. They are fetched into `refaudio/`, which is
   git-ignored: they are other people's recordings under CC BY-NC and they are
   used here to measure against, never shipped.

       node tools/reference.mjs --fetch     # download the clips (once)
       node tools/reference.mjs             # measure and compare

   Which class stands for what:

     chirping_birds  the perched chorus — blackbird, robin, tits, finches
     crow            crow, raven, jackdaw, magpie
     rooster         rooster              frog       frog
     crickets        cricket              cat        cat
     hen             pheasant, moorhen    insects    bee
     rain            the rain bed         wind       the wind bed
     sea_waves       surf body and foam   thunderstorm  thunder

   Two warnings about reading the output. A field recording is a *scene*: the
   bird is at a distance, in a room, with everything else that was going on
   that morning. So the harmonic figure is deliberately measured at k·f0 only
   — background does not count toward it — but the breath figure is honest
   about the whole frame, and part of what it reports for the real recordings
   is the wood, not the bird. And ESC-50 clips are loudness-normalised and
   sometimes clipped, so absolute level says nothing; only shape does. */
import { chromium } from 'playwright';
import { chromiumPath } from './lib/browser.mjs';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { execFileSync } from 'child_process';

const ROOT = new URL('..', import.meta.url).pathname;
const DIR = ROOT + 'refaudio/';
const BASE = 'https://raw.githubusercontent.com/karolpiczak/ESC-50/master';
const CLASSES = ['chirping_birds', 'crow', 'rooster', 'frog', 'crickets', 'cat',
  'hen', 'insects', 'rain', 'wind', 'sea_waves', 'thunderstorm'];
const BEDS = new Set(['rain', 'wind', 'sea_waves', 'thunderstorm']);
const PER = 6;

if (process.argv.includes('--fetch')) {
  mkdirSync(DIR, { recursive: true });
  const csv = execFileSync('curl', ['-sSL', '-m', '120', BASE + '/meta/esc50.csv']).toString();
  const rows = csv.trim().split('\n').slice(1).map(l => l.split(','));
  const by = {};
  for (const r of rows) (by[r[3]] ||= []).push(r[0]);
  const lines = [];
  for (const c of CLASSES) {
    for (const f of (by[c] || []).sort().slice(0, PER)) {
      lines.push(c + '\t' + f);
      if (existsSync(DIR + c + '--' + f)) continue;
      execFileSync('curl', ['-sSL', '-m', '120', '-o', DIR + c + '--' + f, BASE + '/audio/' + f]);
      process.stdout.write('.');
    }
  }
  writeFileSync(DIR + 'list.tsv', lines.join('\n'));
  console.log(`\n  ${lines.length} clips in refaudio/`);
  process.exit(0);
}
if (!existsSync(DIR + 'list.tsv')) {
  console.error('  no recordings yet — run:  node tools/reference.mjs --fetch');
  process.exit(1);
}
const list = readFileSync(DIR + 'list.tsv', 'utf8').trim().split('\n')
  .map(l => l.split('\t'));

const b = await chromium.launch({ ...chromiumPath(), args: ['--use-gl=swiftshader', '--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
const page = await b.newPage({ viewport: { width: 900, height: 560 } });
const errs = [];
page.on('pageerror', e => errs.push('' + e.message));
await page.goto('http://127.0.0.1:8123/?hook=1', { waitUntil: 'networkidle' });
await page.click('#beginBtn');
await page.waitForTimeout(1200);

/* ---- the world ---------------------------------------------------------- */
const real = await page.evaluate(async ([list, beds]) => {
  const D = await import('/tools/lib/dsp.js?v=28');
  // decoded on the live context: an OfflineAudioContext will refuse this
  const ac = window.__lw.audio.ac;
  const out = {};
  for (const [cat, file] of list) {
    const res = await fetch('/refaudio/' + cat + '--' + file);
    if (!res.ok) throw new Error(`fetch ${cat}--${file}: ${res.status}`);
    const ab = await res.arrayBuffer();
    if (ab.byteLength < 1000) throw new Error(`${cat}--${file}: ${ab.byteLength} bytes`);
    const buf = await ac.decodeAudioData(ab);
    const d = buf.getChannelData(0), sr = buf.sampleRate;
    (out[cat] ||= []).push(beds.includes(cat)
      ? D.bedMetrics(d, sr) : D.voiceMetrics(d, sr));
  }
  return out;
}, [list, [...BEDS]]);

/* ---- the piece ----------------------------------------------------------
   Voices go through the same offline render `voice.mjs` uses; beds are
   recorded off their own live taps into a buffer and then measured by the
   very same function that measured the files. */
const mine = await page.evaluate(async () => {
  const D = await import('/tools/lib/dsp.js?v=28');
  const { SPECIES, CRITTER_VOICES } = await import('/js/species.js?v=28');
  const { audio, scene, state } = window.__lw;
  const ALL = SPECIES.concat(Object.values(CRITTER_VOICES));
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const SR = 44100;
  const out = { voices: {}, beds: {} };

  const renderVoice = async (sp, seed) => {
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
    const rows = [];
    for (const seed of [1, 7, 19, 31]) {
      const m = D.voiceMetrics(await renderVoice(sp, seed), SR);
      if (m) rows.push(m);
    }
    if (rows.length) out.voices[sp.id] = rows;
  }

  /* A bed off its own tap. `ScriptProcessor` is deprecated and exactly right
     here: it is the only way to get the real, running bed — gusts, tides,
     weather and all — into a buffer without rebuilding the graph offline and
     measuring something that is not what plays. */
  const capture = async (nodes, secs) => {
    const ac = audio.ac;
    const sp = ac.createScriptProcessor(4096, 1, 1);
    const chunks = [];
    sp.onaudioprocess = e => chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
    for (const n of nodes) n.connect(sp);
    const sink = ac.createGain(); sink.gain.value = 0;
    sp.connect(sink); sink.connect(ac.destination);
    await sleep(secs*1000);
    for (const n of nodes) { try { n.disconnect(sp); } catch (e) {} }
    sp.disconnect(); sink.disconnect(); sp.onaudioprocess = null;
    let n = 0; for (const c of chunks) n += c.length;
    const d = new Float32Array(n);
    let o = 0; for (const c of chunks) { d.set(c, o); o += c.length; }
    return { d, sr: ac.sampleRate };
  };

  state.weatherFlow = false; state.timeFlow = false;
  /* Whole beds, not single nodes. The surf is a body *and* a foam band on
     two separate gains, and measuring only the body said the sea was a
     351 Hz rumble — which it is, with the entire top half of it left out of
     the reading. A listener hears the sum, so the sum is what is measured. */
  const bedPlan = [
    ['rain',        'meadow', 'rain',   () => [audio.rainGain]],
    ['wind',        'meadow', 'breeze', () => [audio.windGain, audio.windMoan]],
    ['sea_waves',   'beach',  'clear',  () => [audio.surfGain, audio.surfFoamGain]],
    ['leaves(ref)', 'forest', 'breeze', () => [audio.leavesGain]]
  ];
  for (const [label, loc, wx, get] of bedPlan) {
    state.location = loc; state.weather = wx;
    scene.reseed(state.seed); audio.applyConditions();
    await sleep(3500);
    const nodes = get().filter(Boolean);
    if (!nodes.length) continue;
    const { d, sr } = await capture(nodes, 20);
    /* Cut into five-second pieces and take the median of the pieces, because
       that is the length of a reference clip. Measured whole, a twenty-second
       capture also contains this piece's slow squalls and breath tides — real
       enough, but nothing a five-second recording of rain could ever contain,
       so comparing the two was scoring our own weather as grain. */
    const CH = Math.round(sr*5), parts = [];
    for (let at = 0; at + CH <= d.length; at += CH) {
      parts.push(D.bedMetrics(d.subarray(at, at + CH), sr));
    }
    const pick = k => D.median(parts.map(p => p[k]).filter(x => isFinite(x)));
    out.beds[label] = parts.length
      ? { flutter: pick('flutter'), drift: pick('drift'), centroid: pick('centroid') }
      : D.bedMetrics(d, sr);
  }
  return out;
});
await b.close();

/* ---- and the comparison -------------------------------------------------- */
const med = (rows, k) => {
  const v = rows.map(r => r && r[k]).filter(x => typeof x === 'number' && isFinite(x));
  if (!v.length) return null;
  v.sort((a, b2) => a - b2);
  return v[v.length >> 1];
};
const f = (x, d2, w) => (x === null ? '—' : x.toFixed(d2)).padStart(w);

/* Which of our voices stands against which recorded class. */
const MAP = {
  chirping_birds: ['blackbird', 'robin', 'wren', 'greattit', 'bluetit', 'chaffinch',
    'songthrush', 'dunnock', 'goldfinch', 'chiffchaff'],
  crow: ['crow', 'raven', 'jackdaw', 'magpie'],
  rooster: ['rooster'], frog: ['frog'], crickets: ['cricket'], cat: ['cat'],
  hen: ['pheasant', 'moorhen'], insects: ['bee', 'cricket']
};

console.log('\n  VOICES — real recordings against what this piece synthesises');
console.log('  ' + ''.padEnd(20) + 'harmonics    breath    wobble%   attack   a/d   crest');
for (const cls of CLASSES) {
  if (BEDS.has(cls) || !real[cls]) continue;
  const R = real[cls].filter(Boolean);
  const ours = (MAP[cls] || []).filter(id => mine.voices[id]).flatMap(id => mine.voices[id]);
  if (!R.length || !ours.length) continue;
  const row = (tag, rows) => '  ' + tag.padEnd(20)
    + f(med(rows, 'harmonics'), 3, 8) + f(med(rows, 'breath'), 3, 10)
    + f(med(rows, 'wobble') === null ? null : med(rows, 'wobble')*100, 2, 10)
    + f(med(rows, 'attack'), 4, 9) + f(med(rows, 'ad'), 2, 7)
    + f(med(rows, 'crest'), 1, 8);
  console.log(row('  real ' + cls, R));
  console.log(row('  ours', ours));
}

console.log('\n  BEDS — real recordings against what this piece synthesises');
console.log('  ' + ''.padEnd(20) + ' flutter     drift%   centroid');
const BEDMAP = { rain: 'rain', wind: 'wind', sea_waves: 'sea_waves' };
for (const cls of Object.keys(BEDMAP)) {
  if (!real[cls]) continue;
  const R = real[cls].filter(Boolean);
  const o = mine.beds[BEDMAP[cls]];
  const line = (tag, fl, dr, ce) => '  ' + tag.padEnd(20)
    + f(fl, 3, 8) + f(dr === null ? null : dr*100, 1, 10) + f(ce, 0, 11) + ' Hz';
  console.log(line('  real ' + cls, med(R, 'flutter'), med(R, 'drift'), med(R, 'centroid')));
  if (o) console.log(line('  ours', o.flutter, o.drift, o.centroid));
}
if (mine.beds['leaves(ref)']) {
  const l = mine.beds['leaves(ref)'];
  console.log('  ' + '  ours leaves (ref)'.padEnd(20)
    + f(l.flutter, 3, 8) + f(l.drift*100, 1, 10) + f(l.centroid, 0, 11) + ' Hz');
}
if (errs.length) console.log('\n  ERRORS:\n    ' + errs.slice(0, 5).join('\n    '));
