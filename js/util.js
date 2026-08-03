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

export {
  themeVar, mulberry32, parseColor, css, mix, REDUCED,
  LOCATIONS, LOC_HASH, state, sessionSerial
};
