/* ============================================================
   Utilities — shared primitives: PRNG, colour math, session
   state and world constants. Imported by every other module.
   No DOM assumptions beyond themeVar, which reads CSS tokens.
   ============================================================ */

function themeVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
function mulberry32(a) {
  return function() {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function parseColor(str) {
  str = str.trim();
  if (str.startsWith("#")) {
    const h = str.slice(1);
    return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16), 1];
  }
  const m = str.match(/rgba?\(([^)]+)\)/);
  if (m) {
    const p = m[1].split(",").map(s => parseFloat(s));
    return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
  }
  return [0,0,0,1];
}
function css(c) { return `rgba(${c[0]|0},${c[1]|0},${c[2]|0},${c[3]})`; }
function mix(a, b, t) {
  return [a[0]+(b[0]-a[0])*t, a[1]+(b[1]-a[1])*t, a[2]+(b[2]-a[2])*t, a[3]+(b[3]-a[3])*t];
}
const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;

const LOCATIONS = ["meadow", "forest", "beach", "wetland", "city"];
const LOC_HASH = { meadow: 0x00A11, forest: 0x0F03E, beach: 0x0BEAC, wetland: 0x0EE77, city: 0x0C170 };

/* ============================================================
   The weather, as three dials rather than four words.

   `state.weather` is still the name a listener picks, but nothing draws or
   sounds from the name any more: everything reads `state.wx`, which holds
   where the weather actually *is* and eases toward whatever the name asks
   for. That is the whole difference between weather that can change and
   weather that can only be switched — rain used to arrive at full density in
   one frame while the audio glided under it, and the sky can now come over
   while you watch it.

     wet   how much rain is falling, 0 to 1
     haze  how much of the air you cannot see through
     gust  how hard the wind is working

   The named weathers are corners of that space; everything between them is a
   real state the window can be in and does not have a name.

   Clear and breeze sit at exactly zero haze rather than nearly zero, and the
   reason is worth writing down: the fog bands are drawn whenever there is any
   haze at all, so a resting 0.05 — invisible, two hundredths of an alpha —
   still cost three full-width gradient fills a frame in every weather. It put
   four milliseconds on every frame in the piece. A dial that means "none"
   must be able to say so.
   ============================================================ */
const WEATHER = {
  clear:  { wet: 0,    haze: 0,    gust: 0.24 },
  breeze: { wet: 0,    haze: 0,    gust: 1    },
  rain:   { wet: 1,    haze: 0.28, gust: 0.52 },
  fog:    { wet: 0,    haze: 1,    gust: 0.10 }
};

/* How long each dial takes to get where it is going, in seconds, coming and
   going separately — because weather is not symmetrical. A shower arrives
   much faster than it clears; fog neither comes nor goes in a hurry and is
   the slowest thing in the piece; wind changes its mind quickest of all. */
const WX_RATE = {
  wet:  { rise: 14, fall: 34 },
  haze: { rise: 55, fall: 75 },
  gust: { rise: 11, fall: 18 }
};

/* What follows what. Weather is not a shuffle: a wet morning does not become
   a foggy one without clearing first, and fog burns off into a still day
   rather than into rain. The weights are per current weather, and fog is
   additionally rationed by the hour further down. */
const WX_NEXT = {
  clear:  { breeze: 3, fog: 1.2, rain: 0.9 },
  breeze: { clear: 3, rain: 2.2, fog: 0.3 },
  rain:   { breeze: 3, clear: 2, fog: 0.8 },
  fog:    { clear: 3, breeze: 1.4, rain: 0.5 }
};

/* Session state — the single mutable source of truth. */
const state = {
  seed: (Math.random() * 0xFFFFFFFF) >>> 0,
  location: "meadow",
  time: "dawn",
  weather: "clear",
  activity: 0.45,
  volume: 0.75,
  spatial: true,
  subtitles: true,
  listening: false,
  timeFlow: true,     // the hours turn on their own
  timeSpeed: 1,       // 1 = a full hour of the day every 30 minutes
  weatherFlow: true,  // and the sky comes over on its own
  /* Where the weather actually is, as against what it has been asked to be.
     Everything that draws or sounds reads this; nothing reads the name. */
  wx: { wet: 0, haze: 0, gust: 0.24 },
  /* What the listener wants to hear, and how much of it. These are plain
     coefficients rather than nodes: every level in the engine is worked out
     from a base and multiplied by its group on the way, so a slider costs
     nothing in the graph and a group at zero costs nothing at all. */
  mix: {
    birds: 1,         // everything with a voice — song, calls, the cattle
    weather: 1,       // wind, rain, leaves, thunder, the drip off a leaf
    water: 1,         // surf, the lap of a wetland, stones in the backwash
    town: 1,          // traffic, a passing car, the church bell
    music: 0.7        // the city's lo-fi, which sounds nowhere else
  },
  cue: {
    thunder: true,    // the flash and the roll that follows it
    bell: true,       // the hour over the rooftops
    music: true       // lo-fi beats, in the city only
  }
};
function sessionSerial(seed) {
  const s = seed.toString(16).toUpperCase().padStart(8, "0");
  return "No. " + s.slice(0,4) + "\u2013" + s.slice(4);
}

/* ---- The weather, stepped ----------------------------------------------
   Called once a frame from `Scene.update`, which is the only clock in the
   piece that runs at the rate a listener perceives. Two jobs: ease every dial
   toward the named weather, and \u2014 if the sky is allowed to change on its own
   \u2014 decide now and then that it has become something else.

   `wxHold` counts down the seconds the current weather has left. It runs on
   the same `timeSpeed` the hours do, so speeding the day up brings the
   weather with it rather than leaving a frozen sky over a racing sun. */
let wxHold = 360 + Math.random()*480;
function stepWeather(dt, hour, rand) {
  const target = WEATHER[state.weather] || WEATHER.clear;
  for (const k in target) {
    const now = state.wx[k], want = target[k];
    if (now === want) continue;
    const r = WX_RATE[k];
    /* An exponential approach never actually arrives, and a dial stuck at
       0.004 of a millimetre of rain is a drop every few seconds forever. So
       it is snapped once it is within a thousandth of where it is going. */
    const tau = want > now ? r.rise : r.fall;
    const next = now + (want - now) * (1 - Math.exp(-dt/tau));
    state.wx[k] = Math.abs(want - next) < 0.001 ? want : next;
  }

  if (!state.weatherFlow) return;
  wxHold -= dt * (state.timeSpeed || 1);
  if (wxHold > 0) return;
  /* A weather holds for six to fourteen minutes of window time \u2014 long enough
     to be a spell of weather rather than a slideshow, short enough that a
     session sees the sky change more than once. */
  wxHold = 360 + (rand ? rand() : Math.random()) * 480;

  const opts = WX_NEXT[state.weather] || WX_NEXT.clear;
  /* Fog is a thing that happens at the ends of the day. Asking for it at noon
     is asking for the one weather that reads as a mistake. */
  const fogOK = hour === "dawn" || hour === "dusk" || hour === "night" ? 1 : 0.12;
  let total = 0;
  for (const k in opts) total += opts[k] * (k === "fog" ? fogOK : 1);
  let pick = (rand ? rand() : Math.random()) * total;
  for (const k in opts) {
    pick -= opts[k] * (k === "fog" ? fogOK : 1);
    if (pick <= 0) { state.weather = k; return; }
  }
}
/* A weather chosen by hand gets its full span before the sky moves again. */
function holdWeather() { wxHold = 360 + Math.random()*480; }

export {
  themeVar, mulberry32, parseColor, css, mix, REDUCED,
  LOCATIONS, LOC_HASH, WEATHER, state, sessionSerial,
  stepWeather, holdWeather
};
