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
/* How a perched bird carries itself between songs: the rate and depth of its
   breathing, of the glances it takes, of the flick of its tail, and the pulse of
   the bill while it sings. These were literals in two places — once in the
   window and once again in the bestiary — which meant a number tuned against a
   card at close range was not the number the window would use. Now both read
   this, so a change here shows up in the same motion on both pages.

   Rates are radians a second; `sharp` raises a sine to a power to turn a smooth
   swell into an occasional twitch. */
const ANIM = {
  breathRate: 2.0,                     // the slow rise and fall of the body
  headRate: 0.8, headAmt: 0.20,        // an idle turn of the head
  lookRate: 0.5, lookSharp: 6, lookAmt: 0.5,   // and now and then a longer look
  tailRate: 1.15, tailSharp: 8,        // a tail flicked, not waved
  settle: 0.55,                        // seconds of wing-settling on arrival
  singBase: 0.3, singAmt: 0.7, singRate: 11    // the bill through a phrase
};

/* How the four-footed things carry themselves.

   A limb driven by a single sine has two poses in it — hard forward and hard
   back — and everything between is an even slide from the one to the other.
   Nothing walks like that. A real foot spends most of its stride planted,
   travelling backwards at exactly the speed the ground goes past, and is then
   snatched forward through the air in whatever time is left. That difference
   is the whole of why an animal looks to weigh something: the plant is the
   part that carries it.

   So each gait below is written out as frames around one stride, and the
   sampler runs a curve through them. A foot frame is

     [u, x, y]   u  where in the stride it falls, 0 to 1
                 x  how far forward the foot is, −1 hard back to +1 hard forward
                 y  how far it is clear of the ground, 0 planted to 1 at the
                    top of the swing

   and a body frame is [u, …channels], the channels named in `chan` — the
   parts of a gait that are not in the feet at all: the rise and fall of the
   chest, the nod of the head, the arch of the back over a leap. `feet` is
   where each leg starts in the stride, in the painters' own leg order, and it
   is what makes a walk a walk and a trot a trot.

   Rates stay with the animals, in scene.js: a frame table says what the shape
   of a stride is, not how many of them go by in a second. */
const GAIT = {
  /* A deer's walk. Four beats — a hoof set down every quarter — and never
     fewer than two of them on the ground at once. The stance runs three fifths
     of the cycle; the swing is over in the rest. The back rises twice a
     stride and the head nods once, which is the ungulate tell. */
  walk: {
    feet: [0, 0.5, 0.75, 0.25],
    chan: ["rise", "nod", "pitch"],
    path: [
      [0.00,  1.00, 0.00],      // set down, out in front of the shoulder
      [0.16,  0.55, 0.00],      // and the ground goes past under it
      [0.34,  0.02, 0.00],
      [0.50, -0.55, 0.00],
      [0.62, -1.00, 0.00],      // the toe leaves last, well behind the hip
      [0.70, -0.74, 0.55],      // snatched up, the joint folding
      [0.79, -0.10, 1.00],      // through the top of the swing
      [0.88,  0.66, 0.72],
      [0.95,  1.04, 0.22]       // over-reaches, then hangs before it lands
    ],
    body: [
      [0.00, 1.00,  0.85,  0.06],
      [0.12, 0.55,  1.00,  0.02],
      [0.25, 0.00,  0.55, -0.05],
      [0.37, 0.42, -0.10, -0.02],
      [0.50, 1.00, -0.75,  0.06],
      [0.62, 0.52, -1.00,  0.02],
      [0.75, 0.00, -0.50, -0.05],
      [0.87, 0.45,  0.15, -0.02]
    ]
  },
  /* A fox at the trot: two beats, the diagonal pairs swinging together, and a
     moment in the middle where none of the four is down. The stance is short
     because the animal is travelling. */
  trot: {
    feet: [0, 0.5, 0.5, 0],
    chan: ["rise", "nod", "pitch"],
    path: [
      [0.00,  1.00, 0.06],      // reaching down onto it
      [0.07,  0.76, 0.00],
      [0.26,  0.02, 0.00],
      [0.45, -1.00, 0.00],      // and away, late and low
      [0.54, -0.70, 0.78],      // the hock snaps up
      [0.66,  0.12, 1.00],
      [0.80,  0.82, 0.68],
      [0.92,  1.10, 0.24]
    ],
    body: [
      [0.00, 0.15,  0.30,  0.05],
      [0.14, 1.00,  0.00, -0.03],
      [0.30, 0.55, -0.35,  0.02],
      [0.50, 0.15, -0.30,  0.05],
      [0.64, 1.00,  0.00, -0.03],
      [0.80, 0.55,  0.35,  0.02]
    ]
  },
  /* A cat's walk — the same four beats as the deer's, but slower off the
     ground and higher over it, and with the shoulder blade riding up through
     the back at every step. */
  pad: {
    feet: [0, 0.5, 0.25, 0.75],
    chan: ["rise", "nod", "pitch"],
    path: [
      [0.00,  1.00, 0.00],
      [0.18,  0.46, 0.00],
      [0.42, -0.28, 0.00],
      [0.68, -1.00, 0.00],      // a long stance: it is in no hurry
      [0.75, -0.62, 0.72],
      [0.83,  0.06, 1.00],      // the paw carried high and folded
      [0.92,  0.78, 0.60],
      [0.97,  1.06, 0.18]
    ],
    body: [
      [0.00, 1.00,  0.60,  0.04],
      [0.14, 0.40,  1.00,  0.00],
      [0.28, 0.05,  0.40, -0.04],
      [0.40, 0.60, -0.20,  0.00],
      [0.54, 1.00, -0.65,  0.04],
      [0.68, 0.38, -1.00,  0.00],
      [0.82, 0.05, -0.35, -0.04],
      [0.92, 0.55,  0.10,  0.00]
    ]
  },
  /* A badger: short legs under a great deal of animal, so the stance is long,
     the swing barely clears the leaf-litter, and the whole body rolls from
     shoulder to shoulder as it goes. */
  trundle: {
    feet: [0, 0.5, 0.28, 0.78],
    chan: ["rise", "nod", "pitch"],
    path: [
      [0.00,  1.00, 0.00],
      [0.24,  0.28, 0.00],
      [0.48, -0.44, 0.00],
      [0.70, -1.00, 0.00],
      [0.78, -0.56, 0.52],
      [0.86,  0.18, 0.85],
      [0.93,  0.86, 0.48],
      [0.98,  1.02, 0.10]
    ],
    body: [
      [0.00, 1.00,  0.70,  0.05],
      [0.13, 0.35,  1.00,  0.00],
      [0.26, 0.00,  0.50, -0.04],
      [0.38, 0.50,  0.00,  0.00],
      [0.50, 1.00, -0.70,  0.05],
      [0.63, 0.35, -1.00,  0.00],
      [0.76, 0.00, -0.50, -0.04],
      [0.88, 0.50,  0.00,  0.00]
    ]
  },
  /* A hedgehog's scurry — very short, very quick steps, the body rocking
     forward over each one. Almost all swing and almost no reach. */
  scurry: {
    feet: [0, 0.5, 0.72, 0.22],
    chan: ["rise", "nod", "pitch"],
    path: [
      [0.00,  1.00, 0.00],
      [0.20,  0.20, 0.00],
      [0.40, -0.62, 0.00],
      [0.55, -1.00, 0.00],
      [0.64, -0.44, 0.68],
      [0.74,  0.32, 1.00],
      [0.86,  0.92, 0.52],
      [0.94,  1.06, 0.14]
    ],
    body: [
      [0.00, 1.00,  0.60,  0.05],
      [0.14, 0.30,  1.00,  0.00],
      [0.28, 0.00,  0.40, -0.04],
      [0.40, 0.55,  0.00,  0.00],
      [0.52, 1.00, -0.60,  0.05],
      [0.66, 0.30, -1.00,  0.00],
      [0.80, 0.00, -0.40, -0.04],
      [0.90, 0.55,  0.00,  0.00]
    ]
  },

  /* ---- the leaping gaits: no feet to phase, the whole animal is the cycle ----

     rise    how far off the ground it is
     stretch 0 gathered into itself, 1 at full length
     fore    the forelegs, −1 folded under the chest to +1 reaching ahead
     hind    the hind legs, −1 tucked right under to +1 driven out behind
     arch    the back, +1 rounded up over the hips, −1 hollowed in flight
     tilt    the pitch of the whole body, positive nose-up          */

  /* A deer's bound: the rocking-horse leap, all the drive out of the hind. */
  bound: {
    chan: ["rise", "stretch", "fore", "hind", "arch", "tilt"],
    body: [
      [0.00, 0.00, 0.05, -0.55, -0.85,  0.80,  0.16],   // gathered, all four under it
      [0.09, 0.10, 0.35, -0.15, -0.30,  0.55,  0.34],   // the hind drives
      [0.22, 0.62, 0.85,  0.55,  0.60, -0.15,  0.26],   // clear of the ground
      [0.36, 0.95, 1.00,  0.90,  1.00, -0.55,  0.05],   // the full stretch
      [0.50, 1.00, 0.90,  1.00,  0.80, -0.45, -0.12],   // the top of the arc
      [0.66, 0.66, 0.55,  0.95,  0.15,  0.10, -0.22],   // the forefeet reach down
      [0.80, 0.20, 0.20,  0.55, -0.45,  0.55, -0.08],   // and take the landing
      [0.91, 0.03, 0.02,  0.00, -0.80,  0.78,  0.08]    // the hind swing through
    ]
  },
  /* A rabbit's hop: shorter, rounder and quicker to gather than a hare's, and
     it lands on its forefeet with the hind coming through outside them. */
  hop: {
    chan: ["rise", "stretch", "fore", "hind", "arch", "tilt"],
    body: [
      [0.00, 0.00, 0.00, -0.40, -1.00,  1.00,  0.10],
      [0.10, 0.16, 0.42, -0.05, -0.20,  0.60,  0.30],
      [0.24, 0.72, 0.90,  0.60,  0.75, -0.30,  0.20],
      [0.38, 1.00, 1.00,  0.95,  1.00, -0.55, -0.02],
      [0.52, 0.86, 0.82,  1.00,  0.55, -0.30, -0.20],
      [0.66, 0.40, 0.42,  0.90, -0.10,  0.30, -0.16],
      [0.80, 0.08, 0.12,  0.50, -0.65,  0.80,  0.00],
      [0.90, 0.00, 0.02,  0.00, -0.92,  0.95,  0.06]
    ]
  },
  /* A hare's lope: flatter, longer and far faster over the ground — it eats
     the field rather than crossing it. */
  lope: {
    chan: ["rise", "stretch", "fore", "hind", "arch", "tilt"],
    body: [
      [0.00, 0.00, 0.10, -0.30, -0.90,  0.85,  0.06],
      [0.08, 0.14, 0.55,  0.10, -0.05,  0.40,  0.20],
      [0.20, 0.62, 1.00,  0.70,  0.90, -0.45,  0.12],
      [0.34, 0.80, 1.00,  1.00,  1.00, -0.60, -0.04],
      [0.50, 0.72, 0.86,  1.00,  0.60, -0.40, -0.16],
      [0.66, 0.34, 0.44,  0.85, -0.05,  0.25, -0.14],
      [0.80, 0.06, 0.14,  0.42, -0.60,  0.72,  0.00],
      [0.91, 0.00, 0.04, -0.05, -0.86,  0.88,  0.04]
    ]
  },
  /* A squirrel's bound. It goes over the ground in a series of arches, the
     hind feet landing outside and ahead of the fore, and the tail runs a wave
     a beat behind the body — which is the thing you actually see. */
  scamper: {
    chan: ["rise", "stretch", "fore", "hind", "arch", "tilt", "tail"],
    body: [
      [0.00, 0.00, 0.05, -0.30, -1.00,  1.00,  0.12,  0.85],
      [0.10, 0.24, 0.50,  0.15, -0.10,  0.50,  0.34,  1.00],
      [0.24, 0.80, 0.95,  0.75,  0.85, -0.35,  0.24,  0.40],
      [0.38, 1.00, 1.00,  1.00,  1.00, -0.60,  0.00, -0.40],
      [0.52, 0.82, 0.80,  0.95,  0.50, -0.25, -0.22, -0.95],
      [0.66, 0.36, 0.36,  0.80, -0.20,  0.40, -0.20, -0.70],
      [0.80, 0.06, 0.10,  0.35, -0.70,  0.85, -0.02,  0.10],
      [0.90, 0.00, 0.00, -0.05, -0.95,  0.98,  0.08,  0.60]
    ]
  },

  /* ---- and the standing things, which are cycles too ---- */

  /* Grazing: a bite taken, then chewed — twice, three times — with the head
     drifting along the sward between mouthfuls and lifting a little now and
     then without ever coming up. */
  graze: {
    chan: ["dip", "chew", "sway"],
    body: [
      [0.00, 1.00, 0.00,  0.00],   // the muzzle in the grass
      [0.10, 1.00, 0.35,  0.10],   // a bite taken
      [0.22, 0.86, 1.00,  0.16],   // and chewed, the head just clear
      [0.36, 0.90, 0.20,  0.06],
      [0.48, 0.98, 0.85, -0.08],   // and again
      [0.62, 0.92, 0.15, -0.16],
      [0.74, 0.70, 0.55, -0.10],   // the head lifts, still working
      [0.88, 0.94, 0.05,  0.06]
    ]
  },
  /* A wash: the paw brought up, licked twice, swept back over the ear, and
     down. Cats and rabbits both do it, and both do it in that order. */
  groom: {
    chan: ["reach", "lick", "turn"],
    body: [
      [0.00, 0.00, 0.00,  0.00],
      [0.12, 0.85, 0.10,  0.15],   // the paw comes up to the mouth
      [0.24, 1.00, 1.00,  0.20],   // and is licked
      [0.34, 0.96, 0.15,  0.22],
      [0.44, 1.00, 0.95,  0.18],   // twice
      [0.56, 0.90, 0.20, -0.10],   // then swept back over the ear
      [0.70, 0.55, 0.60, -0.35],
      [0.84, 0.20, 0.10, -0.15]
    ]
  },
  /* One stroke of a digging animal: the forepaws reach out, drag back through
     the earth, and throw the spoil out behind between the hind legs. */
  dig: {
    chan: ["reach", "pull", "throw"],
    body: [
      [0.00,  1.00, 0.00, 0.00],   // out at arm's length
      [0.18,  0.55, 0.65, 0.10],   // dragged back through it
      [0.34, -0.20, 1.00, 0.45],
      [0.46, -0.65, 0.75, 1.00],   // and thrown out behind
      [0.60, -0.40, 0.25, 0.55],
      [0.74,  0.25, 0.05, 0.15],
      [0.88,  0.85, 0.00, 0.02]    // reaching out again
    ]
  },
  /* An otter swimming: a wave that travels the length of it. The back breaks
     the surface first and highest, the tail follows a beat later, and between
     the two there is a flat moment where almost nothing shows. */
  swim: {
    chan: ["hump", "tail", "head"],
    body: [
      [0.00, 0.34, 0.26, 0.44],
      [0.12, 0.66, 0.20, 0.74],
      [0.26, 1.00, 0.32, 1.00],    // the back at its highest
      [0.40, 0.80, 0.76, 0.76],
      [0.54, 0.48, 1.00, 0.40],    // the tail breaks as the back goes down
      [0.68, 0.32, 0.72, 0.22],
      [0.82, 0.28, 0.38, 0.26],    // low in the water, but never gone: an otter
      [0.92, 0.30, 0.28, 0.34]     // that vanished would be a dive, not a swim
    ]
  },
  /* A porpoise's roll. Not a leap and not a sine: the snout breaks, the back
     wheels over in about a fifth of the cycle, the fin comes up last and goes
     down last, and then the animal is gone for a long while. */
  roll: {
    chan: ["arc", "pitch", "fluke"],
    body: [
      [0.00, -0.85, -0.10, 0.00],  // deep, and running level
      [0.16, -0.40,  0.30, 0.00],  // rising, nose up
      [0.26,  0.20,  0.34, 0.00],  // the snout breaks
      [0.36,  0.86,  0.16, 0.00],  // the back at the top of the roll
      [0.46,  1.00, -0.10, 0.05],
      [0.56,  0.80, -0.30, 0.00],  // wheeling over: the fin goes down
      [0.66,  0.34, -0.38, 0.26],  // and only once the back has gone under do
      [0.74, -0.15, -0.30, 0.90],  // the flukes come up out of the hole it
      [0.80, -0.45, -0.24, 1.00],  // made — the last of the animal you see
      [0.86, -0.62, -0.20, 0.52],
      [0.92, -0.80, -0.14, 0.09]
    ]
  },
  /* A pipistrelle's wingbeat: the downstroke is a third of the cycle and the
     recovery is the rest of it, with the wing half folded on the way up so it
     costs the animal nothing. That asymmetry is the flutter you see. */
  flit: {
    chan: ["beat", "fold"],
    body: [
      [0.00,  1.00, 0.10],         // at the top
      [0.14,  0.10, 0.00],         // driven down, the membrane taut
      [0.26, -0.85, 0.05],
      [0.36, -1.00, 0.35],         // the bottom of the stroke
      [0.52, -0.30, 0.85],         // gathered in and lifted, half folded
      [0.70,  0.55, 0.70],
      [0.86,  0.95, 0.30]
    ]
  },

  /* ---- wings ----

     A wingbeat sampled from one sine is a wing sliding up and down a line,
     which is not what any bird does. The downstroke is the working half: it is
     quicker than the recovery, the wing is held at full span through it, and
     the tip travels *forward* as well as down. Coming back up the wrist flexes
     and the wing shortens, so it costs the bird less — and the tip sweeps
     back. Between them the tip describes a flattened figure of eight, which is
     the thing that reads as flight rather than as flapping.

       beat   +1 at the top of the upstroke, −1 driven fully down
       span   1 at full stretch, 0 folded right in — scales the wing's length
       sweep  +1 the tip carried forward of the shoulder, −1 swept back  */

  /* Gull, tern, heron, goose, owl: unhurried and deep, the wing barely
     shortening because there is no hurry to get it back up. */
  beatSlow: {
    chan: ["beat", "span", "sweep"],
    body: [
      [0.00,  1.00, 0.96,  0.30],  // at the top, cocked and reaching forward
      [0.10,  0.62, 1.00,  0.55],  // and away: the wing goes out to full span
      [0.26, -0.35, 1.00,  0.40],  // through the middle of the drive, fastest
      [0.42, -0.95, 0.96, -0.10],
      [0.52, -1.00, 0.88, -0.45],  // the bottom, the tip swept back under
      [0.66, -0.55, 0.70, -0.60],  // the wrist flexes and the wing comes up short
      [0.80,  0.20, 0.72, -0.30],
      [0.92,  0.82, 0.86,  0.05]
    ]
  },
  /* Small birds, a cuckoo, a pigeon, a duck: a snapping downstroke over in a
     third of the beat and a recovery with the wing half closed. */
  beatQuick: {
    chan: ["beat", "span", "sweep"],
    body: [
      [0.00,  1.00, 0.90,  0.40],
      [0.08,  0.35, 1.00,  0.60],  // straight into the drive
      [0.20, -0.62, 1.00,  0.35],
      [0.32, -1.00, 0.94, -0.20],  // the bottom of it
      [0.44, -0.70, 0.62, -0.60],  // snatched up half closed
      [0.60, -0.05, 0.48, -0.70],
      [0.76,  0.60, 0.58, -0.35],
      [0.90,  0.95, 0.78,  0.10]
    ]
  },
  /* A lark holding its song-flight, a kestrel winnowing, a swift: shallow and
     far too fast to fold anything. Almost symmetrical, and almost a blur. */
  beatWhir: {
    chan: ["beat", "span", "sweep"],
    body: [
      [0.00,  1.00, 0.94,  0.25],
      [0.14,  0.30, 1.00,  0.45],
      [0.30, -0.60, 1.00,  0.20],
      [0.44, -1.00, 0.96, -0.20],
      [0.58, -0.50, 0.88, -0.42],
      [0.72,  0.25, 0.86, -0.30],
      [0.88,  0.80, 0.90,  0.00]
    ]
  },

  /* ---- and what birds do when they are not flying ---- */

  /* The bill through one note. It is thrown open at the start and held there
     while the note runs, rather than swinging evenly shut and open again —
     every singer in the window reads this, through ANIM.singRate. */
  song: {
    chan: ["gape"],
    body: [
      [0.00, 0.30],                // just parted
      [0.10, 0.95],                // thrown open on the note
      [0.22, 1.00],
      [0.40, 0.78],                // and held there while it runs
      [0.56, 0.90],
      [0.70, 0.45],                // closing
      [0.86, 0.32]
    ]
  },
  /* A peck. Down fast, a beat on the ground while the thing is actually seized
     — which is the part a sine leaves out and the part that makes it read as
     eating — then up, and the head thrown back to swallow. */
  peck: {
    chan: ["dip", "seize", "gulp"],
    body: [
      [0.00, 0.00, 0.00, 0.00],    // head up, having seen it
      [0.16, 0.72, 0.00, 0.00],    // straight down
      [0.26, 1.00, 0.35, 0.00],
      [0.36, 1.00, 1.00, 0.00],    // and taken
      [0.50, 0.62, 0.55, 0.10],    // lifting
      [0.62, 0.15, 0.10, 0.62],    // thrown back to send it down
      [0.74, 0.05, 0.00, 0.30],
      [0.88, 0.02, 0.00, 0.05]
    ]
  },
  /* A small bird's hop: both feet at once. It gathers, springs, tucks the feet
     right up under it, and swings them forward again to land. */
  birdHop: {
    chan: ["rise", "tuck", "tilt", "reach"],
    body: [
      [0.00, 0.00, 0.00,  0.10, 0.00],   // crouched over its feet
      [0.10, 0.18, 0.35,  0.30, 0.20],   // the spring
      [0.26, 0.72, 0.95,  0.22, 0.60],
      [0.42, 1.00, 1.00,  0.00, 0.85],   // the top, feet right up under it
      [0.58, 0.86, 0.90, -0.18, 1.00],   // and swung forward to land
      [0.74, 0.40, 0.45, -0.22, 0.75],
      [0.88, 0.06, 0.08, -0.05, 0.25]
    ]
  },
  /* A walking bird — a pigeon, a starling, a lapwing. Two steps to the cycle,
     and with them the head-bob, which is not a bob at all: the head is thrown
     forward and then held *still in the air* while the body walks on under it,
     and only darts forward again at the last moment. `head` is the head's
     place relative to the body, so the hold is a steady slide backwards and
     the dart is the jump between two frames set close together. No sine has
     that in it, and it is the whole of what tells a walking bird from a
     rocking toy. */
  strut: {
    feet: [0, 0.5],
    chan: ["rise", "head", "pitch"],
    path: [
      [0.00,  1.00, 0.00],
      [0.20,  0.40, 0.00],
      [0.42, -0.35, 0.00],
      [0.60, -1.00, 0.00],       // a long stance under a light bird
      [0.68, -0.55, 0.62],
      [0.78,  0.15, 1.00],
      [0.88,  0.80, 0.62],
      [0.95,  1.05, 0.18]
    ],
    body: [
      [0.00, 0.32,  1.00,  0.03],   // the head has just arrived out in front
      [0.10, 0.78,  0.52,  0.00],   // and now holds, while the body catches up
      [0.22, 1.00, -0.12, -0.02],
      [0.34, 0.74, -0.74,  0.00],
      [0.44, 0.36, -1.00,  0.03],   // as far back on the shoulders as it goes
      [0.47, 0.33, -0.60,  0.04],   // breaking forward
      [0.50, 0.32,  1.00,  0.03],   // the dart, and stopped dead
      [0.60, 0.78,  0.52,  0.00],
      [0.72, 1.00, -0.12, -0.02],
      [0.84, 0.74, -0.74,  0.00],
      [0.94, 0.36, -1.00,  0.03],
      [0.97, 0.33, -0.60,  0.04]
    ]
  },
  /* A wader working the tideline. Most of the cycle it is simply walking with
     the bill up; then the bill goes in, is worked about in the wet sand, and
     comes out again. The waiting is as much of it as the probing. */
  probe: {
    chan: ["dip", "work"],
    body: [
      [0.00, 0.00,  0.00],
      [0.30, 0.00,  0.00],       // bill up: most of the cycle is walking
      [0.42, 0.30,  0.00],
      [0.52, 0.95,  0.20],       // in
      [0.60, 1.00,  1.00],       // and worked about in it
      [0.68, 1.00, -0.80],
      [0.76, 0.90,  0.40],
      [0.86, 0.35,  0.00],       // out again
      [0.94, 0.05,  0.00]
    ]
  },
  /* One blow of a woodpecker's drum: the head snaps at the wood and comes back
     off it more slowly, so a roll of them reads as blows and not as a buzz. */
  drum: {
    chan: ["hit"],
    body: [
      [0.00, 0.00],              // head back
      [0.10, 0.55],
      [0.18, 1.00],              // contact
      [0.24, 0.95],
      [0.40, 0.42],              // and off it again
      [0.62, 0.12],
      [0.82, 0.02]
    ]
  },
  /* A butterfly. The wings are clapped together over the back and swept down
     and open slowly, which is why it climbs in little steps rather than flying
     level: the body rises with the downstroke and falls back on the clap. */
  flutter: {
    chan: ["spread", "lift"],
    body: [
      [0.00, 0.10,  0.85],       // wings together over the back
      [0.14, 0.48,  0.35],       // opening as they start down
      [0.32, 0.95, -0.45],
      [0.46, 1.00, -1.00],       // full spread at the bottom of the stroke
      [0.60, 0.86, -0.55],
      [0.74, 0.44,  0.30],       // and clapped back up, quickly
      [0.88, 0.16,  0.70]
    ]
  },
  /* A duck under way: a stroke of the feet drives it forward and lifts the
     chest, and then it glides and settles back while the head nods with it. */
  paddle: {
    chan: ["rock", "surge", "head"],
    body: [
      [0.00,  0.00,  0.10,  0.00],
      [0.14,  0.62,  0.85,  0.40],   // the stroke
      [0.30,  1.00,  1.00,  0.90],
      [0.46,  0.72,  0.45,  1.00],
      [0.60,  0.05, -0.05,  0.55],   // and the glide
      [0.76, -0.60, -0.35,  0.00],
      [0.90, -0.32, -0.12, -0.25]
    ]
  },
  /* A cow's tail. It hangs, and then it does not: one hard slap at a fly and a
     lazy swing back. Half the cycle is the tail doing nothing at all. */
  swish: {
    chan: ["swing"],
    body: [
      [0.00,  0.05],
      [0.18,  0.00],
      [0.30,  0.90],             // the slap
      [0.40,  0.30],
      [0.50, -0.72],             // and back the other way
      [0.62, -0.12],
      [0.76,  0.22],
      [0.88,  0.04]
    ]
  },

  /* ---- and the world the animals are in ----

     The same argument holds for weather and water. A gust of wind summed out
     of two sines arrives on a metronome — you can count them — and everything
     growing answers it at exactly the same instant, with no weight and no
     spring. What a gust actually does is: nothing, for a long while; then it
     comes on fast, holds raggedly at the top, and dies away slowly. */
  gust: {
    chan: ["force"],
    body: [
      [0.00, 0.10],              // the lull, and most of the cycle is lull
      [0.12, 0.05],
      [0.24, 0.07],
      [0.34, 0.14],
      [0.42, 0.58],              // it arrives quickly
      [0.48, 0.94],
      [0.54, 0.76],              // and is never steady at the top
      [0.60, 1.00],
      [0.67, 0.72],
      [0.76, 0.86],
      [0.795, 0.62],
      [0.815, 0.15],             // and then it simply drops, which is the whole
      [0.86, 0.11],              // point: the grass is left to spring back on
      [0.94, 0.07]               // its own, and goes past upright doing it
    ]
  },
  /* A bird's glance. Birds do not sweep their heads: they snap to a new place,
     hold it dead still while they look, and snap again — and the held part is
     most of it. The frames are the stations; the jumps between them are pairs
     set close together, which is the only way to write a movement that has no
     middle. Every perched bird in the window reads this. */
  glance: {
    chan: ["turn"],
    body: [
      [0.00,  0.00],
      [0.20,  0.02],             // held
      [0.24,  0.55],             // and away
      [0.27,  0.95],
      [0.30,  1.00],
      [0.52,  0.98],             // held again, a good while
      [0.56,  0.30],
      [0.59, -0.55],             // back past centre, the other way
      [0.62, -0.85],
      [0.80, -0.88],             // and held there
      [0.84, -0.40],
      [0.88, -0.02]
    ]
  },
  /* A blink. Down like a shutter, shut for an instant, and opened again more
     slowly — never the even triangle it was. */
  blink: {
    chan: ["lid"],
    body: [
      [0.00, 0.00],
      [0.14, 0.75],              // down fast
      [0.22, 1.00],
      [0.34, 1.00],              // and shut for a moment
      [0.52, 0.72],              // opening, slower
      [0.74, 0.30],
      [0.90, 0.06]
    ]
  },
  /* The swash: one wave running up the sand. It chases up fast and drains away
     slowly, and the foam thins as it goes — a sine has it going up and coming
     back at the same speed, which is the one thing water never does. */
  swash: {
    chan: ["reach", "foam"],
    body: [
      [0.00, 0.00, 0.00],
      [0.06, 0.42, 0.85],        // the wave breaks and runs
      [0.12, 0.78, 1.00],
      [0.20, 0.97, 0.90],
      [0.26, 1.00, 0.72],        // the top of the run, and it hangs there
      [0.34, 0.96, 0.55],
      [0.48, 0.78, 0.38],        // draining back
      [0.64, 0.52, 0.24],
      [0.80, 0.26, 0.12],
      [0.92, 0.08, 0.04]
    ]
  },
  /* A glint off moving water, and a star seen through a mile of it. Neither
     flashes on a metronome: the facet catches, loses it, catches again a
     moment later, and is then dark for a good while. Two unequal flashes to
     the cycle, which is enough to stop the eye finding the beat. */
  glint: {
    chan: ["lit"],
    body: [
      [0.00, 0.06],
      [0.08, 0.02],
      [0.16, 0.88],              // caught
      [0.21, 1.00],
      [0.27, 0.35],
      [0.33, 0.05],
      [0.44, 0.62],              // and again, smaller and sooner
      [0.49, 0.70],
      [0.56, 0.10],
      [0.68, 0.02],
      [0.84, 0.04]               // then dark
    ]
  },
  /* A firefly's flash: it comes up fast and dies away slowly, which is what
     makes it read as a light going out rather than a lamp on a dimmer. */
  flash: {
    chan: ["lit"],
    body: [
      [0.00, 0.00],
      [0.06, 0.55],              // up, almost at once
      [0.11, 1.00],
      [0.18, 0.86],
      [0.30, 0.48],              // and out, slowly
      [0.44, 0.20],
      [0.60, 0.06],
      [0.80, 0.00]
    ]
  },
  /* A stroke of lightning, seen. It is never one flash: the channel is struck
     several times in a tenth of a second or so, which is why it flickers, and
     what is left afterwards is a much fainter glow in the cloud. */
  strike: {
    chan: ["lit"],
    body: [
      [0.00, 0.00],
      [0.03, 1.00],              // the first return stroke
      [0.09, 0.22],
      [0.14, 0.86],              // and the second
      [0.20, 0.16],
      [0.26, 0.52],              // a third, weaker
      [0.34, 0.10],
      [0.50, 0.05],              // the cloud goes on glowing for a moment
      [0.72, 0.02],
      [0.90, 0.00]
    ]
  },
  /* A cloud does not cross the sky unchanged. It builds, is drawn out and
     flattened by the wind it is riding, and thins away again — slowly enough
     that you only notice having looked away and looked back. Never to nothing:
     a cloud that vanished mid-sky would be a worse lie than one that never
     moved. */
  cloud: {
    chan: ["swell", "depth"],
    body: [
      [0.00, 0.55, 0.62],
      [0.14, 0.72, 0.84],
      [0.30, 0.95, 1.00],        // built up
      [0.44, 1.00, 0.90],
      [0.58, 0.92, 0.72],        // drawn out, and flattening as it goes
      [0.72, 0.78, 0.52],
      [0.86, 0.62, 0.56]
    ]
  },
  /* A puff of smoke or vent steam leaving its chimney: it goes up quickly
     while it is still hot, slows as it cools and mixes, spreads as it slows,
     and thins away. Age runs 0 to 1 over the puff's whole life. */
  plume: {
    chan: ["rise", "spread", "fade"],
    body: [
      [0.00, 0.00, 0.05, 0.00],  // out of the stack, and not yet anything
      [0.06, 0.14, 0.13, 0.60],
      [0.13, 0.28, 0.23, 0.94],  // full while it is still hot and tight
      [0.22, 0.44, 0.35, 1.00],
      [0.33, 0.59, 0.48, 0.90],
      [0.45, 0.71, 0.61, 0.74],  // slowing, spreading, going over downwind
      [0.57, 0.81, 0.73, 0.56],
      [0.69, 0.89, 0.83, 0.38],
      [0.80, 0.94, 0.91, 0.21],
      [0.90, 0.98, 0.97, 0.07],
      [0.96, 1.00, 1.00, 0.00]   // and gone before it comes round again
    ]
  }
};

/* Sample a frame table at u — a Hermite through the frames, each one's tangent
   taken from its neighbours either side, so the curve passes through every
   frame written above and closes on itself without a seam at u = 0. The frames
   need not be evenly spaced, because a stride's interesting moments are not.

   `out` is filled with the frame's channels and returned. Callers hand in an
   array and reuse it: this runs four times an animal a frame. */
function gaitSample(keys, u, out) {
  const n = keys.length;
  u -= Math.floor(u);
  let i = n - 1;
  for (let k = 0; k < n; k++) { if (keys[k][0] <= u) i = k; else break; }
  const j = (i + 1) % n, h = (i - 1 + n) % n, g = (j + 1) % n;
  const span = (a, b) => { const d = keys[b][0] - keys[a][0]; return d >= 0 ? d : d + 1; };
  const d0 = span(h, i) || 1, d1 = span(i, j) || 1, d2 = span(j, g) || 1;
  let f = u - keys[i][0]; if (f < 0) f += 1;
  const t = f/d1, t2 = t*t, t3 = t2*t;
  const h00 = 2*t3 - 3*t2 + 1, h10 = t3 - 2*t2 + t;
  const h01 = -2*t3 + 3*t2, h11 = t3 - t2;
  for (let k = 1; k < keys[i].length; k++) {
    const vi = keys[i][k], vj = keys[j][k];
    const mi = (vj - keys[h][k])/(d0 + d1), mj = (keys[g][k] - vi)/(d1 + d2);
    out[k - 1] = h00*vi + h10*d1*mi + h01*vj + h11*d1*mj;
  }
  return out;
}

/* Where one foot of a footfall gait is: out[0] how far forward, out[1] how far
   clear of the ground. The lift is held at or above nothing, because a curve
   drawn tight through a long flat stance overshoots a little either side of
   it, and a hoof through the turf is worse than a hoof a shade too flat. */
function gaitFoot(g, u, out) {
  gaitSample(g.path, u, out);
  if (out[1] < 0) out[1] = 0;
  return out;
}

/* The whole-body frames of a gait, as an object keyed by the channel names —
   what a painter asks for by name, and what the scene needs in order to lift a
   contact shadow with the animal that casts it. */
const GAIT_SCRATCH = [];
function gaitPose(name, u) {
  const g = GAIT[name];
  gaitSample(g.body, u, GAIT_SCRATCH);
  const o = {};
  for (let k = 0; k < g.chan.length; k++) o[g.chan[k]] = GAIT_SCRATCH[k];
  return o;
}

/* One channel of one, without building the object for it. Most callers want
   the whole pose; the ones that want only a wingbeat's `beat` are the ones
   that run dozens of times a frame — a skein, a sky full of distant birds —
   and those are no place to be allocating. */
function gaitAt(name, u, chan) {
  const g = GAIT[name];
  gaitSample(g.body, u, GAIT_SCRATCH);
  return GAIT_SCRATCH[g.chan.indexOf(chan)];
}

const PSTYLE = {
  blackbird: { bill: 0.5, tail: 1.3, billTone: "amber", eyeRing: true },
  robin: { sc: 0.9, bill: 0.38, plump: 1.08, breast: true },
  greattit: { sc: 0.85, bill: 0.34, cap: true, cheek: true, bib: true, wingbar: true },
  chiffchaff: { sc: 0.82, bill: 0.36, brow: true },
  wren: { sc: 0.72, tailUp: true, tail: 0.72, bill: 0.42, plump: 1.12, barring: true },
  sparrow: { sc: 0.85, bill: 0.42, plump: 1.06, cap: true, bib: true, wingbar: true },
  reedwarbler: { sc: 0.85, bill: 0.48, brow: true },
  woodpigeon: { plump: 1.35, bill: 0.3, sc: 1.12, smallHead: true, neckPatch: true, walks: true },
  feralpigeon: { plump: 1.3, bill: 0.3, sc: 1.05, smallHead: true, sheen: true, wingbar: true, walks: true },
  crow: { sc: 1.2, bill: 0.72, plump: 1.05, billDeep: true, gloss: true, tail: 1.35 },
  magpie: { sc: 1.05, tail: 2.4, bill: 0.5, billDeep: true, shoulder: true, belly: true, gloss: true },
  songthrush: { sc: 0.95, bill: 0.45, plump: 1.05, speckles: true },
  chaffinch: { sc: 0.85, bill: 0.4, breast: true, wingbar: true },
  goldfinch: { sc: 0.75, bill: 0.35, face: true, wingbar: true },
  bluetit: { sc: 0.72, bill: 0.3, plump: 1.08, cap: true, capTone: "sage", cheek: true, wash: "amber" },
  dunnock: { sc: 0.8, bill: 0.35, barring: true },
  starling: { sc: 0.9, bill: 0.5, tail: 0.85, speckles: true, gloss: true, walks: true },
  nightingale: { sc: 0.88, bill: 0.4, plump: 1.02, tailTone: "amber", tail: 1.2 },
  yellowhammer: { sc: 0.85, bill: 0.38, wash: "amber", tail: 1.2 },
  greenfinch: { sc: 0.82, bill: 0.42, wash: "sage" },
  jay: { sc: 1.05, bill: 0.5, plump: 1.1, wingPatch: true },
  jackdaw: { sc: 1.0, bill: 0.5, plump: 1.02, billDeep: true, cap: true, neckPatch: true },
  raven: { sc: 1.45, bill: 0.85, plump: 1.1, billDeep: true, gloss: true, tail: 1.4 },
  collareddove: { sc: 1.0, bill: 0.3, plump: 1.2, smallHead: true, collar: true, walks: true },
  kingfisher: { sc: 0.78, bill: 0.95, plump: 1.15, tail: 0.5, breast: true, sheen: true },
  lapwing: { sc: 0.95, bill: 0.3, plump: 1.15, cap: true, belly: true, crest: true,
    gloss: true, walks: true }
};

/* Counter-singing — who answers a rival, and how readily.
   Neighbouring territory-holders answer each other back and forth across a
   boundary, each waiting for the other to finish before replying: the
   exchange tightens as it goes and then simply stops. Only species that
   really do this are listed, and the shyer ones sit low: a wood pigeon
   rarely bothers, a chiffchaff almost always does. Owls are the odd one
   out — the pair duet rather than compete, the male's hoot answered by the
   female's kewick — but the shape on the ear is the same. */
const COUNTERSING = {
  chiffchaff: 0.5, greattit: 0.45, blackbird: 0.4, wren: 0.4, robin: 0.4,
  nightingale: 0.4, owl: 0.45, songthrush: 0.35, chaffinch: 0.35,
  yellowhammer: 0.3, bluetit: 0.3, cuckoo: 0.3, dunnock: 0.25,
  reedwarbler: 0.25, greenfinch: 0.2, collareddove: 0.2, woodpigeon: 0.18
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

/* ---- Phrases, not notes ----------------------------------------------------
   A song is a line, not a pile: within one phrase the notes follow each other,
   they do not sound together. So one oscillator can sing the whole phrase —
   re-tuned at each onset, with the gain opened and shut around it — instead of
   a fresh oscillator and gain per note. A wren's trill drops from sixty-four
   nodes to two, a cricket's stridulation from a hundred and seventeen to three.
   Raising a heap of nodes in one go is exactly what makes the mix hiccup, so
   this is what keeps a busy meadow smooth.

   `ns` is [{ t, f0, f1, dur, peak }] in ascending t; any note that would run
   into the next is trimmed to fit, so a caller can hand over its own rhythm
   without doing the arithmetic. */
function noteTrain(ac, dest, ns, type) {
  if (!ns.length) return;
  const o = ac.createOscillator();
  o.type = type || "sine";
  const g = ac.createGain();
  const t0 = ns[0].t;
  g.gain.setValueAtTime(0.0001, t0);
  o.connect(g); g.connect(dest);
  let end = t0;
  for (let i = 0; i < ns.length; i++) {
    const n = ns[i], next = ns[i + 1];
    const d = next ? Math.max(0.01, Math.min(n.dur, next.t - n.t - 0.004)) : n.dur;
    o.frequency.setValueAtTime(Math.max(40, n.f0), n.t);
    o.frequency.exponentialRampToValueAtTime(Math.max(40, n.f1), n.t + d);
    g.gain.setValueAtTime(0.0001, n.t);
    g.gain.exponentialRampToValueAtTime(n.peak, n.t + Math.min(0.02, d*0.3));
    g.gain.exponentialRampToValueAtTime(0.0001, n.t + d);
    end = n.t + d;
  }
  o.start(t0); o.stop(end + 0.05);
}

/* The same trick for noise: a run of filtered pulses — a cricket's chirp, a
   magpie's rattle, a woodpecker's drum-roll — off one looping source through
   one band-pass and one gain. `ps` is [{ t, freq, dur, peak }] in ascending t. */
function pulseTrain(ac, dest, ps, q) {
  if (!ps.length) return;
  const buf = sharedNoise(ac);
  const t0 = ps[0].t, last = ps[ps.length - 1];
  const src = ac.createBufferSource();
  src.buffer = buf; src.loop = true;
  const bp = ac.createBiquadFilter();
  bp.type = "bandpass"; bp.Q.value = q;
  bp.frequency.setValueAtTime(ps[0].freq, t0);
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  for (let i = 0; i < ps.length; i++) {
    const p = ps[i], next = ps[i + 1];
    const d = next ? Math.max(0.006, Math.min(p.dur, next.t - p.t - 0.002)) : p.dur;
    bp.frequency.setValueAtTime(p.freq, p.t);
    g.gain.setValueAtTime(0.0001, p.t);
    g.gain.exponentialRampToValueAtTime(p.peak, p.t + Math.min(0.008, d*0.3));
    g.gain.exponentialRampToValueAtTime(0.0001, p.t + d);
  }
  src.connect(bp); bp.connect(g); g.connect(dest);
  src.start(t0, Math.random() * Math.max(0, buf.duration - 0.2));
  src.stop(last.t + last.dur + 0.08);
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
      const ns = [];
      const nn = 3 + Math.floor(r()*3);
      for (let i = 0; i < nn; i++) {
        const f = 1400 + r()*900;
        ns.push({ t, f0: f, f1: f*(0.78 + r()*0.5), dur: 0.15 + r()*0.13, peak: 0.05 });
        t += 0.19 + r()*0.15;
      }
      if (r() < 0.6) {
        ns.push({ t, f0: 2800 + r()*800, f1: 3500 + r()*900, dur: 0.12, peak: 0.028 });
        t += 0.16;
      }
      noteTrain(ac, dest, ns);
      return t - t0 + 0.2;
    } },
  { id: "greattit", name: "Great Tit", latin: "Parus major",
    desc: "the see-saw \u201cteacher, teacher\u201d song", tone: "sage", layer: "perch",
    habitats: ["meadow","forest","city"],
    weights: { dawn: 0.7, day: 0.55, dusk: 0.25, night: 0 }, base: 18,
    synth(ac, dest, t0, r) {
      const reps = 3 + Math.floor(r()*3);
      let t = t0;
      const ns = [];
      const fa = 3700 + r()*300, fb = 2750 + r()*250;
      for (let i = 0; i < reps; i++) {
        ns.push({ t, f0: fa, f1: fa*0.96, dur: 0.09, peak: 0.042 });
        ns.push({ t: t + 0.115, f0: fb, f1: fb*0.94, dur: 0.10, peak: 0.042 });
        t += 0.285;
      }
      noteTrain(ac, dest, ns);
      return t - t0 + 0.1;
    } },
  { id: "wren", name: "Eurasian Wren", latin: "Troglodytes troglodytes",
    desc: "an astonishing loud trill from a tiny body", tone: "amber", layer: "perch",
    habitats: ["meadow","forest","wetland"],
    weights: { dawn: 0.65, day: 0.45, dusk: 0.3, night: 0 }, base: 20,
    synth(ac, dest, t0, r) {
      let t = t0;
      const ns = [];
      const nn = 22 + Math.floor(r()*10);
      for (let i = 0; i < nn; i++) {
        const f = 3800 + ((i % 2) ? 700 : 0) + r()*500;
        ns.push({ t, f0: f, f1: f*0.94, dur: 0.03, peak: 0.032 });
        t += 0.033;
      }
      noteTrain(ac, dest, ns);
      return t - t0 + 0.1;
    } },
  { id: "chiffchaff", name: "Common Chiffchaff", latin: "Phylloscopus collybita",
    desc: "saying its own name, over and over", tone: "sage", layer: "perch",
    habitats: ["forest","meadow"],
    weights: { dawn: 0.5, day: 0.6, dusk: 0.2, night: 0 }, base: 22,
    synth(ac, dest, t0, r) {
      const reps = 5 + Math.floor(r()*5);
      let t = t0;
      const ns = [];
      for (let i = 0; i < reps; i++) {
        const f = (i % 2 ? 2450 : 2900) + r()*180;
        ns.push({ t, f0: f, f1: f*0.93, dur: 0.10, peak: 0.038 });
        t += 0.235 + r()*0.05;
      }
      noteTrain(ac, dest, ns);
      return t - t0 + 0.1;
    } },
  { id: "woodpigeon", name: "Common Wood Pigeon", latin: "Columba palumbus",
    desc: "a five-note coo, soft as upholstery", tone: "amber", layer: "perch",
    habitats: ["meadow","forest","city","wetland"],
    weights: { dawn: 0.5, day: 0.5, dusk: 0.4, night: 0.02 }, base: 24,
    synth(ac, dest, t0, r) {
      const seq = [[420, 0.26], [372, 0.4], [420, 0.24], [372, 0.2], [352, 0.2]];
      let t = t0;
      const ns = [];
      for (const [f, d] of seq) {
        ns.push({ t, f0: f + r()*14, f1: f*0.97, dur: d, peak: 0.055 });
        t += d + 0.06;
      }
      noteTrain(ac, dest, ns);
      return t - t0 + 0.1;
    } },
  { id: "cuckoo", name: "Common Cuckoo", latin: "Cuculus canorus",
    desc: "two falling notes across the whole valley", tone: "amber", layer: "far",
    habitats: ["meadow","forest","wetland"],
    weights: { dawn: 0.4, day: 0.3, dusk: 0.15, night: 0 }, base: 34,
    synth(ac, dest, t0, r) {
      let t = t0;
      const ns = [];
      const reps = 1 + Math.floor(r()*2);
      for (let i = 0; i < reps; i++) {
        ns.push({ t, f0: 742, f1: 726, dur: 0.22, peak: 0.05 });
        ns.push({ t: t + 0.42, f0: 592, f1: 578, dur: 0.26, peak: 0.05 });
        t += 1.1;
      }
      noteTrain(ac, dest, ns);
      return t - t0;
    } },
  { id: "robin", name: "European Robin", latin: "Erithacus rubecula",
    desc: "a thin silver warble, wistful at the edges", tone: "sage", layer: "perch",
    habitats: ["meadow","forest","city","wetland"],
    weights: { dawn: 0.7, day: 0.3, dusk: 0.75, night: 0.25 }, base: 17,
    synth(ac, dest, t0, r) {
      let t = t0;
      const ns = [];
      const nn = 6 + Math.floor(r()*4);
      for (let i = 0; i < nn; i++) {
        const f = 2100 + r()*1900;
        ns.push({ t, f0: f, f1: f*(0.6 + r()*0.8), dur: 0.07 + r()*0.12, peak: 0.035 });
        t += 0.1 + r()*0.16;
      }
      noteTrain(ac, dest, ns);
      return t - t0 + 0.15;
    } },
  { id: "skylark", name: "Eurasian Skylark", latin: "Alauda arvensis",
    desc: "a silver thread spun high out of sight", tone: "amber", layer: "air",
    habitats: ["meadow"],
    weights: { dawn: 0.6, day: 0.65, dusk: 0.15, night: 0 }, base: 30,
    synth(ac, dest, t0, r) {
      const dur = 2.4 + r()*1.6;
      let t = t0;
      const ns = [];
      while (t < t0 + dur) {
        const f = 3000 + r()*1500;
        ns.push({ t, f0: f, f1: f*(0.85 + r()*0.3), dur: 0.05, peak: 0.02 });
        t += 0.055;
      }
      noteTrain(ac, dest, ns);
      return dur + 0.1;
    } },
  { id: "woodpecker", name: "Great Spotted Woodpecker", latin: "Dendrocopos major",
    desc: "a drum-roll knocked out on dead wood", tone: "sage", layer: "perch",
    habitats: ["forest"],
    weights: { dawn: 0.55, day: 0.45, dusk: 0.1, night: 0 }, base: 26,
    synth(ac, dest, t0, r) {
      let t = t0, gap = 0.058;
      const ps = [];
      const nn = 13 + Math.floor(r()*5);
      for (let i = 0; i < nn; i++) {
        ps.push({ t, freq: 1100 + r()*300, dur: 0.022, peak: 0.085 });
        t += gap; gap *= 0.985;
      }
      pulseTrain(ac, dest, ps, 2);
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
      const ns = [{ t: t0, f0: 400, f1: 375, dur: 0.75, peak: 0.055 }];
      let t = t0 + 1.5 + r()*0.5;
      ns.push({ t, f0: 385, f1: 380, dur: 0.12, peak: 0.04 });
      t += 0.35;
      for (let i = 0; i < 3; i++) {
        ns.push({ t, f0: 400 - i*20, f1: 380 - i*22, dur: 0.4, peak: 0.05 });
        t += 0.42;
      }
      noteTrain(ac, dest, ns);
      return t - t0 + 0.3;
    } },
  { id: "cricket", name: "Field Cricket", latin: "Gryllus campestris",
    desc: "the night's own metronome, in the grass", tone: "sage", layer: "ground",
    habitats: ["meadow","wetland"], chorus: true,
    weights: { dawn: 0.05, day: 0.05, dusk: 0.55, night: 0.8 }, base: 12,
    synth(ac, dest, t0, r) {
      let t = t0;
      const ps = [];
      const chirps = 6 + Math.floor(r()*7);
      for (let i = 0; i < chirps; i++) {
        const f = 4400 + r()*300;
        for (let k = 0; k < 3; k++) ps.push({ t: t + k*0.028, freq: f, dur: 0.02, peak: 0.02 });
        t += 0.34 + r()*0.12;
      }
      pulseTrain(ac, dest, ps, 14);
      return t - t0;
    } },
  { id: "frog", name: "Common Frog", latin: "Rana temporaria",
    desc: "low creaking croaks along the water's edge", tone: "sage", layer: "ground",
    habitats: ["wetland","meadow"], hw: { meadow: 0.3 }, chorus: true,
    weights: { dawn: 0.15, day: 0.05, dusk: 0.6, night: 0.7 }, base: 14,
    synth(ac, dest, t0, r) {
      let t = t0;
      const ns = [];
      const nn = 8 + Math.floor(r()*7);
      const f = 95 + r()*40;
      for (let i = 0; i < nn; i++) {
        ns.push({ t, f0: f + r()*10, f1: f*0.92, dur: 0.055, peak: 0.05 });
        t += 0.072;
      }
      noteTrain(ac, dest, ns, "sawtooth");
      return t - t0 + 0.1;
    } },
  { id: "gull", name: "Herring Gull", latin: "Larus argentatus",
    desc: "long keening cries over the water", tone: "amber", layer: "air",
    habitats: ["beach","city"], hw: { city: 0.25 },
    weights: { dawn: 0.45, day: 0.65, dusk: 0.35, night: 0.03 }, base: 18,
    synth(ac, dest, t0, r) {
      let t = t0;
      const ns = [{ t, f0: 1450 + r()*150, f1: 900, dur: 0.5, peak: 0.03 }];
      t += 0.65;
      const reps = 2 + Math.floor(r()*4);
      for (let i = 0; i < reps; i++) {
        ns.push({ t, f0: 1300 + r()*150, f1: 1000, dur: 0.16, peak: 0.028 });
        t += 0.22;
      }
      noteTrain(ac, dest, ns, "sawtooth");
      return t - t0 + 0.1;
    } },
  { id: "curlew", name: "Eurasian Curlew", latin: "Numenius arquata",
    desc: "a rising cry that dissolves into bubbling", tone: "sage", layer: "far",
    habitats: ["beach","wetland"],
    weights: { dawn: 0.55, day: 0.3, dusk: 0.5, night: 0.05 }, base: 30,
    synth(ac, dest, t0, r) {
      const ns = [{ t: t0, f0: 880, f1: 1750, dur: 0.7, peak: 0.045 }];
      let t = t0 + 0.78;
      for (let i = 0; i < 8; i++) {
        const f = 1500 + r()*450;
        ns.push({ t, f0: f, f1: f*1.12, dur: 0.05, peak: 0.035 });
        t += 0.058;
      }
      noteTrain(ac, dest, ns);
      return t - t0 + 0.1;
    } },
  { id: "oystercatcher", name: "Eurasian Oystercatcher", latin: "Haematopus ostralegus",
    desc: "shrill piping, hurried and bright", tone: "amber", layer: "ground",
    habitats: ["beach"],
    weights: { dawn: 0.55, day: 0.55, dusk: 0.3, night: 0.05 }, base: 22,
    synth(ac, dest, t0, r) {
      let t = t0, gap = 0.1;
      const ns = [];
      const nn = 7 + Math.floor(r()*6);
      for (let i = 0; i < nn; i++) {
        ns.push({ t, f0: 2850 + r()*150, f1: 2600, dur: 0.07, peak: 0.04 });
        t += gap; gap *= 0.96;
      }
      noteTrain(ac, dest, ns);
      return t - t0 + 0.1;
    } },
  { id: "mallard", name: "Mallard", latin: "Anas platyrhynchos",
    desc: "a descending run of quacks, mostly laughter", tone: "amber", layer: "ground",
    habitats: ["wetland"],
    weights: { dawn: 0.5, day: 0.5, dusk: 0.45, night: 0.08 }, base: 20,
    synth(ac, dest, t0, r) {
      let t = t0, peak = 0.032;
      const ns = [];
      const nn = 4 + Math.floor(r()*4);
      for (let i = 0; i < nn; i++) {
        ns.push({ t, f0: 330 - i*10, f1: 255, dur: 0.14, peak });
        peak *= 0.82;
        t += 0.2;
      }
      noteTrain(ac, dest, ns, "sawtooth");
      return t - t0 + 0.1;
    } },
  { id: "reedwarbler", name: "Eurasian Reed Warbler", latin: "Acrocephalus scirpaceus",
    desc: "scratchy chatter, churring down in the reeds", tone: "sage", layer: "perch",
    habitats: ["wetland"],
    weights: { dawn: 0.65, day: 0.55, dusk: 0.3, night: 0.1 }, base: 19,
    synth(ac, dest, t0, r) {
      let t = t0;
      const ns = [], ps = [];
      const nn = 12 + Math.floor(r()*9);
      for (let i = 0; i < nn; i++) {
        const f = 2000 + (i % 2)*700 + r()*400;
        if (r() < 0.4) ps.push({ t, freq: f, dur: 0.05, peak: 0.03 });
        else ns.push({ t, f0: f, f1: f*0.9, dur: 0.06, peak: 0.032 });
        t += 0.09 + r()*0.04;
      }
      noteTrain(ac, dest, ns);
      pulseTrain(ac, dest, ps, 6);
      return t - t0 + 0.1;
    } },
  { id: "sparrow", name: "House Sparrow", latin: "Passer domesticus",
    desc: "companionable cheeps from the gutters", tone: "amber", layer: "perch",
    habitats: ["city","meadow"], hw: { meadow: 0.5 },
    weights: { dawn: 0.55, day: 0.65, dusk: 0.35, night: 0 }, base: 14,
    synth(ac, dest, t0, r) {
      let t = t0;
      const ns = [];
      const nn = 3 + Math.floor(r()*5);
      for (let i = 0; i < nn; i++) {
        const f = 2500 + r()*1400;
        ns.push({ t, f0: f, f1: f*(0.85 + r()*0.25), dur: 0.08, peak: 0.038 });
        t += 0.16 + r()*0.14;
      }
      noteTrain(ac, dest, ns);
      return t - t0 + 0.1;
    } },
  { id: "feralpigeon", name: "Feral Pigeon", latin: "Columba livia domestica",
    desc: "throaty cooing on a window ledge", tone: "sage", layer: "perch",
    habitats: ["city"],
    weights: { dawn: 0.5, day: 0.55, dusk: 0.3, night: 0.02 }, base: 20,
    synth(ac, dest, t0, r) {
      let t = t0;
      const ns = [];
      for (let i = 0; i < 3; i++) {
        ns.push({ t, f0: 320 + r()*20, f1: 285, dur: 0.3, peak: 0.05 });
        t += 0.4;
      }
      noteTrain(ac, dest, ns);
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
      const ps = [];
      const nn = 10 + Math.floor(r()*5);
      for (let i = 0; i < nn; i++) {
        ps.push({ t, freq: 1700 + r()*300, dur: 0.04, peak: 0.06 });
        t += 0.055;
      }
      pulseTrain(ac, dest, ps, 1.5);
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
      const ns = [];
      ns.push({ t, f0: 620, f1: 660, dur: 0.18, peak: 0.05 }); t += 0.24;
      ns.push({ t, f0: 750, f1: 780, dur: 0.16, peak: 0.05 }); t += 0.22;
      ns.push({ t, f0: 900, f1: 930, dur: 0.3, peak: 0.06 }); t += 0.36;
      ns.push({ t, f0: 830, f1: 560, dur: 0.55, peak: 0.05 }); t += 0.6;
      noteTrain(ac, bp, ns, "sawtooth");
      return t - t0 + 0.2;
    } },
  { id: "songthrush", name: "Song Thrush", latin: "Turdus philomelos",
    desc: "each phrase said twice, as if to be sure", tone: "amber", layer: "perch",
    habitats: ["meadow","forest"],
    weights: { dawn: 0.85, day: 0.35, dusk: 0.7, night: 0.05 }, base: 16,
    synth(ac, dest, t0, r) {
      let t = t0;
      const ns = [];
      const phrases = 2 + Math.floor(r()*2);
      for (let p = 0; p < phrases; p++) {
        const f = 1800 + r()*1200, f2 = f*(0.7 + r()*0.6);
        const reps = 2 + Math.floor(r()*2);
        for (let i = 0; i < reps; i++) {
          ns.push({ t, f0: f, f1: f2, dur: 0.12, peak: 0.05 });
          ns.push({ t: t + 0.14, f0: f*1.1, f1: f2*1.05, dur: 0.08, peak: 0.035 });
          t += 0.3;
        }
        t += 0.25 + r()*0.2;
      }
      noteTrain(ac, dest, ns);
      return t - t0 + 0.2;
    } },
  { id: "chaffinch", name: "Common Chaffinch", latin: "Fringilla coelebs",
    desc: "a rattling run downhill with a flourish at the end", tone: "sage", layer: "perch",
    habitats: ["forest","meadow","city"], hw: { city: 0.4 },
    weights: { dawn: 0.6, day: 0.6, dusk: 0.2, night: 0 }, base: 17,
    synth(ac, dest, t0, r) {
      let t = t0, f = 3400 + r()*300, gap = 0.09;
      const ns = [];
      const nn = 8 + Math.floor(r()*4);
      for (let i = 0; i < nn; i++) {
        ns.push({ t, f0: f, f1: f*0.94, dur: 0.05, peak: 0.04 });
        f *= 0.93; gap *= 0.94; t += gap;
      }
      ns.push({ t, f0: 2000, f1: 2600, dur: 0.14, peak: 0.05 });
      ns.push({ t: t + 0.12, f0: 2500, f1: 1900, dur: 0.12, peak: 0.05 });
      noteTrain(ac, dest, ns);
      return t - t0 + 0.35;
    } },
  { id: "goldfinch", name: "European Goldfinch", latin: "Carduelis carduelis",
    desc: "tinkling liquid chatter, like small change", tone: "amber", layer: "perch",
    habitats: ["meadow","city"],
    weights: { dawn: 0.4, day: 0.65, dusk: 0.3, night: 0 }, base: 18,
    synth(ac, dest, t0, r) {
      let t = t0;
      const ns = [];
      const cl = 3 + Math.floor(r()*3);
      for (let i = 0; i < cl; i++) {
        for (let k = 0; k < 3; k++) {
          const f = 3800 + r()*1500;
          ns.push({ t, f0: f, f1: f*1.1, dur: 0.045, peak: 0.035 });
          t += 0.055;
        }
        t += 0.12 + r()*0.1;
      }
      noteTrain(ac, dest, ns);
      return t - t0 + 0.1;
    } },
  { id: "bluetit", name: "Eurasian Blue Tit", latin: "Cyanistes caeruleus",
    desc: "two high notes, then a silver trill", tone: "sage", layer: "perch",
    habitats: ["forest","meadow","city"],
    weights: { dawn: 0.6, day: 0.6, dusk: 0.2, night: 0 }, base: 16,
    synth(ac, dest, t0, r) {
      let t = t0;
      const ns = [];
      const hi = 2 + Math.floor(r()*2);
      for (let i = 0; i < hi; i++) {
        ns.push({ t, f0: 4200 + r()*300, f1: 4000, dur: 0.08, peak: 0.04 });
        t += 0.12;
      }
      const nn = 6 + Math.floor(r()*5);
      for (let k = 0; k < nn; k++) {
        ns.push({ t, f0: 3000 + r()*200, f1: 2800, dur: 0.035, peak: 0.038 });
        t += 0.045;
      }
      noteTrain(ac, dest, ns);
      return t - t0 + 0.1;
    } },
  { id: "dunnock", name: "Dunnock", latin: "Prunella modularis",
    desc: "a hurried flat warble from low cover", tone: "sage", layer: "perch",
    habitats: ["city","meadow"],
    weights: { dawn: 0.5, day: 0.45, dusk: 0.25, night: 0 }, base: 21,
    synth(ac, dest, t0, r) {
      let t = t0;
      const ns = [];
      const nn = 10 + Math.floor(r()*5);
      for (let i = 0; i < nn; i++) {
        const f = 3000 + r()*1400;
        ns.push({ t, f0: f, f1: f*(0.88 + r()*0.2), dur: 0.05, peak: 0.035 });
        t += 0.065 + r()*0.02;
      }
      noteTrain(ac, dest, ns);
      return t - t0 + 0.1;
    } },
  { id: "starling", name: "Common Starling", latin: "Sturnus vulgaris",
    desc: "whistles, clicks and borrowed noises", tone: "amber", layer: "perch",
    habitats: ["city","meadow"], hw: { meadow: 0.5 },
    weights: { dawn: 0.5, day: 0.6, dusk: 0.55, night: 0 }, base: 17,
    synth(ac, dest, t0, r) {
      let t = t0;
      const ns = [{ t, f0: 2600 + r()*600, f1: 900 + r()*300, dur: 0.5, peak: 0.032 }];
      const ps = [];
      t += 0.55;
      const nn = 5 + Math.floor(r()*5);
      for (let k = 0; k < nn; k++) {
        ps.push({ t, freq: 1500 + r()*2500, dur: 0.02, peak: 0.05 });
        t += 0.05 + r()*0.04;
      }
      if (r() < 0.7) { ns.push({ t, f0: 1800, f1: 3400, dur: 0.22, peak: 0.028 }); t += 0.3; }
      noteTrain(ac, dest, ns);
      pulseTrain(ac, dest, ps, 8);
      return t - t0 + 0.1;
    } },
  { id: "nightingale", name: "Common Nightingale", latin: "Luscinia megarhynchos",
    desc: "a crescendo, then the deep jug-jug-jug", tone: "amber", layer: "perch",
    habitats: ["forest"],
    weights: { dawn: 0.3, day: 0.05, dusk: 0.75, night: 0.9 }, base: 25,
    synth(ac, dest, t0, r) {
      let t = t0, pk = 0.014;
      const rise = [], jug = [];
      const f = 2200 + r()*400;
      const reps = 4 + Math.floor(r()*3);
      for (let i = 0; i < reps; i++) {
        rise.push({ t, f0: f, f1: f*0.98, dur: 0.1, peak: pk });
        pk = Math.min(0.055, pk*1.55); t += 0.16;
      }
      t += 0.12;
      const nn = 5 + Math.floor(r()*4);
      for (let k = 0; k < nn; k++) {
        jug.push({ t, f0: 950 + r()*100, f1: 720, dur: 0.07, peak: 0.05 });
        t += 0.09;
      }
      noteTrain(ac, dest, rise);
      noteTrain(ac, dest, jug, "sawtooth");
      return t - t0 + 0.15;
    } },
  { id: "yellowhammer", name: "Yellowhammer", latin: "Emberiza citrinella",
    desc: "“a little bit of bread and no cheese”", tone: "amber", layer: "perch",
    habitats: ["meadow"],
    weights: { dawn: 0.45, day: 0.65, dusk: 0.3, night: 0 }, base: 23,
    synth(ac, dest, t0, r) {
      let t = t0;
      const ns = [];
      const f = 3200 + r()*250;
      const nn = 6 + Math.floor(r()*3);
      for (let i = 0; i < nn; i++) {
        ns.push({ t, f0: f, f1: f*0.97, dur: 0.06, peak: 0.04 });
        t += 0.09;
      }
      ns.push({ t, f0: f*1.35, f1: f*1.3, dur: 0.5, peak: 0.032 });
      noteTrain(ac, dest, ns);
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
        const ns = [];
        const nn = 5 + Math.floor(r()*4);
        for (let k = 0; k < nn; k++) {
          ns.push({ t, f0: 3300 + r()*200, f1: 3100, dur: 0.04, peak: 0.035 });
          t += 0.05;
        }
        noteTrain(ac, dest, ns);
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
      const ns = [];
      const reps = 1 + Math.floor(r()*2);
      for (let i = 0; i < reps; i++) {
        ns.push({ t, f0: 470 + r()*15, f1: 450, dur: 0.22, peak: 0.05 }); t += 0.3;
        ns.push({ t, f0: 440 + r()*15, f1: 425, dur: 0.4, peak: 0.055 }); t += 0.5;
        ns.push({ t, f0: 450 + r()*15, f1: 430, dur: 0.13, peak: 0.04 }); t += 0.45;
      }
      noteTrain(ac, dest, ns);
      return t - t0 + 0.1;
    } },
  { id: "kingfisher", name: "Common Kingfisher", latin: "Alcedo atthis",
    desc: "a needle of whistle shot along the water", tone: "sage", layer: "perch",
    habitats: ["wetland"],
    weights: { dawn: 0.5, day: 0.55, dusk: 0.35, night: 0 }, base: 30,
    synth(ac, dest, t0, r) {
      let t = t0;
      const ns = [];
      const reps = 2 + Math.floor(r()*2);
      for (let i = 0; i < reps; i++) {
        ns.push({ t, f0: 5200 + r()*400, f1: 6200, dur: 0.09, peak: 0.035 });
        t += 0.14 + r()*0.05;
      }
      noteTrain(ac, dest, ns);
      return t - t0 + 0.1;
    } },
  { id: "lapwing", name: "Northern Lapwing", latin: "Vanellus vanellus",
    desc: "a wheezy “pee-wit!” tumbling over the marsh", tone: "sage", layer: "ground",
    habitats: ["wetland","meadow"], hw: { meadow: 0.5 },
    weights: { dawn: 0.6, day: 0.45, dusk: 0.5, night: 0.1 }, base: 26,
    synth(ac, dest, t0, r) {
      let t = t0;
      const ns = [
        { t, f0: 1200, f1: 2600, dur: 0.18, peak: 0.045 },
        { t: t + 0.26, f0: 2400, f1: 1100, dur: 0.22, peak: 0.045 }
      ];
      t += 0.55;
      if (r() < 0.5) {
        ns.push({ t, f0: 1500, f1: 2900, dur: 0.14, peak: 0.04 });
        ns.push({ t: t + 0.18, f0: 2600, f1: 1300, dur: 0.18, peak: 0.04 });
        t += 0.45;
      }
      noteTrain(ac, dest, ns);
      return t - t0 + 0.1;
    } },
  { id: "pheasant", name: "Common Pheasant", latin: "Phasianus colchicus",
    desc: "a harsh double crow and a whirr of wings", tone: "amber", layer: "ground",
    habitats: ["meadow","forest"], hw: { forest: 0.4 },
    weights: { dawn: 0.6, day: 0.15, dusk: 0.55, night: 0.02 }, base: 38,
    synth(ac, dest, t0, r) {
      let t = t0;
      const ns = [], ps = [];
      ns.push({ t, f0: 700 + r()*60, f1: 500, dur: 0.14, peak: 0.06 }); t += 0.18;
      ns.push({ t, f0: 900 + r()*80, f1: 620, dur: 0.18, peak: 0.07 }); t += 0.28;
      for (let k = 0; k < 8; k++) {
        ps.push({ t, freq: 300 + k*30, dur: 0.03, peak: 0.04 });
        t += 0.035;
      }
      noteTrain(ac, dest, ns, "sawtooth");
      pulseTrain(ac, dest, ps, 1.5);
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
      const ns = [{ t, f0: 3100 + r()*200, f1: 1600, dur: 0.4, peak: 0.038 }];
      t += 0.5;
      if (r() < 0.6) {
        ns.push({ t, f0: 2900 + r()*200, f1: 1700, dur: 0.28, peak: 0.032 });
        t += 0.35;
      }
      noteTrain(ac, dest, ns, "sawtooth");
      return t - t0 + 0.1;
    } },
  { id: "kestrel", name: "Common Kestrel", latin: "Falco tinnunculus",
    desc: "sharp kee-kee-kee from a hovering cross", tone: "amber", layer: "air",
    habitats: ["meadow","city"], hw: { city: 0.4 },
    weights: { dawn: 0.35, day: 0.55, dusk: 0.3, night: 0 }, base: 34,
    synth(ac, dest, t0, r) {
      let t = t0;
      const ns = [];
      const nn = 6 + Math.floor(r()*4);
      for (let i = 0; i < nn; i++) {
        ns.push({ t, f0: 2400 + r()*200, f1: 2000, dur: 0.07, peak: 0.04 });
        t += 0.12;
      }
      noteTrain(ac, dest, ns);
      return t - t0 + 0.1;
    } },
  { id: "buzzard", name: "Common Buzzard", latin: "Buteo buteo",
    desc: "one long mew, wheeling on still wings", tone: "sage", layer: "air",
    habitats: ["forest","meadow"],
    weights: { dawn: 0.25, day: 0.6, dusk: 0.2, night: 0 }, base: 40,
    synth(ac, dest, t0, r) {
      noteTrain(ac, dest, [
        { t: t0, f0: 2600, f1: 3100, dur: 0.25, peak: 0.038 },
        { t: t0 + 0.28, f0: 3000, f1: 1400 + r()*200, dur: 0.9, peak: 0.04 }
      ]);
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
      const ps = [];
      const nn = 5 + Math.floor(r()*4);
      for (let k = 0; k < nn; k++) {
        ps.push({ t, freq: 1400 + r()*300, dur: 0.04, peak: 0.05 });
        t += 0.11 + r()*0.04;
      }
      pulseTrain(ac, dest, ps, 4);
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
      const ps = [];
      const nn = 5 + Math.floor(r()*4);
      for (let k = 0; k < nn; k++) {
        ps.push({ t, freq: 300 + r()*150, dur: 0.06, peak: 0.03 });
        t += 0.14 + r()*0.1;
      }
      pulseTrain(ac, dest, ps, 1);
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

/* Only what another module actually asks for. `ICONS`, `ICON_KEY`, `noteTrain`
   and `pulseTrain` are the machinery behind `speciesIcon` and the synths and are
   used here alone. */
export {
  speciesIcon, PSTYLE, ANIM, COUNTERSING,
  GAIT, gaitFoot, gaitPose, gaitAt,
  note, burst,
  SPECIES, CRITTER_VOICES
};
