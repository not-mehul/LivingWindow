/* ============================================================
   The scene — five etched landscapes behind one pane of glass,
   now inhabited: singers appear where they sing, and the land
   has its own quiet traffic of butterflies, bats, deer and cats.
   ============================================================ */
import {
  mulberry32, parseColor, css, mix, themeVar, REDUCED, LOC_HASH, state, stepWeather
} from "./util.js?v=19";
import { PSTYLE, ANIM, GAIT, gaitFoot, gaitPose, gaitAt } from "./species.js?v=19";
import { makeSkyPainter, Canvas2DSky } from "./sky.js?v=19";

const PHASES = ["dawn", "day", "dusk", "night"];   // hoisted: no per-frame array literal

/* The gaits are written around a stride of 1; the animals keep their phases in
   radians, as they always have, so that a rate tuned by eye stays the number it
   was. TURN is the one conversion between the two. */
const TURN = 1/(Math.PI*2);
/* One reused pair for `gaitFoot` to fill — a foot's reach and its lift. Four
   calls an animal a frame is not a place to be allocating. */
const FOOT = [0, 0];

/* Where the street meets the buildings. It was a literal 0.95 in half a dozen
   places, which gave the city a pavement one twentieth of the frame deep —
   and once the plane was fitted into that, sixteen pixels of usable ground
   for everything that walks. A pigeon standing at the near kerb was drawn
   below the bottom of the window. Nine per cent is still a view down onto a
   street from a first-floor room; it is simply a view with a street in it. */
const CITY_GROUND = 0.908;

/* The wind field: how many springs across the frame, how fast the gusts come
   round, and how much of one is in the air at once (1 puts a whole gust across
   the width, so the far side is a full cycle ahead of the near). */
const WIND_COLS = 20, WIND_RATE = 0.12, WIND_TRAVEL = 0.55;

/* A bench, not part of the piece: open the page with ?perf=1 and the window
   keeps a readout of what each frame costs. What it counts is rasterization
   submissions — every stroke, fill and blit — because that, and not arithmetic,
   is what a frame here is made of. Absent the flag nothing below runs at all
   and the context is left exactly as the browser handed it over. */
const PERF = typeof location !== "undefined" &&
  new URLSearchParams(location.search).has("perf");

class Scene {
  constructor(canvas, skyCanvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    /* The sky and everything hanging in it is painted by one of two backends —
       the GPU where there is one, the 2D context where there is not. `onGL`
       decides whether this canvas must clear itself first or whether it is
       still the thing painting the sky. See js/sky.js. */
    this.skyCanvas = skyCanvas || null;
    this.skyPainter = makeSkyPainter(skyCanvas, this);
    this.onGL = !(this.skyPainter instanceof Canvas2DSky);
    if (skyCanvas && !this.onGL) skyCanvas.style.display = "none";
    this.t = 0;
    this.ripples = [];
    this.flyers = [];
    this.actors = [];
    this.critters = [];
    this.fishRings = [];
    this.meteors = [];
    this.lastDeer = -999; this.lastCat = -999; this.lastSkein = -999;
    this.lastFox = -999; this.lastRabbit = -999; this.lastHeron = -999;
    this.lastPorpoise = -999; this.lastSquirrel = -999; this.lastHare = -999;
    this.lastHedgehog = -999; this.lastBadger = -999; this.lastOtter = -999;
    this.lastPounce = -999;
    this.timeMix = { dawn: 1, day: 0, dusk: 0, night: 0 };
    // Outlines of land that never move between reseeds, kept as Path2D and
    // refilled each frame. Keyed on the shape function that generated them;
    // emptied by reseed (new land) and by resize (same land, new pixels).
    this._paths = new Map();
    if (PERF) this.countOps();
    this.refreshTokens();
    this.reseed(state.seed);
    const ro = new ResizeObserver(() => this.resize());
    ro.observe(canvas);
    this.resize();
    this.last = performance.now();
    this.active = true;
    this._frame = (n) => this.frame(n);   // bound once, not re-created each frame
    requestAnimationFrame(this._frame);
  }

  /* The window shut: stop the world entirely — no drawing, no spawning, no
     drifting on in the dark. Opening it again starts a fresh, empty land. */
  setActive(on) {
    if (on === this.active) return;
    this.active = on;
    if (on) {
      this.last = performance.now();
      this.warm = 0;             // judge the frame rate afresh, not on the first paint
      requestAnimationFrame(this._frame);
    }
  }

  /* Everything living, gone — leaving only the land itself. */
  clearLife() {
    this.actors.length = 0;
    this.critters.length = 0;
    this.flyers.length = 0;
    this.ripples.length = 0;
    this.fishRings.length = 0;
    this.meteors.length = 0;
  }

  refreshTokens() {
    this.tok = {
      sky: {
        dawn: [parseColor(themeVar("--scene-sky-dawn-top")), parseColor(themeVar("--scene-sky-dawn-bot"))],
        day:  [parseColor(themeVar("--scene-sky-day-top")),  parseColor(themeVar("--scene-sky-day-bot"))],
        dusk: [parseColor(themeVar("--scene-sky-dusk-top")), parseColor(themeVar("--scene-sky-dusk-bot"))],
        night:[parseColor(themeVar("--scene-sky-night-top")),parseColor(themeVar("--scene-sky-night-bot"))]
      },
      ink: parseColor(themeVar("--scene-ink")),
      inkDeep: parseColor(themeVar("--scene-ink-deep")),
      sun: parseColor(themeVar("--scene-sun")),
      moon: parseColor(themeVar("--scene-moon")),
      sea: parseColor(themeVar("--scene-sea")),
      sand: parseColor(themeVar("--scene-sand")),
      foamRGB: themeVar("--scene-foam-rgb"),
      cloudRGB: themeVar("--scene-cloud-rgb"),
      rainRGB: themeVar("--scene-rain-rgb"),
      fogRGB: themeVar("--scene-fog-rgb"),
      firefly: parseColor(themeVar("--scene-firefly")),
      amberRGB: themeVar("--accent-amber-rgb"),
      sageRGB: themeVar("--accent-sage-rgb")
    };
    this._glow = new Map();   // radial-glow sprites are token-coloured; rebuild on theme change
    this._skyKey = null;      // invalidate the cached sky and fog gradients
    this._fogKey = null;
    const fc = this.tok.firefly;
    this.tok.fireflyRGB = (fc[0]|0) + "," + (fc[1]|0) + "," + (fc[2]|0);
  }

  /* Shadow the context's drawing calls with counting versions of themselves.
     Only ever called under ?perf=1 — the allocation each wrapper makes would
     be its own kind of lie in a frame we are trying to measure, so it is kept
     off the road entirely rather than switched off inside. */
  countOps() {
    this.ops = 0;
    for (const m of ["stroke", "fill", "fillRect", "strokeRect", "drawImage", "fillText"]) {
      const orig = this.ctx[m].bind(this.ctx);
      this.ctx[m] = (...a) => { this.ops++; return orig(...a); };
    }
  }

  /* The readout itself, painted last so it sits over the land. Held still for
     a quarter-second at a time: a number that changes sixty times a second
     cannot be read, and this one exists to be read. */
  drawPerf(c, dt) {
    const ops = this.ops;
    this._perfT = (this._perfT || 0) + dt;
    if (this._perfT > 0.25) { this._perfOps = ops; this._perfT = 0; }
    const lines = [
      `${(this.frameMs || 0).toFixed(1)} ms · ${(1000/Math.max(0.01, this.frameMs || 16.7)).toFixed(0)} fps`,
      `${this._perfOps || 0} raster ops/frame`,
      `dpr ${(this.dpr || 1).toFixed(2)} · quality ${(this.quality || 1).toFixed(2)}`,
      `${this.canvas.width}×${this.canvas.height} · ${this.loc}`
    ];
    c.save();
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.globalAlpha = 1;
    c.font = "11px ui-monospace, SFMono-Regular, Menlo, monospace";
    c.textBaseline = "top";
    c.fillStyle = "rgba(0,0,0,0.62)";
    c.fillRect(8, 8, 190, 12 + lines.length*14);
    c.fillStyle = "#9fe89f";
    for (let i = 0; i < lines.length; i++) c.fillText(lines[i], 14, 14 + i*14);
    c.restore();
    this.ops = 0;                 // the readout's own ops are not the frame's
  }

  /* A cached radial-glow sprite (colour → transparent), so glows blit with one
     drawImage instead of building a new gradient every frame. */
  glowSprite(rgb) {
    let cv = this._glow.get(rgb);
    if (cv) return cv;
    const R = 48;
    cv = document.createElement("canvas");
    cv.width = cv.height = R*2;
    const g2 = cv.getContext("2d");
    const grad = g2.createRadialGradient(R, R, 0, R, R, R);
    grad.addColorStop(0, `rgba(${rgb}, 1)`);
    grad.addColorStop(1, `rgba(${rgb}, 0)`);
    g2.fillStyle = grad;
    g2.fillRect(0, 0, R*2, R*2);
    this._glow.set(rgb, cv);
    return cv;
  }

  drawGlow(c, rgb, x, y, rx, ry, alpha) {
    if (alpha <= 0.004) return;
    c.globalAlpha = alpha < 1 ? alpha : 1;
    c.drawImage(this.glowSprite(rgb), x - rx, y - ry, rx*2, ry*2);
    c.globalAlpha = 1;
  }

  reseed(seedBase) {
    const loc = state.location;
    const rng = mulberry32((seedBase ^ LOC_HASH[loc]) >>> 0);
    this._paths.clear();         // fresh ground: every kept outline is stale
    this.seedBase = seedBase;    // kept so lazily-built ground can key off it
    this.loc = loc;
    this.flyers = []; this.ripples = [];
    this.actors = []; this.critters = [];
    this.fishRings = []; this.meteors = [];
    this.lastDeer = this.t - 60; this.lastCat = this.t - 40; this.lastSkein = this.t - 20;
    this.lastFox = this.t - 55; this.lastRabbit = this.t - 30; this.lastHeron = this.t - 50;
    this.lastPorpoise = this.t - 40; this.lastSquirrel = this.t - 25; this.lastHare = this.t - 50;
    this.lastTurnstone = this.t - 40; this.lastCrab = this.t - 30; this.lastSeal = this.t - 60;
    this.lastPigeons = this.t - 35; this.lastMoth = this.t - 30; this.lastStoat = this.t - 70;
    this.lastShell = this.t - 50; this.lastBather = this.t - 25;
    this.lastSunner = this.t - 40; this.lastMob = this.t - 60;
    this.lastHedgehog = this.t - 60; this.lastBadger = this.t - 80; this.lastOtter = this.t - 45;
    this.lastPounce = this.t - 20;

    this.clouds = [];
    const nc = 2 + Math.floor(rng()*3);
    for (let i = 0; i < nc; i++) {
      this.clouds.push({ x: rng(), y: 0.10 + rng()*0.28, w: 0.16 + rng()*0.22,
        s: 0.004 + rng()*0.006, a: 0.10 + rng()*0.10,
        evo: rng(), evoSp: 0.008 + rng()*0.010 });
    }
    /* Rain in three depths. A single sheet of identical streaks reads as a
       texture laid over the picture; what makes it read as weather is that the
       near drops are long, fast and dark and the far ones are short, slow and
       almost not there — the same haze that greys the hills greys the rain in
       front of them. `z` is 0 at the glass and 1 at the back of the frame. */
    this.rain = [];
    const nd = REDUCED ? 60 : 150;
    for (let i = 0; i < nd; i++) {
      const z = Math.random();
      this.rain.push({ x: Math.random(), y: Math.random(), z,
        sp: (1.5 - z*0.75) * (0.9 + Math.random()*0.3),
        len: (0.030 - z*0.020) * (0.8 + Math.random()*0.5) });
    }
    // where the last drops landed: a ring on water, a tick of spray on land
    this.splashes = [];
    this.seeds = [];
    for (let i = 0; i < (REDUCED ? 5 : 12); i++) {
      this.seeds.push({ x: Math.random(), y: 0.3 + Math.random()*0.5, ph: Math.random()*Math.PI*2, sp: 0.01 + Math.random()*0.02 });
    }
    this.fog = [];
    for (let i = 0; i < 3; i++) {
      this.fog.push({ y: 0.5 + i*0.14, h: 0.10 + rng()*0.06, x: rng(), sp: 0.003 + rng()*0.004 });
    }
    this.fireflies = [];
    if (loc === "meadow" || loc === "forest" || loc === "wetland") {
      for (let i = 0; i < (REDUCED ? 5 : 12); i++) {
        this.fireflies.push({ x: rng(), y: 0.70 + rng()*0.2, ph: rng()*Math.PI*2, sp: 0.5 + rng(), dx: (rng()-0.5)*0.01 });
      }
    }
    // A seed-stable starfield for the night sky, everywhere.
    this.stars = [];
    for (let i = 0; i < (REDUCED ? 34 : 78); i++) {
      this.stars.push({ x: rng(), y: rng()*0.56, r: 0.4 + rng()*1.0,
        ph: rng()*Math.PI*2, tw: 0.6 + rng()*2.2, bright: rng() < 0.14 });
    }
    // A few far-off birds adrift, so the sky is never quite empty.
    this.skyBirds = [];
    const nsb = REDUCED ? 1 : 3 + Math.floor(rng()*3);
    for (let i = 0; i < nsb; i++) {
      this.skyBirds.push({ x: rng(), y: 0.09 + rng()*0.22,
        sp: (rng() < 0.5 ? -1 : 1)*(0.006 + rng()*0.012), size: 2.6 + rng()*3, ph: rng()*Math.PI*2 });
    }
    // How lively the air feels this session, and a phase so the wind rolls
    // across the plants in travelling waves rather than swaying as one.
    this.gustPh = rng()*Math.PI*2;
    this.airiness = 0.7 + rng()*0.7;
    // Motes of pollen/dust adrift in the green places by day.
    this.motes = [];
    if (loc === "meadow" || loc === "forest" || loc === "wetland") {
      const nm = REDUCED ? 6 : Math.floor((12 + rng()*16) * this.airiness);
      for (let i = 0; i < nm; i++) {
        this.motes.push({ x: rng(), y: 0.3 + rng()*0.62, r: 0.6 + rng()*1.3,
          ph: rng()*Math.PI*2, sp: 0.004 + rng()*0.009, drift: (rng()-0.5)*0.012 });
      }
    }
    // The near edge of the world: whatever grows right up against the glass.
    // It is drawn last of all, so the animals pass behind it — the one cue
    // that most convinces the eye there is depth here at all.
    this.fg = [];
    if (loc === "meadow") {
      /* The near edge, right against the glass. Shortened and thickened up
         into a fringe: at the old height, against a field whose own grass now
         obeys perspective, a dozen lone stalks read as a picket fence rather
         than as the nearest grass in the picture. */
      /* Kept to the edges, where it frames the view. Out in the middle of a
         field whose own grass now runs right up to the glass, a lone stalk
         twice the height of everything around it reads as a post — the near
         edge should be the corners of the window, not a picket line across
         the middle of it. */
      for (let i = 0; i < 26; i++) {
        const left = rng() < 0.5;
        this.fg.push({ x: left ? rng()*0.30 - 0.05 : 0.75 + rng()*0.30,
          h: 0.075 + rng()*0.125,
          ph: rng()*Math.PI*2, lean: (rng() - 0.5)*0.9, head: rng() < 0.34 });
      }
    } else if (loc === "forest") {
      this.fgTrunks = [
        { x: -0.02 + rng()*0.1, w: 0.028 + rng()*0.026, lean: (rng() - 0.5)*0.03 },
        { x: 0.92 + rng()*0.1, w: 0.026 + rng()*0.03, lean: (rng() - 0.5)*0.03 }
      ];
      for (let i = 0; i < 5; i++) {
        this.fg.push({ x: rng() < 0.5 ? rng()*0.24 - 0.02 : 0.78 + rng()*0.24,
          h: 0.12 + rng()*0.1, ph: rng()*Math.PI*2,
          lean: (rng() - 0.5)*0.8, blades: 4 + Math.floor(rng()*3) });
      }
    } else if (loc === "beach") {
      for (let i = 0; i < 16; i++) {
        const side = rng() < 0.5;
        this.fg.push({ x: side ? rng()*0.3 - 0.02 : 0.72 + rng()*0.3,
          h: 0.13 + rng()*0.13, ph: rng()*Math.PI*2, lean: (rng() - 0.5)*1.1 });
      }
    } else if (loc === "wetland") {
      for (let i = 0; i < 9; i++) {
        this.fg.push({ x: rng() < 0.5 ? rng()*0.26 - 0.03 : 0.77 + rng()*0.26,
          h: 0.26 + rng()*0.2,
          ph: rng()*Math.PI*2, lean: (rng() - 0.5)*0.5, head: rng() < 0.5 });
      }
    } else {
      // Cables strung the width of the street between two poles, hanging in
      // the catenary a real wire makes. Both ends are attached to something.
      this.poleX = [0.06 + rng()*0.1, 0.84 + rng()*0.1];
      this.poleTop = [0.10 + rng()*0.05, 0.13 + rng()*0.05];
      const nWire = 2 + Math.floor(rng()*2);
      for (let i = 0; i < nWire; i++) {
        this.fg.push({ drop: i*0.028 + rng()*0.012, sag: 0.06 + rng()*0.05 });
      }
    }

    // Points of light glinting off moving water.
    this.glints = [];
    if (loc === "beach" || loc === "wetland") {
      const ngl = REDUCED ? 8 : 16 + Math.floor(rng()*18);
      for (let i = 0; i < ngl; i++) {
        this.glints.push({ x: rng(), yy: rng(), ph: rng()*Math.PI*2, sp: 0.8 + rng()*2.2 });
      }
    }

    if (loc === "meadow") {
      /* ---- The field, as one receding plane ----------------------------

         What was here before was three stacked bands: a ridge at 0.62, a
         second at 0.78, and a lip of foreground at 0.92. Each was a filled
         outline with a hard edge, none of them agreed about where the ground
         was, and the animals lived in the six per cent of frame height
         between the last two — so a rabbit at the back of the field stood
         thirty pixels above one at the front and there was nothing to tell
         you it was further away. Theatre flats, not a field.

         Now there is one plane and one horizon. Everything that stands on
         the ground reads `planeY`/`planeScale`, so the grass, the flowers,
         the stones, the hedges, the cattle and every animal all agree about
         how far away each other are. The only things above the horizon are
         the sky and the far country. */
      this.horizonY = 0.505 + rng()*0.035;
      this.plane = this.makePlane(this.horizonY, 1.035,
        this.horizonY + 0.118 + rng()*0.016);
      const py = (z) => this.planeY(z), ps = (z) => this.planeScale(z)/this.plane.top;

      /* The far country: one low ridge sitting on the horizon, and that is
         all. It is scenery — nothing walks on it — so it is shallow, pale,
         and never comes down into the field. */
      this.hillA = this.makeRidge(rng, this.horizonY - 0.012, 0.026);

      /* Field boundaries. A real field is not an empty plane, it is a plane
         with lines across it, and those lines are the thing that says how
         big it is. Three of them at known depths, each with its own hedge,
         each drawn at the height that depth allows. */
      this.bounds = [];
      const zs = [0.86, 0.62 + rng()*0.06, 0.34 + rng()*0.07];
      for (let i = 0; i < zs.length; i++) {
        const z = zs[i], ph = rng()*Math.PI*2, f = 2.1 + i*1.7, amp = 0.005*ps(z);
        // a boundary is not dead straight, and the further one wanders less
        // on screen for exactly the same wander on the ground
        const line = (x) => py(z) + Math.sin(x*f*Math.PI + ph)*amp;
        this.bounds.push({ z, line, hedge: this.makeHedgerow(rng, line),
          gap: 0.2 + rng()*0.55 });
      }
      // the nearest boundary is the hedge a bird can sit on
      this.hedgeLine = this.bounds[this.bounds.length - 1].line;
      this.hedge = this.bounds[this.bounds.length - 1].hedge;

      /* The field tree, standing on the plane like everything else — a third
         of the way back, so it has ground both in front of it and behind. */
      this.treeX = rng() < 0.5 ? 0.11 + rng()*0.12 : 0.77 + rng()*0.12;
      this.treeZ = 0.30 + rng()*0.10;
      this.tree = this.makeTree(rng);
      // Foliage gathered at the ends of the branches. A tree standing bare in
      // a summer field is the one thing in this view that never looked right.
      // Many small clumps gathered along the outer branches rather than a few
      // big ones at the tips, so the crown is a mass with a broken edge.
      this.treeLeaves = [];
      for (const sg of this.tree) {
        if (sg.w > 1 || rng() < 0.42) continue;
        this.treeLeaves.push({ x: sg.x2, y: sg.y2, r: 0.017 + rng()*0.021,
          dx: (rng()-0.5)*0.026, dy: (rng()-0.5)*0.026 });
      }

      /* Trees out along the boundaries, at the depth of the line they stand
         in, so they are small where the line is far. */
      this.distantTrees = [];
      for (const b of this.bounds) {
        const n = b.z > 0.7 ? 2 + Math.floor(rng()*3) : 1 + Math.floor(rng()*2);
        for (let i = 0; i < n; i++) {
          const x = 0.05 + rng()*0.9;
          /* Crown width against height matters more than either alone: a
             ball on a stick is a mushroom, and that is what these were. A
             tree's crown is about as wide as the part of the tree it sits
             on is tall. */
          const th = (0.17 + rng()*0.11)*ps(b.z);
          this.distantTrees.push({ x, y: b.line(x), z: b.z, h: th,
            r: th*(0.38 + rng()*0.10) });
        }
      }
      // a shrub or two standing out on the open field
      this.shrubs = [];
      for (let i = 0; i < 2 + Math.floor(rng()*2); i++) {
        const x = rng(), z = 0.26 + rng()*0.34;
        this.shrubs.push({ x, z, y: py(z), r: (0.032 + rng()*0.030)*ps(z), seed: rng() });
      }

      /* Cattle, out in the middle distance where cattle are — small, because
         that is what a beast four fields away looks like. */
      /* Cattle out in the middle distance. Not so far off that they are three
         pale specks — they are the slow background motion this view is built
         around, and a herd you cannot quite make out is not motion at all. */
      this.cattle = [];
      if (rng() < 0.85) {
        const herd = 3 + Math.floor(rng()*4);
        const cz = 0.52 + rng()*0.16;
        let cx = 0.08 + rng()*0.5;
        for (let i = 0; i < herd; i++) {
          cx += (0.04 + rng()*0.09);
          if (cx > 0.94) break;
          this.cattle.push({ x: cx, z: cz + (rng() - 0.5)*0.10,
            sz: 0.85 + rng()*0.3, dir: rng() < 0.5 ? -1 : 1,
            ph: rng()*Math.PI*2, calf: rng() < 0.22,
            // most of a cow's day is head-down; the rest is standing about
            head: rng() < 0.68 ? 1 : 0, next: 6 + rng()*14,
            // and it works its way across the field while it does it
            step: (0.0016 + rng()*0.0022) });
        }
      }

      /* And the field itself, which is grass. Every blade, flower and stone
         carries a depth, and its height on screen is that depth's scale —
         which is the whole difference between a meadow and a green stripe
         with some marks on it. Sorted far to near so the near ones overlap
         the far ones, as they must. */
      /* A field is not one colour. Different grass, different years of
         cutting, a hollow that holds the wet — a real one is a patchwork of
         very slightly different tones, and without them a plane in
         perspective is still a plane painted flat. These are broad and soft
         and nobody should be able to point at one. */
      this.patches = [];
      for (let i = 0; i < 7 + Math.floor(rng()*5); i++) {
        const z = Math.pow(rng(), 1.3);
        this.patches.push({ x: rng(), z, y: py(z),
          w: (0.10 + rng()*0.26)*(0.35 + ps(z)), h: (0.018 + rng()*0.03)*ps(z),
          tone: rng() < 0.5 ? -1 : 1, k: 0.3 + rng()*0.7 });
      }
      this.patches.sort((a, b) => b.z - a.z);

      this.grass = [];
      for (let i = 0; i < (REDUCED ? 190 : 360); i++) {
        /* An exponent *above* one pulls z toward zero, which is toward the
           viewer. Below one pushes it to the back — which is what was here,
           and why the near third of the field was bare while the far edge was
           a thicket. Perspective puts most of the visible blades near. */
        const z = Math.pow(rng(), 1.8);
        this.grass.push({ x: rng()*1.06 - 0.03, z, y: py(z),
          h: (0.022 + rng()*0.046)*ps(z), ph: rng()*Math.PI*2, lean: (rng()-0.5)*1.5 });
      }
      this.grass.sort((a, b) => b.z - a.z);
      this.flowers = [];
      for (let i = 0; i < 40 + Math.floor(rng()*20); i++) {
        const z = Math.pow(rng(), 1.6);
        this.flowers.push({ x: rng(), z, y: py(z), h: (0.016 + rng()*0.026)*ps(z),
          tone: rng(), ph: rng()*Math.PI*2 });
      }
      this.flowers.sort((a, b) => b.z - a.z);
      this.rocks = [];
      for (let i = 0; i < 4 + Math.floor(rng()*5); i++) {
        const z = Math.pow(rng(), 1.7)*0.8;
        this.rocks.push({ x: 0.04 + rng()*0.92, z, y: py(z),
          r: (0.016 + rng()*0.026)*ps(z), shade: rng() });
      }
      this.rocks.sort((a, b) => b.z - a.z);

      // Perches derived from the tree's real branch tips, so a bird lands on a
      // branch that is actually drawn — never floating in mid-air.
      const treeBase = py(this.treeZ), treeS = ps(this.treeZ);
      const tips = this.tree
        .filter(sg => sg.w <= 1)
        .map(sg => ({ x: this.treeX + sg.x2*0.5*treeS*1.45,
                      y: treeBase + sg.y2*0.9*treeS*1.45 }))
        .filter(p => p.y < treeBase - 0.03 && p.x > 0.04 && p.x < 0.96)
        .sort((a, b) => a.y - b.y);
      this.perches = [];
      const nBranch = 4 + Math.floor(rng()*2);
      for (let k = 0; k < nBranch && tips.length; k++) {
        const tp = tips[Math.floor(rng()*rng()*tips.length)];   // biased to the crown
        this.perches.push({ x: tp.x, y: tp.y, depth: 3 + rng()*2.5, type: "branch" });
      }
      // the hedge top and a shrub or two also serve as song posts
      for (const p of this.hedge.posts) {
        this.perches.push({ x: p.x, y: p.y, depth: 7 + rng()*3, type: "branch" });
      }
      for (const bu of this.shrubs.slice(0, 1 + Math.floor(rng()*2))) {
        this.perches.push({ x: bu.x, y: bu.y - bu.r*1.5, depth: 7 + rng()*3, type: "ground" });
      }
      /* Ground perches are placed by depth now, and their `depth` — which is
         what the audio pans and filters by — is read off the same z, so a
         bird that looks far away sounds far away. */
      if (this.rocks.length) {
        const rk = this.rocks[Math.floor(rng()*this.rocks.length)];
        this.perches.push({ x: rk.x, y: rk.y, depth: 2 + rk.z*12, type: "ground" });
      }
      for (let k = 0; k < 3; k++) {
        const gz = 0.06 + rng()*0.45, gx1 = 0.12 + rng()*0.76;
        this.perches.push({ x: gx1, y: py(gz), depth: 2 + gz*12, type: "ground" });
      }
      const hz = this.bounds[1].z, hx = 0.28 + rng()*0.44;
      this.perches.push({ x: hx, y: this.bounds[1].line(hx) - 0.004, depth: 2 + hz*12, type: "ground" });
    } else if (loc === "forest") {
      this.hillA = this.makeRidge(rng, 0.55, 0.06);
      /* The floor of a wood, which had a band of four and a half per cent of
         frame height to live in — every deer, badger and squirrel at the same
         size on the same line. Its horizon is eye level among the trunks. */
      this.plane = this.makePlane(0.60, 1.045, 0.845 + rng()*0.02);
      /* Three ranks of trunk, and now they stand at three depths rather than
         all meeting the floor on one line at 0.93. A wood is the one place
         where the recession of the ground is completely hidden by what is
         standing on it — unless the things standing on it recede too. */
      this.trunksFar = []; this.trunksMid = []; this.trunksNear = [];
      for (let i = 0; i < 11; i++) {
        const tr = this.makeTrunk(rng, 0.30 + rng()*0.12, 2.8 + rng()*1.8, 0.85);
        tr.z = 0.78 + rng()*0.2; this.trunksFar.push(tr);
      }
      for (let i = 0; i < 7; i++) {
        const tr = this.makeTrunk(rng, 0.23 + rng()*0.10, 4.6 + rng()*2.8, 1);
        tr.z = 0.42 + rng()*0.22; this.trunksMid.push(tr);
      }
      for (let i = 0; i < 6; i++) {
        const tr = this.makeTrunk(rng, 0.16 + rng()*0.10, 7.5 + rng()*5, 1.25);
        tr.z = 0.06 + rng()*0.20; this.trunksNear.push(tr);
      }
      /* Undergrowth, standing where its depth puts it and as tall as that
         depth allows. Along one line at 0.93 it was a fringe pinned to the
         bottom of the picture; spread through the wood it is a floor. */
      this.grass = [];
      for (let i = 0; i < 130; i++) {
        const z = Math.pow(rng(), 1.6);
        this.grass.push({ x: rng()*1.06 - 0.03, z, y: this.planeY(z),
          h: (0.045 + rng()*0.055)*(this.planeScale(z)/this.plane.top),
          ph: rng()*Math.PI*2, lean: (rng()-0.5)*1.2 });
      }
      this.grass.sort((a, b) => b.z - a.z);
      this.ferns = [];
      for (let i = 0; i < 22; i++) {
        const z = Math.pow(rng(), 1.5);
        this.ferns.push({ x: rng(), z, y: this.planeY(z),
          size: (0.045 + rng()*0.055)*(this.planeScale(z)/this.plane.top),
          lean: (rng()-0.5)*0.7, blades: 4 + Math.floor(rng()*3) });
      }
      this.ferns.sort((a, b) => b.z - a.z);
      this.mushrooms = [];
      for (let i = 0; i < 8 + Math.floor(rng()*6); i++) {
        const z = Math.pow(rng(), 1.7)*0.8;
        this.mushrooms.push({ x: rng(), z, y: this.planeY(z),
          size: (0.009 + rng()*0.014)*(this.planeScale(z)/this.plane.top),
          tall: rng() < 0.5, tone: rng() });
      }
      this.mushrooms.sort((a, b) => b.z - a.z);
      // Pools of light let through the canopy. They drift as the crowns move
      // and breathe as the leaves open and close over them.
      this.dapples = [];
      for (let i = 0; i < (REDUCED ? 4 : 11); i++) {
        this.dapples.push({ x: rng(), y: 0.935 + rng()*0.055,
          w: 0.03 + rng()*0.075, ph: rng()*Math.PI*2,
          sp: 0.002 + rng()*0.004, tw: 0.25 + rng()*0.5 });
      }
      this.leaves = [];
      for (let i = 0; i < (REDUCED ? 4 : 13); i++) {
        this.leaves.push({ x: rng(), y: rng(), sp: 0.012 + rng()*0.022,
          drift: (rng()-0.5)*0.035, ph: rng()*Math.PI*2, rot: rng()*Math.PI*2 });
      }
      // Perches sit at the leaning tops of trunks, just under their canopies —
      // near ones and a few mid-distance ones, plus spots on the litter below.
      this.perches = this.trunksNear.slice(0, 4 + Math.floor(rng()*2)).map(tr => (
        { x: tr.x + tr.lean*2, y: tr.top + 0.07 + rng()*0.05, depth: 3 + rng()*4, type: "branch" }
      ));
      for (const tr of (this.trunksMid || []).slice(0, 2 + Math.floor(rng()*2))) {
        this.perches.push({ x: tr.x + tr.lean*2, y: tr.top + 0.06 + rng()*0.05,
          depth: 7 + rng()*4, type: "branch" });
      }
      for (let k = 0; k < 2; k++) {
        const fpx = 0.15 + rng()*0.7;
        this.perches.push({ x: fpx, y: 0.9 + rng()*0.02, depth: 4 + rng()*4, type: "ground" });
      }
    } else if (loc === "beach") {
      this.horizonY = 0.50 + rng()*0.05;
      this.shoreY = 0.80 + rng()*0.03;
      /* The sand, from the water's edge to your feet. It is a shallow plane —
         a strand seen from a dune really is foreshortened — but a shallow one
         is still an honest one, where a fixed band was not. */
      this.plane = this.makePlane(this.horizonY, 1.03, this.shoreY + 0.012);
      this.foam = [{ p: rng() }, { p: rng() }, { p: rng() }];
      this.wet = 0;          // how far up the sand the last wave reached
      this.duneSide = rng() < 0.5 ? 0 : 1;
      /* Marram on the dune, at its own depths like everything else. */
      this.duneGrass = [];
      for (let i = 0; i < 54; i++) {
        const gx = this.duneSide === 0 ? rng()*0.28 : 0.72 + rng()*0.28;
        const z = Math.pow(rng(), 1.6);
        this.duneGrass.push({ x: gx, z, y: this.planeY(z),
          h: (0.075 + rng()*0.085)*(this.planeScale(z)/this.plane.top),
          ph: rng()*Math.PI*2, lean: (rng()-0.5)*1.3 });
      }
      this.duneGrass.sort((a, b) => b.z - a.z);
      // pebbles and shells on the wet sand, a rock islet offshore, driftwood
      /* Stones on the strand. A shingle at your feet is the size of a fist
         and one at the water's edge is a speck, and drawn all one size they
         were the flattest thing on the beach. */
      this.pebbles = [];
      for (let i = 0; i < 26 + Math.floor(rng()*16); i++) {
        const z = Math.pow(rng(), 1.5);
        this.pebbles.push({ x: rng(), z, y: this.planeY(z),
          r: (0.009 + rng()*0.020)*(this.planeScale(z)/this.plane.top),
          shade: rng(), shell: rng() < 0.18 });
      }
      this.pebbles.sort((a, b) => b.z - a.z);
      // a natural rock islet out on the water (no boats — this is a wild place)
      this.islet = rng() < 0.65 ? { x: 0.12 + rng()*0.76, w: 0.05 + rng()*0.07, h: 0.018 + rng()*0.022 } : null;
      this.driftwood = rng() < 0.6 ? { x: 0.18 + rng()*0.6, w: 0.05 + rng()*0.06, ang: (rng()-0.5)*0.4 } : null;
      /* Groyne posts, standing in a line down the beach — so each is a
         little further off than the last, and a little shorter for it. */
      this.posts = [];
      const npost = 3 + Math.floor(rng()*3);
      for (let i = 0; i < npost; i++) {
        const z = 0.10 + (i/Math.max(1, npost - 1))*0.78 + (rng() - 0.5)*0.08;
        const sc = this.planeScale(z)/this.plane.top;
        this.posts.push({ x: 0.14 + rng()*0.72, z, y: this.planeY(z),
          h: (0.085 + rng()*0.05)*sc, w: Math.max(1.2, 4.2*sc) });
      }
      this.posts.sort((a, b) => b.z - a.z);
      this.perches = this.posts.map(p => ({ x: p.x, y: p.y - p.h,
        depth: 2 + p.z*12, type: "post" }));
      for (let k = 0; k < 2 + Math.floor(rng()*2); k++) {
        this.perches.push({ x: 0.12 + rng()*0.76, y: this.shoreY + 0.05 + rng()*0.06,
          depth: 2.5 + rng()*3, type: "ground" });
      }
      if (this.driftwood) {
        this.perches.push({ x: this.driftwood.x, y: this.shoreY + 0.085,
          depth: 3 + rng()*2, type: "ground" });
      }
      if (this.islet) {
        this.perches.push({ x: this.islet.x, y: this.horizonY + (this.shoreY - this.horizonY)*0.14 - this.islet.h,
          depth: 14 + rng()*4, type: "ground" });
      }
    } else if (loc === "wetland") {
      this.treeline = this.makeRidge(rng, 0.50, 0.03);
      this.waterY = 0.56 + rng()*0.03;
      this.bankY = 0.86;
      /* Bank and shallows together: a heron out in the water is further off
         than a moorhen at the reeds, and until now they were the same size on
         the same line four per cent of the frame apart. */
      this.plane = this.makePlane(this.waterY, 1.03, this.waterY + 0.085 + rng()*0.02);
      this.rippleLines = [];
      for (let i = 0; i < 5; i++) {
        this.rippleLines.push({ y: this.waterY + 0.05 + rng()*(this.bankY - this.waterY - 0.08), ph: rng()*Math.PI*2, sp: 0.06 + rng()*0.08 });
      }
      /* Reeds, at their own depths. Forty-two identical stems along one line
         is a picket fence standing in water; a reed bed is stems at every
         distance, the far ones a fine fringe and the near ones over your
         head. They keep to the sides, where the bank is. */
      this.reeds = [];
      for (let i = 0; i < 78; i++) {
        const side = rng();
        const x = side < 0.55 ? rng()*0.36 : 0.64 + rng()*0.36;
        const z = Math.pow(rng(), 1.5);
        this.reeds.push({ x, z, y: this.planeY(z),
          h: (0.20 + rng()*0.16)*(this.planeScale(z)/this.plane.top),
          ph: rng()*Math.PI*2, head: rng() < 0.45, lean: (rng()-0.5)*0.5 });
      }
      // lily pads on the open water, a half-sunk log, trees along the far bank
      this.lilies = [];
      for (let i = 0; i < 7 + Math.floor(rng()*5); i++) {
        this.lilies.push({ x: 0.12 + rng()*0.76,
          y: this.waterY + 0.06 + rng()*(this.bankY - this.waterY - 0.1),
          r: 0.014 + rng()*0.022, bloom: rng() < 0.4, ph: rng()*Math.PI*2,
          rock: 0, rockV: 0 });
      }
      this.log = rng() < 0.6 ? { x: 0.14 + rng()*0.5,
        y: this.waterY + 0.05 + rng()*0.06, w: 0.12 + rng()*0.1, ang: (rng()-0.5)*0.24 } : null;
      this.distantTrees = [];
      for (let i = 0; i < 3 + Math.floor(rng()*3); i++) {
        const x = rng();
        this.distantTrees.push({ x, y: this.treeline(x), h: 0.045 + rng()*0.055, r: 0.02 + rng()*0.022 });
      }
      const tall = this.reeds.filter(r => r.h > 0.2);
      this.perches = tall.slice(0, 4 + Math.floor(rng()*3)).map(r =>
        ({ x: r.x, y: this.bankY - r.h, depth: 3 + rng()*4, type: "reed", reedH: r.h }));
      if (this.log) {
        this.perches.push({ x: this.log.x, y: this.log.y - 0.012,
          depth: 4 + rng()*3, type: "branch" });
      }
      for (let k = 0; k < 2; k++) {
        this.perches.push({ x: 0.2 + rng()*0.6, y: this.bankY - 0.004,
          depth: 5 + rng()*4, type: "ground" });
      }
    } else {
      /* The street. It is the shallowest plane of the five — you are looking
         down at a pavement from a first-floor window, not out across a field
         — but a cat crossing it near should still be bigger than one at the
         far kerb, and until now nothing in the city knew that. */
      this.plane = this.makePlane(0.80, 1.03, CITY_GROUND + 0.008);
      this.backBlocks = this.makeSkyline(rng, 0.30, 0.28, 0.05, 0.10);
      this.frontBlocks = this.makeSkyline(rng, 0.55, 0.30, 0.07, 0.13);
      for (const b of this.frontBlocks) {
        b.antenna = rng() < 0.30;
        b.roof = ["none", "none", "tower", "chimney", "box", "dish"][Math.floor(rng()*6)];
        b.roofU = 0.22 + rng()*0.56;              // where the rooftop feature sits
        b.cols = 2 + Math.floor(rng()*4);          // window grid for daylight
        b.smoke = rng()*Math.PI*2;
        b.lit = [];
        const n = 3 + Math.floor(rng() * 9);
        for (let i = 0; i < n; i++) {
          // Each window keeps its own hours: on for a while, off for a while,
          // switching over minutes rather than flickering like a candle.
          b.lit.push({ u: 0.12 + rng()*0.76, v: 0.08 + rng()*0.8, ph: rng()*Math.PI*2,
            on: rng() < 0.72, next: 20 + rng()*160, flicker: rng() < 0.12 });
        }
        b.vent = rng() < 0.3 ? { u: 0.2 + rng()*0.6, ph: rng()*Math.PI*2 } : null;
      }
      // street-level lamps that warm the pavement after dark
      this.streetlamps = [];
      for (let i = 0; i < 5 + Math.floor(rng()*5); i++) {
        this.streetlamps.push({ x: 0.03 + rng()*0.94, ph: rng()*Math.PI*2 });
      }
      this.perches = [];
      const nRoof = 5 + Math.floor(rng()*3);
      for (let i = 0; i < nRoof && this.frontBlocks.length; i++) {
        const b = this.frontBlocks[Math.floor(rng()*this.frontBlocks.length)];
        this.perches.push({ x: b.x + b.w * rng(), y: CITY_GROUND - b.h, depth: 4 + rng()*5, type: "roof" });
      }
      // aerial tips make favourite lookouts
      for (const b of this.frontBlocks) {
        if (b.antenna && rng() < 0.6) {
          this.perches.push({ x: b.x + b.w*0.5, y: CITY_GROUND - b.h - 0.035, depth: 4 + rng()*4, type: "post" });
        }
      }
      // and the far skyline carries the odd distant silhouette
      if (this.backBlocks.length && rng() < 0.7) {
        const bb = this.backBlocks[Math.floor(rng()*this.backBlocks.length)];
        this.perches.push({ x: bb.x + bb.w*rng(), y: CITY_GROUND - (bb.h + 0.18), depth: 12 + rng()*4, type: "roof" });
      }
    }
  }

  makeRidge(rng, base, amp) {
    const waves = [];
    for (let i = 0; i < 4; i++) waves.push({ f: 1.5 + rng()*4 + i*2, ph: rng()*Math.PI*2, a: amp * (0.6 - i*0.12) });
    return (x) => {
      let y = base;
      for (const w of waves) y += Math.sin(x * w.f * Math.PI + w.ph) * w.a;
      return y;
    };
  }
  makeGrass(rng, n, hMin, hVar) {
    const g = [];
    for (let i = 0; i < n; i++) g.push({ x: rng(), h: hMin + rng()*hVar, ph: rng()*Math.PI*2, lean: (rng()-0.5)*0.6 });
    return g;
  }
  /* The field tree. It used to fork the moment it left the ground and divide
     at the same wide angle all the way up, which gave a short bare stalk
     carrying two heavy lobes — a catapult, not a tree. A tree has a bole
     before the first division; it divides narrowly low down and more widely
     the further out it gets; and the divisions keep going long enough that the
     ends are fine. */
  makeTree(rng) {
    const segs = [];
    const grow = (x, y, ang, len, depth) => {
      const nx = x + Math.cos(ang)*len, ny = y + Math.sin(ang)*len;
      segs.push({ x1: x, y1: y, x2: nx, y2: ny, w: depth });
      if (depth <= 0) return;
      const n = depth > 3 ? 2 : (rng() < 0.5 ? 2 : 3);
      const spread = 0.34 + (5 - depth)*0.19;       // narrow low, wide out at the ends
      for (let i = 0; i < n; i++) {
        const k = n === 1 ? 0 : (i/(n - 1) - 0.5)*2;
        grow(nx, ny, ang + k*spread + (rng() - 0.5)*0.26,
          len*(0.68 + rng()*0.12), depth - 1);
      }
    };
    const a0 = -Math.PI/2 + (rng() - 0.5)*0.16;
    const bole = 0.075;
    const bx = Math.cos(a0)*bole, by = Math.sin(a0)*bole;
    segs.push({ x1: 0, y1: 0, x2: bx, y2: by, w: 6 });   // the trunk, undivided
    grow(bx, by, a0, bole, 5);
    return segs;
  }
  makeTrunk(rng, top, w, crown) {
    const canopy = [];
    const k = crown || 1;
    const nb = 4 + Math.floor(rng()*3);
    // The clump always has a blob square on the trunk top, and the rest are
    // gathered tightly around it — a crown grows out of its own tree.
    canopy.push({ dx: 0, dy: -0.012*k, r: (0.042 + rng()*0.032)*k });
    for (let i = 1; i < nb; i++) {
      // spread wider than tall, so a crown sits in the air like a crown and
      // not like a ball balanced on a pole
      canopy.push({ dx: (rng()-0.5)*0.075*k, dy: (rng()-0.62)*0.032*k,
        r: (0.028 + rng()*0.038)*k });
    }
    return { x: 0.05 + rng()*0.9, top, w, lean: (rng()-0.5)*0.02, canopy };
  }
  makeSkyline(rng, hBase, hVar, wMin, wVar) {
    const blocks = [];
    let x = -0.02;
    while (x < 1.02) {
      const w = wMin + rng()*wVar;
      blocks.push({ x, w, h: hBase * (0.5 + rng()) * 0.8 + rng()*hVar });
      x += w + rng()*0.015;
    }
    return blocks;
  }

  /* How many device pixels the window may cost. Blown up to full screen on a
     high-density display, a naive width×height×dpr² backing store runs to
     fifteen million pixels, and everything here is fill-rate work — gradients,
     glows, a sky repainted every frame — so the whole thing crawls. Cap the
     budget instead: the piece is soft-edged and none of it suffers for being
     rendered at a slightly lower density than the panel. */
  static PIXEL_BUDGET = 3.1e6;

  resize() {
    const r = this.canvas.getBoundingClientRect();
    const w = Math.max(1, r.width), h = Math.max(1, r.height);
    const want = Math.min(window.devicePixelRatio || 1, 2);
    const fit = Math.sqrt(Scene.PIXEL_BUDGET / (w*h));
    // `quality` is the adaptive term: it drops if frames start arriving late,
    // and recovers when they don't.
    const dpr = Math.max(0.62, Math.min(want, fit) * (this.quality || 1));
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.dpr = dpr;
    this.W = w; this.H = h;
    this._skyKey = null;         // the sky gradient is keyed on height
    this._fogKey = null;
    this._paths.clear();         // land outlines are in pixels, and these have changed
  }

  /* Watch the frame time and give ground if the browser cannot keep up. Some
     engines are markedly slower at large canvases than others, so rather than
     guess at a device we measure: sustained slow frames step the render scale
     down, a sustained run of quick ones lets it back up. Both moves are small
     and rare, so the picture never visibly pulses. */
  adaptQuality(dt) {
    // Ignore the first couple of seconds: modules are still warming up and the
    // first paint is always slow, and a scene that shrank itself over that
    // would never grow back. Judge only a long-run average after that.
    this.warm = (this.warm || 0) + dt;
    if (this.warm < 2.5) { this.frameMs = 16.7; return; }
    this.frameMs += (dt*1000 - this.frameMs)*0.04;
    this.quality = this.quality || 1;
    if ((this.qualityHold = (this.qualityHold || 0) - dt) > 0) return;
    if (this.frameMs > 24 && this.quality > 0.55) {
      this.quality = Math.max(0.55, this.quality - 0.15);
      this.qualityHold = 3; this.resize();
    } else if (this.frameMs < 13.5 && this.quality < 1) {
      this.quality = Math.min(1, this.quality + 0.1);
      this.qualityHold = 5; this.resize();
    }
  }

  /* Choose a song post. Birds hold space: a arriving singer takes a perch
     that nobody is already sitting on, which is what stops three of them
     stacking in one corner of the frame. `opts.at` asks for the perch nearest
     a given spot (a bird returning to its own post mid-argument), and
     `opts.awayFrom` for one at a distance from a rival's. */
  pickPerch(rand, opts) {
    const ps = this.perches;
    if (!ps || !ps.length) return { x: rand(), y: 0.8, depth: 6, type: null };
    opts = opts || {};
    const taken = [];
    for (const a of this.actors) if (!a.leave) taken.push(a.restX);
    let best = ps[0], bestScore = -Infinity;
    for (const p of ps) {
      let score = rand()*0.4;                      // never quite the same choice twice
      // A perch the singer itself is holding is not "occupied" for its own sake.
      const mine = opts.at !== undefined && Math.abs(p.x - opts.at) < 0.05;
      if (!mine) {
        let near = Infinity;
        for (const tx of taken) near = Math.min(near, Math.abs(p.x - tx));
        score -= 5 * Math.max(0, 1 - near/0.13);
      }
      if (opts.at !== undefined) score += 3 * Math.max(0, 1 - Math.abs(p.x - opts.at)/0.1);
      else if (opts.awayFrom !== undefined) score += Math.min(1.6, Math.abs(p.x - opts.awayFrom)*3.4);
      if (score > bestScore) { bestScore = score; best = p; }
    }
    return best;
  }

  /* Is this species already sitting about here? Then it can answer where it
     stands rather than flying in a second time. */
  hasSingerNear(id, x01) {
    for (const a of this.actors) {
      if (a.id === id && !a.leave && Math.abs(a.restX - x01) < 0.05) return true;
    }
    return false;
  }

  addRipple(x01, y01, tone) {
    const rgb = tone === "sage" ? this.tok.sageRGB : this.tok.amberRGB;
    this.ripples.push({ x: x01, y: y01, age: 0, life: 2.2, rgb });
    if (this.ripples.length > 10) this.ripples.shift();
  }

  addFlyer(dir) {
    const kind = this.loc === "beach" ? "gull" : this.loc === "city" ? "swift" : "bird";
    this.flyers.push({
      kind,
      x: dir > 0 ? -0.06 : 1.06, y: 0.12 + Math.random()*0.3,
      vx: dir * (kind === "swift" ? 0.10 + Math.random()*0.05 : 0.025 + Math.random()*0.02),
      ph: Math.random()*Math.PI*2, age: 0,
      size: kind === "gull" ? 5 + Math.random()*3 : kind === "swift" ? 2.5 + Math.random()*1.5 : 3 + Math.random()*2.5
    });
  }

  /* Where a far-off caller stands: on the skyline — the crown of a distant
     tree, a mid-distance trunk, or the far ridge itself — so it reads as
     half a mile off rather than as a small bird close to. */
  farPerch(x01, onGround) {
    const x = Math.min(0.94, Math.max(0.06, x01));
    // A cockerel is on the ground of a farm over the hill, not up a tree, so
    // it wants the skyline itself; a cuckoo wants something to sit on.
    if (onGround) {
      const r0 = this.hillA || this.treeline;
      return r0 ? { x, y: r0(x) - 0.002, ridge: r0(x) } : { x, y: 0.6, ridge: 0.6 };
    }
    if (this.loc === "forest" && this.trunksMid && this.trunksMid.length) {
      let best = this.trunksMid[0], bd = 9;
      for (const tr of this.trunksMid) {
        const d = Math.abs(tr.x - x); if (d < bd) { bd = d; best = tr; }
      }
      return { x: best.x + best.lean*2, y: best.top + 0.07, ridge: null };
    }
    if (this.distantTrees && this.distantTrees.length) {
      let best = this.distantTrees[0], bd = 9;
      for (const t of this.distantTrees) {
        const d = Math.abs(t.x - x); if (d < bd) { bd = d; best = t; }
      }
      return { x: best.x + (best.x < 0.5 ? best.r*0.9 : -best.r*0.9),
        y: best.y - best.h*0.92, ridge: null };
    }
    const ridge = this.hillA || this.treeline;
    return ridge ? { x, y: ridge(x) - 0.002, ridge: ridge(x) } : { x, y: 0.55, ridge: null };
  }

  /* A voice becomes a visible animal at its own coordinates. */
  spawnForCall(sp, x01, y01, depth, dur, enter = 0, perchType = null) {
    const id = sp.id;
    if (id === "cricket" || id === "curlew") return;   // heard from cover, never seen
    // A bird singing again from the post it already holds is the same bird:
    // let it open its bill where it stands rather than conjuring a second one
    // on top of the first.
    for (const a0 of this.actors) {
      if (a0.id === id && !a0.leave && Math.abs(a0.restX - x01) < 0.05) {
        a0.singAt = a0.t + enter; a0.dur = dur;
        a0.linger = 1.6 + Math.random()*2.2;
        a0.gest = null; a0.gestFlip = false; a0.nextGest = undefined;
        return;
      }
    }
    if (sp.layer === "air") {
      if (id === "gull") {
        this.flyers.push({ kind: "gull", x: x01, y: y01, age: 0,
          vx: (Math.random() < 0.5 ? 1 : -1) * (0.02 + Math.random()*0.015),
          ph: Math.random()*6, size: 5.5 + Math.random()*2 });
      } else if (id === "swift") {
        for (let i = 0; i < 2; i++) {
          this.flyers.push({ kind: "swift", x: x01 - 0.05 + Math.random()*0.1,
            y: y01 + (Math.random()-0.5)*0.06, age: 0,
            vx: (x01 < 0.5 ? 1 : -1) * (0.09 + Math.random()*0.05),
            ph: Math.random()*6, size: 2.5 + Math.random() });
        }
      } else if (id === "skylark") {
        this.flyers.push({ kind: "lark", x: x01, y: y01, vx: 0, age: 0,
          ph: Math.random()*6, size: 2.4 + Math.random()*0.8, hold: dur + 1.2 });
      } else if (id === "tern") {
        this.flyers.push({ kind: "tern", x: x01, y: y01, age: 0,
          vx: (Math.random() < 0.5 ? 1 : -1) * (0.03 + Math.random()*0.02),
          ph: Math.random()*6, size: 4.2 + Math.random()*1.6 });
      } else if (id === "kestrel") {
        this.flyers.push({ kind: "kestrel", x: x01, y: Math.min(y01, 0.3), age: 0,
          vx: 0, ph: Math.random()*6, size: 4 + Math.random()*1.4,
          hold: dur + 3 + Math.random()*4 });
      } else if (id === "buzzard") {
        this.flyers.push({ kind: "buzzard", x: x01, y: Math.min(y01, 0.28), age: 0,
          cx: x01, cy: Math.min(y01, 0.28), ang: Math.random()*6.28, vx: 0,
          ph: Math.random()*6, size: 6 + Math.random()*2.2,
          hold: dur + 6 + Math.random()*8 });
      }
      return;
    }
    const hs = Math.max(0.75, Math.min(1.6, this.H / 430));
    // Every individual is a little different — size, plumpness, a rare crest,
    // its own idle rhythm — so no two callers feel stamped from one mould.
    const ivar = {
      scale: 0.82 + Math.random()*0.42,
      puff: 0.92 + Math.random()*0.22,
      crest: Math.random() < 0.28,
      tail: 0.9 + Math.random()*0.5,
      headPh: Math.random()*Math.PI*2,
      tailPh: Math.random()*Math.PI*2,
      breathPh: Math.random()*Math.PI*2,
      lookEvery: 2.2 + Math.random()*2.6,
      rim: Math.random() < 0.5
    };
    const a = {
      id, x: x01, y: y01, perchType,
      s: Math.max(3.5, Math.min(16, 15.5 - depth*0.62)) * hs * ivar.scale,   // far = smaller, near = bigger
      t: 0, dur, alpha: 1, flip: x01 > 0.55, ivar,
      // Most callers say their piece and move on. About a third settle in:
      // they stay a good while, preening and looking about the place, and
      // leave in their own time.
      linger: Math.random() < 0.34 ? 14 + Math.random()*34 : 2 + Math.random()*4.5,
      leave: null,
      depthMix: Math.min(0.42, 0.10 + depth*0.013), data: {}
    };
    if (sp.layer === "far") {
      // A caller on the skyline: small, sky-washed, and standing on something
      // that is actually drawn — a treetop or the ridge itself.
      const spot = this.farPerch(x01, id === "rooster");
      a.x = spot.x; a.y = spot.y;
      a.s = Math.max(4.5, Math.min(11, 13 - depth*0.26)) * hs;
      a.depthMix = 0.42;
      a.flip = spot.x > 0.5;
      a.ridgeY = spot.ridge;                       // set when it stands on a skyline
      a.beh = id === "rooster" ? "cockerel" : "cuckoo";
      a.linger = 2.5 + Math.random()*3.5;
    }
    else if (id === "owl") { a.beh = "owl"; a.linger = 3 + Math.random()*2; a.s *= 1.25; }
    else if (id === "frog") { a.beh = "frog"; a.s *= 0.9; }
    else if (id === "mallard" || id === "moorhen") {
      a.beh = "duck"; a.linger = 4 + Math.random()*3;
      const wy = this.waterY || 0.6, by = this.bankY || 0.9;
      a.y = Math.min(Math.max(y01, wy + 0.05), by - 0.04);
      a.data.dir = Math.random() < 0.5 ? 1 : -1;
      if (id === "moorhen") { a.data.moorhen = true; a.s *= 0.8; }
      /* A brood behind her. Ducklings do not swim in a line — they swim in a
         scribble, all of them roughly astern and each one making its own
         way — so each gets its own offset and its own rock, and none of them
         is ever quite where the last one was. */
      if (Math.random() < 0.35) {
        const nd = 3 + Math.floor(Math.random()*5);
        a.data.brood = [];
        for (let i = 0; i < nd; i++) {
          a.data.brood.push({ dx: 0.022 + Math.random()*0.075,
            dy: (Math.random() - 0.5)*0.020, ph: Math.random()*Math.PI*2,
            sp: 0.9 + Math.random()*0.7, sz: 0.30 + Math.random()*0.10,
            wob: 0.004 + Math.random()*0.008 });
        }
      }
    }
    else if (id === "littleegret") {
      a.beh = "egret"; a.linger = 5 + Math.random()*4;
      if (this.loc === "wetland") {
        a.y = Math.min(Math.max(y01, (this.waterY || 0.6) + 0.08), (this.bankY || 0.9) - 0.01);
      }
    }
    else if (id === "pheasant") {
      a.beh = "pheasant"; a.linger = 3 + Math.random()*3;
    }
    else if (id === "lapwing") { a.linger = 2.5 + Math.random()*2; a.beh = "perch"; }
    else if (id === "kingfisher") { a.beh = "perch"; a.diver = true; }
    else if (id === "woodpecker") {
      a.beh = "pecker";
      let best = null, bd = 9;
      for (const tr of (this.trunksNear || [])) {
        const d = Math.abs(tr.x - x01);
        if (d < bd) { bd = d; best = tr; }
      }
      if (best) { a.x = best.x; a.y = best.top + 0.12 + Math.random()*0.1; }
    }
    else if (id === "oystercatcher") {
      a.beh = "wader"; a.y = (this.shoreY || 0.82) + 0.045;
      a.data.dir = Math.random() < 0.5 ? 1 : -1;
    }
    else a.beh = "perch";

    // A bird that has come down to the ground has somewhere to go and something
    // to look for, so it stays a good while longer than one on a branch.
    if (a.beh === "perch" && perchType === "ground") {
      a.ground = true;
      a.walks = !!(PSTYLE[id] || {}).walks;   // pigeons and plovers walk; finches hop
      a.linger = 4.5 + Math.random()*6;
    }

    // Entrance: the behaviour branch has fixed the resting spot; arrive there
    // from off the frame, and only begin the call once settled (a.singAt).
    a.restX = a.x; a.restY = a.y;
    a.enter = enter; a.singAt = enter;
    a.enterFromX = a.x; a.enterFromY = a.y;
    if (enter > 0) {
      const ground = a.beh === "frog" || a.beh === "wader" || a.beh === "duck";
      if (a.beh === "cockerel") {
        // Comes up over the brow of the hill from the farm on the far side.
        // The ridge itself hides it on the way, so it needs no fade to do it.
        a.alpha = 1;
        a.enterFromX = a.restX + (a.flip ? -1 : 1)*0.012;
        a.enterFromY = a.restY + 0.055;
      } else if (a.beh === "cuckoo") {
        // In along the skyline on quick shallow beats, to the treetop.
        a.flightIn = true;
        a.alpha = 1;
        const side = Math.random() < 0.5 ? -1 : 1;
        a.enterFromX = side < 0 ? -0.14 : 1.14;
        a.enterFromY = Math.max(0.04, a.restY - (0.04 + Math.random()*0.10));
        a.flip = side > 0;
      } else if (a.beh === "perch") {
        // A bird arrives on the wing: in over the edge of the frame, down
        // across the open air, a flare at the last moment, and only then is
        // it standing on the branch. Nothing simply appears out of nothing.
        a.flightIn = true;
        a.alpha = 1;
        const side = Math.random() < 0.5 ? -1 : 1;
        a.enterFromX = side < 0 ? -0.14 : 1.14;
        a.enterFromY = Math.max(0.04, a.restY - (0.16 + Math.random()*0.26));
        a.flip = side > 0;                     // it faces the way it is going
      } else if (ground || a.beh === "pheasant") {
        /* A duck, a wader, a frog, a pheasant: things that walk or swim into
           view. They used to slide a little way and fade up out of nothing,
           which is the one thing this piece is not supposed to do. Now they
           come in over the edge of the frame at full weight — and because an
           entrance only lasts a second or two, the resting spot is pulled back
           toward whichever edge they are coming from, so the walk is a walk
           and not a sprint. */
        a.alpha = 1;
        const side = a.restX < 0.5 ? -1 : 1;
        const reach = 0.17 * enter;             // as far as it will plausibly come
        a.restX = side < 0 ? Math.min(a.restX, -0.06 + reach)
                           : Math.max(a.restX, 1.06 - reach);
        a.enterFromX = side < 0 ? -0.06 : 1.06;
        a.enterFromY = a.restY;
        a.flip = side > 0;                      // facing the way it is going
      } else if (a.beh === "egret" || a.beh === "owl") {
        // Both of these leave on the wing, and both now arrive on it: in over
        // the edge, down across the open air, and only then standing.
        a.flightIn = true;
        a.alpha = 1;
        const side = Math.random() < 0.5 ? -1 : 1;
        a.enterFromX = side < 0 ? -0.16 : 1.16;
        a.enterFromY = Math.max(0.05, a.restY - (0.14 + Math.random()*0.20));
        a.flip = side > 0;
      } else {
        // a woodpecker: down onto the trunk from over the top of the frame,
        // which is where one arrives from — never out of the middle of the air
        a.alpha = 1;
        a.enterFromX = a.restX + (a.flip ? 1 : -1)*0.02;
        a.enterFromY = -0.08;
      }
      a.x = a.enterFromX; a.y = a.enterFromY;
    }

    this.actors.push(a);
    // With settlers about, the stage can fill. Rather than blinking the
    // earliest guest out of existence, ask it to leave the way it arrived.
    if (this.actors.length > 8) {
      const old = this.actors.find(x => !x.leave);
      if (!old) { this.actors.shift(); return; }
      old.leaveT = 0;
      old.flyDir = old.flip ? -1 : 1;
      old.launchX = old.x; old.launchY = old.y;
      old.leave = old.beh === "perch" ? "fly"
        : old.beh === "owl" ? "glide"
        : old.beh === "cuckoo" ? "fly"
        : old.beh === "cockerel" ? "sink"
        : old.beh === "pheasant" ? "walkoff"
        : old.beh === "egret" ? "heronoff" : "fade";
    }
  }

  /* A stroke of lightning somewhere out in the weather. The audio engine calls
     this the moment it decides on one and only sounds the thunder afterwards,
     by however long the distance takes — light first, then the roll, which is
     the whole reason a distant storm feels distant. `far` is 0 overhead and 1
     a long way off; a far strike lights the cloud without lighting the land. */
  lightning(far) {
    this.flashT = 0;
    this.flashFar = Math.max(0, Math.min(1, far));
    // A stroke happens somewhere, and for the tenth of a second it lasts it
    // is the only light there is: the shadows point away from *it*.
    this.flashX = 0.12 + Math.random()*0.76;
  }

  /* How much of the frame the flash is lighting right now, 0 to 1. Read both
     by the light — a near stroke throws a hard shadow from wherever it
     happened — and by the wash that goes over the land. */
  flashLit() {
    if (this.flashT === undefined || this.flashT >= 1) return 0;
    return gaitAt("strike", this.flashT, "lit") * (1 - this.flashFar*0.72);
  }

  updateFlash(dt) {
    if (this.flashT === undefined || this.flashT >= 1) return;
    this.flashT = Math.min(1, this.flashT + dt/0.55);
  }

  drawFlash(c, W, H) {
    const lit = this.flashLit();
    if (lit < 0.004) return;
    // Most of it is up in the cloud: a wash across the sky that fades out
    // before it reaches the ground, and barely touches the near foreground.
    const g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, `rgba(${this.tok.foamRGB}, ${lit*0.42})`);
    g.addColorStop(0.55, `rgba(${this.tok.foamRGB}, ${lit*0.16})`);
    g.addColorStop(1, `rgba(${this.tok.foamRGB}, ${lit*0.04})`);
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);

    /* And the land. A stroke that lights the sky and leaves the ground
       exactly as it was is a filter over a photograph, not a thing happening
       in the frame — the whole point of lightning is that for a moment you
       see the field. So the light lands where the stroke was and falls off
       with distance from it, over everything, on top of everything. Screen
       rather than a flat wash, because it is light being added. */
    const near = 1 - this.flashFar;
    const a = lit*(0.20 + near*0.34);
    if (a < 0.01) return;
    const lx = (this.flashX !== undefined ? this.flashX : 0.5) * W;
    const pool = c.createRadialGradient(lx, H*0.18, 0, lx, H*0.18, W*(0.5 + near*0.5));
    pool.addColorStop(0, `rgba(${this.tok.foamRGB}, ${a})`);
    pool.addColorStop(0.6, `rgba(${this.tok.foamRGB}, ${a*0.45})`);
    pool.addColorStop(1, `rgba(${this.tok.foamRGB}, 0)`);
    c.save();
    c.globalCompositeOperation = "screen";
    c.fillStyle = pool;
    c.fillRect(0, 0, W, H);
    c.restore();
  }

  fishRise(x01) {
    if (this.loc !== "wetland") return;
    const y = this.waterY + 0.06 + Math.random() * (this.bankY - this.waterY - 0.12);
    this.fishRings.push({ x: Math.min(0.92, Math.max(0.08, x01)), y, age: 0 });
  }

  foamPulse() {
    if (this.loc !== "beach" || !this.foam) return;
    let idx = 0;
    this.foam.forEach((f, i) => { if (f.p > 0.85 || f.p < 0.02) idx = i; });
    this.foam[idx].p = 0.001;
  }

  /* Something has come through, and the engine is the one that decides what
     is said about it — the scene only knows that it happened and where. Set
     by main.js; absent in the bestiary, which has no engine behind it. */
  raiseAlarm(x, cause) {
    if (this.onAlarm) this.onAlarm(x, cause);
  }

  /* ---- Something has come through --------------------------------------
     A fox crosses the meadow, a cat gets up on the city wall, and every bird
     that was singing stops singing and goes. This is the visible half of it;
     the silence that follows is `AudioEngine.alarm`.

     `x` is where in the frame the thing appeared. Birds nearest it go first
     and go furthest — a bird on the other side of the frame looks up, and a
     bird ten feet away leaves — which is the difference between a flock
     reacting to something and a flock all doing the same thing at once. */
  flush(x) {
    let went = 0;
    for (const a of this.actors) {
      if (a.leave) continue;                  // already on its way
      const near = 1 - Math.min(1, Math.abs(a.x - x)*1.6);
      if (Math.random() > 0.45 + near*0.5) continue;
      a.leaveT = 0;
      a.launchX = a.x; a.launchY = a.y;
      // away from it, whichever way that is
      a.flyDir = a.x < x ? -1 : 1;
      a.flip = a.flyDir < 0;
      // Everything goes up hard. A ground bird clatters, a perched one springs
      // — but nothing walks away from a fox, and nothing dives to feed.
      a.leave = (a.beh === "ground" || a.beh === "pheasant") ? "flush"
        : a.beh === "owl" ? "glide"
        : a.beh === "egret" ? "heronoff" : "fly";
      a.dur = 0; a.singAt = -99;              // whatever it was saying, it stops
      went++;
    }
    /* And the four-footed company scatters too, which is most of what makes
       the frame feel like it has been walked through rather than merely
       drawn on. Only the things that would actually run. */
    for (const cr of this.critters) {
      if (cr.kind === "rabbit" || cr.kind === "hare" || cr.kind === "squirrel"
          || cr.kind === "deer" || cr.kind === "hedgehog") {
        cr.bolt = (cr.x < x) ? -1 : 1;
        cr.boltT = 0;
      }
    }
    return went;
  }

  frame(now) {
    if (!this.active) return;                // the window is shut; nothing stirs
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.t += dt;
    const k = Math.min(1, dt * 1.2);
    for (const ph of PHASES) {
      this.timeMix[ph] += ((state.time === ph ? 1 : 0) - this.timeMix[ph]) * k;
    }
    this.update(dt);
    this.draw(dt);
    /* New arrivals come after the frame is drawn, which is where they always
       came, and it is load-bearing rather than incidental: a creature's painter
       reads values its update pass leaves behind — the fox's crouch, the
       dragonfly's jitter — so anything spawned before the painting would be
       drawn a frame before it had ever been stepped, and asked for a pose it
       does not yet have. */
    this.spawnCritters(dt);
    this.adaptQuality(dt);
    requestAnimationFrame(this._frame);
  }

  skyColors() {
    const m = this.timeMix, sky = this.tok.sky;
    const total = m.dawn + m.day + m.dusk + m.night || 1;
    const top = this._top || (this._top = [0,0,0,1]);
    const bot = this._bot || (this._bot = [0,0,0,1]);
    top[0] = top[1] = top[2] = 0; bot[0] = bot[1] = bot[2] = 0;
    for (const ph of PHASES) {
      const w = m[ph] / total, s = sky[ph];
      top[0] += s[0][0]*w; top[1] += s[0][1]*w; top[2] += s[0][2]*w;
      bot[0] += s[1][0]*w; bot[1] += s[1][1]*w; bot[2] += s[1][2]*w;
    }
    return this._sky || (this._sky = [top, bot]);
  }

  nightness() {
    const m = this.timeMix, total = m.dawn+m.day+m.dusk+m.night || 1;
    return (m.night + m.dusk * 0.35) / total;
  }

  draw(dt) {
    const c = this.ctx, W = this.W, H = this.H;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    const [top, bot] = this.skyColors();
    const night = this.nightness();

    /* A lost GL context drops us back to painting the sky here, mid-session.
       Do it before anything is drawn, so the swap costs at worst one frame. */
    if (this.onGL && !this.skyPainter.ok) {
      this.skyPainter = new Canvas2DSky(this);
      this.onGL = false;
      if (this.skyCanvas) this.skyCanvas.style.display = "none";
      this._skyKey = null;
    }
    // With the sky on the layer beneath, this canvas is glass: it has to be
    // wiped each frame. Painting its own sky, the opaque gradient is the wipe.
    if (this.onGL) c.clearRect(0, 0, W, H);

    const p = this.skyPainter;
    p.begin(W, H, this.dpr);
    p.sky(top, bot);
    this.drawCelestial(p, W, H, top, night);
    this.drawClouds(p, W, H, night);
    p.end();
    // the sun has just been placed; everything that casts reads it from here
    this.updateLight();

    switch (this.loc) {
      case "meadow": this.drawMeadow(c, W, H, dt, bot); break;
      case "forest": this.drawForest(c, W, H, dt, bot); break;
      case "beach": this.drawBeach(c, W, H, dt, top, bot, night); break;
      case "wetland": this.drawWetland(c, W, H, dt, top, bot, night); break;
      case "city": this.drawCity(c, W, H, dt, bot, night); break;
    }
    this.drawWetGround(c, W, H, top, bot);

    this.drawActors(c, W, H, bot, night);
    this.drawCritters(c, W, H, bot, night);
    this.drawFlyers(c, W, H, bot);
    this.drawForeground(c, W, H, dt, bot);   // the near edge, over everything living
    this.drawFireflies(c, W, H, night);
    this.drawWeather(c, W, H, night);
    this.drawFlash(c, W, H);
    this.drawRipples(c, W, H);
    if (PERF) this.drawPerf(c, dt);
  }

  /* Everything that moves, moved — and nothing drawn.

     The order here is not a matter of taste. Eight of these consume the shared
     Math.random stream, and the critters spawn from it too, so the sequence has
     to be the one the painting used to reach them in. Shuffle two of these lines
     and the same seed grows a different set of animals.

     Spawning is not here: it runs from frame(), after the painting, for the
     reason given there. So this is everything that *moves*, not everything that
     happens — worth knowing before hanging a fixed timestep off it. */
  update(dt) {
    const night = this.nightness();
    /* The weather moves first, because everything below reads where it got
       to. This is the only clock in the piece that runs at the rate a
       listener perceives, so it is the one that steps the sky. */
    stepWeather(dt, state.time);
    this.updateWetness(dt);
    this.updateWind(dt);
    this.updateFlash(dt);
    this.updateCelestial(dt);
    this.updateClouds(dt);
    this.updateLocation(dt, night);
    this.updateActors(dt);
    this.updateCritters(dt);
    this.updateFlyers(dt);
    this.updateFireflies(dt, night);
    this.updateWeather(dt);
    this.updateRipples(dt);
  }

  /* Each place keeps its own weather of moving parts, and each is stepped in the
     order its painter used to reach them — the cattle before the motes in the
     meadow, the foam before the sand it wets on the shore. */
  updateLocation(dt, night) {
    switch (this.loc) {
      case "meadow":
        this.updateSkyBirds(dt); this.updateCattle(dt); this.updateMotes(dt);
        break;
      case "forest":
        this.updateDapples(dt); this.updateMotes(dt); this.updateFallingLeaves(dt);
        break;
      case "beach":
        this.updateSkyBirds(dt); this.updateFoam(dt); this.updateWetSand(dt);
        break;
      case "wetland":
        this.updateSkyBirds(dt); this.updateFishRings(dt);
        this.updateWaterMist(dt); this.updateMotes(dt);
        break;
      case "city":
        this.updateSkyBirds(dt); this.updateCityWindows(dt, night);
        break;
    }
  }

  /* Shooting stars only ever ran while the moon was up — the loop sat inside the
     test for whether to draw the moon at all — so the same gate stands here. */
  updateCelestial(dt) {
    const m = this.timeMix, total = m.dawn+m.day+m.dusk+m.night || 1;
    if (m.night / total <= 0.03) return;
    for (let i = this.meteors.length - 1; i >= 0; i--) {
      const mt = this.meteors[i];
      mt.age += dt; mt.x += mt.vx*dt; mt.y += mt.vy*dt;
      if (mt.age > mt.life) { this.meteors.splice(i, 1); continue; }
    }
  }

  updateClouds(dt) {
    const wf = 1 + state.wx.gust*2;
    for (const cl of this.clouds) {
      const near = Math.max(0, Math.min(1, (cl.w - 0.16)/0.22));
      // it hurries in a gust like everything else in the frame
      cl.x += cl.s * dt * wf * (0.5 + near) * (0.7 + this.windBend(cl.x)*1.5);
      cl.evo += cl.evoSp * dt;          // and builds and thins as it goes
      if (cl.x > 1.3) cl.x = -0.3;
    }
  }

  /* `p` is a sky painter, not the 2D context: the same calls go to the GPU or
     back onto the canvas depending on what the machine can offer. The shapes
     and their order are written once, here, so both roads lead to one picture. */
  drawCelestial(p, W, H, top, night) {
    // Stars, brightening as the light fails.
    if (night > 0.05 && this.stars) {
      const rgb = this.tok.cloudRGB;              // one colour; vary alpha per star
      for (const st of this.stars) {
        const tw = 0.5 + 0.5*gaitAt("glint", this.t*st.tw*0.16 + st.ph, "lit");
        const a = (st.bright ? 0.6 : 0.34) * night * tw;
        if (a < 0.03) continue;
        const sx = st.x*W, sy = st.y*H, r = st.r*(st.bright ? 1.5 : 1);
        p.rect(rgb, sx, sy, r, r, a);
        if (st.bright) {
          p.rect(rgb, sx - r, sy + r*0.3, r*3, r*0.5, a*0.45);
          p.rect(rgb, sx + r*0.3, sy - r, r*0.5, r*3, a*0.45);
        }
      }
    }
    const breathe = 0.86 + 0.14*Math.sin(this.t*0.28);   // a slow living glow
    const m = this.timeMix, total = m.dawn+m.day+m.dusk+m.night || 1;
    const sunA = (m.dawn*0.9 + m.day + m.dusk*0.8) / total;
    if (sunA > 0.03) {
      const denom = Math.max(0.001, m.dawn+m.day+m.dusk);
      const sx = W * (0.22*m.dawn + 0.5*m.day + 0.8*m.dusk) / denom;
      const sy = H * (0.42*m.dawn + 0.16*m.day + 0.46*m.dusk) / denom;
      const rr = Math.min(W,H)*0.05;
      p.glow(this.tok.amberRGB, sx, sy, rr*5, rr*5, 0.30*sunA*breathe);
      p.disc(this.tok.sun, sx, sy, rr, sunA);
      this.celX = sx / W;
    }
    const moonA = m.night / total;
    if (moonA > 0.03) {
      const mx = W*0.72, my = H*0.2, rr = Math.min(W,H)*0.04;
      p.glow(this.tok.cloudRGB, mx, my, rr*6, rr*6, 0.12*moonA*breathe);
      p.disc(this.tok.moon, mx, my, rr, moonA);
      p.disc(mix(top, this.tok.moon, 0.08), mx - rr*0.42, my - rr*0.18, rr*0.85, moonA);
      // shooting stars
      for (let i = this.meteors.length - 1; i >= 0; i--) {
        const mt = this.meteors[i];
        const al = (1 - mt.age/mt.life) * 0.7 * moonA;
        p.seg(this.tok.cloudRGB, mt.x*W, mt.y*H,
          (mt.x - mt.vx*0.10)*W, (mt.y - mt.vy*0.10)*H, 1.2, al);
      }
      this.celX = mx / W;
    }
  }

  drawClouds(p, W, H, night) {
    const rgb = this.tok.cloudRGB;
    const af = (1 + state.wx.wet*0.5) * (1 - night*0.5);
    for (const cl of this.clouds) {
      // Big clouds are near ones: they cross faster and hold their colour,
      // while the small far ones hang almost still and pale away.
      const near = Math.max(0, Math.min(1, (cl.w - 0.16)/0.22));
      const ev = gaitPose("cloud", cl.evo);
      // wind draws a cloud out sideways and presses it flat
      const shear = this.windBend(cl.x, true);
      const cw = cl.w * W * (0.78 + ev.swell*0.34 + shear*0.22);
      p.glow(rgb, cl.x*W, cl.y*H, cw, cw*0.35*ev.depth*(1 - shear*0.18),
        cl.a * af * (0.62 + near*0.5) * (0.72 + ev.depth*0.36));
    }
  }

  windAmt() {
    return state.wx.gust;
  }

  /* A hundred and ten blades of grass in one colour and one width. Stroked
     one at a time that is a hundred and ten separate rasterizations; gathered
     into a single path it is one, for the same picture. The rain has always
     been drawn this way (see drawWeather) — everything that shares a pen
     should be. */
  drawGrassTufts(c, W, H, grass, baseYfn, color) {
    c.strokeStyle = color;
    c.lineWidth = 1;
    const wa = this.windAmt();
    c.beginPath();
    for (const gr of grass) {
      const gx = gr.x * W;
      const gy = baseYfn(gr.x) * H;
      const sway = this.windBend(gr.x)*7.5 + Math.sin(this.t*1.8 + gr.ph)*2.2*wa + gr.lean*4;
      c.moveTo(gx, gy + 4);
      c.quadraticCurveTo(gx + sway*0.4, gy - gr.h*H*0.6, gx + sway, gy - gr.h*H);
    }
    c.stroke();
  }

  /* A ridge is sixty-one points of summed sine, and not one of them moves from
     one frame to the next — only the light on it does, as the hour turns. So
     the outline is built once and kept, and each frame only asks for it to be
     filled again in whatever colour the hour has reached. */
  drawRidge(c, fn, color, W, H) {
    let p = this._paths.get(fn);
    if (!p) {
      p = new Path2D();
      p.moveTo(0, H);
      const n = 60;
      for (let i = 0; i <= n; i++) p.lineTo((i/n)*W, fn(i/n)*H);
      p.lineTo(W, H);
      p.closePath();
      this._paths.set(fn, p);
    }
    c.fillStyle = css(color);
    c.fill(p);
  }

  /* Far-off birds adrift in the upper sky — a couple of quiet wingbeats. */
  updateSkyBirds(dt) {
    if (!this.skyBirds) return;
    for (const b of this.skyBirds) {
      b.x += b.sp*dt; b.ph += dt*4;
      if (b.x > 1.15) b.x -= 1.3; else if (b.x < -0.15) b.x += 1.3;
    }
  }

  drawSkyBirds(c, W, H, bot, night) {
    if (!this.skyBirds) return;
    const col = css(mix(this.tok.ink, bot, 0.45));
    c.strokeStyle = col; c.lineCap = "round"; c.lineWidth = 1.1;
    for (const b of this.skyBirds) {
      const a = 0.5 * (1 - night*0.7);
      if (a < 0.04) continue;
      const px = b.x*W, py = (b.y + Math.sin(b.ph*0.3)*0.004)*H, s = b.size;
      const flap = 0.5 + 0.5*gaitAt("beatQuick", b.ph*TURN, "beat");
      c.globalAlpha = a;
      c.beginPath();
      c.moveTo(px - s, py + flap*s*0.5);
      c.quadraticCurveTo(px, py - s*0.35, px + s, py + flap*s*0.5);
      c.stroke();
    }
    c.globalAlpha = 1;
  }

  /* A small distant tree — trunk plus a clump of canopy. */
  smallTree(c, x, yBase, h, r, W, H, color) {
    const px = x*W, py = yBase*H, rr = r*Math.min(W, H), hh = h*H;
    c.fillStyle = color; c.strokeStyle = color; c.lineCap = "round";
    c.lineWidth = Math.max(1, rr*0.34);
    c.beginPath(); c.moveTo(px, py); c.lineTo(px, py - hh*0.72); c.stroke();
    c.beginPath(); c.arc(px, py - hh, rr, 0, Math.PI*2); c.fill();
    c.beginPath(); c.arc(px - rr*0.72, py - hh*0.82, rr*0.68, 0, Math.PI*2); c.fill();
    c.beginPath(); c.arc(px + rr*0.72, py - hh*0.86, rr*0.68, 0, Math.PI*2); c.fill();
  }

  /* A low shrub — a rough dome with a broken, twiggy edge. Drawn as one
     closed outline rather than a row of circles, because a row of circles
     looks like a row of circles. */
  bushShape(c, x, yBase, r, seed, W, H, color) {
    const px = x*W, py = yBase*H, rr = r*Math.min(W, H);
    c.fillStyle = color;
    c.beginPath();
    const n = 14;
    for (let i = 0; i <= n; i++) {
      const u = i/n, ang = Math.PI*(1 + u);                 // over the top, left to right
      const rag = 1 + 0.22*Math.sin(u*11 + seed*7) + 0.13*Math.sin(u*23 + seed*3);
      const bx = px + Math.cos(ang)*rr*1.15;
      const byy = py + Math.sin(ang)*rr*0.9*rag;
      if (i === 0) c.moveTo(bx, byy); else c.lineTo(bx, byy);
    }
    c.lineTo(px + rr*1.15, py);
    c.closePath(); c.fill();
  }

  /* A hedgerow: one continuous run of thorn along the field boundary, its top
     edge broken and irregular, with a few standards — old hawthorns and ashes
     left uncut — rising out of it, and a scatter of twigs breaking the line.
     The height wanders along the run, as a laid hedge does where it has been
     cut in different years. */
  makeHedgerow(rng, baseFn) {
    const from = rng() < 0.5 ? -0.04 : 0.22 + rng()*0.2;
    const to = from < 0 ? 0.45 + rng()*0.5 : 1.04;
    // A cut hedge is not a ribbon: the top wanders, and it wanders faster
    // than the ground under it does, or the two lines stay parallel.
    const waves = [];
    for (let i = 0; i < 4; i++) {
      waves.push({ f: 14 + rng()*26 + i*23, ph: rng()*Math.PI*2, a: (0.78 - i*0.15) });
    }
    const standards = [];
    const ns = 1 + Math.floor(rng()*3);
    for (let i = 0; i < ns; i++) {
      const u = 0.12 + rng()*0.76;
      // same rule as the field trees: a crown is not wider than its tree
      const sh = 0.055 + rng()*0.06;
      standards.push({ x: from + (to - from)*u, h: sh, r: sh*(0.36 + rng()*0.10) });
    }
    const h0 = 0.030 + rng()*0.018;
    const height = (x) => {
      const u = Math.max(0, Math.min(1, (x - from)/(to - from)));
      let k = 1;
      for (const w of waves) k += Math.sin(x*w.f + w.ph)*w.a*0.4;
      // taper away at the ends so the run does not stop dead
      const taper = Math.min(1, Math.min(u, 1 - u)*9);
      return h0 * k * taper;
    };
    const posts = [];
    for (let i = 0; i < 3; i++) {
      const x = from + (to - from)*(0.15 + rng()*0.7);
      posts.push({ x, y: baseFn(x) - height(x)*0.92, r: 0.02 });
    }
    return { from, to, height, standards, posts, seed: rng() };
  }

  /* A hedgerow along a field boundary.

     `z` is how far off the boundary is, and everything about the hedge comes
     off it: how tall it stands on the glass, how thick its twigs are, how far
     the wind moves it, and how much of the air between you and it has taken
     the colour out. A boundary four fields away drawn at the same height as
     the one at the bottom of the garden is exactly what made this view read
     as flats standing in a row.

     It fills down to the *ground*, not to a fixed number of pixels below its
     own top — a ribbon of constant thickness following a wavy line is what
     makes a hedge look like a tube. */
  drawHedgerow(c, W, H, baseFn, bot, z) {
    const hg = z === undefined ? this.hedge
      : (this.bounds || []).find(b => b.line === baseFn)?.hedge;
    if (!hg) return;
    const dep = this.plane && z !== undefined
      ? this.planeScale(z)/this.plane.top : 1;
    const air = z === undefined ? 0 : z;         // how much haze is in front of it
    const body = css(mix(this.tok.inkDeep, bot, 0.15 + air*0.16));
    const twig = css(mix(this.tok.inkDeep, bot, 0.24 + air*0.14));
    const wind = (0.35 + state.wx.gust*0.65)*dep;
    const n = 96;
    c.fillStyle = body;
    c.beginPath();
    for (let i = 0; i <= n; i++) {
      const x = hg.from + (hg.to - hg.from)*(i/n);
      const sway = this.windBend(x)*wind*2.6 + Math.sin(this.t*1.3 + x*22)*wind*0.5;
      const ty = (baseFn(x) - hg.height(x)*dep)*H + sway*0.3;
      if (i === 0) c.moveTo(x*W + sway, ty); else c.lineTo(x*W + sway, ty);
    }
    // down to the ground it grows out of, and a little into it
    for (let i = n; i >= 0; i--) {
      const x = hg.from + (hg.to - hg.from)*(i/n);
      c.lineTo(x*W, baseFn(x)*H + Math.max(1, 6*dep));
    }
    c.closePath(); c.fill();
    // Loose growth standing proud of the cut line — the year's new shoots that
    // give a hedge its bristled top instead of a shaved one. Below a certain
    // distance there is nothing to see, so nothing is drawn.
    if (dep > 0.5) {
      c.strokeStyle = twig;
      c.lineWidth = 1;
      c.beginPath();
      for (let i = 0; i < 64; i++) {
        const x = hg.from + (hg.to - hg.from)*((i*0.0673 + hg.seed) % 1);
        const hgt = hg.height(x)*dep;
        if (hgt < 0.006) continue;
        const tx = x*W, ty = (baseFn(x) - hgt)*H;
        const lean = (Math.sin(i*3.1 + hg.seed*9)*5 + Math.sin(this.t*1.6 + x*18)*wind*2.6)*dep;
        const up = (4 + ((i*7) % 5)*2.6)*dep;
        c.moveTo(tx, ty + 2);
        c.quadraticCurveTo(tx + lean*0.4, ty - up*0.5, tx + lean, ty - up);
      }
      c.stroke();
    }
    /* Standards left uncut along the line. On the farthest boundary they are
       eight pixels of tree and three fills each, so they are left to the
       trees that boundary already carries. */
    if (dep < 0.32) return;
    const trunkCol = css(mix(this.tok.inkDeep, bot, 0.12 + air*0.16));
    for (const st of hg.standards) {
      this.smallTree(c, st.x, baseFn(st.x) - hg.height(st.x)*dep*0.35,
        st.h*dep, st.r*dep, W, H, trunkCol);
    }
  }

  /* One beast. Everything is in the proportions: the barrel is deep and not
     very long, the legs are short — a cow standing square is about as deep
     through the body as it is long in the leg — the back runs level from a
     high hip to the withers, and the head hangs off a thick neck no longer
     than the head itself. Get the neck wrong and you have drawn a horse.
     `hd` is 0 for head up, 1 for head down in the grass, and `chew` is where
     it stands in a mouthful — the bite and the working of it. */
  cowShape(c, bx, by, s, dir, hd, col, patch, tailSwing, chew) {
    c.save();
    c.translate(bx, by);
    c.scale(dir, 1);
    c.fillStyle = col;
    // Legs: short, straight, set at the corners. The far pair is a shade
    // behind the near one, which is all the depth needed at this size.
    for (const [lx, lw] of [[-s*0.50, 0.13], [-s*0.34, 0.12], [s*0.36, 0.12], [s*0.50, 0.13]]) {
      this.limb(c, lx, -s*0.50, lx, 0, s*lw, s*0.085);
    }
    // Barrel: level back, square rump, deep brisket dropping low in front.
    c.beginPath();
    c.moveTo(s*0.62, -s*1.02);
    c.lineTo(-s*0.56, -s*1.06);
    c.quadraticCurveTo(-s*0.80, -s*1.02, -s*0.80, -s*0.80);
    c.quadraticCurveTo(-s*0.78, -s*0.50, -s*0.52, -s*0.44);
    c.lineTo(s*0.40, -s*0.42);
    c.quadraticCurveTo(s*0.74, -s*0.48, s*0.74, -s*0.78);
    c.closePath(); c.fill();
    // The tail, swinging at flies.
    const tw = tailSwing*s*0.12;
    c.beginPath();
    c.moveTo(-s*0.74, -s*1.00);
    c.quadraticCurveTo(-s*0.88 + tw, -s*0.72, -s*0.84 + tw*1.6, -s*0.30);
    c.lineTo(-s*0.74 + tw*1.6, -s*0.30);
    c.quadraticCurveTo(-s*0.78 + tw, -s*0.72, -s*0.66, -s*1.00);
    c.closePath(); c.fill();
    // Neck and head. Short and thick, carried level with the back when it is
    // up and swung straight down into the grass when it is not.
    // Head down, it is not still: a bite is taken and worked, and the muzzle
    // drifts along the sward between mouthfuls.
    const cw = chew || null;
    const nx = s*(0.72 + hd*0.10) + (cw ? cw.sway*hd*s*0.10 : 0);
    const ny = -s*(0.86 - hd*0.62) - (cw ? cw.chew*hd*s*0.05 : 0);
    this.limb(c, s*0.46, -s*0.96, nx, ny, s*0.38, s*0.26);
    c.save();
    c.translate(nx, ny);
    c.rotate(hd*1.05 - (cw ? cw.chew*hd*0.10 : 0));
    c.beginPath();
    c.moveTo(-s*0.10, -s*0.17);
    c.quadraticCurveTo(s*0.20, -s*0.16, s*0.34, -s*0.02);
    c.quadraticCurveTo(s*0.36, s*0.08, s*0.26, s*0.11);
    c.quadraticCurveTo(s*0.02, s*0.17, -s*0.10, s*0.14);
    c.closePath(); c.fill();
    // ears held out sideways, the way a cow's are
    c.beginPath();
    c.ellipse(-s*0.08, -s*0.10, s*0.12, s*0.055, -0.5, 0, Math.PI*2);
    c.ellipse(-s*0.11, s*0.07, s*0.11, s*0.05, 0.4, 0, Math.PI*2);
    c.fill();
    c.restore();
    // A broken white patch over the shoulder and flank — most of them have one.
    if (patch) {
      c.fillStyle = patch;
      c.beginPath();
      c.ellipse(s*0.06, -s*0.84, s*0.30, s*0.17, 0.08, 0, Math.PI*2);
      c.ellipse(-s*0.42, -s*0.66, s*0.16, s*0.10, -0.2, 0, Math.PI*2);
      c.fill();
    }
    c.restore();
  }

  /* Cattle out on the far hill. At this distance a cow is a barrel on four
     short legs with a dropped head, and getting that outline right matters
     more than any detail: deep straight back, square rump, brisket low and
     forward, head down in the grass most of the time. They stand in ones and
     twos, swing a tail at flies, and lift their heads now and then. */
  updateCattle(dt) {
    if (!this.cattle || !this.cattle.length) return;
    for (const cw of this.cattle) {
      cw.next -= dt;
      if (cw.next <= 0) {                       // up for a look, or back down to it
        cw.head = cw.head > 0.5 ? 0 : 1;
        cw.next = cw.head ? 8 + Math.random()*16 : 4 + Math.random()*9;
      }
      cw.hd = (cw.hd === undefined) ? cw.head : cw.hd + (cw.head - cw.hd)*Math.min(1, dt*1.4);
      // its own tempo through a mouthful, so a field of them is not one animal
      cw.chewPh = (cw.chewPh || cw.ph) + dt*(0.34 + cw.ph*0.03);
      /* And it grazes its way across the field — head down, a step every few
         seconds, a whole minute to cross a hand's breadth of glass. This is
         the slowest motion in the piece and the only one you notice by having
         looked away and looked back. It turns at the field's edge rather than
         walking out of it, because the herd belongs to this field. */
      if (cw.hd < 0.5) {
        cw.x += cw.dir*cw.step*dt*(this.plane ? this.planeScale(cw.z)/this.plane.top : 1);
        if (cw.x < 0.06) { cw.x = 0.06; cw.dir = 1; }
        if (cw.x > 0.94) { cw.x = 0.94; cw.dir = -1; }
      }
    }
  }

  drawCattle(c, W, H, baseFn, bot) {
    if (!this.cattle || !this.cattle.length) return;
    const col = css(mix(this.tok.ink, bot, 0.30));
    const pale = `rgba(${this.tok.foamRGB}, 0.35)`;
    /* Cattle stand on the plane like everything else. `baseFn` is still
       accepted for the places that have not been given one. */
    const groundAt = baseFn || ((x, cw) => this.planeY(cw.z));
    for (const cw of this.cattle) {
      const dep = this.plane && cw.z !== undefined
        ? this.planeScale(cw.z)/this.plane.top : 1;
      const s = Math.min(W, H)*0.075*cw.sz*dep;
      // The tail hangs, and then it does not: one hard slap at a fly and a
      // lazy swing back, with half the cycle spent doing nothing at all.
      this.cowShape(c, cw.x*W, groundAt(cw.x, cw)*H, s, cw.dir, cw.hd, col,
        cw.ph > 2.4 ? pale : null,
        gaitAt("swish", (this.t*1.7 + cw.ph)*TURN, "swing"),
        cw.hd > 0.4 ? gaitPose("graze", cw.chewPh || 0) : null);
      // a calf keeping close in, head up, all legs and no barrel yet
      if (cw.calf) {
        this.cowShape(c, (cw.x*W) - cw.dir*s*1.9, groundAt(cw.x - cw.dir*0.012, cw)*H,
          s*0.58, cw.dir, 0.15, col, null,
          gaitAt("swish", (this.t*2.6 + cw.ph)*TURN, "swing"), null);
      }
    }
  }

  /* ---- depth ----
     Where a ground animal stands, how large it looks, and how much air is
     between it and the pane. z runs 0 at the glass to 1 at the far edge of
     the walkable ground. Things further off sit higher in the frame, are
     smaller, move more slowly across it, and are washed toward the colour
     of the sky — the three cues that do most of the work of distance. */
  /* Where a falling drop stops, by its depth in the field — and whether what
     it lands in is water, because a drop on water rings and a drop on the
     ground throws a little spray and is gone. Near drops land at the bottom of
     the frame; far ones land up the beach, or out on the open water. */
  rainFloor(z) {
    if (this.loc === "beach") {
      const sy = this.shoreY || 0.82, hy = this.horizonY || 0.5;
      return z < 0.45 ? (sy + 0.125) - (z/0.45)*0.095
                      : sy - ((z - 0.45)/0.55)*(sy - hy)*0.85;
    }
    if (this.loc === "wetland") {
      const by = this.bankY || 0.86, wy = this.waterY || 0.66;
      return z < 0.40 ? (by + 0.035) - (z/0.40)*0.043
                      : by - ((z - 0.40)/0.60)*(by - wy)*0.9;
    }
    const b = this.groundBand();
    return b[1] + (b[0] - b[1])*(1 - z);
  }
  rainOnWater(x, y) {
    if (this.loc === "beach") return y < (this.shoreY || 0.82);
    if (this.loc === "wetland") return y < (this.bankY || 0.86);
    return false;
  }

  /* ---- What stands in water -------------------------------------------

     `drawReflections` mirrors the far tree line and nothing else, so a heron
     standing in a marsh has no reflection at all.

     This is deliberately not a mirrored re-paint. Running every painter a
     second time under a flipped transform is the faithful way to do it and it
     doubles the cost of every animal near water — for a shape that is, at the
     size these appear, a dark smear broken by ripples. So it is drawn as what
     it looks like rather than as what it is: a soft column of the animal's own
     colour under its feet, cut across by the same lines the water already
     carries. Three ops instead of twenty-five.

     Returns quietly for anything not actually standing in water. */
  waterReflection(c, x, footY, w, h, col, alpha) {
    if (alpha <= 0.02 || h <= 1) return;
    const surf = this.loc === "wetland" ? this.bankY
               : this.loc === "beach" ? this.shoreY : null;
    if (surf === null) return;
    // only what is at or below the waterline — a bird up the bank has nothing
    // to be reflected in
    const H = this.H;
    if (footY < surf*H - h*0.4) return;
    const depth = h*0.62;
    const g = c.createLinearGradient(0, footY, 0, footY + depth);
    g.addColorStop(0, css([col[0], col[1], col[2], 0.5*alpha]));
    g.addColorStop(0.45, css([col[0], col[1], col[2], 0.22*alpha]));
    g.addColorStop(1, css([col[0], col[1], col[2], 0]));
    c.save();
    c.fillStyle = g;
    c.beginPath();
    c.ellipse(x, footY + depth*0.42, w*0.55, depth*0.58, 0, 0, Math.PI*2);
    c.fill();
    /* And the water moves under it. Two flat strips of the surface laid back
       over the smear is what stops it reading as a shadow hanging in the
       water — a reflection is always broken, and always broken horizontally. */
    c.globalAlpha = 0.55*alpha;
    c.fillStyle = css(this.tok.sea);
    for (let k = 0; k < 2; k++) {
      const ry = footY + depth*(0.28 + k*0.34) + Math.sin(this.t*0.9 + k*2.1 + x*0.02)*1.6;
      c.fillRect(x - w*0.6, ry, w*1.2, 1.2 + k*0.6);
    }
    c.restore();
  }

  /* ---- Wet ground ------------------------------------------------------

     How wet the ground is, which is not the same as how hard it is raining.
     Ground takes a while to soak and a long while to give it up again, and
     the dark patch a shower leaves behind is one of the very few things in a
     landscape that tells you what the weather was doing a minute ago. The
     engine has tracked this since the drips were added — `wetUntil` keeps the
     land dripping for the best part of a minute after the rain stops — and
     until now nothing showed it. */
  updateWetness(dt) {
    const want = state.wx.wet;
    const now = this.groundWet || 0;
    const tau = want > now ? 20 : 90;     // soaks in twenty seconds, dries in ninety
    const next = now + (want - now)*(1 - Math.exp(-dt/tau));
    this.groundWet = Math.abs(want - next) < 0.002 ? want : next;
  }

  /* Wet ground does two things at once: it goes darker, and it starts
     reflecting the sky. Both are here — a multiply to soak it, and a pale
     sheen that only the near, flat ground catches — with standing water on
     top of that once it has had enough rain to pool.

     Drawn after the land and before anything alive, so the animals stand on
     the wet ground rather than being tinted by it. */
  drawWetGround(c, W, H, top, bot) {
    const w = this.groundWet || 0;
    if (w < 0.02) return;
    const band = this.groundBand();
    const y0 = Math.max(0, (Math.min(band[0], band[1]) - 0.07)) * H;
    const h = H - y0;
    if (h <= 0) return;

    const dark = c.createLinearGradient(0, y0, 0, H);
    dark.addColorStop(0, "rgba(96,88,80,0)");
    dark.addColorStop(1, `rgba(96,88,80,${(0.55*w).toFixed(3)})`);
    c.save();
    c.globalCompositeOperation = "multiply";
    c.fillStyle = dark;
    c.fillRect(0, y0, W, h);
    c.restore();

    // the sheen: the sky, lying on the ground, weakest at the horizon
    const sheen = c.createLinearGradient(0, y0, 0, H);
    sheen.addColorStop(0, `rgba(${top[0]|0},${top[1]|0},${top[2]|0},0)`);
    sheen.addColorStop(1, `rgba(${top[0]|0},${top[1]|0},${top[2]|0},${(0.16*w).toFixed(3)})`);
    c.save();
    c.globalCompositeOperation = "screen";
    c.fillStyle = sheen;
    c.fillRect(0, y0, W, h);
    c.restore();

    /* And standing water, once there has been enough of it. Puddles sit on
       the near ground where it is flattest, hold a piece of sky, and are the
       one part of this that reads at a glance. Where there is already water
       in the frame — a shore, a marsh — there is nothing to add. */
    if (this.loc === "beach" || this.loc === "wetland" || w < 0.35) return;
    const pud = this.puddles();
    const pa = Math.min(1, (w - 0.35)/0.4);
    c.save();
    const soaked = css(this.tok.inkDeep);
    // Water lying in grass, not discs laid on top of it: the soaked ring goes
    // down first, the water is a low-contrast sheet of sky over it, and the
    // only bright part is the thin line where the far edge catches the light.
    /* `p.z` runs 0 far to 1 near, which is the opposite way round from the
       plane's own z — where a place has a plane, the puddle sits and sizes on
       it exactly rather than on a straight line between the band's ends. */
    for (const p of pud) {
      const pz = 1 - p.z;
      const py = (this.plane ? this.planeY(pz) : band[1] + (band[0] - band[1])*p.z)*H
        + p.dy*H*(this.plane ? this.planeScale(pz)/this.plane.top : 1);
      const pw = p.r*W*(this.plane ? this.planeScale(pz)/this.plane.top : 0.6 + p.z*0.7);
      c.globalAlpha = pa * 0.20;
      c.fillStyle = soaked;
      c.beginPath(); c.ellipse(p.x*W, py, pw*1.3, pw*0.25, 0, 0, Math.PI*2); c.fill();
      /* And the water itself, low and flat and barely lighter than what it is
         lying in. A brighter sheet with a rim reads as a saucer set down on
         the grass; standing water in a field is mostly just a place where the
         ground has stopped being matt. */
      c.globalAlpha = pa * (0.13 + p.z*0.10);
      c.fillStyle = css(mix(bot, top, 0.30));
      c.beginPath(); c.ellipse(p.x*W, py, pw, pw*0.115, 0, 0, Math.PI*2); c.fill();
    }
    c.restore();
  }

  /* An animal crossing the field, and whether it is also crossing it in
     depth. Most keep to their line; some come forward and some work away,
     and one that does is worth several that do not — it is the only motion
     in the piece that uses the ground plane for anything.

     Returns a starting depth and a rate. The rate is small: a whole crossing
     of the frame moves it a third of the way in or out, which is a walk, not
     a charge at the glass. */
  /* The nearest depth an animal can stand at and still be in the picture.

     Every plane's near edge is deliberately below the bottom of the frame —
     that is what puts the grass at your feet off the glass — but how much of
     the plane that costs varies enormously. The meadow loses a sliver; the
     city, whose whole pavement is the bottom twentieth of the frame, loses
     everything nearer than z≈0.3, and a quarter of the street's animals were
     being drawn under the edge of the window. */
  nearZ() {
    if (!this.plane) return 0.04;
    return Math.max(0.04, Math.min(0.6, this.planeZ(0.988)));
  }

  crossing(nearBias) {
    const r = Math.random();
    const near = this.nearZ();
    const z0 = nearBias !== undefined ? Math.max(near, nearBias)
      : near + Math.random()*(0.82 - near);
    if (r < 0.42) return { z: z0, toward: 0 };               // keeps its line
    const away = Math.random() < 0.5;
    // never so far in that it walks off the bottom, nor so far out that it
    // becomes a speck in the hedge
    const rate = (0.020 + Math.random()*0.045) * (away ? 1 : -1);
    const from = away ? Math.min(z0, Math.max(near, 0.45)) : Math.max(z0, 0.5);
    return { z: from, toward: rate };
  }

  /* Where the water stands. Drawn from the session seed so a place keeps its
     puddles in the same hollows all session, and rebuilt when the land is. */
  puddles() {
    const key = this.loc + ":" + this.seedBase;
    if (this._puddleKey === key) return this._puddles;
    const rng = mulberry32(((this.seedBase || 0) ^ 0x9D7E5) >>> 0);
    const n = 4 + Math.floor(rng()*4);
    this._puddles = [];
    for (let i = 0; i < n; i++) {
      this._puddles.push({ x: 0.05 + rng()*0.9, z: rng(),
        r: 0.020 + rng()*0.045, dy: (rng() - 0.5)*0.02 });
    }
    this._puddleKey = key;
    return this._puddles;
  }

  /* Where the ground a creature can stand on begins and ends. Every place has
     a plane now, so this is the plane's own two ends; the literals are only a
     floor for the moment before `reseed` has built one. */
  groundBand() {
    if (this.plane) return [this.planeY(0), this.planeY(1)];
    switch (this.loc) {
      case "meadow":  return [0.99, 0.64];
      case "forest":  return [0.945, 0.898];
      case "beach":   return [(this.shoreY || 0.82) + 0.125, (this.shoreY || 0.82) + 0.03];
      case "wetland": return [(this.bankY || 0.86) + 0.035, (this.bankY || 0.86) - 0.008];
      default:        return [0.978, 0.952];
    }
  }
  /* ---- The ground, in perspective ---------------------------------------

     For a camera at a fixed height above a flat plane, an object's distance
     below the horizon on screen and its apparent size are *the same number*:
     both go as 1/d. That single relation is what makes a field read as a
     field, and it is the whole of this:

       y(z)     = horizon + near/(1 + z(d−1))
       scale(z) = 1/(1 + z(d−1))

     `z` is 0 at the near edge of the frame and 1 at the far edge of the
     field, `d` is how many times further away the far edge is than the near
     one. Everything that stands on the ground — grass, flowers, stones,
     hedges, cattle, every animal — takes its screen position and its size
     from the same pair, so nothing can disagree with anything else.

     Places that have not been given a plane keep the old flat band. */
  /* Build a plane from the three things a place knows about itself: where its
     horizon is, where the ground meets the bottom of the frame, and where the
     furthest ground a creature can stand on lies. `d` falls out of those, so
     no place has to guess at it. */
  makePlane(horizon, nearY, farY, top) {
    const near = nearY - horizon;
    return { horizon, near, d: Math.max(1.05, near/Math.max(0.002, farY - horizon)),
      top: top || 1.25 };
  }

  planeY(z) {
    const p = this.plane;
    if (!p) { const [n, f] = this.groundBand(); return n + (f - n)*z; }
    return p.horizon + p.near/(1 + z*(p.d - 1));
  }
  planeScale(z) {
    const p = this.plane;
    if (!p) return 1.22 - z*0.62;
    return p.top/(1 + z*(p.d - 1));
  }
  /* And the inverse, for anything that knows where it is on screen but not
     how far away that makes it — a bird choosing a spot on the grass. */
  planeZ(y) {
    const p = this.plane;
    if (!p) return 0.5;
    const s = Math.max(1e-4, y - p.horizon);
    return Math.max(0, Math.min(1, (p.near/s - 1)/(p.d - 1)));
  }

  groundDepth(z, bot) {
    const zz = Math.max(0, Math.min(1, z === undefined ? 0.5 : z));
    return {
      y: this.planeY(zz),
      scale: this.planeScale(zz),
      /* How fast it crosses the frame. In perspective this is not a separate
         choice: an animal covering a metre of ground at twice the distance
         crosses half as many pixels, so the speed *is* the scale. Setting the
         two apart is what made a far rabbit hop the same distance as a near
         one. */
      speed: this.plane ? this.planeScale(zz)/this.planeScale(0) : 1 - zz*0.55,
      /* A light touch only: these animals stand on dark ground but against
         a pale far hill, so contrast runs both ways and a strong ramp would
         lose them at one end or the other.

         Except in the city, where there is no pale far hill — the pavement is
         one flat dark slab, mixed at the same tenth this ramp reaches, and a
         pigeon standing on it came out exactly the colour of the ground. It
         was there and it could not be seen. The street's animals are lifted
         clear of their own footing. */
      col: css(mix(this.tok.inkDeep, bot,
        this.loc === "city" ? 0.30 + zz*0.16 : 0.03 + zz*0.10))
    };
  }

  /* ---- Where the light is coming from, and how hard it is ----------------

     The sun's position was already worked out — `drawCelestial` sets `celX`
     for the water's glitter — and then nothing else in the frame used it.
     Every shadow in the piece was a small pool directly under its animal,
     which is what a shadow looks like at noon and at no other hour of the day.

     Refreshed once a frame and read by everything that casts: the direction
     a shadow falls, how far it stretches, and how dark it is allowed to be.

       x     where the light is, 0..1 across the frame
       alt   how high it is: 1 overhead, 0 on the horizon
       str   how hard the light is — cloud, rain and fog all soften a shadow
             until there is not one, which is most of what an overcast day
             looks like.  */
  updateLight() {
    const m = this.timeMix, total = m.dawn + m.day + m.dusk + m.night || 1;
    const day = (m.dawn + m.day + m.dusk) / total;
    // The sun climbs and sets; the moon is taken as high and weak all night.
    const alt = (m.dawn*0.20 + m.day*0.95 + m.dusk*0.16 + m.night*0.62) / total;
    /* An overcast sky is a light source the size of the sky, and a light
       source the size of the sky casts no shadow at all. Rain and fog take
       it away almost entirely; that absence is itself a weather cue. */
    const clear = (1 - state.wx.wet*0.85) * (1 - state.wx.haze*0.9);
    const lit = this._lit || (this._lit = { x: 0.5, alt: 1, str: 1 });
    lit.x = this.celX !== undefined ? this.celX : 0.5;
    lit.alt = Math.max(0.08, alt);
    // moonlight is a tenth of daylight, and it is still a shadow
    lit.str = clear * (day*0.95 + (1 - day)*0.30);

    /* And then a stroke of lightning, which for a tenth of a second is the
       only light there is. It comes from where it happened rather than from
       the sun, it is low and hard, and it throws a shadow across a landscape
       that a moment ago — being under a storm — had none at all. That
       contradiction is the whole effect: the flash does not brighten a lit
       scene, it lights an unlit one. */
    const f = this.flashLit();
    if (f > 0.01) {
      const k = Math.min(1, f*1.6);
      lit.x += (this.flashX - lit.x) * k;
      lit.alt += (0.30 - lit.alt) * k;
      lit.str += (1.15 - lit.str) * k;
    }
    return lit;
  }

  /* The small dark pool a body casts on the ground beneath it. Nothing
     grounds an animal like the shadow it stands in — and nothing gives away
     the hour like which way it points and how far it reaches. A low sun
     throws it a long way sideways and softens it as it goes; at noon it is
     a tight dark spot under the feet. */
  contactShadow(c, x, y, w, alpha) {
    const L = this._lit || this.updateLight();
    const a0 = alpha * L.str;
    if (a0 <= 0.01) return;
    const lean = 1 - L.alt;                       // 0 overhead, 1 at the horizon
    const away = x >= L.x*this.W ? 1 : -1;        // it falls away from the light
    const rx = w * (1 + lean*lean*2.6);
    // anchored at the feet: the near end stays put and the far end travels
    const cx = x + away * (rx - w) * 0.9;
    // a long shadow is a soft one — the penumbra grows with the distance
    const a = a0 / (1 + lean*1.35);
    if (a <= 0.01) return;
    /* Multiplied, not painted. A shadow drawn as flat ink the colour of the
       darkest token is invisible on ground that is already nearly that
       colour, which is what the meadow at dawn is — the shadows were there
       and could not be seen. Multiply darkens whatever it lands on by a
       proportion, which is what a shadow actually does, and it reads on pale
       sand and dark turf alike. */
    c.save();
    c.globalCompositeOperation = "multiply";
    c.globalAlpha = Math.min(0.9, a*2.4);
    c.fillStyle = "rgb(96,88,80)";
    c.beginPath();
    c.ellipse(cx, y, rx, Math.max(1, w*0.22), 0, 0, Math.PI*2);
    c.fill();
    c.restore();
  }

  /* Roughly how bright the day is — for daytime-only touches like motes. */
  dayness() {
    const m = this.timeMix, total = m.dawn + m.day + m.dusk + m.night || 1;
    return (m.day + m.dawn*0.7 + m.dusk*0.45) / total;
  }

  /* ---- the wind, as something with weight ----

     Two sines summed gave a gust that arrived on a metronome and that every
     growing thing answered in the same instant, exactly and without spring.
     Neither half of that is what wind does.

     What it does is written out in `GAIT.gust`: nothing, for most of a cycle;
     then a fast build, a top that is never steady, and a long slow release. It
     travels, so the far side of the frame has it before the near side does —
     that is the wave you watch cross a field.

     And what it pushes has inertia. A blade of grass is not where the wind
     says; it lags into the gust and springs back past upright when the gust
     lets go, and that recoil is the thing you actually see. So the wind is
     carried as a row of little springs across the frame — two rows, in fact: a
     light one that grass, reeds and fern answer, and a heavy slow one for
     timber, so a wood comes round to a gust several beats after the field has.

     Both are stepped in `updateWind` and only read while painting. */
  updateWind(dt) {
    const n = WIND_COLS;
    if (!this.windSoft) {
      this.windSoft = new Float32Array(n); this.windSoftV = new Float32Array(n);
      this.windStiff = new Float32Array(n); this.windStiffV = new Float32Array(n);
    }
    // A long dt — a tab left in the background — would blow the springs apart.
    const h = Math.min(dt, 1/30);
    const wa = this.windAmt();
    const u = this.t*WIND_RATE + (this.gustPh || 0);
    for (let i = 0; i < n; i++) {
      const x = i/(n - 1);
      // the gust reaches the far side of the frame first
      const f = gaitAt("gust", u - x*WIND_TRAVEL, "force")*wa;
      this.windSoft[i] += (this.windSoftV[i] += ((f - this.windSoft[i])*38 - this.windSoftV[i]*3.4)*h)*h;
      this.windStiff[i] += (this.windStiffV[i] += ((f - this.windStiff[i])*11 - this.windStiffV[i]*2.2)*h)*h;
    }
  }

  /* How far the wind has bent whatever stands at x — 0 upright, 1 laid over in
     the strongest gust the weather allows, and briefly negative on the recoil
     as it comes back. `stiff` asks the heavy row, for anything with wood in
     it. */
  windBend(x, stiff) {
    const row = stiff ? this.windStiff : this.windSoft;
    if (!row) return 0;
    const f = Math.max(0, Math.min(1, x))*(WIND_COLS - 1);
    const i = f|0, k = f - i;
    return i >= WIND_COLS - 1 ? row[WIND_COLS - 1] : row[i] + (row[i + 1] - row[i])*k;
  }

  /* Slow motes of pollen or dust adrift in the daytime air. */
  /* Motes hang still in the dark. The old code reached its return before it
     reached the drift, which made that behaviour rather than an optimization. */
  updateMotes(dt) {
    if (!this.motes) return;
    if (this.dayness()*0.55 < 0.03) return;
    for (const m of this.motes) {
      m.y -= m.sp*dt;
      m.x += (m.drift + Math.sin(this.t*0.3 + m.ph)*0.006)*dt;
      if (m.y < 0.24) { m.y = 0.96; m.x = Math.random(); }
      else if (m.x < -0.02) m.x = 1.02; else if (m.x > 1.02) m.x = -0.02;
    }
  }

  drawMotes(c, W, H, dayish) {
    if (!this.motes) return;
    const a0 = dayish*0.55;
    if (a0 < 0.03) return;
    c.fillStyle = `rgba(${this.tok.cloudRGB}, 1)`;
    for (const m of this.motes) {
      const tw = 0.5 + 0.5*Math.sin(this.t*0.8 + m.ph);
      const a = a0*tw*0.5;
      if (a < 0.02) continue;
      c.globalAlpha = a;
      c.beginPath(); c.arc(m.x*W, m.y*H, m.r, 0, Math.PI*2); c.fill();
    }
    c.globalAlpha = 1;
  }

  /* The nearest layer of all, drawn over the animals: grass and reeds
     against the glass, trunks at the frame's edge, a cable across the
     street. Almost black, and swaying wider than anything behind it,
     because it is close. */
  drawForeground(c, W, H, dt, bot) {
    if (!this.fg) return;
    const wa = this.windAmt();
    const near = css(mix(this.tok.inkDeep, bot, 0.015));
    const mn = Math.min(W, H);

    if (this.loc === "forest" && this.fgTrunks) {
      c.fillStyle = near;
      for (const tr of this.fgTrunks) {
        const sway = this.windBend(tr.x, true)*4.2 + Math.sin(this.t*0.7 + tr.x*5)*1.1*wa;
        const bw = tr.w*W;
        c.beginPath();
        c.moveTo(tr.x*W - bw*0.5, H);
        c.lineTo(tr.x*W - bw*0.5 + tr.lean*W + sway, -2);
        c.lineTo(tr.x*W + bw*0.5 + tr.lean*W + sway, -2);
        c.lineTo(tr.x*W + bw*0.5, H);
        c.closePath(); c.fill();
      }
    }
    if (this.loc === "city") {
      const [pxL, pxR] = this.poleX, [ptL, ptR] = this.poleTop;
      const swing = Math.sin(this.t*0.5)*2.5*wa;
      c.strokeStyle = near; c.fillStyle = near; c.lineCap = "round";
      // the two poles the wires hang from, and their crossarms
      c.lineWidth = 5;
      for (const [px, pt] of [[pxL, ptL], [pxR, ptR]]) {
        c.beginPath(); c.moveTo(px*W, H + 4); c.lineTo(px*W, pt*H); c.stroke();
        c.lineWidth = 3;
        c.beginPath();
        c.moveTo(px*W - 13, pt*H + 8); c.lineTo(px*W + 13, pt*H + 8);
        c.moveTo(px*W - 9, pt*H + 20); c.lineTo(px*W + 9, pt*H + 20);
        c.stroke();
        c.lineWidth = 5;
      }
      // and the wires between them, each hanging a little lower than the last
      c.lineWidth = 1.8;
      for (const w of this.fg) {
        const yL = (ptL + 0.02 + w.drop)*H, yR = (ptR + 0.02 + w.drop)*H;
        const sag = w.sag*H + swing;
        c.beginPath();
        c.moveTo(pxL*W, yL);
        c.quadraticCurveTo((pxL + pxR)*0.5*W, (yL + yR)*0.5 + sag*2, pxR*W, yR);
        c.stroke();
        // and the same wires carrying on off both edges of the frame
        c.beginPath();
        c.moveTo(pxL*W, yL);
        c.quadraticCurveTo(pxL*W*0.5, yL + sag*0.7, -6, yL - 6);
        c.moveTo(pxR*W, yR);
        c.quadraticCurveTo((pxR + 1)*0.5*W, yR + sag*0.7, W + 6, yR - 6);
        c.stroke();
      }
      return;
    }

    c.strokeStyle = near; c.fillStyle = near;
    c.lineCap = "round";
    // Three pens, so three passes: the stalks, the fronds, the seed heads.
    // Drawn plant by plant this alternated pen every few strokes and paid for
    // a rasterization each time; drawn pen by pen it is three.
    const fgSway = (g) => this.windBend(g.x)*14 + Math.sin(this.t*1.5 + g.ph)*3.6*wa + g.lean*7;

    // Thinner than it was: against a field whose own grass now runs to the
    // frame edge, a five-pixel bar reads as a post rather than a stem.
    c.lineWidth = Math.max(1.6, mn*0.0062);
    c.beginPath();
    for (const g of this.fg) {
      const gx = g.x*W, gy = H + 4, len = g.h*H, sway = fgSway(g);
      c.moveTo(gx, gy);
      c.quadraticCurveTo(gx + sway*0.4, gy - len*0.6, gx + sway, gy - len);
    }
    c.stroke();

    c.lineWidth = Math.max(1, mn*0.004);
    c.beginPath();
    for (const g of this.fg) {
      if (!g.blades) continue;              // a near fern, fronds and all
      const gx = g.x*W, gy = H + 4, len = g.h*H, sway = fgSway(g);
      for (let k = 1; k <= g.blades; k++) {
        const t2 = k/(g.blades + 1);
        const bx = gx + sway*t2, by = gy - len*t2, bl = len*0.3*(1 - t2*0.5);
        c.moveTo(bx, by); c.lineTo(bx - bl, by - bl*0.5);
        c.moveTo(bx, by); c.lineTo(bx + bl, by - bl*0.5);
      }
    }
    c.stroke();

    c.beginPath();
    for (const g of this.fg) {
      if (g.blades || !g.head) continue;    // a seed head, heavy at the tip
      const gx = g.x*W, gy = H + 4, len = g.h*H, sway = fgSway(g);
      const th = sway*0.012, sn = Math.sin(th), cs = Math.cos(th);
      const ox = mn*0.008, rx = mn*0.006, ry = mn*0.022;
      const cx = gx + sway - ox*sn, cy = gy - len + ox*cs;
      c.moveTo(cx + rx*cs, cy + rx*sn);
      c.ellipse(cx, cy, rx, ry, th, 0, Math.PI*2);
    }
    c.fill();
  }

  /* The air itself, thickening with distance: a soft band of haze lying
     along the far ground. It is what keeps the middle distance from
     reading as a flat cut-out. */
  distanceHaze(c, W, H, y0, y1, strength) {
    const g = c.createLinearGradient(0, y0*H, 0, y1*H);
    g.addColorStop(0, `rgba(${this.tok.fogRGB}, 0)`);
    g.addColorStop(0.45, `rgba(${this.tok.fogRGB}, ${strength})`);
    g.addColorStop(1, `rgba(${this.tok.fogRGB}, 0)`);
    c.fillStyle = g;
    c.fillRect(0, y0*H, W, (y1 - y0)*H);
  }

  /* Sparse points of light flashing off moving water. */
  drawWaterGlints(c, W, H, y0, y1, night) {
    if (!this.glints) return;
    const base = 0.55*(1 - night*0.45);
    if (base < 0.03) return;
    c.strokeStyle = `rgba(${this.tok.foamRGB}, 1)`; c.lineWidth = 1; c.lineCap = "round";
    for (const g of this.glints) {
      const tw = gaitAt("glint", this.t*g.sp*0.16 + g.ph, "lit");
      if (tw < 0.06) continue;
      const gx = g.x*W, gy = y0 + (y1 - y0)*(0.12 + 0.84*g.yy);
      c.globalAlpha = base*Math.min(1, (tw - 0.06)/0.5);
      c.beginPath(); c.moveTo(gx - 3, gy); c.lineTo(gx + 3, gy); c.stroke();
    }
    c.globalAlpha = 1;
  }

  drawMeadow(c, W, H, dt, bot) {
    const night = this.nightness();
    this.drawSkyBirds(c, W, H, bot, night);

    /* The far country, on the horizon and nowhere else. */
    this.drawRidge(c, this.hillA, mix(this.tok.ink, bot, 0.52), W, H);

    /* The field. One plane, painted as one gradient: pale and hazy where it
       meets the sky because that is what distance does to colour, and darker
       under your feet. A hard-edged band would be a flat again.

       Kept as a blit rather than evaluated every frame. Half of a full-screen
       canvas is a million pixels, and a gradient costs a great deal more per
       pixel than the flat Path2D fills this replaced — it put six and a half
       milliseconds on the meadow, which is most of a frame. The colours only
       move as the hour turns, so it is rebuilt on a coarse step of the light
       and blitted the rest of the time. */
    const hy = this.horizonY*H;
    c.drawImage(this.groundPlane(W, H, hy, bot), 0, Math.round(hy) - 1);

    /* Everything now goes down back to front, which on a plane is the only
       order there is. */
    const mn = Math.min(W, H);
    const treesByZ = (this.distantTrees || []).slice().sort((a, b) => b.z - a.z);
    let ti = 0;
    for (let bi = 0; bi < this.bounds.length; bi++) {
      const b = this.bounds[bi];
      // the trees standing in this boundary, before the hedge that hides their feet
      while (ti < treesByZ.length && treesByZ[ti].z >= b.z - 0.001) {
        const t = treesByZ[ti++];
        this.smallTree(c, t.x, t.y, t.h, t.r, W, H,
          css(mix(this.tok.inkDeep, bot, 0.10 + t.z*0.20)));
      }
      this.drawHedgerow(c, W, H, b.line, bot, b.z);
      if (bi === 0) {
        /* The haze goes down before the herd, not over it. Drawn behind it
           the cattle came out as three pale smudges — the one thing in the
           middle distance that is supposed to hold the eye, washed out by the
           air in front of it. */
        this.distanceHaze(c, W, H, this.horizonY - 0.02,
          this.planeY(0.62), 0.085*(1 - night*0.55));
        this.drawCattle(c, W, H, null, bot);
      }
    }
    while (ti < treesByZ.length) {
      const t = treesByZ[ti++];
      this.smallTree(c, t.x, t.y, t.h, t.r, W, H,
        css(mix(this.tok.inkDeep, bot, 0.10 + t.z*0.20)));
    }

    const shrubCol = css(mix(this.tok.inkDeep, bot, 0.15));
    for (const bu of (this.shrubs || [])) {
      this.bushShape(c, bu.x, bu.y, bu.r, bu.seed, W, H, shrubCol);
    }

    /* The field tree, standing on the plane at its own depth, so its trunk
       meets the ground where the ground actually is and its size is the size
       that depth allows. */
    const baseY = this.planeY(this.treeZ)*H;
    const tS = (this.planeScale(this.treeZ)/this.plane.top)*1.45;
    c.strokeStyle = css(mix(this.tok.inkDeep, bot, 0.06));
    c.lineCap = "round";
    const treeBend = this.windBend(this.treeX, true);
    for (const sg of this.tree) {
      c.lineWidth = Math.max(0.6, (0.8 + sg.w*1.1)*tS);
      const gw = (4 - sg.w)*(0.22 + state.wx.gust*0.63)*tS;
      const sway = treeBend*gw*3.4 + Math.sin(this.t*1.1 + sg.y1*8)*gw*0.7;
      c.beginPath();
      c.moveTo(this.treeX*W + sg.x1*W*0.5*tS + sway*0.4, baseY + sg.y1*H*0.9*tS);
      c.lineTo(this.treeX*W + sg.x2*W*0.5*tS + sway, baseY + sg.y2*H*0.9*tS);
      c.stroke();
    }
    if (this.treeLeaves) {
      c.fillStyle = css(mix(this.tok.inkDeep, bot, 0.10));
      for (const lf of this.treeLeaves) {
        const lw = 3.6*(0.22 + state.wx.gust*0.63)*tS;
        const sway = treeBend*lw*3.4 + Math.sin(this.t*1.1 + lf.y*8)*lw*0.7;
        c.beginPath();
        c.arc(this.treeX*W + (lf.x + lf.dx)*W*0.5*tS + sway,
          baseY + (lf.y + lf.dy)*H*0.9*tS, Math.max(0.8, lf.r*mn*tS), 0, Math.PI*2);
        c.fill();
      }
    }

    // stones, lying on the ground at their own depth
    for (const rk of (this.rocks || [])) {
      const rr = Math.max(0.7, rk.r*mn);
      c.fillStyle = css(mix(this.tok.inkDeep, bot, 0.05 + rk.shade*0.07 + (1 - rk.z)*0.02));
      c.beginPath();
      c.ellipse(rk.x*W, rk.y*H, rr, rr*0.55, 0, Math.PI, 0);
      c.fill();
    }

    this.drawFlowers(c, W, H, bot);
    this.drawDepthTufts(c, W, H, this.grass, bot, 0.09);
    this.drawMotes(c, W, H, this.dayness());
  }

  /* The field's own gradient, painted once and kept. Keyed on the size and on
     a coarse step of the ground colour: the hour has to move appreciably
     before it is worth a rebuild, and between rebuilds this is one blit. */
  groundPlane(W, H, hy, bot) {
    const y0 = Math.round(hy) - 1, h = Math.max(1, H - y0);
    const q = (v) => Math.round(v/6);
    const key = `${W}|${H}|${h}|${q(bot[0])},${q(bot[1])},${q(bot[2])}|`
      + `${q(this.tok.ink[0])},${q(this.tok.inkDeep[0])}`;
    if (this._planeKey === key && this._planeCv) return this._planeCv;
    const cv = this._planeCv && this._planeCv.width === W && this._planeCv.height === h
      ? this._planeCv : Object.assign(document.createElement("canvas"), { width: W, height: h });
    const g2 = cv.getContext("2d");
    g2.clearRect(0, 0, W, h);
    const g = g2.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, css(mix(this.tok.ink, bot, 0.50)));
    g.addColorStop(0.16, css(mix(this.tok.ink, bot, 0.34)));
    g.addColorStop(0.46, css(mix(this.tok.inkDeep, bot, 0.19)));
    g.addColorStop(1, css(mix(this.tok.inkDeep, bot, 0.06)));
    g2.fillStyle = g;
    g2.fillRect(0, 0, W, h);
    /* The field's own patchwork goes on here rather than in the frame: it is
       broad, soft, never quite one colour, and — being part of the ground —
       it never moves. A dozen large translucent ellipses a frame is exactly
       the kind of overdraw that costs a millisecond and is invisible. */
    for (const pa of (this.patches || [])) {
      g2.globalAlpha = 0.055*pa.k*(0.4 + (1 - pa.z)*0.6);
      g2.fillStyle = pa.tone > 0 ? css(this.tok.ink) : css(bot);
      g2.beginPath();
      g2.ellipse(pa.x*W, pa.y*H - y0, pa.w*W, Math.max(1, pa.h*H), 0, 0, Math.PI*2);
      g2.fill();
    }
    g2.globalAlpha = 1;
    this._planeCv = cv; this._planeKey = key;
    return cv;
  }

  /* Tufts that carry a depth — the meadow's grass, the wood's undergrowth,
     the marram on a dune. All the same problem and all the same answer.

     One flat line of tufts along a single baseline is a fringe, not a field.
     Every tuft stands where its depth puts it, is as tall as that depth
     allows, and is drawn in one of three passes from far to near so the near
     grass genuinely stands in front of the far. Each pass is a single path in
     a single colour — three strokes for three hundred blades — and the far
     pass is paler and finer, which is the same aerial perspective the ground
     itself has. */
  drawDepthTufts(c, W, H, list, bot, tint) {
    if (!list || !list.length) return;
    const wa = this.windAmt();
    // far · middle · near: where the band starts and stops, how much paler it
    // is than the near one, and how thick a blade is at that distance
    const bands = [[1.01, 0.62, 0.21, 0.6], [0.62, 0.28, 0.09, 1.0],
                   [0.28, -0.01, 0, 1.6]];
    c.lineCap = "round";
    for (const [zHi, zLo, pale, pen] of bands) {
      c.strokeStyle = css(mix(this.tok.inkDeep, bot, tint + pale));
      c.lineWidth = pen;
      let any = false;
      c.beginPath();
      for (const gr of list) {
        if (gr.z >= zHi || gr.z < zLo) continue;
        const near = 1 - gr.z;
        const gx = gr.x*W, gy = gr.y*H, hh = gr.h*H;
        /* A blade leans by a fraction of its own length, not by a fixed few
           pixels: at a fixed offset every blade in the near band stood
           near-vertical and parallel, and forty of those is a bed of nails
           rather than grass. The wind is on top of that, and it moves a near
           blade further across the glass than a far one for the same wind. */
        const sway = gr.lean*hh*0.62
          + (this.windBend(gr.x)*7.5 + Math.sin(this.t*1.8 + gr.ph)*2.2*wa)*(0.3 + near*0.7);
        c.moveTo(gx, gy + 2);
        // a blade five pixels tall has no curve in it worth paying for
        if (hh < 7) c.lineTo(gx + sway, gy - hh);
        else c.quadraticCurveTo(gx + sway*0.25, gy - hh*0.62, gx + sway, gy - hh);
        any = true;
      }
      if (any) c.stroke();
    }
  }

  /* The field's own gradient, painted once and kept. Keyed on the size and on
     a coarse step of the ground colour: the hour has to move appreciably
     before it is worth a rebuild, and between rebuilds this is one blit. */
  groundPlane(W, H, hy, bot) {
    const y0 = Math.round(hy) - 1, h = Math.max(1, H - y0);
    const q = (v) => Math.round(v/6);
    const key = `${W}|${H}|${h}|${q(bot[0])},${q(bot[1])},${q(bot[2])}|`
      + `${q(this.tok.ink[0])},${q(this.tok.inkDeep[0])}`;
    if (this._planeKey === key && this._planeCv) return this._planeCv;
    const cv = this._planeCv && this._planeCv.width === W && this._planeCv.height === h
      ? this._planeCv : Object.assign(document.createElement("canvas"), { width: W, height: h });
    const g2 = cv.getContext("2d");
    g2.clearRect(0, 0, W, h);
    const g = g2.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, css(mix(this.tok.ink, bot, 0.50)));
    g.addColorStop(0.16, css(mix(this.tok.ink, bot, 0.34)));
    g.addColorStop(0.46, css(mix(this.tok.inkDeep, bot, 0.19)));
    g.addColorStop(1, css(mix(this.tok.inkDeep, bot, 0.06)));
    g2.fillStyle = g;
    g2.fillRect(0, 0, W, h);
    /* The field's own patchwork goes on here rather than in the frame: it is
       broad, soft, never quite one colour, and — being part of the ground —
       it never moves. A dozen large translucent ellipses a frame is exactly
       the kind of overdraw that costs a millisecond and is invisible. */
    for (const pa of (this.patches || [])) {
      g2.globalAlpha = 0.055*pa.k*(0.4 + (1 - pa.z)*0.6);
      g2.fillStyle = pa.tone > 0 ? css(this.tok.ink) : css(bot);
      g2.beginPath();
      g2.ellipse(pa.x*W, pa.y*H - y0, pa.w*W, Math.max(1, pa.h*H), 0, 0, Math.PI*2);
      g2.fill();
    }
    g2.globalAlpha = 1;
    this._planeCv = cv; this._planeKey = key;
    return cv;
  }

  /* The grass, which is most of what a meadow is.

     One flat line of tufts along a single baseline is a fringe, not a field.
     Every tuft carries a depth: it stands where that depth puts it, it is as
     tall as that depth allows, and it is drawn in one of three passes from
     far to near so the near grass genuinely stands in front of the far. Each
     pass is a single path in a single colour — three strokes for three
     hundred blades — and the far pass is paler, which is the same aerial
     perspective the ground itself has. */
  drawMeadowGrass(c, W, H, bot) {
    if (!this.grass) return;
    const wa = this.windAmt();
    // far · middle · near: where the band starts and stops, how pale it is,
    // and how thick a blade is at that distance
    const bands = [[1.01, 0.62, 0.30, 0.6], [0.62, 0.28, 0.18, 1.0],
                   [0.28, -0.01, 0.09, 1.6]];
    c.lineCap = "round";
    for (const [zHi, zLo, tint, pen] of bands) {
      c.strokeStyle = css(mix(this.tok.inkDeep, bot, tint));
      c.lineWidth = pen;
      let any = false;
      c.beginPath();
      for (const gr of this.grass) {
        if (gr.z >= zHi || gr.z < zLo) continue;
        const near = 1 - gr.z;
        const gx = gr.x*W, gy = gr.y*H, hh = gr.h*H;
        /* A blade leans by a fraction of its own length, not by a fixed few
           pixels: at a fixed offset every blade in the near band stood
           near-vertical and parallel, and forty of those is a bed of nails
           rather than grass. The wind is on top of that, and it moves a near
           blade further across the glass than a far one for the same wind. */
        const sway = gr.lean*hh*0.62
          + (this.windBend(gr.x)*7.5 + Math.sin(this.t*1.8 + gr.ph)*2.2*wa)*(0.3 + near*0.7);
        c.moveTo(gx, gy + 2);
        // a blade five pixels tall has no curve in it worth paying for
        if (hh < 7) c.lineTo(gx + sway, gy - hh);
        else c.quadraticCurveTo(gx + sway*0.25, gy - hh*0.62, gx + sway, gy - hh);
        any = true;
      }
      if (any) c.stroke();
    }
  }

  /* Stems first, all of them in one path: they share a colour and a width, and
     the colour is opaque, so gathering them changes nothing but the number of
     times the rasterizer is asked. The heads cannot join them — they are drawn
     at 0.82, and two translucent petals that overlap must darken each other,
     which only happens if each is laid down in its own turn. */
  drawFlowers(c, W, H, bot) {
    if (!this.flowers) return;
    const wa = this.windAmt();
    c.lineWidth = 1;
    c.strokeStyle = css(mix(this.tok.inkDeep, bot, 0.16));   // stems share one colour
    c.beginPath();
    for (const f of this.flowers) {
      const gx = f.x*W, gy = f.y*H, near = 1 - f.z;
      const sway = (this.windBend(f.x)*6 + Math.sin(this.t*1.6 + f.ph)*1.8*wa)*(0.3 + near*0.7);
      c.moveTo(gx, gy + 2);
      c.quadraticCurveTo(gx + sway*0.4, gy - f.h*H*0.55, gx + sway, gy - f.h*H);
    }
    c.stroke();
    /* The heads go down three at a time — one path per colour — rather than
       one fill apiece. Sixty flowers was sixty rasterizations of a disc four
       pixels across, which is the sort of thing that costs a milliseconds and
       buys nothing. Distance is spent on size here rather than on alpha,
       since alpha is what would have forced them apart again. */
    const tones = [[0.4, this.tok.amberRGB], [0.72, this.tok.sageRGB], [1.1, this.tok.cloudRGB]];
    let lo = -1;
    for (const [hi, rgb] of tones) {
      c.fillStyle = `rgba(${rgb}, 0.74)`;
      let any = false;
      c.beginPath();
      for (const f of this.flowers) {
        if (f.tone <= lo || f.tone > hi) continue;
        const near = 1 - f.z;
        const sway = (this.windBend(f.x)*6 + Math.sin(this.t*1.6 + f.ph)*1.8*wa)*(0.3 + near*0.7);
        const r = Math.max(0.6, f.h*H*0.13);
        const cx = f.x*W + sway, cy = f.y*H - f.h*H;
        c.moveTo(cx + r, cy);
        c.arc(cx, cy, r, 0, Math.PI*2);
        any = true;
      }
      if (any) c.fill();
      lo = hi;
    }
  }

  drawForest(c, W, H, dt, bot) {
    this.drawRidge(c, this.hillA, mix(this.tok.ink, bot, 0.5), W, H);
    const wa = this.windAmt();
    const mn = Math.min(W, H);
    // One long breath of wind that every crown answers together, over the top
    // of each tree's own smaller motion — a wood moves as one thing.
    // One long breath the whole wood answers, from the heavy row of springs —
    // so the crowns come round to a gust well after the field has.
    const gust = 1 + 1.9*this.windBend(0.5, true);
    const drawTrunk = (tr, colStr) => {
      // where this trunk's own depth puts the floor, not one line for all
      const groundY = (tr.z !== undefined ? this.planeY(tr.z) : 0.93) * H;
      const topY = H * tr.top;
      const sway = this.windBend(tr.x, true)*7.5
        + Math.sin(this.t*1.1 + tr.x*9)*1.2*wa;
      c.strokeStyle = colStr; c.fillStyle = colStr;
      c.lineCap = "round";
      c.lineWidth = tr.w;
      const bx = tr.x*W + tr.lean*W*2 + sway;
      // the butt of the tree, where it spreads into the ground
      c.beginPath();
      c.moveTo(tr.x*W - tr.w*1.15, groundY + 2);
      c.quadraticCurveTo(tr.x*W - tr.w*0.55, groundY - H*0.05, tr.x*W - tr.w*0.5, groundY - H*0.09);
      c.lineTo(tr.x*W + tr.w*0.5, groundY - H*0.09);
      c.quadraticCurveTo(tr.x*W + tr.w*0.55, groundY - H*0.05, tr.x*W + tr.w*1.15, groundY + 2);
      c.closePath(); c.fill();
      c.beginPath();
      c.moveTo(tr.x*W, groundY);
      // carried a little way up into the crown, so the join is never a gap
      c.quadraticCurveTo(tr.x*W + tr.lean*W, (groundY+topY)/2, bx, topY - H*0.03);
      c.stroke();
      for (const b of tr.canopy) {
        c.beginPath();
        c.arc(bx + b.dx*W, topY + b.dy*H, b.r*mn, 0, Math.PI*2);
        c.fill();
      }
    };
    const farCol = css(mix(this.tok.ink, bot, 0.36));
    const midCol = css(mix(this.tok.ink, bot, 0.20));
    for (const tr of this.trunksFar) drawTrunk(tr, farCol);
    for (const tr of (this.trunksMid || [])) drawTrunk(tr, midCol);
    // a band of soft haze hanging between the trees
    const haze = c.createLinearGradient(0, H*0.42, 0, H*0.82);
    haze.addColorStop(0, `rgba(${this.tok.fogRGB}, 0)`);
    haze.addColorStop(0.5, `rgba(${this.tok.fogRGB}, 0.05)`);
    haze.addColorStop(1, `rgba(${this.tok.fogRGB}, 0)`);
    c.fillStyle = haze; c.fillRect(0, H*0.42, W, H*0.4);
    const nearCol = css(mix(this.tok.inkDeep, bot, 0.10));
    for (const tr of this.trunksNear) drawTrunk(tr, nearCol);
    c.fillStyle = css(mix(this.tok.inkDeep, bot, 0.14));
    c.fillRect(0, H*0.93, W, H*0.07);
    this.drawDapples(c, W, H, gust);
    this.drawFerns(c, W, H, bot);
    this.drawMushrooms(c, W, H, bot);
    this.drawDepthTufts(c, W, H, this.grass, bot, 0.12);
    this.drawMotes(c, W, H, this.dayness());
    this.drawFallingLeaves(c, W, H, bot);
  }

  /* Light through the canopy, pooled on the floor. It slides with the gust
     the crowns are answering, so the light and the trees move together. */
  /* The dapples stand still in a dull wood. That is the old behaviour — the
     drift sat behind the same test that decided whether to paint at all — and
     it has to be kept now the two are apart. */
  updateDapples(dt) {
    if (!this.dapples) return;
    if (this.dayness() < 0.12) return;
    for (const d of this.dapples) {
      d.x += d.sp*dt;
      if (d.x > 1.08) d.x -= 1.16;
    }
  }

  drawDapples(c, W, H, gust) {
    if (!this.dapples) return;
    const day = this.dayness();
    if (day < 0.12) return;
    const mn = Math.min(W, H);
    c.fillStyle = `rgba(${this.tok.cloudRGB}, 1)`;
    for (const d of this.dapples) {
      const tw = 0.55 + 0.45*Math.sin(this.t*d.tw + d.ph);
      const a = day*0.085*tw;
      if (a < 0.01) continue;
      const px = (d.x + gust*0.004)*W, py = d.y*H;
      c.globalAlpha = a;
      c.beginPath();
      c.ellipse(px, py, d.w*W*0.5, d.w*W*0.13, 0, 0, Math.PI*2);
      c.fill();
    }
    c.globalAlpha = 1;
  }

  /* Sixteen ferns, each a midrib and a fan of fronds, came to something like
     a hundred and seventy strokes a frame. There are only two pens in the
     whole thicket — a thick one for the ribs and a thin one for the fronds —
     so it is two passes and two strokes, in the order the pens change. */
  drawFerns(c, W, H, bot) {
    if (!this.ferns) return;
    const wa = this.windAmt();
    const sway = (f) => this.windBend(f.x)*5 + Math.sin(this.t*1.4 + f.x*10)*1.4*wa + f.lean*6;
    c.strokeStyle = css(mix(this.tok.inkDeep, bot, 0.13)); c.lineCap = "round";

    c.lineWidth = 1.5;
    c.beginPath();
    for (const f of this.ferns) {
      const gx = f.x*W, gy = f.y*H, len = f.size*H, sw = sway(f);
      c.moveTo(gx, gy + 2);
      c.quadraticCurveTo(gx + sw*0.5, gy - len*0.5, gx + sw, gy - len);
    }
    c.stroke();

    c.lineWidth = 1;
    c.beginPath();
    for (const f of this.ferns) {
      const gx = f.x*W, gy = f.y*H, len = f.size*H, sw = sway(f);
      for (let i = 1; i <= f.blades; i++) {
        const t = i/(f.blades + 1), bx = gx + sw*t, by = gy - len*t, bl = len*0.28*(1 - t*0.5);
        c.moveTo(bx, by); c.lineTo(bx - bl, by - bl*0.5);
        c.moveTo(bx, by); c.lineTo(bx + bl, by - bl*0.5);
      }
    }
    c.stroke();
  }

  drawMushrooms(c, W, H, bot) {
    if (!this.mushrooms) return;
    c.lineCap = "round";
    c.strokeStyle = css(mix(this.tok.inkDeep, bot, 0.24));   // stems share one colour
    for (const m of this.mushrooms) {
      const gx = m.x*W, gy = m.y*H, r = m.size*Math.min(W, H);
      const stemH = m.tall ? r*2.4 : r*1.3;
      c.lineWidth = Math.max(1.3, r*0.7);
      c.beginPath(); c.moveTo(gx, gy); c.lineTo(gx, gy - stemH); c.stroke();
      const rgb = m.tone < 0.5 ? this.tok.amberRGB : this.tok.foamRGB;
      c.fillStyle = `rgba(${rgb}, 0.78)`;
      c.beginPath(); c.ellipse(gx, gy - stemH, r, r*0.7, 0, Math.PI, 0); c.fill();
    }
  }

  updateFallingLeaves(dt) {
    if (!this.leaves) return;
    /* A leaf already off the tree is the lightest thing in the wood, so it
       reads the same gust the branches are reading — and it spins faster the
       harder it is being carried, which is what a leaf in a gust does. */
    for (const l of this.leaves) {
      const push = this.windBend(l.x);
      l.y += l.sp*dt;
      l.x += (l.drift + Math.sin(this.t*1.2 + l.ph)*0.02 + push*0.10)*dt;
      l.rot += dt*(1.6 + Math.abs(push)*4.5);
      if (l.y > 0.96) { l.y = 0.28 + Math.random()*0.12; l.x = Math.random(); }
    }
  }

  drawFallingLeaves(c, W, H, bot) {
    if (!this.leaves) return;
    c.fillStyle = css(mix(this.tok.inkDeep, bot, 0.18));
    for (const l of this.leaves) {
      c.save(); c.translate(l.x*W, l.y*H); c.rotate(l.rot);
      c.beginPath(); c.ellipse(0, 0, 3.2, 1.4, 0, 0, Math.PI*2); c.fill();
      c.restore();
    }
  }

  drawBeach(c, W, H, dt, top, bot, night) {
    this.drawSkyBirds(c, W, H, bot, night);
    const hy = this.horizonY * H, sy = this.shoreY * H;
    const sg = c.createLinearGradient(0, hy, 0, sy);
    sg.addColorStop(0, css(mix(this.tok.sea, top, 0.40)));
    sg.addColorStop(1, css(mix(this.tok.sea, bot, 0.22)));
    c.fillStyle = sg;
    c.fillRect(0, hy, W, sy - hy);
    c.fillStyle = `rgba(${this.tok.foamRGB}, 0.14)`;
    c.fillRect(0, hy, W, 1);
    this.distanceHaze(c, W, H, this.horizonY - 0.07, this.horizonY + 0.1,
      0.09*(1 - night*0.55));
    if (this.islet) {
      const ix = this.islet.x*W, iy = hy + (sy - hy)*0.14;
      const iw = this.islet.w*W, ih = this.islet.h*H;
      c.fillStyle = css(mix(this.tok.inkDeep, bot, 0.26));
      c.beginPath();
      c.moveTo(ix - iw*0.5, iy);
      c.bezierCurveTo(ix - iw*0.3, iy - ih, ix - iw*0.05, iy - ih*1.25, ix + iw*0.12, iy - ih*0.9);
      c.bezierCurveTo(ix + iw*0.32, iy - ih*1.15, ix + iw*0.5, iy - ih*0.5, ix + iw*0.5, iy);
      c.closePath(); c.fill();
    }
    this.drawWaterGlints(c, W, H, hy, sy, night);
    if (this.celX !== undefined) {
      const lx = this.celX * W;
      const lg = c.createLinearGradient(0, hy, 0, sy);
      lg.addColorStop(0, `rgba(${this.tok.foamRGB}, 0.10)`);
      lg.addColorStop(1, `rgba(${this.tok.foamRGB}, 0)`);
      c.fillStyle = lg;
      c.fillRect(lx - W*0.03, hy, W*0.06, sy - hy);
    }
    // The swash: up the sand fast, and a long slow drain back — never the
    // even there-and-back a sine gives. The foam thins as the water spreads.
    for (const f of this.foam) {
      const sw = gaitPose("swash", f.p);
      const fy = hy + (sy - hy) * (0.12 + 0.88 * Math.max(0, sw.reach));
      const alpha = Math.max(0, sw.foam) * 0.45;
      if (alpha < 0.02) continue;
      c.strokeStyle = `rgba(${this.tok.foamRGB}, ${alpha})`;
      c.lineWidth = 1 + Math.max(0, sw.reach)*1.5;
      c.beginPath();
      const n = 40;
      for (let i = 0; i <= n; i++) {
        const x = i / n;
        const wig = Math.sin(x*14 + this.t*0.8 + f.p*9) * 2.5 * (0.4 + sw.reach);
        if (i === 0) c.moveTo(x*W, fy + wig); else c.lineTo(x*W, fy + wig);
      }
      c.stroke();
    }
    const dg = c.createLinearGradient(0, sy, 0, H);
    dg.addColorStop(0, css(mix(this.tok.sand, bot, 0.25)));
    dg.addColorStop(1, css(mix(this.tok.sand, this.tok.inkDeep, 0.35 + night*0.3)));
    c.fillStyle = dg;
    c.fillRect(0, sy, W, H - sy);
    c.fillStyle = `rgba(${this.tok.foamRGB}, 0.10)`;
    c.fillRect(0, sy, W, 3);
    this.drawWetSand(c, W, H, top, bot, night);
    // pebbles and the odd shell strewn along the tide line
    for (const pb of (this.pebbles || [])) {
      const r = Math.max(0.6, pb.r*Math.min(W, H));
      if (pb.shell) {
        c.strokeStyle = `rgba(${this.tok.foamRGB}, 0.5)`; c.lineWidth = 1.1;
        c.beginPath(); c.arc(pb.x*W, pb.y*H, r*1.2, Math.PI*0.12, Math.PI*0.88); c.stroke();
      } else {
        c.fillStyle = css(mix(this.tok.inkDeep, bot, 0.05 + pb.shade*0.08));
        c.beginPath(); c.ellipse(pb.x*W, pb.y*H, r, r*0.68, 0, 0, Math.PI*2); c.fill();
      }
    }
    if (this.driftwood) {
      const dw = this.driftwood, ww = dw.w*W;
      c.save(); c.translate(dw.x*W, (this.shoreY + 0.1)*H); c.rotate(dw.ang);
      c.strokeStyle = css(mix(this.tok.inkDeep, bot, 0.13)); c.lineCap = "round";
      c.lineWidth = 4; c.beginPath(); c.moveTo(-ww/2, 0); c.lineTo(ww/2, 0); c.stroke();
      c.lineWidth = 2.4; c.beginPath(); c.moveTo(ww*0.1, 0); c.lineTo(ww*0.24, -ww*0.13); c.stroke();
      c.restore();
    }
    c.lineCap = "round";
    for (const p of this.posts) {
      // each post stands where its depth puts it, and weathers with distance
      c.strokeStyle = css(mix(this.tok.inkDeep, bot, 0.12 + p.z*0.16));
      c.lineWidth = p.w;
      c.beginPath();
      c.moveTo(p.x*W, p.y*H + 2);
      c.lineTo(p.x*W, p.y*H - p.h*H);
      c.stroke();
    }
    this.drawDepthTufts(c, W, H, this.duneGrass, bot, 0.18);
  }

  updateFoam(dt) {
    if (!this.foam) return;
    for (const f of this.foam) {
      f.p += dt / 10;
      if (f.p > 1) f.p -= 1;
    }
  }

  /* How far up the sand the last wave reached, chasing up quickly and draining
     away slowly. This reads the foam, so it must run after updateFoam — and
     unlike the mist and the motes it is *not* gated: the old code reached its
     `this.wet < 0.004` return only after the accumulation, so the sand goes on
     drying whether or not there is anything left to draw. */
  updateWetSand(dt) {
    if (!this.foam) return;
    let reach = 0;
    for (const f of this.foam) {
      const sw = gaitPose("swash", f.p);
      reach = Math.max(reach, (0.12 + 0.88*Math.max(0, sw.reach)) * Math.max(0, sw.foam));
    }
    const target = reach*0.14;
    this.wet += (target - this.wet) * Math.min(1, dt*(target > this.wet ? 3.2 : 0.5));
  }

  updateFishRings(dt) {
    for (let i = this.fishRings.length - 1; i >= 0; i--) {
      const fr = this.fishRings[i];
      const was = fr.age;
      fr.age += dt;
      /* A ring spreading across the water tips whatever is floating on it. The
         pads used to bob on a clock of their own, which meant a fish could
         rise beside one and the pad would not know. Now the ring's edge gives
         each pad it passes a shove, and the pad rocks it off on a spring. */
      if (this.lilies) {
        const r0 = was/1.6*0.075, r1 = fr.age/1.6*0.075;
        for (const li of this.lilies) {
          const d = Math.hypot(li.x - fr.x, (li.y - fr.y)*2.4);
          if (d >= r0 && d < r1) li.rockV += (li.x > fr.x ? 1 : -1)*(1 - fr.age/1.6)*3.4;
        }
      }
      if (fr.age > 1.6) { this.fishRings.splice(i, 1); continue; }
    }
    if (this.lilies) {
      const h = Math.min(dt, 1/30);
      for (const li of this.lilies) {
        li.rock += (li.rockV += (-li.rock*46 - li.rockV*4.2)*h)*h;
      }
    }
  }

  /* Lights only come on and go off after dark, which is where the old loop sat:
     inside the test for whether to draw any lit windows at all. */
  updateCityWindows(dt, night) {
    if (night <= 0.12 || !this.frontBlocks) return;
    for (const b of this.frontBlocks) {
      for (const wnd of b.lit) {
        wnd.next -= dt;
        if (wnd.next <= 0) {
          wnd.on = !wnd.on;
          wnd.next = (wnd.on ? 45 : 25) + Math.random()*150;
          wnd.fade = 0;
        }
        wnd.fade = Math.min(1, (wnd.fade === undefined ? 1 : wnd.fade) + dt*0.7);
      }
    }
  }

  /* The sand the sea has just been over. It runs up the beach behind each
     wave and drains slowly back, and while it is wet it holds the light —
     the sky, the sun, and a smear of whatever is standing on it. */
  drawWetSand(c, W, H, top, bot, night) {
    const sy = this.shoreY;
    if (this.wet < 0.004) return;
    const y0 = sy*H, y1 = (sy + this.wet)*H;

    // the sheen itself, brightest at the water's edge
    const g = c.createLinearGradient(0, y0, 0, y1);
    g.addColorStop(0, `rgba(${this.tok.foamRGB}, ${0.3*(1 - night*0.45)})`);
    g.addColorStop(0.55, `rgba(${this.tok.foamRGB}, ${0.13*(1 - night*0.45)})`);
    g.addColorStop(1, `rgba(${this.tok.foamRGB}, 0)`);
    c.fillStyle = g;
    c.fillRect(0, y0, W, y1 - y0);

    // the sun or moon laid out along it in a soft column
    if (this.celX !== undefined) {
      const lg = c.createLinearGradient(0, y0, 0, y1);
      lg.addColorStop(0, `rgba(${this.tok.foamRGB}, 0.22)`);
      lg.addColorStop(1, `rgba(${this.tok.foamRGB}, 0)`);
      c.fillStyle = lg;
      c.fillRect(this.celX*W - W*0.045, y0, W*0.09, y1 - y0);
    }

    // and the posts standing in it, upside down and coming apart
    c.save();
    c.beginPath(); c.rect(0, y0, W, y1 - y0); c.clip();
    c.strokeStyle = css(mix(this.tok.inkDeep, bot, 0.2));
    c.lineCap = "round";
    for (const p of this.posts) {
      const h = p.h*H*0.75;
      c.globalAlpha = 0.3;
      c.lineWidth = 3;
      c.beginPath();
      c.moveTo(p.x*W, y0);
      c.lineTo(p.x*W + Math.sin(this.t*0.9 + p.x*6)*2.5, y0 + h);
      c.stroke();
    }
    // the ripple of the drained water breaking the reflections
    c.globalAlpha = 0.16;
    c.strokeStyle = `rgba(${this.tok.foamRGB}, 1)`;
    c.lineWidth = 1;
    for (let k = 0; k < 4; k++) {
      const ry = y0 + (y1 - y0)*(0.2 + k*0.22);
      c.beginPath();
      c.moveTo(0, ry + Math.sin(this.t*0.7 + k)*1.5);
      c.lineTo(W, ry + Math.sin(this.t*0.7 + k + 2)*1.5);
      c.stroke();
    }
    c.restore();
    c.globalAlpha = 1;
  }

  drawWetland(c, W, H, dt, top, bot, night) {
    this.drawSkyBirds(c, W, H, bot, night);
    this.drawRidge(c, this.treeline, mix(this.tok.ink, bot, 0.42), W, H);
    const farTree = css(mix(this.tok.ink, bot, 0.36));
    for (const t of (this.distantTrees || [])) this.smallTree(c, t.x, t.y, t.h, t.r, W, H, farTree);
    this.distanceHaze(c, W, H, this.treeline(0.5) - 0.06, this.waterY + 0.06,
      0.08*(1 - this.nightness()*0.55));
    const wy = this.waterY * H, by = this.bankY * H;
    const wg = c.createLinearGradient(0, wy, 0, by);
    wg.addColorStop(0, css(mix(this.tok.sea, top, 0.45)));
    wg.addColorStop(1, css(mix(this.tok.sea, bot, 0.20)));
    c.fillStyle = wg;
    c.fillRect(0, wy, W, by - wy);
    this.drawReflections(c, W, H, top, bot, night);
    this.drawWaterGlints(c, W, H, wy, by, night);
    if (this.celX !== undefined) {
      const lx = this.celX * W;
      const lg = c.createLinearGradient(0, wy, 0, by);
      lg.addColorStop(0, `rgba(${this.tok.foamRGB}, 0.12)`);
      lg.addColorStop(1, `rgba(${this.tok.foamRGB}, 0)`);
      c.fillStyle = lg;
      c.fillRect(lx - W*0.025, wy, W*0.05, by - wy);
    }
    for (const rl of this.rippleLines) {
      const ry = rl.y * H;
      const alpha = 0.06 + 0.03*Math.sin(this.t*rl.sp*3 + rl.ph);
      c.strokeStyle = `rgba(${this.tok.foamRGB}, ${Math.max(0, alpha)})`;
      c.lineWidth = 1;
      c.beginPath();
      const drift = Math.sin(this.t*rl.sp + rl.ph) * W * 0.02;
      c.moveTo(W*0.08 + drift, ry);
      c.bezierCurveTo(W*0.35 + drift, ry - 1.5, W*0.65 + drift, ry + 1.5, W*0.92 + drift, ry);
      c.stroke();
    }
    // a half-sunk log resting in the shallows
    if (this.log) {
      const lg = this.log, ww = lg.w*W;
      c.save(); c.translate(lg.x*W, lg.y*H); c.rotate(lg.ang);
      c.fillStyle = css(mix(this.tok.inkDeep, bot, 0.12));
      c.beginPath(); c.ellipse(0, 0, ww/2, ww*0.06, 0, 0, Math.PI*2); c.fill();
      c.strokeStyle = `rgba(${this.tok.foamRGB}, 0.2)`; c.lineWidth = 1;
      c.beginPath(); c.ellipse(0, ww*0.1, ww*0.6, ww*0.05, 0, 0, Math.PI); c.stroke();
      c.restore();
    }
    // lily pads floating on the open water
    for (const li of (this.lilies || [])) {
      const lx = li.x*W, r = li.r*Math.min(W, H);
      const ly = li.y*H + Math.sin(this.t*0.6 + li.ph)*1.0 + li.rock*2.2;
      c.fillStyle = css(mix(this.tok.sea, this.tok.inkDeep, 0.4));
      c.beginPath(); c.ellipse(lx, ly, r, r*0.5, li.rock*0.22, 0, Math.PI*2); c.fill();
      c.strokeStyle = css(mix(this.tok.sea, top, 0.42)); c.lineWidth = 1.4;
      c.beginPath(); c.moveTo(lx, ly); c.lineTo(lx + r, ly + li.rock*r*0.22); c.stroke();
      if (li.bloom) {
        c.fillStyle = `rgba(${this.tok.foamRGB}, 0.8)`;
        c.beginPath(); c.arc(lx - r*0.2, ly - r*0.22, Math.max(1.4, r*0.3), 0, Math.PI*2); c.fill();
      }
    }
    // fish rises
    for (let i = this.fishRings.length - 1; i >= 0; i--) {
      const fr = this.fishRings[i];
      const p = fr.age / 1.6;
      c.strokeStyle = `rgba(${this.tok.foamRGB}, ${(1-p)*0.35})`;
      c.lineWidth = 1;
      c.beginPath();
      c.ellipse(fr.x*W, fr.y*H, p*34, p*34*0.3, 0, 0, Math.PI*2);
      c.stroke();
      if (p < 0.15 && !fr.quiet) {
        c.fillStyle = `rgba(${this.tok.foamRGB}, 0.5)`;
        c.beginPath(); c.arc(fr.x*W, fr.y*H, 2, 0, Math.PI*2); c.fill();
      }
    }
    this.drawWaterMist(c, W, H, night);
    c.fillStyle = css(mix(this.tok.inkDeep, bot, 0.15));
    c.beginPath();
    c.moveTo(0, H); c.lineTo(0, by);
    c.quadraticCurveTo(W*0.5, by - H*0.015, W, by);
    c.lineTo(W, H); c.closePath(); c.fill();
    const wa = this.windAmt();
    const reedCol = css(mix(this.tok.inkDeep, bot, 0.10));
    c.strokeStyle = reedCol; c.fillStyle = reedCol; c.lineWidth = 1.3;
    /* A stem bends by a fraction of its own length and a near one is moved
       further across the glass by the same wind — the same two rules the
       meadow's grass got, and for the same reason. */
    const reedSway = (r) => r.lean*r.h*H*0.30
      + (this.windBend(r.x)*9 + Math.sin(this.t*1.3 + r.ph)*2.2*wa)*(0.3 + (1 - r.z)*0.7);
    // Every stem in one pen: one path, one stroke.
    c.beginPath();
    for (const r of this.reeds) {
      const rx = r.x * W, ry = r.y*H, sway = reedSway(r);
      c.moveTo(rx, ry + 2);
      c.quadraticCurveTo(rx + sway*0.35, ry - r.h*H*0.55, rx + sway, ry - r.h*H);
    }
    c.stroke();
    // The seed heads used to each take a save/translate/rotate. An ellipse can
    // carry its own rotation, so the tilt goes into the arc itself and the
    // offset that the rotation used to carry is applied by hand: (0, 2) turned
    // through the same angle. Same heads, one fill.
    c.beginPath();
    for (const r of this.reeds) {
      if (!r.head) continue;
      const sway = reedSway(r), th = sway * 0.01;
      const sn = Math.sin(th), cs = Math.cos(th);
      // where translate(topX, topY) → rotate(th) → ellipse(0, 2, …) puts the centre
      const hs = Math.max(0.7, 2*(this.planeScale(r.z)/this.plane.top));
      const cx = r.x*W + sway - hs*sn, cy = r.y*H - r.h*H + hs*cs;
      c.moveTo(cx + hs*cs, cy + hs*sn);  // the arc's own start, or it joins the last head
      c.ellipse(cx, cy, hs, hs*3.5, th, 0, Math.PI*2);
    }
    c.fill();
    this.drawMotes(c, W, H, this.dayness());
  }

  /* The far bank, upside down in the water below it: the treeline and its
     trees, squashed, dimmed, and cut across by every ripple that passes. */
  drawReflections(c, W, H, top, bot, night) {
    const wy = this.waterY*H;
    // A reflection only reaches a little way out from the bank it belongs to,
    // and it is broken up the further it comes — so it lives in a shallow
    // band just below the far shore, not across the whole pool.
    const zone = Math.min((this.bankY - this.waterY)*0.42, 0.13) * H;
    c.save();
    c.beginPath(); c.rect(0, wy, W, zone); c.clip();
    const col = css(mix(this.tok.ink, bot, 0.52));
    const water = css(mix(this.tok.sea, top, 0.45));
    c.globalAlpha = 0.34*(1 - night*0.5);
    c.fillStyle = col;
    // the trees along the bank, upside down and squashed
    for (const t of (this.distantTrees || [])) {
      const drop = (this.waterY - t.y)*0.5;
      const ty = wy + drop*H;
      const rr = t.r*Math.min(W, H)*0.85, hh = t.h*H*0.5;
      c.fillRect(t.x*W - rr*0.11, ty, rr*0.22, hh);
      c.beginPath(); c.ellipse(t.x*W, ty + hh, rr, rr*0.7, 0, 0, Math.PI*2); c.fill();
    }
    // the ripples that pass through them: strips of open water laid back over
    // the reflection, never erasing the pool itself
    c.fillStyle = water;
    for (let k = 0; k < 10; k++) {
      const ry = wy + zone*(0.05 + k*0.1) + Math.sin(this.t*0.55 + k*1.3)*2;
      c.globalAlpha = (0.34 + (k % 3)*0.13) * (0.35 + k/12);
      c.fillRect(0, ry, W, 1.4 + (k % 2));
    }
    // and it fades out entirely before it reaches the middle of the water
    const fade = c.createLinearGradient(0, wy, 0, wy + zone);
    fade.addColorStop(0, `rgba(0,0,0,0)`);
    fade.addColorStop(1, water);
    c.globalAlpha = 0.85;
    c.fillStyle = fade;
    c.fillRect(0, wy, W, zone);
    c.restore();
    c.globalAlpha = 1;
  }

  /* Mist lying on the water before the sun has any strength in it. */
  /* How much mist there is at all, which is also the test for whether it
     drifts: the advance of mistX used to sit behind this same return. */
  mistAmt() {
    const dawnish = this.timeMix.dawn /
      (this.timeMix.dawn + this.timeMix.day + this.timeMix.dusk + this.timeMix.night || 1);
    return dawnish*0.95 + state.wx.haze*0.45;
  }

  updateWaterMist(dt) {
    if (this.mistAmt() < 0.02) return;
    this.mistX = (this.mistX || 0) + dt*0.004;
  }

  drawWaterMist(c, W, H, night) {
    const a = this.mistAmt();
    if (a < 0.02) return;
    const wy = this.waterY*H, by = this.bankY*H;
    for (let k = 0; k < 3; k++) {
      const band = wy + (by - wy)*(0.04 + k*0.19);
      const h = (by - wy)*(0.2 + k*0.06);
      const drift = Math.sin(this.mistX*6 + k*2)*W*0.05;
      const g = c.createLinearGradient(0, band - h, 0, band + h);
      g.addColorStop(0, `rgba(${this.tok.fogRGB}, 0)`);
      g.addColorStop(0.5, `rgba(${this.tok.fogRGB}, ${a*(0.42 - k*0.09)})`);
      g.addColorStop(1, `rgba(${this.tok.fogRGB}, 0)`);
      c.fillStyle = g;
      c.fillRect(-W*0.1 + drift, band - h, W*1.2, h*2);
    }
  }

  drawCity(c, W, H, dt, bot, night) {
    this.drawSkyBirds(c, W, H, bot, night);
    const groundY = H * CITY_GROUND;
    c.fillStyle = css(mix(this.tok.ink, bot, 0.42));
    for (const b of this.backBlocks) {
      c.fillRect(b.x*W, groundY - (b.h + 0.18)*H, b.w*W, (b.h + 0.18)*H);
    }
    // The air between the two skylines, so the near blocks come forward off
    // the far ones instead of sitting in the same plane.
    this.distanceHaze(c, W, H, 0.30, 0.98, 0.115*(1 - night*0.5));
    const frontColor = mix(this.tok.inkDeep, bot, 0.10);
    const frontStr = css(frontColor);
    c.fillStyle = frontStr;
    for (const b of this.frontBlocks) {
      const bx = b.x*W, bw = b.w*W, bh = b.h*H, byTop = groundY - bh;
      c.fillRect(bx, byTop, bw, bh);
      if (b.antenna) {
        c.strokeStyle = frontStr; c.lineWidth = 1.2;
        c.beginPath(); c.moveTo(bx + bw*0.5, byTop); c.lineTo(bx + bw*0.5, byTop - H*0.035); c.stroke();
      }
      this.drawRoofFeature(c, b, W, H, groundY, frontStr);
    }
    // daytime window grids — faint, so the fronts aren't blank slabs
    if (night < 0.7) {
      c.fillStyle = css(mix(frontColor, this.tok.inkDeep, 0.55));
      c.globalAlpha = (1 - night)*0.5;
      for (const b of this.frontBlocks) {
        const bx = b.x*W, bw = b.w*W, bh = b.h*H, byTop = groundY - bh;
        if (bw < 26) continue;
        const cols = b.cols, rows = Math.max(2, Math.floor(bh/24));
        const mx = bw*0.18, my = 10;
        const gapx = (bw - mx*2)/cols, gapy = (bh - my*1.6)/rows;
        // taller than wide, as a window is, and sized to the building
        const wW = Math.max(2, Math.min(gapx*0.52, bw*0.11, 7));
        const wH = Math.max(3, Math.min(gapy*0.55, bh*0.045, 10));
        for (let r = 0; r < rows; r++) for (let k = 0; k < cols; k++) {
          c.fillRect(bx + mx + k*gapx, byTop + my + r*gapy, wW, wH);
        }
      }
      c.globalAlpha = 1;
    }
    if (night > 0.12) {
      const fc = this.tok.firefly;
      for (const b of this.frontBlocks) {
        const bx = b.x*W, bw = b.w*W, bh = b.h*H, byTop = groundY - bh;
        /* A lit window is a window, so it is the size of one: scaled to the
           block it is in and to the same grid the dark ones are drawn on.
           Fixed at two and a half pixels by three and a half it was a speck on
           a tower and a slab on a low roof, and it never lined up with
           anything. */
        const wW = Math.max(2, Math.min(bw*0.11, 7));
        const wH = Math.max(3, Math.min(bh*0.045, 10));
        for (const wnd of b.lit) {
          // somebody comes home, somebody goes to bed — see updateCityWindows
          const lvl = (wnd.on ? wnd.fade : 1 - wnd.fade);
          if (lvl < 0.02) continue;
          const flick = wnd.flicker ? 0.75 + 0.25*Math.sin(this.t*3.1 + wnd.ph) : 1;
          c.fillStyle = `rgba(${fc[0]|0},${fc[1]|0},${fc[2]|0},${0.55 * night * lvl * flick})`;
          c.fillRect(bx + wnd.u*bw, byTop + wnd.v*bh, wW, wH);
        }
      }
    }
    // steam standing off a rooftop vent, leaning with the wind — the same
    // gust the grass elsewhere is answering, so the whole frame agrees
    const wv = this.windAmt();
    const shear = 0.3 + this.windBend(0.5)*1.7;
    for (const b of this.frontBlocks) {
      if (!b.vent) continue;
      const bx = b.x*W, bw = b.w*W, byTop = groundY - b.h*H;
      const vx = bx + b.vent.u*bw;
      c.fillStyle = `rgba(${this.tok.cloudRGB}, 1)`;
      // Eight of them, close enough together that the column reads as steam
      // rather than as a string of beads.
      for (let k = 0; k < 8; k++) {
        // A puff leaves the vent quickly while it is hot, slows as it cools
        // and mixes, spreads as it slows, and shears off downwind as it goes.
        const age = ((this.t*0.16 + b.vent.ph + k/8) % 1);
        const pl = gaitPose("plume", age);
        const a = Math.max(0, pl.fade)*0.15*(0.5 + wv);
        if (a < 0.01) continue;
        c.globalAlpha = a;
        c.beginPath();
        c.arc(vx + Math.sin(age*2.2 + b.vent.ph)*3 + shear*pl.spread*30,
          byTop - 3 - pl.rise*H*0.13, 3 + pl.spread*11, 0, Math.PI*2);
        c.fill();
      }
      c.globalAlpha = 1;
      c.fillStyle = css(mix(this.tok.inkDeep, bot, 0.16));
      c.fillRect(vx - 3, byTop - 5, 6, 5);
    }
    /* The road. Darker than it was, and it has to be: it is the only surface
       in the piece that anything stands on which is *not* lit from above, and
       at a tenth of the way to the sky it came out the same value as the
       animals standing on it. Two shades of pavement — the carriageway and a
       paler pavement at the back — give the street a near and a far as well,
       which is what stops it reading as a black bar. */
    c.fillStyle = css(mix(this.tok.inkDeep, bot, 0.04));
    c.fillRect(0, groundY, W, H - groundY);
    c.fillStyle = css(mix(this.tok.inkDeep, bot, 0.13));
    c.fillRect(0, groundY, W, Math.max(2, (H - groundY)*0.30));
    // street lamps warming the pavement after dark
    if (night > 0.2 && this.streetlamps) {
      const fcs = this.tok.fireflyRGB;
      const postCol = css(mix(this.tok.inkDeep, bot, 0.22));
      for (const L of this.streetlamps) {
        const lx = L.x*W, flick = 0.8 + 0.2*Math.sin(this.t*0.7 + L.ph);
        this.drawGlow(c, fcs, lx, groundY, 24, 24, 0.38*night*flick);
        c.strokeStyle = postCol; c.lineWidth = 1.4; c.lineCap = "round";
        c.beginPath(); c.moveTo(lx, groundY + 2); c.lineTo(lx, groundY - 11); c.stroke();
        c.fillStyle = `rgba(${fcs},${0.75*night*flick})`;
        c.beginPath(); c.arc(lx, groundY - 12, 1.7, 0, Math.PI*2); c.fill();
      }
    }
  }

  drawRoofFeature(c, b, W, H, groundY, color) {
    if (!b.roof || b.roof === "none") return;
    const bx = b.x*W, bw = b.w*W, bh = b.h*H, byTop = groundY - bh;
    const rx = bx + b.roofU*bw;
    c.fillStyle = color; c.strokeStyle = color; c.lineCap = "round";
    if (b.roof === "tower") {
      const tw = Math.min(bw*0.3, 15), th = tw*0.95;
      c.lineWidth = 1.4;
      c.beginPath();
      c.moveTo(rx - tw*0.4, byTop); c.lineTo(rx - tw*0.28, byTop - th*0.7);
      c.moveTo(rx + tw*0.4, byTop); c.lineTo(rx + tw*0.28, byTop - th*0.7);
      c.stroke();
      c.fillRect(rx - tw*0.5, byTop - th*1.15, tw, th*0.5);
      c.beginPath();
      c.moveTo(rx - tw*0.5, byTop - th*1.15); c.lineTo(rx, byTop - th*1.45); c.lineTo(rx + tw*0.5, byTop - th*1.15);
      c.closePath(); c.fill();
    } else if (b.roof === "chimney") {
      const cw = Math.max(3, bw*0.09), ch = Math.min(bh*0.3, 17);
      c.fillRect(rx, byTop - ch, cw, ch);
      c.save(); c.fillStyle = `rgba(${this.tok.cloudRGB}, 1)`;
      /* Six puffs a sixth of a life apart, so one is always leaving the stack
         while another is thinning out at the top: the column is continuous,
         and no puff ever snaps back to the chimney still visible. */
      const shear = 0.3 + this.windBend(b.x)*1.7;
      for (let i = 0; i < 6; i++) {
        const age = ((this.t*0.26 + b.smoke + i/6) % 1);
        const pl = gaitPose("plume", age);
        const a = Math.max(0, pl.fade)*0.17;
        if (a < 0.008) continue;
        c.globalAlpha = a;
        const sy = byTop - ch - 3 - pl.rise*38;
        const sx = rx + cw*0.5 + Math.sin(age*2.4 + b.smoke)*2.4 + shear*pl.spread*24;
        c.beginPath(); c.arc(sx, sy, 2.2 + pl.spread*8, 0, Math.PI*2); c.fill();
      }
      c.restore();
    } else if (b.roof === "box") {
      const boxw = Math.min(bw*0.42, 20), boxh = boxw*0.5;
      c.fillRect(rx - boxw*0.5, byTop - boxh, boxw, boxh);
    } else if (b.roof === "dish") {
      c.lineWidth = 1.4;
      c.beginPath(); c.moveTo(rx, byTop); c.lineTo(rx, byTop - 7); c.stroke();
      c.beginPath(); c.arc(rx, byTop - 8, 4.2, Math.PI*1.12, Math.PI*1.98); c.stroke();
    }
  }

  /* ---- the singers, drawn where they sing ---- */
  /* What each singer on stage decides to do: come in, settle, fidget, sing,
     forage, and leave by whatever means its kind leaves by. Paired with
     drawActors below, which paints whatever survives this. */
  updateActors(dt) {
    /* A departure is measured against the bird's drawn size — how far it crouches
       and how steeply it climbs are both a fraction of a.s in pixels — so this
       pass needs the height of the frame. Same number draw() is handed. */
    const H = this.H;
    for (let i = this.actors.length - 1; i >= 0; i--) {
      const a = this.actors[i];
      a.t += dt;

      // Entrance. A flying bird crosses the open air on a curve, losing speed
      // as it comes in; everything else glides or hops the short way in.
      const px0 = a.x, py0 = a.y;
      if (a.enter > 0 && a.t < a.enter) {
        const k = a.t / a.enter;
        if (a.flightIn) {
          const ex = 1 - Math.pow(1 - k, 2.4);         // quick out, slow in
          const ey = k*k*(3 - 2*k);
          a.x = a.enterFromX + (a.restX - a.enterFromX)*ex;
          a.y = a.enterFromY + (a.restY - a.enterFromY)*ey - Math.sin(Math.PI*k)*0.035;
          a.alpha = 1;
        } else {
          const e = k*k*(3 - 2*k);                     // smoothstep
          a.x = a.enterFromX + (a.restX - a.enterFromX) * e;
          a.y = a.enterFromY + (a.restY - a.enterFromY) * e;
          // Only the things that are genuinely coming out of somewhere fade up
          // — and there are none left. Everything else arrives at full weight
          // from beyond the edge of the frame, on its own feet or its own
          // wings, because nothing in this piece appears out of nothing.
          if (a.fadeIn) a.alpha = Math.min(1, e * 1.3);
        }
      } else if (a.enter > 0 && !a.leave && (a.alpha < 1 || a.flightIn)) {
        a.x = a.restX; a.y = a.restY; a.alpha = 1;
      }

      const st = a.t - a.singAt;                       // time since the call began
      const singing = st >= 0 && st < a.dur;
      const sungEnd = a.singAt + a.dur;

      if (!a.leave && a.t > sungEnd + a.linger) {
        a.leaveT = 0;
        a.flyDir = a.flip ? -1 : 1;
        a.launchX = a.x; a.launchY = a.y;
        if (a.beh === "perch") {
          // A kingfisher usually leaves its perch straight down into the water.
          a.leave = (a.diver && this.loc === "wetland" && this.waterY && Math.random() < 0.75)
            ? "dive" : "fly";
        } else if (a.beh === "owl") {
          a.leave = "glide";
        } else if (a.beh === "cuckoo") {
          a.leave = "fly";
        } else if (a.beh === "cockerel") {
          a.leave = "sink";
        } else if (a.beh === "pheasant") {
          // Either it walks quietly out of the frame, or it goes up like a
          // firework — which is what a pheasant does when it has had enough.
          a.leave = Math.random() < 0.45 ? "flush" : "walkoff";
        } else if (a.beh === "egret") {
          a.leave = "heronoff";
        } else {
          a.leave = "fade";
        }
      }
      if (a.leave === "dive") {
        // a heartbeat's pause on the perch, then the plunge
        a.leaveT += dt;
        const ft = Math.max(0, a.leaveT - 0.14);
        a.y = a.launchY + ft*ft*2.8;
        if (a.y >= (this.waterY || 0.6) + 0.05) {
          this.fishRise(a.x);
          this.actors.splice(i, 1); continue;
        }
      } else if (a.leave === "fly") {
        // A real departure: gather, spring, then climb away on beating wings
        // and out over the edge of the frame — not a dissolve in mid-air.
        a.leaveT += dt;
        const crouch = 0.16;
        if (a.leaveT < crouch) {
          a.y = a.launchY + (a.s/H)*0.16*(a.leaveT/crouch);
        } else {
          const ft = a.leaveT - crouch;
          a.y = a.launchY - (a.s/H)*0.16 - (0.10*ft + 0.19*ft*ft);
          a.x = a.launchX + a.flyDir*(0.26*ft + 0.38*ft*ft);
        }
        if (a.y < -0.16 || a.x < -0.2 || a.x > 1.2) { this.actors.splice(i, 1); continue; }
      } else if (a.leave === "glide") {
        // An owl does not spring off a branch. It tips forward, drops, and
        // rows away low and level, out over the edge of the frame.
        a.leaveT += dt;
        const ft = a.leaveT;
        a.y = a.launchY + Math.min(0.028, ft*0.10) - 0.030*ft*ft;
        a.x = a.launchX + a.flyDir*(0.16*ft + 0.13*ft*ft);
        if (a.y < -0.16 || a.x < -0.2 || a.x > 1.2) { this.actors.splice(i, 1); continue; }
      } else if (a.leave === "flush") {
        // Straight up out of the grass on clattering wings, then away low.
        a.leaveT += dt;
        const ft = a.leaveT;
        if (ft < 0.18) {
          a.y = a.launchY + (a.s/H)*0.3*(ft/0.18);
        } else {
          const u = ft - 0.18;
          a.y = a.launchY - (0.24*u + 0.10*u*u);
          a.x = a.launchX + a.flyDir*(0.05*u + 0.16*u*u);
        }
        if (a.y < -0.16 || a.x < -0.2 || a.x > 1.2) { this.actors.splice(i, 1); continue; }
      } else if (a.leave === "walkoff") {
        a.x += a.flyDir * 0.055 * dt;
        if (a.x < -0.12 || a.x > 1.12) { this.actors.splice(i, 1); continue; }
      } else if (a.leave === "heronoff") {
        // Heavy and unhurried: a step, a heave, then a slow climb away.
        a.leaveT += dt;
        const ft = Math.max(0, a.leaveT - 0.5);
        a.y = a.launchY - (0.06*ft + 0.03*ft*ft);
        a.x = a.launchX + a.flyDir*(0.06*ft + 0.03*ft*ft);
        if (a.y < -0.14 || a.x < -0.2 || a.x > 1.2) { this.actors.splice(i, 1); continue; }
      } else if (a.leave === "sink") {
        // Back down the far side of the hill, out of sight behind the brow.
        a.leaveT += dt;
        a.y = a.launchY + a.leaveT*0.05;
        a.x = a.launchX - a.flyDir*0.008*a.leaveT;
        if (a.y > a.launchY + 0.06) { this.actors.splice(i, 1); continue; }
      } else if (a.leave === "fade") {
        a.alpha -= dt * 1.3;
        a.x += (a.flip ? 1 : -1) * 0.012 * dt;         // drift off rather than dissolve in place
        if (a.alpha <= 0) { this.actors.splice(i, 1); continue; }
      }
      if (a.beh === "wader" && a.t > sungEnd) {
        a.x += a.data.dir * 0.015 * dt;
        if (a.x < -0.05 || a.x > 1.05) { this.actors.splice(i, 1); continue; }
      }
      if (a.beh === "duck" && a.t > a.enter) a.x += a.data.dir * 0.006 * dt;
      if (a.beh === "pheasant" && a.t > sungEnd && !a.leave) {
        a.x += (a.flip ? -1 : 1) * 0.012 * dt;
        if (a.x < -0.08 || a.x > 1.08) { this.actors.splice(i, 1); continue; }
      }
      if (a.beh === "cockerel" && !a.leave && a.t > sungEnd) {
        a.x += (a.flip ? -1 : 1) * 0.004 * dt;         // a slow patrol of the skyline
        if (a.ridgeY !== null && this.hillA) a.y = this.hillA(a.x) - 0.002;
        a.restX = a.x; a.restY = a.y;
      }

      // Life on the ground. A bird that has finished singing from a stone or a
      // tussock does not sit there like an ornament: it takes a few steps, has
      // a look round, and works the turf for something to eat.
      this.forage(a, dt, singing);

      // Idle gestures — preening, a wing-stretch, a little hop-and-turn —
      // each scheduled at the bird's own tempo, so no two fidget alike.
      const iv0 = a.ivar || {};
      const singingNow = a.t - a.singAt >= 0 && a.t - a.singAt < a.dur;
      if (a.beh === "perch" && !a.leave && !singingNow && a.t > a.enter + 0.6) {
        if (a.nextGest === undefined) a.nextGest = a.t + 1.5 + Math.random()*(iv0.lookEvery || 3);
        if (!a.gest && a.t >= a.nextGest) {
          // preening, a wing stretched, a hop about-face, feathers fluffed
          // out, or a long look at something only it can see
          a.gest = ["preen", "stretch", "hop", "fluff", "peer", "preen", "fluff"]
            [Math.floor(Math.random()*7)];
          a.gestT = 0;
          a.gestDur = a.gest === "hop" ? 0.35
            : a.gest === "fluff" ? 0.7 + Math.random()*0.6
            : a.gest === "peer" ? 1.2 + Math.random()*1.4
            : 0.9 + Math.random()*0.5;
        }
      }
      if (a.gest) {
        a.gestT += dt;
        if (a.gest === "hop" && !a.gestFlip && a.gestT > a.gestDur*0.5) {
          a.flip = !a.flip; a.gestFlip = true;
        }
        if (a.gestT >= a.gestDur || singingNow || a.leave) {
          a.gest = null; a.gestFlip = false;
          a.nextGest = a.t + 2.5 + Math.random()*(iv0.lookEvery || 3)*1.6;
        }
      }

      /* The pitch a bird settles into on the way in or out is smoothed, so it
         is state and belongs here. It is the one thing in the old body that sat
         among the derived values and still had to move: px0/py0 are captured at
         the top of this loop and read only here, so with this they never cross
         into the painting at all. W and H come off the scene because the angle
         is measured in pixels, and so depends on the shape of the frame. */
      const inK0 = (a.flightIn && a.enter > 0 && a.t < a.enter) ? a.t/a.enter : -1;
      const flyProg0 = a.leave === "fly" ? Math.max(0, Math.min(1, (a.leaveT - 0.16)/0.14)) : 0;
      if (inK0 >= 0 || flyProg0 > 0) {
        const vx = (a.x - px0), vy = (a.y - py0);
        if (Math.abs(vx) > 1e-6 || Math.abs(vy) > 1e-6) {
          const ang = Math.atan2(vy*this.H, Math.max(1e-4, Math.abs(vx*this.W)));
          a.pitch = (a.pitch === undefined ? ang : a.pitch + (ang - a.pitch)*Math.min(1, dt*8));
        }
      }
    }
  }

  /* …and how it looks doing it. Paired with updateActors above; every value
     below is derived afresh from the state that pass left behind. */
  drawActors(c, W, H, bot, night) {
    for (let i = this.actors.length - 1; i >= 0; i--) {
      const a = this.actors[i];
      // Where the bird is in its call: how wide the bill is open, and whether it
      // has finished and can get on with something else. Both fall out of the
      // song's start and length, so they are worked out again here rather than
      // carried over from the pass that moved it.
      const st = a.t - a.singAt;
      const sing = (st >= 0 && st < a.dur)
        ? ANIM.singBase + ANIM.singAmt*gaitPose("song", st*ANIM.singRate*TURN).gape : 0;
      const sungEnd = a.singAt + a.dur;
      const col = mix(this.tok.inkDeep, bot, a.depthMix);
      const colStr = css([col[0], col[1], col[2], 1]);
      const rimStr = css(mix(col, bot, 0.6));            // a touch lighter, for rim/eye
      const deepStr = css(mix(this.tok.inkDeep, bot, Math.max(0.02, a.depthMix - 0.10)));
      /* The wind gets the birds too.

         `windBend` is read eighteen times in this file — by the grass, the
         hedgerow, the reeds, the trees, the clouds, the smoke and the rain —
         and until now by nothing that was alive. A gust would cross the frame,
         the grass would lie over, and the bird standing in it would not move.

         A bird on a twig is sitting on the end of a lever that is being
         pushed about, so it goes where the twig goes and the twig goes with
         it; one on the ground is barely touched. And in a gust a bird fluffs
         — it is the same reflex as fluffing in the cold, and it is the thing
         you actually see from a window. */
      const exposure = a.ground ? 0.10 : 1;
      const bend = this.windBend(a.x) * exposure;
      const swayX = bend * a.s * 0.15;
      const swayY = -Math.abs(bend) * a.s * 0.045;
      const ruffle = Math.max(0, bend) * 0.12;
      const x = a.x*W + swayX, y = a.y*H + swayY;

      // Idle life: breathing, the odd glance and tail-flick, a wing-settle on arrival.
      const iv = a.ivar || {};
      const settled = a.enter > 0 ? Math.max(0, a.t - a.enter) : a.t;
      // Rates and depths live in ANIM (species.js), which the bestiary reads too,
      // so the window and the cards cannot drift apart.
      const breath = Math.sin(a.t*ANIM.breathRate + (iv.breathPh || 0));
      // Birds do not sweep their heads, they snap: `glance` holds a station
      // dead still and then jumps to the next. Over the top of it the old long
      // look, which was already a burst rather than a swing.
      const headTurn = gaitAt("glance", (a.t*ANIM.headRate + (iv.headPh || 0))*TURN, "turn")*ANIM.headAmt
                     + Math.pow(Math.max(0, Math.sin(a.t*ANIM.lookRate + (iv.headPh || 0)*1.7)), ANIM.lookSharp) * ANIM.lookAmt;
      const tailFlick = Math.pow(Math.max(0, Math.sin(a.t*ANIM.tailRate + (iv.tailPh || 0))), ANIM.tailSharp);
      const wingSettle = Math.max(0, 1 - settled/ANIM.settle);
      const hopBob = (a.enter > 0 && a.t < a.enter && a.beh === "perch")
        ? gaitPose("birdHop", a.t*13*TURN).rise * a.s * 0.12 : 0;
      // Departure: 0 while perched, ramping to 1 once the bird springs into flight.
      const flyProg = a.leave === "fly" ? Math.max(0, Math.min(1, (a.leaveT - 0.16)/0.14)) : 0;
      const flyBeat = flyProg > 0 ? gaitPose("beatQuick", a.leaveT*21*TURN) : null;
      // Arrival: wings out and beating all the way in, then held high and
      // forward for the flare that kills the last of the speed.
      const inK = (a.flightIn && a.enter > 0 && a.t < a.enter) ? a.t/a.enter : -1;
      const flare = inK >= 0 ? Math.pow(Math.max(0, inK - 0.7)/0.3, 1.4) : 0;
      const flyIn = inK >= 0 ? Math.max(0, 1 - Math.pow(Math.max(0, inK - 0.86)/0.14, 2)) : 0;
      const inBeat = inK >= 0 && flare <= 0.15 ? gaitPose("beatQuick", a.t*23*TURN) : null;
      const flapIn = inK >= 0 ? (inBeat ? inBeat.beat : 0.55 + flare*0.45) : 0;
      // The body follows its own path: nose down on the descent, up in the
      // flare, up again on the climb out.
      let bodyRot = 0;
      if (inK >= 0 || flyProg > 0) {
        // a.pitch is smoothed in updateActors; here it is only read.
        bodyRot = Math.max(-0.55, Math.min(0.55, (a.pitch || 0)*0.75)) - flare*0.42;
        if (a.flip) bodyRot = -bodyRot;
      }
      // The perch twig belongs in the scene: draw it at the resting spot, and only
      // once the bird has landed — never trailing from its feet as it flies in/out.
      const landed = a.enter > 0 ? Math.max(0, Math.min(1, (a.t - a.enter)/0.2)) : 1;

      // On the ground: a hopper leaves the turf between steps, a walker keeps
      // its feet down and swings its legs instead — and bobs its head, which
      // `strut` carries and paintBird reads.
      const stepping = a.ground && a.act === "step";
      const bhop = stepping && !a.walks ? gaitPose("birdHop", (a.hopPh || 0)*TURN) : null;
      const hopStep = bhop ? Math.max(0, bhop.rise) : 0;
      const stride = stepping && a.walks ? a.stridePh : 0;

      /* The pool a bird stands in. Every four-footed thing in the frame has
         had one of these since the beginning; not one bird did, and a bird
         on the ground without a shadow floats a pixel above it.

         Only the ones actually on the ground get one: a bird on a twig six
         feet up casts its shadow somewhere else entirely, and a dark ellipse
         under a perched bird's feet in mid-air is worse than none at all. It
         shrinks and fades as the bird leaves the ground — on a hop, on the
         spring into flight — which is most of what says the feet were really
         touching it. */
      const onGround = a.ground || a.beh === "wader" || a.beh === "duck"
        || a.beh === "frog" || a.beh === "pheasant" || a.beh === "egret"
        || a.beh === "cockerel";
      if (onGround && a.alpha > 0.05 && !a.flightIn) {
        const air = Math.max(flyProg, flyIn);
        const lift = (hopBob + hopStep*a.s*0.45) / Math.max(1, a.s*0.5);
        const off = Math.max(0, 1 - lift) * (1 - air);
        const fx = (a.ground ? a.x : a.restX)*W + swayX;
        const fy = a.restY*H + swayY;
        this.contactShadow(c, fx, fy + a.s*0.05, a.s*0.40*(0.75 + off*0.25),
          0.19 * a.alpha * off);
        /* And what it is standing in, if it is standing in anything. How much
           there is to reflect is how much of the bird is above the water: an
           egret on its legs throws a long one, and a duck — which is sitting
           *in* the water rather than above it — throws almost none. */
        const stands = a.beh === "egret" ? 1.15 : a.beh === "wader" ? 0.95
          : a.beh === "duck" ? 0.22 : a.beh === "frog" ? 0.3 : 0.7;
        this.waterReflection(c, fx, fy, a.s*0.55, a.s*1.5*stands, col,
          a.alpha * off * 0.55);
      }

      switch (a.beh) {
        case "perch": {
          const ps = PSTYLE[a.id] || {};
          // the twig bends with the bird on it, not underneath a bird that
          // has been blown off it
          this.drawPerchFooting(c, (a.ground ? a.x : a.restX)*W + swayX,
            a.restY*H + swayY, a.s,
            a.perchType, bot, a.alpha * landed * (1 - flyProg));
          const hopG = a.gest === "hop"
            ? gaitPose("birdHop", a.gestT/a.gestDur).rise*a.s*0.22 : 0;
          const gk = a.gest ? Math.sin(Math.PI*Math.min(1, a.gestT/a.gestDur)) : 0;
          const fluffG = a.gest === "fluff" ? gk : 0;
          const peerG = a.gest === "peer" ? gk : 0;
          const diveRot = a.leave === "dive" ? Math.min(1.35, a.leaveT*3) : 0;
          const rot = diveRot ? (a.flip ? -diveRot : diveRot) : bodyRot;
          if (rot) { c.save(); c.translate(x, y); c.rotate(rot); }
          this.paintBird(c, {
            x: rot ? 0 : x, y: (rot ? 0 : y) - hopBob - hopG - hopStep*a.s*0.45,
            s: a.s*(ps.sc || 1), flip: a.flip, alpha: a.alpha,
            color: colStr, rim: rimStr, deep: deepStr, marks: ps,
            plump: (ps.plump || 1) * (iv.puff || 1) * (1 + fluffG*0.24 + ruffle),
            tailLen: (ps.tail || 1.1) * (iv.tail || 1), tailUp: !!ps.tailUp,
            billLen: ps.bill || 0.45,
            crest: ps.crest || (iv.crest && !ps.tailUp && !ps.cap), rimLight: iv.rim,
            gest: (a.gest === "preen" || a.gest === "stretch") ? a.gest : null,
            gestK: a.gest ? a.gestT/a.gestDur : 0,
            peck: a.peck || 0, gulp: a.gulp || 0,
            legTuck: bhop ? bhop.tuck : 0, hopReach: bhop ? bhop.reach : 0,
            hopTilt: bhop ? bhop.tilt : 0, stride,
            sing, breath, headTurn: headTurn + peerG*0.85, tailFlick, wingSettle,
            fly: diveRot ? 1 : Math.max(flyProg, flyIn),
            flap: diveRot ? -0.4 : (flyIn > 0 ? flapIn : (flyBeat ? flyBeat.beat : 0)),
            wing: diveRot ? null : (flyIn > 0 ? inBeat : flyBeat),
            flare, t: a.t
          });
          if (rot) c.restore();
          break;
        }
        case "egret": {
          const off = a.leave === "heronoff" ? a.leaveT : 0;
          // in on slow wings, legs down at the last moment, and only then
          // standing — the reverse of the heave it leaves on
          const inAir = inK >= 0 && inK < 0.84;
          this.paintHeron(c, { x, y, s: a.s*2.3, dir: a.flip ? -1 : 1,
            flying: off > 0.5 || inAir,
            flap: (off > 0.5 || inAir)
              ? gaitAt("beatSlow", (inAir ? a.t*4.2 : (off - 0.5)*7)*TURN, "beat") : 0,
            crouch: off > 0 ? Math.min(1, off/0.5)
                            : (inK >= 0.84 ? 1 - (inK - 0.84)/0.16 : 0),
            color: colStr, pale: true, t: a.t, sing, alpha: a.alpha });
          break;
        }
        case "pheasant": {
          const flushT = a.leave === "flush" ? a.leaveT : 0;
          this.paintPheasant(c, { x, y, s: a.s*1.5, flip: a.flip,
            alpha: a.alpha, color: colStr, rim: rimStr, deep: deepStr, sing,
            walking: (a.t > sungEnd && !a.leave) || a.leave === "walkoff"
              || a.t < a.enter,
            lp: a.t*(a.leave === "walkoff" ? 9 : 5),
            fly: flushT ? Math.min(1, Math.max(0, (flushT - 0.16)/0.12)) : 0,
            flap: flushT ? gaitAt("beatQuick", flushT*30*TURN, "beat") : 0, t: a.t });
          break;
        }
        case "owl": {
          const gl = a.leave === "glide" ? Math.min(1, a.leaveT/0.35) : 0;
          // rows in low and level, and is on the branch before it stops
          const glIn = inK >= 0 ? Math.max(0, 1 - Math.max(0, inK - 0.70)/0.30) : 0;
          const owlFly = Math.max(gl, glIn);
          this.paintOwl(c, { x, y, s: a.s, alpha: a.alpha, color: colStr, rim: rimStr,
            deep: deepStr, night, t: a.t, headTurn, blinkPh: iv.tailPh || 0,
            breath, fly: owlFly,
            flap: owlFly ? gaitAt("beatSlow", (gl ? a.leaveT*8.5 : a.t*5.5)*TURN, "beat") : 0,
            flip: a.leave ? a.flyDir < 0 : a.flip, settle: wingSettle, sing });
          break;
        }
        case "cuckoo": this.paintCuckoo(c, { x, y, s: a.s, flip: a.flip, alpha: a.alpha,
          color: colStr, rim: rimStr, deep: deepStr, sing, breath, t: a.t,
          fly: flyProg, wing: flyBeat,
          flap: flyBeat ? flyBeat.beat : 0 }); break;
        case "cockerel": {
          // It stands on the skyline, so the hill itself hides it as it goes.
          c.save();
          if (a.ridgeY !== null && a.ridgeY !== undefined) {
            c.beginPath(); c.rect(0, 0, W, a.restY*H + a.s*0.25); c.clip();
          }
          this.paintRooster(c, { x, y, s: a.s, flip: a.flip, alpha: a.alpha,
            color: colStr, rim: rimStr, deep: deepStr, sing, t: a.t,
            walking: !a.leave && a.t > sungEnd, lp: a.t*4 });
          c.restore();
          break;
        }
        case "duck": {
          this.paintDuck(c, {
            x, y: y - gaitAt("paddle", a.t*1.3*TURN, "rock")*1.5, s: a.s,
            flip: a.data.dir < 0, alpha: a.alpha, color: colStr, rim: rimStr, deep: deepStr,
            moorhen: a.data.moorhen, sing, breath, t: a.t });
          for (const d of (a.data.brood || [])) {
            const dx = x - a.data.dir*d.dx*this.W + Math.sin(a.t*d.sp + d.ph)*d.wob*this.W;
            const dy = y + d.dy*this.H
              - gaitAt("paddle", (a.t*1.3 + d.ph)*TURN, "rock")*1.2;
            this.paintDuck(c, { x: dx, y: dy, s: a.s*d.sz,
              flip: a.data.dir < 0, alpha: a.alpha, color: colStr, rim: rimStr,
              deep: deepStr, moorhen: false, sing: 0, breath, t: a.t + d.ph });
          }
          break;
        }
        case "pecker": this.paintWoodpecker(c, { x, y, s: a.s, alpha: a.alpha, color: colStr,
          rim: rimStr, deep: deepStr, sing, t: a.t }); break;
        case "wader": this.paintWader(c, { x, y, s: a.s, flip: a.data.dir < 0,
          alpha: a.alpha, color: colStr, rim: rimStr, deep: deepStr, sing,
          walking: a.t > sungEnd || a.t < a.enter, t: a.t }); break;
        case "frog": {
          // it hops in rather than sliding, which is the only way a frog moves
          const fh = inK >= 0 ? Math.max(0, gaitPose("birdHop", a.t*5.5*TURN).rise) : 0;
          this.paintFrog(c, { x, y: y - fh*a.s*0.9, s: a.s, alpha: a.alpha,
            color: col, bot, sing, breath, t: a.t });
          break;
        }
      }
    }
  }

  /* A ground bird's own business between songs. It takes a few quick steps in
     one direction, stands and looks about, then puts its head down and works
     the turf — a couple of pecks, sometimes three. Hoppers hop (a robin, a
     dunnock, a sparrow); walkers walk (a lapwing, a starling, a pigeon). When
     it has had enough of the ground it springs off as any perched bird does,
     which is the departure the fly branch above already knows how to make. */
  forage(a, dt, singing) {
    if (!a.ground || a.leave) { a.peck = 0; a.gulp = 0; return; }
    if (singing || a.t < a.enter + 0.5) { a.peck = 0; a.gulp = 0; a.act = null; return; }
    if (a.hopPh === undefined) { a.hopPh = 0; a.stridePh = 0; a.peck = 0; a.gulp = 0; }
    if (!a.act || (a.actT += dt) > a.actDur) {
      const roll = Math.random();
      a.act = roll < 0.42 ? "step" : roll < 0.78 ? "peck" : "look";
      a.actT = 0;
      if (a.act === "step") {
        const dir = Math.random() < 0.5 ? -1 : 1;
        a.walkTo = Math.min(0.95, Math.max(0.05, a.x + dir*(0.012 + Math.random()*0.045)));
        a.flip = a.walkTo < a.x;
        a.actDur = 0.4 + Math.random()*0.9;
      } else if (a.act === "peck") {
        a.pecks = 1 + Math.floor(Math.random()*3);
        a.actDur = a.pecks*0.42 + 0.2;
      } else {
        a.actDur = 0.7 + Math.random()*1.4;
      }
    }
    if (a.act === "step") {
      const dx = a.walkTo - a.x;
      const arrived = Math.abs(dx) <= 0.004;
      if (!arrived) {
        const step = (a.walks ? 0.035 : 0.05) * dt;
        a.x += Math.sign(dx) * Math.min(Math.abs(dx), step);
      }
      /* A hop is one whole thing. Arriving used to stop the phase dead, which
         stranded the bird wherever the last frame had left it — often in
         mid-air with its feet tucked up — and held it there, twitching, for
         the rest of the act. So having arrived it finishes the hop it is in,
         crosses the top of the cycle, and only then stands. */
      const TAU = Math.PI*2;
      if (a.walks) {
        const r = dt*9;
        if (!arrived) a.stridePh += r;
        else if (a.stridePh > 0) {
          a.stridePh += r;
          if (a.stridePh % TAU < r) a.stridePh = 0;
        }
      } else {
        const r = dt*11;
        if (!arrived) a.hopPh += r;
        else if (a.hopPh > 0) {
          a.hopPh += r;
          if (a.hopPh % TAU < r) a.hopPh = 0;
        }
      }
      a.peck = 0; a.gulp = 0;
    } else if (a.act === "peck" && a.actT < a.pecks*0.42) {
      // Down fast, a beat on the ground while the thing is actually taken, up,
      // and the head thrown back to send it down — the `peck` frames.
      const pk = gaitPose("peck", (a.actT / 0.42) % 1);
      a.peck = pk.dip;
      a.gulp = pk.gulp;
    } else {
      a.peck = 0; a.gulp = 0;
    }
    a.restX = a.x;                                  // it stands where it has walked to
  }

  /* A little something under the feet so no bird stands on empty air. */
  drawPerchFooting(c, x, y, s, type, bot, alpha) {
    if (!type || type === "post" || type === "roof") return;   // already a solid edge
    c.save();
    c.globalAlpha = alpha;
    c.lineCap = "round";
    if (type === "branch") {
      c.strokeStyle = css(mix(this.tok.inkDeep, bot, 0.06));
      c.lineWidth = Math.max(1.4, s*0.17);
      c.beginPath();
      c.moveTo(x - s*1.4, y + s*0.20);
      c.quadraticCurveTo(x - s*0.2, y + s*0.05, x + s*1.6, y - s*0.18);
      c.stroke();
    } else if (type === "reed") {
      c.strokeStyle = css(mix(this.tok.inkDeep, bot, 0.10));
      c.lineWidth = Math.max(1.2, s*0.11);
      c.beginPath();
      c.moveTo(x + s*0.35, y + s*4.4);
      c.quadraticCurveTo(x + s*0.12, y + s*1.9, x, y + s*0.12);
      c.stroke();
    } else if (type === "ground") {
      c.globalAlpha = alpha*0.26;
      c.fillStyle = css(this.tok.inkDeep);
      c.beginPath(); c.ellipse(x, y + s*0.14, s*0.85, s*0.2, 0, 0, Math.PI*2); c.fill();
    }
    c.restore();
  }

  /* A perched songbird, anchored by its feet at (x, y): one continuous
     body-and-head silhouette with a layered folded wing, a fanned tail and
     gripping toes, over which each species' field marks are painted —
     enough pattern to name the bird from across the room. */
  paintBird(c, o) {
    const s = o.s, plump = o.plump || 1, sing = o.sing || 0;
    const breath = o.breath || 0, fly = o.fly || 0, mk = o.marks || {};
    const deep = o.deep || o.color;
    const peck = o.peck || 0;
    c.save();
    c.translate(o.x, o.y);
    if (o.flip) c.scale(-1, 1);
    // Pecking: the whole bird tips forward over its feet and the head reaches
    // down past them, which is what makes it read as working the turf rather
    // than nodding on the spot.
    // Pitching: forward over its feet at a peck, back on the spring of a hop.
    const pitch = -peck*0.42 - (o.hopTilt || 0)*0.30;
    if (Math.abs(pitch) > 0.002) c.rotate(pitch);
    c.globalAlpha = o.alpha;
    c.fillStyle = o.color; c.strokeStyle = o.color;
    c.lineCap = "round"; c.lineJoin = "round";

    const legLen = s*0.5;
    const brx = s*0.92, bry = s*0.66 * plump * (1 + breath*0.03 + sing*0.04);
    const cy = -(legLen + bry*0.95);
    const ht = o.headTurn || 0;
    const hr = s*0.42 * (mk.smallHead ? 0.86 : 1);
    // Idle gestures — the head reaches back to preen; a wing stretches out.
    const gk = Math.sin(Math.PI*Math.min(1, o.gestK || 0));
    const preen = o.gest === "preen" ? gk : 0;
    const stretch = o.gest === "stretch" ? gk : 0;
    // The walker's head-bob: thrown forward and then held still in the air
    // while the body walks on under it. `wb.head` is the head's place relative
    // to the body, so the hold reads as a slide back and the dart as a jump.
    const wb = o.stride ? gaitPose("strut", o.stride*TURN) : null;
    const gulp = o.gulp || 0;                 // the head thrown back to swallow
    const hx = s*0.58 + ht*s*0.10 - preen*hr*1.1 + peck*s*0.26
             + (wb ? wb.head*s*0.20 : 0) - gulp*s*0.10;
    const hy = cy - bry*0.55 - hr*0.85 - sing*s*0.16 + preen*hr*0.6
             + peck*(bry*0.85 + legLen*0.55) - gulp*s*0.20;

    // Tail — a fan of tapered feathers off the rump; it flicks at rest, fans
    // wide on take-off, and drops hard as an air-brake in the landing flare.
    const flare = o.flare || 0;
    const tAng = (o.tailUp ? -0.9 : 0.34) - (o.tailFlick || 0)*0.5 - fly*0.55 + flare*1.15;
    const tl = (o.tailLen || 1.1)*s*1.15;
    const rtx = -brx*0.72, rty = cy - bry*0.02;
    const spread = 0.12 + fly*0.15 + flare*0.18;
    for (let k = -1; k <= 1; k++) {
      const aa = tAng + k*spread;
      const kl = tl*(1 - Math.abs(k)*(mk.shoulder ? 0.18 : 0.10));
      const tx2 = rtx - Math.cos(aa)*kl, ty2 = rty + Math.sin(aa)*kl;
      this.limb(c, rtx, rty, tx2, ty2, s*0.30, s*0.16);
      c.beginPath(); c.arc(tx2, ty2, s*0.08, 0, Math.PI*2); c.fill();
    }

    // Legs — tarsi with toes that grip. They tuck up as the bird takes wing,
    // swing down and forward with the feet open as it comes in to land, and
    // fold again at the top of a hop. A walker swings them instead.
    const tuck = Math.min(1, Math.max(fly*1.5, o.legTuck || 0)) * (1 - flare*0.95);
    const stride = o.stride || 0;
    // A hopper's feet do not merely tuck: they gather under it and then swing
    // out in front again, which is how it lands ahead of where it left.
    const hopReach = o.hopReach || 0;
    if (tuck < 0.95) {
      const hipY = cy + bry*0.62;
      let li = 0;
      for (const [hpx, fx0] of [[-s*0.02, -s*0.12], [s*0.14, s*0.18]]) {
        let swing = 0, step = 0;
        if (stride) {
          gaitFoot(GAIT.strut, stride*TURN + GAIT.strut.feet[li], FOOT);
          swing = FOOT[0]*s*0.22; step = FOOT[1]*s*0.16;
        }
        li++;
        const fx = fx0 + swing + flare*s*0.5 + hopReach*s*0.16;
        const fy = -tuck*legLen*0.8 - step - flare*s*0.1;
        c.lineWidth = Math.max(1, s*0.085);
        c.beginPath();
        c.moveTo(hpx, hipY);
        c.quadraticCurveTo((hpx + fx)/2 - s*0.05, (hipY + fy)/2, fx, fy);
        c.stroke();
        c.lineWidth = Math.max(0.8, s*0.06);
        c.beginPath();
        c.moveTo(fx, fy); c.quadraticCurveTo(fx + s*0.10, fy + s*0.04, fx + s*0.20, fy + s*0.06);
        c.moveTo(fx, fy); c.quadraticCurveTo(fx + s*0.05, fy + s*0.06, fx + s*0.09, fy + s*0.09);
        c.moveTo(fx, fy); c.lineTo(fx - s*0.13, fy + s*0.07);
        c.stroke();
      }
    }

    // Wings in flight — the far wing first, behind the body. The wing shortens
    // on the recovery and the tip is carried forward through the downstroke,
    // so the tip describes a figure of eight instead of sliding up a line.
    const wg = o.wing || null;
    const flap = wg ? wg.beat : (o.flap || 0);
    const wspan = wg ? wg.span : 1;
    const wswp = wg ? wg.sweep : 0;
    const span = s*(1.7 + 0.5*fly)*(0.72 + 0.28*wspan);
    const wrx = s*0.05, wry = cy - bry*0.35;
    if (fly > 0.03) {
      c.fillStyle = o.rim;
      this.wingBlade(c, wrx - s*0.06, wry, wrx - span*0.48 + wswp*s*0.24,
        wry - span*(0.5*flap) - s*0.30, s*0.5);
      c.fillStyle = o.color;
    }

    // Body and head — one continuous silhouette, crown to tail.
    c.beginPath();
    c.moveTo(-brx*0.82, cy - bry*0.40);
    c.quadraticCurveTo(-brx*0.35, cy - bry*1.04, s*0.10, cy - bry*0.98);
    c.quadraticCurveTo(hx - hr*0.9, cy - bry*0.95, hx - hr*0.72, hy - hr*0.40);
    c.quadraticCurveTo(hx - hr*0.55, hy - hr*1.04, hx + hr*0.06, hy - hr*0.98);
    c.quadraticCurveTo(hx + hr*0.74, hy - hr*0.9, hx + hr*0.90, hy - hr*0.22);
    c.lineTo(hx + hr*0.92, hy + hr*0.16);
    c.quadraticCurveTo(hx + hr*0.62, hy + hr*(1.0 + sing*0.4), brx*0.60, cy + bry*0.38);
    c.quadraticCurveTo(brx*0.30, cy + bry*1.05, -brx*0.10, cy + bry*0.98);
    c.quadraticCurveTo(-brx*0.55, cy + bry*0.86, -brx*0.72, cy + bry*0.40);
    c.lineTo(-brx*0.86, cy + bry*0.02);
    c.closePath();
    c.fill();

    if (fly < 0.4) {
      // Folded wing — a feathered leaf along the flank, lifted just after
      // landing, with its edges lightly etched in.
      const wS = (o.wingSettle || 0)*s*0.45;
      c.fillStyle = deep;
      c.beginPath();
      c.moveTo(s*0.40, cy - bry*0.44 - wS);
      c.quadraticCurveTo(-s*0.20, cy - bry*0.74 - wS, -brx*0.62, cy - bry*0.14 - wS*0.5);
      c.quadraticCurveTo(-brx*1.0, cy + bry*0.16, -brx*1.06, cy + bry*0.34);
      c.quadraticCurveTo(-brx*0.4, cy + bry*0.48, s*0.30, cy + bry*0.22);
      c.closePath(); c.fill();
      c.strokeStyle = o.rim;
      c.lineWidth = Math.max(0.6, s*0.045);
      c.globalAlpha = o.alpha*0.45;
      c.beginPath();
      c.moveTo(-s*0.02, cy - bry*0.34 - wS);
      c.quadraticCurveTo(-brx*0.55, cy - bry*0.02, -brx*0.96, cy + bry*0.28);
      c.moveTo(s*0.14, cy + bry*0.0);
      c.quadraticCurveTo(-brx*0.45, cy + bry*0.2, -brx*0.9, cy + bry*0.34);
      c.stroke();
      c.globalAlpha = o.alpha;
      c.strokeStyle = o.color; c.fillStyle = o.color;
      if (stretch > 0.03) {           // one wing fanned out and down, luxuriously
        c.fillStyle = deep;
        this.wingBlade(c, s*0.28, cy - bry*0.1,
          -s*0.4 - stretch*s*1.0, cy + bry*(0.3 + stretch*0.9), s*0.55*stretch + s*0.1);
        c.fillStyle = o.color;
      }
    } else {
      c.fillStyle = deep;
      this.wingBlade(c, wrx, wry, wrx - span*0.58 + wswp*s*0.30,
        wry - span*(0.68*flap) + s*0.12, s*0.62);
      c.fillStyle = o.color;
    }

    // Field marks.
    if (mk.breast) {          // robin: the warm face-and-breast bib
      c.fillStyle = `rgba(${this.tok.amberRGB}, 0.62)`;
      c.beginPath();
      c.ellipse(s*0.55, cy - bry*0.02, s*0.40, bry*0.66, -0.3, 0, Math.PI*2); c.fill();
      c.beginPath(); c.arc(hx + hr*0.3, hy + hr*0.45, hr*0.5, 0, Math.PI*2); c.fill();
    }
    if (mk.cap) {             // crown cap — dark by default, sage for a blue tit
      c.fillStyle = mk.capTone === "sage" ? `rgba(${this.tok.sageRGB}, 0.65)` : deep;
      c.beginPath(); c.ellipse(hx, hy - hr*0.32, hr*0.9, hr*0.55, 0.05, 0, Math.PI*2); c.fill();
    }
    if (mk.cheek) {           // pale cheek under the cap
      c.fillStyle = `rgba(${this.tok.foamRGB}, 0.5)`;
      c.beginPath(); c.ellipse(hx + hr*0.22, hy + hr*0.28, hr*0.42, hr*0.32, 0.2, 0, Math.PI*2); c.fill();
    }
    if (mk.bib) {             // dark bib, chin to chest
      c.fillStyle = deep;
      this.limb(c, hx + hr*0.4, hy + hr*0.7, brx*0.52, cy + bry*0.42, s*0.18, s*0.34);
    }
    if (mk.brow) {            // pale eyebrow stripe
      c.strokeStyle = `rgba(${this.tok.foamRGB}, 0.55)`;
      c.lineWidth = Math.max(0.6, hr*0.10);
      c.beginPath();
      c.moveTo(hx - hr*0.35, hy - hr*0.40);
      c.quadraticCurveTo(hx + hr*0.25, hy - hr*0.52, hx + hr*0.72, hy - hr*0.32);
      c.stroke();
    }
    if (mk.wingbar) {         // a pale bar across the folded wing
      c.strokeStyle = `rgba(${this.tok.foamRGB}, 0.45)`;
      c.lineWidth = Math.max(0.7, s*0.06);
      c.beginPath();
      c.moveTo(s*0.16, cy - bry*0.18);
      c.quadraticCurveTo(-s*0.25, cy - bry*0.05, -brx*0.55, cy + bry*0.14);
      c.stroke();
    }
    if (mk.barring) {         // wren: fine barring over wing and tail
      c.strokeStyle = o.rim;
      c.lineWidth = Math.max(0.5, s*0.04);
      c.globalAlpha = o.alpha*0.5;
      c.beginPath();
      for (let k = 0; k < 3; k++) {
        const bxx = -s*0.15 - k*s*0.22;
        c.moveTo(bxx, cy - bry*0.25 + k*s*0.06);
        c.lineTo(bxx - s*0.1, cy + bry*0.3);
      }
      c.stroke();
      c.globalAlpha = o.alpha;
    }
    if (mk.shoulder) {        // white scapulars
      c.fillStyle = `rgba(${this.tok.foamRGB}, 0.75)`;
      c.beginPath(); c.ellipse(s*0.22, cy - bry*0.30, s*0.34, s*0.22, -0.25, 0, Math.PI*2); c.fill();
    }
    if (mk.belly) {           // white underparts
      c.fillStyle = `rgba(${this.tok.foamRGB}, 0.7)`;
      c.beginPath(); c.ellipse(s*0.10, cy + bry*0.62, s*0.34, s*0.20, 0.1, 0, Math.PI*2); c.fill();
    }
    if (mk.wash) {            // a soft colour wash over breast and flank
      const rgb2 = mk.wash === "sage" ? this.tok.sageRGB : this.tok.amberRGB;
      c.fillStyle = `rgba(${rgb2}, 0.3)`;
      c.beginPath(); c.ellipse(s*0.12, cy + bry*0.28, brx*0.68, bry*0.62, -0.1, 0, Math.PI*2); c.fill();
    }
    if (mk.speckles) {        // thrush and starling spotting
      c.fillStyle = `rgba(${this.tok.foamRGB}, 0.55)`;
      c.beginPath();
      for (const [sx2, sy2] of [[0.55, 0.15], [0.35, 0.45], [0.6, 0.55], [0.15, 0.3],
                                [0.42, 0.78], [0.18, 0.66], [-0.05, 0.5], [0.02, 0.85]]) {
        c.moveTo(brx*sx2, cy + bry*sy2);
        c.arc(brx*sx2, cy + bry*sy2, Math.max(0.6, s*0.05), 0, Math.PI*2);
      }
      c.fill();
    }
    if (mk.face) {            // goldfinch: the warm face blaze
      c.fillStyle = `rgba(${this.tok.amberRGB}, 0.8)`;
      c.beginPath(); c.arc(hx + hr*0.55, hy + hr*0.02, hr*0.46, 0, Math.PI*2); c.fill();
    }
    if (mk.wingPatch) {       // jay: the bright panel on the folded wing
      c.fillStyle = `rgba(${this.tok.foamRGB}, 0.7)`;
      c.beginPath(); c.ellipse(-s*0.12, cy + bry*0.02, s*0.2, s*0.13, 0.3, 0, Math.PI*2); c.fill();
      c.fillStyle = `rgba(${this.tok.sageRGB}, 0.7)`;
      c.beginPath(); c.ellipse(s*0.1, cy - bry*0.12, s*0.16, s*0.1, 0.3, 0, Math.PI*2); c.fill();
    }
    if (mk.collar) {          // collared dove: the thin dark half-ring
      c.strokeStyle = deep;
      c.lineWidth = Math.max(0.8, hr*0.13);
      c.beginPath(); c.arc(hx - hr*0.1, hy + hr*0.55, hr*0.7, Math.PI*0.75, Math.PI*1.25); c.stroke();
    }
    if (mk.tailTone) {        // nightingale: the warm rufous tail
      c.fillStyle = `rgba(${this.tok.amberRGB}, 0.4)`;
      const aa2 = (o.tailUp ? -0.9 : 0.34);
      const mx2 = rtx - Math.cos(aa2)*tl*0.55, my2 = rty + Math.sin(aa2)*tl*0.55;
      c.save(); c.translate(mx2, my2); c.rotate(-aa2);
      c.beginPath(); c.ellipse(0, 0, tl*0.5, s*0.16, 0, 0, Math.PI*2); c.fill();
      c.restore();
    }
    if (mk.neckPatch) {       // wood pigeon: the pale neck blaze
      c.fillStyle = `rgba(${this.tok.foamRGB}, 0.6)`;
      c.beginPath(); c.arc(hx - hr*0.55, hy + hr*0.85, hr*0.26, 0, Math.PI*2); c.fill();
    }
    if (mk.sheen) {           // feral pigeon: an iridescent wash on the neck
      c.fillStyle = `rgba(${this.tok.sageRGB}, 0.45)`;
      c.beginPath(); c.ellipse(hx - hr*0.35, hy + hr*0.9, hr*0.45, hr*0.6, 0.3, 0, Math.PI*2); c.fill();
    }
    if (mk.gloss) {           // corvid gloss caught along the back
      c.strokeStyle = o.rim;
      c.lineWidth = Math.max(0.7, s*0.05);
      c.globalAlpha = o.alpha*0.4;
      c.beginPath();
      c.moveTo(-brx*0.4, cy - bry*0.82);
      c.quadraticCurveTo(s*0.05, cy - bry*1.0, s*0.4, cy - bry*0.72);
      c.stroke();
      c.globalAlpha = o.alpha;
    }
    c.fillStyle = o.color; c.strokeStyle = o.color;

    if (o.crest) {
      c.lineWidth = Math.max(1, s*0.08);
      c.beginPath();
      c.moveTo(hx - hr*0.15, hy - hr*0.88);
      c.quadraticCurveTo(hx - hr*0.5, hy - hr*1.3, hx - hr*0.78, hy - hr*1.42);
      c.moveTo(hx + hr*0.12, hy - hr*0.92);
      c.quadraticCurveTo(hx - hr*0.12, hy - hr*1.38, hx - hr*0.3, hy - hr*1.55);
      c.stroke();
    }

    // Bill — two mandibles hinged at the face, parting to sing; the whole
    // bill turns down into the shoulder as the bird preens.
    const bl = (o.billLen || 0.45)*s*1.5;
    const bd = mk.billDeep ? s*0.15 : s*0.085;
    const bx0 = hx + hr*0.78, gap = sing*0.45;
    if (mk.billTone === "amber") c.fillStyle = `rgba(${this.tok.amberRGB}, 0.95)`;
    c.save();
    c.translate(bx0, hy);
    c.rotate(preen*1.3);
    c.beginPath();
    c.moveTo(0, -bd);
    c.quadraticCurveTo(bl*0.55, -bd*0.85 - gap*bl*0.28, bl, -gap*bl*0.4);
    c.quadraticCurveTo(bl*0.5, -gap*bl*0.08, 0, bd*0.15);
    c.closePath(); c.fill();
    c.beginPath();
    c.moveTo(0, bd*0.2);
    c.quadraticCurveTo(bl*0.5, bd*0.3 + gap*bl*0.4, bl*0.88, gap*bl*0.6);
    c.quadraticCurveTo(bl*0.4, bd*0.8 + gap*bl*0.2, 0, bd*0.85);
    c.closePath(); c.fill();
    c.restore();
    c.fillStyle = o.color;

    // Eye — a lit iris ring around a dark pupil, with a pinprick glint.
    const ex = hx + hr*0.30, ey = hy - hr*0.16;
    if (mk.eyeRing) {
      c.strokeStyle = `rgba(${this.tok.amberRGB}, 0.9)`;
      c.lineWidth = Math.max(0.7, hr*0.11);
      c.beginPath(); c.arc(ex, ey, hr*0.21, 0, Math.PI*2); c.stroke();
    } else {
      c.strokeStyle = o.rim;
      c.lineWidth = Math.max(0.5, hr*0.08);
      c.globalAlpha = o.alpha*0.55;
      c.beginPath(); c.arc(ex, ey, hr*0.20, 0, Math.PI*2); c.stroke();
      c.globalAlpha = o.alpha;
    }
    c.fillStyle = deep;
    c.beginPath(); c.arc(ex, ey, Math.max(0.9, hr*0.15), 0, Math.PI*2); c.fill();
    c.fillStyle = `rgba(${this.tok.foamRGB}, 0.85)`;
    c.beginPath(); c.arc(ex + hr*0.06, ey - hr*0.07, Math.max(0.4, hr*0.05), 0, Math.PI*2); c.fill();
    c.fillStyle = o.color; c.strokeStyle = o.color;

    // The odd individual caught by the light along the breast.
    if (o.rimLight) {
      c.strokeStyle = o.rim;
      c.lineWidth = Math.max(0.7, s*0.05);
      c.globalAlpha = o.alpha*0.6;
      c.beginPath();
      c.moveTo(brx*0.58, cy + bry*0.34);
      c.quadraticCurveTo(brx*0.3, cy + bry*0.95, -brx*0.05, cy + bry*0.92);
      c.stroke();
      c.globalAlpha = o.alpha;
    }
    c.restore();
  }

  /* A tawny owl. Round-headed — the ear-tufts belong to the long-eared, not
     to this bird — and built like a bollard: all head and shoulders over a
     short tail. Perched, it is never quite still: it breathes, weaves its
     head to range a sound, shifts its feet, rouses its feathers, blinks, and
     swells a pale throat as it hoots. It leaves by tipping off the branch, so
     `fly` swings the whole drawing over to the flight form rather than
     dissolving the bird where it sits. */
  paintOwl(c, o) {
    const s = o.s, t = o.t || 0, sing = o.sing || 0;
    const fly = o.fly || 0;
    c.save();
    c.translate(o.x, o.y);
    c.globalAlpha = o.alpha;
    c.fillStyle = o.color; c.strokeStyle = o.color;
    c.lineCap = "round"; c.lineJoin = "round";
    if (fly > 0.02) { this.owlFlight(c, o, fly); c.restore(); return; }

    const breath = o.breath || 0;
    const rouse = Math.pow(Math.max(0, Math.sin(t*0.37 + 1.1)), 22);   // a shake-out
    const shuffle = Math.pow(Math.max(0, Math.sin(t*0.29 + 3.7)), 18); // shifting its feet
    // The head-weave: owls bob and swing to judge a distance, in short bursts.
    const weave = Math.pow(Math.max(0, Math.sin(t*0.21 + 0.6)), 6);
    const bobX = Math.sin(t*3.0)*weave, bobY = Math.sin(t*6.1 + 0.8)*weave;
    const settle = o.settle || 0;

    c.rotate(Math.sin(t*0.6)*0.02 - sing*0.05);   // the slow shift of weight
    const legLen = s*0.20;
    const brx = s*0.66*(1 + rouse*0.10 + settle*0.06);
    const bry = s*0.96*(1 + breath*0.02 + sing*0.03);
    const cy = -(legLen + bry*0.85);

    // Feathered legs down to heavy talons curled over the branch; one foot
    // lifts and re-sets now and then.
    c.lineWidth = Math.max(1, s*0.10);
    for (const sd of [-1, 1]) {
      const lift = sd < 0 ? shuffle*s*0.07 : 0;
      c.beginPath();
      c.moveTo(sd*s*0.17, cy + bry*0.7);
      c.lineTo(sd*s*0.18, -s*0.02 - lift);
      c.stroke();
      c.lineWidth = Math.max(0.8, s*0.06);
      c.beginPath();
      c.moveTo(sd*s*0.18, -s*0.02 - lift);
      c.quadraticCurveTo(sd*s*0.28, s*0.02 - lift, sd*s*0.32, s*0.05 - lift);
      c.moveTo(sd*s*0.18, -s*0.02 - lift);
      c.quadraticCurveTo(sd*s*0.09, s*0.03 - lift, sd*s*0.05, s*0.06 - lift);
      c.stroke();
      c.lineWidth = Math.max(1, s*0.10);
    }

    // Body — heavy shoulders, a soft skirt of flank feathers, and a short
    // square tail hanging just past the perch.
    c.beginPath();
    c.moveTo(-brx*0.98, cy - bry*0.40);
    c.quadraticCurveTo(-brx*1.16, cy + bry*0.06, -brx*0.88, cy + bry*0.48);
    c.quadraticCurveTo(-brx*0.62, cy + bry*0.96, -s*0.13, cy + bry*1.16);
    c.lineTo(s*0.13, cy + bry*1.16);
    c.quadraticCurveTo(brx*0.62, cy + bry*0.96, brx*0.88, cy + bry*0.48);
    c.quadraticCurveTo(brx*1.16, cy + bry*0.06, brx*0.98, cy - bry*0.40);
    c.quadraticCurveTo(brx*0.6, cy - bry*0.86, 0, cy - bry*0.90);
    c.quadraticCurveTo(-brx*0.6, cy - bry*0.86, -brx*0.98, cy - bry*0.40);
    c.closePath(); c.fill();

    // Folded wing edges, and the streaked breast of a tawny.
    c.strokeStyle = o.rim;
    c.lineWidth = Math.max(0.7, s*0.05);
    c.globalAlpha = o.alpha*0.42;
    c.beginPath();
    c.moveTo(-brx*0.80, cy - bry*0.28);
    c.quadraticCurveTo(-brx*0.98, cy + bry*0.32, -brx*0.42, cy + bry*0.94);
    c.moveTo(brx*0.80, cy - bry*0.28);
    c.quadraticCurveTo(brx*0.98, cy + bry*0.32, brx*0.42, cy + bry*0.94);
    for (let k = 0; k < 7; k++) {
      const u = (k % 4)/3 - 0.5, row = Math.floor(k/4);
      const sx2 = u*brx*1.1 + (row ? s*0.09 : -s*0.05);
      const sy2 = cy - bry*0.05 + row*bry*0.30;
      c.moveTo(sx2, sy2); c.lineTo(sx2 + s*0.02, sy2 + s*0.16);
    }
    c.stroke();
    c.globalAlpha = o.alpha;

    // The pale throat, swelling with each hoot.
    if (sing > 0.02) {
      c.fillStyle = `rgba(${this.tok.foamRGB}, ${0.30*sing})`;
      c.beginPath();
      c.ellipse(0, cy - bry*0.52, s*0.20*(0.6 + sing*0.7), s*0.15*(0.6 + sing*0.8),
        0, 0, Math.PI*2);
      c.fill();
      c.fillStyle = o.color;
    }

    // ---- the head, on its own swivel ----
    const turn = Math.max(-1, Math.min(1, o.headTurn || 0));
    const hr = s*0.60;
    c.save();
    c.translate(bobX*s*0.09, cy - bry*0.58 + bobY*s*0.05);
    c.rotate(turn*0.18 + bobX*0.06);
    const off = turn*hr*0.26;                    // the face swings round the skull
    c.fillStyle = o.color;
    c.beginPath();
    c.ellipse(0, 0, hr*1.02, hr*0.96, 0, 0, Math.PI*2);
    c.fill();

    // Facial disc: two shallow bowls meeting over the bill, rimmed darker.
    const eyeDx = hr*0.40, eyeY = hr*0.02, er = hr*0.30;
    c.strokeStyle = o.rim;
    c.lineWidth = Math.max(0.8, s*0.055);
    c.globalAlpha = o.alpha*0.55;
    c.beginPath();
    c.arc(off - eyeDx, eyeY, er*1.45, 0.55, Math.PI*2 - 0.55);
    c.moveTo(off + eyeDx + er*1.45*Math.cos(Math.PI - 0.55),
             eyeY + er*1.45*Math.sin(Math.PI - 0.55));
    c.arc(off + eyeDx, eyeY, er*1.45, Math.PI + 0.55, Math.PI - 0.55);
    c.stroke();
    c.globalAlpha = o.alpha;

    // Eyes — dark, forward-set, catching the light after dark; the blink
    // comes down from above like a shutter.
    const night = o.night || 0;
    // down like a shutter, shut for an instant, opened again more slowly
    const bu = (((t + (o.blinkPh || 0)) % 5.3) - 4.76)/0.40;
    const blink = (bu > 0 && bu < 1) ? gaitAt("blink", bu, "lid") : 0;
    c.fillStyle = o.rim;
    c.beginPath();
    c.arc(off - eyeDx, eyeY, er, 0, Math.PI*2);
    c.arc(off + eyeDx, eyeY, er, 0, Math.PI*2);
    c.fill();
    c.fillStyle = o.deep || o.color;
    c.beginPath();
    c.arc(off - eyeDx, eyeY, er*0.48, 0, Math.PI*2);
    c.arc(off + eyeDx, eyeY, er*0.48, 0, Math.PI*2);
    c.fill();
    if (night > 0.15) {
      const fc = this.tok.firefly;
      c.fillStyle = `rgba(${fc[0]|0},${fc[1]|0},${fc[2]|0},${0.8*night*o.alpha*(1 - blink)})`;
      c.beginPath();
      c.arc(off - eyeDx, eyeY, er*0.52, 0, Math.PI*2);
      c.arc(off + eyeDx, eyeY, er*0.52, 0, Math.PI*2);
      c.fill();
    } else {
      c.fillStyle = `rgba(${this.tok.foamRGB}, 0.85)`;
      c.beginPath();
      c.arc(off - eyeDx + er*0.2, eyeY - er*0.22, er*0.11, 0, Math.PI*2);
      c.arc(off + eyeDx + er*0.2, eyeY - er*0.22, er*0.11, 0, Math.PI*2);
      c.fill();
    }
    if (blink > 0.02) {
      c.fillStyle = o.color;
      c.beginPath();
      c.ellipse(off - eyeDx, eyeY - er*(1 - blink), er*1.08, er*blink*1.15, 0, 0, Math.PI*2);
      c.ellipse(off + eyeDx, eyeY - er*(1 - blink), er*1.08, er*blink*1.15, 0, 0, Math.PI*2);
      c.fill();
    }

    // Hooked bill, half-buried in the disc, opening a crack to hoot.
    c.fillStyle = o.deep || o.color;
    const bg = sing*hr*0.06;
    c.beginPath();
    c.moveTo(off - s*0.07, eyeY + er*0.78);
    c.quadraticCurveTo(off, eyeY + er*0.88, off + s*0.07, eyeY + er*0.78);
    c.quadraticCurveTo(off + s*0.02, eyeY + er*1.40 + bg, off, eyeY + er*1.50 + bg);
    c.quadraticCurveTo(off - s*0.02, eyeY + er*1.40 + bg, off - s*0.07, eyeY + er*0.78);
    c.closePath(); c.fill();
    c.restore();
    c.restore();
  }

  /* The same owl on the wing: broad blunt wings on a long slow beat, head
     pulled down between the shoulders, tail short and fanned. */
  owlFlight(c, o, fly) {
    const s = o.s, k = o.flap || 0;
    c.save();
    if (o.flip) c.scale(-1, 1);
    c.translate(0, -s*0.9);
    c.fillStyle = o.color;
    const A = c.globalAlpha;
    // An owl's wing is short-armed, very broad and blunt at the tip. The far
    // wing sits behind the body and dimmer; the near one rides over it, so the
    // span reads as depth rather than as a flat cross.
    // The wing tips swing through an arc about the shoulders rather than
    // sliding up and down a line, so the wing keeps its length at every point
    // of the beat instead of folding into the body at the bottom of it.
    const th = k*0.95;
    const cth = Math.cos(th), sth = Math.sin(th);
    c.globalAlpha = A*0.5;
    this.wingBlade(c, -s*0.06, -s*0.10,
      -s*(0.22 + 0.95*cth), -s*(0.10 + 0.95*sth), s*0.44);
    c.globalAlpha = A;
    // short square tail, barely clear of the body
    c.beginPath();
    c.moveTo(-s*0.36, -s*0.14);
    c.lineTo(-s*0.80, -s*0.10); c.lineTo(-s*0.82, s*0.22); c.lineTo(-s*0.36, s*0.20);
    c.closePath(); c.fill();
    // body, and the big round head carried out in front of it
    c.beginPath(); c.ellipse(0, 0, s*0.48, s*0.28, 0, 0, Math.PI*2); c.fill();
    c.beginPath(); c.arc(s*0.48, -s*0.08, s*0.30, 0, Math.PI*2); c.fill();
    // the facial disc catches what light there is, even in silhouette
    c.fillStyle = o.rim || o.color;
    c.globalAlpha = A*0.3;
    c.beginPath(); c.ellipse(s*0.56, -s*0.08, s*0.17, s*0.21, 0, 0, Math.PI*2); c.fill();
    c.globalAlpha = A;
    c.fillStyle = o.color;
    this.wingBlade(c, s*0.06, -s*0.08,
      s*(0.26 + 1.12*cth), -s*(0.08 + 1.12*sth), s*0.50);
    c.restore();
  }

  /* A cuckoo — long-tailed and hawk-like, which is the whole point of it: a
     small grey falcon shape on a bare branch, wings drooped below the tail.
     Calling, it drops the wings, cocks and fans the tail and rocks forward
     with each note, which is exactly what a calling cuckoo does. */
  paintCuckoo(c, o) {
    const s = o.s, t = o.t || 0, sing = o.sing || 0, fly = o.fly || 0;
    const deep = o.deep || o.color;
    c.save();
    c.translate(o.x, o.y);
    if (o.flip) c.scale(-1, 1);
    c.globalAlpha = o.alpha;
    c.fillStyle = o.color; c.strokeStyle = o.color;
    c.lineCap = "round"; c.lineJoin = "round";

    if (fly > 0.02) {
      // Low, direct and quick, on shallow beats that never rise above the body.
      const wg = o.wing || null;
      const k = wg ? wg.beat : (o.flap || 0);
      const sp = wg ? 0.76 + 0.24*wg.span : 1, sw = wg ? wg.sweep : 0;
      c.translate(0, -s*0.7);
      const A = c.globalAlpha;
      c.globalAlpha = A*0.6;
      this.wingBlade(c, -s*0.05, -s*0.04, -s*1.05*sp + s*sw*0.16, -s*0.62*k - s*0.20, s*0.30);
      c.globalAlpha = A;
      c.beginPath(); c.ellipse(0, 0, s*0.60, s*0.20, 0, 0, Math.PI*2); c.fill();
      // that long tail streaming out behind, still the giveaway in flight
      c.beginPath();
      c.moveTo(-s*0.45, -s*0.10); c.lineTo(-s*1.62, s*0.02);
      c.lineTo(-s*1.60, s*0.10); c.lineTo(-s*0.45, s*0.14);
      c.closePath(); c.fill();
      c.beginPath(); c.arc(s*0.60, -s*0.06, s*0.19, 0, Math.PI*2); c.fill();
      c.beginPath();
      c.moveTo(s*0.72, -s*0.10); c.lineTo(s*1.02, -s*0.02); c.lineTo(s*0.72, s*0.02);
      c.closePath(); c.fill();
      this.wingBlade(c, s*0.05, -s*0.03, s*1.0*sp + s*sw*0.18, -s*0.78*k - s*0.24, s*0.34);
      c.restore();
      return;
    }

    const rock = sing*0.10;                       // it rocks forward on each note
    c.rotate(-rock);
    const legLen = s*0.28;
    const brx = s*0.86, bry = s*0.46*(1 + (o.breath || 0)*0.03);
    const cy = -(legLen + bry*0.95);
    // short legs
    c.lineWidth = Math.max(1, s*0.08);
    c.beginPath();
    c.moveTo(-s*0.05, cy + bry*0.7); c.lineTo(-s*0.08, 0);
    c.moveTo(s*0.14, cy + bry*0.7);  c.lineTo(s*0.16, 0);
    c.stroke();
    // The long graduated tail, carried low and cocked up and fanned as it calls.
    const fan = 0.10 + sing*0.13;
    const tAng = 0.30 - sing*0.58 - (o.tailFlick || 0)*0.2;
    const tl = s*1.55;
    const rx = -brx*0.68, ry = cy + bry*0.06;
    c.beginPath();
    c.moveTo(rx, ry - s*0.16);
    for (let k = -1; k <= 1; k++) {
      const aa = tAng + k*fan;
      const kl = tl*(1 - Math.abs(k)*0.14);
      c.lineTo(rx - Math.cos(aa)*kl, ry + Math.sin(aa)*kl);
    }
    c.lineTo(rx, ry + s*0.16);
    c.closePath(); c.fill();
    // white tail-spots, the field mark that names it at any distance
    c.fillStyle = `rgba(${this.tok.foamRGB}, 0.6)`;
    for (let k = 1; k <= 3; k++) {
      const d = tl*(0.34 + k*0.2);
      c.beginPath();
      c.arc(rx - Math.cos(tAng)*d, ry + Math.sin(tAng)*d,
        Math.max(0.5, s*0.055), 0, Math.PI*2);
      c.fill();
    }
    c.fillStyle = o.color;
    // Body — long and level, small head, slightly decurved bill.
    const hx = s*0.72, hy = cy - bry*0.72;
    c.beginPath();
    c.moveTo(-brx*0.78, cy - bry*0.22);
    c.quadraticCurveTo(-brx*0.2, cy - bry*1.0, hx - s*0.2, hy + s*0.05);
    c.quadraticCurveTo(hx + s*0.2, hy - s*0.02, hx + s*0.22, hy + s*0.14);
    c.quadraticCurveTo(brx*0.5, cy + bry*0.7, -brx*0.1, cy + bry*0.9);
    c.quadraticCurveTo(-brx*0.6, cy + bry*0.7, -brx*0.78, cy - bry*0.22);
    c.closePath(); c.fill();
    // Drooped wings, carried below the line of the tail.
    c.fillStyle = deep;
    const droop = sing*s*0.14;
    this.wingBlade(c, s*0.24, cy - bry*0.30,
      -brx*0.62, cy + bry*0.62 + droop, s*0.42);
    c.fillStyle = o.color;
    // Barred underparts.
    c.strokeStyle = o.rim;
    c.lineWidth = Math.max(0.5, s*0.045);
    c.globalAlpha = o.alpha*0.5;
    c.beginPath();
    for (let k = 0; k < 4; k++) {
      const bx2 = s*0.08 + k*s*0.16;
      c.moveTo(bx2, cy + bry*0.30); c.lineTo(bx2 - s*0.05, cy + bry*0.82);
    }
    c.stroke();
    c.globalAlpha = o.alpha;
    // Bill, and the yellow eye-ring.
    c.fillStyle = o.color;
    const gap = sing*s*0.09;
    c.beginPath();
    c.moveTo(hx + s*0.16, hy + s*0.04);
    c.quadraticCurveTo(hx + s*0.40, hy + s*0.04, hx + s*0.46, hy + s*0.14);
    c.lineTo(hx + s*0.16, hy + s*0.16 + gap);
    c.closePath(); c.fill();
    c.strokeStyle = `rgba(${this.tok.amberRGB}, 0.85)`;
    c.lineWidth = Math.max(0.6, s*0.05);
    c.beginPath(); c.arc(hx - s*0.02, hy + s*0.05, s*0.09, 0, Math.PI*2); c.stroke();
    c.fillStyle = deep;
    c.beginPath(); c.arc(hx - s*0.02, hy + s*0.05, Math.max(0.5, s*0.045), 0, Math.PI*2); c.fill();
    c.restore();
  }

  /* A farmyard cockerel on the skyline: upright, deep-breasted, a blade of
     sickle tail feathers over the back, comb and wattles at the front. It
     stretches its neck out and up to crow, wings held a little clear of the
     body, and steps along the ridge between crows. */
  paintRooster(c, o) {
    const s = o.s, t = o.t || 0, sing = o.sing || 0;
    c.save();
    c.translate(o.x, o.y);
    if (o.flip) c.scale(-1, 1);
    c.globalAlpha = o.alpha;
    c.fillStyle = o.color; c.strokeStyle = o.color;
    c.lineCap = "round"; c.lineJoin = "round";
    const legLen = s*0.30;
    const brx = s*0.74, bry = s*0.66;
    const cy = -(legLen + bry*0.9);
    // legs, stepping the `strut` along the brow of the hill
    const wk = o.walking ? gaitPose("strut", (o.lp || 0)*TURN) : null;
    c.lineWidth = Math.max(1, s*0.09);
    for (let i = 0; i < 2; i++) {
      let sw = i ? s*0.08 : -s*0.06, lift = 0;
      if (o.walking) {
        gaitFoot(GAIT.strut, (o.lp || 0)*TURN + GAIT.strut.feet[i], FOOT);
        sw = FOOT[0]*s*0.14; lift = FOOT[1]*s*0.10;
      }
      c.beginPath();
      c.moveTo((i ? s*0.10 : -s*0.06), cy + bry*0.72);
      c.lineTo((i ? s*0.10 : -s*0.06) + sw, -lift);
      c.stroke();
    }
    // The sickle tail — a high arc of long feathers off the rump.
    for (let k = 0; k < 3; k++) {
      const spread = 0.22 + k*0.16;
      c.beginPath();
      c.moveTo(-brx*0.7, cy + bry*0.1);
      c.quadraticCurveTo(-brx*(1.5 + k*0.2), cy - bry*(0.9 + k*0.3),
        -brx*(0.6 + k*0.35), cy - bry*(1.7 + k*0.28));
      c.quadraticCurveTo(-brx*(1.1 + k*0.2), cy - bry*(0.7 + k*0.25),
        -brx*(0.55 - spread*0.2), cy + bry*0.32);
      c.closePath(); c.fill();
    }
    // Deep body, breast forward.
    c.beginPath();
    c.moveTo(s*0.5, cy - bry*0.5);
    c.quadraticCurveTo(-s*0.1, cy - bry*0.9, -brx*0.72, cy - bry*0.1);
    c.quadraticCurveTo(-brx*0.85, cy + bry*0.5, -s*0.1, cy + bry*0.86);
    c.quadraticCurveTo(brx*0.7, cy + bry*0.7, s*0.62, cy - bry*0.02);
    c.closePath(); c.fill();
    // Neck and head, thrown up and back to crow.
    const stretch = sing;
    const nx = s*0.46 + stretch*s*0.10;
    const hx = nx + s*0.06 - stretch*s*0.16 + (wk ? wk.head*s*0.08 : 0);
    const hy = cy - bry*(1.35 + stretch*0.75) - (wk ? wk.rise*s*0.03 : 0);
    this.limb(c, s*0.34, cy - bry*0.3, hx, hy, s*0.30, s*0.17);
    c.beginPath(); c.arc(hx, hy, s*0.19, 0, Math.PI*2); c.fill();
    // Comb, wattles and bill — the red of them carried by the amber accent.
    c.fillStyle = `rgba(${this.tok.amberRGB}, 0.85)`;
    c.beginPath();
    c.moveTo(hx - s*0.14, hy - s*0.14);
    for (let k = 0; k < 4; k++) {
      c.quadraticCurveTo(hx - s*0.11 + k*s*0.09, hy - s*0.36,
        hx - s*0.06 + k*s*0.09, hy - s*0.16);
    }
    c.lineTo(hx - s*0.14, hy - s*0.12);
    c.closePath(); c.fill();
    c.beginPath();
    c.ellipse(hx + s*0.02, hy + s*0.24, s*0.07, s*0.13, 0.1, 0, Math.PI*2);
    c.ellipse(hx + s*0.14, hy + s*0.20, s*0.05, s*0.10, 0.2, 0, Math.PI*2);
    c.fill();
    const gap = sing*s*0.10;
    c.beginPath();
    c.moveTo(hx + s*0.15, hy - s*0.05);
    c.lineTo(hx + s*0.40, hy + s*0.02);
    c.lineTo(hx + s*0.15, hy + s*0.08 + gap);
    c.closePath(); c.fill();
    // Hackles down the neck, and an eye.
    c.strokeStyle = o.rim;
    c.lineWidth = Math.max(0.5, s*0.04);
    c.globalAlpha = o.alpha*0.45;
    c.beginPath();
    for (let k = 0; k < 3; k++) {
      const u = 0.3 + k*0.2;
      c.moveTo(hx + (s*0.34 - hx)*u - s*0.1, hy + (cy - bry*0.3 - hy)*u);
      c.lineTo(hx + (s*0.34 - hx)*u - s*0.02, hy + (cy - bry*0.3 - hy)*u + s*0.12);
    }
    c.stroke();
    c.globalAlpha = o.alpha;
    c.fillStyle = o.deep || o.color;
    c.beginPath(); c.arc(hx + s*0.06, hy - s*0.02, Math.max(0.5, s*0.045), 0, Math.PI*2); c.fill();
    c.restore();
  }

  paintDuck(c, o) {
    const s = o.s, sing = o.sing || 0, t = o.t || 0, mh = o.moorhen;
    // between calls the head tips down now and then to dabble at the water
    const dip = (sing > 0.01 || mh) ? 0 : Math.pow(Math.max(0, Math.sin(t*0.7 + 2.1)), 12);
    // Under way it does not glide evenly: a stroke of the feet surges it
    // forward and lifts the chest, and then it coasts and settles back. A
    // moorhen's head jerks right through with every push, a duck's less so.
    const pd = gaitPose("paddle", t*(mh ? 5.5 : 1.3)*TURN);
    const jerk = mh ? Math.max(0, pd.head)*s*0.09 : 0;
    c.save();
    c.translate(o.x, o.y);
    if (o.flip) c.scale(-1, 1);
    c.globalAlpha = o.alpha;
    c.lineCap = "round"; c.lineJoin = "round";
    // wake opening astern
    c.strokeStyle = `rgba(${this.tok.foamRGB}, 0.3)`;
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(-s*1.0, s*0.08); c.quadraticCurveTo(-s*1.7, s*0.14, -s*2.3, s*0.34);
    c.moveTo(-s*0.95, s*0.14); c.quadraticCurveTo(-s*1.55, s*0.28, -s*2.0, s*0.52);
    c.stroke();
    // the hull — full breast, low back, stern rising to a lifted tail,
    // cut off below by the waterline it sits on
    c.fillStyle = o.color; c.strokeStyle = o.color;
    c.beginPath();
    c.moveTo(s*0.95, s*0.06);
    c.quadraticCurveTo(s*1.1, -s*0.3, s*0.62, -s*0.52);
    c.quadraticCurveTo(s*0.05, -s*0.66, -s*0.5, -s*0.5);
    c.quadraticCurveTo(-s*0.85, -s*0.42, -s*1.2, -s*0.62);
    c.quadraticCurveTo(-s*1.05, -s*0.3, -s*0.92, s*0.06);
    c.closePath(); c.fill();
    if (!mh) {
      // the drake's curled tail feather
      c.lineWidth = Math.max(1, s*0.08);
      c.beginPath(); c.arc(-s*1.08, -s*0.66, s*0.11, Math.PI*0.3, Math.PI*1.6); c.stroke();
    } else {
      // the moorhen's white undertail, flirted up with each jerk
      c.fillStyle = `rgba(${this.tok.foamRGB}, 0.7)`;
      c.beginPath();
      c.moveTo(-s*0.95, -s*0.3);
      c.lineTo(-s*1.16, -s*0.56 - jerk*0.4);
      c.lineTo(-s*0.86, -s*0.44);
      c.closePath(); c.fill();
      c.fillStyle = o.color;
    }
    // folded wing panel along the flank
    c.fillStyle = o.deep || o.color;
    c.beginPath(); c.ellipse(-s*0.15, -s*0.34, s*0.56, s*0.2, -0.1, 0, Math.PI*2); c.fill();
    c.strokeStyle = o.rim; c.lineWidth = Math.max(0.6, s*0.05);
    c.globalAlpha = o.alpha*0.5;
    c.beginPath();
    c.moveTo(s*0.35, -s*0.3);
    c.quadraticCurveTo(-s*0.2, -s*0.12, -s*0.68, -s*0.24);
    c.stroke();
    c.globalAlpha = o.alpha;
    // neck and head — rising to quack, tipping forward to dabble
    const hx = s*0.58 + dip*s*0.24 + jerk + pd.surge*s*0.03;
    const hy = -s*1.02 - sing*s*0.28 + dip*s*0.66 - pd.rock*s*0.03;
    c.fillStyle = o.color;
    this.limb(c, s*0.52, -s*0.4, hx, hy, s*(mh ? 0.34 : 0.42), s*(mh ? 0.24 : 0.3));
    c.save();
    c.translate(hx, hy);
    c.rotate(dip*0.9 - sing*0.12);
    c.beginPath(); c.arc(0, -s*0.05, s*(mh ? 0.26 : 0.3), 0, Math.PI*2); c.fill();
    if (mh) {
      // the moorhen's stubby red bill and frontal shield
      c.fillStyle = `rgba(${this.tok.amberRGB}, 0.95)`;
      c.beginPath();
      c.moveTo(s*0.14, -s*0.24);
      c.lineTo(s*0.5, -s*0.02 - sing*s*0.08);
      c.lineTo(s*0.14, s*0.08);
      c.closePath(); c.fill();
      c.beginPath(); c.arc(s*0.12, -s*0.16, s*0.08, 0, Math.PI*2); c.fill();
    } else {
      // the flat spatulate bill, opening to quack
      const g2 = sing*0.35;
      c.beginPath();
      c.moveTo(s*0.22, -s*0.16);
      c.quadraticCurveTo(s*0.62, -s*0.14 - g2*s*0.3, s*0.72, -s*0.02 - g2*s*0.35);
      c.quadraticCurveTo(s*0.6, s*0.02 - g2*s*0.1, s*0.24, 0);
      c.closePath(); c.fill();
      c.beginPath();
      c.moveTo(s*0.24, s*0.02);
      c.quadraticCurveTo(s*0.55, s*0.04 + g2*s*0.25, s*0.66, s*0.08 + g2*s*0.3);
      c.quadraticCurveTo(s*0.45, s*0.14 + g2*s*0.1, s*0.22, s*0.12);
      c.closePath(); c.fill();
      // the drake's bottle-green head
      c.fillStyle = `rgba(${this.tok.sageRGB}, 0.5)`;
      c.beginPath(); c.arc(0, -s*0.05, s*0.3, 0, Math.PI*2); c.fill();
    }
    // eye
    c.fillStyle = o.deep || o.color;
    c.beginPath(); c.arc(s*0.06, -s*0.12, Math.max(0.8, s*0.06), 0, Math.PI*2); c.fill();
    c.fillStyle = `rgba(${this.tok.foamRGB}, 0.85)`;
    c.beginPath(); c.arc(s*0.08, -s*0.15, Math.max(0.4, s*0.03), 0, Math.PI*2); c.fill();
    c.restore();
    if (mh) {
      // the white flank line
      c.strokeStyle = `rgba(${this.tok.foamRGB}, 0.55)`;
      c.lineWidth = Math.max(0.7, s*0.05);
      c.beginPath();
      c.moveTo(s*0.45, -s*0.28);
      c.quadraticCurveTo(-s*0.2, -s*0.1, -s*0.72, -s*0.26);
      c.stroke();
    } else {
      // the white collar just below the green of the head
      const nx = s*0.52 + (hx - s*0.52)*0.72, ny = -s*0.4 + (hy + s*0.4)*0.72;
      c.strokeStyle = `rgba(${this.tok.foamRGB}, 0.6)`;
      c.lineWidth = Math.max(0.8, s*0.06);
      c.beginPath();
      c.moveTo(nx - s*0.15, ny + s*0.02);
      c.quadraticCurveTo(nx, ny + s*0.1, nx + s*0.15, ny + s*0.02);
      c.stroke();
    }
    c.restore();
  }

  paintWoodpecker(c, o) {
    const s = o.s, t = o.t || 0, sing = o.sing || 0;
    // One blow at a time: the head snaps at the wood and comes back off it
    // more slowly, so a roll reads as separate blows and not as a buzz.
    const strike = sing * gaitAt("drum", t*26*TURN, "hit");
    c.save();
    c.translate(o.x, o.y);
    c.globalAlpha = o.alpha;
    c.fillStyle = o.color; c.strokeStyle = o.color;
    c.lineCap = "round"; c.lineJoin = "round";
    // stiff tail feathers pressed to the bark, propping the climb
    for (let k = -1; k <= 1; k++) {
      this.limb(c, -s*0.02, s*0.55, s*0.16 + k*s*0.16, s*1.28 + Math.abs(k)*s*0.06, s*0.2, s*0.1);
    }
    // clinging feet
    c.lineWidth = Math.max(1, s*0.09);
    c.beginPath();
    c.moveTo(s*0.02, s*0.3); c.lineTo(-s*0.22, s*0.16);
    c.moveTo(s*0.06, s*0.42); c.lineTo(-s*0.2, s*0.5);
    c.stroke();
    // body held off the trunk, head thrown back then driven at the wood
    const hx = -s*0.02 - strike*s*0.34, hy = -s*1.1 + strike*s*0.10;
    c.beginPath();
    c.moveTo(s*0.05, s*0.6);
    c.quadraticCurveTo(s*0.62, s*0.2, s*0.55, -s*0.45);
    c.quadraticCurveTo(s*0.5, -s*0.85, hx + s*0.28, hy - s*0.02);
    c.quadraticCurveTo(hx + s*0.3, hy - s*0.38, hx - s*0.02, hy - s*0.36);
    c.quadraticCurveTo(hx - s*0.3, hy - s*0.32, hx - s*0.34, hy - s*0.1);
    c.lineTo(hx - s*0.34, hy + s*0.08);
    c.quadraticCurveTo(hx - s*0.22, hy + s*0.34, 0, -s*0.5);
    c.quadraticCurveTo(-s*0.28, s*0.05, s*0.05, s*0.6);
    c.closePath(); c.fill();
    // the chisel bill
    c.beginPath();
    c.moveTo(hx - s*0.3, hy - s*0.1);
    c.lineTo(hx - s*0.88 - strike*s*0.06, hy);
    c.lineTo(hx - s*0.3, hy + s*0.09);
    c.closePath(); c.fill();
    // great spotted's white shoulder patch and barred wing
    c.fillStyle = `rgba(${this.tok.foamRGB}, 0.6)`;
    c.beginPath(); c.ellipse(s*0.22, -s*0.12, s*0.2, s*0.3, 0.25, 0, Math.PI*2); c.fill();
    c.strokeStyle = o.rim || o.color; c.lineWidth = Math.max(0.5, s*0.045);
    c.globalAlpha = o.alpha*0.55;
    c.beginPath();
    c.moveTo(s*0.4, s*0.05); c.lineTo(s*0.14, s*0.3);
    c.moveTo(s*0.44, s*0.24); c.lineTo(s*0.2, s*0.48);
    c.stroke();
    c.globalAlpha = o.alpha;
    // the red nape flash
    c.fillStyle = `rgba(${this.tok.amberRGB}, 0.9)`;
    c.beginPath(); c.arc(hx + s*0.2, hy - s*0.26, s*0.11, 0, Math.PI*2); c.fill();
    // eye
    c.fillStyle = `rgba(${this.tok.foamRGB}, 0.8)`;
    c.beginPath(); c.arc(hx - s*0.1, hy - s*0.16, Math.max(0.5, s*0.045), 0, Math.PI*2); c.fill();
    c.restore();
  }

  paintWader(c, o) {
    const s = o.s, t = o.t || 0, sing = o.sing || 0;
    c.save();
    c.translate(o.x, o.y);
    if (o.flip) c.scale(-1, 1);
    c.globalAlpha = o.alpha;
    c.fillStyle = o.color; c.strokeStyle = o.color;
    c.lineCap = "round"; c.lineJoin = "round";
    // Walking, it runs the `strut` — the head bobbing with the stride — and
    // now and then the bill goes down into the sand and is worked about there.
    const wk = o.walking ? gaitPose("strut", t*8*TURN) : null;
    const pb = o.walking ? gaitPose("probe", t*1.1*TURN + 0.11) : null;
    const probe = pb ? pb.dip : 0;
    const legLen = s*1.1;
    const brx = s*0.92, bry = s*0.5;
    const cy = -(legLen + bry*0.5);
    // legs — jointed and stepping, the moving foot lifting clear
    let bax = -s*0.08, fax = s*0.3, lift1 = 0, lift2 = 0;
    if (o.walking) {
      gaitFoot(GAIT.strut, t*8*TURN, FOOT);
      bax += FOOT[0]*s*0.22; lift1 = FOOT[1]*s*0.16;
      gaitFoot(GAIT.strut, t*8*TURN + 0.5, FOOT);
      fax += FOOT[0]*s*0.22; lift2 = FOOT[1]*s*0.16;
    }
    this.leg(c, -s*0.06, cy + bry*0.4, bax, -lift1, 0.08, s*0.13, s*0.06);
    this.leg(c, s*0.22, cy + bry*0.4, fax, -lift2, 0.08, s*0.13, s*0.06);
    c.lineWidth = Math.max(0.8, s*0.06);
    c.beginPath();
    c.moveTo(bax, -lift1); c.lineTo(bax + s*0.16, -lift1 + s*0.03);
    c.moveTo(bax, -lift1); c.lineTo(bax - s*0.1, -lift1 + s*0.03);
    c.moveTo(fax, -lift2); c.lineTo(fax + s*0.16, -lift2 + s*0.03);
    c.moveTo(fax, -lift2); c.lineTo(fax - s*0.1, -lift2 + s*0.03);
    c.stroke();
    // body — plump and pied, with a short pointed tail
    c.beginPath();
    c.moveTo(s*0.35, cy - bry*0.8);
    c.quadraticCurveTo(-brx*0.4, cy - bry*0.95, -brx*1.15, cy - bry*0.1);
    c.lineTo(-brx*0.75, cy + bry*0.35);
    c.quadraticCurveTo(-s*0.1, cy + bry*1.05, brx*0.55, cy + bry*0.4);
    c.quadraticCurveTo(brx*0.85, cy, s*0.5, cy - bry*0.5);
    c.closePath(); c.fill();
    // the white underparts
    c.fillStyle = `rgba(${this.tok.foamRGB}, 0.55)`;
    c.beginPath(); c.ellipse(-s*0.1, cy + bry*0.55, brx*0.6, bry*0.42, 0.08, 0, Math.PI*2); c.fill();
    c.fillStyle = o.color;
    // neck and head — thrown up to pipe, dropped to probe, and carried
    // forward-and-held with the stride the rest of the time
    const hx = s*0.6 + probe*s*0.12 + (wk ? wk.head*s*0.10 : 0);
    const hy = cy - bry*1.5 - sing*s*0.26 + probe*s*1.0 - (wk ? wk.rise*s*0.05 : 0);
    this.limb(c, s*0.28, cy - bry*0.4, hx, hy, s*0.4, s*0.26);
    c.beginPath(); c.arc(hx, hy, s*0.28, 0, Math.PI*2); c.fill();
    // the oystercatcher's long orange bill, parting to pipe — and turned in
    // the sand as it works whatever it has found
    const tiltB = probe*1.05 + (pb ? pb.work*0.16 : 0);
    c.save();
    c.translate(hx + s*0.2, hy + s*0.02);
    c.rotate(tiltB);
    c.strokeStyle = `rgba(${this.tok.amberRGB}, 0.95)`;
    c.lineWidth = Math.max(1, s*0.085);
    const gap = sing*0.14;
    c.beginPath();
    c.moveTo(0, -s*0.04 - gap*s*0.3); c.lineTo(s*1.05, s*0.04 - gap*s*0.9);
    c.moveTo(0, s*0.02 + gap*s*0.3);  c.lineTo(s*1.0, s*0.1 + gap*s*0.9);
    c.stroke();
    c.restore();
    // the red-ringed eye
    c.fillStyle = `rgba(${this.tok.amberRGB}, 0.9)`;
    c.beginPath(); c.arc(hx + s*0.06, hy - s*0.08, Math.max(0.8, s*0.07), 0, Math.PI*2); c.fill();
    c.fillStyle = o.deep || o.color;
    c.beginPath(); c.arc(hx + s*0.06, hy - s*0.08, Math.max(0.5, s*0.035), 0, Math.PI*2); c.fill();
    c.restore();
  }

  paintFrog(c, o) {
    const s = o.s, sing = o.sing || 0, t = o.t || 0;
    c.save();
    c.translate(o.x, o.y);
    c.globalAlpha = o.alpha;
    c.scale(1 + sing*0.04, 1 - sing*0.03);       // the body swells into each croak
    const colStr = css([o.color[0], o.color[1], o.color[2], 1]);
    const deep = css(mix(o.color, [0, 0, 0, 1], 0.3));
    const lite = mix(o.color, o.bot, 0.55);
    c.lineCap = "round";
    // the folded hind leg — a great thigh at the rump, its long foot
    // reaching forward along the ground
    c.fillStyle = deep;
    c.beginPath(); c.ellipse(-s*0.5, -s*0.3, s*0.42, s*0.3, 0.5, 0, Math.PI*2); c.fill();
    this.limb(c, -s*0.55, -s*0.12, -s*0.05, -s*0.02, s*0.22, s*0.1);
    c.strokeStyle = deep; c.lineWidth = Math.max(0.8, s*0.07);
    c.beginPath();
    c.moveTo(-s*0.05, -s*0.02); c.lineTo(s*0.28, 0);
    c.moveTo(-s*0.05, -s*0.02); c.lineTo(s*0.2, -s*0.07);
    c.stroke();
    // body — the high arched back dropping to a low snout
    c.fillStyle = colStr;
    c.beginPath();
    c.moveTo(s*0.95, -s*0.02);
    c.quadraticCurveTo(s*0.85, -s*0.3, s*0.52, -s*0.5);
    c.quadraticCurveTo(s*0.05, -s*0.72, -s*0.38, -s*0.76);
    c.quadraticCurveTo(-s*0.85, -s*0.6, -s*0.95, -s*0.24);
    c.quadraticCurveTo(-s*0.98, -s*0.08, -s*0.9, -s*0.02);
    c.lineTo(s*0.95, -s*0.02);
    c.closePath(); c.fill();
    // the eye bumps standing proud of the crown
    c.beginPath();
    c.arc(s*0.22, -s*0.66, s*0.17, 0, Math.PI*2);
    c.arc(s*0.56, -s*0.54, s*0.16, 0, Math.PI*2);
    c.fill();
    // front leg propping the chest
    this.limb(c, s*0.42, -s*0.28, s*0.5, 0, s*0.12, s*0.06);
    c.strokeStyle = colStr; c.lineWidth = Math.max(0.8, s*0.06);
    c.beginPath();
    c.moveTo(s*0.5, 0); c.lineTo(s*0.62, s*0.02);
    c.moveTo(s*0.5, 0); c.lineTo(s*0.42, s*0.03);
    c.stroke();
    // the dorsolateral ridge, lightly caught by the light
    c.strokeStyle = css([lite[0], lite[1], lite[2], 1]);
    c.lineWidth = Math.max(0.6, s*0.05);
    c.globalAlpha = o.alpha*0.6;
    c.beginPath();
    c.moveTo(s*0.45, -s*0.44);
    c.quadraticCurveTo(-s*0.1, -s*0.66, -s*0.7, -s*0.5);
    c.stroke();
    c.globalAlpha = o.alpha;
    // the throat sac, swelling under the chin with each croak
    if (sing > 0.05) {
      c.fillStyle = css([lite[0], lite[1], lite[2], 1]);
      const r = s*0.3*(0.35 + 0.65*sing);
      c.beginPath();
      c.ellipse(s*0.62, -s*0.02, r, r*0.8, 0, 0, Math.PI*2); c.fill();
    }
    // eyes — amber irises with slit pupils, blinking now and then
    const fbu = ((t % 4.1) - 3.70)/0.34;
    const blink = (fbu > 0 && fbu < 1) ? gaitAt("blink", fbu, "lid") : 0;
    c.fillStyle = `rgba(${this.tok.amberRGB}, 0.85)`;
    c.beginPath();
    c.arc(s*0.22, -s*0.68, s*0.1, 0, Math.PI*2);
    c.arc(s*0.56, -s*0.56, s*0.1, 0, Math.PI*2);
    c.fill();
    c.fillStyle = deep;
    c.beginPath();
    c.ellipse(s*0.22, -s*0.68, s*0.08, s*0.03, 0, 0, Math.PI*2);
    c.ellipse(s*0.56, -s*0.56, s*0.08, s*0.03, 0, 0, Math.PI*2);
    c.fill();
    if (blink > 0.02) {
      c.fillStyle = colStr;
      c.beginPath();
      c.arc(s*0.22, -s*0.68, s*0.11*blink, 0, Math.PI*2);
      c.arc(s*0.56, -s*0.56, s*0.11*blink, 0, Math.PI*2);
      c.fill();
    }
    // the wide mouth line
    c.strokeStyle = deep; c.lineWidth = Math.max(0.6, s*0.045);
    c.beginPath();
    c.moveTo(s*0.92, -s*0.1);
    c.quadraticCurveTo(s*0.55, -s*0.04, s*0.2, -s*0.08);
    c.stroke();
    c.restore();
  }

  /* ---- ambient life: the land's own quiet traffic ---- */
  spawnCritters(dt) {
    const m = this.timeMix, total = m.dawn+m.day+m.dusk+m.night || 1;
    const dayish = (m.day + m.dawn*0.7) / total;
    const duskdawn = (m.dawn + m.dusk) / total;
    const night = this.nightness();
    const P = (x) => Math.random() < x*dt;
    const n = (k) => { let c2 = 0; for (const cr of this.critters) if (cr.kind === k) c2++; return c2; };
    // butterflies and bees want it dry and clear to see across
    const calmW = state.wx.wet < 0.15 && state.wx.haze < 0.4;

    if ((this.loc === "meadow" || this.loc === "forest") && dayish > 0.5 && calmW
        && n("butterfly") < (REDUCED ? 1 : 4) && P(0.11)) {
      this.critters.push({ kind: "butterfly", x: Math.random(), y: 0.55 + Math.random()*0.3,
        t: 0, ph: Math.random()*6, drift: (Math.random()-0.5)*0.02, life: 18 + Math.random()*10,
        veer: 0, vx: 0, vy: 0 });
    }
    // bumblebees working the flowers through the warm hours
    if ((this.loc === "meadow" || this.loc === "forest") && dayish > 0.55 && calmW
        && n("bee") < (REDUCED ? 1 : 2) && P(0.06)) {
      this.critters.push({ kind: "bee", x: Math.random(), y: 0.78 + Math.random()*0.1,
        t: 0, ph: Math.random()*6, drift: (Math.random()-0.5)*0.03, life: 9 + Math.random()*8,
        sz: 0.8 + Math.random()*0.5, mode: "hover", timer: 0.5 + Math.random(),
        tx: 0, ty: 0 });
    }
    if (this.loc === "wetland" && dayish > 0.5 && state.wx.wet < 0.2
        && n("dragonfly") < 2 && P(0.05)) {
      this.critters.push({ kind: "dragonfly", x: 0.2 + Math.random()*0.6,
        y: this.waterY - 0.03 - Math.random()*0.1, t: 0, mode: "hover",
        timer: 1 + Math.random(), tx: 0, ty: 0, life: 16 + Math.random()*8 });
    }
    if ((night > 0.35 || duskdawn > 0.6) && state.wx.wet < 0.25 && this.loc !== "beach"
        && n("bat") < (REDUCED ? 1 : 4) && P(0.12)) {
      const sx = Math.random() < 0.5 ? -0.05 : 1.05;
      this.critters.push({ kind: "bat", x: sx, y: 0.12 + Math.random()*0.28, t: 0,
        vx: (sx < 0 ? 1 : -1)*(0.06 + Math.random()*0.05), vy: 0, turn: 0,
        size: 3 + Math.random()*2.6 });
    }
    if (this.loc === "forest" && (duskdawn > 0.5 || night > 0.6) && n("deer") === 0
        && this.t - this.lastDeer > 90 && P(0.03)) {
      this.lastDeer = this.t;
      const dir = Math.random() < 0.5 ? 1 : -1;
      this.critters.push({ kind: "deer", x: dir > 0 ? -0.08 : 1.08, dir,
        ...this.crossing(),
        tx: 0.25 + Math.random()*0.5, state: "enter", t: 0, timer: 0,
        head: 0, cycles: 2 + Math.floor(Math.random()*3), lp: 0, bp: 0,
        sz: 0.85 + Math.random()*0.3,
        /* And a third of the does have a fawn in their tracks. It needs a
           step of depth as well as the lag: at a doe's walking pace two
           seconds of trail is a third of her own length, so on the lag
           alone the fawn is drawn inside her. Half a step off her line puts
           it where you actually see one — at her flank, slightly behind. */
        young: Math.random() < 0.32
          ? [{ lag: 1.5 + Math.random()*0.7, sz: 0.52 + Math.random()*0.08,
               off: (Math.random() < 0.5 ? -1 : 1)*(0.035 + Math.random()*0.03) }] : null });
    }
    if (this.loc === "beach" && night < 0.5 && n("runner") < 4 && P(0.05)) {
      const dir = Math.random() < 0.5 ? 1 : -1;
      this.critters.push({ kind: "runner", x: dir > 0 ? -0.03 : 1.03, dir,
        mode: "dash", timer: 0.4 + Math.random()*0.4, t: 0, ph: 0 });
      // sanderlings keep company — often a second follows the first
      if (Math.random() < 0.4) {
        this.critters.push({ kind: "runner", x: (dir > 0 ? -0.03 : 1.03) - dir*0.04, dir,
          mode: "dash", timer: 0.4 + Math.random()*0.4, t: 0, ph: Math.random()*3 });
      }
    }
    // a red squirrel bounding across the litter, sitting up to nibble
    // grey squirrels are as much a park animal as a wood one
    if ((this.loc === "forest" || this.loc === "city") && dayish > 0.4 && calmW
        && n("squirrel") === 0
        && this.t - this.lastSquirrel > 40 && P(0.03)) {
      this.lastSquirrel = this.t;
      const dir = Math.random() < 0.5 ? 1 : -1;
      this.critters.push({ kind: "squirrel", x: dir > 0 ? -0.05 : 1.05, dir,
        mode: "bound", timer: 0.8 + Math.random()*1.2, t: 0, ph: 0,
        sz: 0.85 + Math.random()*0.35 });
    }
    /* Mobbing. An owl caught out in daylight is not left alone: every small
       bird within earshot goes for it, and they keep at it until it has left
       the wood. It is one of the few things in nature that is genuinely a
       *scene* rather than an animal — nothing here reads unless the two
       parties are drawn as one thing, so they are one creature. */
    if ((this.loc === "forest" || this.loc === "meadow") && dayish > 0.45
        && n("mob") === 0 && this.t - this.lastMob > 130 && P(0.010)) {
      this.lastMob = this.t;
      const dir = Math.random() < 0.5 ? 1 : -1;
      const birds = [];
      const nb = 3 + Math.floor(Math.random()*4);
      for (let i = 0; i < nb; i++) {
        birds.push({ ph: Math.random()*Math.PI*2, sp: 1.3 + Math.random()*1.1,
          r: 0.035 + Math.random()*0.05, ry: 0.5 + Math.random()*0.6,
          dive: Math.random()*4, flap: Math.random()*6 });
      }
      this.critters.push({ kind: "mob", dir, birds, t: 0,
        x: dir > 0 ? -0.14 : 1.14, y: 0.22 + Math.random()*0.22,
        flap: 0, sz: 0.9 + Math.random()*0.25 });
      this.raiseAlarm(dir > 0 ? 0 : 1, "owl");
    }
    /* Sunning. This is the only behaviour in the piece that the *light* asks
       for rather than the hour: a lizard comes out when the sun is actually
       on the ground, so an overcast noon gets nothing and a clear one gets
       one flat against a stone doing nothing at all for a minute — which is
       precisely what a lizard does, and precisely what a scene full of
       ceaseless motion has been missing. */
    if ((this.loc === "meadow" || this.loc === "beach") && n("lizard") === 0
        && (this._lit ? this._lit.str : 0) > 0.62 && dayish > 0.5
        && this.t - this.lastSunner > 55 && P(0.035)) {
      this.lastSunner = this.t;
      this.critters.push({ kind: "lizard", x: 0.1 + Math.random()*0.8,
        z: 0.04 + Math.random()*0.35, dir: Math.random() < 0.5 ? 1 : -1,
        mode: "bask", timer: 4 + Math.random()*10, t: 0, ph: 0, push: 0,
        life: 40 + Math.random()*50, sz: 0.85 + Math.random()*0.35 });
    }
    /* A bird in a puddle. This one exists because the rain already left
       something behind and nothing had ever used it: standing water was
       scenery. It only happens where there is a puddle to stand in, so it is
       weather that puts it on the screen — the surest sign in the piece that
       one system knows about another. */
    if ((this.loc === "meadow" || this.loc === "forest" || this.loc === "city")
        && (this.groundWet || 0) > 0.42 && night < 0.5 && n("bather") === 0
        && this.t - this.lastBather > 40 && P(0.05)) {
      const pud = this.puddles();
      if (pud.length) {
        this.lastBather = this.t;
        const p = pud[Math.floor(Math.random()*pud.length)];
        this.critters.push({ kind: "bather", p: pud.indexOf(p),
          x: p.x + (Math.random() - 0.5)*p.r, z: 1 - p.z,
          dir: Math.random() < 0.5 ? 1 : -1, t: 0, ph: 0,
          mode: "dip", timer: 0.8 + Math.random()*1.4,
          splash: 0, cycles: 2 + Math.floor(Math.random()*4),
          sz: 0.85 + Math.random()*0.3 });
      }
    }
    /* A stoat. Nothing else here moves like this: a string of tight arched
       bounds along a hedge line, then straight up on its hind legs to stand
       taller than its own length looking at you, then gone. It is the fastest
       thing in the piece and on screen for the least time. */
    if ((this.loc === "meadow" || this.loc === "forest") && night < 0.6
        && n("stoat") === 0 && this.t - this.lastStoat > 90 && P(0.014)) {
      this.lastStoat = this.t;
      const dir = Math.random() < 0.5 ? 1 : -1;
      this.critters.push({ kind: "stoat", x: dir > 0 ? -0.06 : 1.06, dir,
        ...this.crossing(0.25 + Math.random()*0.4),
        mode: "bound", timer: 0.8 + Math.random()*1.4, t: 0, bp: 0, rear: 0,
        sz: 0.85 + Math.random()*0.3 });
      this.raiseAlarm(dir > 0 ? 0 : 1, "stoat");
    }
    // a brown hare loping the field edge, drawn up tall when it stops
    if (this.loc === "meadow" && (duskdawn > 0.4 || dayish > 0.55) && n("hare") === 0
        && this.t - this.lastHare > 70 && P(0.016)) {
      this.lastHare = this.t;
      const dir = Math.random() < 0.5 ? 1 : -1;
      this.critters.push({ kind: "hare", x: dir > 0 ? -0.07 : 1.07, dir,
        ...this.crossing(),
        mode: "lope", timer: 1.5 + Math.random()*2, t: 0, ph: 0,
        sz: 0.85 + Math.random()*0.35 });
    }
    // a hedgehog on its shuffling night beat
    if ((this.loc === "meadow" || this.loc === "forest" || this.loc === "city")
        && night > 0.5 && n("hedgehog") === 0
        && this.t - this.lastHedgehog > 80 && P(0.02)) {
      this.lastHedgehog = this.t;
      const dir = Math.random() < 0.5 ? 1 : -1;
      this.critters.push({ kind: "hedgehog", x: dir > 0 ? -0.05 : 1.05, dir,
        mode: "shuffle", timer: 2 + Math.random()*3, t: 0,
        sz: 0.85 + Math.random()*0.3 });
    }
    // a badger trundling its rounds, rare and unhurried
    if (this.loc === "forest" && night > 0.6 && n("badger") === 0
        && this.t - this.lastBadger > 110 && P(0.013)) {
      this.lastBadger = this.t;
      const dir = Math.random() < 0.5 ? 1 : -1;
      this.critters.push({ kind: "badger", x: dir > 0 ? -0.08 : 1.08, dir,
        ...this.crossing(0.10 + Math.random()*0.4),
        t: 0, lp: 0, sz: 0.9 + Math.random()*0.25 });
      this.raiseAlarm(dir > 0 ? 0 : 1, "badger");
    }
    // an otter threading the open water, diving and surfacing
    if (this.loc === "wetland" && night < 0.6 && n("otter") === 0
        && this.t - this.lastOtter > 70 && P(0.018)) {
      this.lastOtter = this.t;
      const dir = Math.random() < 0.5 ? 1 : -1;
      this.critters.push({ kind: "otter", x: dir > 0 ? -0.06 : 1.06, dir,
        y: this.waterY + 0.1 + Math.random()*(this.bankY - this.waterY - 0.2),
        mode: "swim", timer: 2.5 + Math.random()*3, t: 0, ph: 0,
        sz: 0.85 + Math.random()*0.3 });
      this.raiseAlarm(dir > 0 ? 0 : 1, "otter");
    }
    /* A cat on the rooftops after dark — and one lying out in the sun by day,
       which is a different animal entirely. The daylight one is gated on the
       light itself rather than the hour, so an overcast afternoon has no cat
       on the tiles and a clear one does. */
    if (this.loc === "city" && n("cat") === 0
        && this.t - this.lastCat > 70 && P(0.03)
        && (night > 0.5 || (this._lit ? this._lit.str : 0) > 0.66)
        && this.frontBlocks && this.frontBlocks.length) {
      this.lastCat = this.t;
      const bi = Math.floor(Math.random()*this.frontBlocks.length);
      const dir = Math.random() < 0.5 ? 1 : -1;
      const sunning = night <= 0.5;
      this.critters.push({ kind: "cat", b: bi, dir, t: 0,
        u: sunning ? 0.2 + Math.random()*0.6 : (dir > 0 ? 0 : 1),
        mode: sunning ? "sun" : "walk",
        timer: sunning ? 25 + Math.random()*45 : 0 });
      if (!sunning) this.raiseAlarm(dir > 0 ? 0.1 : 0.9, "cat");
    }
    if (this.loc === "meadow" && (dayish > 0.3 || duskdawn > 0.4) && calmW && n("rabbit") === 0
        && this.t - this.lastRabbit > 30 && P(0.035)) {
      this.lastRabbit = this.t;
      const dir = Math.random() < 0.5 ? 1 : -1;
      this.critters.push({ kind: "rabbit", x: dir > 0 ? -0.05 : 1.05, dir,
        mode: "hop", timer: 0.3 + Math.random()*0.3, t: 0, hopPh: 0, ear: 0,
        sz: 0.85 + Math.random()*0.3 });
    }
    /* The fox, and it works the street as readily as the field — an urban
       fox is the more likely animal of the two now, and it wanted nothing but
       a place in this condition and a lit hour to trot through. */
    if ((this.loc === "meadow" || this.loc === "forest" || this.loc === "city")
        && (duskdawn > 0.45 || night > 0.4)
        && n("fox") === 0 && this.t - this.lastFox > 80 && P(0.018)) {
      this.lastFox = this.t;
      const dir = Math.random() < 0.5 ? 1 : -1;
      this.critters.push({ kind: "fox", x: dir > 0 ? -0.08 : 1.08, dir,
        ...this.crossing(),
        mode: "trot", timer: 1.2 + Math.random()*1.5, t: 0, lp: 0, look: 0,
        sz: 0.85 + Math.random()*0.3,
        /* A vixen with cubs, at the time of year and the hour you would
           actually see them — and cubs do not walk in a line the way a fawn
           does, so they get different lags and take their own ground. */
        young: Math.random() < 0.22
          ? Array.from({ length: 1 + Math.floor(Math.random()*2) }, () => ({
              lag: 0.55 + Math.random()*0.9, sz: 0.46 + Math.random()*0.12,
              off: (Math.random() - 0.5)*0.05 })) : null });
      this.raiseAlarm(dir > 0 ? 0 : 1, "fox");
    }
    if ((this.loc === "wetland" || this.loc === "beach") && dayish > 0.3
        && n("heron") === 0 && this.t - this.lastHeron > 85 && P(0.012)) {
      this.lastHeron = this.t;
      const dir = Math.random() < 0.5 ? 1 : -1;
      const edge = this.loc === "wetland" ? (this.bankY || 0.86) - 0.005 : (this.shoreY || 0.82) + 0.02;
      this.critters.push({ kind: "heron", x: 0.25 + Math.random()*0.5, y: edge, dir,
        mode: "wait", timer: 3 + Math.random()*4, t: 0, vx: 0, flap: 0,
        neck: 0.4, phase: 0, acts: 0,
        sz: 0.85 + Math.random()*0.3 });
    }
    /* Turnstones. Sanderlings run; turnstones *work* — a tight party of them
       shuffling along the strand line, each one heaving weed and shingle over
       to see what is underneath. They arrive together and they stay together,
       which is the thing about them: everything else in this piece is alone. */
    if (this.loc === "beach" && night < 0.6 && n("turnstone") === 0
        && this.t - this.lastTurnstone > 60 && P(0.024)) {
      this.lastTurnstone = this.t;
      const dir = Math.random() < 0.5 ? 1 : -1;
      const flock = 3 + Math.floor(Math.random()*4);
      const z0 = 0.10 + Math.random()*0.45;
      const at = dir > 0 ? -0.06 : 1.06;
      for (let i = 0; i < flock; i++) {
        this.critters.push({ kind: "turnstone", dir, t: Math.random()*3,
          x: at - dir*(i*0.035 + Math.random()*0.02),
          z: Math.max(0.04, z0 + (Math.random() - 0.5)*0.10),
          mode: "work", timer: 0.4 + Math.random()*1.6, ph: Math.random()*6,
          heave: 0, sz: 0.9 + Math.random()*0.2 });
      }
    }
    /* A crab, sideways and suspicious, out of one bit of weed and into the
       next. It is the only thing in the piece that does not face where it is
       going, which is exactly why it is worth having. */
    if (this.loc === "beach" && n("crab") === 0
        && this.t - this.lastCrab > 55 && P(0.02)) {
      this.lastCrab = this.t;
      const dir = Math.random() < 0.5 ? 1 : -1;
      this.critters.push({ kind: "crab", x: dir > 0 ? -0.04 : 1.04, dir,
        z: 0.05 + Math.random()*0.35, mode: "scuttle", timer: 0.3 + Math.random()*0.5,
        t: 0, ph: 0, claw: 0, sz: 0.85 + Math.random()*0.4 });
    }
    /* A seal's head, out beyond the surf. Up, a long look at the beach, and
       gone — and it does not come back, which is what makes you doubt you
       saw it. */
    if (this.loc === "beach" && n("seal") === 0 && state.wx.gust < 0.7
        && this.t - this.lastSeal > 95 && P(0.011)) {
      this.lastSeal = this.t;
      this.critters.push({ kind: "seal", x: 0.15 + Math.random()*0.7,
        y: this.horizonY + (this.shoreY - this.horizonY)*(0.45 + Math.random()*0.35),
        dir: Math.random() < 0.5 ? 1 : -1, t: 0, up: 0,
        life: 7 + Math.random()*7, sz: 0.9 + Math.random()*0.3 });
    }
    /* A gull with a shell. It carries it up, lets go, and follows it down —
       the whole business only makes sense as one gesture, so it is one
       creature with the shell as part of it rather than two that have to
       find each other. */
    if (this.loc === "beach" && night < 0.5 && n("shelldrop") === 0
        && this.t - this.lastShell > 75 && P(0.014)) {
      this.lastShell = this.t;
      const dir = Math.random() < 0.5 ? 1 : -1;
      this.critters.push({ kind: "shelldrop", dir, t: 0, ph: 0,
        x: 0.2 + Math.random()*0.6, z: 0.10 + Math.random()*0.3,
        mode: "climb", timer: 0, gy: 0.42 + Math.random()*0.1,
        sy: 0, sv: 0, bounces: 0, sz: 0.9 + Math.random()*0.25 });
    }
    /* Pigeons. The pavement bird — a loose scatter of them pecking at nothing,
       heads going like clockwork, and then the whole lot up at once over
       something none of them could name. */
    if (this.loc === "city" && night < 0.55 && n("pigeon") === 0
        && this.t - this.lastPigeons > 55 && P(0.03)) {
      this.lastPigeons = this.t;
      const cx = 0.2 + Math.random()*0.6;
      const flock = 4 + Math.floor(Math.random()*5);
      for (let i = 0; i < flock; i++) {
        this.critters.push({ kind: "pigeon", t: Math.random()*4,
          x: Math.max(0.03, Math.min(0.97, cx + (Math.random() - 0.5)*0.34)),
          z: 0.06 + Math.random()*0.6,
          dir: Math.random() < 0.5 ? 1 : -1,
          mode: "peck", timer: 0.4 + Math.random()*2.2, ph: Math.random()*6,
          bob: Math.random()*6, fly: 0, vx: 0, vy: 0,
          sz: 0.9 + Math.random()*0.2 });
      }
    }
    /* A moth at a lit window — the one thing in the city that is not going
       anywhere. It only exists because a window is on, so it is fastened to
       one and dies when the light does. */
    if (this.loc === "city" && night > 0.45 && n("moth") === 0
        && this.t - this.lastMoth > 45 && P(0.05)
        && this.frontBlocks && this.frontBlocks.length) {
      const lit = [];
      for (let bi = 0; bi < this.frontBlocks.length; bi++) {
        const b = this.frontBlocks[bi];
        for (let wi = 0; wi < b.lit.length; wi++) if (b.lit[wi].on) lit.push([bi, wi]);
      }
      if (lit.length) {
        this.lastMoth = this.t;
        const [bi, wi] = lit[Math.floor(Math.random()*lit.length)];
        this.critters.push({ kind: "moth", b: bi, w: wi, t: 0, ph: Math.random()*6,
          life: 12 + Math.random()*20, ox: 0, oy: 0, tx: 0, ty: 0,
          timer: 0, sz: 0.85 + Math.random()*0.4 });
      }
    }
    // a porpoise arcing through the surf — rare, unhurried
    if (this.loc === "beach" && state.wx.wet < 0.3 && n("porpoise") === 0
        && this.t - this.lastPorpoise > 55 && P(0.02)) {
      this.lastPorpoise = this.t;
      const dir = Math.random() < 0.5 ? 1 : -1;
      this.critters.push({ kind: "porpoise", x: dir > 0 ? -0.05 : 1.05, dir,
        base: (this.horizonY + this.shoreY)/2 + 0.02, t: 0, phase: 0 });
    }
    // the water stirs on its own now and then — an insect, a breath of wind
    if (this.loc === "wetland" && state.wx.wet < 0.2 && Math.random() < 0.14*dt) {
      const x = 0.08 + Math.random()*0.84;
      const y = this.waterY + 0.06 + Math.random()*(this.bankY - this.waterY - 0.12);
      this.fishRings.push({ x, y, age: 0, quiet: true });
    }
    if (duskdawn > 0.55 && n("skein") === 0 && this.t - this.lastSkein > 45 && P(0.02)) {
      this.lastSkein = this.t;
      const dir = Math.random() < 0.5 ? 1 : -1;
      this.critters.push({ kind: "skein", x: dir > 0 ? -0.15 : 1.15,
        y: 0.10 + Math.random()*0.12, vx: dir*0.014,
        nb: 5 + Math.floor(Math.random()*5), t: 0 });
    }
    if (night > 0.7 && state.wx.haze < 0.15 && state.wx.wet < 0.05 && !REDUCED
        && this.meteors.length < 2 && P(0.05)) {
      this.meteors.push({ x: Math.random()*0.8 + 0.1, y: Math.random()*0.25 + 0.05,
        vx: 0.25 + Math.random()*0.2, vy: 0.12 + Math.random()*0.08, age: 0, life: 0.6 });
    }
  }

  /* What every wild thing in the frame is doing. Paired case for case with
     drawCritters below, in the same order, so the two read side by side: this
     one decides, that one draws. Anything a painter needs that is worked out
     along the way is either recomputed there from the state left here, or —
     where it is accumulated across the branches rather than derived — written
     onto the critter at the end of its case. */
  /* Who eats whom, as far as the frame is concerned. */
  static get HUNTS() { return { fox: 1, cat: 1, badger: 0.5, heron: 0.6, stoat: 1 }; }
  static get PREY() { return { rabbit: 1, hare: 1, squirrel: 1, hedgehog: 0.6, deer: 0.8 }; }

  updateCritters(dt) {
    const bot = this.skyColors()[1];
    /* ---- Prey notice predators --------------------------------------

       Nothing in this frame had ever looked at anything else: three animals
       on screen were three separate worlds, and the only thing that coupled
       them was the blanket `flush` an alarm call set off.

       A rabbit that sees a fox does not run. It *stops* — dead still, ears
       up, for as long as it takes — and it only runs if the fox keeps
       coming. The stillness is the tell, and it is far more legible than
       motion because everything else in the field is still moving.

       Gathered once per frame rather than per animal: five critters is
       twenty-five comparisons done twenty-five times if you are careless. */
    const hunters = [];
    for (const c of this.critters) {
      const w = Scene.HUNTS[c.kind];
      if (w) hunters.push({ x: c.x, z: c.z === undefined ? 0.5 : c.z, w });
    }
    /* Pigeons do not freeze, they go — and they go *together*, which is the
       only reason to have more than one. Decided once for the whole flock so
       they leave on the same frame rather than trailing off one at a time. */
    let flushPigeons = Math.random() < 0.035*dt;
    if (!flushPigeons && hunters.length) {
      for (const cr of this.critters) {
        if (cr.kind !== "pigeon" || cr.fly) continue;
        for (const h of hunters) {
          if (Math.abs(h.x - cr.x) < 0.22 && Math.abs(h.z - cr.z) < 0.28) { flushPigeons = true; break; }
        }
        if (flushPigeons) break;
      }
    }
    if (flushPigeons) {
      for (const cr of this.critters) {
        if (cr.kind === "pigeon" && !cr.fly) {
          cr.fly = 0.001; cr.y = undefined;
          cr.vx = cr.dir*(0.10 + Math.random()*0.09);
          cr.vy = -(0.11 + Math.random()*0.10);
        }
      }
    }
    /* The fox measures its own crouch and reach against its drawn size, so this
       one pass needs the height of the frame. It is the same number draw() is
       handed — resize() sets both — and the same colours, because frame() has
       already settled timeMix before either pass runs. */
    const H = this.H;
    for (let i = this.critters.length - 1; i >= 0; i--) {
      const cr = this.critters[i];
      cr.t += dt;
      /* Where this individual stands in the depth of the field, decided once.
         Never right at the near edge: the plane's nearest ground sits just
         below the bottom of the frame — which is what puts the grass at your
         feet off the edge of the glass, as it should be — and an animal
         standing there would be half out of the picture. */
      if (cr.z === undefined) {
        const nz = this.nearZ();
        cr.z = nz + Math.random()*(0.96 - nz);
      } else if (cr.z < 0.99) {
        // and a depth chosen at spawn is held to the same edge
        cr.z = Math.max(this.nearZ(), cr.z);
      }
      const D = this.groundDepth(cr.z, bot);
      let dead = false;

      /* How near the nearest hunter is, in the animal's own terms: something
         at the same distance across the field matters, something two fields
         back does not, however close it looks on the glass. */
      const wary = Scene.PREY[cr.kind];
      if (wary && hunters.length && !cr.bolt) {
        let worst = 0;
        for (const h of hunters) {
          const dx = Math.abs(h.x - cr.x), dz = Math.abs(h.z - cr.z);
          if (dz > 0.30) continue;
          /* Half a field wide. A rabbit sees a fox a long way off — the
             point of the whole behaviour is the long still stare before
             anything happens, and at ten paces there is no time for one. */
          worst = Math.max(worst, h.w*wary*Math.max(0, 1 - dx/0.55)*(1 - dz/0.30));
        }
        if (worst > 0.62) {
          // too close. Go.
          cr.bolt = (cr.x < (hunters[0].x)) ? -1 : 1;
          cr.boltT = 0; cr.frozen = 0;
        } else if (worst > 0.10) {
          cr.frozen = Math.max(cr.frozen || 0, 0.9 + worst*2.6);
        }
      }
      if (cr.frozen > 0) {
        cr.frozen -= dt;
        /* Held. Whatever it was doing, it is not doing it — and it holds the
           most alert shape it has: a rabbit sits bolt upright with its ears
           up, a hare freezes mid-crouch, a squirrel goes still on its
           haunches, a deer lifts its head off the grass. */
        if (cr.kind === "rabbit") { cr.mode = "sit"; cr.ear = 1; cr.act = null; }
        else if (cr.kind === "hare") cr.mode = "alert";
        else if (cr.kind === "squirrel") cr.mode = "sit";
        else if (cr.kind === "deer") { cr.state = "alert"; cr.head = 0; }
        else if (cr.kind === "hedgehog") cr.mode = "sniffup";
        cr.timer = Math.max(cr.timer || 0, cr.frozen);
        cr.t += 0;                       // its own clock still runs; its feet do not
      }
      switch (cr.kind) {
        case "butterfly": {
          /* A butterfly does not fly a curve. It goes a little way in one
             direction, changes its mind, and goes a little way in another —
             and it climbs on each downstroke and drops back between them, so
             its path is a stitch rather than a line. The veer is a heading it
             holds for a moment and then re-picks; the stitch comes from the
             wingbeat itself, in the painter. */
          cr.veer -= dt;
          if (cr.veer <= 0) {
            cr.vx = cr.drift + (Math.random() - 0.5)*0.10;
            cr.vy = (Math.random() - 0.5)*0.09 - 0.012;
            cr.veer = 0.25 + Math.random()*0.7;
          }
          cr.x += cr.vx*dt; cr.y += cr.vy*dt;
          cr.y = Math.max(0.42, Math.min(0.92, cr.y));
          if (cr.t > cr.life || cr.x < -0.05 || cr.x > 1.05) { dead = true; break; }
          break;
        }
        case "dragonfly": {
          cr.timer -= dt;
          let jx = 0, jy = 0;
          if (cr.mode === "hover") {
            jx = (Math.random()-0.5)*1.4; jy = (Math.random()-0.5)*1.2;
            if (cr.timer <= 0) {
              cr.mode = "dart";
              cr.tx = 0.2 + Math.random()*0.6;
              cr.ty = this.waterY - 0.02 - Math.random()*0.12;
            }
          } else {
            cr.x += (cr.tx - cr.x)*Math.min(1, dt*7);
            cr.y += (cr.ty - cr.y)*Math.min(1, dt*7);
            if (Math.abs(cr.tx - cr.x) < 0.008) { cr.mode = "hover"; cr.timer = 0.8 + Math.random()*1.6; }
          }
          if (cr.t > cr.life) { dead = true; break; }
          cr.jx = jx;
          cr.jy = jy;
          break;
        }
        case "bat": {
          cr.turn -= dt;
          if (cr.turn <= 0) { cr.vy = (Math.random()-0.5)*0.16; cr.turn = 0.3 + Math.random()*0.5; }
          cr.x += cr.vx*dt; cr.y += cr.vy*dt;
          cr.y = Math.max(0.05, Math.min(0.6, cr.y));
          if (cr.x < -0.1 || cr.x > 1.1) { dead = true; break; }
          break;
        }
        case "deer": {
          const walking = cr.state === "enter" || cr.state === "leave" || cr.state === "walkbit";
          if (walking) { cr.x += cr.dir*0.02*dt*D.speed; cr.lp += dt*6; }
          if (cr.state === "enter" || cr.state === "walkbit") {
            if ((cr.dir > 0 && cr.x >= cr.tx) || (cr.dir < 0 && cr.x <= cr.tx)) { cr.state = "grazedown"; }
          } else if (cr.state === "grazedown") {
            cr.head = Math.min(1, cr.head + dt*1.2);
            if (cr.head >= 1) { cr.state = "graze"; cr.timer = 2 + Math.random()*2; }
          } else if (cr.state === "graze") {
            cr.timer -= dt;
            if (cr.timer <= 0) cr.state = "grazeup";
          } else if (cr.state === "grazeup") {
            cr.head = Math.max(0, cr.head - dt*1.4);
            if (cr.head <= 0) {
              cr.cycles--;
              if (cr.cycles <= 0) {
                cr.state = "leave";
                // now and then something spooks it and it goes in bounds
                cr.bounding = Math.random() < 0.4;
                cr.bp = 0;
              } else if (Math.random() < 0.45) {
                // head up, ears forward, listening — the longest it ever holds still
                cr.state = "alert"; cr.timer = 1.8 + Math.random()*3;
              } else {
                cr.state = "walkbit";
                cr.tx = Math.min(0.9, Math.max(0.1, cr.x + cr.dir*(0.06 + Math.random()*0.08)));
              }
            }
          } else if (cr.state === "alert") {
            cr.timer -= dt;
            if (cr.timer <= 0) {
              cr.state = "walkbit";
              if (Math.random() < 0.3) cr.dir *= -1;     // moves off the other way
              cr.tx = Math.min(0.9, Math.max(0.1, cr.x + cr.dir*(0.06 + Math.random()*0.1)));
            }
          } else if (cr.state === "leave") {
            if (cr.bounding) { cr.x += cr.dir*0.055*dt*D.speed; cr.bp += dt*10; }
            if (cr.x < -0.12 || cr.x > 1.12) { dead = true; break; }
          }
          break;
        }
        case "runner": {
          cr.timer -= dt;
          if (cr.mode === "dash") {
            cr.x += cr.dir*0.11*dt*D.speed; cr.ph += dt*30;
            if (cr.timer <= 0) { cr.mode = "pause"; cr.timer = 0.5 + Math.random()*1.2; }
          } else if (cr.timer <= 0) {
            cr.mode = "dash"; cr.timer = 0.35 + Math.random()*0.5;
            if (Math.random() < 0.25) cr.dir *= -1;
          }
          if (cr.x < -0.06 || cr.x > 1.06) { dead = true; break; }
          // standing still, it works the wet sand with quick jabs of the bill
          break;
        }
        case "turnstone": {
          /* A working bird, not a running one. Two or three shuffling steps,
             then it gets its bill under something and heaves — the whole body
             behind it, front end down, tail up. Then a step, and again. */
          cr.timer -= dt;
          if (cr.mode === "step") {
            cr.x += cr.dir*0.014*dt*D.speed; cr.ph += dt*13;
            if (cr.timer <= 0) {
              cr.mode = "work"; cr.timer = 0.5 + Math.random()*1.8;
              cr.heaveT = 0;
            }
          } else {
            // the heave itself is quick — a shove and a recovery, then a wait
            cr.heaveT = (cr.heaveT || 0) + dt;
            const every = 0.9;
            const u = (cr.heaveT % every)/every;
            cr.heave = u < 0.42 ? Math.sin(u/0.42*Math.PI) : 0;
            if (cr.timer <= 0) {
              cr.mode = "step"; cr.heave = 0; cr.timer = 0.3 + Math.random()*0.6;
              // one bird in six turns back through the party it came with
              if (Math.random() < 0.16) cr.dir *= -1;
            }
          }
          if (cr.x < -0.1 || cr.x > 1.1) { dead = true; break; }
          break;
        }
        case "mob": {
          /* The owl goes straight and heavily; the small birds do not. Each
             one runs its own loop about the owl and every so often shuts the
             loop right down and goes in — which is the dive, and it is the
             only part of this anybody watches. */
          cr.x += cr.dir*0.055*dt;
          cr.y += Math.sin(cr.t*0.9)*0.006*dt;
          cr.flap += dt*4.2;
          for (const b of cr.birds) {
            b.ph += dt*b.sp;
            b.flap += dt*22;
            b.dive -= dt;
            if (b.dive <= 0) { b.dive = 1.6 + Math.random()*3.4; b.diveT = 0.55; }
            if (b.diveT > 0) b.diveT -= dt;
          }
          if (cr.x < -0.2 || cr.x > 1.2) { dead = true; break; }
          break;
        }
        case "lizard": {
          /* Long stillness, a burst, more stillness. The press-up is the one
             thing it does while basking, and it is worth the four lines.
             And if the sun goes in — a cloud, rain coming on — so does it. */
          cr.timer -= dt;
          if (cr.mode === "bask") {
            cr.push = Math.max(0, cr.push - dt*4);
            if (cr.timer <= 0) {
              cr.mode = Math.random() < 0.45 ? "pushup" : "dart";
              cr.timer = cr.mode === "pushup" ? 1.4 + Math.random() : 0.18 + Math.random()*0.22;
            }
          } else if (cr.mode === "pushup") {
            cr.push = Math.max(0, Math.sin(cr.t*11));
            if (cr.timer <= 0) { cr.mode = "bask"; cr.timer = 4 + Math.random()*11; }
          } else {
            cr.x += cr.dir*0.10*dt*D.speed; cr.ph += dt*30;
            if (cr.timer <= 0) {
              cr.mode = "bask"; cr.timer = 3 + Math.random()*12;
              if (Math.random() < 0.4) cr.dir *= -1;
            }
          }
          if ((this._lit ? this._lit.str : 1) < 0.4 || cr.t > cr.life
              || cr.x < -0.05 || cr.x > 1.05) { dead = true; break; }
          break;
        }
        case "bather": {
          /* Three things in turn and then it has had enough: a dip, which is
             the breast down and the head under; the shake, which throws water
             off in every direction; and the interval, standing there looking
             ridiculous. */
          cr.timer -= dt;
          cr.ph += dt*(cr.mode === "shake" ? 26 : 7);
          if (cr.mode === "dip") {
            cr.splash = Math.max(0, Math.sin(cr.t*7.5));
            if (cr.timer <= 0) { cr.mode = "shake"; cr.timer = 0.5 + Math.random()*0.5; }
          } else if (cr.mode === "shake") {
            cr.splash = 1;
            if (cr.timer <= 0) {
              cr.mode = "stand"; cr.timer = 0.8 + Math.random()*1.8; cr.splash = 0;
            }
          } else {
            cr.splash = Math.max(0, cr.splash - dt*2);
            if (cr.timer <= 0) {
              if (--cr.cycles <= 0) { dead = true; break; }
              cr.mode = "dip"; cr.timer = 0.7 + Math.random()*1.3;
            }
          }
          // and the puddle it is standing in has to still be there
          if ((this.groundWet || 0) < 0.30) { dead = true; break; }
          break;
        }
        case "stoat": {
          cr.timer -= dt;
          if (cr.mode === "bound") {
            cr.x += cr.dir*0.075*dt*D.speed; cr.bp += dt*9;
            cr.rear = Math.max(0, cr.rear - dt*4);
            if (cr.timer <= 0) {
              // up on the hind legs, the whole length of it vertical
              cr.mode = "rear"; cr.timer = 0.7 + Math.random()*1.3;
            }
          } else {
            cr.rear = Math.min(1, cr.rear + dt*5);
            if (cr.timer <= 0) {
              cr.mode = "bound"; cr.timer = 0.7 + Math.random()*1.5;
              if (Math.random() < 0.2) cr.dir *= -1;
            }
          }
          if (cr.x < -0.1 || cr.x > 1.1) { dead = true; break; }
          break;
        }
        case "shelldrop": {
          /* Climb, let go, follow it down, and pick over what broke. The shell
             is in the gull's own coordinates until it is dropped; after that
             it has a velocity and the ground has the last word. */
          cr.ph += dt*5;
          if (cr.mode === "climb") {
            cr.gy += (0.30 - cr.gy)*Math.min(1, dt*0.7);
            cr.x += cr.dir*0.02*dt;
            cr.sy = cr.gy + 0.012;
            if (cr.gy < 0.335) { cr.mode = "drop"; cr.sv = 0; }
          } else if (cr.mode === "drop") {
            cr.sv += 1.1*dt;                      // the shell falls
            cr.sy += cr.sv*dt;
            cr.gy += (0.34 - cr.gy)*Math.min(1, dt*0.6);
            if (cr.sy >= D.y) {
              cr.sy = D.y;
              if (cr.bounces++ < 2) { cr.sv *= -0.34; }
              else { cr.mode = "stoop"; cr.sv = 0; }
            }
          } else if (cr.mode === "stoop") {
            // down after it, fast and steep
            cr.gy += (D.y - 0.004 - cr.gy)*Math.min(1, dt*2.2);
            if (cr.gy > D.y - 0.012) { cr.mode = "pick"; cr.timer = 2.5 + Math.random()*3; }
          } else {
            cr.timer -= dt;
            cr.gy = D.y - 0.004;
            if (cr.timer <= 0) { dead = true; break; }
          }
          break;
        }
        case "pigeon": {
          /* On the ground it is all head: the body walks smoothly and the head
             is held still, then snapped forward — which is what makes a pigeon
             read as a pigeon at any size. And they go up together. */
          cr.timer -= dt;
          if (cr.fly > 0) {
            cr.fly += dt;
            cr.x += cr.vx*dt; cr.y = (cr.y === undefined ? D.y : cr.y) + cr.vy*dt;
            cr.vy = Math.max(-0.34, cr.vy - 0.10*dt);
            cr.ph += dt*17;
            if (cr.y < -0.06 || cr.x < -0.12 || cr.x > 1.12) { dead = true; break; }
            break;
          }
          if (cr.mode === "walk") {
            cr.x += cr.dir*0.011*dt*D.speed; cr.ph += dt*10; cr.bob += dt*7;
            if (cr.timer <= 0) {
              cr.mode = "peck"; cr.timer = 0.5 + Math.random()*2.2;
            }
          } else {
            // head down, up, down — the pecking is its own little clock
            cr.bob += dt*4.2;
            if (cr.timer <= 0) {
              cr.mode = "walk"; cr.timer = 0.6 + Math.random()*1.6;
              if (Math.random() < 0.35) cr.dir *= -1;
            }
          }
          if (cr.x < -0.08 || cr.x > 1.08) { dead = true; break; }
          break;
        }
        case "moth": {
          /* Not flight so much as failure to leave. It picks a point near the
             glass and blunders towards it, overshoots, and picks another. */
          const b = this.frontBlocks && this.frontBlocks[cr.b];
          const wnd = b && b.lit[cr.w];
          if (!wnd || (!wnd.on && (wnd.fade || 0) > 0.9)) { dead = true; break; }
          cr.timer -= dt;
          if (cr.timer <= 0) {
            const a = Math.random()*Math.PI*2, r = 0.004 + Math.random()*0.022;
            cr.tx = Math.cos(a)*r; cr.ty = Math.sin(a)*r*0.7;
            cr.timer = 0.12 + Math.random()*0.4;
          }
          const k = Math.min(1, dt*5.5);
          cr.ox += (cr.tx - cr.ox)*k; cr.oy += (cr.ty - cr.oy)*k;
          cr.ph += dt*40;
          if (cr.t > cr.life) { dead = true; break; }
          break;
        }
        case "crab": {
          /* Sideways: it travels along its own width, so the body never turns.
             Bursts of scuttle, then a freeze with one claw up — and the freeze
             is the whole character of the thing. */
          cr.timer -= dt;
          if (cr.mode === "scuttle") {
            cr.x += cr.dir*0.05*dt*D.speed; cr.ph += dt*22;
            cr.claw = Math.max(0, cr.claw - dt*4);
            if (cr.timer <= 0) {
              cr.mode = "still"; cr.timer = 0.5 + Math.random()*2.2;
            }
          } else {
            cr.claw = Math.min(1, cr.claw + dt*3);
            if (cr.timer <= 0) {
              cr.mode = "scuttle"; cr.timer = 0.25 + Math.random()*0.55;
              if (Math.random() < 0.3) cr.dir *= -1;
            }
          }
          if (cr.x < -0.08 || cr.x > 1.08) { dead = true; break; }
          break;
        }
        case "seal": {
          /* Up, a long look, and gone. It surfaces once, holds, and sinks —
             and the drift while it is up is the swell carrying it, not
             swimming. */
          const up = Math.min(1, cr.t/1.4);
          const down = Math.max(0, Math.min(1, (cr.t - (cr.life - 1.6))/1.6));
          cr.up = up*(1 - down);
          cr.x += cr.dir*0.004*dt;
          // the head turns, slowly, along the length of the beach
          cr.look = Math.sin(cr.t*0.55)*0.9;
          if (cr.t > cr.life) { dead = true; break; }
          break;
        }
        case "cat": {
          const b = this.frontBlocks && this.frontBlocks[cr.b];
          if (!b) { dead = true; break; }
          cr.actT = (cr.actT || 0) + dt;
          if (cr.mode === "walk") {
            cr.u += cr.dir * 0.02 * dt / Math.max(0.04, b.w);
            if (Math.random() < 0.12*dt) {
              // it stops to sit, or to stretch out the length of itself
              cr.mode = Math.random() < 0.25 ? "stretch" : "sit";
              cr.timer = cr.mode === "stretch" ? 1.4 : 2 + Math.random()*4;
              cr.actT = 0;
            }
            if (cr.u < -0.05 || cr.u > 1.05) { dead = true; break; }
          } else if (cr.mode === "sun") {
            /* Flat out on the warm tiles, and it stays that way — for a
               minute at a time, which no other creature here does. The only
               thing that moves is its breathing, and the sun going in ends
               it: a cat does not lie on a cold roof. */
            cr.timer -= dt;
            if (cr.timer <= 0 || (this._lit ? this._lit.str : 1) < 0.42) {
              cr.mode = "walk"; cr.act = null;
            }
          } else {
            cr.timer -= dt;
            if (cr.mode === "sit" && !cr.act && Math.random() < 0.25*dt) {
              cr.act = "groom"; cr.actT = 0;                 // a wash, while it's sitting
              cr.actDur = 2 + Math.random()*2.5;
            }
            if (cr.act && cr.actT > cr.actDur) cr.act = null;
            if (cr.timer <= 0) {
              cr.mode = "walk"; cr.act = null;
              if (Math.random() < 0.3) cr.dir *= -1;         // turns and goes back
            }
          }
          cr.x = b.x + cr.u*b.w;      // kept current, so its voice comes from the right roof
          break;
        }
        case "rabbit": {
          cr.timer -= dt;
          cr.actT = (cr.actT || 0) + dt;
          if (cr.mode === "hop") {
            cr.hopPh += dt*11; cr.x += cr.dir*0.05*dt*D.speed;
            if (cr.timer <= 0) {
              // it settles to crop the grass, wash its face, or just sit up
              const roll = Math.random();
              cr.act = roll < 0.42 ? "nibble" : roll < 0.62 ? "wash" : null;
              cr.mode = "sit";
              cr.timer = (cr.act ? 2 : 0.6) + Math.random()*2.2;
              cr.hopPh = 0; cr.actT = 0;
            }
          } else {
            cr.ear = Math.max(0, (cr.ear || 0) - dt*2);
            if (Math.random() < 0.6*dt) cr.ear = 1;
            if (cr.timer <= 0) {
              cr.mode = "hop"; cr.act = null; cr.timer = 0.25 + Math.random()*0.5;
              if (Math.random() < 0.2) cr.dir *= -1;
            }
          }
          if (cr.x < -0.08 || cr.x > 1.08) { dead = true; break; }
          break;
        }
        case "fox": {
          // A fox on the field edge does more than trot past. It stops to
          // follow a scent, cocks its head at something under the grass and
          // freezes — and then goes up and over in the vertical mousing leap,
          // coming down nose-first.
          cr.timer -= dt;
          const fS = H*0.05*(cr.sz || 1)*D.scale;
          const pose = { crouch: 0, lift: 0, rot: 0, air: 0, sniff: 0 };
          if (cr.mode === "trot") {
            cr.x += cr.dir*0.028*dt*D.speed; cr.lp += dt*7;
            if (cr.timer <= 0) {
              const roll = Math.random();
              if (roll < 0.34 && this.t - this.lastPounce > 12) {
                cr.mode = "listen"; cr.timer = 1.1 + Math.random()*1.1;
              } else if (roll < 0.62) {
                cr.mode = "sniff"; cr.timer = 1.2 + Math.random()*1.8;
              } else { cr.mode = "pause"; cr.timer = 0.8 + Math.random()*1.8; }
            }
          } else if (cr.mode === "pause" || cr.mode === "sniff") {
            pose.sniff = cr.mode === "sniff" ? 1 : 0;
            if (cr.timer <= 0) {
              cr.mode = "trot"; cr.timer = 1.4 + Math.random()*2.4;
              if (Math.random() < 0.22) cr.dir *= -1;     // thinks better of it
            }
          } else if (cr.mode === "listen") {
            // low and absolutely still, weight back, ears fixed on one spot
            pose.crouch = Math.min(1, (1.1 - Math.max(0, cr.timer))*1.4);
            if (cr.timer <= 0) {
              this.lastPounce = this.t;
              cr.mode = "pounce"; cr.timer = 0; cr.phase = 0;
            }
          } else if (cr.mode === "pounce") {
            cr.phase += dt;
            const u = cr.phase;
            if (u < 0.26) {                       // coil: the hindquarters gather
              pose.crouch = 1;
              pose.lift = Math.sin(u/0.26*Math.PI*0.5)*fS*0.10;
            } else if (u < 0.98) {                // the leap itself
              const k = (u - 0.26)/0.72;
              pose.air = Math.min(1, k*4);
              pose.lift = Math.sin(k*Math.PI)*fS*1.55;
              pose.rot = -0.55 + k*1.85;          // nose up off the ground, down at the top
              cr.x += cr.dir*0.02*dt;
            } else if (u < 1.34) {                // the plunge, forefeet and nose first
              pose.rot = 1.30 - (u - 0.98)*1.9;
              pose.air = Math.max(0, 1 - (u - 0.98)*4);
              pose.crouch = 1;
            } else if (u < 2.1) {                 // nosing about in the grass
              pose.crouch = 1;
              pose.rot = 0.60 + Math.sin(u*9)*0.06;
            } else {
              cr.mode = "trot"; cr.timer = 1.6 + Math.random()*2;
            }
          }
          if (cr.x < -0.12 || cr.x > 1.12) { dead = true; break; }
          cr.pose = pose;
          break;
        }
        case "heron": {
          // The bird's whole day: waiting, watching the water, one deliberate
          // step, the strike, the swallow — and eventually the heave into the
          // air. Each state hands on to the next rather than looping in place.
          cr.timer -= dt;
          if (!cr.placed) { cr.y = D.y; cr.placed = true; }   // stands at its own distance
          const pose = { neck: cr.neck || 0, strike: 0, gulp: 0, step: 0,
            preen: 0, rouse: 0, crouch: 0 };
          const nextIdle = () => {
            const roll = Math.random();
            if (roll < 0.34) { cr.mode = "stalk"; cr.timer = 1.7; cr.phase = 0; }
            else if (roll < 0.62) { cr.mode = "watch"; cr.timer = 2 + Math.random()*3; }
            else if (roll < 0.78) { cr.mode = "preen"; cr.timer = 1.9; }
            else if (roll < 0.88) { cr.mode = "rouse"; cr.timer = 0.7; }
            else { cr.mode = "wait"; cr.timer = 3 + Math.random()*4; }
          };
          if (cr.mode === "stand") { cr.mode = "wait"; cr.timer = 3 + Math.random()*4; }
          if (cr.mode === "wait") {
            cr.neck = Math.max(0.25, (cr.neck || 0.4) - dt*0.6);
            if (cr.timer <= 0) {
              if (++cr.acts > 6) { cr.mode = "leave"; cr.timer = 0.6; }
              else nextIdle();
            }
          } else if (cr.mode === "watch") {
            cr.neck = Math.min(1, (cr.neck || 0.4) + dt*1.1);
            if (cr.timer <= 0) {
              cr.acts++;
              if (Math.random() < 0.55) { cr.mode = "strike"; cr.phase = 0; }
              else nextIdle();
            }
          } else if (cr.mode === "stalk") {
            cr.phase = Math.min(1, (cr.phase || 0) + dt/1.7);
            cr.neck = Math.min(0.85, (cr.neck || 0.4) + dt*0.5);
            pose.step = cr.phase;
            cr.x += cr.dir*0.006*dt*D.speed;
            if (cr.phase >= 1) { cr.acts++; cr.mode = "watch"; cr.timer = 1.5 + Math.random()*2.5; }
          } else if (cr.mode === "strike") {
            cr.phase += dt;
            const u = cr.phase;
            cr.neck = 1;
            if (u < 0.16) pose.strike = u/0.16;              // down like a loosed spring
            else if (u < 0.30) pose.strike = 1;
            else if (u < 0.62) pose.strike = 1 - (u - 0.30)/0.32;
            else {
              cr.mode = "gulp"; cr.phase = 0; cr.acts++;
              // the water closes over where the bill went in
              this.fishRings.push({ x: cr.x, y: cr.y + 0.008, age: 0, quiet: true });
            }
          } else if (cr.mode === "gulp") {
            cr.phase += dt;
            pose.gulp = Math.min(1, cr.phase/0.75);
            if (cr.phase > 0.85) nextIdle();
          } else if (cr.mode === "preen") {
            pose.preen = Math.sin(Math.min(1, (1.9 - Math.max(0, cr.timer))/1.9)*Math.PI);
            if (cr.timer <= 0) { cr.acts++; nextIdle(); }
          } else if (cr.mode === "rouse") {
            pose.rouse = Math.sin(Math.min(1, (0.7 - Math.max(0, cr.timer))/0.7)*Math.PI);
            if (cr.timer <= 0) { cr.acts++; nextIdle(); }
          } else if (cr.mode === "leave") {
            pose.crouch = Math.min(1, (0.6 - Math.max(0, cr.timer))/0.6);
            cr.neck = Math.max(0.2, (cr.neck || 0.4) - dt*1.2);
            if (cr.timer <= 0) { cr.mode = "fly"; cr.vx = cr.dir*0.03; cr.flap = 0; }
          } else if (cr.mode === "fly") {
            cr.x += cr.vx*dt; cr.y -= dt*0.018; cr.flap += dt*3.4;
            cr.vx += cr.dir*0.004*dt;
            if (cr.x < -0.16 || cr.x > 1.16) { dead = true; break; }
          }
          pose.neck = cr.neck;
          cr.pose = pose;
          break;
        }
        case "porpoise": {
          // One roll through the surface: the snout breaks first, then the
          // back arches over, the fin comes up last and goes down last, and a
          // smooth patch of water is left behind where it went under.
          cr.x += cr.dir*0.05*dt;
          cr.phase += dt*2.1;
          if (cr.x < -0.08 || cr.x > 1.08) { dead = true; break; }
          break;
        }
        case "squirrel": {
          // Bounds, sits up to handle a nut, and — the thing squirrels
          // actually spend the autumn doing — digs a hole, drops the nut in,
          // noses it down and pats the leaf-litter back over it.
          cr.timer -= dt;
          let dig = 0, pat = 0, bury = 0;
          if (cr.mode === "bound") {
            cr.ph += dt*14; cr.x += cr.dir*0.045*dt*D.speed;
            if (cr.timer <= 0) {
              if (Math.random() < 0.45) { cr.mode = "dig"; cr.timer = 0; cr.phase = 0; }
              else { cr.mode = "sit"; cr.timer = 1.2 + Math.random()*2.6; }
            }
          } else if (cr.mode === "dig") {
            cr.phase += dt;
            const u = cr.phase;
            if (u < 0.5) dig = u/0.5;                     // head down, paws to the ground
            else if (u < 2.3) {                            // scrabbling: quick alternate strokes
              dig = 1;
              if (Math.random() < 14*dt) {                 // litter thrown back between the legs
                this.critters.push({ kind: "litter", x: cr.x - cr.dir*0.006, y: D.y, z: cr.z,
                  vx: -cr.dir*(0.02 + Math.random()*0.03),
                  vy: -(0.03 + Math.random()*0.05), t: 0, life: 0.6,
                  sz: 0.6 + Math.random()*0.8 });
              }
            } else if (u < 3.0) { dig = 1; bury = (u - 2.3)/0.7; }   // nose the nut down
            else if (u < 3.7) { dig = 1 - (u - 3.0)/0.7; pat = 1; }  // pat it over
            else { cr.mode = "sit"; cr.timer = 0.8 + Math.random()*1.4; }
          } else if (cr.timer <= 0) {
            cr.mode = "bound"; cr.timer = 0.6 + Math.random()*1.1;
            if (Math.random() < 0.25) cr.dir *= -1;
          }
          if (cr.x < -0.06 || cr.x > 1.06) { dead = true; break; }
          cr.dig = dig;
          cr.bury = bury;
          cr.pat = pat;
          break;
        }
        case "litter": {
          // a scrap of leaf-mould thrown back out of a squirrel's hole
          cr.x += cr.vx*dt; cr.y += cr.vy*dt; cr.vy += 0.3*dt;
          if (cr.t > cr.life || cr.y > D.y + 0.015) { dead = true; break; }
          break;
        }
        case "hare": {
          cr.timer -= dt;
          if (cr.mode === "lope") {
            cr.ph += dt*8; cr.x += cr.dir*0.07*dt*D.speed;
            if (cr.timer <= 0) {
              const roll = Math.random();
              // it sits bolt upright to look, or drops its head to the grass
              cr.mode = roll < 0.5 ? "alert" : roll < 0.78 ? "graze" : "lope";
              cr.timer = cr.mode === "lope" ? 1 + Math.random()*1.5 : 1.6 + Math.random()*3;
            }
          } else if (cr.timer <= 0) {
            cr.mode = "lope"; cr.timer = 1.5 + Math.random()*2.4;
            if (Math.random() < 0.25) cr.dir *= -1;
          }
          if (cr.x < -0.1 || cr.x > 1.1) { dead = true; break; }
          break;
        }
        case "hedgehog": {
          cr.timer -= dt;
          cr.actT = (cr.actT || 0) + dt;
          if (cr.mode === "shuffle") {
            cr.x += cr.dir*0.008*dt*D.speed;
            if (cr.timer <= 0) {
              // stops dead, nose up, reading the air
              cr.mode = Math.random() < 0.45 ? "sniffup" : "pause";
              cr.timer = 1 + Math.random()*2.2; cr.actT = 0;
            }
          } else if (cr.timer <= 0) {
            cr.mode = "shuffle"; cr.timer = 2 + Math.random()*3.5;
            if (Math.random() < 0.2) cr.dir *= -1;
          }
          if (cr.x < -0.06 || cr.x > 1.06) { dead = true; break; }
          break;
        }
        case "badger": {
          cr.timer = (cr.timer || 0) - dt;
          cr.actT = (cr.actT || 0) + dt;
          if (cr.mode === "dig") {
            if (cr.timer <= 0) { cr.mode = "trundle"; cr.timer = 4 + Math.random()*6; }
          } else {
            cr.x += cr.dir*0.014*dt*D.speed; cr.lp += dt*5;
            // it stops to rootle at the ground, which is most of what it does
            if (cr.timer <= 0) { cr.mode = "dig"; cr.timer = 2 + Math.random()*3; cr.actT = 0; }
          }
          if (cr.x < -0.1 || cr.x > 1.1) { dead = true; break; }
          break;
        }
        case "otter": {
          cr.timer -= dt;
          if (cr.mode === "swim") {
            cr.x += cr.dir*0.03*dt; cr.ph += dt*3;
            if (cr.timer <= 0) {
              // down for a fish, or over onto its back for a moment
              if (Math.random() < 0.35) { cr.mode = "roll"; cr.timer = 1.6 + Math.random()*1.6; cr.actT = 0; }
              else {
                cr.mode = "under"; cr.timer = 1.2 + Math.random()*1.8;
                this.fishRings.push({ x: cr.x, y: cr.y, age: 0, quiet: true });
              }
            }
          } else if (cr.mode === "roll") {
            cr.actT = (cr.actT || 0) + dt;
            cr.x += cr.dir*0.008*dt*D.speed;
            if (cr.timer <= 0) { cr.mode = "swim"; cr.timer = 2.5 + Math.random()*3; }
          } else {
            cr.x += cr.dir*0.02*dt;
            if (cr.timer <= 0) { cr.mode = "swim"; cr.timer = 2.5 + Math.random()*3; }
          }
          if (cr.x < -0.08 || cr.x > 1.08) { dead = true; break; }
          break;
        }
        case "bee": {
          /* A bee works: it hangs over one flower, then goes to the next in a
             straight line and rather fast. It does not drift about. */
          cr.timer -= dt;
          if (cr.mode === "hover") {
            cr.x += cr.drift*0.25*dt;
            if (cr.timer <= 0) {
              cr.mode = "dart"; cr.timer = 0.4 + Math.random()*0.5;
              cr.tx = Math.max(0, Math.min(1, cr.x + cr.drift*6 + (Math.random() - 0.5)*0.22));
              cr.ty = 0.76 + Math.random()*0.13;
            }
          } else {
            cr.x += (cr.tx - cr.x)*Math.min(1, dt*4.5);
            cr.y += (cr.ty - cr.y)*Math.min(1, dt*4.5);
            if (Math.abs(cr.tx - cr.x) < 0.006 || cr.timer <= 0) {
              cr.mode = "hover"; cr.timer = 0.7 + Math.random()*1.6;
            }
          }
          if (cr.t > cr.life || cr.x < -0.04 || cr.x > 1.04) { dead = true; break; }
          break;
        }
        case "skein": {
          cr.x += cr.vx*dt;
          if (cr.x < -0.25 || cr.x > 1.25) { dead = true; break; }
          break;
        }
      }
      /* Bolting is laid over whatever the animal was already doing rather than
         replacing it: a rabbit that has been startled is still a rabbit
         running its own gait, just going somewhere else and fast. It runs out
         hard and eases off over about a second and a half, and if it makes the
         edge of the frame it is gone — which is what a rabbit does. */
      /* And the wind takes the light ones. A butterfly does not fly through
         a gust, it is carried by it, and that is most of what says the thing
         in the air weighs nothing. A dragonfly is a far better flier and
         hardly notices. */
      const carry = cr.kind === "butterfly" ? 0.115
                  : cr.kind === "bee" ? 0.055
                  : cr.kind === "dragonfly" ? 0.028 : 0;
      if (carry) {
        const push = this.windBend(cr.x);
        cr.x += push * carry * dt;
        cr.y -= Math.max(0, push) * 0.010 * dt;
      }
      /* ---- Coming and going ------------------------------------------

         Depth was decided once when an animal spawned and never touched
         again, so everything in every place travelled strictly left to right
         at a fixed distance. The plane under all five places was being used
         entirely statically.

         `cr.toward` is a rate of change of depth. An animal that has it walks
         a diagonal: it grows or shrinks, its shadow lengthens or tightens,
         it slows as it goes back because the same ground covers fewer pixels
         — every one of those falls out of the plane on its own, and nothing
         in any painter has to know about it.

         It is deliberately not for everything. A butterfly's path is already
         a stitch and a heron standing still is standing still; this is for
         the things that are *going* somewhere. */
      /* ---- and what follows it ---------------------------------------
         A fawn does not walk beside its mother, it walks in her tracks —
         and neither does a fox cub. So a parent with young keeps a short
         history of where it has been, and each young thing is simply the
         parent a second and a half ago, smaller. Everything the young does
         is therefore correct by construction: it stops when she stops, it
         puts its feet where hers went, and it slows going away up the field
         because the plane already said so. */
      if (cr.young) {
        (cr.trail || (cr.trail = [])).push({ t: cr.t, x: cr.x, z: cr.z });
        // three and a half seconds is longer than the longest lag below
        while (cr.trail.length > 2 && cr.t - cr.trail[0].t > 3.5) cr.trail.shift();
      }
      if (cr.toward) {
        const nz = this.nearZ();
        cr.z = Math.max(nz, Math.min(0.99, cr.z + cr.toward*dt));
        // arrived, or gone as far back as the field goes: settle to a line
        if (cr.z <= nz + 0.005 || cr.z >= 0.985) cr.toward = 0;
      }

      if (cr.bolt) {
        cr.boltT += dt;
        const u = Math.max(0, 1 - cr.boltT/1.6);
        cr.x += cr.bolt * 0.55 * u*u * dt;
        if (u <= 0) cr.bolt = 0;
        if (cr.x < -0.08 || cr.x > 1.08) dead = true;
      }
      if (dead) this.critters.splice(i, 1);
    }
  }

  /* …and how all of it looks. Paired case for case with updateCritters above. */
  drawCritters(c, W, H, bot, night) {
    const colDark = css(mix(this.tok.inkDeep, bot, 0.12));
    const colFar = css(mix(this.tok.ink, bot, 0.5));
    for (let i = this.critters.length - 1; i >= 0; i--) {
      const cr = this.critters[i];
      const D = this.groundDepth(cr.z, bot);
      switch (cr.kind) {
        case "butterfly": {
          const al = Math.max(0, Math.min(1, cr.life - cr.t)) * 0.85;
          this.paintButterfly(c, cr.x*W, cr.y*H, cr.t, cr.ph, al, colDark);
          break;
        }
        case "dragonfly": {
          this.paintDragonfly(c, cr.x*W + cr.jx, cr.y*H + cr.jy, cr.t, colDark);
          break;
        }
        case "bat": {
          this.paintBat(c, cr.x*W, cr.y*H, cr.size, cr.t, colDark);
          break;
        }
        case "deer": {
          const walking = cr.state === "enter" || cr.state === "leave" || cr.state === "walkbit";
          const leap = cr.bounding && cr.state === "leave"
            ? gaitPose("bound", cr.bp*TURN) : null;
          const rise = leap ? Math.max(0, leap.rise) : 0;
          const dS = H*0.075*(cr.sz || 1)*D.scale;
          this.contactShadow(c, cr.x*W, D.y*H, dS*0.75, 0.2*(1 - cr.z*0.6)*(1 - rise));
          this.paintDeer(c, { x: cr.x*W, y: (D.y - rise*0.045)*H,
            s: dS, dir: cr.dir,
            head: cr.head, walking, lp: cr.lp, color: D.col, t: cr.t,
            grazing: cr.state === "graze", alert: cr.state === "alert", leap });
          // the fawn, walking where she walked a second ago
          for (const y of (cr.young || [])) {
            const p = this.trailAt(cr, y.lag);
            const zz = Math.max(0.03, Math.min(0.99, p.z + (y.off || 0)));
            const YD = this.groundDepth(zz, bot);
            const yS = dS*y.sz*(YD.scale/Math.max(0.01, D.scale));
            this.contactShadow(c, p.x*W, YD.y*H, yS*0.75, 0.2*(1 - zz*0.6)*(1 - rise));
            this.paintDeer(c, { x: p.x*W, y: (YD.y - rise*0.045)*H,
              s: yS, dir: cr.dir,
              // it does not graze when she does; it stands and watches
              head: 0, walking, lp: cr.lp + 0.7, color: YD.col, t: cr.t + y.lag,
              grazing: false, alert: cr.state === "graze" || cr.state === "alert",
              leap });
          }
          break;
        }
        case "runner": {
          // stopped, it works the wet sand: the bill in, turned about, and out
          const probe = cr.mode === "dash" ? 0 : gaitAt("probe", cr.t*1.1, "dip");
          c.save(); c.translate(cr.x*W, D.y*H); c.scale(D.scale, D.scale);
          this.contactShadow(c, 0, 1, 5, 0.16*(1 - cr.z*0.6));
          this.paintSanderling(c, 0, 0, cr.dir, cr.mode === "dash", cr.ph, D.col, probe);
          c.restore();
          break;
        }
        case "turnstone": {
          c.save(); c.translate(cr.x*W, D.y*H);
          c.scale(D.scale*(cr.sz || 1), D.scale*(cr.sz || 1));
          this.contactShadow(c, 0, 1, 5.5, 0.17*(1 - cr.z*0.6));
          this.paintTurnstone(c, cr.dir, cr.mode === "step", cr.ph, cr.heave || 0, D.col);
          c.restore();
          break;
        }
        case "mob": {
          const oS = H*0.055*(cr.sz || 1);
          const ox = cr.x*W, oy = cr.y*H;
          this.paintOwl(c, { x: ox, y: oy, s: oS, alpha: 1, color: colDark,
            rim: colFar, fly: 1, flip: cr.dir < 0,
            flap: gaitAt("beatSlow", cr.flap*TURN, "beat") });
          // and the escort, each on its own orbit, closing on the dive
          for (const b of cr.birds) {
            const shut = b.diveT > 0 ? 1 - Math.max(0, b.diveT)/0.55 : 0;
            const close = 1 - Math.sin(shut*Math.PI)*0.78;
            const bx = ox + Math.cos(b.ph)*b.r*W*close;
            const by = oy + Math.sin(b.ph)*b.r*b.ry*H*close - oS*0.4;
            this.paintSmallBirdFlight(c, bx, by, oS*0.30,
              Math.cos(b.ph) >= 0 ? 1 : -1, b.flap, colDark);
          }
          break;
        }
        case "lizard": {
          const lS = D.scale*(cr.sz || 1);
          c.save(); c.translate(cr.x*W, D.y*H); c.scale(lS, lS);
          this.contactShadow(c, 0, 0.6, 9, 0.12*(1 - cr.z*0.6));
          this.paintLizard(c, cr.dir, cr.mode === "dart", cr.ph, cr.push || 0, D.col);
          c.restore();
          break;
        }
        case "bather": {
          const pud = this.puddles();
          const p = pud[cr.p];
          const bS = D.scale*(cr.sz || 1);
          const py = D.y + (p ? p.dy : 0)*0.4;
          c.save(); c.translate(cr.x*W, py*H); c.scale(bS, bS);
          this.paintBather(c, cr.dir, cr.mode, cr.ph, cr.splash || 0, D.col,
            `rgba(${this.tok.foamRGB || "230,230,230"}, 1)`);
          c.restore();
          break;
        }
        case "stoat": {
          const leap = cr.mode === "bound" ? gaitPose("weave", cr.bp*TURN) : null;
          const rise = leap ? Math.max(0, leap.rise) : 0;
          const sS = H*0.026*(cr.sz || 1)*D.scale;
          this.contactShadow(c, cr.x*W, D.y*H, sS*1.5, 0.18*(1 - cr.z*0.6)*(1 - rise));
          this.paintStoat(c, { x: cr.x*W, y: D.y*H - rise*sS*0.55, s: sS,
            dir: cr.dir, leap, rear: cr.rear || 0, color: D.col, t: cr.t });
          break;
        }
        case "shelldrop": {
          const gS = 5.5*(cr.sz || 1)*(0.7 + D.scale*0.5);
          // the shell, in the air or lying where it stopped
          if (cr.mode !== "climb") {
            c.fillStyle = D.col;
            c.beginPath();
            c.ellipse(cr.x*W, cr.sy*H, gS*0.30, gS*0.20, cr.sv*0.6, 0, Math.PI*2);
            c.fill();
          }
          if (cr.mode === "pick") this.contactShadow(c, cr.x*W, D.y*H, gS*1.1, 0.15);
          this.paintGullFlight(c, cr.x*W, cr.gy*H, gS, cr.dir,
            cr.mode === "pick" ? 0 : cr.ph, cr.mode === "pick" ? D.col : colDark);
          break;
        }
        case "pigeon": {
          const pS = D.scale*(cr.sz || 1);
          if (cr.fly) {
            const y = cr.y === undefined ? D.y : cr.y;
            this.paintPigeonFlight(c, cr.x*W, y*H, 4.6*pS + 1.6, cr.dir, cr.ph, colDark);
            break;
          }
          c.save(); c.translate(cr.x*W, D.y*H); c.scale(pS, pS);
          this.contactShadow(c, 0, 1, 6.5, 0.17*(1 - cr.z*0.6));
          this.paintPigeon(c, cr.dir, cr.mode === "walk", cr.ph, cr.bob, D.col);
          c.restore();
          break;
        }
        case "moth": {
          const b = this.frontBlocks && this.frontBlocks[cr.b];
          const wnd = b && b.lit[cr.w];
          if (!wnd) break;
          const bx = b.x*W, bw = b.w*W, bh = b.h*H, byTop = H*CITY_GROUND - bh;
          const wx = bx + wnd.u*bw + Math.min(bw*0.11, 7)*0.5;
          const wy = byTop + wnd.v*bh + Math.min(bh*0.045, 10)*0.5;
          this.paintMoth(c, wx + cr.ox*W, wy + cr.oy*H, 2.2*(cr.sz || 1), cr.ph,
            Math.max(0, Math.min(1, Math.min(cr.t, cr.life - cr.t)*1.2)));
          break;
        }
        case "crab": {
          c.save(); c.translate(cr.x*W, D.y*H);
          c.scale(D.scale*(cr.sz || 1), D.scale*(cr.sz || 1));
          this.contactShadow(c, 0, 0.5, 5, 0.14*(1 - cr.z*0.6));
          this.paintCrab(c, cr.dir, cr.mode === "scuttle", cr.ph, cr.claw || 0, D.col);
          c.restore();
          break;
        }
        case "seal": {
          if (cr.up > 0.02) this.paintSeal(c, cr.x*W, cr.y*H, H*0.02*(cr.sz || 1),
            cr.dir, cr.up, cr.look || 0, colDark, colFar);
          break;
        }
        case "cat": {
          const b = this.frontBlocks && this.frontBlocks[cr.b];
          this.paintCat(c, { x: cr.x*W, y: (CITY_GROUND - b.h)*H, dir: cr.dir,
            sit: cr.mode === "sit" || cr.mode === "stretch",
            flat: cr.mode === "sun" ? 1 : 0, t: cr.t, color: colDark,
            groom: cr.act === "groom" ? gaitPose("groom", cr.actT*0.6) : null,
            stretch: cr.mode === "stretch" ? Math.sin(Math.PI*Math.min(1, cr.actT/1.4)) : 0 });
          break;
        }
        case "rabbit": {
          const leap = cr.mode === "hop" ? gaitPose("hop", cr.hopPh*TURN) : null;
          const hop = leap ? Math.max(0, leap.rise) : 0;
          const rS = H*0.032*(cr.sz || 1)*D.scale;
          this.contactShadow(c, cr.x*W, D.y*H, rS*0.8, 0.2*(1 - cr.z*0.6)*(1 - hop));
          this.paintRabbit(c, { x: cr.x*W, y: D.y*H - hop*H*0.035*D.scale, s: rS,
            dir: cr.dir, leap, sit: cr.mode === "sit", ear: cr.ear || 0, color: D.col,
            t: cr.t, nibble: cr.act === "nibble" ? 1 : 0,
            wash: cr.act === "wash" ? gaitPose("groom", cr.actT*0.7) : null });
          break;
        }
        case "fox": {
          const fS = H*0.05*(cr.sz || 1)*D.scale;
          this.contactShadow(c, cr.x*W, D.y*H, fS*0.9,
            0.2*(1 - cr.z*0.6)*(1 - Math.min(1, cr.pose.lift/(fS*0.8))));
          this.paintFox(c, Object.assign({ x: cr.x*W, y: D.y*H, s: fS, dir: cr.dir,
            walking: cr.mode === "trot", lp: cr.lp,
            look: cr.mode === "pause" ? Math.sin(cr.t*1.8) : 0,
            ears: cr.mode === "listen" || cr.mode === "pounce" ? 1 : 0,
            color: D.col }, cr.pose));
          /* Cubs. They get her trail but not her poses: she may be flat to
             the ground listening for a vole, and they are simply behind her
             with their ears up, which is the whole comedy of it. */
          for (const y of (cr.young || [])) {
            const p = this.trailAt(cr, y.lag);
            const zz = Math.max(0.03, Math.min(0.99, p.z + (y.off || 0)));
            const YD = this.groundDepth(zz, bot);
            const yS = H*0.05*(cr.sz || 1)*YD.scale*y.sz;
            this.contactShadow(c, p.x*W, YD.y*H, yS*0.9, 0.2*(1 - zz*0.6));
            this.paintFox(c, { x: p.x*W, y: YD.y*H, s: yS, dir: cr.dir,
              walking: cr.mode === "trot", lp: cr.lp + y.lag*4,
              look: 0, ears: 1, color: YD.col,
              crouch: 0, lift: 0, rot: 0, air: 0, sniff: 0 });
          }
          break;
        }
        case "heron": {
          const nS = H*0.085*(cr.sz || 1)*(cr.mode === "fly" ? 1 : D.scale*0.95);
          if (cr.mode !== "fly") this.contactShadow(c, cr.x*W, cr.y*H, nS*0.4, 0.15*(1 - cr.z*0.6));
          this.paintHeron(c, Object.assign({ x: cr.x*W, y: cr.y*H, s: nS, dir: cr.dir,
            flying: cr.mode === "fly",
            flap: gaitAt("beatSlow", (cr.flap || 0)*TURN, "beat"),
            color: cr.mode === "fly" ? colDark : D.col, deep: colFar, t: cr.t }, cr.pose));
          break;
        }
        case "porpoise": {
          const rl = gaitPose("roll", cr.phase*TURN);
          const arc = rl.arc;
          const px = cr.x*W, wy = cr.base*H;
          if (arc > 0.02 || rl.fluke > 0.02) {
            // pitch follows the arc: nose up on the rise, down on the fall,
            // and the flukes come up last, after the back has gone
            this.paintPorpoise(c, { x: px, y: wy, dir: cr.dir, arc,
              pitch: rl.pitch*0.34, fluke: rl.fluke,
              s: H*0.05, color: colDark, rim: colFar });
          }
          if (arc <= 0.02) {
            // between rolls: a dark shape just under, and the flat "footprint"
            // left on the surface by the last downstroke
            const sub = Math.max(0, 1 + arc*3);
            if (sub > 0.02) {
              c.globalAlpha = 0.18*sub;
              c.fillStyle = colDark;
              c.beginPath();
              c.ellipse(px, wy + H*0.012, H*0.055, H*0.011, 0, 0, Math.PI*2);
              c.fill();
              c.globalAlpha = 1;
            }
            const fp = Math.max(0, 1 + arc*1.6);
            if (fp > 0.02) {
              c.strokeStyle = `rgba(${this.tok.foamRGB}, ${0.26*fp})`;
              c.lineWidth = 1;
              c.beginPath();
              c.ellipse(px - cr.dir*H*0.03, wy, H*0.028*(2 - fp), H*0.008, 0, 0, Math.PI*2);
              c.stroke();
            }
          }
          break;
        }
        case "squirrel": {
          const leap = cr.mode === "bound" ? gaitPose("scamper", cr.ph*TURN) : null;
          // a leap clears its own body's worth of ground, not the frame's
          const hopY = leap ? Math.max(0, leap.rise)*0.018*D.scale : 0;
          const qS = H*0.03*(cr.sz || 1)*D.scale;
          this.contactShadow(c, cr.x*W, D.y*H, qS*0.7, 0.17*(1 - cr.z*0.6)*(1 - hopY*40));
          this.paintSquirrel(c, { x: cr.x*W, y: (D.y - hopY)*H, s: qS,
            dir: cr.dir, sit: cr.mode === "sit", leap, t: cr.t,
            dig: cr.dig, bury: cr.bury, pat: cr.pat, color: D.col });
          break;
        }
        case "litter": {
          c.globalAlpha = Math.max(0, 1 - cr.t/cr.life)*0.7;
          c.fillStyle = D.col;
          c.beginPath();
          c.ellipse(cr.x*W, cr.y*H, H*0.004*cr.sz*D.scale, H*0.002*cr.sz*D.scale,
            cr.t*6, 0, Math.PI*2);
          c.fill();
          c.globalAlpha = 1;
          break;
        }
        case "hare": {
          const leap = cr.mode === "lope" ? gaitPose("lope", cr.ph*TURN) : null;
          const lift = leap ? Math.max(0, leap.rise)*0.024*D.scale : 0;
          const hS = H*0.042*(cr.sz || 1)*D.scale;
          this.contactShadow(c, cr.x*W, D.y*H, hS*0.85, 0.19*(1 - cr.z*0.6)*(1 - lift*40));
          this.paintHare(c, { x: cr.x*W, y: (D.y - lift)*H, s: hS,
            dir: cr.dir, leap, alert: cr.mode === "alert",
            graze: cr.mode === "graze" ? 1 : 0, t: cr.t, color: D.col });
          break;
        }
        case "hedgehog": {
          const gS = H*0.026*(cr.sz || 1)*D.scale;
          this.contactShadow(c, cr.x*W, D.y*H, gS*0.85, 0.18*(1 - cr.z*0.6));
          this.paintHedgehog(c, { x: cr.x*W, y: D.y*H, s: gS,
            dir: cr.dir, t: cr.mode === "shuffle" ? cr.t : 0.1, color: D.col, rim: colFar,
            sniffUp: cr.mode === "sniffup" ? Math.min(1, cr.actT*2) : 0 });
          break;
        }
        case "badger": {
          const bS = H*0.045*(cr.sz || 1)*D.scale;
          this.contactShadow(c, cr.x*W, D.y*H, bS*0.95, 0.2*(1 - cr.z*0.6));
          this.paintBadger(c, { x: cr.x*W, y: D.y*H, s: bS,
            dir: cr.dir, lp: cr.lp, color: D.col,
            dig: cr.mode === "dig" ? gaitPose("dig", cr.actT*1.9) : null });
          break;
        }
        case "otter": {
          if (cr.mode !== "under") {
            this.paintOtter(c, { x: cr.x*W, y: cr.y*H, s: H*0.03*(cr.sz || 1),
              dir: cr.dir, ph: cr.ph, color: colDark,
              roll: cr.mode === "roll" ? Math.sin(Math.PI*Math.min(1, cr.actT/3)) : 0 });
          }
          break;
        }
        case "bee": {
          const alB = Math.max(0, Math.min(1, (cr.life - cr.t)))*0.9;
          c.globalAlpha = alB;
          this.paintBee(c, cr.x*W, (cr.y + Math.sin(cr.t*14)*0.004)*H,
            H*0.008*(cr.sz || 1), cr.t, colDark);
          c.globalAlpha = 1;
          break;
        }
        case "skein": {
          const trail = -Math.sign(cr.vx);
          const gdir = Math.sign(cr.vx);
          c.strokeStyle = colFar; c.fillStyle = colFar; c.lineCap = "round";
          for (let k = 0; k < cr.nb; k++) {
            const side = k % 2 === 0 ? 1 : -1;
            const rank = Math.ceil(k/2);
            const bx = (cr.x + trail*rank*0.016)*W;
            const by2 = (cr.y + side*rank*0.011)*H;
            this.paintGoose(c, bx, by2, gdir,
              gaitAt("beatSlow", (cr.t*7 + k)*TURN, "beat"));
          }
          break;
        }
      }
    }
  }

  /* Where a parent was, `lag` seconds ago. Linear between the two samples
     that straddle it, so a young thing does not shudder along at the rate
     the trail was recorded. Before there is enough history it simply stands
     where the parent is, which is what it looks like anyway at the moment
     one walks into frame. */
  trailAt(cr, lag) {
    const tr = cr.trail;
    if (!tr || tr.length < 2) return { x: cr.x, z: cr.z };
    const want = cr.t - lag;
    if (want <= tr[0].t) return { x: tr[0].x, z: tr[0].z };
    for (let i = tr.length - 1; i > 0; i--) {
      if (tr[i - 1].t <= want) {
        const a = tr[i - 1], b = tr[i];
        const u = (want - a.t)/Math.max(1e-4, b.t - a.t);
        return { x: a.x + (b.x - a.x)*u, z: a.z + (b.z - a.z)*u };
      }
    }
    return { x: cr.x, z: cr.z };
  }

  /* A filled tapered segment — width w0 at (x0,y0), w1 at (x1,y1) — so legs and
     necks read as solid mass rather than wire. */
  limb(c, x0, y0, x1, y1, w0, w1) {
    const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy) || 1;
    const nx = -dy/len*0.5, ny = dx/len*0.5;
    c.beginPath();
    c.moveTo(x0 + nx*w0, y0 + ny*w0);
    c.lineTo(x1 + nx*w1, y1 + ny*w1);
    c.lineTo(x1 - nx*w1, y1 - ny*w1);
    c.lineTo(x0 - nx*w0, y0 - ny*w0);
    c.closePath(); c.fill();
  }

  /* A two-segment leg — hip to knee to foot — as filled tapers, so a gait
     reads as articulation rather than a swinging wire. bend bows the joint
     sideways as a fraction of leg length. */
  leg(c, hx, hy, fx, fy, bend, w0, w1) {
    const mx = (hx + fx)/2, my = (hy + fy)/2;
    const dx = fx - hx, dy = fy - hy, len = Math.hypot(dx, dy) || 1;
    const kx = mx - dy*bend, ky = my + dx*bend;
    this.limb(c, hx, hy, kx, ky, w0, w1*1.3);
    this.limb(c, kx, ky, fx, fy, w1*1.3, w1*0.8);
  }

  /* A filled wing from shoulder (rx,ry) to wingtip (tx,ty): an arched
     leading edge and a full trailing edge, so flight reads as feathered
     mass rather than wire. */
  wingBlade(c, rx, ry, tx, ty, w) {
    const dx = tx - rx, dy = ty - ry, len = Math.hypot(dx, dy) || 1;
    const nx = -dy/len, ny = dx/len;
    c.beginPath();
    c.moveTo(rx, ry);
    c.quadraticCurveTo(rx + dx*0.45 + nx*w*0.35, ry + dy*0.45 + ny*w*0.35, tx, ty);
    c.quadraticCurveTo(rx + dx*0.72 - nx*w*0.9, ry + dy*0.72 - ny*w*0.9,
                       rx + dx*0.18 - nx*w, ry + dy*0.18 - ny*w);
    c.closePath(); c.fill();
  }

  /* A roe deer.

     walking  its legs run the four-beat `walk`, phase `lp`
     leap     the `bound` pose, when something has moved it on
     grazing  the `graze` cycle, bite and chew, head already down
     head     0 up, 1 down in the sward — the slow lowering between the two */
  paintDeer(c, o) {
    const s = o.s, t = o.t || 0;
    const leap = o.leap || null;
    const walking = o.walking && !leap;
    const wb = walking ? gaitPose("walk", (o.lp || 0)*TURN) : null;
    const gz = o.grazing ? gaitPose("graze", t*0.5) : null;
    c.save();
    c.translate(o.x, o.y);
    if (o.dir < 0) c.scale(-1, 1);
    c.fillStyle = o.color;
    // body centre — riding up and down over the planted legs at the walk
    const by = -s*0.78 - (wb ? (wb.rise - 0.5)*s*0.045 : 0);
    // In the bound the whole animal pitches about its middle: nose up off the
    // ground, level at the top, nose down into the landing.
    if (leap) { c.translate(0, by); c.rotate(-leap.tilt*0.85); c.translate(0, -by); }
    // legs — jointed and stepping: knees forward on the fore pair, hocks
    // back on the hind, each foot planted through its stance and snatched
    // forward through its swing. Airborne the hind stream out behind and the
    // fore fold up and reach.
    const hips = [[-0.52, 0.09], [-0.32, 0.09], [0.30, -0.08], [0.50, -0.08]];
    const air = leap ? Math.min(1, Math.max(0, leap.rise)*2.4) : 0;
    for (let i = 0; i < 4; i++) {
      const lx = hips[i][0]*s;
      let sw = 0, lift = 0;
      if (walking) {
        gaitFoot(GAIT.walk, (o.lp || 0)*TURN + GAIT.walk.feet[i], FOOT);
        sw = FOOT[0]*0.17*s; lift = FOOT[1]*0.11*s;
      } else if (leap) {
        // the hind stream out behind, the fore reach ahead — and gathered,
        // both fold up under the belly without ever crossing each other
        const k = i < 2 ? leap.hind : leap.fore;
        sw = (i < 2 ? -k*0.30 : k*0.42)*s;
        lift = Math.max(0, -k)*0.30*s*air;
      }
      this.leg(c, lx, by + s*0.16, lx + sw, -lift, hips[i][1], s*0.15, s*0.05);
    }
    // body — chest, a soft back line, round haunch, the belly tucked up. The
    // back rounds over the hips as it gathers and hollows at full stretch.
    const ah = leap ? leap.arch*s*0.14 : 0;
    c.beginPath();
    c.moveTo(s*0.62, by - s*0.30);
    c.quadraticCurveTo(s*0.05, by - s*0.42 - ah, -s*0.45, by - s*0.32 - ah*0.7);
    c.quadraticCurveTo(-s*0.85, by - s*0.25 - ah*0.4, -s*0.88, by + s*0.10);
    c.quadraticCurveTo(-s*0.82, by + s*0.35, -s*0.45, by + s*0.38);
    c.quadraticCurveTo(0, by + s*0.42, s*0.5, by + s*0.32);
    c.quadraticCurveTo(s*0.78, by + s*0.2, s*0.62, by - s*0.30);
    c.closePath(); c.fill();
    // the short tail, flicking now and then — and held up over the rump for
    // the whole of a bound, which is the flash you see going away
    const tf = Math.max(leap ? 0.8 : 0, Math.pow(Math.max(0, Math.sin(t*0.9 + 2)), 16));
    c.save();
    c.translate(-s*0.84, by - s*0.12); c.rotate(-0.5 - tf*0.7);
    c.beginPath(); c.ellipse(-s*0.1, 0, s*0.14, s*0.06, 0, 0, Math.PI*2); c.fill();
    c.restore();
    // Neck and head, lowering to graze — and once it is down, a bite taken and
    // chewed, the muzzle drifting along the sward between mouthfuls. Standing
    // alert the head comes up higher still; at the walk it nods with the
    // stride; in a bound it reaches out ahead of the animal.
    const nib = gz ? (gz.chew*0.045 - (1 - gz.dip)*0.10)*s : 0;
    const hx = s*0.95 + (leap ? leap.stretch*s*0.18 : 0)
             + (gz ? gz.sway*s*0.12 : 0) + (wb ? wb.nod*s*0.02 : 0);
    const hy = -s*1.46 + o.head*s*1.34 + nib - (o.alert ? s*0.1 : 0)
             + (wb ? wb.nod*s*0.035 : 0);
    this.limb(c, s*0.52, by - s*0.10, hx, hy, s*0.34, s*0.16);
    // head — brow, tapering muzzle, jaw
    c.save(); c.translate(hx, hy); c.rotate(o.head*0.95);
    c.beginPath();
    c.moveTo(-s*0.12, -s*0.14);
    c.quadraticCurveTo(s*0.18, -s*0.16, s*0.34, -s*0.02);
    c.quadraticCurveTo(s*0.36, s*0.05, s*0.3, s*0.07);
    c.quadraticCurveTo(s*0.05, s*0.14, -s*0.12, s*0.10);
    c.closePath(); c.fill();
    c.restore();
    // tall ears, swivelling at a sound — and pricked hard forward when it
    // has heard something and is standing to work out what
    const al = o.alert ? 1 : 0;
    const ef = al ? 1 : Math.pow(Math.max(0, Math.sin(t*0.7 + 5)), 14);
    c.beginPath();
    c.ellipse(hx - s*0.05, hy - s*0.17 - al*s*0.03, s*0.055, s*(0.15 + al*0.02), -0.5 - ef*0.4, 0, Math.PI*2);
    c.ellipse(hx + s*0.12, hy - s*0.16 - al*s*0.03, s*0.055, s*(0.15 + al*0.02), 0.1 + ef*0.3, 0, Math.PI*2);
    c.fill();
    // eye
    c.fillStyle = css(mix(this.tok.ink, this.tok.moon, 0.45));
    c.beginPath(); c.arc(hx + s*0.08, hy - s*0.04, Math.max(0.6, s*0.035), 0, Math.PI*2); c.fill();
    c.restore();
  }

  paintCat(c, o) {
    c.save();
    c.translate(o.x, o.y);
    if (o.dir < 0) c.scale(-1, 1);
    c.fillStyle = o.color;
    const sway = Math.sin(o.t*2)*1.6;
    const tip = Math.sin(o.t*3.1)*1.4;           // the tail-tip's own restlessness
    if (o.flat) {
      /* Asleep in the sun: on its side, poured over the tiles, and the only
         thing moving is the ribcage. Everything is drawn along the ground —
         no upright anything — which is what makes it read as sleep and not
         as a cat that has stopped. */
      const breath = Math.sin(o.t*1.5)*0.28;
      // tail, laid out flat behind and stirring once in a while
      c.beginPath();
      c.moveTo(-4.6, -1.2);
      c.quadraticCurveTo(-8.4, -1.6 + tip*0.3, -11.4, -0.2 + tip*0.7);
      c.quadraticCurveTo(-8.6, -0.2, -4.6, -0.2);
      c.closePath(); c.fill();
      // the body: one long low mound, deepest at the shoulder
      c.beginPath();
      c.moveTo(-5.0, -0.3);
      c.quadraticCurveTo(-4.4, -3.4 - breath, -0.6, -3.9 - breath);
      c.quadraticCurveTo(3.4, -4.3 - breath, 5.6, -2.6);
      c.quadraticCurveTo(6.6, -1.4, 5.6, -0.3);
      c.closePath(); c.fill();
      // head down on the tiles, ears flat to the line of it
      c.beginPath(); c.ellipse(6.6, -1.5, 2.3, 1.7, -0.1, 0, Math.PI*2); c.fill();
      c.beginPath();
      c.moveTo(5.6, -2.8); c.lineTo(5.0, -4.3); c.lineTo(6.8, -3.1);
      c.moveTo(7.6, -2.9); c.lineTo(8.9, -4.0); c.lineTo(8.6, -2.4);
      c.closePath(); c.fill();
      // and the forepaws out in front, which is the whole of the pose
      c.beginPath(); c.ellipse(8.4, -0.5, 2.4, 0.7, 0, 0, Math.PI*2); c.fill();
      c.beginPath(); c.ellipse(-3.4, -0.5, 1.4, 0.6, 0, 0, Math.PI*2); c.fill();
      c.restore();
      return;
    }
    if (o.sit) {
      // tail wrapped round the haunches, its tip stirring
      c.beginPath();
      c.moveTo(-2.8, -1);
      c.quadraticCurveTo(-6.8, -0.8, -7.2, -3.4);
      c.quadraticCurveTo(-7.4 + tip, -5.8, -6.2 + tip, -7);
      c.quadraticCurveTo(-6.5, -4.4, -5.2, -2.2);
      c.quadraticCurveTo(-3.6, -0.6, -1.6, -1.2);
      c.closePath(); c.fill();
      const st = o.stretch || 0;
      if (st > 0.05) {
        // the full stretch: chest down on the ground, forelegs reaching away,
        // haunches up behind, tail straight over the back
        c.beginPath();
        c.moveTo(-4.6, -6.2);
        c.quadraticCurveTo(0, -5.2, 5.2, -1.6);
        c.quadraticCurveTo(6.4, -0.6, 5.2, -0.2);
        c.quadraticCurveTo(0, -0.6, -4.6, -2.2);
        c.closePath(); c.fill();
        c.beginPath(); c.ellipse(-4.4, -4.6, 3.2, 3.4, 0, 0, Math.PI*2); c.fill();  // raised rump
        c.beginPath(); c.ellipse(7.2, -0.4, 2.6, 0.9, 0.06, 0, Math.PI*2); c.fill(); // reaching paws
        c.beginPath(); c.ellipse(-4.2, -0.6, 1.2, 0.7, 0, 0, Math.PI*2); c.fill();   // hind foot
        // head low between the shoulders
        c.beginPath(); c.arc(6.6, -2.4, 2.1, 0, Math.PI*2); c.fill();
        c.beginPath();
        c.moveTo(5.2, -3.8); c.lineTo(4.8, -5.8); c.lineTo(6.5, -4.4);
        c.moveTo(7.4, -4.1); c.lineTo(8.4, -5.7); c.lineTo(8.4, -3.8);
        c.closePath(); c.fill();
        c.restore();
        return;
      }
      // haunches, upright chest, forepaws set together
      c.beginPath(); c.ellipse(0, -3.4, 3.7, 4.3, 0, 0, Math.PI*2); c.fill();
      c.beginPath(); c.ellipse(-1.2, -1.5, 3.5, 1.9, 0, 0, Math.PI*2); c.fill();
      c.beginPath(); c.ellipse(1.2, -5.8, 2.1, 3.4, 0.1, 0, Math.PI*2); c.fill();
      // The wash, in the order a cat does it: the paw comes up to the mouth,
      // is licked twice, and is then swept back over the ear — with the head
      // stooping to meet it and turning away as it goes over.
      const wa = o.groom || null;
      const gr = wa ? wa.reach : 0;
      const lk = wa ? -1.5*gr + wa.turn*1.4 : Math.sin(o.t*0.7)*0.8;
      const hyC = -9.4 + gr*3.6 + (wa ? wa.lick*0.5 : 0);
      // the near forepaw: set down in front, or up at the muzzle
      const px = 2.2 + gr*(lk - 1.4), py = -0.4 - gr*7.2 - (wa ? wa.turn*1.6 : 0);
      if (gr > 0.05) this.limb(c, 1.6, -2.6, px, py, 1.5, 1.0);
      c.beginPath(); c.ellipse(px, py, 1.5, 0.8, gr*0.9, 0, Math.PI*2); c.fill();
      c.beginPath(); c.arc(1.2 + lk, hyC, 2.4, 0, Math.PI*2); c.fill();
      c.beginPath();
      c.moveTo(-0.6 + lk, hyC - 1.5); c.lineTo(-1.2 + lk, hyC - 3.7); c.lineTo(0.9 + lk, hyC - 2.1);
      c.moveTo(1.9 + lk, hyC - 1.9); c.lineTo(3.3 + lk, hyC - 3.5); c.lineTo(3.3 + lk, hyC - 1.4);
      c.closePath(); c.fill();
    } else {
      // tail carried high, curling over at the tip
      c.beginPath();
      c.moveTo(-5.4, -3.4);
      c.quadraticCurveTo(-8.8 + sway, -5.2, -9 + sway + tip*0.5, -9.6);
      c.quadraticCurveTo(-8.6 + sway + tip, -11.4, -7.4 + sway + tip, -11.8);
      c.quadraticCurveTo(-8 + sway, -9.6, -7.6 + sway, -8.6);
      c.quadraticCurveTo(-7.6, -5.2, -4.6, -2.6);
      c.closePath(); c.fill();
      // Legs — the four-beat `pad`, each paw carried high and folded through
      // its swing and planted for two thirds of the stride, which is what
      // makes a cat's walk look considered rather than hurried.
      const u = o.t*8*TURN;
      for (let i = 0; i < 4; i++) {
        const lx = -3.6 + i*2.5;
        gaitFoot(GAIT.pad, u + GAIT.pad.feet[i], FOOT);
        const sw2 = FOOT[0]*1.1, lift = FOOT[1]*0.85;
        this.limb(c, lx, -2, lx + sw2, -lift, 1.6, 0.8);
        c.beginPath(); c.ellipse(lx + sw2 + 0.3, -lift, 0.7, 0.4, 0, 0, Math.PI*2); c.fill();
      }
      // long low body, shoulder and haunch, riding over the planted legs
      const pb = gaitPose("pad", u);
      const bob = (pb.rise - 0.5)*0.55;
      c.beginPath(); c.ellipse(0, -3.5 + bob, 6, 2.6, pb.pitch*0.9, 0, Math.PI*2); c.fill();
      c.beginPath(); c.arc(4.7, -4 + bob - pb.rise*0.2, 2.4, 0, Math.PI*2); c.fill();
      c.beginPath(); c.arc(-4.4, -4 + bob + pb.rise*0.2, 2.2, 0, Math.PI*2); c.fill();
      // head nodding with the walk, muzzle forward
      const hb = bob*0.7 + pb.nod*0.4;
      c.beginPath(); c.arc(6.5, -5.4 + hb, 2.3, 0, Math.PI*2); c.fill();
      c.beginPath();
      c.moveTo(4.9, -7 + hb); c.lineTo(4.5, -9 + hb); c.lineTo(6.3, -7.4 + hb);
      c.moveTo(7.3, -7.1 + hb); c.lineTo(8.2, -8.9 + hb); c.lineTo(8.1, -6.9 + hb);
      c.closePath(); c.fill();
      c.beginPath(); c.ellipse(8.1, -4.9 + hb, 1.0, 0.7, 0.2, 0, Math.PI*2); c.fill();
    }
    c.restore();
  }

  /* A rabbit. `leap` is the `hop` cycle — gather, drive, stretch, reach, and
     the hind swinging through under it to land; without one it is sitting,
     and then `nibble` and `wash` have it. */
  paintRabbit(c, o) {
    const s = o.s;
    const g = o.leap || null;
    const st = g ? g.stretch : 0;          // 0 bunched on the ground, 1 stretched mid-leap
    const hs = g ? (g.hind + 1)/2 : 0;     // the hind, tucked under to driven out behind
    const fs = g ? (g.fore + 1)/2 : 0;     // the fore, folded up to reaching ahead
    const arch = g ? g.arch : 0;
    // Nothing folds while a foot is still on the ground: the legs only gather
    // up under the animal once it is off it.
    const air = g ? Math.min(1, Math.max(0, g.rise)*2.4) : 0;
    const hFold = g ? Math.max(0, -g.hind)*air : 0;
    const fFold = g ? Math.max(0, -g.fore)*air : 0;
    c.save();
    c.translate(o.x, o.y);
    if (o.dir < 0) c.scale(-1, 1);
    if (g) { c.translate(0, -s*0.5); c.rotate(-g.tilt*0.26); c.translate(0, s*0.5); }
    c.fillStyle = o.color; c.strokeStyle = o.color;
    c.lineCap = "round";
    // cotton tail
    c.beginPath(); c.arc(-s*(0.72 + st*0.2), -s*0.45 - arch*s*0.06, s*0.2, 0, Math.PI*2); c.fill();
    // hind legs — folded haunch at rest, driving out behind at the launch,
    // gathered up in flight, swinging through ahead of it to land
    const hfx = -s*0.45 - hs*s*0.5;
    const hfy = -s*0.06 - hs*s*0.15 - hFold*s*0.30;
    this.limb(c, -s*0.45, -s*0.4, hfx, hfy, s*0.42, s*0.12);
    c.lineWidth = Math.max(1, s*0.1);
    c.beginPath();
    c.moveTo(hfx, hfy);
    c.lineTo(hfx + s*0.25 - hs*s*0.2, hfy + s*0.04);
    c.stroke();
    // body — bunched and round-backed at rest, long and hollow in the air
    c.beginPath();
    c.ellipse(-st*s*0.08, -s*0.5 - arch*s*0.04, s*(0.8 + st*0.25), s*(0.56 - st*0.12),
      -st*0.15, 0, Math.PI*2);
    c.fill();
    // head and muzzle — down in the grass when it is cropping
    const nb = o.nibble ? gaitPose("graze", (o.t || 0)*0.85) : null;
    const nib = nb ? 1 : 0;
    const bob = nb ? (nb.chew*0.05 - (1 - nb.dip)*0.09)*s : 0;
    const hx = s*(0.66 + st*0.18) + (nb ? nb.sway*s*0.10 : 0);
    const hy = -s*(0.95 + st*0.05) - st*s*0.08 + nib*s*0.62 + bob;
    c.beginPath(); c.arc(hx, hy, s*0.33, 0, Math.PI*2); c.fill();
    c.beginPath(); c.ellipse(hx + s*0.26, hy + s*0.06, s*0.13, s*0.10, 0.2, 0, Math.PI*2); c.fill();
    // long ears — laid back mid-leap, up and swivelling at rest
    const ea = o.ear || 0;
    const back = st*0.9 - ea*0.35;
    this.limb(c, hx - s*0.05, hy - s*0.14, hx - s*0.2 - back*s*0.5, hy - s*0.9 + back*s*0.35, s*0.16, s*0.08);
    this.limb(c, hx + s*0.13, hy - s*0.12, hx + s*0.1 - back*s*0.55, hy - s*0.95 + back*s*0.4, s*0.16, s*0.08);
    // forelegs — reaching for the landing, folded up under the chest at the
    // top of the leap, tucked neatly under at rest, or up at the face to wash
    if (o.wash) {
      // both forepaws up at the face — raised, licked twice, swept back over
      // the ears and down, which is the order a rabbit washes in
      const w = o.wash;
      const wx = hx + s*0.14 - w.turn*s*0.34, wy = hy + s*0.20 - w.reach*s*0.26;
      this.limb(c, s*0.42, -s*0.5, wx, wy + w.lick*s*0.05, s*0.13, s*0.07);
      this.limb(c, s*0.5, -s*0.5, wx + s*0.13, wy - s*0.05 - w.lick*s*0.06, s*0.12, s*0.07);
    } else {
      const ffx = s*(0.5 + fs*0.45);
      const ffy = -s*0.02 - fFold*s*0.42;
      this.limb(c, s*0.42, -s*0.3 - st*s*0.25, ffx, ffy, s*0.14, s*0.07);
    }
    // eye glint
    c.fillStyle = css(mix(this.tok.ink, this.tok.moon, 0.5));
    c.beginPath(); c.arc(hx + s*0.12, hy - s*0.05, Math.max(0.7, s*0.07), 0, Math.PI*2); c.fill();
    c.restore();
  }

  /* A red fox. Trotting it is all length and low carriage; listening it drops
     its chest, brings its ears forward and stops dead. The mousing pounce is
     the shape everyone knows — up almost vertically off the hind legs, front
     paws pressed together, and down nose-first into the grass with the rump
     in the air — so it is drawn as one continuous arc of pitch rather than a
     hop: `rot` swings the whole animal from nose-up at the launch through
     nose-down at the top to head-buried on landing.

     air    0 on the ground, 1 with all four feet clear
     lift   how far off the ground, in pixels
     rot    body pitch, positive nose-down
     crouch gathered low over the forelegs
     ears   ears locked forward on a sound */
  paintFox(c, o) {
    const s = o.s, t = o.t || 0;
    const air = o.air || 0, rot = o.rot || 0, crouch = o.crouch || 0;
    c.save();
    c.translate(o.x, o.y);
    if (o.dir < 0) c.scale(-1, 1);
    c.translate(0, -(o.lift || 0));
    if (rot) { c.translate(0, -s*0.5); c.rotate(rot); c.translate(0, s*0.5); }
    c.fillStyle = o.color;
    // The trot: two beats, the diagonal pairs swinging together, and the body
    // rising over each of them.
    const tb = o.walking ? gaitPose("trot", (o.lp || 0)*TURN) : null;
    const bounce = tb ? tb.rise*s*0.055 : 0;
    const drop = crouch*s*0.16;              // chest lowered over the forefeet
    // Legs. On the ground: diagonal pairs at the trot, jointed, feet lifting.
    // Airborne: the hind pair streams out behind and the forepaws come
    // together under the chin, which is what the leap actually looks like.
    if (air > 0.05) {
      // Hind legs folded up under the belly, forepaws pressed together and
      // held out in front of the chest: the fox arrives as a closed arrow,
      // not spread-eagled.
      this.leg(c, -s*0.42, -s*0.44 - drop, -s*0.60, -s*0.30, -0.26, s*0.15, s*0.05);
      this.leg(c, -s*0.24, -s*0.44 - drop, -s*0.44, -s*0.24, -0.24, s*0.14, s*0.05);
      this.leg(c, s*0.44, -s*0.50 - drop, s*0.78, -s*0.28, 0.10, s*0.13, s*0.05);
      this.leg(c, s*0.50, -s*0.48 - drop, s*0.82, -s*0.22, 0.10, s*0.12, s*0.05);
    } else {
      const off = [-0.5, -0.26, 0.32, 0.56];
      for (let i = 0; i < 4; i++) {
        const lx = off[i]*s;
        let sw = 0, lift = 0;
        if (o.walking) {
          gaitFoot(GAIT.trot, (o.lp || 0)*TURN + GAIT.trot.feet[i], FOOT);
          sw = FOOT[0]*0.22*s; lift = FOOT[1]*0.15*s;
        }
        // crouched, the hind legs fold up under the animal and the fore stay planted
        const fold = i < 2 ? crouch*s*0.16 : 0;
        this.leg(c, lx, -s*0.42 - bounce - drop + fold, lx + sw*(1 - crouch), -lift,
          i < 2 ? 0.10 + crouch*0.14 : -0.08, s*0.14, s*0.05);
      }
    }
    // The brush: streaming behind at the trot, flagged straight out and level
    // in the air, held high as it noses into the grass.
    const tsw = o.walking ? Math.sin(o.lp*0.5)*0.1 : Math.sin(t*1.2)*0.06;
    const tRise = air*s*0.26 + crouch*s*0.06;
    c.beginPath();
    c.moveTo(-s*0.55, -s*0.56 - bounce - drop);
    c.quadraticCurveTo(-s*1.15, -s*0.7 + tsw*s - tRise, -s*1.5, -s*0.55 + tsw*s*2 - tRise*1.4);
    c.quadraticCurveTo(-s*1.62, -s*0.48 + tsw*s*2 - tRise*1.4, -s*1.52, -s*0.38 + tsw*s*2 - tRise*1.3);
    c.quadraticCurveTo(-s*1.05, -s*0.28 + tsw*s - tRise*0.8, -s*0.52, -s*0.42 - bounce - drop);
    c.closePath(); c.fill();
    // the white tag at the tip of the brush
    c.fillStyle = `rgba(${this.tok.foamRGB}, 0.55)`;
    c.beginPath();
    c.ellipse(-s*1.5, -s*0.46 + tsw*s*2 - tRise*1.35, s*0.12, s*0.08, -0.2, 0, Math.PI*2);
    c.fill();
    c.fillStyle = o.color;
    // low sleek body with a deep chest
    c.beginPath();
    c.moveTo(s*0.6, -s*0.72 - bounce - drop);
    c.quadraticCurveTo(0, -s*0.85 - bounce - drop*0.6, -s*0.55, -s*0.72 - bounce);
    c.quadraticCurveTo(-s*0.9, -s*0.6 - bounce, -s*0.8, -s*0.42 - bounce);
    c.quadraticCurveTo(-s*0.3, -s*0.3 - bounce, s*0.4, -s*0.38 - bounce - drop);
    c.quadraticCurveTo(s*0.75, -s*0.45 - bounce - drop, s*0.6, -s*0.72 - bounce - drop);
    c.closePath(); c.fill();
    c.beginPath();
    c.ellipse(s*0.5, -s*0.52 - bounce - drop, s*0.24, s*0.3, 0.2, 0, Math.PI*2); c.fill();
    // Head — carried low, turning to listen when paused, right down to the
    // ground when following a scent, and pushed out in front on the leap so
    // the animal arrives nose-first.
    const lk = o.look || 0, sniff = o.sniff || 0;
    const reach = air*s*0.12;
    const hx = s*0.82 + lk*s*0.05 + reach + sniff*s*0.08 + (tb ? tb.nod*s*0.02 : 0);
    const hy = -s*0.72 - lk*s*0.10 - bounce - drop*0.8 + sniff*s*0.5
             + (tb ? tb.nod*s*0.03 : 0);
    this.limb(c, s*0.5, -s*0.6 - bounce - drop, hx, hy, s*0.3, s*0.2);
    c.beginPath(); c.arc(hx, hy, s*0.21, 0, Math.PI*2); c.fill();
    // tapered snout
    c.beginPath();
    c.moveTo(hx + s*0.06, hy - s*0.1);
    c.quadraticCurveTo(hx + s*0.4, hy - s*0.02, hx + s*0.55, hy + s*0.08);
    c.lineTo(hx + s*0.08, hy + s*0.17);
    c.closePath(); c.fill();
    // Tall pricked ears — angled with the head, swung hard forward and
    // together when it has something located.
    const fwd = (o.ears || 0)*s*0.10;
    c.beginPath();
    c.moveTo(hx - s*0.14, hy - s*0.08);
    c.lineTo(hx - s*0.20 - lk*s*0.04 + fwd, hy - s*0.42);
    c.lineTo(hx + s*0.02 + fwd, hy - s*0.16);
    c.closePath();
    c.moveTo(hx + s*0.08, hy - s*0.12);
    c.lineTo(hx + s*0.12 + lk*s*0.04 + fwd, hy - s*0.44);
    c.lineTo(hx + s*0.26 + fwd, hy - s*0.14);
    c.closePath();
    c.fill();
    // eye
    c.fillStyle = css(mix(this.tok.ink, this.tok.moon, 0.5));
    c.beginPath(); c.arc(hx + s*0.1, hy - s*0.02, Math.max(0.6, s*0.035), 0, Math.PI*2); c.fill();
    c.restore();
  }

  /* A grey heron. Everything about the bird is in the neck: coiled into the
     shoulders when it is waiting, drawn out and swaying when it is watching,
     fired straight down when it strikes, and folded into a tight kink the
     moment it is airborne — which is what tells a heron from a crane or a
     stork at any distance.

     Poses, all optional and all 0..1:
       neck    how far the neck is drawn up out of the shoulders
       strike  the stab: the neck uncoils down and forward
       gulp    the swallow that follows, running up the throat
       step    a foot lifted and set down again, with the body carried over it
       preen   the bill turned back into the scapulars
       rouse   feathers shaken out, the whole bird a size larger for a moment
       crouch  gathered to launch
       flying  wings out, neck kinked, legs trailing (with flap for the beat) */
  paintHeron(c, o) {
    const s = o.s, t = o.t || 0, sing = o.sing || 0;
    const pale = o.pale ? `rgba(${this.tok.foamRGB}, 0.92)` : null;
    const body = pale || o.color;
    c.save();
    c.translate(o.x, o.y);
    if (o.dir < 0) c.scale(-1, 1);
    if (o.alpha !== undefined) c.globalAlpha = o.alpha;
    c.fillStyle = body; c.strokeStyle = body;
    c.lineCap = "round"; c.lineJoin = "round";

    if (o.flying) { this.heronFlight(c, o, body, pale); c.restore(); return; }

    const strike = o.strike || 0, gulp = o.gulp || 0, crouch = o.crouch || 0;
    const preen = o.preen || 0, rouse = o.rouse || 0;
    const step = o.step || 0;
    // Neck: coiled by default, drawn up as it takes an interest.
    const neck = Math.max(0, Math.min(1, o.neck === undefined ? 0.55 : o.neck));
    const breathe = Math.sin(t*1.1)*0.012;

    // ---- legs: long, and jointed backwards at the heel ----
    // The standing leg carries the weight; the other lifts, swings and is set
    // down deliberately, which is the whole of a heron's stalk.
    const hipY = -s*0.52 - crouch*s*0.10;
    const swing = Math.sin(step*Math.PI*2)*s*0.20;
    const lift = Math.max(0, Math.sin(step*Math.PI))*s*0.26;
    const cock = step > 0 ? 0 : Math.pow(Math.max(0, Math.sin(t*0.3 + 1)), 8);
    c.fillStyle = body;
    this.leg(c, -s*0.02, hipY, -s*0.06, 0, -0.16, s*0.075, s*0.035);
    this.leg(c, s*0.12, hipY, s*0.14 + swing, -lift - cock*s*0.22, -0.16, s*0.075, s*0.035);
    // long spread toes on the planted foot
    if (pale) c.fillStyle = `rgba(${this.tok.amberRGB}, 0.9)`;
    c.lineWidth = Math.max(0.8, s*0.03);
    c.strokeStyle = pale ? `rgba(${this.tok.amberRGB}, 0.9)` : body;
    c.beginPath();
    c.moveTo(-s*0.06, 0); c.lineTo(s*0.10, s*0.01);
    c.moveTo(-s*0.06, 0); c.lineTo(-s*0.20, s*0.01);
    // The lifted foot loses its toes; the planted one keeps them. `lift` is in
    // pixels and `cock` is a fraction, and the old test added them together —
    // so the bird stood about with one foot missing whenever `cock` was
    // anything at all above a hundredth, which is most of the time.
    const off2 = lift + cock*s*0.22;
    if (off2 < s*0.02) {
      c.moveTo(s*0.14 + swing, 0); c.lineTo(s*0.30 + swing, s*0.01);
      c.moveTo(s*0.14 + swing, 0); c.lineTo(s*0.02 + swing, s*0.01);
    }
    c.stroke();
    c.fillStyle = body; c.strokeStyle = body;

    // ---- body: deep-keeled, hunched, the folded wing over the flank ----
    const by = -s*0.78 - crouch*s*0.06;
    const puff = 1 + rouse*0.16;
    c.beginPath();
    c.moveTo(s*0.34, by - s*0.14);
    c.quadraticCurveTo(-s*0.16, by - s*0.30*puff, -s*0.52, by - s*0.10*puff);
    c.quadraticCurveTo(-s*0.86, by + s*0.06, -s*0.78, by + s*0.20);
    c.quadraticCurveTo(-s*0.30, by + s*0.36*puff, s*0.16, by + s*0.26);
    c.quadraticCurveTo(s*0.44, by + s*0.14, s*0.34, by - s*0.14);
    c.closePath(); c.fill();
    // the folded wing, a long grey shield laid down the flank
    c.fillStyle = pale ? `rgba(${this.tok.foamRGB}, 0.72)` : (o.deep || o.color);
    c.beginPath();
    c.moveTo(s*0.20, by - s*0.14);
    c.quadraticCurveTo(-s*0.24, by - s*0.20, -s*0.62, by + s*0.02);
    c.quadraticCurveTo(-s*0.80, by + s*0.12, -s*0.72, by + s*0.20);
    c.quadraticCurveTo(-s*0.24, by + s*0.28, s*0.16, by + s*0.16);
    c.closePath(); c.fill();
    c.fillStyle = body;
    // scapular plumes trailing past the tail
    c.strokeStyle = body;
    c.lineWidth = Math.max(0.8, s*0.032);
    c.beginPath();
    for (let k = 0; k < 3; k++) {
      const y0 = by - s*0.16 + k*s*0.07;
      c.moveTo(-s*0.30, y0);
      c.quadraticCurveTo(-s*0.62, y0 + s*0.02, -s*0.86 - rouse*s*0.06, y0 + s*0.12);
    }
    c.stroke();

    // ---- neck and head ----
    // Rest is a tight S folded back on itself; drawn up, the S opens out.
    // The strike straightens it altogether and drives the bill at the water.
    const sway = Math.sin(t*0.5)*s*0.02*(0.3 + neck);
    const baseX = s*0.16, baseY = by - s*0.16;
    const up = neck*(1 - strike);
    const kinkX = baseX + s*(0.34 - up*0.22) + sway;
    const kinkY = baseY - s*(0.30 + up*0.34);
    let hx = baseX + s*(0.02 + up*0.30) + sway - preen*s*0.5;
    let hy = baseY - s*(0.48 + up*0.62) + preen*s*0.42;
    let bAng = -0.06 - up*0.06;                       // the bill's own angle
    if (strike > 0.001) {
      // uncoiled: the head is thrown down and forward past the feet
      const e = strike*strike;
      hx = baseX + s*(0.30 + e*0.72);
      hy = baseY - s*0.30 + e*s*1.30;
      bAng = 0.55 + e*0.55;
    }
    // the throat, running a swallow up to the head
    c.fillStyle = body;
    const g1 = gulp;
    this.limb(c, baseX, baseY, kinkX, kinkY,
      s*0.15*(1 + g1*0.5*Math.max(0, 1 - Math.abs(g1 - 0.3)*3)), s*0.10);
    this.limb(c, kinkX, kinkY, hx, hy,
      s*0.10*(1 + g1*0.9*Math.max(0, 1 - Math.abs(g1 - 0.7)*3)), s*0.075);
    // head
    c.beginPath();
    c.ellipse(hx, hy, s*0.13, s*0.095, bAng - 0.1, 0, Math.PI*2); c.fill();
    // the dagger: long, straight, heavy at the base
    if (pale) c.fillStyle = o.color;
    else c.fillStyle = `rgba(${this.tok.amberRGB}, 0.85)`;
    const bl = s*0.56, hg = sing*s*0.05;
    c.save();
    c.translate(hx, hy); c.rotate(bAng);
    c.beginPath();
    c.moveTo(s*0.04, -s*0.05);
    c.lineTo(bl, -hg*0.4);
    c.lineTo(s*0.04, s*0.005);
    c.closePath(); c.fill();
    c.beginPath();
    c.moveTo(s*0.04, s*0.015);
    c.lineTo(bl*0.94, hg);
    c.lineTo(s*0.04, s*0.06);
    c.closePath(); c.fill();
    c.restore();
    // black crown-stripe drawn back into two trailing crest plumes
    c.strokeStyle = pale ? o.color : (o.deep || o.color);
    c.lineWidth = Math.max(0.8, s*0.038);
    c.beginPath();
    c.moveTo(hx - s*0.02, hy - s*0.07);
    c.quadraticCurveTo(hx - s*0.20, hy - s*0.14, hx - s*0.34, hy - s*0.10);
    c.moveTo(hx - s*0.02, hy - s*0.05);
    c.quadraticCurveTo(hx - s*0.20, hy - s*0.08, hx - s*0.30, hy - s*0.02);
    c.stroke();
    // eye, set forward so it looks along the bill
    c.fillStyle = `rgba(${this.tok.amberRGB}, 0.9)`;
    c.beginPath(); c.arc(hx + s*0.03, hy - s*0.02, Math.max(0.8, s*0.035), 0, Math.PI*2); c.fill();
    c.fillStyle = pale ? o.color : (o.deep || o.color);
    c.beginPath(); c.arc(hx + s*0.035, hy - s*0.02, Math.max(0.4, s*0.018), 0, Math.PI*2); c.fill();
    c.restore();
  }

  /* The heron airborne: the neck folded back into a tight kink against the
     shoulders, legs trailing out well past the tail, and huge bowed wings on
     a slow deliberate beat — the near wing over the body, the far one behind
     it and dimmer, so the span reads as depth rather than as a flat cross. */
  heronFlight(c, o, body, pale) {
    const s = o.s, f = o.flap || 0;
    const A = c.globalAlpha;
    c.fillStyle = body; c.strokeStyle = body;
    // far wing
    c.globalAlpha = A*0.55;
    this.wingBlade(c, -s*0.06, -s*0.10, -s*0.78, -s*0.52*f - s*0.30, s*0.34);
    c.globalAlpha = A;
    // trailing legs, held together and straight out behind
    c.lineWidth = Math.max(1, s*0.042);
    c.beginPath();
    c.moveTo(-s*0.34, s*0.03); c.lineTo(-s*1.02, s*0.12 - f*s*0.03);
    c.moveTo(-s*0.34, s*0.06); c.lineTo(-s*0.98, s*0.18 - f*s*0.03);
    c.stroke();
    c.beginPath();
    c.moveTo(-s*1.02, s*0.12 - f*s*0.03); c.lineTo(-s*1.18, s*0.14 - f*s*0.03);
    c.stroke();
    // body and tail
    c.beginPath(); c.ellipse(0, 0, s*0.48, s*0.17, 0, 0, Math.PI*2); c.fill();
    c.beginPath();
    c.moveTo(-s*0.32, -s*0.10); c.lineTo(-s*0.62, -s*0.02); c.lineTo(-s*0.32, s*0.08);
    c.closePath(); c.fill();
    // the folded neck: a shallow kink tucked down onto the shoulders
    c.fillStyle = body;
    this.limb(c, s*0.34, -s*0.06, s*0.20, -s*0.20, s*0.15, s*0.13);
    this.limb(c, s*0.20, -s*0.20, s*0.48, -s*0.16, s*0.13, s*0.10);
    c.beginPath(); c.ellipse(s*0.54, -s*0.15, s*0.12, s*0.085, -0.1, 0, Math.PI*2); c.fill();
    c.fillStyle = pale ? o.color : `rgba(${this.tok.amberRGB}, 0.85)`;
    c.beginPath();
    c.moveTo(s*0.62, -s*0.18); c.lineTo(s*1.06, -s*0.10); c.lineTo(s*0.62, -s*0.09);
    c.closePath(); c.fill();
    c.fillStyle = body;
    // near wing, and the fingered primaries at its tip
    const tipX = s*0.62, tipY = -s*0.62*f - s*0.26;
    this.wingBlade(c, s*0.04, -s*0.08, tipX, tipY, s*0.46);
    c.strokeStyle = body;
    c.lineWidth = Math.max(0.8, s*0.034);
    c.beginPath();
    for (let k = 0; k < 4; k++) {
      const px2 = tipX + k*s*0.085, py2 = tipY + k*s*0.06;
      c.moveTo(px2 - s*0.12, py2 - s*0.02);
      c.lineTo(px2 + s*0.07, py2 + s*0.05);
    }
    c.stroke();
  }

  /* A harbour porpoise rolling through the surface. It is not a leap: the
     animal turns over a point, so the snout breaks first, the back arches
     across, the little triangular fin comes up last and goes down last. Only
     what is above the waterline is drawn — the sea is a hard edge here, not a
     wash the animal floats on top of — and it carries the pitch of its own
     arc, nose up on the rise and down on the fall.

     arc    0..1, how far clear of the water the back is
     pitch  radians, from the slope of the arc
     y      the waterline itself, in canvas pixels */
  paintPorpoise(c, o) {
    const s = o.s || this.H*0.05, a = Math.max(0, Math.min(1, o.arc));
    const rise = a*s*0.72;
    c.save();
    c.translate(o.x, o.y);
    if (o.dir < 0) c.scale(-1, 1);
    // Nothing below the surface shows, so clip the sea line and let the body
    // ride up through it.
    c.save();
    c.beginPath(); c.rect(-s*3, -s*4, s*6, s*4); c.clip();
    c.translate(0, -rise);
    c.rotate(o.pitch || 0);
    c.fillStyle = o.color;
    // The back: a blunt-nosed, thick-bodied crescent — nothing like a dolphin's.
    c.beginPath();
    c.moveTo(-s*1.15, s*0.60);
    c.quadraticCurveTo(-s*0.72, s*0.02, -s*0.15, -s*0.16);
    c.quadraticCurveTo(s*0.52, -s*0.30, s*0.94, s*0.04);
    c.quadraticCurveTo(s*1.10, s*0.20, s*0.98, s*0.36);
    c.quadraticCurveTo(s*0.2, s*0.30, -s*1.15, s*0.60);
    c.closePath(); c.fill();
    // The blunt melon and the short beakless snout, which is the other half of
    // why a porpoise is not a dolphin: no bottle, just a rounded face.
    c.beginPath();
    c.ellipse(s*0.86, s*0.06, s*0.24, s*0.20, -0.18, 0, Math.PI*2);
    c.fill();
    // The dorsal fin: low, broad-based, its trailing edge nearly straight —
    // the field mark that separates a porpoise from anything else inshore.
    c.beginPath();
    c.moveTo(-s*0.34, -s*0.10);
    c.quadraticCurveTo(-s*0.30, -s*0.46, -s*0.06, -s*0.52);
    c.quadraticCurveTo(-s*0.06, -s*0.30, s*0.04, -s*0.14);
    c.closePath(); c.fill();
    // The flipper, small and set low and forward, breaking the line of the
    // flank as the animal rolls over.
    c.globalAlpha = 0.85;
    c.beginPath();
    c.moveTo(s*0.34, s*0.22);
    c.quadraticCurveTo(s*0.18, s*0.46, -s*0.06, s*0.52);
    c.quadraticCurveTo(s*0.06, s*0.28, s*0.20, s*0.20);
    c.closePath(); c.fill();
    c.globalAlpha = 1;
    // The pale flank: a porpoise is dark over and light under, and the line
    // between the two is the thing you actually see going over.
    c.fillStyle = `rgba(${this.tok.foamRGB}, 0.18)`;
    c.beginPath();
    c.moveTo(-s*0.90, s*0.46);
    c.quadraticCurveTo(-s*0.10, s*0.16, s*0.86, s*0.20);
    c.quadraticCurveTo(s*0.20, s*0.34, -s*0.86, s*0.56);
    c.closePath(); c.fill();
    // A wet sheen along the crest of the back, and the eye behind the mouth.
    c.strokeStyle = o.rim || `rgba(${this.tok.foamRGB}, 0.35)`;
    c.globalAlpha = 0.4*a;
    c.lineWidth = Math.max(1, s*0.05);
    c.beginPath();
    c.moveTo(-s*0.62, s*0.02);
    c.quadraticCurveTo(-s*0.05, -s*0.20, s*0.62, -s*0.02);
    c.stroke();
    c.globalAlpha = Math.min(1, a*1.6);
    c.fillStyle = css(mix(this.tok.ink, this.tok.moon, 0.35));
    c.beginPath(); c.arc(s*0.80, s*0.04, Math.max(0.6, s*0.045), 0, Math.PI*2); c.fill();
    c.globalAlpha = 1;
    c.restore();
    // Where it cuts the surface: a small bow wave running off the shoulder,
    // and the puff of the blow as the back reaches its highest.
    c.strokeStyle = `rgba(${this.tok.foamRGB}, ${0.30*a})`;
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(s*0.2, s*0.02);
    c.quadraticCurveTo(-s*0.3, s*0.12, -s*1.0, s*0.16);
    c.moveTo(s*0.1, s*0.06);
    c.quadraticCurveTo(-s*0.3, s*0.18, -s*0.9, s*0.24);
    c.stroke();
    if (a > 0.8) {
      const b = (a - 0.8)*5;
      c.fillStyle = `rgba(${this.tok.foamRGB}, ${0.5*b*(1 - b*0.5)})`;
      c.beginPath();
      c.ellipse(s*0.62, -rise - s*0.55 - b*s*0.35, s*0.13*(0.5 + b), s*0.18*(0.5 + b*1.4),
        0, 0, Math.PI*2);
      c.fill();
    }
    /* The flukes, last of it to go. A porpoise going down lifts its tail clear
       of the hole its back has just left, and that is the shape you remember
       long after the animal itself is gone. Drawn outside the clip that keeps
       the body under the surface, because the flukes are what is above it. */
    const fl = o.fluke || 0;
    if (fl > 0.02) {
      c.save();
      c.globalAlpha = Math.min(1, fl*1.3);
      c.fillStyle = o.color;
      c.translate(-s*1.05, -s*0.02 - fl*s*0.30);
      c.rotate(-0.30 + fl*0.34);
      c.beginPath();
      c.moveTo(0, s*0.24);
      c.quadraticCurveTo(-s*0.06, -s*0.06, -s*0.34, -s*0.20);
      c.quadraticCurveTo(-s*0.10, -s*0.16, s*0.02, -s*0.22);
      c.quadraticCurveTo(s*0.20, -s*0.10, s*0.14, s*0.22);
      c.closePath(); c.fill();
      c.restore();
      // and the smooth patch of water it leaves as it goes under
      c.strokeStyle = `rgba(${this.tok.foamRGB}, ${0.24*fl})`;
      c.lineWidth = 1;
      c.beginPath();
      c.ellipse(-s*0.5, s*0.06, s*0.5*(0.6 + fl), s*0.12, 0, 0, Math.PI*2);
      c.stroke();
    }
    c.restore();
  }

  /* A butterfly — fore- and hindwing lobes foreshortening as they beat,
     a slender body and curled antennae. */
  paintButterfly(c, x, y, t, ph, al, colDark) {
    // The wings are clapped together over the back and swept down and open
    // slowly, so the insect climbs in little steps rather than flying level:
    // it rises on the downstroke and drops back on the clap.
    const f = gaitPose("flutter", (t*15 + ph)*TURN);
    const wsp = 0.25 + 0.75*f.spread;
    c.save();
    c.translate(x, y - f.lift*1.4);
    c.globalAlpha = al;
    c.fillStyle = `rgba(${this.tok.amberRGB}, 0.5)`;
    c.strokeStyle = colDark; c.lineWidth = 0.8; c.lineCap = "round";
    for (const sd of [-1, 1]) {
      c.beginPath();
      c.moveTo(sd*0.4, -0.5);
      c.quadraticCurveTo(sd*7*wsp, -6.5, sd*7.5*wsp, -2.2);
      c.quadraticCurveTo(sd*4.5*wsp, -0.8, sd*0.5, -0.2);
      c.closePath(); c.fill(); c.stroke();
      c.beginPath();
      c.moveTo(sd*0.5, 0.2);
      c.quadraticCurveTo(sd*5.5*wsp, 1.6, sd*4*wsp, 3.6);
      c.quadraticCurveTo(sd*1.8*wsp, 3.4, sd*0.4, 1);
      c.closePath(); c.fill(); c.stroke();
    }
    c.fillStyle = colDark;
    c.beginPath(); c.ellipse(0, 0.4, 0.7, 2.4, 0, 0, Math.PI*2); c.fill();
    c.beginPath();
    c.moveTo(0, -2); c.quadraticCurveTo(-1.6, -4.4, -2.4, -4.8);
    c.moveTo(0, -2); c.quadraticCurveTo(1.6, -4.4, 2.4, -4.8);
    c.stroke();
    c.globalAlpha = 1;
    c.restore();
  }

  /* A dragonfly — long flexing abdomen, great eyes, and two wing pairs
     that are more shimmer than shape. */
  paintDragonfly(c, x, y, t, colDark) {
    c.save();
    c.translate(x, y);
    c.strokeStyle = colDark; c.fillStyle = colDark; c.lineCap = "round";
    c.lineWidth = 1.1;
    c.beginPath();
    c.moveTo(2.5, 0);
    c.quadraticCurveTo(-3, 0.4 + Math.sin(t*3)*0.3, -7.5, 1.2 + Math.sin(t*3)*0.6);
    c.stroke();
    c.beginPath(); c.ellipse(3, 0, 1.6, 1.1, 0, 0, Math.PI*2); c.fill();
    c.beginPath(); c.arc(4.8, -0.2, 1.0, 0, Math.PI*2); c.fill();
    c.globalAlpha = 0.25 + Math.random()*0.3;
    c.lineWidth = 1;
    for (const tilt of [-1.15, -0.65]) {
      c.save();
      c.translate(1.8, -0.8);
      c.rotate(tilt);
      c.beginPath(); c.ellipse(3.4, 0, 3.6, 0.9, 0, 0, Math.PI*2); c.stroke();
      c.restore();
    }
    c.globalAlpha = 1;
    c.restore();
  }

  /* A bat — scalloped membrane wings on splayed fingers, round ears up. The
     downstroke takes a third of the beat and the recovery the rest of it, with
     the wing half folded on the way up so it costs the animal nothing: that
     asymmetry, and not the rate, is what reads as a bat rather than a bird. */
  paintBat(c, x, y, s, t, colDark) {
    const f = gaitPose("flit", t*24*TURN);
    const flap = f.beat, span = 1 - f.fold*0.34;
    c.save();
    c.translate(x, y);
    c.fillStyle = colDark;
    for (const sd of [-1, 1]) {
      const wr = flap*s*0.7;
      c.beginPath();
      c.moveTo(sd*s*0.08, -s*0.06);
      c.quadraticCurveTo(sd*s*0.5*span, -s*0.55 - wr, sd*s*1.05*span, -s*0.35 - wr*1.3);
      c.quadraticCurveTo(sd*s*0.7*span, -s*0.05 - wr*0.5, sd*s*0.5*span, s*0.02 - wr*0.3);
      c.quadraticCurveTo(sd*s*0.3*span, s*0.1, sd*s*0.06, s*0.12);
      c.closePath(); c.fill();
    }
    c.beginPath(); c.ellipse(0, 0, s*0.16, s*0.24, 0, 0, Math.PI*2); c.fill();
    c.beginPath(); c.arc(0, -s*0.24, s*0.13, 0, Math.PI*2); c.fill();
    c.beginPath();
    c.arc(-s*0.09, -s*0.36, s*0.06, 0, Math.PI*2);
    c.arc(s*0.09, -s*0.36, s*0.06, 0, Math.PI*2);
    c.fill();
    c.restore();
  }

  /* One goose in a passing skein — a tapering body, the neck reaching
     ahead, wings beating deep and slow. Stroke colour is the caller's. */
  paintGoose(c, bx, by, gdir, flap) {
    c.lineWidth = 1.7;
    c.beginPath(); c.moveTo(bx - gdir*2.2, by); c.lineTo(bx + gdir*1.4, by - 0.2); c.stroke();
    c.lineWidth = 0.9;
    c.beginPath(); c.moveTo(bx + gdir*1.4, by - 0.2); c.lineTo(bx + gdir*3.6, by - 0.6); c.stroke();
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(bx - 0.4, by);
    c.quadraticCurveTo(bx - 1.5, by - 2.6*flap, bx - 2.8, by - 3.4*flap);
    c.moveTo(bx - 0.4, by);
    c.quadraticCurveTo(bx - 1.1, by + 1.3*flap*0.4, bx - 2.1, by + 1.9*flap*0.35);
    c.stroke();
  }

  /* A sanderling — leaning into its dash, legs a twinkle of steps,
     drawn up straight when it pauses. */
  paintSanderling(c, x, y, dir, dash, ph, colDark, probe) {
    c.save();
    c.translate(x, y);
    if (dir < 0) c.scale(-1, 1);
    // stopped, it tips forward to jab its bill into the sand
    c.rotate(dash ? 0.16 : (probe || 0)*0.5);
    c.fillStyle = colDark; c.strokeStyle = colDark; c.lineCap = "round";
    // plump little body with a short tail
    c.beginPath();
    c.moveTo(4.4, -3.4);
    c.quadraticCurveTo(1, -5.2, -2.6, -4.2);
    c.quadraticCurveTo(-5.2, -3.4, -6.2, -2.4);
    c.lineTo(-4.4, -1.6);
    c.quadraticCurveTo(-1, -0.4, 3.2, -1.6);
    c.quadraticCurveTo(5.2, -2.2, 4.4, -3.4);
    c.closePath(); c.fill();
    // head and straight little bill
    c.beginPath(); c.arc(4.0, -4.5, 1.6, 0, Math.PI*2); c.fill();
    c.lineWidth = 0.9;
    c.beginPath(); c.moveTo(5.4, -4.5); c.lineTo(7.4, -4.3); c.stroke();
    // legs
    c.lineWidth = 1;
    if (dash) {
      const sw = Math.sin(ph);
      c.beginPath();
      c.moveTo(-0.8, -1); c.lineTo(-0.8 + sw*2.2, 2.2);
      c.moveTo(1.2, -1);  c.lineTo(1.2 - sw*2.2, 2.2);
      c.stroke();
      const A = c.globalAlpha;
      c.globalAlpha = A*0.4;
      c.beginPath();
      c.moveTo(0.2, -1); c.lineTo(0.2 + Math.cos(ph)*2.2, 2.2);
      c.stroke();
      c.globalAlpha = A;
    } else {
      c.beginPath();
      c.moveTo(-0.6, -1); c.lineTo(-0.6, 2.2);
      c.moveTo(1.2, -1); c.lineTo(1.2, 2.2);
      c.stroke();
    }
    c.restore();
  }

  /* A turnstone. Shorter in the leg than a sanderling, heavier in the chest,
     and built round one action: getting the bill under a stone and shoving.
     The heave tips the whole bird — front end down, tail up, legs braced. */
  paintTurnstone(c, dir, stepping, ph, heave, colDark) {
    c.save();
    if (dir < 0) c.scale(-1, 1);
    c.rotate(heave*0.55);                       // the shove goes through the body
    c.fillStyle = colDark; c.strokeStyle = colDark; c.lineCap = "round";
    // body: deeper-chested than the sanderling, and lower to the sand
    c.beginPath();
    c.moveTo(4.2, -3.0);
    c.quadraticCurveTo(1.2, -5.0, -2.4, -4.0);
    c.quadraticCurveTo(-5.4, -3.2, -6.6, -1.9);
    c.lineTo(-4.2, -1.3);
    c.quadraticCurveTo(-0.6, 0.1, 3.4, -1.2);
    c.quadraticCurveTo(5.4, -1.9, 4.2, -3.0);
    c.closePath(); c.fill();
    // head, and the short wedge of a bill that does the work
    c.beginPath(); c.arc(4.2, -4.2, 1.55, 0, Math.PI*2); c.fill();
    c.beginPath();
    c.moveTo(5.5, -4.6); c.lineTo(7.5, -3.9); c.lineTo(5.5, -3.7);
    c.closePath(); c.fill();
    // legs. Braced apart under a heave, swinging under a step, together at rest
    c.lineWidth = 1.05;
    const brace = heave*1.6;
    if (stepping) {
      const sw = Math.sin(ph);
      c.beginPath();
      c.moveTo(-0.6, -0.7); c.lineTo(-0.6 + sw*1.9, 2.0);
      c.moveTo(1.4, -0.7);  c.lineTo(1.4 - sw*1.9, 2.0);
      c.stroke();
    } else {
      c.beginPath();
      c.moveTo(-0.6, -0.7); c.lineTo(-0.6 - brace, 2.0);
      c.moveTo(1.4, -0.7);  c.lineTo(1.4 + brace*0.4, 2.0);
      c.stroke();
    }
    // and what it turned over, right at the end of the bill where it is
    // being turned rather than lying off on its own somewhere
    if (heave > 0.05) {
      const A = c.globalAlpha;
      c.globalAlpha = A*0.55;
      c.beginPath();
      c.ellipse(8.3, -2.6 + heave*0.6, 1.6, 0.85, heave*0.9, 0, Math.PI*2);
      c.fill();
      c.globalAlpha = A;
    }
    c.restore();
  }

  /* A lizard, flat to the ground and pressed against it — the flattest thing
     in the piece, which is why it needs the shadow to be seen at all. The
     legs go out sideways at the elbow, not down, and the tail is longer than
     everything else put together. */
  paintLizard(c, dir, running, ph, push, colDark) {
    c.save();
    if (dir < 0) c.scale(-1, 1);
    c.translate(0, -push*1.1);
    c.fillStyle = colDark; c.strokeStyle = colDark;
    c.lineCap = "round"; c.lineJoin = "round";
    // legs: four, splayed, and the sprawl is the whole silhouette
    c.lineWidth = 0.85;
    const sw = running ? Math.sin(ph) : 0;
    let li = 0;
    for (const [bx, s] of [[2.0, -1], [2.0, 1], [-1.4, -1], [-1.4, 1]]) {
      const swing = running ? sw*(li % 2 ? -1 : 1)*1.3 : 0;
      li++;
      c.beginPath();
      c.moveTo(bx, -1.1 - push*0.4);
      c.quadraticCurveTo(bx + s*0.4 + swing, 0.1, bx + s*1.4 + swing*1.2, 0.6);
      c.stroke();
    }
    // body — a low wedge, widest at the shoulders
    c.beginPath();
    c.moveTo(3.4, -1.5);
    c.quadraticCurveTo(1.4, -2.4, -1.6, -1.9);
    c.quadraticCurveTo(-2.6, -1.5, -1.6, -0.9);
    c.quadraticCurveTo(1.0, -0.4, 3.2, -0.9);
    c.closePath(); c.fill();
    // head, blunt and barely separate from the body
    c.beginPath();
    c.ellipse(4.0, -1.25, 1.3, 0.75, -0.08, 0, Math.PI*2);
    c.fill();
    // the tail: longer than the animal, and it flicks when it runs
    const tk = running ? Math.sin(ph*0.5)*1.6 : Math.sin(ph*0.08)*0.4;
    c.lineWidth = 0.95;
    c.beginPath();
    c.moveTo(-1.8, -1.35);
    c.quadraticCurveTo(-5.0, -1.3 + tk, -8.6, -0.7 + tk*1.8);
    c.stroke();
    c.restore();
  }

  /* A small bird bathing. Nothing else in the piece throws anything: the
     splash is a handful of short strokes leaving the body, and it is the only
     reason to draw this at all. */
  paintBather(c, dir, mode, ph, splash, colDark, foam) {
    c.save();
    if (dir < 0) c.scale(-1, 1);
    c.fillStyle = colDark; c.strokeStyle = colDark; c.lineCap = "round";
    const dip = mode === "dip" ? splash : 0;
    const shake = mode === "shake" ? Math.sin(ph)*0.3 : 0;
    c.save();
    c.translate(0, dip*1.5);
    c.rotate(shake);
    // a round little body, low in the water, with the tail cocked
    c.beginPath();
    c.moveTo(3.0, -3.6);
    c.quadraticCurveTo(0.4, -5.4, -2.6, -4.2);
    c.lineTo(-5.6, -5.0);
    c.lineTo(-4.6, -3.2);
    c.quadraticCurveTo(-1.4, -1.6, 2.2, -2.2);
    c.quadraticCurveTo(4.0, -2.8, 3.0, -3.6);
    c.closePath(); c.fill();
    // head, driven right down through a dip
    c.beginPath();
    c.arc(3.4 + dip*0.6, -4.6 + dip*2.2, 1.5, 0, Math.PI*2);
    c.fill();
    c.lineWidth = 0.8;
    c.beginPath();
    c.moveTo(4.7 + dip*0.6, -4.5 + dip*2.2);
    c.lineTo(6.3 + dip*0.9, -4.1 + dip*2.4);
    c.stroke();
    c.restore();
    // water going everywhere
    if (splash > 0.05) {
      const A = c.globalAlpha;
      c.strokeStyle = foam; c.lineWidth = 0.85;
      c.globalAlpha = A*0.65*splash;
      c.beginPath();
      for (let k = 0; k < 7; k++) {
        const a = -Math.PI*0.15 - k*0.34 - ph*0.11;
        const r0 = 2.6, r1 = r0 + 3.4*splash*(0.5 + (k % 3)*0.28);
        c.moveTo(Math.cos(a)*r0, -3.2 + Math.sin(a)*r0*0.8);
        c.lineTo(Math.cos(a)*r1, -3.2 + Math.sin(a)*r1*0.8);
      }
      c.stroke();
      // and the ring it is standing in
      c.globalAlpha = A*0.4*splash;
      c.beginPath();
      c.ellipse(0, -0.6, 6 + splash*3, 1.9 + splash, 0, 0, Math.PI*2);
      c.stroke();
      c.globalAlpha = A;
    }
    c.restore();
  }

  /* A stoat: a tube of an animal on very short legs, with a black tip to the
     tail that is the one mark worth drawing at this size. Bounding, the back
     does the work; standing, the whole length of it goes vertical and it is
     suddenly twice as tall as anything about it suggested. */
  paintStoat(c, o) {
    const s = o.s, L = o.leap;
    const rear = o.rear || 0;
    const arch = L ? L.arch : 0.15;
    const str = L ? L.stretch : 0;
    c.save();
    c.translate(o.x, o.y);
    if (o.dir < 0) c.scale(-1, 1);
    c.fillStyle = o.color; c.strokeStyle = o.color;
    c.lineCap = "round"; c.lineJoin = "round";
    /* Standing up: the body pivots about the hind feet until it is upright,
       and the same drawing serves — a long body, rotated. */
    c.rotate(-rear*1.28);
    const hipX = -s*1.5, shX = s*1.1;
    // the back, drawn as one arch from hip to shoulder
    const midY = -s*(0.62 + arch*0.52);
    c.lineWidth = s*0.46;
    c.beginPath();
    c.moveTo(hipX, -s*0.55);
    c.quadraticCurveTo((hipX + shX)/2, midY*1.55, shX, -s*0.62);
    c.stroke();
    // legs — short enough to be almost an afterthought, which is the point
    c.lineWidth = s*0.17;
    const fore = L ? L.fore : 0, hind = L ? L.hind : 0;
    c.beginPath();
    c.moveTo(shX - s*0.1, -s*0.5); c.lineTo(shX + fore*s*0.55, -s*0.02 - Math.max(0, fore)*s*0.28);
    c.moveTo(hipX + s*0.1, -s*0.45); c.lineTo(hipX + hind*s*0.6, -s*0.02 - Math.max(0, hind)*s*0.3);
    c.stroke();
    // head: small, flat, carried out in front on a neck no thicker than it
    c.lineWidth = s*0.42;
    c.beginPath();
    c.moveTo(shX, -s*0.66);
    c.lineTo(shX + s*0.85 + str*s*0.2, -s*0.62 - rear*s*0.1);
    c.stroke();
    c.beginPath();
    c.arc(shX + s*1.0 + str*s*0.2, -s*0.62, s*0.26, 0, Math.PI*2);
    c.fill();
    // the tail — long, held out behind, and tipped black
    const tw = L ? L.tail : Math.sin(o.t*2.2)*0.4;
    c.lineWidth = s*0.24;
    c.beginPath();
    c.moveTo(hipX, -s*0.55);
    c.quadraticCurveTo(hipX - s*0.9, -s*0.55 - tw*s*0.5,
      hipX - s*1.7, -s*0.35 - tw*s*0.85);
    c.stroke();
    c.fillStyle = this.tok ? css(this.tok.inkDeep) : o.color;
    c.beginPath();
    c.arc(hipX - s*1.75, -s*0.34 - tw*s*0.88, s*0.2, 0, Math.PI*2);
    c.fill();
    c.restore();
  }

  /* A pigeon on the pavement. Everything about the shape is round — round
     chest, round head, no neck to speak of — and the head is the only part
     that moves sharply: held dead still while the body walks, then snapped
     forward. Pecking is the same motion taken all the way down. */
  paintPigeon(c, dir, walking, ph, bob, colDark) {
    c.save();
    if (dir < 0) c.scale(-1, 1);
    c.fillStyle = colDark; c.strokeStyle = colDark;
    c.lineCap = "round";
    // the head's own clock: a fast throw and a slow catch up
    const hb = walking ? Math.max(0, Math.sin(bob))*1.6
      : Math.max(0, Math.sin(bob))*1.0;
    const peck = walking ? 0 : Math.pow(Math.max(0, Math.sin(bob*0.5)), 3);
    // legs
    c.lineWidth = 1.1;
    const sw = walking ? Math.sin(ph)*1.8 : 0;
    c.beginPath();
    c.moveTo(-0.4, -1.2); c.lineTo(-0.4 + sw, 2.2);
    c.moveTo(1.1, -1.2);  c.lineTo(1.1 - sw, 2.2);
    c.stroke();
    // the body — deep chest forward, tail trailing low and squared off
    c.beginPath();
    c.moveTo(3.6, -4.4);
    c.quadraticCurveTo(0.6, -6.4, -3.2, -5.0);
    c.lineTo(-7.4, -3.0);
    c.lineTo(-6.8, -1.9);
    c.quadraticCurveTo(-2.0, -0.6, 2.4, -2.0);
    c.quadraticCurveTo(4.6, -3.0, 3.6, -4.4);
    c.closePath(); c.fill();
    // folded wing, a shade in from the edge
    const A = c.globalAlpha;
    c.globalAlpha = A*0.55;
    c.beginPath();
    c.moveTo(1.6, -4.6);
    c.quadraticCurveTo(-1.6, -4.4, -5.2, -2.9);
    c.quadraticCurveTo(-1.6, -2.4, 1.8, -3.4);
    c.closePath(); c.fill();
    c.globalAlpha = A;
    // head, on its short thick neck, pitched down through a peck
    c.save();
    c.translate(3.8, -5.4 - hb*0.35);
    c.rotate(peck*1.15);
    c.beginPath(); c.arc(0, 0, 1.9, 0, Math.PI*2); c.fill();
    c.beginPath();
    c.moveTo(1.5, 0.1); c.lineTo(3.5, 0.7); c.lineTo(1.5, 1.0);
    c.closePath(); c.fill();
    c.restore();
    c.restore();
  }

  /* The same bird going up, which is the only way most people ever see a
     flock of them: wings high, body tipped back, all of it a clatter. */
  paintPigeonFlight(c, x, y, s, dir, ph, col) {
    c.save();
    c.translate(x, y);
    if (dir < 0) c.scale(-1, 1);
    c.fillStyle = col; c.strokeStyle = col;
    c.lineWidth = Math.max(1, s*0.17); c.lineCap = "round";
    const beat = Math.sin(ph);
    // body, tipped back on the climb
    c.save();
    c.rotate(-0.42);
    c.beginPath();
    c.ellipse(0, 0, s*0.62, s*0.30, 0, 0, Math.PI*2);
    c.fill();
    c.beginPath(); c.arc(s*0.62, -s*0.10, s*0.22, 0, Math.PI*2); c.fill();
    c.restore();
    // wings — deep, blunt, and swept back at the tip
    for (const side of [-1, 1]) {
      const up = beat*side;
      c.beginPath();
      c.moveTo(0, -s*0.1);
      c.quadraticCurveTo(-s*0.5, -s*0.1 - up*s*0.9, -s*1.25, -up*s*1.25);
      c.stroke();
    }
    c.restore();
  }

  /* A moth against a lit window: a pale scrap on a wall of light, and the
     wings are never still enough to have a shape. */
  paintMoth(c, x, y, s, ph, alpha) {
    const A = c.globalAlpha;
    const beat = 0.35 + Math.abs(Math.sin(ph))*0.65;
    c.globalAlpha = A*alpha*0.85;
    c.fillStyle = `rgba(${this.tok.fireflyRGB}, 1)`;
    c.beginPath();
    c.ellipse(x, y, s*1.35*beat, s*0.55, 0.2, 0, Math.PI*2);
    c.fill();
    c.globalAlpha = A*alpha;
    c.beginPath();
    c.ellipse(x, y, s*0.34, s*0.5, 0, 0, Math.PI*2);
    c.fill();
    c.globalAlpha = A;
  }

  /* A crab. It travels along its own width, so the shell never turns to face
     where it is going — the one thing in the piece that moves sideways. */
  paintCrab(c, dir, running, ph, claw, colDark) {
    c.save();
    if (dir < 0) c.scale(-1, 1);
    c.fillStyle = colDark; c.strokeStyle = colDark;
    c.lineCap = "round"; c.lineJoin = "round";
    c.lineWidth = 0.8;
    /* Legs: four a side, and they have to stay *under* the shell rather than
       radiating from it — drawn long and thin the whole thing read as a
       spider, which is the one animal a crab must not look like. They reach
       barely past the carapace and they bend down, not out. */
    const sw = running ? Math.sin(ph) : 0;
    for (let i = 0; i < 4; i++) {
      const bx = -1.9 + i*1.3;
      const swing = running ? sw*(i % 2 ? -1 : 1)*1.1 : 0;
      for (const s of [-1, 1]) {
        c.beginPath();
        c.moveTo(bx*0.5, -2.4);
        c.quadraticCurveTo(bx + s*2.4 + swing, -2.9,
          bx + s*3.3 + swing*1.2, -0.2);
        c.stroke();
      }
    }
    // and the claws, folded in front of the face or held up
    c.lineWidth = 1.2;
    for (const s of [-1, 1]) {
      const lift = claw*2.2;
      c.beginPath();
      c.moveTo(s*2.2, -2.4);
      c.quadraticCurveTo(s*3.6, -1.8 - lift, s*4.0, -1.2 - lift*1.9);
      c.stroke();
      c.beginPath();
      c.ellipse(s*4.2, -1.2 - lift*1.9, 1.35, 0.8, s*0.35 - claw*0.9, 0, Math.PI*2);
      c.fill();
    }
    /* The carapace, which is nearly the whole animal: broad, domed, and
       drawn over the leg roots so they emerge from under it. */
    c.beginPath();
    c.moveTo(-4.2, -2.6);
    c.quadraticCurveTo(-3.6, -5.6, 0, -5.9);
    c.quadraticCurveTo(3.6, -5.6, 4.2, -2.6);
    c.quadraticCurveTo(0, -1.5, -4.2, -2.6);
    c.closePath(); c.fill();
    // two eyes on short stalks, up over the front edge
    c.lineWidth = 0.75;
    c.beginPath();
    c.moveTo(-1.2, -5.5); c.lineTo(-1.5, -6.9);
    c.moveTo(1.2, -5.5);  c.lineTo(1.5, -6.9);
    c.stroke();
    c.beginPath(); c.arc(-1.5, -7.0, 0.5, 0, Math.PI*2); c.fill();
    c.beginPath(); c.arc(1.5, -7.0, 0.5, 0, Math.PI*2); c.fill();
    c.restore();
  }

  /* A seal's head beyond the surf: a dark round nothing with a wake round it,
     up for a long look and then gone. Rising and sinking is a matter of how
     much of it is above the line, so the water clips it rather than the head
     moving — which is what actually happens. */
  paintSeal(c, x, y, s, dir, up, look, colDark, colFar) {
    /* How far out of the water it is. A seal's head is wider than it is tall
       and it sits *in* the surface rather than on it, so the drawing is a
       round head with the waterline taken across it — drawn as a tall egg it
       read as a rock, which is exactly the wrong animal. */
    const h = s*(0.30 + up*0.62);
    c.save();
    c.translate(x, y);
    // the water it is standing in: a slack ring, wider as more of it shows
    c.strokeStyle = colFar;
    c.globalAlpha = 0.4*up; c.lineWidth = 1;
    c.beginPath();
    c.ellipse(0, s*0.06, s*(1.2 + up*0.9), s*0.30, 0, 0, Math.PI*2);
    c.stroke();
    c.globalAlpha = 1;
    c.save();
    c.beginPath(); c.rect(-s*4, -s*7, s*8, s*7); c.clip();
    c.fillStyle = colDark;
    const hx = look*s*0.14, hy = -h*0.62;
    // the muzzle first, so the round of the skull sits over its root
    const mx = (look >= 0 ? 1 : -1)*(dir >= 0 ? 1 : -1);
    c.beginPath();
    c.ellipse(hx + mx*s*0.55, hy + h*0.30, s*0.36, h*0.30, mx*0.18, 0, Math.PI*2);
    c.fill();
    // and the head: broad, domed, no neck to speak of
    c.beginPath();
    c.ellipse(hx, hy, s*0.72, h*0.66, look*0.14, 0, Math.PI*2);
    c.fill();
    c.restore();
    c.restore();
  }

  /* A pheasant — deep-chested, small-headed, trailing that improbable tail;
     head thrown up to crow, stepping deliberately otherwise. */
  paintPheasant(c, o) {
    const s = o.s, t = o.t || 0, sing = o.sing || 0;
    const fly = o.fly || 0;
    c.save();
    c.translate(o.x, o.y);
    if (o.flip) c.scale(-1, 1);
    c.globalAlpha = o.alpha;
    c.fillStyle = o.color; c.strokeStyle = o.color;
    c.lineCap = "round"; c.lineJoin = "round";
    // Flushing: body tilted up on the climb, neck out, the long tail streaming
    // straight behind, and the short round wings a blur — the clatter you hear
    // before you ever see the bird.
    if (fly > 0.02) { this.pheasantFlush(c, o, fly); c.restore(); return; }
    const by = -s*0.6;
    // legs — stout, and stepping the deliberate `strut`: a long planted
    // stance and a quick swing, not an even swing back and forth
    const wk = o.walking ? gaitPose("strut", (o.lp || 0)*TURN) : null;
    let li = 0;
    for (const lx0 of [-s*0.16, s*0.14]) {
      let sw = 0, lift = 0;
      if (o.walking) {
        gaitFoot(GAIT.strut, (o.lp || 0)*TURN + GAIT.strut.feet[li], FOOT);
        sw = FOOT[0]*s*0.14; lift = FOOT[1]*s*0.07;
      }
      li++;
      this.leg(c, lx0, by + s*0.28, lx0 + sw, -lift, 0.07, s*0.12, s*0.05);
    }
    // the long barred tail, carried just off the ground
    const tf = Math.pow(Math.max(0, Math.sin(t*0.8 + 1)), 12);   // the odd flick
    for (let k = 0; k < 3; k++) {
      const aa = 0.16 + k*0.07 - tf*0.12 - sing*0.1;
      this.limb(c, -s*0.6, by + s*0.05,
        -s*0.6 - Math.cos(aa)*s*1.7*(1 - k*0.13), by + s*0.05 + Math.sin(aa)*s*1.7*(1 - k*0.13),
        s*0.16, s*0.05);
    }
    c.strokeStyle = o.rim || o.color;
    c.lineWidth = Math.max(0.5, s*0.035);
    c.globalAlpha = o.alpha*0.5;
    c.beginPath();
    for (let k = 1; k <= 3; k++) {
      c.moveTo(-s*(0.6 + k*0.38), by + s*(0.1 + k*0.05));
      c.lineTo(-s*(0.6 + k*0.38), by + s*(0.22 + k*0.05));
    }
    c.stroke();
    c.globalAlpha = o.alpha;
    c.strokeStyle = o.color;
    // body — full breast, the back sloping into the tail root
    c.beginPath();
    c.moveTo(s*0.5, by - s*0.34);
    c.quadraticCurveTo(-s*0.1, by - s*0.48, -s*0.55, by - s*0.2);
    c.quadraticCurveTo(-s*0.78, by, -s*0.55, by + s*0.2);
    c.quadraticCurveTo(-s*0.05, by + s*0.42, s*0.42, by + s*0.28);
    c.quadraticCurveTo(s*0.72, by + s*0.05, s*0.5, by - s*0.34);
    c.closePath(); c.fill();
    // the coppery wash over the body
    c.fillStyle = `rgba(${this.tok.amberRGB}, 0.35)`;
    c.beginPath(); c.ellipse(-s*0.05, by, s*0.6, s*0.36, -0.1, 0, Math.PI*2); c.fill();
    // neck and small head, thrown up for the crow — and, walking, thrust
    // forward and then held while the bird catches up with it
    const hx = s*0.6 + (wk ? wk.head*s*0.09 : 0);
    const hy = by - s*0.78 - sing*s*0.16 - (wk ? wk.rise*s*0.035 : 0);
    c.fillStyle = o.color;
    this.limb(c, s*0.42, by - s*0.2, hx, hy, s*0.26, s*0.14);
    c.beginPath(); c.arc(hx, hy, s*0.16, 0, Math.PI*2); c.fill();
    c.beginPath();
    c.moveTo(hx + s*0.13, hy - s*0.06);
    c.lineTo(hx + s*0.34, hy - sing*s*0.03);
    c.lineTo(hx + s*0.13, hy + s*0.06);
    c.closePath(); c.fill();
    // the white neck-ring and the red face wattle
    c.strokeStyle = `rgba(${this.tok.foamRGB}, 0.75)`;
    c.lineWidth = Math.max(0.8, s*0.06);
    c.beginPath(); c.arc(hx - s*0.06, hy + s*0.26, s*0.17, Math.PI*0.6, Math.PI*2.2); c.stroke();
    c.fillStyle = `rgba(${this.tok.amberRGB}, 0.9)`;
    c.beginPath(); c.arc(hx + s*0.04, hy - s*0.02, s*0.075, 0, Math.PI*2); c.fill();
    c.fillStyle = o.deep || o.color;
    c.beginPath(); c.arc(hx + s*0.05, hy - s*0.03, Math.max(0.5, s*0.03), 0, Math.PI*2); c.fill();
    c.restore();
  }

  /* The flush: steep, noisy and short. Short broad wings beating hard, the
     body angled up the climb, that ridiculous tail trailing out behind. */
  pheasantFlush(c, o, fly) {
    const s = o.s, k = o.flap || 0;
    c.rotate(-0.5*fly);
    c.translate(0, -s*1.2);
    c.fillStyle = o.color;
    const A = c.globalAlpha;
    c.globalAlpha = A*0.55;
    this.wingBlade(c, -s*0.06, -s*0.05, -s*0.5, -s*0.95*k - s*0.2, s*0.68);
    c.globalAlpha = A;
    // the streaming tail
    for (let j = -1; j <= 1; j++) {
      this.limb(c, -s*0.5, -s*0.02, -s*(1.9 + Math.abs(j)*0.1), j*s*0.13, s*0.16, s*0.05);
    }
    c.beginPath(); c.ellipse(0, 0, s*0.62, s*0.34, 0, 0, Math.PI*2); c.fill();
    // neck out, head up the climb
    this.limb(c, s*0.4, -s*0.16, s*0.86, -s*0.5, s*0.22, s*0.13);
    c.beginPath(); c.arc(s*0.9, -s*0.54, s*0.15, 0, Math.PI*2); c.fill();
    c.beginPath();
    c.moveTo(s*1.02, -s*0.6); c.lineTo(s*1.26, -s*0.54); c.lineTo(s*1.02, -s*0.48);
    c.closePath(); c.fill();
    c.fillStyle = `rgba(${this.tok.amberRGB}, 0.35)`;
    c.beginPath(); c.ellipse(-s*0.05, 0, s*0.44, s*0.24, 0, 0, Math.PI*2); c.fill();
    c.fillStyle = o.color;
    this.wingBlade(c, s*0.04, -s*0.04, s*0.42, -s*1.05*k - s*0.24, s*0.74);
  }

  /* A red squirrel — all tail: arched over the back when it sits up to
     nibble, streaming behind when it bounds, and flat out along the ground
     when it caches a nut. The dig is the thing squirrels actually spend an
     autumn doing, so it is drawn properly: rump up, head down between the
     forepaws, quick alternating strokes that throw the litter back between
     the hind legs, the nut nosed down into the hole, and the soil patted
     back over it with both front paws.

     dig   0..1, how far into the digging posture
     bury  0..1, the nose pushing the nut down
     pat   1 while the forepaws tamp the litter back */
  paintSquirrel(c, o) {
    const s = o.s, t = o.t || 0;
    const dig = o.dig || 0;
    c.save();
    c.translate(o.x, o.y);
    if (o.dir < 0) c.scale(-1, 1);
    c.fillStyle = o.color;
    if (dig > 0.02) {
      const bury = o.bury || 0, pat = o.pat || 0;
      // Scrabble: the forepaws alternate, fast and close under the chest, each
      // running the `dig` stroke — reach out, drag back through the earth,
      // throw the spoil away behind — half a cycle apart from the other.
      const st1 = gaitPose("dig", t*3.4), st2 = gaitPose("dig", t*3.4 + 0.5);
      const tamp = pat ? Math.max(0, gaitPose("dig", t*5).pull) : 0;
      // The tail stays arched over the back even at work — a squirrel never
      // puts it down — and twitches with the effort.
      const tw = Math.sin(t*7)*s*0.10;
      c.beginPath();
      c.moveTo(-s*0.42, -s*0.44);
      c.quadraticCurveTo(-s*1.10, -s*0.62 + tw, -s*1.24, -s*1.20 + tw);
      c.quadraticCurveTo(-s*1.26, -s*1.60 + tw, -s*0.86, -s*1.62 + tw);
      c.quadraticCurveTo(-s*1.02, -s*1.18 + tw*0.7, -s*0.90, -s*0.80);
      c.quadraticCurveTo(-s*0.74, -s*0.42, -s*0.34, -s*0.26);
      c.closePath(); c.fill();
      /* Rump high, shoulders down: the whole back slopes into the hole.
         `dig` used to multiply the height of the back itself, so the animal
         swelled up out of the ground as the dig began and collapsed flat again
         as it ended — it changed size rather than posture. The body is one
         size now; what `dig` does is drop the shoulders and lift the rump,
         which is the only thing that was ever supposed to happen. */
      const front = dig*s*0.34;                 // how far the shoulders have gone down
      const rump = dig*s*0.10;                  // and the hindquarters come up
      c.beginPath();
      c.moveTo(-s*0.62, -s*0.30 - rump);
      c.quadraticCurveTo(-s*0.68, -s*0.96 - rump, -s*0.16, -s*0.88 + front*0.45);
      c.quadraticCurveTo(s*0.24, -s*0.82 + front*0.85, s*0.46, -s*0.48 + front);
      c.quadraticCurveTo(s*0.32, -s*0.06, -s*0.10, -s*0.06);
      c.quadraticCurveTo(-s*0.48, -s*0.06, -s*0.62, -s*0.30 - rump);
      c.closePath(); c.fill();
      // hind legs braced under the raised rump
      this.limb(c, -s*0.40, -s*0.52 - rump, -s*0.48, -s*0.02, s*0.19, s*0.07);
      this.limb(c, -s*0.18, -s*0.50 - rump, -s*0.22, -s*0.02, s*0.17, s*0.06);
      // Head down into the hole; on the bury it pushes the nut further in.
      const hx = s*0.56 + bury*s*0.09;
      const hy = -s*0.62 + dig*s*0.42 + bury*s*0.12;
      this.limb(c, s*0.18, -s*0.62 + front*0.7, hx, hy, s*0.24, s*0.15);
      c.beginPath(); c.arc(hx, hy, s*0.17, 0, Math.PI*2); c.fill();
      c.beginPath();
      c.moveTo(hx - s*0.08, hy - s*0.13); c.lineTo(hx - s*0.14, hy - s*0.34);
      c.lineTo(hx + s*0.02, hy - s*0.17);
      c.closePath(); c.fill();
      // muzzle, pushed down at the litter
      c.beginPath();
      c.moveTo(hx + s*0.10, hy - s*0.06);
      c.quadraticCurveTo(hx + s*0.30, hy + s*0.04, hx + s*0.30, hy + s*0.12);
      c.lineTo(hx + s*0.06, hy + s*0.13);
      c.closePath(); c.fill();
      // forepaws: scrabbling, or flat and tamping the litter back
      const px1 = pat ? 0 : st1.reach*s*0.13, py1 = pat ? -tamp*s*0.12 : (st1.pull - 0.35)*s*0.15;
      const px2 = pat ? 0 : st2.reach*s*0.13, py2 = pat ? -tamp*s*0.12 : (st2.pull - 0.35)*s*0.15;
      // the shoulders they hang from come down with the rest of the front
      const sh = -s*0.58 + front*0.72;
      this.limb(c, s*0.30, sh, s*0.52 + px1, -s*0.02 + py1, s*0.11, s*0.07);
      this.limb(c, s*0.20, sh + s*0.04, s*0.42 + px2, -s*0.02 + py2, s*0.10, s*0.06);
      // the hole itself, dark in the leaf-litter
      c.globalAlpha = 0.35;
      c.beginPath(); c.ellipse(s*0.58, s*0.01, s*0.24, s*0.06, 0, 0, Math.PI*2); c.fill();
      c.globalAlpha = 1;
    } else if (o.sit) {
      // the great tail curling up and over
      c.beginPath();
      c.moveTo(-s*0.5, -s*0.15);
      c.quadraticCurveTo(-s*1.05, -s*0.3, -s*1.0, -s*0.95);
      c.quadraticCurveTo(-s*0.92, -s*1.42, -s*0.42, -s*1.4);
      c.quadraticCurveTo(-s*0.75, -s*1.25, -s*0.72, -s*0.9);
      c.quadraticCurveTo(-s*0.68, -s*0.4, -s*0.3, -s*0.2);
      c.closePath(); c.fill();
      // haunch and upright body
      c.beginPath(); c.ellipse(-s*0.05, -s*0.32, s*0.42, s*0.34, 0, 0, Math.PI*2); c.fill();
      c.beginPath(); c.ellipse(s*0.12, -s*0.62, s*0.26, s*0.36, 0.15, 0, Math.PI*2); c.fill();
      // head with ear tufts, working at what it is holding — bites taken and
      // chewed rather than one even bob — or right down at the litter, front
      // paws scrabbling something under the leaves
      const dig = o.dig ? 1 : 0;
      const scrabble = dig ? Math.sin(t*14) : 0;
      const gz = gaitPose("graze", t*1.15);
      const nib = (gz.chew*0.05 - (1 - gz.dip)*0.05)*s;
      const hy = -s*1.02 + nib + dig*s*0.5;
      c.beginPath(); c.arc(s*0.22 + dig*s*0.14, hy, s*0.2, 0, Math.PI*2); c.fill();
      c.beginPath();
      c.moveTo(s*0.08, hy - s*0.14); c.lineTo(s*0.04, hy - s*0.36); c.lineTo(s*0.18, hy - s*0.18);
      c.moveTo(s*0.28, hy - s*0.16); c.lineTo(s*0.32, hy - s*0.38); c.lineTo(s*0.42, hy - s*0.16);
      c.closePath(); c.fill();
      // forepaws held up together, or working at the ground
      c.beginPath();
      c.ellipse(s*(0.32 + dig*0.22), -s*0.72 + nib + dig*(s*0.62 + scrabble*s*0.07),
        s*0.1, s*0.07, 0.3, 0, Math.PI*2);
      c.fill();
      // eye
      c.fillStyle = css(mix(this.tok.ink, this.tok.moon, 0.5));
      c.beginPath(); c.arc(s*0.28, hy - s*0.04, Math.max(0.6, s*0.05), 0, Math.PI*2); c.fill();
    } else {
      // Bounding. A squirrel crosses the ground in a series of arches: the
      // back rounds right up as it gathers, hollows out at full stretch, the
      // hind feet come down outside and ahead of the fore — and the tail runs
      // its wave a beat behind the whole of it, which is the part you see.
      const g = o.leap || null;
      const stB = g ? g.stretch : 0.5, arch = g ? g.arch : 0;
      const wv = (g ? g.tail : 0)*s*0.13;
      const air = g ? Math.min(1, Math.max(0, g.rise)*2.4) : 0;
      const hs = g ? (g.hind + 1)/2 : 0.5, fs = g ? (g.fore + 1)/2 : 0.5;
      if (g) { c.translate(0, -s*0.3); c.rotate(-g.tilt*0.30); c.translate(0, s*0.3); }
      c.beginPath();
      c.moveTo(-s*0.45, -s*0.3);
      c.quadraticCurveTo(-s*1.0, -s*0.55 + wv, -s*1.45, -s*0.4 + wv*1.6);
      c.quadraticCurveTo(-s*1.6, -s*0.28 + wv*1.6, -s*1.45, -s*0.18 + wv*1.2);
      c.quadraticCurveTo(-s*0.95, -s*0.12 + wv*0.5, -s*0.4, -s*0.12);
      c.closePath(); c.fill();
      c.beginPath();
      c.ellipse(0, -s*0.3 - arch*s*0.06, s*(0.5 + stB*0.14), s*(0.28 - stB*0.05),
        -0.12 - arch*0.16, 0, Math.PI*2);
      c.fill();
      // legs: gathered under it, then driving out and reaching
      this.limb(c, -s*0.3, -s*0.15, -s*0.3 - hs*s*0.36,
        s*0.02 - Math.max(0, -(g ? g.hind : 0))*air*s*0.26, s*0.16, s*0.06);
      this.limb(c, s*0.3, -s*0.18, s*0.3 + fs*s*0.32,
        -Math.max(0, -(g ? g.fore : 0))*air*s*0.24, s*0.12, s*0.05);
      // head reaching forward
      const hxB = s*(0.5 + stB*0.12), hyB = -s*0.42 - arch*s*0.05;
      c.beginPath(); c.arc(hxB, hyB, s*0.18, 0, Math.PI*2); c.fill();
      c.beginPath();
      c.moveTo(hxB - s*0.11, hyB - s*0.12); c.lineTo(hxB - s*0.13, hyB - s*0.28);
      c.lineTo(hxB - s*0.01, hyB - s*0.14);
      c.closePath(); c.fill();
    }
    c.restore();
  }

  /* A brown hare — lankier than any rabbit, loping low or drawn up tall
     and still, ears like signal flags. */
  paintHare(c, o) {
    const s = o.s;
    c.save();
    c.translate(o.x, o.y);
    if (o.dir < 0) c.scale(-1, 1);
    c.fillStyle = o.color;
    if (o.graze) {
      // head down in the grass on a stretched neck, haunches high behind,
      // ears swept back but still clear of the line of the back — biting and
      // chewing, and working along the sward between mouthfuls
      const gz = gaitPose("graze", (o.t || 0)*0.7);
      const bob = (gz.chew*0.05 - (1 - gz.dip)*0.08)*s;
      c.beginPath();
      c.ellipse(-s*0.28, -s*0.52, s*0.72, s*0.4, -0.12, 0, Math.PI*2); c.fill();
      this.limb(c, -s*0.55, -s*0.5, -s*0.68, -s*0.04, s*0.3, s*0.09);
      this.limb(c, s*0.28, -s*0.5, s*0.38, -s*0.03, s*0.13, s*0.06);
      const hx = s*0.82, hy = -s*0.2 + bob;
      this.limb(c, s*0.28, -s*0.62, hx - s*0.06, hy - s*0.06, s*0.26, s*0.17);
      c.beginPath(); c.arc(hx, hy, s*0.19, 0, Math.PI*2); c.fill();
      c.beginPath(); c.ellipse(hx + s*0.16, hy + s*0.07, s*0.11, s*0.07, 0.35, 0, Math.PI*2); c.fill();
      this.limb(c, hx - s*0.1, hy - s*0.14, hx - s*0.5, hy - s*0.72, s*0.12, s*0.06);
      this.limb(c, hx + s*0.02, hy - s*0.15, hx - s*0.3, hy - s*0.8, s*0.12, s*0.06);
      c.fillStyle = css(mix(this.tok.ink, this.tok.moon, 0.5));
      c.beginPath(); c.arc(hx + s*0.05, hy - s*0.07, Math.max(0.6, s*0.045), 0, Math.PI*2); c.fill();
      c.restore();
      return;
    }
    if (o.alert) {
      // sat up on its haunches, ears up, utterly still
      c.beginPath(); c.ellipse(-s*0.15, -s*0.4, s*0.5, s*0.4, 0, 0, Math.PI*2); c.fill();
      c.beginPath(); c.ellipse(s*0.05, -s*0.85, s*0.28, s*0.5, 0.12, 0, Math.PI*2); c.fill();
      const hx = s*0.18, hy = -s*1.42;
      c.beginPath(); c.arc(hx, hy, s*0.22, 0, Math.PI*2); c.fill();
      c.beginPath(); c.ellipse(hx + s*0.2, hy + s*0.04, s*0.1, s*0.08, 0.2, 0, Math.PI*2); c.fill();
      this.limb(c, hx - s*0.08, hy - s*0.1, hx - s*0.22, hy - s*0.85, s*0.13, s*0.06);
      this.limb(c, hx + s*0.08, hy - s*0.1, hx + s*0.05, hy - s*0.9, s*0.13, s*0.06);
      this.limb(c, s*0.28, -s*0.35, s*0.36, -s*0.02, s*0.12, s*0.06);
      c.fillStyle = css(mix(this.tok.ink, this.tok.moon, 0.5));
      c.beginPath(); c.arc(hx + s*0.08, hy - s*0.04, Math.max(0.6, s*0.05), 0, Math.PI*2); c.fill();
    } else {
      // The lope, frame by frame: gathered with the hind right under it, the
      // drive, the long hollow-backed stretch, and the forefeet reaching down
      // to take the landing while the hind swing through outside them.
      const g = o.leap || null;
      const st = g ? g.stretch : 0;      // 0 gathered, 1 stretched mid-lope
      const hs = g ? (g.hind + 1)/2 : 0, fs = g ? (g.fore + 1)/2 : 0;
      const arch = g ? g.arch : 0;
      const air = g ? Math.min(1, Math.max(0, g.rise)*2.4) : 0;
      const hFold = g ? Math.max(0, -g.hind)*air : 0;
      const fFold = g ? Math.max(0, -g.fore)*air : 0;
      if (g) { c.translate(0, -s*0.5); c.rotate(-g.tilt*0.24); c.translate(0, s*0.5); }
      // long hind legs driving, forelegs reaching
      const hfx = -s*0.6 - hs*s*0.5, hfy = -s*0.05 - hFold*s*0.32;
      this.limb(c, -s*0.5, -s*0.42, hfx, hfy, s*0.34, s*0.09);
      c.strokeStyle = o.color; c.lineWidth = Math.max(1, s*0.09); c.lineCap = "round";
      c.beginPath();
      c.moveTo(hfx, hfy);
      c.lineTo(hfx + s*0.25 - hs*s*0.25, hfy + s*0.03);
      c.stroke();
      this.limb(c, s*0.42, -s*0.5, s*(0.62 + fs*0.25), -s*0.05 - fFold*s*0.34, s*0.13, s*0.05);
      // long low body — rounded over the hips gathering, hollow at full stretch
      c.beginPath();
      c.ellipse(-st*s*0.05, -s*0.52 - arch*s*0.05, s*(0.85 + st*0.2), s*(0.4 - st*0.06),
        -st*0.1 - arch*0.10, 0, Math.PI*2);
      c.fill();
      // head with the great ears laid along the back
      const hx = s*(0.72 + st*0.15), hy = -s*(0.78 + st*0.1) - arch*s*0.03;
      c.beginPath(); c.arc(hx, hy, s*0.2, 0, Math.PI*2); c.fill();
      c.beginPath(); c.ellipse(hx + s*0.17, hy + s*0.04, s*0.1, s*0.07, 0.2, 0, Math.PI*2); c.fill();
      this.limb(c, hx - s*0.05, hy - s*0.08, hx - s*0.6, hy - s*0.3, s*0.13, s*0.06);
      this.limb(c, hx + s*0.06, hy - s*0.1, hx - s*0.45, hy - s*0.42, s*0.13, s*0.06);
      c.fillStyle = css(mix(this.tok.ink, this.tok.moon, 0.5));
      c.beginPath(); c.arc(hx + s*0.07, hy - s*0.04, Math.max(0.6, s*0.045), 0, Math.PI*2); c.fill();
    }
    c.restore();
  }

  /* A hedgehog — a dome of spines on busy little feet, nose to the ground. */
  paintHedgehog(c, o) {
    const s = o.s, t = o.t || 0;
    c.save();
    c.translate(o.x, o.y);
    if (o.dir < 0) c.scale(-1, 1);
    c.fillStyle = o.color; c.strokeStyle = o.color; c.lineCap = "round";
    // Four very short legs going very fast under a dome that hardly moves —
    // which is why a hedgehog looks to be on wheels. The body rocks forward
    // over each pair as they come down.
    const u = t*9*TURN;
    const sb = gaitPose("scurry", u);
    const bob = (sb.rise - 0.5)*s*0.045;
    const up = o.sniffUp || 0;         // front lifted, nose reading the air
    if (up > 0.01) { c.translate(0, 0); c.rotate(-up*0.22); }
    // feet, shuffling
    c.lineWidth = Math.max(1, s*0.08);
    c.beginPath();
    const paws = [-0.38, -0.24, 0.28, 0.14];
    for (let i = 0; i < 4; i++) {
      gaitFoot(GAIT.scurry, u + GAIT.scurry.feet[i], FOOT);
      c.moveTo(paws[i]*s, -s*0.10);
      c.lineTo(paws[i]*s + FOOT[0]*s*0.075, s*0.02 - FOOT[1]*s*0.055);
    }
    c.stroke();
    // the dome
    c.beginPath();
    c.moveTo(-s*0.78, -s*0.04 + bob);
    c.quadraticCurveTo(-s*0.6, -s*0.72 + bob, 0, -s*0.72 + bob);
    c.quadraticCurveTo(s*0.55, -s*0.7 + bob, s*0.72, -s*0.16 + bob);
    c.quadraticCurveTo(s*0.4, -s*0.02, -s*0.78, -s*0.04 + bob);
    c.closePath(); c.fill();
    // snout, down and questing — or raised, twitching, into the wind
    const sniff = Math.sin(t*5)*s*0.03 + sb.nod*s*0.02;
    const ny = sniff - up*s*0.34;
    c.beginPath();
    c.moveTo(s*0.6, -s*0.3 + bob);
    c.quadraticCurveTo(s*0.95, -s*0.12 + ny, s*1.04, ny);
    c.lineTo(s*0.62, -s*0.05);
    c.closePath(); c.fill();
    c.beginPath(); c.arc(s*1.04, ny, Math.max(0.7, s*0.05), 0, Math.PI*2); c.fill();
    // spines — short strokes fanned over the dome
    c.strokeStyle = o.rim || o.color;
    c.lineWidth = Math.max(0.5, s*0.04);
    c.globalAlpha = (c.globalAlpha || 1)*0.6;
    c.beginPath();
    for (let k = 0; k < 9; k++) {
      const aa = Math.PI*(0.15 + k*0.085);
      const px2 = -s*0.05 - Math.cos(aa)*s*0.62, py2 = -s*0.36 + bob - Math.sin(aa)*s*0.38;
      c.moveTo(px2, py2);
      c.lineTo(px2 - Math.cos(aa)*s*0.22, py2 - Math.sin(aa)*s*0.22);
    }
    c.stroke();
    c.globalAlpha = 1;
    c.restore();
  }

  /* A badger — low, broad and unhurried, the striped head down at the
     ground as it trundles its night rounds. */
  paintBadger(c, o) {
    const s = o.s;
    c.save();
    c.translate(o.x, o.y);
    if (o.dir < 0) c.scale(-1, 1);
    c.fillStyle = o.color;
    const dg = o.dig || null;          // the digging stroke, or null for the round
    // Short legs under a great deal of animal: a long stance, a swing that
    // barely clears the litter, and the whole body rolling shoulder to
    // shoulder over each pair as it comes down.
    const u = (o.lp || 0)*TURN;
    const tb = dg ? null : gaitPose("trundle", u);
    const roll = tb ? (tb.rise - 0.5)*s*0.035 : 0;
    const off2 = [-0.45, -0.2, 0.25, 0.45];
    for (let i = 0; i < 4; i++) {
      let sw = 0, lift = 0;
      if (tb) {
        gaitFoot(GAIT.trundle, u + GAIT.trundle.feet[i], FOOT);
        sw = FOOT[0]*s*0.11; lift = FOOT[1]*s*0.06;
      } else if (i > 1) {                   // the forepaws work the ground
        sw = dg.reach*s*0.14; lift = Math.max(0, -dg.pull)*s*0.04;
      }
      this.limb(c, off2[i]*s, -s*0.3 - roll, off2[i]*s + sw, -lift, s*0.16, s*0.08);
    }
    c.translate(0, -roll);
    // broad low body
    c.beginPath();
    c.moveTo(s*0.55, -s*0.5);
    c.quadraticCurveTo(0, -s*0.68, -s*0.55, -s*0.52);
    c.quadraticCurveTo(-s*0.85, -s*0.36, -s*0.7, -s*0.16);
    c.quadraticCurveTo(-s*0.1, -s*0.06, s*0.5, -s*0.14);
    c.quadraticCurveTo(s*0.75, -s*0.3, s*0.55, -s*0.5);
    c.closePath(); c.fill();
    // wedge head, held low — lower still, and swinging, when it digs
    const dy = dg ? (0.55 + dg.pull*0.45)*s*0.16 : (tb ? tb.nod*s*0.02 : 0);
    c.beginPath();
    c.moveTo(s*0.5, -s*0.44);
    c.quadraticCurveTo(s*0.95, -s*0.3 + dy, s*1.1, -s*0.08 + dy);
    c.lineTo(s*0.55, -s*0.12);
    c.closePath(); c.fill();
    // the two white face stripes
    c.strokeStyle = `rgba(${this.tok.foamRGB}, 0.75)`;
    c.lineWidth = Math.max(0.8, s*0.06);
    c.beginPath();
    c.moveTo(s*1.05, -s*0.1 + dy); c.lineTo(s*0.58, -s*0.34);
    c.moveTo(s*1.02, -s*0.16 + dy); c.lineTo(s*0.62, -s*0.42);
    c.stroke();
    // small round ear
    c.fillStyle = o.color;
    c.beginPath(); c.arc(s*0.56, -s*0.46, s*0.07, 0, Math.PI*2); c.fill();
    c.restore();
  }

  /* An otter swimming — a head, a rolling hump of back, a tail-tip, all
     threaded along the waterline; it dives and is gone. */
  paintOtter(c, o) {
    const s = o.s, ph = o.ph || 0, roll = o.roll || 0;
    c.save();
    c.translate(o.x, o.y);
    if (o.dir < 0) c.scale(-1, 1);
    c.fillStyle = o.color;
    if (roll > 0.02) {
      // over onto its back, paws up, carried along by the current
      c.beginPath(); c.ellipse(0, -s*0.14, s*0.86, s*0.24, 0.05, 0, Math.PI*2); c.fill();
      c.beginPath(); c.ellipse(s*0.72, -s*0.24, s*0.24, s*0.18, -0.2, 0, Math.PI*2); c.fill();
      const paw = Math.sin(ph*2)*s*0.06;
      this.limb(c, s*0.2, -s*0.28, s*0.3 + paw, -s*0.56, s*0.1, s*0.06);
      this.limb(c, -s*0.02, -s*0.28, s*0.06 - paw, -s*0.54, s*0.1, s*0.06);
      c.strokeStyle = `rgba(${this.tok.foamRGB}, 0.3)`; c.lineWidth = 1;
      c.beginPath();
      c.moveTo(-s*0.8, s*0.02); c.quadraticCurveTo(-s*1.5, s*0.1, -s*2.1, s*0.3);
      c.stroke();
      c.restore();
      return;
    }
    // wake
    c.strokeStyle = `rgba(${this.tok.foamRGB}, 0.3)`; c.lineWidth = 1;
    c.beginPath();
    c.moveTo(-s*0.3, s*0.05); c.quadraticCurveTo(-s*1.2, s*0.1, -s*2.0, s*0.28);
    c.moveTo(s*0.5, s*0.06); c.quadraticCurveTo(-s*0.3, s*0.16, -s*1.2, s*0.4);
    c.stroke();
    /* An otter does not bob evenly: a wave travels the length of it. The head
       lifts, the back breaks the surface behind it and highest, the tail
       follows a beat later — and then, for a moment, almost nothing shows. */
    const w = gaitPose("swim", ph*TURN);
    const hd = w.head*s*0.06;
    // head and muzzle above the line
    c.beginPath(); c.ellipse(s*0.55, -s*0.18 - hd, s*0.26, s*0.18, -0.1, 0, Math.PI*2); c.fill();
    c.beginPath(); c.ellipse(s*0.82, -s*0.12 - hd*0.8, s*0.12, s*0.08, 0.1, 0, Math.PI*2); c.fill();
    c.beginPath(); c.arc(s*0.42, -s*0.32 - hd, s*0.06, 0, Math.PI*2); c.fill();  // ear
    // the rolling back, rising and falling as it swims
    const hump = w.hump;
    c.beginPath();
    c.moveTo(s*0.25, s*0.02);
    c.quadraticCurveTo(-s*0.15, -s*0.4*hump - s*0.08, -s*0.6, s*0.0);
    c.closePath(); c.fill();
    // tail-tip breaking behind
    const hump2 = w.tail;
    if (hump2 > 0.22) {
      c.beginPath();
      c.moveTo(-s*0.85, s*0.03);
      c.quadraticCurveTo(-s*1.05, -s*0.22*hump2, -s*1.3, s*0.02);
      c.closePath(); c.fill();
    }
    // eye
    c.fillStyle = css(mix(this.tok.ink, this.tok.moon, 0.5));
    c.beginPath(); c.arc(s*0.6, -s*0.24 - hd, Math.max(0.6, s*0.045), 0, Math.PI*2); c.fill();
    c.restore();
  }

  /* A bumblebee — a furred amber knot with a shimmer where wings should be. */
  paintBee(c, x, y, s, t, colDark) {
    c.save();
    c.translate(x, y);
    c.fillStyle = `rgba(${this.tok.amberRGB}, 0.85)`;
    c.beginPath(); c.ellipse(0, 0, s*0.55, s*0.38, 0.1, 0, Math.PI*2); c.fill();
    c.fillStyle = colDark;
    c.beginPath();
    c.ellipse(-s*0.12, 0, s*0.11, s*0.38, 0.1, 0, Math.PI*2);
    c.ellipse(s*0.32, 0.5, s*0.1, s*0.3, 0.1, 0, Math.PI*2);
    c.fill();
    // wing shimmer
    c.fillStyle = `rgba(${this.tok.foamRGB}, ${0.25 + 0.3*Math.abs(Math.sin(t*40))})`;
    c.beginPath();
    c.ellipse(-s*0.05, -s*0.42, s*0.3, s*0.14, -0.4, 0, Math.PI*2);
    c.fill();
    c.restore();
  }

  /* A tern — lighter and sharper than any gull, deep buoyant wingbeats
     and tail streamers trailing. */
  paintTernFlight(c, x, y, s, dir, ph, col) {
    const g = gaitPose("beatSlow", ph*TURN);
    const k = g.beat*0.85, sp = 0.8 + 0.2*g.span, sw = g.sweep;
    c.save();
    c.translate(x, y);
    if (dir < 0) c.scale(-1, 1);
    c.fillStyle = col;
    const A = c.globalAlpha;
    c.globalAlpha = A*0.6;
    this.wingBlade(c, -s*0.08, -s*0.06, -s*0.9*sp + s*sw*0.16, -s*0.85*k - s*0.35, s*0.24);
    c.globalAlpha = A;
    // slim body and the forked tail streamers
    c.beginPath(); c.ellipse(0, 0, s*0.6, s*0.17, 0, 0, Math.PI*2); c.fill();
    c.strokeStyle = col; c.lineCap = "round"; c.lineWidth = Math.max(0.7, s*0.05);
    c.beginPath();
    c.moveTo(-s*0.45, -s*0.03); c.lineTo(-s*1.05, -s*0.14);
    c.moveTo(-s*0.45, s*0.03);  c.lineTo(-s*0.95, s*0.1);
    c.stroke();
    c.beginPath(); c.arc(s*0.58, -s*0.06, s*0.16, 0, Math.PI*2); c.fill();
    c.beginPath();
    c.moveTo(s*0.7, -s*0.08); c.lineTo(s*0.95, -s*0.02); c.lineTo(s*0.7, s*0.03);
    c.closePath(); c.fill();
    this.wingBlade(c, s*0.04, -s*0.04, -s*0.55*sp + s*sw*0.2, -s*1.05*k - s*0.42, s*0.3);
    c.restore();
  }

  /* A kestrel holding its cross in the wind — tail fanned hard down,
     wings winnowing; when it slips away it goes on flat wings. */
  paintKestrelFlight(c, x, y, s, ph, col, hovering, dir) {
    // Winnowing, the wing has no time to fold — the beat is shallow and quick
    // and it is the sweep, forward and back, that holds the bird still.
    const g = hovering ? gaitPose("beatWhir", ph*TURN) : null;
    const k = g ? g.beat*0.32 : 0.12;
    const sw = g ? g.sweep : 0;
    c.save();
    c.translate(x, y);
    if (dir < 0) c.scale(-1, 1);
    c.rotate(-0.12);
    c.fillStyle = col;
    const A = c.globalAlpha;
    // fanned tail, pressed down to hold station
    if (hovering) {
      for (let f = -1; f <= 1; f++) {
        this.limb(c, -s*0.35, s*0.02, -s*0.95 - Math.abs(f)*s*0.06, s*0.42 + f*s*0.16, s*0.2, s*0.1);
      }
    } else {
      this.limb(c, -s*0.35, 0, -s*1.0, s*0.1, s*0.2, s*0.1);
    }
    c.globalAlpha = A*0.6;
    this.wingBlade(c, -s*0.05, -s*0.08, -s*0.8 + s*sw*0.14, -s*0.7*k - s*0.4, s*0.34);
    c.globalAlpha = A;
    // body head-down into the wind
    c.beginPath(); c.ellipse(0, 0, s*0.52, s*0.2, 0.08, 0, Math.PI*2); c.fill();
    c.beginPath(); c.arc(s*0.5, s*0.02, s*0.17, 0, Math.PI*2); c.fill();
    c.beginPath();
    c.moveTo(s*0.62, 0); c.lineTo(s*0.78, s*0.08); c.lineTo(s*0.58, s*0.1);
    c.closePath(); c.fill();
    this.wingBlade(c, s*0.02, -s*0.06, -s*0.5 + s*sw*0.18, -s*0.9*k - s*0.5, s*0.4);
    c.restore();
  }

  /* A buzzard wheeling — broad plank wings barely moving, primaries
     fingered at the tips, the whole bird banking round its circle. */
  paintBuzzardSoar(c, x, y, s, bank, dir, col) {
    c.save();
    c.translate(x, y);
    if (dir < 0) c.scale(-1, 1);
    c.rotate(bank*0.22);
    c.fillStyle = col; c.strokeStyle = col; c.lineCap = "round";
    // both wings held out flat, a shallow V
    this.wingBlade(c, -s*0.06, -s*0.02, -s*1.45, -s*0.3 - bank*s*0.14, s*0.55);
    this.wingBlade(c, s*0.06, -s*0.02, s*1.45, -s*0.3 + bank*s*0.14, -s*0.55);
    // fingered primaries
    c.lineWidth = Math.max(0.7, s*0.045);
    c.beginPath();
    for (const sd of [-1, 1]) {
      for (let f = 0; f < 3; f++) {
        const tx2 = sd*s*(1.35 + f*0.06), ty2 = -s*0.28 + sd*bank*s*0.14*sd + f*s*0.07;
        c.moveTo(tx2 - sd*s*0.16, ty2);
        c.lineTo(tx2 + sd*s*0.1, ty2 - s*0.06);
      }
    }
    c.stroke();
    // body, fanned tail, small head
    c.beginPath(); c.ellipse(0, 0, s*0.34, s*0.2, 0, 0, Math.PI*2); c.fill();
    for (let f = -1; f <= 1; f++) {
      this.limb(c, -s*0.2, s*0.02, -s*0.62, s*0.16 + f*s*0.12, s*0.16, s*0.1);
    }
    c.beginPath(); c.arc(s*0.38, -s*0.02, s*0.13, 0, Math.PI*2); c.fill();
    c.restore();
  }

  /* Birds on the wing. Paired with drawFlyers below — the flight is decided
     here, the wings are drawn there. */
  updateFlyers(dt) {
    for (let i = this.flyers.length - 1; i >= 0; i--) {
      const f = this.flyers[i];
      f.age = (f.age || 0) + dt;
      if (f.kind === "lark" && f.hold > 0) {
        f.hold -= dt;
        f.x += Math.sin(f.ph)*0.0003;
        f.y -= dt*0.004;
        f.ph += dt*22;
      } else if (f.kind === "kestrel") {
        // winnowing in place over one spot, then slipping off downwind
        if (f.hold > 0) {
          f.hold -= dt; f.ph += dt*15;
          f.x += Math.sin(f.ph*0.21)*0.0002;
          f.y += Math.sin(f.ph*0.13)*0.0002;
        } else {
          if (!f.vx) f.vx = (Math.random() < 0.5 ? 1 : -1)*0.045;
          f.x += f.vx*dt*3; f.ph += dt*7;
        }
      } else if (f.kind === "buzzard") {
        // wheeling a slow circle that itself drifts across the sky
        f.ph += dt;
        if (f.hold > 0) {
          f.hold -= dt; f.ang += dt*0.55; f.cx += dt*0.0022;
          f.x = f.cx + Math.cos(f.ang)*0.06;
          f.y = f.cy + Math.sin(f.ang)*0.028;
        } else {
          if (!f.vx) f.vx = (f.x < 0.5 ? -1 : 1)*0.03;
          f.x += f.vx*dt*3;
        }
      } else {
        if (f.kind === "lark" && !f.vx) f.vx = (Math.random() < 0.5 ? 1 : -1)*0.05;
        f.x += f.vx*dt*3;
        f.ph += dt * (f.kind === "swift" ? 16 : f.kind === "gull" ? 5 :
                      f.kind === "lark" ? 22 : f.kind === "tern" ? 7 : 11);
      }
      if (f.x < -0.12 || f.x > 1.12 || f.y < -0.05) { this.flyers.splice(i, 1); continue; }
    }
  }

  /* …and the wings. Paired with updateFlyers above. */
  drawFlyers(c, W, H, bot) {
    const colNear = mix(this.tok.ink, bot, 0.2);
    for (let i = this.flyers.length - 1; i >= 0; i--) {
      const f = this.flyers[i];
      const fx = f.x*W;
      const bob = f.kind === "swift" ? Math.sin(f.ph*0.5)*9 :
                  f.kind === "buzzard" || f.kind === "kestrel" ? 0 : Math.sin(f.ph*0.3)*4;
      const fy = f.y*H + bob;
      const dir = (f.vx || 0.01) >= 0 ? 1 : -1;
      // A small bird in the sky is a distant one: it loses itself in the air
      // by the same amount that it has lost its size.
      const far = Math.max(0, Math.min(1, 1 - (f.size - 2.4)/9));
      const col = css(mix(colNear, bot, far*0.45));
      c.globalAlpha = Math.min(1, f.age*2) * (1 - far*0.3);
      if (f.kind === "gull") this.paintGullFlight(c, fx, fy, f.size, dir, f.ph, col);
      else if (f.kind === "swift") this.paintSwiftFlight(c, fx, fy, f.size, dir, f.ph, col);
      else if (f.kind === "lark") this.paintLarkFlight(c, fx, fy, f.size, f.ph, col, f.hold > 0);
      else if (f.kind === "tern") this.paintTernFlight(c, fx, fy, f.size, dir, f.ph, col);
      else if (f.kind === "kestrel") this.paintKestrelFlight(c, fx, fy, f.size, f.ph, col, f.hold > 0, dir);
      else if (f.kind === "buzzard") this.paintBuzzardSoar(c, fx, fy, f.size,
        Math.sin(f.ang || 0), -Math.sin(f.ang || 0) >= 0 ? 1 : -1, col);
      else this.paintSmallBirdFlight(c, fx, fy, f.size, dir, f.ph, col);
      c.globalAlpha = 1;
    }
  }

  /* A gull on long elbowed wings — mostly gliding, the odd lazy downstroke,
     the heavy bill giving the head its hook. Each wing is two blades meeting
     at the wrist, so the span keeps its characteristic kink. */
  paintGullFlight(c, x, y, s, dir, ph, col) {
    const glide = 0.3 + 0.7*Math.max(0, Math.sin(ph*0.11));
    const g = gaitPose("beatSlow", ph*TURN);
    const k = g.beat*glide;
    const sp = 0.82 + 0.18*g.span, sw = g.sweep*glide;
    c.save();
    c.translate(x, y);
    if (dir < 0) c.scale(-1, 1);
    c.fillStyle = col;
    const A = c.globalAlpha;
    const wing = (rootX, rootY, sc) => {
      const wrX = rootX + s*(0.12 + sw*0.12)*sc, wrY = rootY - s*0.55*sc - s*0.62*k*sc;
      this.wingBlade(c, rootX, rootY, wrX, wrY, s*0.34*sc);
      this.wingBlade(c, wrX, wrY, wrX - s*0.95*sp*sc + s*sw*0.16*sc,
        wrY - s*0.28*k*sc + s*0.1*sc, s*0.26*sc);
    };
    c.globalAlpha = A*0.6;
    wing(-s*0.1, -s*0.06, 0.85);
    c.globalAlpha = A;
    c.beginPath(); c.ellipse(0, 0, s*0.68, s*0.24, 0, 0, Math.PI*2); c.fill();
    c.beginPath();
    c.moveTo(-s*0.5, -s*0.08); c.lineTo(-s*0.95, -s*0.02); c.lineTo(-s*0.5, s*0.1);
    c.closePath(); c.fill();
    c.beginPath(); c.arc(s*0.66, -s*0.08, s*0.19, 0, Math.PI*2); c.fill();
    c.beginPath();
    c.moveTo(s*0.8, -s*0.1); c.lineTo(s*1.05, -s*0.03); c.lineTo(s*0.8, s*0.02);
    c.closePath(); c.fill();
    wing(s*0.05, -s*0.05, 1);
    c.restore();
  }

  /* A swift — all scythe: slender body, forked tail, wings swept hard back. */
  paintSwiftFlight(c, x, y, s, dir, ph, col) {
    const g = gaitPose("beatWhir", ph*TURN);
    const k = g.beat*0.5 + 0.2, sw = g.sweep;
    c.save();
    c.translate(x, y);
    if (dir < 0) c.scale(-1, 1);
    c.fillStyle = col;
    const A = c.globalAlpha;
    c.globalAlpha = A*0.6;
    this.wingBlade(c, 0, -s*0.04, -s*1.05 + s*sw*0.14, -s*0.5*k - s*0.55, s*0.22);
    c.globalAlpha = A;
    c.beginPath(); c.ellipse(s*0.05, 0, s*0.5, s*0.14, 0, 0, Math.PI*2); c.fill();
    c.beginPath();
    c.moveTo(-s*0.35, -s*0.02); c.lineTo(-s*0.8, -s*0.12); c.lineTo(-s*0.45, s*0.02);
    c.lineTo(-s*0.75, s*0.14); c.lineTo(-s*0.35, s*0.04);
    c.closePath(); c.fill();
    c.beginPath(); c.arc(s*0.5, -s*0.03, s*0.14, 0, Math.PI*2); c.fill();
    this.wingBlade(c, s*0.1, -s*0.02, -s*0.85 + s*sw*0.16, -s*0.72*k - s*0.62, s*0.26);
    c.restore();
  }

  /* The skylark's song-flight — fluttering almost in place, wings a blur of
     ghosted beats, tail spread beneath. */
  paintLarkFlight(c, x, y, s, ph, col, hovering) {
    const g = gaitPose("beatWhir", ph*TURN);
    const k = g.beat;
    c.save();
    c.translate(x, y);
    c.fillStyle = col;
    const A = c.globalAlpha;
    c.globalAlpha = A*0.5;
    this.wingBlade(c, -s*0.05, -s*0.1, -s*0.7, -s*0.9*k - s*0.35, s*0.4);
    this.wingBlade(c, s*0.05, -s*0.1, s*0.6, -s*0.9*k - s*0.4, s*0.4);
    c.globalAlpha = A*0.28;
    this.wingBlade(c, -s*0.05, -s*0.1, -s*0.7, s*0.36*k - s*0.5, s*0.4);
    this.wingBlade(c, s*0.05, -s*0.1, s*0.6, s*0.36*k - s*0.55, s*0.4);
    c.globalAlpha = A;
    c.beginPath(); c.ellipse(0, 0, s*0.4, s*0.5, 0.2, 0, Math.PI*2); c.fill();
    c.beginPath(); c.arc(s*0.14, -s*0.5, s*0.22, 0, Math.PI*2); c.fill();
    if (hovering) {
      c.beginPath();
      c.moveTo(-s*0.15, s*0.3);
      c.lineTo(-s*0.55, s*0.85); c.lineTo(-s*0.1, s*0.95); c.lineTo(s*0.25, s*0.8);
      c.closePath(); c.fill();
    }
    c.restore();
  }

  /* A small bird crossing the sky — filled body, beating wing blades. */
  paintSmallBirdFlight(c, x, y, s, dir, ph, col) {
    const g = gaitPose("beatQuick", ph*TURN);
    const k = g.beat, sp = 0.7 + 0.3*g.span, sw = g.sweep;
    c.save();
    c.translate(x, y);
    if (dir < 0) c.scale(-1, 1);
    c.fillStyle = col;
    const A = c.globalAlpha;
    c.globalAlpha = A*0.65;
    this.wingBlade(c, -s*0.05, -s*0.1, -s*0.75*sp + s*sw*0.16, -s*0.8*k - s*0.35, s*0.4);
    c.globalAlpha = A;
    c.beginPath(); c.ellipse(0, 0, s*0.55, s*0.26, 0, 0, Math.PI*2); c.fill();
    c.beginPath();
    c.moveTo(-s*0.4, -s*0.04); c.lineTo(-s*0.85, s*0.02); c.lineTo(-s*0.4, s*0.12);
    c.closePath(); c.fill();
    c.beginPath(); c.arc(s*0.52, -s*0.08, s*0.2, 0, Math.PI*2); c.fill();
    this.wingBlade(c, s*0.05, -s*0.08, -s*0.45*sp + s*sw*0.2, -s*0.95*k - s*0.4, s*0.45);
    c.restore();
  }

  /* Fireflies hold still in the daylight and in the rain, which is the same
     test that decides whether any of them are drawn. */
  updateFireflies(dt, night) {
    const ffA = night * (1 - state.wx.wet*0.85);
    if (ffA < 0.05 || !this.fireflies.length) return;
    for (const ff of this.fireflies) {
      ff.x += (ff.dx + Math.sin(this.t*0.3 + ff.ph)*0.006) * dt;
      if (ff.x < 0) ff.x = 1; if (ff.x > 1) ff.x = 0;
    }
  }

  drawFireflies(c, W, H, night) {
    const ffA = night * (1 - state.wx.wet*0.85);
    if (ffA < 0.05 || !this.fireflies.length) return;
    const rgb = this.tok.fireflyRGB;
    for (const ff of this.fireflies) {
      // up almost at once and out slowly, which is a light going out
      const blink = gaitAt("flash", this.t*ff.sp*0.32 + ff.ph, "lit");
      const a = blink * 0.8 * ffA;
      if (a < 0.03) continue;
      const fx = ff.x*W, fy = ff.y*H + Math.sin(this.t*0.7+ff.ph)*5;
      this.drawGlow(c, rgb, fx, fy, 7, 7, a);
    }
  }

  /* Only the weather that is actually falling moves: rain drops and blown seeds
     each advance under their own test for the weather, exactly as before. */
  updateWeather(dt) {
    const wet = state.wx.wet, haze = state.wx.haze, gust = state.wx.gust;
    if (wet > 0.01) {
      /* Rain is not a curtain lowered at a constant rate. It comes in squalls,
         it leans with whatever the wind is doing — the same gust the grass is
         answering — and the near drops lean and hurry more than the far ones,
         because they are nearer. Where a drop lands it leaves something.

         How *much* rain is `wet`, and it is spent on the number of drops
         rather than only on how faint each one is: a shower coming on is
         first a few drops and then many, not the same downpour behind gauze.
         The drops beyond the count simply are not stepped, so the shower
         costs what it looks like it costs. */
      const squall = 0.55 + 0.45*gaitAt("gust", this.t*0.045 + 1.7, "force");
      const lean = 0.06 + this.windBend(0.5)*0.55;
      const live = Math.ceil(this.rain.length * wet);
      for (let i = 0; i < live; i++) {
        const d = this.rain[i];
        const near = 1 - d.z;
        d.y += d.sp * dt * 1.6 * squall;
        d.x += (0.012 + lean*(0.35 + near*0.5)) * dt * squall;
        if (d.x > 1.05) d.x -= 1.1;
        const floor = this.rainFloor(d.z);
        if (d.y > floor) {
          // a ring where it meets water, a flick of spray where it meets land
          if (this.splashes.length < 44 && Math.random() < 0.5) {
            this.splashes.push({ x: d.x, y: floor, z: d.z, age: 0,
              wet: this.rainOnWater(d.x, floor) });
          }
          d.y = -0.05; d.x = Math.random(); d.z = Math.random();
          d.sp = (1.5 - d.z*0.75)*(0.9 + Math.random()*0.3);
          d.len = (0.030 - d.z*0.020)*(0.8 + Math.random()*0.5);
        }
      }
    }
    // The last few go on landing and fading after the shower has passed.
    for (let i = this.splashes.length - 1; i >= 0; i--) {
      const sp = this.splashes[i];
      sp.age += dt;
      if (sp.age > 0.45) this.splashes.splice(i, 1);
    }
    // Seeds are what a wind carries, so they are the wind's own count.
    if (gust > 0.35) {
      const live = Math.ceil(this.seeds.length * (gust - 0.35)/0.65);
      for (let i = 0; i < live; i++) {
        const s = this.seeds[i];
        s.x += s.sp * dt * 2 * gust;
        s.ph += dt;
        if (s.x > 1.05) { s.x = -0.05; s.y = 0.3 + Math.random()*0.5; }
      }
    }
    if (haze > 0.02) {
      for (const f of this.fog) f.x += f.sp * dt;
    }
  }

  drawWeather(c, W, H, night) {
    const wet = state.wx.wet, haze = state.wx.haze, gust = state.wx.gust;
    if (wet > 0.01) {
      /* Three depths, three pens. Near drops are long, dark and nearly
         vertical; far ones are short, faint and hang in the air — the same
         haze that greys the hills greys the rain in front of them. All of them
         lean the way the wind is leaning, and the near ones lean most. */
      const lean = 0.06 + this.windBend(0.5)*0.55;
      const squall = 0.55 + 0.45*gaitAt("gust", this.t*0.045 + 1.7, "force");
      /* The same count `updateWeather` is stepping — drawing a drop that is
         not being moved leaves it hanging in the air. The pen fades with the
         shower on top of that, so the first of it is a few faint drops and
         the height of it is many dark ones. */
      const live = Math.ceil(this.rain.length * wet);
      const fade = Math.min(1, 0.35 + wet*0.85);
      for (let band = 2; band >= 0; band--) {
        const z0 = band/3, z1 = (band + 1)/3, mid = (z0 + z1)/2;
        c.strokeStyle = `rgba(${this.tok.rainRGB}, ${(0.44 - mid*0.30)*squall*fade})`;
        c.lineWidth = 1.5 - mid;
        c.lineCap = "round";
        c.beginPath();
        for (let i = 0; i < live; i++) {
          const d = this.rain[i];
          if (d.z < z0 || d.z >= z1) continue;
          const rx = d.x*W, ry = d.y*H, dl = d.len*H;
          c.moveTo(rx, ry);
          c.lineTo(rx - dl*lean*(1.4 - d.z*0.7), ry + dl);
        }
        c.stroke();
      }
    }
    // and where each one landed — which outlasts the shower by half a second
    if (this.splashes.length) {
      for (const sp of this.splashes) {
        const u = sp.age/0.45, near = 1 - sp.z;
        const a = (1 - u)*(1 - u)*0.5*(0.35 + near*0.65);
        if (a < 0.02) continue;
        const sx = sp.x*W, sy = sp.y*H, r = (2 + near*4)*(0.3 + u*2.4);
        if (sp.wet) {                      // a ring, opening and flattening
          c.strokeStyle = `rgba(${this.tok.foamRGB}, ${a})`;
          c.lineWidth = 1;
          c.beginPath(); c.ellipse(sx, sy, r, r*0.3, 0, 0, Math.PI*2); c.stroke();
        } else {                           // a flick of spray, up and gone
          // pale, not rain-coloured: spray catches the light, and dark ground
          // is exactly where a dark mark would not be seen at all
          c.strokeStyle = `rgba(${this.tok.foamRGB}, ${a*0.9})`;
          c.lineWidth = 1;
          const h2 = (1.6 + near*3)*Math.sin(Math.PI*Math.min(1, u*1.3));
          c.beginPath();
          c.moveTo(sx - r*0.5, sy); c.lineTo(sx - r*0.8, sy - h2);
          c.moveTo(sx + r*0.5, sy); c.lineTo(sx + r*0.8, sy - h2);
          c.stroke();
        }
      }
    }
    if (gust > 0.35) {
      const live = Math.ceil(this.seeds.length * (gust - 0.35)/0.65);
      c.fillStyle = `rgba(${this.tok.cloudRGB}, ${0.5*Math.min(1, (gust - 0.35)*3)})`;
      for (let i = 0; i < live; i++) {
        const s = this.seeds[i];
        const sx = s.x*W, sy = s.y*H + Math.sin(s.ph*1.3)*10;
        c.beginPath(); c.arc(sx, sy, 1.3, 0, Math.PI*2); c.fill();
      }
    }
    if (haze > 0.02) {
      // The three fog bands used to build a fresh gradient every frame, which
      // is pure allocation churn for something that barely changes. Cache them
      // against the height and a coarse step of the light instead.
      /* The bands are cached against the height and a coarse step of the
         light — building three gradients a frame is pure allocation churn for
         something that barely changes. How thick the fog is now steps the key
         as well, coarsely, so it can come over without rebuilding every
         frame on the way. */
      const step = Math.round(night*8), hstep = Math.round(haze*10);
      const key = (H|0) + "|" + step + "|" + hstep;
      if (key !== this._fogKey) {
        this._fogKey = key;
        const peak = 0.28 * (1 - (step/8)*0.4) * (hstep/10);
        this._fogGrads = this.fog.map(f => {
          const g = c.createLinearGradient(0, f.y*H - f.h*H, 0, f.y*H + f.h*H);
          g.addColorStop(0, `rgba(${this.tok.fogRGB}, 0)`);
          g.addColorStop(0.5, `rgba(${this.tok.fogRGB}, ${peak})`);
          g.addColorStop(1, `rgba(${this.tok.fogRGB}, 0)`);
          return g;
        });
      }
      for (let fi = 0; fi < this.fog.length; fi++) {
        const f = this.fog[fi];
        const fy = f.y * H;
        c.fillStyle = this._fogGrads[fi];
        const drift = Math.sin(this.t*0.1 + f.x*10) * W * 0.05;
        c.fillRect(-W*0.1 + drift, fy - f.h*H, W*1.2, f.h*H*2);
      }
    }
  }

  updateRipples(dt) {
    for (let i = this.ripples.length - 1; i >= 0; i--) {
      const r = this.ripples[i];
      r.age += dt;
      if (r.age > r.life) { this.ripples.splice(i, 1); continue; }
    }
  }

  drawRipples(c, W, H) {
    for (let i = this.ripples.length - 1; i >= 0; i--) {
      const r = this.ripples[i];
      const p = r.age / r.life;
      const rx = r.x*W, ry = r.y*H;
      for (let k = 0; k < 3; k++) {
        const pp = p - k*0.14;
        if (pp < 0) continue;
        const rad = pp * Math.min(W,H) * 0.22;
        c.strokeStyle = `rgba(${r.rgb}, ${(1-pp)*(1-pp)*0.55})`;
        c.lineWidth = 1;
        c.beginPath(); c.arc(rx, ry, rad, 0, Math.PI*2); c.stroke();
      }
      c.fillStyle = `rgba(${r.rgb}, ${(1-p)*0.9})`;
      c.beginPath(); c.arc(rx, ry, 2, 0, Math.PI*2); c.fill();
    }
  }
}

export { Scene };
