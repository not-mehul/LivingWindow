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
       node tools/xenocanto.mjs --fetch    # download, once — node and curl only
       node tools/xenocanto.mjs            # measure — needs Playwright + a server

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
  // the owl here hoots; its "kewick" is a different sound at twice the pitch
  owl: 'song', cuckoo: 'song', nightingale: 'song'
};

async function fetchAll() {
  if (!KEY) {
    console.error('  XC_KEY is not set. Get a key at https://xeno-canto.org/account\n'
      + '  then:  export XC_KEY=<your key>\n');
    process.exit(2);
  }
  mkdirSync(DIR, { recursive: true });
  const all = loadCatalogue()
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
    /* grp:birds, because that is what this archive is. xeno-canto holds
       birds, grasshoppers and bats — and this catalogue also contains a fox,
       a badger, a roe deer, a house cat, an otter, a hedgehog, a squirrel and
       a frog, none of which it can possibly have. Asked for `gen:Meles
       sp:meles` anyway, the search did not return nothing: it returned three
       recordings of something else, which were then measured and reported as
       a badger. */
    const q = `gen:${gen} sp:${epi} grp:birds q:A len:3-30`
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
    /* And check that what came back is what was asked for. A search that
       matches loosely is worse than one that matches nothing, because the
       recordings arrive, decode, measure and print like any others — there is
       no stage at which a wrong species announces itself. Every recording
       carries the genus and epithet it actually is; if they disagree with the
       request, it is not ours. */
    const want = (gen + ' ' + epi).toLowerCase();
    const all2 = (js.recordings || [])
      .filter(r => r.file && !(r._meta && r._meta.redacted_fields));
    const recs = all2.filter(r =>
      `${r.gen || ''} ${r.sp || ''}`.trim().toLowerCase() === want).slice(0, PER);
    if (!recs.length) {
      const got = [...new Set(all2.map(r => `${r.gen} ${r.sp}`))].slice(0, 2).join(', ');
      console.log(`  ${sp.id.padEnd(14)} not in xeno-canto`
        + (got ? ` — the search offered ${got} instead, refused` : ''));
      continue;
    }
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
        got: `${r.gen} ${r.sp}`.trim(),
        en: r.en, rec: r.rec, cnt: r.cnt, type: r.type, q: r.q,
        length: r.length, lic: r.lic, url: r.url };
      // xeno-canto asks that its API not be hammered; this is not a race
      await new Promise(res => setTimeout(res, 600));
    }
    console.log(`  ${sp.id.padEnd(14)} ${String(got).padStart(2)} recording(s)`
      + `   ${js.numRecordings} available`);
  }
  writeFileSync(DIR + 'manifest.json', JSON.stringify(manifest, null, 1));
  console.log(`\n  ${Object.keys(manifest).length} recordings in refaudio/xc/`
    + `\n  attribution for every one of them is in refaudio/xc/manifest.json`);
}

/* The catalogue, read straight out of the source file.

   Downloading recordings needs a species list and nothing else, so it should
   not need a browser, a static server, or a copy of Playwright — all of which
   the first version of this demanded, because it read the list by importing
   `species.js` into a page. That put a fifty-megabyte dependency and a
   running web server between somebody and their first download, and on a
   machine without Playwright installed it failed before printing anything
   useful. Every id sits on the same line as its binomial, so a regex over the
   file is all it takes. */
function loadCatalogue() {
  const src = readFileSync(ROOT + 'js/species.js', 'utf8');
  const out = [];
  const re = /id:\s*"([a-z]+)"[^}]*?latin:\s*"([^"]+)"/g;
  let m;
  while ((m = re.exec(src))) out.push({ id: m[1], latin: m[2] });
  if (!out.length) throw new Error('could not read any species out of js/species.js');
  return out;
}

/* Playwright is needed to *measure* — the recordings are decoded and the
   synthesis rendered inside a real browser — but not to fetch. Imported at
   the point of use so a missing install cannot break the download. */
let _page = null, _browser = null;
async function openPage() {
  if (_page) return _page;
  const { launch } = await import('./lib/browser.mjs');
  try {
    _browser = await launch({ args: ['--use-gl=swiftshader',
      '--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
  } catch (e) {
    if (e.code !== 'NO_PLAYWRIGHT') throw e;
    console.error('\n  Comparing needs Playwright and a static server:\n'
      + '\n      npm install && npx playwright install chromium'
      + '\n      python3 -m http.server 8123 &'
      + '\n      node tools/xenocanto.mjs\n'
      + '\n  Downloading needs neither — `--fetch` works as it is.\n');
    process.exit(4);
  }
  _page = await _browser.newPage({ viewport: { width: 900, height: 560 } });
  _page.on('pageerror', e => console.log('  page error:', scrub(e.message)));
  const url = (process.env.BENCH_URL || 'http://127.0.0.1:8123/') + '?hook=1';
  try {
    await _page.goto(url, { waitUntil: 'networkidle' });
  } catch (e) {
    console.error(`\n  Could not reach ${url} — start a static server in the`
      + '\n  project root first:  python3 -m http.server 8123\n');
    await _browser.close();
    process.exit(5);
  }
  return _page;
}

async function compare() {
  if (!existsSync(DIR + 'manifest.json')) {
    console.error('  nothing downloaded yet — run:\n'
      + '      export XC_KEY=<your key> && node tools/xenocanto.mjs --fetch\n');
    process.exit(1);
  }
  const manifest = JSON.parse(readFileSync(DIR + 'manifest.json', 'utf8'));
  /* A manifest written before the identity check has no record of what each
     recording actually turned out to be, so there is no way to tell a real
     blackbird from whatever a loose search handed back in its place. Rather
     than measure it and hope, say so. */
  const unchecked = Object.values(manifest).filter(m => !m.got).length;
  if (unchecked) {
    console.error(`\n  ${unchecked} of ${Object.keys(manifest).length} recordings were`
      + ' downloaded before the species check existed,'
      + '\n  and cannot be trusted to be the bird they are filed under. Re-fetch:'
      + '\n\n      rm -rf refaudio/xc'
      + '\n      export XC_KEY=<your key>'
      + '\n      node tools/xenocanto.mjs --fetch\n');
    process.exit(6);
  }
  const files = Object.keys(manifest)
    .filter(k => existsSync(`${DIR}${k}.mp3`))
    .filter(k => !ONLY.length || ONLY.includes(manifest[k].species));
  if (!files.length) { console.error('  no files on disk for those species'); process.exit(1); }

  const page = await openPage();
  await page.click('#beginBtn');
  await page.waitForTimeout(1000);

  const rows = await page.evaluate(async ([files, byFile]) => {
    const D = await import('/tools/lib/dsp.js?v=31');
    const { SPECIES, CRITTER_VOICES } = await import('/js/species.js?v=31');
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
      rF: med(real[id], 'f0'),        oF: med(ours[id], 'f0'),
      rBW: med(real[id], 'bandwidth') }));
  }, [files, Object.fromEntries(files.map(k => [k, manifest[k].species]))]);

  await _browser.close();

  const f = (x, d, w) => (x === null || x === undefined ? '—' : x.toFixed(d)).padStart(w);
  const pair = (r, o, d, w) => f(r, d, w) + '/' + f(o, d, w);
  console.log('\n  Per species: the real bird / ours.  ' + rows.length + ' species,'
    + ' ' + files.length + ' recordings.\n');
  console.log('  ' + 'species'.padEnd(14) + ' n' + '     harmonics'
    + '         breath' + '        wobble%' + '        f0 (Hz)   band');
  for (const r of rows) {
    console.log('  ' + r.id.padEnd(14) + String(r.n).padStart(2)
      + '   ' + pair(r.rH, r.oH, 3, 6)
      + '  ' + pair(r.rB, r.oB, 3, 6)
      + '  ' + pair(r.rW === null ? null : r.rW*100, r.oW === null ? null : r.oW*100, 1, 6)
      + '  ' + pair(r.rF, r.oF, 0, 6)
      + '  ' + f(r.rBW === null ? null : r.rBW/1000, 1, 5) + 'k');
  }
  /* The one number a listener would notice before any of the others: a voice
     in the wrong octave.

     It is also the number most easily got wrong, so it is only reported where
     the estimate can be trusted on both sides. A ratio that is very close to
     a whole number of octaves is far more likely to be the estimator
     disagreeing with itself about which partial is the fundamental than a
     bird singing an octave from where it does — so those are set aside to be
     looked at rather than acted on. */
  const oct = x => Math.log2(x);
  const off = [], suspect = [];
  for (const r of rows) {
    if (!r.rF || !r.oF) continue;
    const ratio = r.oF/r.rF, o = oct(ratio);
    if (ratio > 0.62 && ratio < 1.6) continue;
    const nearOctave = Math.abs(o - Math.round(o)) < 0.12 && Math.round(o) !== 0;
    (nearOctave ? suspect : off).push({ r, ratio });
  }
  if (off.length) {
    console.log('\n  pitched well away from the real bird:');
    for (const { r, ratio } of off) {
      console.log(`    ${r.id.padEnd(14)} ours ${Math.round(r.oF)} Hz against `
        + `${Math.round(r.rF)} Hz  (×${ratio.toFixed(2)})`);
    }
  }
  if (suspect.length) {
    console.log('\n  within a hair of a whole octave — check these by ear before'
      + '\n  believing them, an octave error is the classic way a pitch'
      + '\n  estimator fails and it fails silently:');
    for (const { r, ratio } of suspect) {
      console.log(`    ${r.id.padEnd(14)} ours ${Math.round(r.oF)} Hz against `
        + `${Math.round(r.rF)} Hz  (×${ratio.toFixed(2)})`);
    }
  }
  const impossible = rows.filter(r => r.rH !== null && r.rH > 0.92);
  if (impossible.length) {
    console.log('\n  harmonic share above 0.92 means the fundamental bin holds'
      + '\n  nothing — that is a pitch error, not a bird. Disregard:'
      + '\n    ' + impossible.map(r => `${r.id} (${r.rH.toFixed(3)})`).join(', '));
  }
  const noH = rows.filter(r => r.rH === null);
  if (noH.length) {
    console.log(`\n  no harmonic reading for ${noH.length} species — their second`
      + '\n  and third harmonics fall above what the recording carries, so the'
      + '\n  harmonics are missing from the file rather than from the bird:'
      + '\n    ' + noH.map(r => r.id).join(', '));
  }
  console.log('\n  Attack, decay and crest are deliberately absent: a field'
    + '\n  recording is continuous, so its envelope never reaches the floor'
    + '\n  and any reading of them would be the length of the clip.');
}

if (has('--fetch')) { await fetchAll(); if (_browser) await _browser.close(); }
else await compare();
