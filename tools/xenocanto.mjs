/* The piece, held against the actual species it is imitating.

   `reference.mjs` compares against ESC-50, whose classes are broad — one
   "chirping_birds" bucket stands in for a blackbird, a robin, a wren and a
   chaffinch at once. That is enough to discover that half the catalogue was
   sine waves. It is not enough to ask whether *our blackbird* sounds like a
   blackbird.

   xeno-canto has the answer, one species at a time: half a million
   quality-rated recordings, filterable by species, sound type and length. And
   every entry in `SPECIES` already carries the Latin binomial needed to ask
   for it, so the mapping is exact rather than a judgement call.

       export XC_KEY=<your key>            # never a file, never an argument
       node tools/xenocanto.mjs --fetch    # download, once
       node tools/xenocanto.mjs            # measure and compare

   ---------------------------------------------------------------------------
   THE KEY

   `XC_KEY` is read from the environment and from nowhere else. It is never
   written to disk, never put in the manifest, and — the part that is easy to
   get wrong — it is scrubbed out of error messages before anything is
   printed, because it travels in the query string and a failed fetch would
   otherwise spill it into a log or a CI transcript.

   Do not pass it as a command-line argument: arguments show up in shell
   history and in the process table. The tool refuses one if it sees it.

   xeno-canto's own guidance is that a key belongs to a person and prolonged
   abuse gets it revoked, so this fetches politely: a short pause between
   requests, and nothing re-downloaded that is already on disk.

   ---------------------------------------------------------------------------
   THE RECORDINGS

   They land in `refaudio/xc/`, which is git-ignored. They are other people's
   work under Creative Commons licences — most CC BY-NC-SA — so they are used
   here to measure against and never shipped. `manifest.json` records the
   catalogue number, recordist and licence of everything downloaded, which is
   what any use of them would have to credit. */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'fs';
import { execFileSync } from 'child_process';

const ROOT = new URL('..', import.meta.url).pathname;
const DIR = ROOT + 'refaudio/xc/';
const API = 'https://xeno-canto.org/api/3/recordings';

const argv = process.argv.slice(2);
const has = f => argv.includes(f);
const val = (f, d) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : d; };
const ONLY = (val('--only', '') || '').split(',').filter(Boolean);
const PER = Math.max(1, Math.min(8, +val('--per', 3)));

/* A key on the command line ends up in shell history and in `ps`. */
for (const a of argv) {
  if (/^[0-9a-f]{32,}$/i.test(a)) {
    console.error('  Do not pass the key as an argument — it lands in shell history\n'
      + '  and in the process table. Use the environment instead:\n\n'
      + '      export XC_KEY=<your key>\n');
    process.exit(2);
  }
}
const KEY = process.env.XC_KEY || '';
/* Anything on its way to a console gets the key taken out of it first. The
   key travels in the query string, so a thrown fetch error carries it. */
const scrub = s => {
  let t = String(s);
  if (KEY) t = t.split(KEY).join('<XC_KEY>');
  return t.replace(/([?&]key=)[^&\s"']+/gi, '$1<XC_KEY>');
};

/* Sound type, where it matters. Most of these birds are being imitated
   *singing*; a few are only ever heard here calling, and a recording of the
   wrong one would be a comparison against a sound the piece never makes. */
const TYPE = {
  crow: 'call', jackdaw: 'call', raven: 'call', magpie: 'call', jay: 'call',
  gull: 'call', tern: 'call', curlew: 'call', oystercatcher: 'call',
  lapwing: 'call', moorhen: 'call', mallard: 'call', littleegret: 'call',
  heron: 'call', buzzard: 'call', kestrel: 'call', swift: 'call',
  feralpigeon: 'call', rooster: 'call', pheasant: 'call', woodpecker: 'drumming',
  owl: 'call', cuckoo: 'song', nightingale: 'song'
};

async function fetchAll() {
  if (!KEY) {
    console.error('  XC_KEY is not set. Get a key at https://xeno-canto.org/account\n'
      + '  then:  export XC_KEY=<your key>\n');
    process.exit(2);
  }
  mkdirSync(DIR, { recursive: true });
  const { SPECIES, CRITTER_VOICES } = await loadCatalogue();
  const all = SPECIES.concat(Object.values(CRITTER_VOICES))
    .filter(s => s.latin && (!ONLY.length || ONLY.includes(s.id)));
  const manifest = existsSync(DIR + 'manifest.json')
    ? JSON.parse(readFileSync(DIR + 'manifest.json', 'utf8')) : {};

  /* curl's own stderr is captured rather than inherited. Left to go straight
     to the terminal it bypasses `scrub` entirely, and curl is perfectly
     willing to quote the URL it was given — which carries the key. */
  const get = (url) => {
    try {
      return execFileSync('curl', ['-sSL', '-m', '90', url],
        { maxBuffer: 64*1024*1024, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      const why = scrub([e.message, e.stderr && e.stderr.toString()].filter(Boolean).join(' '));
      throw new Error(why);
    }
  };

  for (const sp of all) {
    const [gen, epi] = sp.latin.split(/\s+/);
    if (!gen || !epi) { console.log(`  ${sp.id.padEnd(14)} no binomial — skipped`); continue; }
    /* q:A is the top quality band; len 3–30 s keeps a download to a few
       hundred kilobytes and, more to the point, keeps the clip to something
       like the length of one call rather than four minutes of a wood. */
    const q = `gen:${gen} sp:${epi} q:A len:3-30`
      + (TYPE[sp.id] ? ` type:${TYPE[sp.id]}` : '');
    const url = `${API}?query=${encodeURIComponent(q)}&key=${encodeURIComponent(KEY)}&per_page=50`;
    let js;
    try {
      js = JSON.parse(get(url).toString());
    } catch (e) {
      console.log(`  ${sp.id.padEnd(14)} query failed: ${scrub(e.message).slice(0, 220)}`);
      continue;
    }
    if (js.error) {
      console.log(`  ${sp.id.padEnd(14)} ${js.error.code}: ${scrub(js.error.message)}`);
      if (js.error.code === 'invalid_key' || js.error.code === 'missing_parameter') process.exit(3);
      continue;
    }
    const recs = (js.recordings || [])
      .filter(r => r.file && !(r._meta && r._meta.redacted_fields))
      .slice(0, PER);
    if (!recs.length) { console.log(`  ${sp.id.padEnd(14)} nothing found`); continue; }
    let got = 0;
    for (const r of recs) {
      const out = `${DIR}${sp.id}--${r.id}.mp3`;
      if (existsSync(out) && statSync(out).size > 2000) { got++; continue; }
      try {
        execFileSync('curl', ['-sSL', '-m', '120', '-o', out, r.file],
          { stdio: ['ignore', 'pipe', 'pipe'] });
        if (statSync(out).size < 2000) continue;
        got++;
      } catch (e) { continue; }
      manifest[`${sp.id}--${r.id}`] = { id: r.id, species: sp.id, latin: sp.latin,
        en: r.en, rec: r.rec, cnt: r.cnt, type: r.type, q: r.q,
        length: r.length, lic: r.lic, url: r.url };
      // xeno-canto asks that its API not be hammered; this is not a race
      execFileSync('sleep', ['0.6']);
    }
    console.log(`  ${sp.id.padEnd(14)} ${String(got).padStart(2)} recording(s)`
      + `   ${js.numRecordings} available`);
  }
  writeFileSync(DIR + 'manifest.json', JSON.stringify(manifest, null, 1));
  console.log(`\n  ${Object.keys(manifest).length} recordings in refaudio/xc/`
    + `\n  attribution for every one of them is in refaudio/xc/manifest.json`);
}

/* The catalogue, read out of the page rather than imported here, because
   species.js is a browser module. */
let _page = null, _browser = null;
async function openPage() {
  if (_page) return _page;
  _browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium',
    args: ['--use-gl=swiftshader', '--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
  _page = await _browser.newPage({ viewport: { width: 900, height: 560 } });
  _page.on('pageerror', e => console.log('  page error:', scrub(e.message)));
  await _page.goto('http://127.0.0.1:8123/?hook=1', { waitUntil: 'networkidle' });
  return _page;
}
async function loadCatalogue() {
  const p = await openPage();
  return p.evaluate(async () => {
    const { SPECIES, CRITTER_VOICES } = await import('/js/species.js?v=21');
    const slim = s => ({ id: s.id, latin: s.latin, layer: s.layer });
    return { SPECIES: SPECIES.map(slim),
      CRITTER_VOICES: Object.fromEntries(
        Object.entries(CRITTER_VOICES).map(([k, v]) => [k, slim(v)])) };
  });
}

async function compare() {
  if (!existsSync(DIR + 'manifest.json')) {
    console.error('  nothing downloaded yet — run:\n'
      + '      export XC_KEY=<your key> && node tools/xenocanto.mjs --fetch\n');
    process.exit(1);
  }
  const manifest = JSON.parse(readFileSync(DIR + 'manifest.json', 'utf8'));
  const files = Object.keys(manifest)
    .filter(k => existsSync(`${DIR}${k}.mp3`))
    .filter(k => !ONLY.length || ONLY.includes(manifest[k].species));
  if (!files.length) { console.error('  no files on disk for those species'); process.exit(1); }

  const page = await openPage();
  await page.click('#beginBtn');
  await page.waitForTimeout(1000);

  const rows = await page.evaluate(async ([files, byFile]) => {
    const D = await import('/tools/lib/dsp.js?v=21');
    const { SPECIES, CRITTER_VOICES } = await import('/js/species.js?v=21');
    const ALL = SPECIES.concat(Object.values(CRITTER_VOICES));
    const ac = window.__lw.audio.ac;
    const SR = 44100;
    const real = {}, ours = {};

    for (const k of files) {
      const sp = byFile[k];
      try {
        const ab = await (await fetch('/refaudio/xc/' + k + '.mp3')).arrayBuffer();
        const buf = await ac.decodeAudioData(ab);
        const m = D.voiceMetrics(buf.getChannelData(0), buf.sampleRate);
        if (m) (real[sp] ||= []).push(m);
      } catch (e) { /* a bad decode is one recording, not a run */ }
    }

    const render = async (s, seed) => {
      const oc = new OfflineAudioContext(1, SR*8, SR);
      let a = seed >>> 0;
      const r = () => { a |= 0; a = a + 0x6D2B79F5 | 0;
        let t = Math.imul(a ^ a >>> 15, 1 | a);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296; };
      s.synth(oc, oc.destination, 0.05, r);
      return (await oc.startRendering()).getChannelData(0);
    };
    for (const id of Object.keys(real)) {
      const s = ALL.find(x => x.id === id);
      if (!s) continue;
      for (const seed of [1, 7, 19, 31]) {
        const m = D.voiceMetrics(await render(s, seed), SR);
        if (m) (ours[id] ||= []).push(m);
      }
    }
    const med = (rs, k) => D.median((rs || []).map(x => x[k])
      .filter(x => typeof x === 'number' && isFinite(x)));
    return Object.keys(real).sort().map(id => ({ id,
      n: real[id].length,
      rH: med(real[id], 'harmonics'), oH: med(ours[id], 'harmonics'),
      rB: med(real[id], 'breath'),    oB: med(ours[id], 'breath'),
      rW: med(real[id], 'wobble'),    oW: med(ours[id], 'wobble'),
      rF: med(real[id], 'f0'),        oF: med(ours[id], 'f0') }));
  }, [files, Object.fromEntries(files.map(k => [k, manifest[k].species]))]);

  await _browser.close();

  const f = (x, d, w) => (x === null || x === undefined ? '—' : x.toFixed(d)).padStart(w);
  const pair = (r, o, d, w) => f(r, d, w) + '/' + f(o, d, w);
  console.log('\n  Per species: the real bird / ours.  ' + rows.length + ' species,'
    + ' ' + files.length + ' recordings.\n');
  console.log('  ' + 'species'.padEnd(14) + ' n' + '     harmonics'
    + '         breath' + '        wobble%' + '        f0 (Hz)');
  for (const r of rows) {
    console.log('  ' + r.id.padEnd(14) + String(r.n).padStart(2)
      + '   ' + pair(r.rH, r.oH, 3, 6)
      + '  ' + pair(r.rB, r.oB, 3, 6)
      + '  ' + pair(r.rW === null ? null : r.rW*100, r.oW === null ? null : r.oW*100, 1, 6)
      + '  ' + pair(r.rF, r.oF, 0, 6));
  }
  /* The one number a listener would notice before any of the others: a voice
     that is simply in the wrong octave. */
  const off = rows.filter(r => r.rF && r.oF
    && (r.oF/r.rF > 1.6 || r.oF/r.rF < 0.62));
  if (off.length) {
    console.log('\n  pitched well away from the real bird:');
    for (const r of off) {
      console.log(`    ${r.id.padEnd(14)} ours ${Math.round(r.oF)} Hz against `
        + `${Math.round(r.rF)} Hz  (×${(r.oF/r.rF).toFixed(2)})`);
    }
  }
  console.log('\n  Attack, decay and crest are deliberately absent: a field'
    + '\n  recording is continuous, so its envelope never reaches the floor'
    + '\n  and any reading of them would be the length of the clip.');
}

if (has('--fetch')) { await fetchAll(); if (_browser) await _browser.close(); }
else await compare();
