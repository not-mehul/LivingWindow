/* ============================================================
   The scene — five etched landscapes behind one pane of glass,
   now inhabited: singers appear where they sing, and the land
   has its own quiet traffic of butterflies, bats, deer and cats.
   ============================================================ */
import {
  mulberry32, parseColor, css, mix, themeVar, REDUCED, LOC_HASH, state
} from "./util.js?v=5";
import { PSTYLE } from "./species.js?v=5";
import { makeSkyPainter, Canvas2DSky } from "./sky.js?v=5";

const PHASES = ["dawn", "day", "dusk", "night"];   // hoisted: no per-frame array literal

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
    this.loc = loc;
    this.flyers = []; this.ripples = [];
    this.actors = []; this.critters = [];
    this.fishRings = []; this.meteors = [];
    this.lastDeer = this.t - 60; this.lastCat = this.t - 40; this.lastSkein = this.t - 20;
    this.lastFox = this.t - 55; this.lastRabbit = this.t - 30; this.lastHeron = this.t - 50;
    this.lastPorpoise = this.t - 40; this.lastSquirrel = this.t - 25; this.lastHare = this.t - 50;
    this.lastHedgehog = this.t - 60; this.lastBadger = this.t - 80; this.lastOtter = this.t - 45;
    this.lastPounce = this.t - 20;

    this.clouds = [];
    const nc = 2 + Math.floor(rng()*3);
    for (let i = 0; i < nc; i++) {
      this.clouds.push({ x: rng(), y: 0.10 + rng()*0.28, w: 0.16 + rng()*0.22, s: 0.004 + rng()*0.006, a: 0.10 + rng()*0.10 });
    }
    this.rain = [];
    for (let i = 0; i < (REDUCED ? 50 : 110); i++) {
      this.rain.push({ x: Math.random(), y: Math.random(), sp: 0.9 + Math.random()*0.7, len: 0.02 + Math.random()*0.02 });
    }
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
      for (let i = 0; i < 15; i++) {
        const edge = rng() < 0.78;
        this.fg.push({ x: edge ? (rng() < 0.5 ? rng()*0.3 - 0.03 : 0.73 + rng()*0.3) : rng(),
          h: edge ? 0.13 + rng()*0.17 : 0.05 + rng()*0.05,
          ph: rng()*Math.PI*2, lean: (rng() - 0.5)*0.9, head: rng() < 0.3 });
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
      this.hillA = this.makeRidge(rng, 0.62, 0.10);
      this.hillB = this.makeRidge(rng, 0.78, 0.07);
      this.treeX = rng() < 0.5 ? 0.12 + rng()*0.1 : 0.78 + rng()*0.1;
      this.tree = this.makeTree(rng);
      // Foliage gathered at the ends of the branches. A tree standing bare in
      // a summer field is the one thing in this view that never looked right.
      this.treeLeaves = [];
      for (const sg of this.tree) {
        if (sg.w > 1 || rng() < 0.25) continue;
        this.treeLeaves.push({ x: sg.x2, y: sg.y2, r: 0.026 + rng()*0.03,
          dx: (rng()-0.5)*0.02, dy: (rng()-0.5)*0.02 });
      }
      this.grass = this.makeGrass(rng, 110, 0.03, 0.05);
      // A hedgerow running across the middle distance — the field boundary
      // that stops the middle of the picture from being an empty band of
      // colour — then a couple of far trees, wildflowers and stones.
      this.hedgeLine = (x) => (this.hillA(x) + this.hillB(x))*0.5 + 0.012;
      this.hedge = this.makeHedgerow(rng, this.hedgeLine);
      // a couple of shrubs standing out on their own, away from the hedge line
      this.shrubs = [];
      for (let i = 0; i < 2 + Math.floor(rng()*3); i++) {
        const x = rng();
        this.shrubs.push({ x, y: this.hillB(x), r: 0.014 + rng()*0.022, seed: rng() });
      }
      // Cattle out on the far hill, in ones and twos as cattle actually stand.
      this.cattle = [];
      if (rng() < 0.8) {
        const herd = 2 + Math.floor(rng()*4);
        let cx = 0.10 + rng()*0.55;
        for (let i = 0; i < herd; i++) {
          cx += (0.035 + rng()*0.085);
          if (cx > 0.94) break;
          this.cattle.push({ x: cx, sz: 0.85 + rng()*0.3, dir: rng() < 0.5 ? -1 : 1,
            ph: rng()*Math.PI*2, calf: rng() < 0.22,
            // most of a cow's day is head-down; the rest is standing about
            head: rng() < 0.68 ? 1 : 0, next: 6 + rng()*14 });
        }
      }
      this.distantTrees = [];
      for (let i = 0; i < 2 + Math.floor(rng()*2); i++) {
        const x = 0.08 + rng()*0.84;
        this.distantTrees.push({ x, y: this.hillA(x), h: 0.05 + rng()*0.05, r: 0.018 + rng()*0.022 });
      }
      this.flowers = [];
      for (let i = 0; i < 18 + Math.floor(rng()*12); i++) {
        this.flowers.push({ x: rng(), h: 0.018 + rng()*0.028, tone: rng(), ph: rng()*Math.PI*2 });
      }
      this.rocks = [];
      for (let i = 0; i < 3 + Math.floor(rng()*4); i++) {
        this.rocks.push({ x: 0.04 + rng()*0.92, r: 0.008 + rng()*0.016, shade: rng() });
      }
      // Perches derived from the tree's real branch tips, so a bird lands on a
      // branch that is actually drawn — never floating in mid-air.
      const baseYn = this.hillB(this.treeX);
      const tips = this.tree
        .filter(sg => sg.w <= 1)
        .map(sg => ({ x: this.treeX + sg.x2*0.5, y: baseYn + sg.y2*0.9 }))
        .filter(p => p.y < baseYn - 0.04 && p.x > 0.04 && p.x < 0.96)
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
      if (this.rocks && this.rocks.length) {
        const rk = this.rocks[Math.floor(rng()*this.rocks.length)];
        this.perches.push({ x: rk.x, y: 0.915, depth: 2.5 + rng()*2, type: "ground" });
      }
      const groundYn = (x) => 0.92 - (x*0.5 - 0.25)*(x*0.5 - 0.25)*0.1;   // the grass line
      for (let k = 0; k < 2; k++) {
        const gx1 = 0.15 + rng()*0.7;
        this.perches.push({ x: gx1, y: groundYn(gx1), depth: 2 + rng()*2, type: "ground" });
      }
      const hx = 0.28 + rng()*0.44;
      this.perches.push({ x: hx, y: this.hillB(hx) - 0.004, depth: 8 + rng()*3, type: "ground" });
    } else if (loc === "forest") {
      this.hillA = this.makeRidge(rng, 0.55, 0.06);
      this.trunksFar = []; this.trunksMid = []; this.trunksNear = [];
      for (let i = 0; i < 11; i++) this.trunksFar.push(this.makeTrunk(rng, 0.30 + rng()*0.12, 2.8 + rng()*1.8, 0.85));
      for (let i = 0; i < 7; i++)  this.trunksMid.push(this.makeTrunk(rng, 0.23 + rng()*0.10, 4.6 + rng()*2.8, 1));
      for (let i = 0; i < 6; i++)  this.trunksNear.push(this.makeTrunk(rng, 0.16 + rng()*0.10, 7.5 + rng()*5, 1.25));
      this.grass = this.makeGrass(rng, 64, 0.04, 0.07);
      // undergrowth: ferns, mushrooms and a slow drift of falling leaves
      this.ferns = [];
      for (let i = 0; i < 16; i++) {
        this.ferns.push({ x: rng(), size: 0.03 + rng()*0.045, lean: (rng()-0.5)*0.7, blades: 4 + Math.floor(rng()*3) });
      }
      this.mushrooms = [];
      for (let i = 0; i < 6 + Math.floor(rng()*5); i++) {
        this.mushrooms.push({ x: rng(), size: 0.006 + rng()*0.011, tall: rng() < 0.5, tone: rng() });
      }
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
      this.foam = [{ p: rng() }, { p: rng() }, { p: rng() }];
      this.wet = 0;          // how far up the sand the last wave reached
      this.duneSide = rng() < 0.5 ? 0 : 1;
      this.duneGrass = [];
      for (let i = 0; i < 32; i++) {
        const gx = this.duneSide === 0 ? rng()*0.26 : 0.74 + rng()*0.26;
        this.duneGrass.push({ x: gx, h: 0.05 + rng()*0.07, ph: rng()*Math.PI*2, lean: (rng()-0.5)*0.8 });
      }
      // pebbles and shells on the wet sand, a rock islet offshore, driftwood
      this.pebbles = [];
      for (let i = 0; i < 18 + Math.floor(rng()*12); i++) {
        this.pebbles.push({ x: rng(), y: this.shoreY + 0.04 + rng()*(0.98 - this.shoreY - 0.04),
          r: 0.004 + rng()*0.011, shade: rng(), shell: rng() < 0.18 });
      }
      // a natural rock islet out on the water (no boats — this is a wild place)
      this.islet = rng() < 0.65 ? { x: 0.12 + rng()*0.76, w: 0.05 + rng()*0.07, h: 0.018 + rng()*0.022 } : null;
      this.driftwood = rng() < 0.6 ? { x: 0.18 + rng()*0.6, w: 0.05 + rng()*0.06, ang: (rng()-0.5)*0.4 } : null;
      this.posts = [];
      const npost = 2 + Math.floor(rng()*2);
      for (let i = 0; i < npost; i++) this.posts.push({ x: 0.2 + rng()*0.6, h: 0.05 + rng()*0.03 });
      this.perches = this.posts.map(p => ({ x: p.x, y: this.shoreY - p.h, depth: 5 + rng()*4, type: "post" }));
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
      this.rippleLines = [];
      for (let i = 0; i < 5; i++) {
        this.rippleLines.push({ y: this.waterY + 0.05 + rng()*(this.bankY - this.waterY - 0.08), ph: rng()*Math.PI*2, sp: 0.06 + rng()*0.08 });
      }
      this.reeds = [];
      for (let i = 0; i < 42; i++) {
        const side = rng();
        const x = side < 0.55 ? rng()*0.34 : 0.66 + rng()*0.34;
        this.reeds.push({ x, h: 0.14 + rng()*0.14, ph: rng()*Math.PI*2, head: rng() < 0.45, lean: (rng()-0.5)*0.5 });
      }
      // lily pads on the open water, a half-sunk log, trees along the far bank
      this.lilies = [];
      for (let i = 0; i < 7 + Math.floor(rng()*5); i++) {
        this.lilies.push({ x: 0.12 + rng()*0.76,
          y: this.waterY + 0.06 + rng()*(this.bankY - this.waterY - 0.1),
          r: 0.014 + rng()*0.022, bloom: rng() < 0.4, ph: rng()*Math.PI*2 });
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
        this.perches.push({ x: b.x + b.w * rng(), y: 0.95 - b.h, depth: 4 + rng()*5, type: "roof" });
      }
      // aerial tips make favourite lookouts
      for (const b of this.frontBlocks) {
        if (b.antenna && rng() < 0.6) {
          this.perches.push({ x: b.x + b.w*0.5, y: 0.95 - b.h - 0.035, depth: 4 + rng()*4, type: "post" });
        }
      }
      // and the far skyline carries the odd distant silhouette
      if (this.backBlocks.length && rng() < 0.7) {
        const bb = this.backBlocks[Math.floor(rng()*this.backBlocks.length)];
        this.perches.push({ x: bb.x + bb.w*rng(), y: 0.95 - (bb.h + 0.18), depth: 12 + rng()*4, type: "roof" });
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
  makeTree(rng) {
    const segs = [];
    const grow = (x, y, ang, len, depth) => {
      const nx = x + Math.cos(ang) * len;
      const ny = y + Math.sin(ang) * len;
      segs.push({ x1: x, y1: y, x2: nx, y2: ny, w: depth });
      if (depth <= 0) return;
      const n = rng() < 0.7 ? 2 : 3;
      for (let i = 0; i < n; i++) grow(nx, ny, ang + (rng() - 0.5) * 1.1, len * (0.62 + rng()*0.16), depth - 1);
    };
    grow(0, 0, -Math.PI/2 + (rng()-0.5)*0.2, 0.13, 4);
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
        a.alpha = 0;
        a.enterFromX = a.restX + (a.flip ? -1 : 1)*0.012;
        a.enterFromY = a.restY + 0.035;
      } else if (a.beh === "cuckoo") {
        // In along the skyline on quick shallow beats, to the treetop.
        a.alpha = 0;
        a.enterFromX = a.restX + (a.flip ? 1 : -1)*(0.10 + Math.random()*0.06);
        a.enterFromY = a.restY - 0.01;
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
      } else if (ground) {
        a.alpha = 0;
        const side = a.flip ? 1 : -1;
        a.enterFromX = a.restX + side * (0.06 + Math.random()*0.05);
        a.enterFromY = a.restY;
      } else {
        a.alpha = 0;
        const side = a.flip ? 1 : -1;
        a.enterFromX = a.restX + side * (0.04 + Math.random()*0.04);
        a.enterFromY = a.restY - (0.06 + Math.random()*0.06);
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

    switch (this.loc) {
      case "meadow": this.drawMeadow(c, W, H, dt, bot); break;
      case "forest": this.drawForest(c, W, H, dt, bot); break;
      case "beach": this.drawBeach(c, W, H, dt, top, bot, night); break;
      case "wetland": this.drawWetland(c, W, H, dt, top, bot, night); break;
      case "city": this.drawCity(c, W, H, dt, bot, night); break;
    }

    this.drawActors(c, W, H, bot, night);
    this.drawCritters(c, W, H, bot, night);
    this.drawFlyers(c, W, H, bot);
    this.drawForeground(c, W, H, dt, bot);   // the near edge, over everything living
    this.drawFireflies(c, W, H, night);
    this.drawWeather(c, W, H, night);
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
    const wf = state.weather === "breeze" ? 3 : 1;
    for (const cl of this.clouds) {
      const near = Math.max(0, Math.min(1, (cl.w - 0.16)/0.22));
      cl.x += cl.s * dt * wf * (0.5 + near);
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
        const tw = 0.55 + 0.45*Math.sin(this.t*st.tw + st.ph);
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
    const af = (state.weather === "rain" ? 1.5 : 1) * (1 - night*0.5);
    for (const cl of this.clouds) {
      // Big clouds are near ones: they cross faster and hold their colour,
      // while the small far ones hang almost still and pale away.
      const near = Math.max(0, Math.min(1, (cl.w - 0.16)/0.22));
      const cw = cl.w * W;
      p.glow(rgb, cl.x*W, cl.y*H, cw, cw*0.35, cl.a * af * (0.62 + near*0.5));
    }
  }

  windAmt() {
    return state.weather === "breeze" ? 1 : (state.weather === "rain" ? 0.5 : 0.25);
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
      const sway = Math.sin(this.t*1.8 + gr.ph) * 6 * wa * this.windWave(gr.x) + gr.lean*4;
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
      const flap = 0.5 + 0.5*Math.sin(b.ph);
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
    const waves = [];
    for (let i = 0; i < 3; i++) {
      waves.push({ f: 9 + rng()*18 + i*17, ph: rng()*Math.PI*2, a: (0.62 - i*0.16) });
    }
    const standards = [];
    const ns = 1 + Math.floor(rng()*3);
    for (let i = 0; i < ns; i++) {
      const u = 0.12 + rng()*0.76;
      standards.push({ x: from + (to - from)*u, h: 0.05 + rng()*0.055, r: 0.016 + rng()*0.018 });
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

  drawHedgerow(c, W, H, baseFn, bot) {
    const hg = this.hedge;
    if (!hg) return;
    const body = css(mix(this.tok.inkDeep, bot, 0.15));
    const twig = css(mix(this.tok.inkDeep, bot, 0.24));
    const wind = state.weather === "breeze" ? 1 : 0.35;
    const n = 96;
    // The mass of the hedge: its crown ragged where the wind is working it,
    // its foot following the ground it grows out of.
    c.fillStyle = body;
    c.beginPath();
    for (let i = 0; i <= n; i++) {
      const x = hg.from + (hg.to - hg.from)*(i/n);
      const sway = Math.sin(this.t*1.3 + x*22)*wind*1.4*this.windWave(x);
      const ty = (baseFn(x) - hg.height(x))*H + sway*0.3;
      if (i === 0) c.moveTo(x*W + sway, ty); else c.lineTo(x*W + sway, ty);
    }
    for (let i = n; i >= 0; i--) {
      const x = hg.from + (hg.to - hg.from)*(i/n);
      c.lineTo(x*W, baseFn(x)*H + 5);
    }
    c.closePath(); c.fill();
    // Loose growth standing proud of the cut line — the year's new shoots that
    // give a hedge its bristled top instead of a shaved one.
    c.strokeStyle = twig;
    c.lineWidth = 1;
    c.beginPath();
    for (let i = 0; i < 64; i++) {
      const x = hg.from + (hg.to - hg.from)*((i*0.0673 + hg.seed) % 1);
      const hgt = hg.height(x);
      if (hgt < 0.008) continue;
      const tx = x*W, ty = (baseFn(x) - hgt)*H;
      const lean = Math.sin(i*3.1 + hg.seed*9)*5 + Math.sin(this.t*1.6 + x*18)*wind*2.6;
      const up = 4 + ((i*7) % 5)*2.6;
      c.moveTo(tx, ty + 3);
      c.quadraticCurveTo(tx + lean*0.4, ty - up*0.5, tx + lean, ty - up);
    }
    c.stroke();
    // standards left uncut along the line
    const trunkCol = css(mix(this.tok.inkDeep, bot, 0.12));
    for (const st of hg.standards) {
      this.smallTree(c, st.x, baseFn(st.x) - hg.height(st.x)*0.35, st.h, st.r, W, H, trunkCol);
    }
  }

  /* One beast. Everything is in the proportions: the barrel is deep and not
     very long, the legs are short — a cow standing square is about as deep
     through the body as it is long in the leg — the back runs level from a
     high hip to the withers, and the head hangs off a thick neck no longer
     than the head itself. Get the neck wrong and you have drawn a horse.
     `hd` is 0 for head up, 1 for head down in the grass. */
  cowShape(c, bx, by, s, dir, hd, col, patch, tailSwing) {
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
    const nx = s*(0.72 + hd*0.10), ny = -s*(0.86 - hd*0.62);
    this.limb(c, s*0.46, -s*0.96, nx, ny, s*0.38, s*0.26);
    c.save();
    c.translate(nx, ny);
    c.rotate(hd*1.05);
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
    }
  }

  drawCattle(c, W, H, baseFn, bot) {
    if (!this.cattle || !this.cattle.length) return;
    const col = css(mix(this.tok.ink, bot, 0.30));
    const pale = `rgba(${this.tok.foamRGB}, 0.35)`;
    for (const cw of this.cattle) {
      const s = Math.min(W, H)*0.026*cw.sz;
      this.cowShape(c, cw.x*W, baseFn(cw.x)*H, s, cw.dir, cw.hd, col,
        cw.ph > 2.4 ? pale : null, Math.sin(this.t*1.7 + cw.ph));
      // a calf keeping close in, head up, all legs and no barrel yet
      if (cw.calf) {
        this.cowShape(c, (cw.x*W) - cw.dir*s*1.9, baseFn(cw.x - cw.dir*0.012)*H,
          s*0.58, cw.dir, 0.15, col, null, Math.sin(this.t*2.6 + cw.ph));
      }
    }
  }

  /* ---- depth ----
     Where a ground animal stands, how large it looks, and how much air is
     between it and the pane. z runs 0 at the glass to 1 at the far edge of
     the walkable ground. Things further off sit higher in the frame, are
     smaller, move more slowly across it, and are washed toward the colour
     of the sky — the three cues that do most of the work of distance. */
  groundBand() {
    // The near end sits on the lit ground, not down in the dark strip at the
    // very bottom of the frame — an animal standing there is a black shape on
    // black. The far end stops short of the ridge it would otherwise climb.
    switch (this.loc) {
      case "meadow":  return [0.930, 0.872];
      case "forest":  return [0.945, 0.898];
      case "beach":   return [(this.shoreY || 0.82) + 0.125, (this.shoreY || 0.82) + 0.03];
      case "wetland": return [(this.bankY || 0.86) + 0.035, (this.bankY || 0.86) - 0.008];
      default:        return [0.978, 0.952];
    }
  }
  groundDepth(z, bot) {
    const [near, far] = this.groundBand();
    const zz = Math.max(0, Math.min(1, z === undefined ? 0.5 : z));
    return {
      y: near + (far - near)*zz,
      scale: 1.22 - zz*0.62,
      speed: 1 - zz*0.55,
      // A light touch only: these animals stand on dark ground but against
      // a pale far hill, so contrast runs both ways and a strong ramp would
      // lose them at one end or the other.
      col: css(mix(this.tok.inkDeep, bot, 0.03 + zz*0.10))
    };
  }

  /* The small dark pool a body casts on the ground beneath it. Nothing
     grounds an animal like the shadow it stands in. */
  contactShadow(c, x, y, w, alpha) {
    if (alpha <= 0.01) return;
    c.save();
    c.globalAlpha = alpha;
    c.fillStyle = css(this.tok.inkDeep);
    c.beginPath(); c.ellipse(x, y, w, Math.max(1, w*0.22), 0, 0, Math.PI*2); c.fill();
    c.restore();
  }

  /* Roughly how bright the day is — for daytime-only touches like motes. */
  dayness() {
    const m = this.timeMix, total = m.dawn + m.day + m.dusk + m.night || 1;
    return (m.day + m.dawn*0.7 + m.dusk*0.45) / total;
  }

  /* A gentle travelling wind, so plants sway in rolling waves, not in unison. */
  windWave(x) {
    return 1 + 0.35*Math.sin(this.t*0.55 - x*5 + (this.gustPh || 0))
             + 0.12*Math.sin(this.t*1.2 - x*11);
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
        const sway = Math.sin(this.t*0.7 + tr.x*5)*3*wa;
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
    const fgSway = (g) => Math.sin(this.t*1.5 + g.ph)*11*wa*this.windWave(g.x) + g.lean*7;

    c.lineWidth = Math.max(2, mn*0.009);
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
      const tw = Math.sin(this.t*g.sp + g.ph);
      if (tw < 0.62) continue;
      const gx = g.x*W, gy = y0 + (y1 - y0)*(0.12 + 0.84*g.yy);
      c.globalAlpha = base*((tw - 0.62)/0.38);
      c.beginPath(); c.moveTo(gx - 3, gy); c.lineTo(gx + 3, gy); c.stroke();
    }
    c.globalAlpha = 1;
  }

  drawMeadow(c, W, H, dt, bot) {
    this.drawSkyBirds(c, W, H, bot, this.nightness());
    this.drawRidge(c, this.hillA, mix(this.tok.ink, bot, 0.45), W, H);
    const farTree = css(mix(this.tok.ink, bot, 0.38));
    for (const t of (this.distantTrees || [])) this.smallTree(c, t.x, t.y, t.h, t.r, W, H, farTree);
    this.drawCattle(c, W, H, this.hillA, bot);
    this.distanceHaze(c, W, H, 0.52, 0.82, 0.075*(1 - this.nightness()*0.55));
    this.drawHedgerow(c, W, H, this.hedgeLine, bot);
    this.drawRidge(c, this.hillB, mix(this.tok.ink, bot, 0.18), W, H);
    const shrubCol = css(mix(this.tok.inkDeep, bot, 0.15));
    for (const bu of (this.shrubs || [])) {
      this.bushShape(c, bu.x, bu.y, bu.r, bu.seed, W, H, shrubCol);
    }
    const baseY = this.hillB(this.treeX) * H;
    c.strokeStyle = css(mix(this.tok.inkDeep, bot, 0.06));
    c.lineCap = "round";
    const treeWind = this.windWave(this.treeX);
    for (const s of this.tree) {
      c.lineWidth = 0.8 + s.w * 1.1;
      const sway = Math.sin(this.t*1.1 + s.y1*8) * (4 - s.w) *
        (state.weather === "breeze" ? 0.85 : 0.22) * treeWind;
      c.beginPath();
      c.moveTo(this.treeX*W + s.x1*W*0.5 + sway*0.4, baseY + s.y1*H*0.9);
      c.lineTo(this.treeX*W + s.x2*W*0.5 + sway, baseY + s.y2*H*0.9);
      c.stroke();
    }
    // the crown, swaying with the branches that carry it
    if (this.treeLeaves) {
      const mnT = Math.min(W, H);
      c.fillStyle = css(mix(this.tok.inkDeep, bot, 0.10));
      for (const lf of this.treeLeaves) {
        const sway = Math.sin(this.t*1.1 + lf.y*8) * 3.6 *
          (state.weather === "breeze" ? 0.85 : 0.22) * treeWind;
        c.beginPath();
        c.arc(this.treeX*W + (lf.x + lf.dx)*W*0.5 + sway,
          baseY + (lf.y + lf.dy)*H*0.9, lf.r*mnT, 0, Math.PI*2);
        c.fill();
      }
    }
    c.fillStyle = css(mix(this.tok.inkDeep, bot, 0.14));
    c.beginPath();
    c.moveTo(0, H); c.lineTo(0, H*0.92);
    c.quadraticCurveTo(W*0.5, H*0.88, W, H*0.93);
    c.lineTo(W, H); c.closePath(); c.fill();
    const groundYn = (x) => 0.92 - (x*0.5 - 0.25)*(x*0.5 - 0.25)*0.1;
    for (const rk of (this.rocks || [])) {
      const rr = rk.r*Math.min(W, H);
      c.fillStyle = css(mix(this.tok.inkDeep, bot, 0.05 + rk.shade*0.07));
      c.beginPath(); c.ellipse(rk.x*W, groundYn(rk.x)*H + 5, rr, rr*0.6, 0, Math.PI, 0); c.fill();
    }
    this.drawFlowers(c, W, H, groundYn, bot);
    this.drawGrassTufts(c, W, H, this.grass, groundYn, css(mix(this.tok.inkDeep, bot, 0.10)));
    this.drawMotes(c, W, H, this.dayness());
  }

  /* Stems first, all of them in one path: they share a colour and a width, and
     the colour is opaque, so gathering them changes nothing but the number of
     times the rasterizer is asked. The heads cannot join them — they are drawn
     at 0.82, and two translucent petals that overlap must darken each other,
     which only happens if each is laid down in its own turn. */
  drawFlowers(c, W, H, baseYfn, bot) {
    if (!this.flowers) return;
    const wa = this.windAmt();
    c.lineWidth = 1;
    c.strokeStyle = css(mix(this.tok.inkDeep, bot, 0.16));   // stems share one colour
    c.beginPath();
    for (const f of this.flowers) {
      const gx = f.x*W, gy = baseYfn(f.x)*H;
      const sway = Math.sin(this.t*1.6 + f.ph)*5*wa*this.windWave(f.x);
      c.moveTo(gx, gy + 3);
      c.quadraticCurveTo(gx + sway*0.4, gy - f.h*H*0.55, gx + sway, gy - f.h*H);
    }
    c.stroke();
    for (const f of this.flowers) {
      const gx = f.x*W, gy = baseYfn(f.x)*H;
      const sway = Math.sin(this.t*1.6 + f.ph)*5*wa*this.windWave(f.x);
      const rgb = f.tone < 0.4 ? this.tok.amberRGB : f.tone < 0.72 ? this.tok.sageRGB : this.tok.cloudRGB;
      c.fillStyle = `rgba(${rgb}, 0.82)`;
      c.beginPath(); c.arc(gx + sway, gy - f.h*H, Math.max(1.3, f.h*H*0.11), 0, Math.PI*2); c.fill();
    }
  }

  drawForest(c, W, H, dt, bot) {
    this.drawRidge(c, this.hillA, mix(this.tok.ink, bot, 0.5), W, H);
    const wa = this.windAmt();
    const mn = Math.min(W, H);
    // One long breath of wind that every crown answers together, over the top
    // of each tree's own smaller motion — a wood moves as one thing.
    const gust = 1 + 0.85*Math.sin(this.t*0.23 + (this.gustPh || 0))
                   + 0.3*Math.sin(this.t*0.61 + 1.7);
    const drawTrunk = (tr, colStr) => {
      const groundY = H * 0.93;
      const topY = H * tr.top;
      const sway = (Math.sin(this.t*1.1 + tr.x*9)*0.55 + gust*1.15)
        * 2.2 * wa * this.windWave(tr.x);
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
    this.drawGrassTufts(c, W, H, this.grass, () => 0.93,
      css(mix(this.tok.inkDeep, bot, 0.12)));
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
    const sway = (f) => Math.sin(this.t*1.4 + f.x*10)*4*wa*this.windWave(f.x) + f.lean*6;
    c.strokeStyle = css(mix(this.tok.inkDeep, bot, 0.13)); c.lineCap = "round";

    c.lineWidth = 1.5;
    c.beginPath();
    for (const f of this.ferns) {
      const gx = f.x*W, gy = 0.93*H, len = f.size*H, sw = sway(f);
      c.moveTo(gx, gy + 3);
      c.quadraticCurveTo(gx + sw*0.5, gy - len*0.5, gx + sw, gy - len);
    }
    c.stroke();

    c.lineWidth = 1;
    c.beginPath();
    for (const f of this.ferns) {
      const gx = f.x*W, gy = 0.93*H, len = f.size*H, sw = sway(f);
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
      const gx = m.x*W, gy = 0.945*H, r = m.size*Math.min(W, H);
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
    for (const l of this.leaves) {
      l.y += l.sp*dt;
      l.x += (l.drift + Math.sin(this.t*1.2 + l.ph)*0.02)*dt;
      l.rot += dt*1.6;
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
    for (const f of this.foam) {
      const ease = f.p * f.p;
      const fy = hy + (sy - hy) * (0.12 + 0.88 * ease);
      const alpha = Math.sin(Math.PI * Math.min(1, f.p*1.1)) * 0.4;
      if (alpha < 0.02) continue;
      c.strokeStyle = `rgba(${this.tok.foamRGB}, ${alpha})`;
      c.lineWidth = 1 + ease*1.5;
      c.beginPath();
      const n = 40;
      for (let i = 0; i <= n; i++) {
        const x = i / n;
        const wig = Math.sin(x*14 + this.t*0.8 + f.p*9) * 2.5 * (0.4+ease);
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
      const r = pb.r*Math.min(W, H);
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
    c.strokeStyle = css(mix(this.tok.inkDeep, bot, 0.12));
    c.lineWidth = 3; c.lineCap = "round";
    for (const p of this.posts) {
      c.beginPath();
      c.moveTo(p.x*W, sy + 2);
      c.lineTo(p.x*W, sy - p.h*H);
      c.stroke();
    }
    this.drawGrassTufts(c, W, H, this.duneGrass, () => this.shoreY + 0.12,
      css(mix(this.tok.inkDeep, bot, 0.18)));
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
      const ease = f.p*f.p;
      reach = Math.max(reach, (0.12 + 0.88*ease) * Math.sin(Math.PI*Math.min(1, f.p*1.1)));
    }
    const target = reach*0.14;
    this.wet += (target - this.wet) * Math.min(1, dt*(target > this.wet ? 3.2 : 0.5));
  }

  updateFishRings(dt) {
    for (let i = this.fishRings.length - 1; i >= 0; i--) {
      const fr = this.fishRings[i];
      fr.age += dt;
      if (fr.age > 1.6) { this.fishRings.splice(i, 1); continue; }
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
      const lx = li.x*W, ly = li.y*H + Math.sin(this.t*0.6 + li.ph)*1.5, r = li.r*Math.min(W, H);
      c.fillStyle = css(mix(this.tok.sea, this.tok.inkDeep, 0.4));
      c.beginPath(); c.ellipse(lx, ly, r, r*0.5, 0, 0, Math.PI*2); c.fill();
      c.strokeStyle = css(mix(this.tok.sea, top, 0.42)); c.lineWidth = 1.4;
      c.beginPath(); c.moveTo(lx, ly); c.lineTo(lx + r, ly); c.stroke();
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
    const reedSway = (r) => Math.sin(this.t*1.3 + r.ph) * 7 * wa * this.windWave(r.x) + r.lean*5;
    // Forty-two stems in one pen: one path, one stroke.
    c.beginPath();
    for (const r of this.reeds) {
      const rx = r.x * W, sway = reedSway(r);
      c.moveTo(rx, by + 3);
      c.quadraticCurveTo(rx + sway*0.35, by - r.h*H*0.55, rx + sway, by - r.h*H);
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
      const cx = r.x*W + sway - 2*sn, cy = by - r.h*H + 2*cs;
      c.moveTo(cx + 2*cs, cy + 2*sn);   // the arc's own start, or it joins the last head
      c.ellipse(cx, cy, 2, 7, th, 0, Math.PI*2);
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
    return dawnish*0.95 + (state.weather === "fog" ? 0.45 : 0);
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
    const groundY = H * 0.95;
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
        for (let r = 0; r < rows; r++) for (let k = 0; k < cols; k++) {
          c.fillRect(bx + mx + k*gapx, byTop + my + r*gapy, Math.min(gapx*0.5, 5), 5);
        }
      }
      c.globalAlpha = 1;
    }
    if (night > 0.12) {
      const fc = this.tok.firefly;
      for (const b of this.frontBlocks) {
        const bx = b.x*W, bw = b.w*W, bh = b.h*H, byTop = groundY - bh;
        for (const wnd of b.lit) {
          // somebody comes home, somebody goes to bed — see updateCityWindows
          const lvl = (wnd.on ? wnd.fade : 1 - wnd.fade);
          if (lvl < 0.02) continue;
          const flick = wnd.flicker ? 0.75 + 0.25*Math.sin(this.t*3.1 + wnd.ph) : 1;
          c.fillStyle = `rgba(${fc[0]|0},${fc[1]|0},${fc[2]|0},${0.55 * night * lvl * flick})`;
          c.fillRect(bx + wnd.u*bw, byTop + wnd.v*bh, 2.5, 3.5);
        }
      }
    }
    // steam standing off a rooftop vent, leaning with the wind
    const wv = this.windAmt();
    for (const b of this.frontBlocks) {
      if (!b.vent) continue;
      const bx = b.x*W, bw = b.w*W, byTop = groundY - b.h*H;
      const vx = bx + b.vent.u*bw;
      c.fillStyle = `rgba(${this.tok.cloudRGB}, 1)`;
      for (let k = 0; k < 5; k++) {
        const age = ((this.t*0.16 + b.vent.ph + k*0.2) % 1);
        const rise = age*H*0.13;
        const a = (1 - age)*0.13*(0.5 + wv);
        if (a < 0.01) continue;
        c.globalAlpha = a;
        c.beginPath();
        c.arc(vx + Math.sin(age*3 + b.vent.ph)*8 + age*26*wv,
          byTop - 3 - rise, 3 + age*13, 0, Math.PI*2);
        c.fill();
      }
      c.globalAlpha = 1;
      c.fillStyle = css(mix(this.tok.inkDeep, bot, 0.16));
      c.fillRect(vx - 3, byTop - 5, 6, 5);
    }
    c.fillStyle = css(mix(this.tok.inkDeep, bot, 0.10));
    c.fillRect(0, groundY, W, H - groundY);
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
      c.save(); c.globalAlpha = 0.13; c.fillStyle = `rgba(${this.tok.cloudRGB}, 1)`;
      for (let i = 0; i < 3; i++) {
        const rise = (this.t*9 + b.smoke*10) % 26;
        const sy = byTop - ch - i*9 - rise*0.5;
        const sx = rx + cw*0.5 + Math.sin(this.t*0.8 + b.smoke + i)*4;
        c.beginPath(); c.arc(sx, sy, 3 + i*1.6, 0, Math.PI*2); c.fill();
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
          a.alpha = Math.min(1, e * 1.3);
        }
      } else if (a.enter > 0 && !a.leave && (a.alpha < 1 || a.flightIn)) {
        a.x = a.restX; a.y = a.restY; a.alpha = 1;
      }

      const st = a.t - a.singAt;                       // time since the call began
      const singing = st >= 0 && st < a.dur;
      const sing = singing ? 0.3 + 0.7*Math.abs(Math.sin(st*11)) : 0;
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
      const sing = (st >= 0 && st < a.dur) ? 0.3 + 0.7*Math.abs(Math.sin(st*11)) : 0;
      const sungEnd = a.singAt + a.dur;
      const col = mix(this.tok.inkDeep, bot, a.depthMix);
      const colStr = css([col[0], col[1], col[2], 1]);
      const rimStr = css(mix(col, bot, 0.6));            // a touch lighter, for rim/eye
      const deepStr = css(mix(this.tok.inkDeep, bot, Math.max(0.02, a.depthMix - 0.10)));
      const x = a.x*W, y = a.y*H;

      // Idle life: breathing, the odd glance and tail-flick, a wing-settle on arrival.
      const iv = a.ivar || {};
      const settled = a.enter > 0 ? Math.max(0, a.t - a.enter) : a.t;
      const breath = Math.sin(a.t*2.0 + (iv.breathPh || 0));
      const headTurn = Math.sin(a.t*0.8 + (iv.headPh || 0)) * 0.20
                     + Math.pow(Math.max(0, Math.sin(a.t*0.5 + (iv.headPh || 0)*1.7)), 6) * 0.5;
      const tailFlick = Math.pow(Math.max(0, Math.sin(a.t*1.15 + (iv.tailPh || 0))), 8);
      const wingSettle = Math.max(0, 1 - settled/0.55);
      const hopBob = (a.enter > 0 && a.t < a.enter && a.beh === "perch")
        ? Math.abs(Math.sin(a.t*13)) * a.s * 0.12 : 0;
      // Departure: 0 while perched, ramping to 1 once the bird springs into flight.
      const flyProg = a.leave === "fly" ? Math.max(0, Math.min(1, (a.leaveT - 0.16)/0.14)) : 0;
      const flyFlap = flyProg > 0 ? Math.sin(a.leaveT*21) : 0;
      // Arrival: wings out and beating all the way in, then held high and
      // forward for the flare that kills the last of the speed.
      const inK = (a.flightIn && a.enter > 0 && a.t < a.enter) ? a.t/a.enter : -1;
      const flare = inK >= 0 ? Math.pow(Math.max(0, inK - 0.7)/0.3, 1.4) : 0;
      const flyIn = inK >= 0 ? Math.max(0, 1 - Math.pow(Math.max(0, inK - 0.86)/0.14, 2)) : 0;
      const flapIn = inK >= 0 ? (flare > 0.15 ? 0.55 + flare*0.45 : Math.sin(a.t*23)) : 0;
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
      // its feet down and swings its legs instead.
      const hopStep = (a.ground && !a.walks && a.act === "step")
        ? Math.max(0, Math.sin(a.hopPh || 0)) : 0;
      const stride = (a.ground && a.walks && a.act === "step") ? a.stridePh : 0;

      switch (a.beh) {
        case "perch": {
          const ps = PSTYLE[a.id] || {};
          this.drawPerchFooting(c, (a.ground ? a.x : a.restX)*W, a.restY*H, a.s,
            a.perchType, bot, a.alpha * landed * (1 - flyProg));
          const hopG = a.gest === "hop" ? Math.abs(Math.sin(Math.PI*(a.gestT/a.gestDur)))*a.s*0.22 : 0;
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
            plump: (ps.plump || 1) * (iv.puff || 1) * (1 + fluffG*0.24),
            tailLen: (ps.tail || 1.1) * (iv.tail || 1), tailUp: !!ps.tailUp,
            billLen: ps.bill || 0.45,
            crest: ps.crest || (iv.crest && !ps.tailUp && !ps.cap), rimLight: iv.rim,
            gest: (a.gest === "preen" || a.gest === "stretch") ? a.gest : null,
            gestK: a.gest ? a.gestT/a.gestDur : 0,
            peck: a.peck || 0, legTuck: hopStep, stride,
            sing, breath, headTurn: headTurn + peerG*0.85, tailFlick, wingSettle,
            fly: diveRot ? 1 : Math.max(flyProg, flyIn),
            flap: diveRot ? -0.4 : (flyIn > 0 ? flapIn : flyFlap),
            flare, t: a.t
          });
          if (rot) c.restore();
          break;
        }
        case "egret": {
          const off = a.leave === "heronoff" ? a.leaveT : 0;
          this.paintHeron(c, { x, y, s: a.s*2.3, dir: a.flip ? -1 : 1,
            flying: off > 0.5, flap: off > 0.5 ? Math.sin((off - 0.5)*7) : 0,
            crouch: off > 0 ? Math.min(1, off/0.5) : 0,
            color: colStr, pale: true, t: a.t, sing, alpha: a.alpha });
          break;
        }
        case "pheasant": {
          const flushT = a.leave === "flush" ? a.leaveT : 0;
          this.paintPheasant(c, { x, y, s: a.s*1.5, flip: a.flip,
            alpha: a.alpha, color: colStr, rim: rimStr, deep: deepStr, sing,
            walking: (a.t > sungEnd && !a.leave) || a.leave === "walkoff",
            lp: a.t*(a.leave === "walkoff" ? 9 : 5),
            fly: flushT ? Math.min(1, Math.max(0, (flushT - 0.16)/0.12)) : 0,
            flap: flushT ? Math.sin(flushT*30) : 0, t: a.t });
          break;
        }
        case "owl": {
          const gl = a.leave === "glide" ? Math.min(1, a.leaveT/0.35) : 0;
          this.paintOwl(c, { x, y, s: a.s, alpha: a.alpha, color: colStr, rim: rimStr,
            deep: deepStr, night, t: a.t, headTurn, blinkPh: iv.tailPh || 0,
            breath, fly: gl, flap: gl ? Math.sin(a.leaveT*8.5) : 0,
            flip: a.flyDir < 0, settle: wingSettle, sing });
          break;
        }
        case "cuckoo": this.paintCuckoo(c, { x, y, s: a.s, flip: a.flip, alpha: a.alpha,
          color: colStr, rim: rimStr, deep: deepStr, sing, breath, t: a.t,
          fly: flyProg, flap: flyFlap }); break;
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
        case "duck": this.paintDuck(c, { x, y: y + Math.sin(a.t*1.3)*1.5, s: a.s,
          flip: a.data.dir < 0, alpha: a.alpha, color: colStr, rim: rimStr, deep: deepStr,
          moorhen: a.data.moorhen, sing, breath, t: a.t }); break;
        case "pecker": this.paintWoodpecker(c, { x, y, s: a.s, alpha: a.alpha, color: colStr,
          rim: rimStr, deep: deepStr, sing, t: a.t }); break;
        case "wader": this.paintWader(c, { x, y, s: a.s, flip: a.data.dir < 0,
          alpha: a.alpha, color: colStr, rim: rimStr, deep: deepStr, sing,
          walking: a.t > sungEnd, t: a.t }); break;
        case "frog": this.paintFrog(c, { x, y, s: a.s, alpha: a.alpha, color: col, bot, sing, breath, t: a.t }); break;
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
    if (!a.ground || a.leave) { a.peck = 0; return; }
    if (singing || a.t < a.enter + 0.5) { a.peck = 0; a.act = null; return; }
    if (a.hopPh === undefined) { a.hopPh = 0; a.stridePh = 0; a.peck = 0; }
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
      if (Math.abs(dx) > 0.004) {
        const step = (a.walks ? 0.035 : 0.05) * dt;
        a.x += Math.sign(dx) * Math.min(Math.abs(dx), step);
        if (a.walks) a.stridePh += dt*9; else a.hopPh += dt*11;
      }
      a.peck = 0;
    } else if (a.act === "peck" && a.actT < a.pecks*0.42) {
      const u = (a.actT / 0.42) % 1;                // down fast, up a shade slower
      a.peck = Math.pow(Math.sin(Math.PI*u), 0.6);
    } else {
      a.peck = 0;
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
    if (peck > 0.002) c.rotate(-peck*0.42);
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
    const hx = s*0.58 + ht*s*0.10 - preen*hr*1.1 + peck*s*0.26;
    const hy = cy - bry*0.55 - hr*0.85 - sing*s*0.16 + preen*hr*0.6
             + peck*(bry*0.85 + legLen*0.55);

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
    if (tuck < 0.95) {
      const hipY = cy + bry*0.62;
      let li = 0;
      for (const [hpx, fx0] of [[-s*0.02, -s*0.12], [s*0.14, s*0.18]]) {
        const swing = stride ? Math.sin(stride + li*Math.PI)*s*0.22 : 0;
        const step = stride ? Math.max(0, Math.sin(stride + li*Math.PI + 0.8))*s*0.16 : 0;
        li++;
        const fx = fx0 + swing + flare*s*0.5;
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

    // Wings in flight — the far wing first, behind the body.
    const flap = o.flap || 0;
    const span = s*(1.7 + 0.5*fly);
    const wrx = s*0.05, wry = cy - bry*0.35;
    if (fly > 0.03) {
      c.fillStyle = o.rim;
      this.wingBlade(c, wrx - s*0.06, wry, wrx - span*0.48, wry - span*(0.5*flap) - s*0.30, s*0.5);
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
      this.wingBlade(c, wrx, wry, wrx - span*0.58, wry - span*(0.68*flap) + s*0.12, s*0.62);
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
    const blink = Math.max(0, 1 - Math.abs(((t + (o.blinkPh || 0)) % 5.3) - 4.9)*7);
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
      const k = o.flap || 0;
      c.translate(0, -s*0.7);
      const A = c.globalAlpha;
      c.globalAlpha = A*0.6;
      this.wingBlade(c, -s*0.05, -s*0.04, -s*1.05, -s*0.62*k - s*0.20, s*0.30);
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
      this.wingBlade(c, s*0.05, -s*0.03, s*1.0, -s*0.78*k - s*0.24, s*0.34);
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
    // legs, stepping along the brow of the hill
    c.lineWidth = Math.max(1, s*0.09);
    for (let i = 0; i < 2; i++) {
      const sw = o.walking ? Math.sin((o.lp || 0) + i*Math.PI)*s*0.14 : (i ? s*0.08 : -s*0.06);
      const lift = o.walking ? Math.max(0, Math.sin((o.lp || 0) + i*Math.PI + 0.8))*s*0.10 : 0;
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
    const hx = nx + s*0.06 - stretch*s*0.16;
    const hy = cy - bry*(1.35 + stretch*0.75);
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
    // a moorhen's head jerks with every push of its feet
    const jerk = mh ? Math.max(0, Math.sin(t*5.5))*s*0.09 : 0;
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
    const hx = s*0.58 + dip*s*0.24 + jerk, hy = -s*1.02 - sing*s*0.28 + dip*s*0.66;
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
    // the strike snaps toward the wood and recovers a shade more slowly
    const strike = sing * Math.pow(Math.abs(Math.sin(t*26)), 0.55);
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
    const step = o.walking ? Math.sin(t*8) : 0;
    // walking, the bill goes down to probe the sand now and then
    const probe = o.walking ? Math.pow(Math.max(0, Math.sin(t*1.1 + 0.7)), 10) : 0;
    const legLen = s*1.1;
    const brx = s*0.92, bry = s*0.5;
    const cy = -(legLen + bry*0.5);
    // legs — jointed and stepping, the moving foot lifting clear
    const lift1 = o.walking ? Math.max(0, Math.sin(t*8))*s*0.16 : 0;
    const lift2 = o.walking ? Math.max(0, -Math.sin(t*8))*s*0.16 : 0;
    const bax = -s*0.08 + step*s*0.22, fax = s*0.3 - step*s*0.22;
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
    // neck and head — thrown up to pipe, dropped to probe
    const hx = s*0.6 + probe*s*0.12, hy = cy - bry*1.5 - sing*s*0.26 + probe*s*1.0;
    this.limb(c, s*0.28, cy - bry*0.4, hx, hy, s*0.4, s*0.26);
    c.beginPath(); c.arc(hx, hy, s*0.28, 0, Math.PI*2); c.fill();
    // the oystercatcher's long orange bill, parting to pipe
    const tiltB = probe*1.05;
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
    const blink = Math.max(0, 1 - Math.abs((t % 4.1) - 3.8)*9);
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
    const calmW = state.weather === "clear" || state.weather === "breeze";

    if ((this.loc === "meadow" || this.loc === "forest") && dayish > 0.5 && calmW
        && n("butterfly") < (REDUCED ? 1 : 4) && P(0.11)) {
      this.critters.push({ kind: "butterfly", x: Math.random(), y: 0.55 + Math.random()*0.3,
        t: 0, ph: Math.random()*6, drift: (Math.random()-0.5)*0.02, life: 18 + Math.random()*10 });
    }
    // bumblebees working the flowers through the warm hours
    if ((this.loc === "meadow" || this.loc === "forest") && dayish > 0.55 && calmW
        && n("bee") < (REDUCED ? 1 : 2) && P(0.06)) {
      this.critters.push({ kind: "bee", x: Math.random(), y: 0.78 + Math.random()*0.1,
        t: 0, ph: Math.random()*6, drift: (Math.random()-0.5)*0.03, life: 9 + Math.random()*8,
        sz: 0.8 + Math.random()*0.5 });
    }
    if (this.loc === "wetland" && dayish > 0.5 && state.weather !== "rain"
        && n("dragonfly") < 2 && P(0.05)) {
      this.critters.push({ kind: "dragonfly", x: 0.2 + Math.random()*0.6,
        y: this.waterY - 0.03 - Math.random()*0.1, t: 0, mode: "hover",
        timer: 1 + Math.random(), tx: 0, ty: 0, life: 16 + Math.random()*8 });
    }
    if ((night > 0.35 || duskdawn > 0.6) && state.weather !== "rain" && this.loc !== "beach"
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
        tx: 0.25 + Math.random()*0.5, state: "enter", t: 0, timer: 0,
        head: 0, cycles: 2 + Math.floor(Math.random()*3), lp: 0, bp: 0,
        sz: 0.85 + Math.random()*0.3 });
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
    if (this.loc === "forest" && dayish > 0.4 && calmW && n("squirrel") === 0
        && this.t - this.lastSquirrel > 40 && P(0.03)) {
      this.lastSquirrel = this.t;
      const dir = Math.random() < 0.5 ? 1 : -1;
      this.critters.push({ kind: "squirrel", x: dir > 0 ? -0.05 : 1.05, dir,
        mode: "bound", timer: 0.8 + Math.random()*1.2, t: 0, ph: 0,
        sz: 0.85 + Math.random()*0.35 });
    }
    // a brown hare loping the field edge, drawn up tall when it stops
    if (this.loc === "meadow" && (duskdawn > 0.4 || dayish > 0.55) && n("hare") === 0
        && this.t - this.lastHare > 70 && P(0.016)) {
      this.lastHare = this.t;
      const dir = Math.random() < 0.5 ? 1 : -1;
      this.critters.push({ kind: "hare", x: dir > 0 ? -0.07 : 1.07, dir,
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
        t: 0, lp: 0, sz: 0.9 + Math.random()*0.25 });
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
    }
    if (this.loc === "city" && night > 0.5 && n("cat") === 0
        && this.t - this.lastCat > 70 && P(0.03)
        && this.frontBlocks && this.frontBlocks.length) {
      this.lastCat = this.t;
      const bi = Math.floor(Math.random()*this.frontBlocks.length);
      const dir = Math.random() < 0.5 ? 1 : -1;
      this.critters.push({ kind: "cat", b: bi, u: dir > 0 ? 0 : 1, dir, mode: "walk", timer: 0, t: 0 });
    }
    if (this.loc === "meadow" && (dayish > 0.3 || duskdawn > 0.4) && calmW && n("rabbit") === 0
        && this.t - this.lastRabbit > 30 && P(0.035)) {
      this.lastRabbit = this.t;
      const dir = Math.random() < 0.5 ? 1 : -1;
      this.critters.push({ kind: "rabbit", x: dir > 0 ? -0.05 : 1.05, dir,
        mode: "hop", timer: 0.3 + Math.random()*0.3, t: 0, hopPh: 0, ear: 0,
        sz: 0.85 + Math.random()*0.3 });
    }
    if ((this.loc === "meadow" || this.loc === "forest") && (duskdawn > 0.45 || night > 0.4)
        && n("fox") === 0 && this.t - this.lastFox > 80 && P(0.018)) {
      this.lastFox = this.t;
      const dir = Math.random() < 0.5 ? 1 : -1;
      this.critters.push({ kind: "fox", x: dir > 0 ? -0.08 : 1.08, dir,
        mode: "trot", timer: 1.2 + Math.random()*1.5, t: 0, lp: 0, look: 0,
        sz: 0.85 + Math.random()*0.3 });
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
    // a porpoise arcing through the surf — rare, unhurried
    if (this.loc === "beach" && state.weather !== "rain" && n("porpoise") === 0
        && this.t - this.lastPorpoise > 55 && P(0.02)) {
      this.lastPorpoise = this.t;
      const dir = Math.random() < 0.5 ? 1 : -1;
      this.critters.push({ kind: "porpoise", x: dir > 0 ? -0.05 : 1.05, dir,
        base: (this.horizonY + this.shoreY)/2 + 0.02, t: 0, phase: 0 });
    }
    // the water stirs on its own now and then — an insect, a breath of wind
    if (this.loc === "wetland" && state.weather !== "rain" && Math.random() < 0.14*dt) {
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
    if (night > 0.7 && state.weather === "clear" && !REDUCED
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
  updateCritters(dt) {
    const bot = this.skyColors()[1];
    /* The fox measures its own crouch and reach against its drawn size, so this
       one pass needs the height of the frame. It is the same number draw() is
       handed — resize() sets both — and the same colours, because frame() has
       already settled timeMix before either pass runs. */
    const H = this.H;
    for (let i = this.critters.length - 1; i >= 0; i--) {
      const cr = this.critters[i];
      cr.t += dt;
      // where this individual stands in the depth of the field, decided once
      if (cr.z === undefined) cr.z = Math.random();
      const D = this.groundDepth(cr.z, bot);
      let dead = false;
      switch (cr.kind) {
        case "butterfly": {
          cr.x += (cr.drift + Math.sin(cr.t*0.8 + cr.ph)*0.015)*dt;
          cr.y += (Math.sin(cr.t*1.9 + cr.ph)*0.05 + Math.cos(cr.t*0.6)*0.02)*dt;
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
            if (cr.bounding) { cr.x += cr.dir*0.055*dt*D.speed; cr.bp += dt*7; }
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
            cr.hopPh += dt*7; cr.x += cr.dir*0.05*dt*D.speed;
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
            cr.ph += dt*9; cr.x += cr.dir*0.045*dt*D.speed;
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
          cr.x += (cr.drift + Math.sin(cr.t*1.3 + cr.ph)*0.02)*dt;
          cr.y += Math.sin(cr.t*2.2 + cr.ph)*0.02*dt;
          if (cr.t > cr.life || cr.x < -0.04 || cr.x > 1.04) { dead = true; break; }
          break;
        }
        case "skein": {
          cr.x += cr.vx*dt;
          if (cr.x < -0.25 || cr.x > 1.25) { dead = true; break; }
          break;
        }
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
          const bound = cr.bounding && cr.state === "leave"
            ? Math.max(0, Math.sin(cr.bp)) : 0;
          const dS = H*0.075*(cr.sz || 1)*D.scale;
          this.contactShadow(c, cr.x*W, D.y*H, dS*0.75, 0.2*(1 - cr.z*0.6)*(1 - bound));
          this.paintDeer(c, { x: cr.x*W, y: (D.y - bound*0.035)*H,
            s: dS, dir: cr.dir,
            head: cr.head, walking: walking || bound > 0, lp: cr.lp, color: D.col, t: cr.t,
            grazing: cr.state === "graze", alert: cr.state === "alert", bound });
          break;
        }
        case "runner": {
          const probe = cr.mode === "dash" ? 0 : Math.max(0, Math.sin(cr.t*7));
          c.save(); c.translate(cr.x*W, D.y*H); c.scale(D.scale, D.scale);
          this.contactShadow(c, 0, 1, 5, 0.16*(1 - cr.z*0.6));
          this.paintSanderling(c, 0, 0, cr.dir, cr.mode === "dash", cr.ph, D.col, probe);
          c.restore();
          break;
        }
        case "cat": {
          const b = this.frontBlocks && this.frontBlocks[cr.b];
          this.paintCat(c, { x: cr.x*W, y: (0.95 - b.h)*H, dir: cr.dir,
            sit: cr.mode === "sit" || cr.mode === "stretch", t: cr.t, color: colDark,
            groom: cr.act === "groom" ? 1 : 0,
            stretch: cr.mode === "stretch" ? Math.sin(Math.PI*Math.min(1, cr.actT/1.4)) : 0 });
          break;
        }
        case "rabbit": {
          const hop = cr.mode === "hop" ? Math.max(0, Math.sin(cr.hopPh)) : 0;
          const rS = H*0.032*(cr.sz || 1)*D.scale;
          this.contactShadow(c, cr.x*W, D.y*H, rS*0.8, 0.2*(1 - cr.z*0.6)*(1 - hop));
          this.paintRabbit(c, { x: cr.x*W, y: D.y*H - hop*H*0.035, s: rS,
            dir: cr.dir, hop, sit: cr.mode === "sit", ear: cr.ear || 0, color: D.col,
            t: cr.t, nibble: cr.act === "nibble" ? 1 : 0,
            wash: cr.act === "wash" ? 0.5 + 0.5*Math.sin(cr.actT*9) : 0 });
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
          break;
        }
        case "heron": {
          const nS = H*0.085*(cr.sz || 1)*(cr.mode === "fly" ? 1 : D.scale*0.95);
          if (cr.mode !== "fly") this.contactShadow(c, cr.x*W, cr.y*H, nS*0.4, 0.15*(1 - cr.z*0.6));
          this.paintHeron(c, Object.assign({ x: cr.x*W, y: cr.y*H, s: nS, dir: cr.dir,
            flying: cr.mode === "fly", flap: Math.sin(cr.flap || 0),
            color: cr.mode === "fly" ? colDark : D.col, deep: colFar, t: cr.t }, cr.pose));
          break;
        }
        case "porpoise": {
          const arc = Math.sin(cr.phase);
          const px = cr.x*W, wy = cr.base*H;
          if (arc > 0.02) {
            // pitch follows the arc: nose up on the rise, down on the fall
            this.paintPorpoise(c, { x: px, y: wy, dir: cr.dir, arc,
              pitch: Math.cos(cr.phase)*0.34,
              s: H*0.05, color: colDark, rim: colFar });
          } else {
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
          const hopY = cr.mode === "bound" ? Math.abs(Math.sin(cr.ph))*0.016 : 0;
          const qS = H*0.03*(cr.sz || 1)*D.scale;
          this.contactShadow(c, cr.x*W, D.y*H, qS*0.7, 0.17*(1 - cr.z*0.6)*(1 - hopY*40));
          this.paintSquirrel(c, { x: cr.x*W, y: (D.y - hopY)*H, s: qS,
            dir: cr.dir, sit: cr.mode === "sit", ph: cr.ph, t: cr.t,
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
          const st = cr.mode === "lope" ? 0.5 + 0.5*Math.sin(cr.ph) : 0;
          const lift = cr.mode === "lope" ? Math.max(0, Math.sin(cr.ph))*0.02 : 0;
          const hS = H*0.042*(cr.sz || 1)*D.scale;
          this.contactShadow(c, cr.x*W, D.y*H, hS*0.85, 0.19*(1 - cr.z*0.6)*(1 - lift*40));
          this.paintHare(c, { x: cr.x*W, y: (D.y - lift)*H, s: hS,
            dir: cr.dir, hop: st, alert: cr.mode === "alert",
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
            dig: cr.mode === "dig" ? 0.5 + 0.5*Math.sin(cr.actT*11) : 0 });
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
            this.paintGoose(c, bx, by2, gdir, Math.sin(cr.t*7 + k));
          }
          break;
        }
      }
    }
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

  paintDeer(c, o) {
    const s = o.s, t = o.t || 0;
    c.save();
    c.translate(o.x, o.y);
    if (o.dir < 0) c.scale(-1, 1);
    c.fillStyle = o.color;
    const by = -s*0.78;                       // body centre
    // legs — jointed and stepping: knees forward on the fore pair, hocks
    // back on the hind, each foot lifting clear of the ground mid-stride
    const hips = [[-0.52, 0.09], [-0.32, 0.09], [0.30, -0.08], [0.50, -0.08]];
    const phs = [0, Math.PI, Math.PI*1.5, Math.PI*0.5];
    for (let i = 0; i < 4; i++) {
      const lx = hips[i][0]*s;
      const sw = o.walking ? Math.sin(o.lp + phs[i])*0.17*s : 0;
      const lift = o.walking ? Math.max(0, Math.sin(o.lp + phs[i] + 0.9))*0.10*s : 0;
      this.leg(c, lx, by + s*0.16, lx + sw, -lift, hips[i][1], s*0.15, s*0.05);
    }
    // body — chest, a soft back line, round haunch, the belly tucked up
    c.beginPath();
    c.moveTo(s*0.62, by - s*0.30);
    c.quadraticCurveTo(s*0.05, by - s*0.42, -s*0.45, by - s*0.32);
    c.quadraticCurveTo(-s*0.85, by - s*0.25, -s*0.88, by + s*0.10);
    c.quadraticCurveTo(-s*0.82, by + s*0.35, -s*0.45, by + s*0.38);
    c.quadraticCurveTo(0, by + s*0.42, s*0.5, by + s*0.32);
    c.quadraticCurveTo(s*0.78, by + s*0.2, s*0.62, by - s*0.30);
    c.closePath(); c.fill();
    // the short tail, flicking now and then
    const tf = Math.pow(Math.max(0, Math.sin(t*0.9 + 2)), 16);
    c.save();
    c.translate(-s*0.84, by - s*0.12); c.rotate(-0.5 - tf*0.7);
    c.beginPath(); c.ellipse(-s*0.1, 0, s*0.14, s*0.06, 0, 0, Math.PI*2); c.fill();
    c.restore();
    // neck and head, lowering to graze; a nibble once it's down. Standing
    // alert the head comes up higher still; in a bound it reaches forward.
    const nib = o.grazing ? Math.sin(t*7)*0.025*s : 0;
    const hx = s*0.95 + (o.bound || 0)*s*0.12;
    const hy = -s*1.46 + o.head*s*1.34 + nib - (o.alert ? s*0.1 : 0);
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
      c.beginPath(); c.ellipse(2.2, -0.4, 1.5, 0.8, 0, 0, Math.PI*2); c.fill();
      // head — the slow look-around, or bent right down to wash a shoulder
      const gr = o.groom ? (0.5 + 0.5*Math.sin(o.t*5)) : 0;
      const lk = gr ? -1.6*gr : Math.sin(o.t*0.7)*0.8;
      const hyC = -9.4 + gr*4.6;
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
      // legs — tapered, lifting on little paws
      for (let i = 0; i < 4; i++) {
        const lx = -3.6 + i*2.5;
        const ph2 = o.t*8 + (i % 2)*Math.PI + Math.floor(i/2)*Math.PI*0.5;
        const sw2 = Math.sin(ph2)*1.0;
        const lift = Math.max(0, Math.sin(ph2 + 0.8))*0.7;
        this.limb(c, lx, -2, lx + sw2, -lift, 1.6, 0.8);
        c.beginPath(); c.ellipse(lx + sw2 + 0.3, -lift, 0.7, 0.4, 0, 0, Math.PI*2); c.fill();
      }
      // long low body, shoulder and haunch, breathing with the walk
      const bob = Math.sin(o.t*8)*0.25;
      c.beginPath(); c.ellipse(0, -3.5 + bob, 6, 2.6, 0, 0, Math.PI*2); c.fill();
      c.beginPath(); c.arc(4.7, -4 + bob, 2.4, 0, Math.PI*2); c.fill();
      c.beginPath(); c.arc(-4.4, -4 + bob, 2.2, 0, Math.PI*2); c.fill();
      // head nodding with the walk, muzzle forward
      const hb = Math.sin(o.t*8 + 0.9)*0.35;
      c.beginPath(); c.arc(6.5, -5.4 + hb, 2.3, 0, Math.PI*2); c.fill();
      c.beginPath();
      c.moveTo(4.9, -7 + hb); c.lineTo(4.5, -9 + hb); c.lineTo(6.3, -7.4 + hb);
      c.moveTo(7.3, -7.1 + hb); c.lineTo(8.2, -8.9 + hb); c.lineTo(8.1, -6.9 + hb);
      c.closePath(); c.fill();
      c.beginPath(); c.ellipse(8.1, -4.9 + hb, 1.0, 0.7, 0.2, 0, Math.PI*2); c.fill();
    }
    c.restore();
  }

  paintRabbit(c, o) {
    const s = o.s;
    c.save();
    c.translate(o.x, o.y);
    if (o.dir < 0) c.scale(-1, 1);
    c.fillStyle = o.color; c.strokeStyle = o.color;
    c.lineCap = "round";
    const st = o.hop || 0;                 // 0 bunched on the ground, 1 stretched mid-leap
    // cotton tail
    c.beginPath(); c.arc(-s*(0.72 + st*0.2), -s*0.45, s*0.2, 0, Math.PI*2); c.fill();
    // hind legs — folded haunch at rest, driving out behind mid-leap
    this.limb(c, -s*0.45, -s*0.4, -s*0.45 - st*s*0.5, -s*0.06 - st*s*0.15, s*0.42, s*0.12);
    c.lineWidth = Math.max(1, s*0.1);
    c.beginPath();
    c.moveTo(-s*0.45 - st*s*0.5, -s*0.06 - st*s*0.15);
    c.lineTo(-s*0.2 - st*s*0.7, -st*s*0.02);
    c.stroke();
    // body — bunched at rest, stretched long in the air
    c.beginPath();
    c.ellipse(-st*s*0.08, -s*0.5, s*(0.8 + st*0.25), s*(0.56 - st*0.12), -st*0.15, 0, Math.PI*2);
    c.fill();
    // head and muzzle — down in the grass when it is cropping
    const nib = o.nibble ? 1 : 0;
    const bob = nib ? Math.sin((o.t || 0)*9)*s*0.03 : 0;
    const hx = s*(0.66 + st*0.18), hy = -s*(0.95 + st*0.05) - st*s*0.08 + nib*s*0.62 + bob;
    c.beginPath(); c.arc(hx, hy, s*0.33, 0, Math.PI*2); c.fill();
    c.beginPath(); c.ellipse(hx + s*0.26, hy + s*0.06, s*0.13, s*0.10, 0.2, 0, Math.PI*2); c.fill();
    // long ears — laid back mid-leap, up and swivelling at rest
    const ea = o.ear || 0;
    const back = st*0.9 - ea*0.35;
    this.limb(c, hx - s*0.05, hy - s*0.14, hx - s*0.2 - back*s*0.5, hy - s*0.9 + back*s*0.35, s*0.16, s*0.08);
    this.limb(c, hx + s*0.13, hy - s*0.12, hx + s*0.1 - back*s*0.55, hy - s*0.95 + back*s*0.4, s*0.16, s*0.08);
    // forelegs — reaching for the landing, tucked neatly under, or brought
    // up to the face to wash it
    if (st > 0.05) {
      this.limb(c, s*0.5, -s*0.55, s*(0.75 + st*0.2), -s*0.12, s*0.14, s*0.06);
    } else if (o.wash) {
      const wv = o.wash;
      this.limb(c, s*0.42, -s*0.5, hx + s*0.16, hy + s*0.16 + wv*s*0.1, s*0.13, s*0.07);
      this.limb(c, s*0.5, -s*0.5, hx + s*0.26, hy + s*0.1 - wv*s*0.12, s*0.12, s*0.07);
    } else {
      this.limb(c, s*0.42, -s*0.3, s*0.5, -s*0.02, s*0.14, s*0.07);
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
    const bounce = o.walking ? Math.abs(Math.sin(o.lp))*s*0.05 : 0;
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
      const phs = [0, Math.PI, Math.PI, 0];
      for (let i = 0; i < 4; i++) {
        const lx = off[i]*s;
        const sw = o.walking ? Math.sin(o.lp + phs[i])*0.2*s : 0;
        // crouched, the hind legs fold up under the animal and the fore stay planted
        const fold = i < 2 ? crouch*s*0.16 : 0;
        const lift = o.walking ? Math.max(0, Math.sin(o.lp + phs[i] + 0.7))*0.12*s : 0;
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
    const hx = s*0.82 + lk*s*0.05 + reach + sniff*s*0.08;
    const hy = -s*0.72 - lk*s*0.10 - bounce - drop*0.8 + sniff*s*0.5;
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
    if (lift + cock < 0.02) {
      c.moveTo(s*0.14, 0); c.lineTo(s*0.30, s*0.01);
      c.moveTo(s*0.14, 0); c.lineTo(s*0.02, s*0.01);
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
    // The dorsal fin: low, broad-based, its trailing edge nearly straight —
    // the field mark that separates a porpoise from anything else inshore.
    c.beginPath();
    c.moveTo(-s*0.34, -s*0.10);
    c.quadraticCurveTo(-s*0.30, -s*0.46, -s*0.06, -s*0.52);
    c.quadraticCurveTo(-s*0.06, -s*0.30, s*0.04, -s*0.14);
    c.closePath(); c.fill();
    // A wet sheen along the crest of the back.
    c.strokeStyle = o.rim || `rgba(${this.tok.foamRGB}, 0.35)`;
    c.globalAlpha = 0.4*a;
    c.lineWidth = Math.max(1, s*0.05);
    c.beginPath();
    c.moveTo(-s*0.62, s*0.02);
    c.quadraticCurveTo(-s*0.05, -s*0.20, s*0.62, -s*0.02);
    c.stroke();
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
    c.restore();
  }

  /* A butterfly — fore- and hindwing lobes foreshortening as they beat,
     a slender body and curled antennae. */
  paintButterfly(c, x, y, t, ph, al, colDark) {
    const f = Math.abs(Math.sin(t*15 + ph));
    const wsp = 0.25 + 0.75*f;
    c.save();
    c.translate(x, y);
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

  /* A bat — scalloped membrane wings on splayed fingers, round ears up. */
  paintBat(c, x, y, s, t, colDark) {
    const flap = Math.sin(t*24);
    c.save();
    c.translate(x, y);
    c.fillStyle = colDark;
    for (const sd of [-1, 1]) {
      const wr = flap*s*0.7;
      c.beginPath();
      c.moveTo(sd*s*0.08, -s*0.06);
      c.quadraticCurveTo(sd*s*0.5, -s*0.55 - wr, sd*s*1.05, -s*0.35 - wr*1.3);
      c.quadraticCurveTo(sd*s*0.7, -s*0.05 - wr*0.5, sd*s*0.5, s*0.02 - wr*0.3);
      c.quadraticCurveTo(sd*s*0.3, s*0.1, sd*s*0.06, s*0.12);
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
    // legs — stout, stepping
    for (const [lx0, ph2] of [[-s*0.16, 0], [s*0.14, Math.PI]]) {
      const sw = o.walking ? Math.sin((o.lp || 0) + ph2)*s*0.14 : 0;
      const lift = o.walking ? Math.max(0, Math.sin((o.lp || 0) + ph2 + 0.8))*s*0.07 : 0;
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
    // neck and small head, thrown up for the crow
    const hx = s*0.6, hy = by - s*0.78 - sing*s*0.16;
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
      // scrabble: the two forepaws alternate, fast, close under the chest
      const scr = Math.sin(t*22), scr2 = Math.sin(t*22 + Math.PI);
      const tamp = pat ? Math.abs(Math.sin(t*11)) : 0;
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
      // Rump high, shoulders down: the whole back slopes into the hole.
      c.beginPath();
      c.moveTo(-s*0.62, -s*0.30);
      c.quadraticCurveTo(-s*0.66, -s*0.86*dig - s*0.16, -s*0.16, -s*0.80*dig - s*0.14);
      c.quadraticCurveTo(s*0.24, -s*0.72*dig - s*0.14, s*0.44, -s*0.34*dig - s*0.16);
      c.quadraticCurveTo(s*0.30, -s*0.06, -s*0.10, -s*0.06);
      c.quadraticCurveTo(-s*0.48, -s*0.06, -s*0.62, -s*0.30);
      c.closePath(); c.fill();
      // hind legs braced under the raised rump
      this.limb(c, -s*0.40, -s*0.48*dig - s*0.14, -s*0.48, -s*0.02, s*0.19, s*0.07);
      this.limb(c, -s*0.18, -s*0.46*dig - s*0.12, -s*0.22, -s*0.02, s*0.17, s*0.06);
      // Head down into the hole; on the bury it pushes the nut further in.
      const hx = s*0.56 + bury*s*0.09, hy = -s*0.20 + bury*s*0.12;
      this.limb(c, s*0.18, -s*0.44*dig - s*0.14, hx, hy, s*0.24, s*0.15);
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
      const p1 = pat ? -tamp*s*0.12 : scr*s*0.10;
      const p2 = pat ? -tamp*s*0.12 : scr2*s*0.10;
      this.limb(c, s*0.30, -s*0.34, s*0.52 + p1*0.5, -s*0.02 + p1, s*0.11, s*0.07);
      this.limb(c, s*0.20, -s*0.30, s*0.42 + p2*0.5, -s*0.02 + p2, s*0.10, s*0.06);
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
      // head with ear tufts, bobbing as it nibbles — or right down at the
      // litter, front paws scrabbling something under the leaves
      const dig = o.dig ? 1 : 0;
      const scrabble = dig ? Math.sin(t*14) : 0;
      const nib = Math.sin(t*9)*s*0.03;
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
      // bounding: body stretched, tail flowing in a wave behind
      const wv = Math.sin((o.ph || 0))*s*0.12;
      c.beginPath();
      c.moveTo(-s*0.45, -s*0.3);
      c.quadraticCurveTo(-s*1.0, -s*0.55 + wv, -s*1.45, -s*0.4 + wv*1.6);
      c.quadraticCurveTo(-s*1.6, -s*0.28 + wv*1.6, -s*1.45, -s*0.18 + wv*1.2);
      c.quadraticCurveTo(-s*0.95, -s*0.12 + wv*0.5, -s*0.4, -s*0.12);
      c.closePath(); c.fill();
      c.beginPath(); c.ellipse(0, -s*0.3, s*0.55, s*0.26, -0.12, 0, Math.PI*2); c.fill();
      // tucked legs
      this.limb(c, -s*0.3, -s*0.15, -s*0.45, s*0.02, s*0.16, s*0.06);
      this.limb(c, s*0.3, -s*0.18, s*0.45, s*0.0, s*0.12, s*0.05);
      // head reaching forward
      c.beginPath(); c.arc(s*0.55, -s*0.42, s*0.18, 0, Math.PI*2); c.fill();
      c.beginPath();
      c.moveTo(s*0.44, -s*0.54); c.lineTo(s*0.42, -s*0.7); c.lineTo(s*0.54, -s*0.56);
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
      // ears swept back but still clear of the line of the back
      const bob = Math.sin((o.t || 0)*8)*s*0.03;
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
      const st = o.hop || 0;      // 0 gathered, 1 stretched mid-lope
      // long hind legs driving, forelegs reaching
      this.limb(c, -s*0.5, -s*0.42, -s*0.6 - st*s*0.5, -s*0.05, s*0.34, s*0.09);
      c.strokeStyle = o.color; c.lineWidth = Math.max(1, s*0.09); c.lineCap = "round";
      c.beginPath();
      c.moveTo(-s*0.6 - st*s*0.5, -s*0.05);
      c.lineTo(-s*0.35 - st*s*0.75, st*s*0.0 - s*0.02);
      c.stroke();
      this.limb(c, s*0.42, -s*0.5, s*(0.62 + st*0.25), -s*0.05, s*0.13, s*0.05);
      // long low body
      c.beginPath();
      c.ellipse(-st*s*0.05, -s*0.52, s*(0.85 + st*0.2), s*(0.4 - st*0.06), -st*0.1, 0, Math.PI*2);
      c.fill();
      // head with the great ears laid along the back
      const hx = s*(0.72 + st*0.15), hy = -s*(0.78 + st*0.1);
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
    const bob = Math.sin(t*7)*s*0.02;
    const up = o.sniffUp || 0;         // front lifted, nose reading the air
    if (up > 0.01) { c.translate(0, 0); c.rotate(-up*0.22); }
    // feet, shuffling
    c.lineWidth = Math.max(1, s*0.08);
    c.beginPath();
    c.moveTo(-s*0.35, -s*0.08); c.lineTo(-s*0.35 + Math.sin(t*9)*s*0.08, s*0.02);
    c.moveTo(s*0.25, -s*0.08);  c.lineTo(s*0.25 - Math.sin(t*9)*s*0.08, s*0.02);
    c.stroke();
    // the dome
    c.beginPath();
    c.moveTo(-s*0.78, -s*0.04 + bob);
    c.quadraticCurveTo(-s*0.6, -s*0.72 + bob, 0, -s*0.72 + bob);
    c.quadraticCurveTo(s*0.55, -s*0.7 + bob, s*0.72, -s*0.16 + bob);
    c.quadraticCurveTo(s*0.4, -s*0.02, -s*0.78, -s*0.04 + bob);
    c.closePath(); c.fill();
    // snout, down and questing — or raised, twitching, into the wind
    const sniff = Math.sin(t*5)*s*0.03;
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
    const dig = o.dig || 0;            // head down, forepaws working the ground
    // short legs, trundling
    const off2 = [-0.45, -0.2, 0.25, 0.45];
    for (let i = 0; i < 4; i++) {
      const sw = Math.sin((o.lp || 0) + (i % 2)*Math.PI + Math.floor(i/2)*1.2)*s*0.1;
      const dg = i > 1 ? dig*s*0.12 : 0;
      this.limb(c, off2[i]*s, -s*0.3, off2[i]*s + sw + dg, 0, s*0.16, s*0.08);
    }
    // broad low body
    c.beginPath();
    c.moveTo(s*0.55, -s*0.5);
    c.quadraticCurveTo(0, -s*0.68, -s*0.55, -s*0.52);
    c.quadraticCurveTo(-s*0.85, -s*0.36, -s*0.7, -s*0.16);
    c.quadraticCurveTo(-s*0.1, -s*0.06, s*0.5, -s*0.14);
    c.quadraticCurveTo(s*0.75, -s*0.3, s*0.55, -s*0.5);
    c.closePath(); c.fill();
    // wedge head, held low — lower still, and swinging, when it digs
    const dy = dig*s*0.16;
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
    // head and muzzle above the line
    c.beginPath(); c.ellipse(s*0.55, -s*0.18, s*0.26, s*0.18, -0.1, 0, Math.PI*2); c.fill();
    c.beginPath(); c.ellipse(s*0.82, -s*0.12, s*0.12, s*0.08, 0.1, 0, Math.PI*2); c.fill();
    c.beginPath(); c.arc(s*0.42, -s*0.32, s*0.06, 0, Math.PI*2); c.fill();  // ear
    // the rolling back, rising and falling as it swims
    const hump = 0.5 + 0.5*Math.sin(ph);
    c.beginPath();
    c.moveTo(s*0.25, s*0.02);
    c.quadraticCurveTo(-s*0.15, -s*0.4*hump - s*0.08, -s*0.6, s*0.0);
    c.closePath(); c.fill();
    // tail-tip breaking behind
    const hump2 = 0.5 + 0.5*Math.sin(ph - 1.4);
    if (hump2 > 0.4) {
      c.beginPath();
      c.moveTo(-s*0.85, s*0.03);
      c.quadraticCurveTo(-s*1.05, -s*0.22*hump2, -s*1.3, s*0.02);
      c.closePath(); c.fill();
    }
    // eye
    c.fillStyle = css(mix(this.tok.ink, this.tok.moon, 0.5));
    c.beginPath(); c.arc(s*0.6, -s*0.24, Math.max(0.6, s*0.045), 0, Math.PI*2); c.fill();
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
    const k = Math.sin(ph)*0.85;
    c.save();
    c.translate(x, y);
    if (dir < 0) c.scale(-1, 1);
    c.fillStyle = col;
    const A = c.globalAlpha;
    c.globalAlpha = A*0.6;
    this.wingBlade(c, -s*0.08, -s*0.06, -s*0.9, -s*0.85*k - s*0.35, s*0.24);
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
    this.wingBlade(c, s*0.04, -s*0.04, -s*0.55, -s*1.05*k - s*0.42, s*0.3);
    c.restore();
  }

  /* A kestrel holding its cross in the wind — tail fanned hard down,
     wings winnowing; when it slips away it goes on flat wings. */
  paintKestrelFlight(c, x, y, s, ph, col, hovering, dir) {
    const k = hovering ? Math.sin(ph)*0.32 : 0.12;
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
    this.wingBlade(c, -s*0.05, -s*0.08, -s*0.8, -s*0.7*k - s*0.4, s*0.34);
    c.globalAlpha = A;
    // body head-down into the wind
    c.beginPath(); c.ellipse(0, 0, s*0.52, s*0.2, 0.08, 0, Math.PI*2); c.fill();
    c.beginPath(); c.arc(s*0.5, s*0.02, s*0.17, 0, Math.PI*2); c.fill();
    c.beginPath();
    c.moveTo(s*0.62, 0); c.lineTo(s*0.78, s*0.08); c.lineTo(s*0.58, s*0.1);
    c.closePath(); c.fill();
    this.wingBlade(c, s*0.02, -s*0.06, -s*0.5, -s*0.9*k - s*0.5, s*0.4);
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
    const k = Math.sin(ph)*glide;
    c.save();
    c.translate(x, y);
    if (dir < 0) c.scale(-1, 1);
    c.fillStyle = col;
    const A = c.globalAlpha;
    const wing = (rootX, rootY, sc) => {
      const wrX = rootX + s*0.12*sc, wrY = rootY - s*0.55*sc - s*0.62*k*sc;
      this.wingBlade(c, rootX, rootY, wrX, wrY, s*0.34*sc);
      this.wingBlade(c, wrX, wrY, wrX - s*0.95*sc, wrY - s*0.28*k*sc + s*0.1*sc, s*0.26*sc);
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
    const k = Math.sin(ph)*0.5 + 0.2;
    c.save();
    c.translate(x, y);
    if (dir < 0) c.scale(-1, 1);
    c.fillStyle = col;
    const A = c.globalAlpha;
    c.globalAlpha = A*0.6;
    this.wingBlade(c, 0, -s*0.04, -s*1.05, -s*0.5*k - s*0.55, s*0.22);
    c.globalAlpha = A;
    c.beginPath(); c.ellipse(s*0.05, 0, s*0.5, s*0.14, 0, 0, Math.PI*2); c.fill();
    c.beginPath();
    c.moveTo(-s*0.35, -s*0.02); c.lineTo(-s*0.8, -s*0.12); c.lineTo(-s*0.45, s*0.02);
    c.lineTo(-s*0.75, s*0.14); c.lineTo(-s*0.35, s*0.04);
    c.closePath(); c.fill();
    c.beginPath(); c.arc(s*0.5, -s*0.03, s*0.14, 0, Math.PI*2); c.fill();
    this.wingBlade(c, s*0.1, -s*0.02, -s*0.85, -s*0.72*k - s*0.62, s*0.26);
    c.restore();
  }

  /* The skylark's song-flight — fluttering almost in place, wings a blur of
     ghosted beats, tail spread beneath. */
  paintLarkFlight(c, x, y, s, ph, col, hovering) {
    const k = Math.sin(ph);
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
    const k = Math.sin(ph);
    c.save();
    c.translate(x, y);
    if (dir < 0) c.scale(-1, 1);
    c.fillStyle = col;
    const A = c.globalAlpha;
    c.globalAlpha = A*0.65;
    this.wingBlade(c, -s*0.05, -s*0.1, -s*0.75, -s*0.8*k - s*0.35, s*0.4);
    c.globalAlpha = A;
    c.beginPath(); c.ellipse(0, 0, s*0.55, s*0.26, 0, 0, Math.PI*2); c.fill();
    c.beginPath();
    c.moveTo(-s*0.4, -s*0.04); c.lineTo(-s*0.85, s*0.02); c.lineTo(-s*0.4, s*0.12);
    c.closePath(); c.fill();
    c.beginPath(); c.arc(s*0.52, -s*0.08, s*0.2, 0, Math.PI*2); c.fill();
    this.wingBlade(c, s*0.05, -s*0.08, -s*0.45, -s*0.95*k - s*0.4, s*0.45);
    c.restore();
  }

  /* Fireflies hold still in the daylight and in the rain, which is the same
     test that decides whether any of them are drawn. */
  updateFireflies(dt, night) {
    const ffA = night * (state.weather === "rain" ? 0.15 : 1);
    if (ffA < 0.05 || !this.fireflies.length) return;
    for (const ff of this.fireflies) {
      ff.x += (ff.dx + Math.sin(this.t*0.3 + ff.ph)*0.006) * dt;
      if (ff.x < 0) ff.x = 1; if (ff.x > 1) ff.x = 0;
    }
  }

  drawFireflies(c, W, H, night) {
    const ffA = night * (state.weather === "rain" ? 0.15 : 1);
    if (ffA < 0.05 || !this.fireflies.length) return;
    const rgb = this.tok.fireflyRGB;
    for (const ff of this.fireflies) {
      const blink = Math.max(0, Math.sin(this.t*ff.sp*2 + ff.ph));
      const a = blink*blink * 0.8 * ffA;
      if (a < 0.03) continue;
      const fx = ff.x*W, fy = ff.y*H + Math.sin(this.t*0.7+ff.ph)*5;
      this.drawGlow(c, rgb, fx, fy, 7, 7, a);
    }
  }

  /* Only the weather that is actually falling moves: rain drops and blown seeds
     each advance under their own test for the weather, exactly as before. */
  updateWeather(dt) {
    if (state.weather === "rain") {
      for (const d of this.rain) {
        d.y += d.sp * dt * 1.6;
        d.x += dt * 0.02;
        if (d.y > 1) { d.y = -0.05; d.x = Math.random(); }
      }
    }
    if (state.weather === "breeze") {
      for (const s of this.seeds) {
        s.x += s.sp * dt * 2;
        s.ph += dt;
        if (s.x > 1.05) { s.x = -0.05; s.y = 0.3 + Math.random()*0.5; }
      }
    }
    if (state.weather === "fog") {
      for (const f of this.fog) f.x += f.sp * dt;
    }
  }

  drawWeather(c, W, H, night) {
    if (state.weather === "rain") {
      c.strokeStyle = `rgba(${this.tok.rainRGB}, 0.35)`;
      c.lineWidth = 1;
      c.beginPath();
      for (const d of this.rain) {
        const rx = d.x*W, ry = d.y*H;
        c.moveTo(rx, ry);
        c.lineTo(rx - W*0.004, ry + d.len*H);
      }
      c.stroke();
    }
    if (state.weather === "breeze") {
      c.fillStyle = `rgba(${this.tok.cloudRGB}, 0.5)`;
      for (const s of this.seeds) {
        const sx = s.x*W, sy = s.y*H + Math.sin(s.ph*1.3)*10;
        c.beginPath(); c.arc(sx, sy, 1.3, 0, Math.PI*2); c.fill();
      }
    }
    if (state.weather === "fog") {
      // The three fog bands used to build a fresh gradient every frame, which
      // is pure allocation churn for something that barely changes. Cache them
      // against the height and a coarse step of the light instead.
      const step = Math.round(night*8);
      const key = (H|0) + "|" + step;
      if (key !== this._fogKey) {
        this._fogKey = key;
        this._fogGrads = this.fog.map(f => {
          const g = c.createLinearGradient(0, f.y*H - f.h*H, 0, f.y*H + f.h*H);
          g.addColorStop(0, `rgba(${this.tok.fogRGB}, 0)`);
          g.addColorStop(0.5, `rgba(${this.tok.fogRGB}, ${0.28 * (1 - (step/8)*0.4)})`);
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
