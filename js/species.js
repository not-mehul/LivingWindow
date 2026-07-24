/* ============================================================
   Species — the voices and their marks. Every call is
   synthesized, nothing is sampled. Self-contained: pictograms,
   the low-level synth primitives that build each voice, and the
   species catalogue that ties sound to place and hour.
   ============================================================ */

/* Field-guide pictograms — one tiny mark per family. */
const ICONS = {
  songbird: '<ellipse cx="10.5" cy="14" rx="5" ry="3.6"/><circle cx="15.8" cy="9.6" r="2.4"/><path d="M18.2 9.2l3.3.6-3.3.8"/><path d="M5.5 14 1.8 16.6"/><path d="M9.5 17.6 9.5 21M12.5 17.4 13 21"/>',
  wren: '<ellipse cx="11.5" cy="14.5" rx="4.4" ry="3.2"/><circle cx="15.9" cy="10.6" r="2.1"/><path d="M18 10.3l2.8.5-2.8.7"/><path d="M7.4 13 4.6 7.6"/><path d="M10.5 17.7 10.5 21M13 17.5 13.4 21"/>',
  pigeon: '<ellipse cx="11" cy="13.8" rx="6" ry="4.6"/><circle cx="17" cy="8.8" r="2"/><path d="M19 8.6l2.6.5-2.6.6"/><path d="M5.2 15.5 2 17.6"/><path d="M9.5 18.2 9.5 21M13 18 13.4 21"/>',
  crow: '<ellipse cx="10.5" cy="13.6" rx="5.6" ry="3.8"/><circle cx="16.3" cy="8.8" r="2.3"/><path d="M18.5 8.2l4 1-4 1.4"/><path d="M5 14.6 1.2 17.8"/><path d="M9.2 17.2 9.2 21M12.4 17 12.9 21"/>',
  longtail: '<ellipse cx="12" cy="13" rx="4.6" ry="3"/><circle cx="16.8" cy="9" r="2.1"/><path d="M18.9 8.7l3 .6-3 .7"/><path d="M7.6 13.8 1 19.4"/><path d="M11 16 11 20.5M14 15.8 14.4 20.5"/>',
  owl: '<ellipse cx="12" cy="14" rx="4.8" ry="6.2"/><path d="M8.2 9 7 5.4l3 1.8M15.8 9 17 5.4l-3 1.8"/><circle cx="10.3" cy="11" r=".75" fill="currentColor"/><circle cx="13.7" cy="11" r=".75" fill="currentColor"/><path d="M9.8 20.4v1.2M14.2 20.4v1.2"/>',
  gull: '<path d="M2 12.5c3.2-3.6 6.4-3.6 9-.9"/><path d="M22 12.5c-3.2-3.6-6.4-3.6-9-.9"/><path d="M10.6 11.9c.9.7 1.9.7 2.8 0"/>',
  swift: '<path d="M2.5 13.5C5.2 8.8 8.6 6.6 12 6.6s6.8 2.2 9.5 6.9"/><path d="M12 6.6v5"/><path d="M10.8 11.6l1.2 2.4 1.2-2.4"/>',
  lark: '<path d="M4.5 14c2.4-2.7 4.8-2.7 7-.7"/><path d="M19.5 14c-2.4-2.7-4.8-2.7-7-.7"/><path d="M12 8V5.6M9.3 8.8 8 6.8M14.7 8.8 16 6.8"/>',
  curlew: '<ellipse cx="9.5" cy="11.5" rx="4.4" ry="3.2"/><circle cx="14.4" cy="8.2" r="1.9"/><path d="M16.2 8.6c2.6.2 4.5 1.5 5.2 3.6"/><path d="M8 14.5V21M11.5 14.7V21"/>',
  wader: '<ellipse cx="9.5" cy="11.8" rx="4.6" ry="3.4"/><circle cx="14.6" cy="8.4" r="2"/><path d="M16.6 8.2 22.4 9.6"/><path d="M8 15V21M11.5 15.2V21"/>',
  duck: '<path d="M4.5 14.6c0-2.8 3-4.4 6.8-4.4 1.9 0 3.4.5 4.3 1.3"/><circle cx="16.4" cy="9.2" r="2.1"/><path d="M18.5 9.4l3.3.9"/><path d="M4.5 14.6 2.6 12.2"/><path d="M2 17.2c2 .9 4 .9 6 0s4-.9 6 0 4 .9 6 0"/>',
  woodpecker: '<path d="M7 2.5v19"/><ellipse cx="13.2" cy="13" rx="3.1" ry="4.6"/><circle cx="13.8" cy="7.4" r="1.9"/><path d="M12 7 7.6 6.2"/><path d="M12.4 17.2 11.6 20M14.6 17.4 14.4 20.4"/>',
  cricket: '<ellipse cx="10.5" cy="14.5" rx="5.6" ry="2.9"/><path d="M14 13 18.6 8.6M18.6 8.6 21.4 11.4"/><path d="M6 12.6 2.6 8.8M7.6 12 5 7.6"/><path d="M8 17.2 6.8 20M12 17.4 12 20.4"/>',
  frog: '<path d="M4 16.5c0-4.6 3.6-7.3 8-7.3 3.5 0 6.4 1.8 7.5 4.6"/><path d="M8.2 9.6a1.5 1.5 0 1 1 3 0M13 9.2a1.5 1.5 0 1 1 3 0"/><path d="M4 16.5c.9 2.4 3.2 3.9 6 3.9h9.5"/><path d="M17 16.5 19.6 20.2"/>',
  reed: '<path d="M4 21V4.5"/><path d="M4 8.5c1.4 0 2.2-.9 2.2-2.4"/><ellipse cx="13" cy="14" rx="4.6" ry="3.3"/><circle cx="17.8" cy="10" r="2.1"/><path d="M19.9 9.7l2.6.5-2.6.7"/><path d="M8.4 14.6 6.6 16.2"/><path d="M12 17.2V20.6M14.6 17 15 20.6"/>',
  rooster: '<ellipse cx="10.5" cy="13.8" rx="5" ry="3.8"/><circle cx="15.8" cy="9" r="2.2"/><path d="M14.8 6.9c.4-1 1.2-1.5 2-1.3-.2.7 0 1.3.6 1.7"/><path d="M18 8.8l2.8.7-2.8.8"/><path d="M5.5 14.2 2 10.6M6.2 15 3 13"/><path d="M9.5 17.6V21M12.5 17.4 13 21"/>',
  bell: '<path d="M12 3.5c3.6 0 6 2.6 6 6.4 0 3 1 4.6 2 5.6H4c1-1 2-2.6 2-5.6 0-3.8 2.4-6.4 6-6.4z"/><path d="M10 18.5a2 2 0 0 0 4 0"/>',
  kingfisher: '<ellipse cx="11" cy="14" rx="4.6" ry="3.6"/><circle cx="14.8" cy="9.4" r="2.4"/><path d="M17.2 9l5 1-5 1.2"/><path d="M9.8 17.6 9.8 21M12.6 17.4 13 21"/>',
  pheasant: '<ellipse cx="12.5" cy="13.5" rx="4.6" ry="3"/><circle cx="16.6" cy="10" r="1.9"/><path d="M18.4 9.8l2.4.5-2.4.6"/><path d="M8.2 12.6 1 9M8.6 13.8 1.6 11.4"/><path d="M11.5 16.4 11.5 20M14 16.2 14.4 20"/>',
  egret: '<ellipse cx="11" cy="13" rx="4" ry="2.4"/><path d="M13.8 11.4c2-.8.8-3.4 2.6-4.6"/><circle cx="16.8" cy="6.2" r="1.5"/><path d="M18.2 6l4 .8"/><path d="M9.5 15.2V21M12.5 15.4V21"/>',
  raptor: '<path d="M2 11c3.4-2.8 6.8-3.4 10-3.4S18.6 8.2 22 11"/><path d="M12 7.6v4.2"/><path d="M10 11.4l2 3.4 2-3.4"/><path d="M4 10.4v-1.6M6.4 9.3V7.8M8.8 8.6V7.1M19.9 10.4v-1.6M17.5 9.3V7.8M15.1 8.6V7.1"/>',
  paw: '<ellipse cx="12" cy="15.5" rx="4.4" ry="3.4"/><circle cx="6.8" cy="11.5" r="1.7"/><circle cx="10.4" cy="9" r="1.7"/><circle cx="14.6" cy="9" r="1.7"/><circle cx="18" cy="11.5" r="1.7"/>'
};
const ICON_KEY = {
  blackbird: "songbird", robin: "songbird", chiffchaff: "songbird",
  greattit: "songbird", sparrow: "songbird",
  songthrush: "songbird", chaffinch: "songbird", goldfinch: "songbird",
  dunnock: "songbird", starling: "songbird", nightingale: "songbird",
  yellowhammer: "songbird", greenfinch: "songbird",
  wren: "wren", bluetit: "wren",
  woodpigeon: "pigeon", feralpigeon: "pigeon", collareddove: "pigeon",
  cuckoo: "longtail", magpie: "longtail", jay: "longtail",
  owl: "owl", gull: "gull", tern: "gull", swift: "swift", skylark: "lark",
  curlew: "curlew", oystercatcher: "wader", lapwing: "wader",
  mallard: "duck", moorhen: "duck",
  woodpecker: "woodpecker", crow: "crow", jackdaw: "crow", raven: "crow",
  cricket: "cricket", frog: "frog", reedwarbler: "reed",
  rooster: "rooster", bell: "bell",
  kingfisher: "kingfisher", pheasant: "pheasant", littleegret: "egret",
  kestrel: "raptor", buzzard: "raptor", heron: "egret",
  fox: "paw", deer: "paw", cat: "paw", squirrel: "paw",
  otter: "paw", hedgehog: "paw", badger: "paw"
};
function speciesIcon(sp, size) {
  const inner = ICONS[ICON_KEY[sp.id]] || ICONS.songbird;
  return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" '
    + 'stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" '
    + 'aria-hidden="true">' + inner + '</svg>';
}

/* Perched-bird styling per species (used by the scene): body proportions plus
   the field marks that let an etched silhouette read as its species at a
   glance — a robin's warm bib, a magpie's white scapulars, a tit's dark cap. */
const PSTYLE = {
  blackbird: { bill: 0.5, tail: 1.3, billTone: "amber", eyeRing: true },
  robin: { sc: 0.9, bill: 0.38, plump: 1.08, breast: true },
  greattit: { sc: 0.85, bill: 0.34, cap: true, cheek: true, bib: true, wingbar: true },
  chiffchaff: { sc: 0.82, bill: 0.36, brow: true },
  wren: { sc: 0.72, tailUp: true, tail: 0.72, bill: 0.42, plump: 1.12, barring: true },
  sparrow: { sc: 0.85, bill: 0.42, plump: 1.06, cap: true, bib: true, wingbar: true },
  reedwarbler: { sc: 0.85, bill: 0.48, brow: true },
  woodpigeon: { plump: 1.35, bill: 0.3, sc: 1.12, smallHead: true, neckPatch: true },
  feralpigeon: { plump: 1.3, bill: 0.3, sc: 1.05, smallHead: true, sheen: true, wingbar: true },
  crow: { sc: 1.2, bill: 0.72, plump: 1.05, billDeep: true, gloss: true, tail: 1.35 },
  magpie: { sc: 1.05, tail: 2.4, bill: 0.5, billDeep: true, shoulder: true, belly: true, gloss: true },
  songthrush: { sc: 0.95, bill: 0.45, plump: 1.05, speckles: true },
  chaffinch: { sc: 0.85, bill: 0.4, breast: true, wingbar: true },
  goldfinch: { sc: 0.75, bill: 0.35, face: true, wingbar: true },
  bluetit: { sc: 0.72, bill: 0.3, plump: 1.08, cap: true, capTone: "sage", cheek: true, wash: "amber" },
  dunnock: { sc: 0.8, bill: 0.35, barring: true },
  starling: { sc: 0.9, bill: 0.5, tail: 0.85, speckles: true, gloss: true },
  nightingale: { sc: 0.88, bill: 0.4, plump: 1.02, tailTone: "amber", tail: 1.2 },
  yellowhammer: { sc: 0.85, bill: 0.38, wash: "amber", tail: 1.2 },
  greenfinch: { sc: 0.82, bill: 0.42, wash: "sage" },
  jay: { sc: 1.05, bill: 0.5, plump: 1.1, wingPatch: true },
  jackdaw: { sc: 1.0, bill: 0.5, plump: 1.02, billDeep: true, cap: true, neckPatch: true },
  raven: { sc: 1.45, bill: 0.85, plump: 1.1, billDeep: true, gloss: true, tail: 1.4 },
  collareddove: { sc: 1.0, bill: 0.3, plump: 1.2, smallHead: true, collar: true },
  kingfisher: { sc: 0.78, bill: 0.95, plump: 1.15, tail: 0.5, breast: true, sheen: true },
  lapwing: { sc: 0.95, bill: 0.3, plump: 1.15, cap: true, belly: true, crest: true, gloss: true }
};

/* Synth primitives — the building blocks of every voice. */
function note(ac, dest, t, f0, f1, dur, peak, type) {
  const o = ac.createOscillator();
  o.type = type || "sine";
  o.frequency.setValueAtTime(Math.max(40, f0), t);
  o.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t + dur);
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + Math.min(0.02, dur*0.3));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(dest);
  o.start(t); o.stop(t + dur + 0.05);
}
/* One noise buffer, reused for every burst — allocating a fresh buffer per call
   (there can be many per second in rain) is what makes the soundscape stutter. */
let _noiseBuf = null;
function sharedNoise(ac) {
  if (!_noiseBuf || _noiseBuf.sampleRate !== ac.sampleRate) {
    const len = Math.floor(ac.sampleRate * 1.5);
    _noiseBuf = ac.createBuffer(1, len, ac.sampleRate);
    const d = _noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random()*2 - 1;
  }
  return _noiseBuf;
}
function burst(ac, dest, t, freq, q, dur, peak) {
  const len = Math.max(0.05, dur + 0.05);
  const buf = sharedNoise(ac);
  const src = ac.createBufferSource();
  src.buffer = buf;
  const offset = Math.random() * Math.max(0, buf.duration - len - 0.01);
  const bp = ac.createBiquadFilter();
  bp.type = "bandpass"; bp.frequency.value = freq; bp.Q.value = q;
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(bp); bp.connect(g); g.connect(dest);
  src.start(t, offset, len); src.stop(t + len + 0.02);
}

/* The species catalogue.
   habitats: where it will sing. hw: per-place weighting.
   weights: how likely at each hour. base: seconds between tries. */
const SPECIES = [
  { id: "blackbird", name: "Eurasian Blackbird", latin: "Turdus merula",
    desc: "fluted, unhurried phrases from a high perch", tone: "amber", layer: "perch",
    habitats: ["meadow","forest","city"], hw: { city: 0.6 },
    weights: { dawn: 0.95, day: 0.3, dusk: 0.8, night: 0.02 }, base: 15,
    synth(ac, dest, t0, r) {
      let t = t0;
      const nn = 3 + Math.floor(r()*3);
      for (let i = 0; i < nn; i++) {
        const f = 1400 + r()*900;
        note(ac, dest, t, f, f*(0.78 + r()*0.5), 0.15 + r()*0.13, 0.05);
        t += 0.19 + r()*0.15;
      }
      if (r() < 0.6) { note(ac, dest, t, 2800 + r()*800, 3500 + r()*900, 0.12, 0.028); t += 0.16; }
      return t - t0 + 0.2;
    } },
  { id: "greattit", name: "Great Tit", latin: "Parus major",
    desc: "the see-saw \u201cteacher, teacher\u201d song", tone: "sage", layer: "perch",
    habitats: ["meadow","forest","city"],
    weights: { dawn: 0.7, day: 0.55, dusk: 0.25, night: 0 }, base: 18,
    synth(ac, dest, t0, r) {
      const reps = 3 + Math.floor(r()*3);
      let t = t0;
      const fa = 3700 + r()*300, fb = 2750 + r()*250;
      for (let i = 0; i < reps; i++) {
        note(ac, dest, t, fa, fa*0.96, 0.09, 0.042);
        note(ac, dest, t + 0.115, fb, fb*0.94, 0.10, 0.042);
        t += 0.285;
      }
      return t - t0 + 0.1;
    } },
  { id: "wren", name: "Eurasian Wren", latin: "Troglodytes troglodytes",
    desc: "an astonishing loud trill from a tiny body", tone: "amber", layer: "perch",
    habitats: ["meadow","forest","wetland"],
    weights: { dawn: 0.65, day: 0.45, dusk: 0.3, night: 0 }, base: 20,
    synth(ac, dest, t0, r) {
      let t = t0;
      const nn = 22 + Math.floor(r()*10);
      for (let i = 0; i < nn; i++) {
        const f = 3800 + ((i % 2) ? 700 : 0) + r()*500;
        note(ac, dest, t, f, f*0.94, 0.03, 0.032);
        t += 0.033;
      }
      return t - t0 + 0.1;
    } },
  { id: "chiffchaff", name: "Common Chiffchaff", latin: "Phylloscopus collybita",
    desc: "saying its own name, over and over", tone: "sage", layer: "perch",
    habitats: ["forest","meadow"],
    weights: { dawn: 0.5, day: 0.6, dusk: 0.2, night: 0 }, base: 22,
    synth(ac, dest, t0, r) {
      const reps = 5 + Math.floor(r()*5);
      let t = t0;
      for (let i = 0; i < reps; i++) {
        const f = (i % 2 ? 2450 : 2900) + r()*180;
        note(ac, dest, t, f, f*0.93, 0.10, 0.038);
        t += 0.235 + r()*0.05;
      }
      return t - t0 + 0.1;
    } },
  { id: "woodpigeon", name: "Common Wood Pigeon", latin: "Columba palumbus",
    desc: "a five-note coo, soft as upholstery", tone: "amber", layer: "perch",
    habitats: ["meadow","forest","city","wetland"],
    weights: { dawn: 0.5, day: 0.5, dusk: 0.4, night: 0.02 }, base: 24,
    synth(ac, dest, t0, r) {
      const seq = [[420, 0.26], [372, 0.4], [420, 0.24], [372, 0.2], [352, 0.2]];
      let t = t0;
      for (const [f, d] of seq) {
        note(ac, dest, t, f + r()*14, f*0.97, d, 0.055);
        t += d + 0.06;
      }
      return t - t0 + 0.1;
    } },
  { id: "cuckoo", name: "Common Cuckoo", latin: "Cuculus canorus",
    desc: "two falling notes across the whole valley", tone: "amber", layer: "far",
    habitats: ["meadow","forest","wetland"],
    weights: { dawn: 0.4, day: 0.3, dusk: 0.15, night: 0 }, base: 34,
    synth(ac, dest, t0, r) {
      let t = t0;
      const reps = 1 + Math.floor(r()*2);
      for (let i = 0; i < reps; i++) {
        note(ac, dest, t, 742, 726, 0.22, 0.05);
        note(ac, dest, t + 0.42, 592, 578, 0.26, 0.05);
        t += 1.1;
      }
      return t - t0;
    } },
  { id: "robin", name: "European Robin", latin: "Erithacus rubecula",
    desc: "a thin silver warble, wistful at the edges", tone: "sage", layer: "perch",
    habitats: ["meadow","forest","city","wetland"],
    weights: { dawn: 0.7, day: 0.3, dusk: 0.75, night: 0.25 }, base: 17,
    synth(ac, dest, t0, r) {
      let t = t0;
      const nn = 6 + Math.floor(r()*4);
      for (let i = 0; i < nn; i++) {
        const f = 2100 + r()*1900;
        note(ac, dest, t, f, f*(0.6 + r()*0.8), 0.07 + r()*0.12, 0.035);
        t += 0.1 + r()*0.16;
      }
      return t - t0 + 0.15;
    } },
  { id: "skylark", name: "Eurasian Skylark", latin: "Alauda arvensis",
    desc: "a silver thread spun high out of sight", tone: "amber", layer: "air",
    habitats: ["meadow"],
    weights: { dawn: 0.6, day: 0.65, dusk: 0.15, night: 0 }, base: 30,
    synth(ac, dest, t0, r) {
      const dur = 2.4 + r()*1.6;
      let t = t0;
      while (t < t0 + dur) {
        const f = 3000 + r()*1500;
        note(ac, dest, t, f, f*(0.85 + r()*0.3), 0.05, 0.02);
        t += 0.055;
      }
      return dur + 0.1;
    } },
  { id: "woodpecker", name: "Great Spotted Woodpecker", latin: "Dendrocopos major",
    desc: "a drum-roll knocked out on dead wood", tone: "sage", layer: "perch",
    habitats: ["forest"],
    weights: { dawn: 0.55, day: 0.45, dusk: 0.1, night: 0 }, base: 26,
    synth(ac, dest, t0, r) {
      let t = t0, gap = 0.058;
      const nn = 13 + Math.floor(r()*5);
      for (let i = 0; i < nn; i++) {
        burst(ac, dest, t, 1100 + r()*300, 2, 0.022, 0.085);
        t += gap; gap *= 0.985;
      }
      return t - t0 + 0.1;
    } },
  { id: "crow", name: "Carrion Crow", latin: "Corvus corone",
    desc: "flat, unapologetic caws", tone: "amber", layer: "perch",
    habitats: ["meadow","forest","beach","wetland","city"],
    weights: { dawn: 0.35, day: 0.5, dusk: 0.3, night: 0 }, base: 25,
    synth(ac, dest, t0, r) {
      let t = t0;
      const reps = 2 + Math.floor(r()*3);
      for (let i = 0; i < reps; i++) {
        note(ac, dest, t, 560 + r()*60, 410, 0.24, 0.026, "sawtooth");
        burst(ac, dest, t, 900, 0.8, 0.22, 0.02);
        t += 0.34 + r()*0.1;
      }
      return t - t0 + 0.1;
    } },
  { id: "owl", name: "Tawny Owl", latin: "Strix aluco",
    desc: "the long hollow hoot, then the wavering reply", tone: "amber", layer: "perch",
    habitats: ["meadow","forest","wetland","city"], hw: { city: 0.3 },
    weights: { dawn: 0.05, day: 0, dusk: 0.3, night: 0.9 }, base: 28,
    synth(ac, dest, t0, r) {
      note(ac, dest, t0, 400, 375, 0.75, 0.055);
      let t = t0 + 1.5 + r()*0.5;
      note(ac, dest, t, 385, 380, 0.12, 0.04);
      t += 0.35;
      for (let i = 0; i < 3; i++) {
        note(ac, dest, t, 400 - i*20, 380 - i*22, 0.4, 0.05);
        t += 0.42;
      }
      return t - t0 + 0.3;
    } },
  { id: "cricket", name: "Field Cricket", latin: "Gryllus campestris",
    desc: "the night's own metronome, in the grass", tone: "sage", layer: "ground",
    habitats: ["meadow","wetland"], chorus: true,
    weights: { dawn: 0.05, day: 0.05, dusk: 0.55, night: 0.8 }, base: 12,
    synth(ac, dest, t0, r) {
      let t = t0;
      const chirps = 6 + Math.floor(r()*7);
      for (let i = 0; i < chirps; i++) {
        for (let k = 0; k < 3; k++) burst(ac, dest, t + k*0.028, 4400 + r()*300, 14, 0.02, 0.02);
        t += 0.34 + r()*0.12;
      }
      return t - t0;
    } },
  { id: "frog", name: "Common Frog", latin: "Rana temporaria",
    desc: "low creaking croaks along the water's edge", tone: "sage", layer: "ground",
    habitats: ["wetland","meadow"], hw: { meadow: 0.3 }, chorus: true,
    weights: { dawn: 0.15, day: 0.05, dusk: 0.6, night: 0.7 }, base: 14,
    synth(ac, dest, t0, r) {
      let t = t0;
      const nn = 8 + Math.floor(r()*7);
      const f = 95 + r()*40;
      for (let i = 0; i < nn; i++) {
        note(ac, dest, t, f + r()*10, f*0.92, 0.055, 0.05, "sawtooth");
        t += 0.072;
      }
      return t - t0 + 0.1;
    } },
  { id: "gull", name: "Herring Gull", latin: "Larus argentatus",
    desc: "long keening cries over the water", tone: "amber", layer: "air",
    habitats: ["beach","city"], hw: { city: 0.25 },
    weights: { dawn: 0.45, day: 0.65, dusk: 0.35, night: 0.03 }, base: 18,
    synth(ac, dest, t0, r) {
      let t = t0;
      note(ac, dest, t, 1450 + r()*150, 900, 0.5, 0.03, "sawtooth");
      t += 0.65;
      const reps = 2 + Math.floor(r()*4);
      for (let i = 0; i < reps; i++) {
        note(ac, dest, t, 1300 + r()*150, 1000, 0.16, 0.028, "sawtooth");
        t += 0.22;
      }
      return t - t0 + 0.1;
    } },
  { id: "curlew", name: "Eurasian Curlew", latin: "Numenius arquata",
    desc: "a rising cry that dissolves into bubbling", tone: "sage", layer: "far",
    habitats: ["beach","wetland"],
    weights: { dawn: 0.55, day: 0.3, dusk: 0.5, night: 0.05 }, base: 30,
    synth(ac, dest, t0, r) {
      note(ac, dest, t0, 880, 1750, 0.7, 0.045);
      let t = t0 + 0.78;
      for (let i = 0; i < 8; i++) {
        const f = 1500 + r()*450;
        note(ac, dest, t, f, f*1.12, 0.05, 0.035);
        t += 0.058;
      }
      return t - t0 + 0.1;
    } },
  { id: "oystercatcher", name: "Eurasian Oystercatcher", latin: "Haematopus ostralegus",
    desc: "shrill piping, hurried and bright", tone: "amber", layer: "ground",
    habitats: ["beach"],
    weights: { dawn: 0.55, day: 0.55, dusk: 0.3, night: 0.05 }, base: 22,
    synth(ac, dest, t0, r) {
      let t = t0, gap = 0.1;
      const nn = 7 + Math.floor(r()*6);
      for (let i = 0; i < nn; i++) {
        note(ac, dest, t, 2850 + r()*150, 2600, 0.07, 0.04);
        t += gap; gap *= 0.96;
      }
      return t - t0 + 0.1;
    } },
  { id: "mallard", name: "Mallard", latin: "Anas platyrhynchos",
    desc: "a descending run of quacks, mostly laughter", tone: "amber", layer: "ground",
    habitats: ["wetland"],
    weights: { dawn: 0.5, day: 0.5, dusk: 0.45, night: 0.08 }, base: 20,
    synth(ac, dest, t0, r) {
      let t = t0, peak = 0.032;
      const nn = 4 + Math.floor(r()*4);
      for (let i = 0; i < nn; i++) {
        note(ac, dest, t, 330 - i*10, 255, 0.14, peak, "sawtooth");
        peak *= 0.82;
        t += 0.2;
      }
      return t - t0 + 0.1;
    } },
  { id: "reedwarbler", name: "Eurasian Reed Warbler", latin: "Acrocephalus scirpaceus",
    desc: "scratchy chatter, churring down in the reeds", tone: "sage", layer: "perch",
    habitats: ["wetland"],
    weights: { dawn: 0.65, day: 0.55, dusk: 0.3, night: 0.1 }, base: 19,
    synth(ac, dest, t0, r) {
      let t = t0;
      const nn = 12 + Math.floor(r()*9);
      for (let i = 0; i < nn; i++) {
        const f = 2000 + (i % 2)*700 + r()*400;
        if (r() < 0.4) burst(ac, dest, t, f, 6, 0.05, 0.03);
        else note(ac, dest, t, f, f*0.9, 0.06, 0.032);
        t += 0.09 + r()*0.04;
      }
      return t - t0 + 0.1;
    } },
  { id: "sparrow", name: "House Sparrow", latin: "Passer domesticus",
    desc: "companionable cheeps from the gutters", tone: "amber", layer: "perch",
    habitats: ["city","meadow"], hw: { meadow: 0.5 },
    weights: { dawn: 0.55, day: 0.65, dusk: 0.35, night: 0 }, base: 14,
    synth(ac, dest, t0, r) {
      let t = t0;
      const nn = 3 + Math.floor(r()*5);
      for (let i = 0; i < nn; i++) {
        const f = 2500 + r()*1400;
        note(ac, dest, t, f, f*(0.85 + r()*0.25), 0.08, 0.038);
        t += 0.16 + r()*0.14;
      }
      return t - t0 + 0.1;
    } },
  { id: "feralpigeon", name: "Feral Pigeon", latin: "Columba livia domestica",
    desc: "throaty cooing on a window ledge", tone: "sage", layer: "perch",
    habitats: ["city"],
    weights: { dawn: 0.5, day: 0.55, dusk: 0.3, night: 0.02 }, base: 20,
    synth(ac, dest, t0, r) {
      let t = t0;
      for (let i = 0; i < 3; i++) {
        note(ac, dest, t, 320 + r()*20, 285, 0.3, 0.05);
        t += 0.4;
      }
      return t - t0 + 0.1;
    } },
  { id: "swift", name: "Common Swift", latin: "Apus apus",
    desc: "a screaming party tearing down the street", tone: "sage", layer: "air",
    habitats: ["city"],
    weights: { dawn: 0.4, day: 0.5, dusk: 0.8, night: 0 }, base: 26,
    synth(ac, dest, t0, r) {
      let t = t0;
      const reps = 2 + Math.floor(r()*2);
      for (let i = 0; i < reps; i++) {
        note(ac, dest, t, 6300 + r()*400, 4100, 0.7, 0.016);
        note(ac, dest, t + 0.04, 6500 + r()*400, 4300, 0.66, 0.013);
        t += 0.85;
      }
      return t - t0 + 0.1;
    } },
  { id: "magpie", name: "Eurasian Magpie", latin: "Pica pica",
    desc: "a dry machine-gun rattle of alarm", tone: "amber", layer: "perch",
    habitats: ["city","forest"], hw: { forest: 0.4 },
    weights: { dawn: 0.35, day: 0.5, dusk: 0.25, night: 0 }, base: 27,
    synth(ac, dest, t0, r) {
      let t = t0;
      const nn = 10 + Math.floor(r()*5);
      for (let i = 0; i < nn; i++) {
        burst(ac, dest, t, 1700 + r()*300, 1.5, 0.04, 0.06);
        t += 0.055;
      }
      return t - t0 + 0.1;
    } },
  { id: "rooster", name: "Farmyard Cockerel", latin: "Gallus gallus domesticus",
    desc: "crowing from a farm over the hill — faint but certain", tone: "amber", layer: "far",
    habitats: ["meadow"],
    weights: { dawn: 0.5, day: 0.06, dusk: 0, night: 0 }, base: 55,
    synth(ac, dest, t0, r) {
      const bp = ac.createBiquadFilter();
      bp.type = "bandpass"; bp.frequency.value = 1050; bp.Q.value = 1;
      bp.connect(dest);
      let t = t0;
      note(ac, bp, t, 620, 660, 0.18, 0.05, "sawtooth"); t += 0.24;
      note(ac, bp, t, 750, 780, 0.16, 0.05, "sawtooth"); t += 0.22;
      note(ac, bp, t, 900, 930, 0.3, 0.06, "sawtooth"); t += 0.36;
      note(ac, bp, t, 830, 560, 0.55, 0.05, "sawtooth"); t += 0.6;
      return t - t0 + 0.2;
    } },
  { id: "songthrush", name: "Song Thrush", latin: "Turdus philomelos",
    desc: "each phrase said twice, as if to be sure", tone: "amber", layer: "perch",
    habitats: ["meadow","forest"],
    weights: { dawn: 0.85, day: 0.35, dusk: 0.7, night: 0.05 }, base: 16,
    synth(ac, dest, t0, r) {
      let t = t0;
      const phrases = 2 + Math.floor(r()*2);
      for (let p = 0; p < phrases; p++) {
        const f = 1800 + r()*1200, f2 = f*(0.7 + r()*0.6);
        const reps = 2 + Math.floor(r()*2);
        for (let i = 0; i < reps; i++) {
          note(ac, dest, t, f, f2, 0.12, 0.05);
          note(ac, dest, t + 0.14, f*1.1, f2*1.05, 0.08, 0.035);
          t += 0.3;
        }
        t += 0.25 + r()*0.2;
      }
      return t - t0 + 0.2;
    } },
  { id: "chaffinch", name: "Common Chaffinch", latin: "Fringilla coelebs",
    desc: "a rattling run downhill with a flourish at the end", tone: "sage", layer: "perch",
    habitats: ["forest","meadow","city"], hw: { city: 0.4 },
    weights: { dawn: 0.6, day: 0.6, dusk: 0.2, night: 0 }, base: 17,
    synth(ac, dest, t0, r) {
      let t = t0, f = 3400 + r()*300, gap = 0.09;
      const nn = 8 + Math.floor(r()*4);
      for (let i = 0; i < nn; i++) {
        note(ac, dest, t, f, f*0.94, 0.05, 0.04);
        f *= 0.93; gap *= 0.94; t += gap;
      }
      note(ac, dest, t, 2000, 2600, 0.14, 0.05);
      note(ac, dest, t + 0.12, 2500, 1900, 0.12, 0.05);
      return t - t0 + 0.35;
    } },
  { id: "goldfinch", name: "European Goldfinch", latin: "Carduelis carduelis",
    desc: "tinkling liquid chatter, like small change", tone: "amber", layer: "perch",
    habitats: ["meadow","city"],
    weights: { dawn: 0.4, day: 0.65, dusk: 0.3, night: 0 }, base: 18,
    synth(ac, dest, t0, r) {
      let t = t0;
      const cl = 3 + Math.floor(r()*3);
      for (let i = 0; i < cl; i++) {
        for (let k = 0; k < 3; k++) {
          const f = 3800 + r()*1500;
          note(ac, dest, t, f, f*1.1, 0.045, 0.035);
          t += 0.055;
        }
        t += 0.12 + r()*0.1;
      }
      return t - t0 + 0.1;
    } },
  { id: "bluetit", name: "Eurasian Blue Tit", latin: "Cyanistes caeruleus",
    desc: "two high notes, then a silver trill", tone: "sage", layer: "perch",
    habitats: ["forest","meadow","city"],
    weights: { dawn: 0.6, day: 0.6, dusk: 0.2, night: 0 }, base: 16,
    synth(ac, dest, t0, r) {
      let t = t0;
      const hi = 2 + Math.floor(r()*2);
      for (let i = 0; i < hi; i++) {
        note(ac, dest, t, 4200 + r()*300, 4000, 0.08, 0.04);
        t += 0.12;
      }
      const nn = 6 + Math.floor(r()*5);
      for (let k = 0; k < nn; k++) {
        note(ac, dest, t, 3000 + r()*200, 2800, 0.035, 0.038);
        t += 0.045;
      }
      return t - t0 + 0.1;
    } },
  { id: "dunnock", name: "Dunnock", latin: "Prunella modularis",
    desc: "a hurried flat warble from low cover", tone: "sage", layer: "perch",
    habitats: ["city","meadow"],
    weights: { dawn: 0.5, day: 0.45, dusk: 0.25, night: 0 }, base: 21,
    synth(ac, dest, t0, r) {
      let t = t0;
      const nn = 10 + Math.floor(r()*5);
      for (let i = 0; i < nn; i++) {
        const f = 3000 + r()*1400;
        note(ac, dest, t, f, f*(0.88 + r()*0.2), 0.05, 0.035);
        t += 0.065 + r()*0.02;
      }
      return t - t0 + 0.1;
    } },
  { id: "starling", name: "Common Starling", latin: "Sturnus vulgaris",
    desc: "whistles, clicks and borrowed noises", tone: "amber", layer: "perch",
    habitats: ["city","meadow"], hw: { meadow: 0.5 },
    weights: { dawn: 0.5, day: 0.6, dusk: 0.55, night: 0 }, base: 17,
    synth(ac, dest, t0, r) {
      let t = t0;
      note(ac, dest, t, 2600 + r()*600, 900 + r()*300, 0.5, 0.032);
      t += 0.55;
      const nn = 5 + Math.floor(r()*5);
      for (let k = 0; k < nn; k++) {
        burst(ac, dest, t, 1500 + r()*2500, 8, 0.02, 0.05);
        t += 0.05 + r()*0.04;
      }
      if (r() < 0.7) { note(ac, dest, t, 1800, 3400, 0.22, 0.028); t += 0.3; }
      return t - t0 + 0.1;
    } },
  { id: "nightingale", name: "Common Nightingale", latin: "Luscinia megarhynchos",
    desc: "a crescendo, then the deep jug-jug-jug", tone: "amber", layer: "perch",
    habitats: ["forest"],
    weights: { dawn: 0.3, day: 0.05, dusk: 0.75, night: 0.9 }, base: 25,
    synth(ac, dest, t0, r) {
      let t = t0, pk = 0.014;
      const f = 2200 + r()*400;
      const reps = 4 + Math.floor(r()*3);
      for (let i = 0; i < reps; i++) {
        note(ac, dest, t, f, f*0.98, 0.1, pk);
        pk = Math.min(0.055, pk*1.55); t += 0.16;
      }
      t += 0.12;
      const nn = 5 + Math.floor(r()*4);
      for (let k = 0; k < nn; k++) {
        note(ac, dest, t, 950 + r()*100, 720, 0.07, 0.05, "sawtooth");
        t += 0.09;
      }
      return t - t0 + 0.15;
    } },
  { id: "yellowhammer", name: "Yellowhammer", latin: "Emberiza citrinella",
    desc: "“a little bit of bread and no cheese”", tone: "amber", layer: "perch",
    habitats: ["meadow"],
    weights: { dawn: 0.45, day: 0.65, dusk: 0.3, night: 0 }, base: 23,
    synth(ac, dest, t0, r) {
      let t = t0;
      const f = 3200 + r()*250;
      const nn = 6 + Math.floor(r()*3);
      for (let i = 0; i < nn; i++) {
        note(ac, dest, t, f, f*0.97, 0.06, 0.04);
        t += 0.09;
      }
      note(ac, dest, t, f*1.35, f*1.3, 0.5, 0.032);
      return t - t0 + 0.6;
    } },
  { id: "greenfinch", name: "European Greenfinch", latin: "Chloris chloris",
    desc: "a lazy wheeze let out through the leaves", tone: "sage", layer: "perch",
    habitats: ["city","meadow"],
    weights: { dawn: 0.45, day: 0.55, dusk: 0.25, night: 0 }, base: 22,
    synth(ac, dest, t0, r) {
      let t = t0;
      note(ac, dest, t, 2600 + r()*200, 2100, 0.55, 0.02, "sawtooth");
      note(ac, dest, t + 0.02, 2750 + r()*200, 2250, 0.5, 0.014, "sawtooth");
      t += 0.7;
      if (r() < 0.6) {
        const nn = 5 + Math.floor(r()*4);
        for (let k = 0; k < nn; k++) {
          note(ac, dest, t, 3300 + r()*200, 3100, 0.04, 0.035);
          t += 0.05;
        }
      }
      return t - t0 + 0.1;
    } },
  { id: "jay", name: "Eurasian Jay", latin: "Garrulus glandarius",
    desc: "a ripping screech from inside the wood", tone: "amber", layer: "perch",
    habitats: ["forest"],
    weights: { dawn: 0.35, day: 0.5, dusk: 0.25, night: 0 }, base: 26,
    synth(ac, dest, t0, r) {
      let t = t0;
      const reps = 1 + Math.floor(r()*2);
      for (let i = 0; i < reps; i++) {
        burst(ac, dest, t, 1600 + r()*400, 0.7, 0.3, 0.08);
        note(ac, dest, t, 1900 + r()*200, 1300, 0.28, 0.014, "sawtooth");
        t += 0.5 + r()*0.2;
      }
      return t - t0 + 0.1;
    } },
  { id: "jackdaw", name: "Western Jackdaw", latin: "Coloeus monedula",
    desc: "a bright metallic “tchak!” off the chimneys", tone: "sage", layer: "perch",
    habitats: ["city"],
    weights: { dawn: 0.55, day: 0.6, dusk: 0.4, night: 0 }, base: 18,
    synth(ac, dest, t0, r) {
      let t = t0;
      const reps = 2 + Math.floor(r()*3);
      for (let i = 0; i < reps; i++) {
        note(ac, dest, t, 1350 + r()*150, 950, 0.09, 0.05, "square");
        burst(ac, dest, t, 1600, 2, 0.07, 0.03);
        t += 0.22 + r()*0.15;
      }
      return t - t0 + 0.1;
    } },
  { id: "raven", name: "Common Raven", latin: "Corvus corax",
    desc: "a deep wooden cronk, older than the trees", tone: "amber", layer: "perch",
    habitats: ["forest"],
    weights: { dawn: 0.4, day: 0.45, dusk: 0.3, night: 0 }, base: 32,
    synth(ac, dest, t0, r) {
      let t = t0;
      const reps = 1 + Math.floor(r()*2);
      for (let i = 0; i < reps; i++) {
        note(ac, dest, t, 320 + r()*40, 210, 0.28, 0.05, "sawtooth");
        burst(ac, dest, t, 600, 0.8, 0.26, 0.025);
        t += 0.55 + r()*0.2;
      }
      return t - t0 + 0.15;
    } },
  { id: "collareddove", name: "Eurasian Collared Dove", latin: "Streptopelia decaocto",
    desc: "a three-note coo, patient as afternoon", tone: "sage", layer: "perch",
    habitats: ["city","meadow"], hw: { meadow: 0.5 },
    weights: { dawn: 0.5, day: 0.55, dusk: 0.35, night: 0 }, base: 22,
    synth(ac, dest, t0, r) {
      let t = t0;
      const reps = 1 + Math.floor(r()*2);
      for (let i = 0; i < reps; i++) {
        note(ac, dest, t, 470 + r()*15, 450, 0.22, 0.05); t += 0.3;
        note(ac, dest, t, 440 + r()*15, 425, 0.4, 0.055); t += 0.5;
        note(ac, dest, t, 450 + r()*15, 430, 0.13, 0.04); t += 0.45;
      }
      return t - t0 + 0.1;
    } },
  { id: "kingfisher", name: "Common Kingfisher", latin: "Alcedo atthis",
    desc: "a needle of whistle shot along the water", tone: "sage", layer: "perch",
    habitats: ["wetland"],
    weights: { dawn: 0.5, day: 0.55, dusk: 0.35, night: 0 }, base: 30,
    synth(ac, dest, t0, r) {
      let t = t0;
      const reps = 2 + Math.floor(r()*2);
      for (let i = 0; i < reps; i++) {
        note(ac, dest, t, 5200 + r()*400, 6200, 0.09, 0.035);
        t += 0.14 + r()*0.05;
      }
      return t - t0 + 0.1;
    } },
  { id: "lapwing", name: "Northern Lapwing", latin: "Vanellus vanellus",
    desc: "a wheezy “pee-wit!” tumbling over the marsh", tone: "sage", layer: "ground",
    habitats: ["wetland","meadow"], hw: { meadow: 0.5 },
    weights: { dawn: 0.6, day: 0.45, dusk: 0.5, night: 0.1 }, base: 26,
    synth(ac, dest, t0, r) {
      let t = t0;
      note(ac, dest, t, 1200, 2600, 0.18, 0.045);
      note(ac, dest, t + 0.26, 2400, 1100, 0.22, 0.045);
      t += 0.55;
      if (r() < 0.5) {
        note(ac, dest, t, 1500, 2900, 0.14, 0.04);
        note(ac, dest, t + 0.18, 2600, 1300, 0.18, 0.04);
        t += 0.45;
      }
      return t - t0 + 0.1;
    } },
  { id: "pheasant", name: "Common Pheasant", latin: "Phasianus colchicus",
    desc: "a harsh double crow and a whirr of wings", tone: "amber", layer: "ground",
    habitats: ["meadow","forest"], hw: { forest: 0.4 },
    weights: { dawn: 0.6, day: 0.15, dusk: 0.55, night: 0.02 }, base: 38,
    synth(ac, dest, t0, r) {
      let t = t0;
      note(ac, dest, t, 700 + r()*60, 500, 0.14, 0.06, "sawtooth"); t += 0.18;
      note(ac, dest, t, 900 + r()*80, 620, 0.18, 0.07, "sawtooth"); t += 0.28;
      for (let k = 0; k < 8; k++) {
        burst(ac, dest, t, 300 + k*30, 1.5, 0.03, 0.04);
        t += 0.035;
      }
      return t - t0 + 0.15;
    } },
  { id: "moorhen", name: "Common Moorhen", latin: "Gallinula chloropus",
    desc: "one explosive bubbling note from the reeds", tone: "sage", layer: "ground",
    habitats: ["wetland"],
    weights: { dawn: 0.5, day: 0.5, dusk: 0.45, night: 0.15 }, base: 24,
    synth(ac, dest, t0, r) {
      let t = t0;
      note(ac, dest, t, 500 + r()*80, 1400, 0.12, 0.06);
      burst(ac, dest, t + 0.02, 900, 2, 0.1, 0.03);
      t += 0.3;
      if (r() < 0.4) {
        note(ac, dest, t, 550, 1200, 0.1, 0.045);
        t += 0.2;
      }
      return t - t0 + 0.1;
    } },
  { id: "littleegret", name: "Little Egret", latin: "Egretta garzetta",
    desc: "a dry croak from the white sentinel", tone: "sage", layer: "ground",
    habitats: ["wetland","beach"],
    weights: { dawn: 0.45, day: 0.55, dusk: 0.3, night: 0 }, base: 30,
    synth(ac, dest, t0, r) {
      burst(ac, dest, t0, 700 + r()*100, 1, 0.28, 0.05);
      note(ac, dest, t0, 420, 300, 0.25, 0.03, "sawtooth");
      return 0.5;
    } },
  { id: "tern", name: "Common Tern", latin: "Sterna hirundo",
    desc: "a grating “kee-arr” over the surf", tone: "amber", layer: "air",
    habitats: ["beach"],
    weights: { dawn: 0.45, day: 0.6, dusk: 0.3, night: 0 }, base: 24,
    synth(ac, dest, t0, r) {
      let t = t0;
      note(ac, dest, t, 3100 + r()*200, 1600, 0.4, 0.038, "sawtooth");
      t += 0.5;
      if (r() < 0.6) {
        note(ac, dest, t, 2900 + r()*200, 1700, 0.28, 0.032, "sawtooth");
        t += 0.35;
      }
      return t - t0 + 0.1;
    } },
  { id: "kestrel", name: "Common Kestrel", latin: "Falco tinnunculus",
    desc: "sharp kee-kee-kee from a hovering cross", tone: "amber", layer: "air",
    habitats: ["meadow","city"], hw: { city: 0.4 },
    weights: { dawn: 0.35, day: 0.55, dusk: 0.3, night: 0 }, base: 34,
    synth(ac, dest, t0, r) {
      let t = t0;
      const nn = 6 + Math.floor(r()*4);
      for (let i = 0; i < nn; i++) {
        note(ac, dest, t, 2400 + r()*200, 2000, 0.07, 0.04);
        t += 0.12;
      }
      return t - t0 + 0.1;
    } },
  { id: "buzzard", name: "Common Buzzard", latin: "Buteo buteo",
    desc: "one long mew, wheeling on still wings", tone: "sage", layer: "air",
    habitats: ["forest","meadow"],
    weights: { dawn: 0.25, day: 0.6, dusk: 0.2, night: 0 }, base: 40,
    synth(ac, dest, t0, r) {
      note(ac, dest, t0, 2600, 3100, 0.25, 0.038);
      note(ac, dest, t0 + 0.28, 3000, 1400 + r()*200, 0.9, 0.04);
      return 1.4;
    } }
];

/* Voices for the land's quiet traffic — critters that appear on their own
   schedule rather than in the turn-taking chorus. When one is on stage the
   audio engine may let it speak: the fox's scream, the deer's bark, the
   heron's harsh frank. `p` is its inclination to speak when the moment comes. */
const CRITTER_VOICES = {
  fox: { id: "fox", name: "Red Fox", latin: "Vulpes vulpes",
    desc: "a hoarse bark, and sometimes the vixen's scream", tone: "amber", p: 0.45,
    synth(ac, dest, t0, r) {
      let t = t0;
      if (r() < 0.3) {                     // the scream, rare and eerie
        note(ac, dest, t, 900 + r()*100, 1500, 0.55, 0.045, "sawtooth");
        burst(ac, dest, t, 1400, 1, 0.5, 0.02);
        return 0.9;
      }
      const reps = 2 + Math.floor(r()*2);
      for (let i = 0; i < reps; i++) {
        note(ac, dest, t, 520 + r()*60, 310, 0.12, 0.05, "sawtooth");
        burst(ac, dest, t, 800, 1, 0.1, 0.03);
        t += 0.28 + r()*0.1;
      }
      return t - t0 + 0.15;
    } },
  deer: { id: "deer", name: "Roe Deer", latin: "Capreolus capreolus",
    desc: "a gruff bark, more dog than deer", tone: "sage", p: 0.4,
    synth(ac, dest, t0, r) {
      let t = t0;
      const reps = 1 + Math.floor(r()*2);
      for (let i = 0; i < reps; i++) {
        burst(ac, dest, t, 500 + r()*100, 0.8, 0.18, 0.09);
        note(ac, dest, t, 400, 250, 0.15, 0.045, "sawtooth");
        t += 0.5 + r()*0.3;
      }
      return t - t0 + 0.15;
    } },
  cat: { id: "cat", name: "House Cat", latin: "Felis catus",
    desc: "one unhurried meow across the rooftops", tone: "amber", p: 0.5,
    synth(ac, dest, t0, r) {
      const f = 480 + r()*80;
      note(ac, dest, t0, f, f*1.9, 0.32, 0.035);
      note(ac, dest, t0 + 0.3, f*1.9, f*0.9, 0.4, 0.032);
      note(ac, dest, t0 + 0.02, f*2.1, f*3.2, 0.28, 0.012, "sawtooth");
      return 0.9;
    } },
  heron: { id: "heron", name: "Grey Heron", latin: "Ardea cinerea",
    desc: "a harsh “fraaank”, flung over its shoulder", tone: "sage", p: 0.5,
    synth(ac, dest, t0, r) {
      note(ac, dest, t0, 340 + r()*40, 210, 0.5, 0.055, "sawtooth");
      burst(ac, dest, t0, 800, 0.8, 0.4, 0.028);
      return 0.8;
    } },
  squirrel: { id: "squirrel", name: "Red Squirrel", latin: "Sciurus vulgaris",
    desc: "an indignant chuk-chuk-chuk from a bough", tone: "amber", p: 0.65,
    synth(ac, dest, t0, r) {
      let t = t0;
      const nn = 5 + Math.floor(r()*4);
      for (let k = 0; k < nn; k++) {
        burst(ac, dest, t, 1400 + r()*300, 4, 0.04, 0.05);
        t += 0.11 + r()*0.04;
      }
      return t - t0 + 0.1;
    } },
  otter: { id: "otter", name: "Eurasian Otter", latin: "Lutra lutra",
    desc: "a bright whistle between dives", tone: "sage", p: 0.55,
    synth(ac, dest, t0, r) {
      let t = t0;
      const reps = 1 + Math.floor(r()*2);
      for (let i = 0; i < reps; i++) {
        note(ac, dest, t, 2800 + r()*300, 3600, 0.12, 0.04);
        t += 0.2 + r()*0.1;
      }
      return t - t0 + 0.1;
    } },
  hedgehog: { id: "hedgehog", name: "European Hedgehog", latin: "Erinaceus europaeus",
    desc: "busy snuffling along the ground", tone: "amber", p: 0.6,
    synth(ac, dest, t0, r) {
      let t = t0;
      const nn = 5 + Math.floor(r()*4);
      for (let k = 0; k < nn; k++) {
        burst(ac, dest, t, 300 + r()*150, 1, 0.06, 0.03);
        t += 0.14 + r()*0.1;
      }
      return t - t0 + 0.1;
    } },
  badger: { id: "badger", name: "European Badger", latin: "Meles meles",
    desc: "a low grumble on the night rounds", tone: "sage", p: 0.45,
    synth(ac, dest, t0, r) {
      let t = t0;
      const reps = 2 + Math.floor(r()*2);
      for (let i = 0; i < reps; i++) {
        note(ac, dest, t, 240 + r()*40, 180, 0.22, 0.04, "sawtooth");
        burst(ac, dest, t, 350, 1, 0.2, 0.018);
        t += 0.3 + r()*0.12;
      }
      return t - t0 + 0.15;
    } }
};

export { ICONS, ICON_KEY, speciesIcon, PSTYLE, note, burst, SPECIES, CRITTER_VOICES };
