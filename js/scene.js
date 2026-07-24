/* ============================================================
   The scene — five etched landscapes behind one pane of glass,
   now inhabited: singers appear where they sing, and the land
   has its own quiet traffic of butterflies, bats, deer and cats.
   ============================================================ */
import {
  mulberry32, parseColor, css, mix, themeVar, REDUCED, LOC_HASH, state
} from "./util.js";
import { PSTYLE } from "./species.js";

const PHASES = ["dawn", "day", "dusk", "night"];   // hoisted: no per-frame array literal

class Scene {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.t = 0;
    this.ripples = [];
    this.flyers = [];
    this.actors = [];
    this.critters = [];
    this.fishRings = [];
    this.meteors = [];
    this.lastDeer = -999; this.lastCat = -999; this.lastSkein = -999;
    this.lastFox = -999; this.lastRabbit = -999; this.lastHeron = -999;
    this.lastPorpoise = -999;
    this.timeMix = { dawn: 1, day: 0, dusk: 0, night: 0 };
    this.refreshTokens();
    this.reseed(state.seed);
    const ro = new ResizeObserver(() => this.resize());
    ro.observe(canvas);
    this.resize();
    this.last = performance.now();
    this._frame = (n) => this.frame(n);   // bound once, not re-created each frame
    requestAnimationFrame(this._frame);
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
    this._skyKey = null;      // invalidate the cached sky gradient
    const fc = this.tok.firefly;
    this.tok.fireflyRGB = (fc[0]|0) + "," + (fc[1]|0) + "," + (fc[2]|0);
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
    this.loc = loc;
    this.flyers = []; this.ripples = [];
    this.actors = []; this.critters = [];
    this.fishRings = []; this.meteors = [];
    this.lastDeer = this.t - 60; this.lastCat = this.t - 40; this.lastSkein = this.t - 20;
    this.lastFox = this.t - 55; this.lastRabbit = this.t - 30; this.lastHeron = this.t - 50;
    this.lastPorpoise = this.t - 40;

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
      this.grass = this.makeGrass(rng, 110, 0.03, 0.05);
      // shrubs on the near hill, a couple of far trees, wildflowers and stones
      this.bushes = [];
      for (let i = 0; i < 5 + Math.floor(rng()*4); i++) {
        const x = rng();
        this.bushes.push({ x, y: this.hillB(x), r: 0.018 + rng()*0.03, lobes: 3 + Math.floor(rng()*3) });
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
      for (const idx of [0, Math.floor(tips.length*0.35), Math.floor(tips.length*0.7)]) {
        if (tips[idx]) this.perches.push({ x: tips[idx].x, y: tips[idx].y, depth: 3 + rng()*2, type: "branch" });
      }
      const groundYn = (x) => 0.92 - (x*0.5 - 0.25)*(x*0.5 - 0.25)*0.1;   // the grass line
      const gx1 = 0.30 + rng()*0.45;
      this.perches.push({ x: gx1, y: groundYn(gx1), depth: 2 + rng()*2, type: "ground" });
      const hx = 0.28 + rng()*0.44;
      this.perches.push({ x: hx, y: this.hillB(hx) - 0.004, depth: 8 + rng()*3, type: "ground" });
    } else if (loc === "forest") {
      this.hillA = this.makeRidge(rng, 0.55, 0.06);
      this.trunksFar = []; this.trunksMid = []; this.trunksNear = [];
      for (let i = 0; i < 11; i++) this.trunksFar.push(this.makeTrunk(rng, 0.30 + rng()*0.12, 1.6 + rng()*1.4));
      for (let i = 0; i < 7; i++)  this.trunksMid.push(this.makeTrunk(rng, 0.23 + rng()*0.10, 2.4 + rng()*1.8));
      for (let i = 0; i < 6; i++)  this.trunksNear.push(this.makeTrunk(rng, 0.16 + rng()*0.10, 3.5 + rng()*3));
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
      this.leaves = [];
      for (let i = 0; i < (REDUCED ? 4 : 13); i++) {
        this.leaves.push({ x: rng(), y: rng(), sp: 0.012 + rng()*0.022,
          drift: (rng()-0.5)*0.035, ph: rng()*Math.PI*2, rot: rng()*Math.PI*2 });
      }
      // A perch sits at the leaning top of a near trunk, just under its canopy.
      this.perches = this.trunksNear.slice(0, 4).map(tr => (
        { x: tr.x + tr.lean*2, y: tr.top + 0.07 + rng()*0.05, depth: 3 + rng()*4, type: "branch" }
      ));
      const fpx = 0.3 + rng()*0.4;
      this.perches.push({ x: fpx, y: 0.9, depth: 5 + rng()*3, type: "ground" });
    } else if (loc === "beach") {
      this.horizonY = 0.50 + rng()*0.05;
      this.shoreY = 0.80 + rng()*0.03;
      this.foam = [{ p: rng() }, { p: rng() }, { p: rng() }];
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
      this.perches.push({ x: 0.3 + rng()*0.4, y: this.shoreY + 0.08, depth: 3, type: "ground" });
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
      this.perches = tall.slice(0, 4).map(r => ({ x: r.x, y: this.bankY - r.h, depth: 3 + rng()*4, type: "reed", reedH: r.h }));
      this.perches.push({ x: 0.4 + rng()*0.2, y: this.bankY - 0.004, depth: 6 + rng()*3, type: "ground" });
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
        for (let i = 0; i < n; i++) b.lit.push({ u: 0.12 + rng()*0.76, v: 0.08 + rng()*0.8, ph: rng()*Math.PI*2 });
      }
      // street-level lamps that warm the pavement after dark
      this.streetlamps = [];
      for (let i = 0; i < 5 + Math.floor(rng()*5); i++) {
        this.streetlamps.push({ x: 0.03 + rng()*0.94, ph: rng()*Math.PI*2 });
      }
      this.perches = [];
      for (let i = 0; i < 4 && this.frontBlocks.length; i++) {
        const b = this.frontBlocks[Math.floor(rng()*this.frontBlocks.length)];
        this.perches.push({ x: b.x + b.w * rng(), y: 0.95 - b.h, depth: 4 + rng()*5, type: "roof" });
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
  makeTrunk(rng, top, w) {
    const canopy = [];
    const nb = 2 + Math.floor(rng()*3);
    for (let i = 0; i < nb; i++) canopy.push({ dx: (rng()-0.5)*0.10, dy: (rng()-0.3)*0.08, r: 0.04 + rng()*0.05 });
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

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.max(1, r.width * dpr);
    this.canvas.height = Math.max(1, r.height * dpr);
    this.dpr = dpr;
    this.W = r.width; this.H = r.height;
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

  /* A voice becomes a visible animal at its own coordinates. */
  spawnForCall(sp, x01, y01, depth, dur, enter = 0, perchType = null) {
    const id = sp.id;
    if (id === "cricket" || id === "cuckoo" || id === "curlew" || id === "rooster") return;
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
          ph: Math.random()*6, size: 2.6, hold: dur + 1.2 });
      }
      return;
    }
    const hs = Math.max(0.75, Math.min(1.6, this.H / 430));
    // Every individual is a little different — size, plumpness, a rare crest,
    // its own idle rhythm — so no two callers feel stamped from one mould.
    const ivar = {
      scale: 0.88 + Math.random()*0.28,
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
      linger: 1.4 + Math.random()*1.8, leave: null,
      depthMix: Math.min(0.42, 0.10 + depth*0.013), data: {}
    };
    if (id === "owl") { a.beh = "owl"; a.linger = 3 + Math.random()*2; a.s *= 1.25; }
    else if (id === "frog") { a.beh = "frog"; a.s *= 0.9; }
    else if (id === "mallard") {
      a.beh = "duck"; a.linger = 4 + Math.random()*3;
      const wy = this.waterY || 0.6, by = this.bankY || 0.9;
      a.y = Math.min(Math.max(y01, wy + 0.05), by - 0.04);
      a.data.dir = Math.random() < 0.5 ? 1 : -1;
    }
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

    // Entrance: the behaviour branch has fixed the resting spot; arrive there by
    // gliding (fliers) or hopping in from the side (ground), fading up as we go,
    // and only begin the call once settled (a.singAt).
    a.restX = a.x; a.restY = a.y;
    a.enter = enter; a.singAt = enter;
    a.enterFromX = a.x; a.enterFromY = a.y;
    if (enter > 0) {
      a.alpha = 0;
      const ground = a.beh === "frog" || a.beh === "wader" || a.beh === "duck";
      const side = a.flip ? 1 : -1;
      if (ground) {
        a.enterFromX = a.restX + side * (0.06 + Math.random()*0.05);
        a.enterFromY = a.restY;
      } else {
        a.enterFromX = a.restX + side * (0.04 + Math.random()*0.04);
        a.enterFromY = a.restY - (0.06 + Math.random()*0.06);
      }
      a.x = a.enterFromX; a.y = a.enterFromY;
    }

    this.actors.push(a);
    if (this.actors.length > 6) this.actors.shift();
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
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.t += dt;
    const k = Math.min(1, dt * 1.2);
    for (const ph of PHASES) {
      this.timeMix[ph] += ((state.time === ph ? 1 : 0) - this.timeMix[ph]) * k;
    }
    this.draw(dt);
    this.spawnCritters(dt);
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
    // No clearRect: the sky gradient is opaque and covers the whole canvas.

    const [top, bot] = this.skyColors();
    const night = this.nightness();

    // Rebuild the sky gradient only when the colours (or size) actually change —
    // constant in steady state, so no gradient is allocated most frames.
    const key = (top[0]|0)+","+(top[1]|0)+","+(top[2]|0)+"|"+(bot[0]|0)+","+(bot[1]|0)+","+(bot[2]|0)+"|"+(H|0);
    if (key !== this._skyKey) {
      const g = c.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, css(top));
      g.addColorStop(1, css(bot));
      this._skyGrad = g; this._skyKey = key;
    }
    c.fillStyle = this._skyGrad;
    c.fillRect(0, 0, W, H);

    this.drawCelestial(c, W, H, top, night, dt);
    this.drawClouds(c, W, H, dt, night);

    switch (this.loc) {
      case "meadow": this.drawMeadow(c, W, H, dt, bot); break;
      case "forest": this.drawForest(c, W, H, dt, bot); break;
      case "beach": this.drawBeach(c, W, H, dt, top, bot, night); break;
      case "wetland": this.drawWetland(c, W, H, dt, top, bot, night); break;
      case "city": this.drawCity(c, W, H, dt, bot, night); break;
    }

    this.drawActors(c, W, H, dt, bot, night);
    this.drawCritters(c, W, H, dt, bot, night);
    this.drawFlyers(c, W, H, dt, bot);
    this.drawFireflies(c, W, H, dt, night);
    this.drawWeather(c, W, H, dt, night);
    this.drawRipples(c, W, H, dt);
  }

  drawCelestial(c, W, H, top, night, dt) {
    // Stars, brightening as the light fails.
    if (night > 0.05 && this.stars) {
      c.fillStyle = `rgb(${this.tok.cloudRGB})`;   // one colour; vary alpha per star
      for (const st of this.stars) {
        const tw = 0.55 + 0.45*Math.sin(this.t*st.tw + st.ph);
        const a = (st.bright ? 0.6 : 0.34) * night * tw;
        if (a < 0.03) continue;
        const sx = st.x*W, sy = st.y*H, r = st.r*(st.bright ? 1.5 : 1);
        c.globalAlpha = a;
        c.fillRect(sx, sy, r, r);
        if (st.bright) {
          c.globalAlpha = a*0.45;
          c.fillRect(sx - r, sy + r*0.3, r*3, r*0.5);
          c.fillRect(sx + r*0.3, sy - r, r*0.5, r*3);
        }
      }
      c.globalAlpha = 1;
    }
    const breathe = 0.86 + 0.14*Math.sin(this.t*0.28);   // a slow living glow
    const m = this.timeMix, total = m.dawn+m.day+m.dusk+m.night || 1;
    const sunA = (m.dawn*0.9 + m.day + m.dusk*0.8) / total;
    if (sunA > 0.03) {
      const denom = Math.max(0.001, m.dawn+m.day+m.dusk);
      const sx = W * (0.22*m.dawn + 0.5*m.day + 0.8*m.dusk) / denom;
      const sy = H * (0.42*m.dawn + 0.16*m.day + 0.46*m.dusk) / denom;
      const rr = Math.min(W,H)*0.05;
      this.drawGlow(c, this.tok.amberRGB, sx, sy, rr*5, rr*5, 0.30*sunA*breathe);
      const sc = this.tok.sun.slice(); sc[3] = sunA;
      c.fillStyle = css(sc);
      c.beginPath(); c.arc(sx, sy, rr, 0, Math.PI*2); c.fill();
      this.celX = sx / W;
    }
    const moonA = m.night / total;
    if (moonA > 0.03) {
      const mx = W*0.72, my = H*0.2, rr = Math.min(W,H)*0.04;
      this.drawGlow(c, this.tok.cloudRGB, mx, my, rr*6, rr*6, 0.12*moonA*breathe);
      const mc = this.tok.moon.slice(); mc[3] = moonA;
      c.fillStyle = css(mc);
      c.beginPath(); c.arc(mx, my, rr, 0, Math.PI*2); c.fill();
      c.fillStyle = css(mix(top, this.tok.moon, 0.08).slice(0,3).concat([moonA]));
      c.beginPath(); c.arc(mx - rr*0.42, my - rr*0.18, rr*0.85, 0, Math.PI*2); c.fill();
      // shooting stars
      for (let i = this.meteors.length - 1; i >= 0; i--) {
        const mt = this.meteors[i];
        mt.age += dt; mt.x += mt.vx*dt; mt.y += mt.vy*dt;
        if (mt.age > mt.life) { this.meteors.splice(i, 1); continue; }
        const al = (1 - mt.age/mt.life) * 0.7 * moonA;
        c.strokeStyle = `rgba(${this.tok.cloudRGB}, ${al})`;
        c.lineWidth = 1.2;
        c.beginPath();
        c.moveTo(mt.x*W, mt.y*H);
        c.lineTo((mt.x - mt.vx*0.10)*W, (mt.y - mt.vy*0.10)*H);
        c.stroke();
      }
      this.celX = mx / W;
    }
  }

  drawClouds(c, W, H, dt, night) {
    const rgb = this.tok.cloudRGB;
    const wf = state.weather === "breeze" ? 3 : 1;
    const af = (state.weather === "rain" ? 1.5 : 1) * (1 - night*0.5);
    for (const cl of this.clouds) {
      cl.x += cl.s * dt * wf;
      if (cl.x > 1.3) cl.x = -0.3;
      const cw = cl.w * W;
      this.drawGlow(c, rgb, cl.x*W, cl.y*H, cw, cw*0.35, cl.a * af);
    }
  }

  windAmt() {
    return state.weather === "breeze" ? 1 : (state.weather === "rain" ? 0.5 : 0.25);
  }

  drawGrassTufts(c, W, H, grass, baseYfn, color) {
    c.strokeStyle = color;
    c.lineWidth = 1;
    const wa = this.windAmt();
    for (const gr of grass) {
      const gx = gr.x * W;
      const gy = baseYfn(gr.x) * H;
      const sway = Math.sin(this.t*1.8 + gr.ph) * 6 * wa * this.windWave(gr.x) + gr.lean*4;
      c.beginPath();
      c.moveTo(gx, gy + 4);
      c.quadraticCurveTo(gx + sway*0.4, gy - gr.h*H*0.6, gx + sway, gy - gr.h*H);
      c.stroke();
    }
  }

  drawRidge(c, fn, color, W, H) {
    c.fillStyle = css(color);
    c.beginPath();
    c.moveTo(0, H);
    const n = 60;
    for (let i = 0; i <= n; i++) c.lineTo((i/n)*W, fn(i/n)*H);
    c.lineTo(W, H);
    c.closePath();
    c.fill();
  }

  /* Far-off birds adrift in the upper sky — a couple of quiet wingbeats. */
  drawSkyBirds(c, W, H, dt, bot, night) {
    if (!this.skyBirds) return;
    const col = css(mix(this.tok.ink, bot, 0.45));
    c.strokeStyle = col; c.lineCap = "round"; c.lineWidth = 1.1;
    for (const b of this.skyBirds) {
      b.x += b.sp*dt; b.ph += dt*4;
      if (b.x > 1.15) b.x -= 1.3; else if (b.x < -0.15) b.x += 1.3;
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

  /* A low shrub — a run of overlapping lobes sitting on the ground line. */
  bushShape(c, x, yBase, r, lobes, W, H, color) {
    const px = x*W, py = yBase*H, rr = r*Math.min(W, H);
    c.fillStyle = color;
    for (let i = 0; i < lobes; i++) {
      const dx = (i/Math.max(1, lobes-1) - 0.5)*rr*2.1;
      const rad = rr*(0.68 + 0.42*Math.sin(i*1.7 + x*7));
      c.beginPath(); c.arc(px + dx, py - rad*0.42, rad, 0, Math.PI*2); c.fill();
    }
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
  drawMotes(c, W, H, dt, dayish) {
    if (!this.motes) return;
    const a0 = dayish*0.55;
    if (a0 < 0.03) return;
    c.fillStyle = `rgba(${this.tok.cloudRGB}, 1)`;
    for (const m of this.motes) {
      m.y -= m.sp*dt;
      m.x += (m.drift + Math.sin(this.t*0.3 + m.ph)*0.006)*dt;
      if (m.y < 0.24) { m.y = 0.96; m.x = Math.random(); }
      else if (m.x < -0.02) m.x = 1.02; else if (m.x > 1.02) m.x = -0.02;
      const tw = 0.5 + 0.5*Math.sin(this.t*0.8 + m.ph);
      const a = a0*tw*0.5;
      if (a < 0.02) continue;
      c.globalAlpha = a;
      c.beginPath(); c.arc(m.x*W, m.y*H, m.r, 0, Math.PI*2); c.fill();
    }
    c.globalAlpha = 1;
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
    this.drawSkyBirds(c, W, H, dt, bot, this.nightness());
    this.drawRidge(c, this.hillA, mix(this.tok.ink, bot, 0.45), W, H);
    const farTree = css(mix(this.tok.ink, bot, 0.38));
    for (const t of (this.distantTrees || [])) this.smallTree(c, t.x, t.y, t.h, t.r, W, H, farTree);
    this.drawRidge(c, this.hillB, mix(this.tok.ink, bot, 0.18), W, H);
    const bushCol = css(mix(this.tok.inkDeep, bot, 0.15));
    for (const bu of (this.bushes || [])) this.bushShape(c, bu.x, bu.y, bu.r, bu.lobes, W, H, bushCol);
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
    c.fillStyle = css(mix(this.tok.inkDeep, bot, 0.04));
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
    this.drawMotes(c, W, H, dt, this.dayness());
  }

  drawFlowers(c, W, H, baseYfn, bot) {
    if (!this.flowers) return;
    const wa = this.windAmt();
    c.lineWidth = 1;
    c.strokeStyle = css(mix(this.tok.inkDeep, bot, 0.16));   // stems share one colour
    for (const f of this.flowers) {
      const gx = f.x*W, gy = baseYfn(f.x)*H;
      const sway = Math.sin(this.t*1.6 + f.ph)*5*wa*this.windWave(f.x);
      const tx = gx + sway, ty = gy - f.h*H;
      c.beginPath(); c.moveTo(gx, gy + 3); c.quadraticCurveTo(gx + sway*0.4, gy - f.h*H*0.55, tx, ty); c.stroke();
      const rgb = f.tone < 0.4 ? this.tok.amberRGB : f.tone < 0.72 ? this.tok.sageRGB : this.tok.cloudRGB;
      c.fillStyle = `rgba(${rgb}, 0.82)`;
      c.beginPath(); c.arc(tx, ty, Math.max(1.3, f.h*H*0.11), 0, Math.PI*2); c.fill();
    }
  }

  drawForest(c, W, H, dt, bot) {
    this.drawRidge(c, this.hillA, mix(this.tok.ink, bot, 0.5), W, H);
    const wa = this.windAmt();
    const mn = Math.min(W, H);
    const drawTrunk = (tr, colStr) => {
      const groundY = H * 0.93;
      const topY = H * tr.top;
      const sway = Math.sin(this.t*1.1 + tr.x*9) * 2.2 * wa * this.windWave(tr.x);
      c.strokeStyle = colStr; c.fillStyle = colStr;
      c.lineCap = "round";
      c.lineWidth = tr.w;
      const bx = tr.x*W + tr.lean*W*2 + sway;
      c.beginPath();
      c.moveTo(tr.x*W, groundY);
      c.quadraticCurveTo(tr.x*W + tr.lean*W, (groundY+topY)/2, bx, topY);
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
    c.fillStyle = css(mix(this.tok.inkDeep, bot, 0.05));
    c.fillRect(0, H*0.93, W, H*0.07);
    this.drawFerns(c, W, H, bot);
    this.drawMushrooms(c, W, H, bot);
    this.drawGrassTufts(c, W, H, this.grass, () => 0.93,
      css(mix(this.tok.inkDeep, bot, 0.12)));
    this.drawMotes(c, W, H, dt, this.dayness());
    this.drawFallingLeaves(c, W, H, dt, bot);
  }

  drawFerns(c, W, H, bot) {
    if (!this.ferns) return;
    const wa = this.windAmt();
    c.strokeStyle = css(mix(this.tok.inkDeep, bot, 0.13)); c.lineCap = "round";
    for (const f of this.ferns) {
      const gx = f.x*W, gy = 0.93*H, len = f.size*H;
      const sway = Math.sin(this.t*1.4 + f.x*10)*4*wa*this.windWave(f.x) + f.lean*6;
      c.lineWidth = 1.5;
      c.beginPath(); c.moveTo(gx, gy + 3);
      c.quadraticCurveTo(gx + sway*0.5, gy - len*0.5, gx + sway, gy - len); c.stroke();
      c.lineWidth = 1;
      for (let i = 1; i <= f.blades; i++) {
        const t = i/(f.blades + 1), bx = gx + sway*t, by = gy - len*t, bl = len*0.28*(1 - t*0.5);
        c.beginPath(); c.moveTo(bx, by); c.lineTo(bx - bl, by - bl*0.5); c.stroke();
        c.beginPath(); c.moveTo(bx, by); c.lineTo(bx + bl, by - bl*0.5); c.stroke();
      }
    }
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

  drawFallingLeaves(c, W, H, dt, bot) {
    if (!this.leaves) return;
    c.fillStyle = css(mix(this.tok.inkDeep, bot, 0.18));
    for (const l of this.leaves) {
      l.y += l.sp*dt;
      l.x += (l.drift + Math.sin(this.t*1.2 + l.ph)*0.02)*dt;
      l.rot += dt*1.6;
      if (l.y > 0.96) { l.y = 0.28 + Math.random()*0.12; l.x = Math.random(); }
      c.save(); c.translate(l.x*W, l.y*H); c.rotate(l.rot);
      c.beginPath(); c.ellipse(0, 0, 3.2, 1.4, 0, 0, Math.PI*2); c.fill();
      c.restore();
    }
  }

  drawBeach(c, W, H, dt, top, bot, night) {
    this.drawSkyBirds(c, W, H, dt, bot, night);
    const hy = this.horizonY * H, sy = this.shoreY * H;
    const sg = c.createLinearGradient(0, hy, 0, sy);
    sg.addColorStop(0, css(mix(this.tok.sea, top, 0.40)));
    sg.addColorStop(1, css(mix(this.tok.sea, bot, 0.22)));
    c.fillStyle = sg;
    c.fillRect(0, hy, W, sy - hy);
    c.fillStyle = `rgba(${this.tok.foamRGB}, 0.14)`;
    c.fillRect(0, hy, W, 1);
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
      f.p += dt / 10;
      if (f.p > 1) f.p -= 1;
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

  drawWetland(c, W, H, dt, top, bot, night) {
    this.drawSkyBirds(c, W, H, dt, bot, night);
    this.drawRidge(c, this.treeline, mix(this.tok.ink, bot, 0.42), W, H);
    const farTree = css(mix(this.tok.ink, bot, 0.36));
    for (const t of (this.distantTrees || [])) this.smallTree(c, t.x, t.y, t.h, t.r, W, H, farTree);
    const wy = this.waterY * H, by = this.bankY * H;
    const wg = c.createLinearGradient(0, wy, 0, by);
    wg.addColorStop(0, css(mix(this.tok.sea, top, 0.45)));
    wg.addColorStop(1, css(mix(this.tok.sea, bot, 0.20)));
    c.fillStyle = wg;
    c.fillRect(0, wy, W, by - wy);
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
      fr.age += dt;
      if (fr.age > 1.6) { this.fishRings.splice(i, 1); continue; }
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
    c.fillStyle = css(mix(this.tok.inkDeep, bot, 0.06));
    c.beginPath();
    c.moveTo(0, H); c.lineTo(0, by);
    c.quadraticCurveTo(W*0.5, by - H*0.015, W, by);
    c.lineTo(W, H); c.closePath(); c.fill();
    const wa = this.windAmt();
    const reedCol = css(mix(this.tok.inkDeep, bot, 0.10));
    c.strokeStyle = reedCol; c.fillStyle = reedCol; c.lineWidth = 1.3;
    for (const r of this.reeds) {
      const rx = r.x * W;
      const sway = Math.sin(this.t*1.3 + r.ph) * 7 * wa * this.windWave(r.x) + r.lean*5;
      const topX = rx + sway, topY = by - r.h*H;
      c.beginPath();
      c.moveTo(rx, by + 3);
      c.quadraticCurveTo(rx + sway*0.35, by - r.h*H*0.55, topX, topY);
      c.stroke();
      if (r.head) {
        c.save();
        c.translate(topX, topY);
        c.rotate(sway * 0.01);
        c.beginPath(); c.ellipse(0, 2, 2, 7, 0, 0, Math.PI*2); c.fill();
        c.restore();
      }
    }
    this.drawMotes(c, W, H, dt, this.dayness());
  }

  drawCity(c, W, H, dt, bot, night) {
    this.drawSkyBirds(c, W, H, dt, bot, night);
    const groundY = H * 0.95;
    c.fillStyle = css(mix(this.tok.ink, bot, 0.42));
    for (const b of this.backBlocks) {
      c.fillRect(b.x*W, groundY - (b.h + 0.18)*H, b.w*W, (b.h + 0.18)*H);
    }
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
          const flick = 0.75 + 0.25*Math.sin(this.t*0.6 + wnd.ph);
          c.fillStyle = `rgba(${fc[0]|0},${fc[1]|0},${fc[2]|0},${0.55 * night * flick})`;
          c.fillRect(bx + wnd.u*bw, byTop + wnd.v*bh, 2.5, 3.5);
        }
      }
    }
    c.fillStyle = css(mix(this.tok.inkDeep, bot, 0.04));
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
  drawActors(c, W, H, dt, bot, night) {
    for (let i = this.actors.length - 1; i >= 0; i--) {
      const a = this.actors[i];
      a.t += dt;

      // Entrance: glide/hop from the arrival offset to the resting spot, fading in.
      if (a.enter > 0 && a.t < a.enter) {
        const k = a.t / a.enter, e = k*k*(3 - 2*k);   // smoothstep
        a.x = a.enterFromX + (a.restX - a.enterFromX) * e;
        a.y = a.enterFromY + (a.restY - a.enterFromY) * e;
        a.alpha = Math.min(1, e * 1.3);
      } else if (a.enter > 0 && !a.leave && a.alpha < 1) {
        a.x = a.restX; a.y = a.restY; a.alpha = 1;
      }

      const st = a.t - a.singAt;                       // time since the call began
      const singing = st >= 0 && st < a.dur;
      const sing = singing ? 0.3 + 0.7*Math.abs(Math.sin(st*11)) : 0;
      const sungEnd = a.singAt + a.dur;

      if (!a.leave && a.t > sungEnd + a.linger) {
        if (a.beh === "perch") {
          a.leave = "fly"; a.leaveT = 0;
          a.flyDir = a.flip ? -1 : 1;
          a.launchX = a.x; a.launchY = a.y;
        } else {
          a.leave = "fade";
        }
      }
      if (a.leave === "fly") {
        // A real departure: gather, spring, then climb away on beating wings.
        a.leaveT += dt;
        const crouch = 0.16;
        if (a.leaveT < crouch) {
          a.y = a.launchY + (a.s/H)*0.16*(a.leaveT/crouch);
        } else {
          const ft = a.leaveT - crouch;
          a.y = a.launchY - (a.s/H)*0.16 - (0.05*ft + 0.05*ft*ft);
          a.x = a.launchX + a.flyDir*(0.05*ft + 0.03*ft*ft);
          a.alpha = Math.max(0, 1 - ft*0.72);
        }
        if (a.alpha <= 0.02 || a.y < -0.12 || a.x < -0.14 || a.x > 1.14) { this.actors.splice(i, 1); continue; }
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

      const col = mix(this.tok.inkDeep, bot, a.depthMix);
      const colStr = css([col[0], col[1], col[2], 1]);
      const rimStr = css(mix(col, bot, 0.6));            // a touch lighter, for rim/eye
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
      const flyFlap = flyProg > 0 ? Math.sin(a.leaveT*20) : 0;
      // The perch twig belongs in the scene: draw it at the resting spot, and only
      // once the bird has landed — never trailing from its feet as it flies in/out.
      const landed = a.enter > 0 ? Math.max(0, Math.min(1, (a.t - a.enter)/0.2)) : 1;

      switch (a.beh) {
        case "perch": {
          const ps = PSTYLE[a.id] || {};
          this.drawPerchFooting(c, a.restX*W, a.restY*H, a.s, a.perchType, bot,
            a.alpha * landed * (1 - flyProg));
          this.paintBird(c, {
            x, y: y - hopBob, s: a.s*(ps.sc || 1), flip: a.flip, alpha: a.alpha,
            color: colStr, rim: rimStr, plump: (ps.plump || 1) * (iv.puff || 1),
            tailLen: (ps.tail || 1.1) * (iv.tail || 1), tailUp: !!ps.tailUp,
            billLen: ps.bill || 0.5, crest: iv.crest && !ps.tailUp, rimLight: iv.rim,
            sing, breath, headTurn, tailFlick, wingSettle, fly: flyProg, flap: flyFlap
          });
          break;
        }
        case "owl": this.paintOwl(c, { x, y, s: a.s, alpha: a.alpha, color: colStr, rim: rimStr, night, t: a.t, headTurn }); break;
        case "duck": this.paintDuck(c, { x, y: y + Math.sin(a.t*1.3)*1.5, s: a.s,
          flip: a.data.dir < 0, alpha: a.alpha, color: colStr, rim: rimStr, sing, breath }); break;
        case "pecker": this.paintWoodpecker(c, { x, y, s: a.s, alpha: a.alpha, color: colStr, sing, t: a.t }); break;
        case "wader": this.paintWader(c, { x, y, s: a.s, flip: a.data.dir < 0,
          alpha: a.alpha, color: colStr, rim: rimStr, sing, walking: a.t > sungEnd, t: a.t }); break;
        case "frog": this.paintFrog(c, { x, y, s: a.s, alpha: a.alpha, color: col, bot, sing, breath }); break;
      }
    }
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

  /* A perched songbird, anchored by its feet at (x, y) and built above them,
     so it stands on the perch instead of hovering over it. */
  paintBird(c, o) {
    const s = o.s;
    const plump = o.plump || 1;
    const sing = o.sing || 0;
    const breath = o.breath || 0;
    const fly = o.fly || 0;               // 0 perched, 1 in flight
    c.save();
    c.translate(o.x, o.y);
    if (o.flip) c.scale(-1, 1);
    c.globalAlpha = o.alpha;
    c.fillStyle = o.color; c.strokeStyle = o.color;
    c.lineCap = "round"; c.lineJoin = "round";

    const legLen = s*0.52;
    const bodyRx = s*0.98;
    const bodyRy = s*0.72 * plump * (1 + breath*0.03 + sing*0.05);
    const cy = -(legLen + bodyRy*0.72);           // body centre, above the feet
    const bellyY = cy + bodyRy*0.7;

    // Tail — a tapered blade off the lower back; flicks up now and then.
    const tAng = (o.tailUp ? -0.72 : 0.42) - (o.tailFlick || 0)*0.5;
    const tl = (o.tailLen || 1.1) * s * 1.15;
    const tx0 = -bodyRx*0.6, ty0 = cy + bodyRy*0.12;
    const txE = tx0 - Math.cos(tAng)*tl, tyE = ty0 + Math.sin(tAng)*tl;
    c.beginPath();
    c.moveTo(tx0, ty0 - bodyRy*0.24);
    c.lineTo(txE, tyE - s*0.05);
    c.lineTo(txE, tyE + s*0.16);
    c.lineTo(tx0, ty0 + bodyRy*0.24);
    c.closePath(); c.fill();

    // Legs and toes — they tuck up under the body as the bird takes wing.
    const footY = bellyY*0.62*fly;              // 0 on the perch, rising when flying
    const toeVis = 1 - Math.min(1, fly*1.6);
    c.lineWidth = Math.max(1, s*0.1);
    c.beginPath();
    c.moveTo(-s*0.12, footY); c.lineTo(-s*0.04, bellyY);
    c.moveTo(s*0.2, footY);   c.lineTo(s*0.09, bellyY);
    if (toeVis > 0.05) {
      c.moveTo(-s*0.12, footY); c.lineTo(-s*0.26, footY + s*0.02);
      c.moveTo(-s*0.12, footY); c.lineTo(0, footY + s*0.02);
      c.moveTo(s*0.2, footY);   c.lineTo(s*0.06, footY + s*0.02);
      c.moveTo(s*0.2, footY);   c.lineTo(s*0.32, footY + s*0.02);
    }
    c.stroke();

    // Body.
    c.save(); c.translate(0, cy); c.rotate(-0.14);
    c.beginPath(); c.ellipse(0, 0, bodyRx, bodyRy, 0, 0, Math.PI*2); c.fill();
    c.restore();

    if (fly < 0.4) {
      // Folded wing — settles down onto the body just after landing.
      const wLift = (o.wingSettle || 0)*s*0.5;
      c.save(); c.translate(-s*0.04, cy - wLift);
      c.beginPath();
      c.moveTo(bodyRx*0.34, -bodyRy*0.12);
      c.quadraticCurveTo(-bodyRx*0.4, -bodyRy*0.22, -bodyRx*0.74, bodyRy*0.34);
      c.quadraticCurveTo(-bodyRx*0.1, bodyRy*0.32, bodyRx*0.4, bodyRy*0.06);
      c.closePath(); c.fill();
      c.strokeStyle = o.rim; c.lineWidth = Math.max(0.7, s*0.05); c.stroke();
      c.strokeStyle = o.color;
      c.restore();
    }
    if (fly > 0.03) {
      // Wings spread and beating — one continuous sweep over the back.
      const flap = o.flap || 0;
      const span = (bodyRx + s*0.55) * (0.7 + 0.5*fly);
      const wy = cy - bodyRy*0.25;
      const dip = flap*span*0.42;
      c.strokeStyle = o.color;
      c.lineWidth = Math.max(1.8, s*0.2);
      c.beginPath();
      c.moveTo(-span*0.95, wy - dip*0.9);
      c.quadraticCurveTo(-bodyRx*0.15, wy - span*0.28, bodyRx*0.15, wy);
      c.quadraticCurveTo(bodyRx*0.5, wy - span*0.28, span*0.85, wy - dip);
      c.stroke();
    }

    // Head — turns to glance about, lifts to sing.
    const ht = o.headTurn || 0;
    const hr = s*0.44;
    const hx = bodyRx*0.72 + ht*s*0.1;
    const hy = cy - bodyRy*0.72 - sing*s*0.18;
    c.beginPath(); c.arc(hx, hy, hr, 0, Math.PI*2); c.fill();

    if (o.crest) {
      c.lineWidth = Math.max(1, s*0.09);
      c.beginPath();
      c.moveTo(hx - hr*0.2, hy - hr*0.85); c.lineTo(hx - hr*0.75, hy - hr*1.5);
      c.moveTo(hx + hr*0.05, hy - hr*0.9); c.lineTo(hx - hr*0.28, hy - hr*1.6);
      c.stroke();
    }

    // Bill — a slim wedge that parts to sing.
    const bl = (o.billLen || 0.5) * s * 1.35;
    const bx = hx + hr*0.72, by = hy;
    const gap = 0.08 + sing*0.5;
    c.beginPath();
    c.moveTo(bx, by - s*0.07);
    c.lineTo(bx + bl, by - Math.sin(gap)*bl*0.5);
    c.lineTo(bx, by + s*0.06);
    c.closePath(); c.fill();
    if (sing > 0.14) {
      c.beginPath();
      c.moveTo(bx, by + s*0.06);
      c.lineTo(bx + bl*0.92, by + Math.sin(gap)*bl*0.5 + s*0.05);
      c.lineTo(bx, by + s*0.16);
      c.closePath(); c.fill();
    }

    // Eye glint.
    c.fillStyle = o.rim;
    c.beginPath(); c.arc(hx + hr*0.32, hy - hr*0.16, Math.max(0.8, hr*0.17), 0, Math.PI*2); c.fill();
    c.fillStyle = o.color;

    // Optional breast rim-light, for the odd individual caught by the light.
    if (o.rimLight) {
      c.save(); c.translate(0, cy); c.rotate(-0.14);
      c.strokeStyle = o.rim; c.lineWidth = Math.max(0.7, s*0.06);
      c.beginPath(); c.ellipse(0, 0, bodyRx, bodyRy, 0, Math.PI*0.12, Math.PI*0.7); c.stroke();
      c.restore();
    }
    c.restore();
  }

  paintOwl(c, o) {
    const s = o.s;
    c.save();
    c.translate(o.x, o.y);
    c.rotate(Math.sin(o.t*0.6)*0.025);
    c.globalAlpha = o.alpha;
    c.fillStyle = o.color; c.strokeStyle = o.color;
    c.lineWidth = Math.max(1, s*0.11); c.lineCap = "round";
    const legLen = s*0.24;
    const bodyRx = s*0.62, bodyRy = s*0.92;
    const cy = -(legLen + bodyRy*0.82);
    const ex = (o.headTurn || 0)*s*0.08;
    // talons
    c.beginPath();
    c.moveTo(-s*0.14, cy + bodyRy*0.78); c.lineTo(-s*0.14, 0);
    c.moveTo(s*0.14, cy + bodyRy*0.78);  c.lineTo(s*0.14, 0);
    c.moveTo(-s*0.14, 0); c.lineTo(-s*0.26, s*0.02); c.moveTo(-s*0.14, 0); c.lineTo(-s*0.02, s*0.02);
    c.moveTo(s*0.14, 0);  c.lineTo(s*0.02, s*0.02);  c.moveTo(s*0.14, 0);  c.lineTo(s*0.26, s*0.02);
    c.stroke();
    // body + head (owls read as one rounded mass)
    c.beginPath(); c.ellipse(0, cy, bodyRx, bodyRy, 0, 0, Math.PI*2); c.fill();
    const hy = cy - bodyRy*0.66, hr = s*0.52;
    c.beginPath(); c.arc(ex, hy, hr, 0, Math.PI*2); c.fill();
    // ear tufts
    c.beginPath();
    c.moveTo(ex - hr*0.5, hy - hr*0.72); c.lineTo(ex - hr*0.86, hy - hr*1.4);
    c.moveTo(ex + hr*0.5, hy - hr*0.72); c.lineTo(ex + hr*0.86, hy - hr*1.4);
    c.stroke();
    // great round eyes — pale discs, dark pupils, a glow after dark
    const eyN = o.night || 0;
    c.fillStyle = o.rim;
    c.beginPath();
    c.arc(ex - hr*0.42, hy - hr*0.02, hr*0.3, 0, Math.PI*2);
    c.arc(ex + hr*0.42, hy - hr*0.02, hr*0.3, 0, Math.PI*2); c.fill();
    c.fillStyle = o.color;
    c.beginPath();
    c.arc(ex - hr*0.42, hy - hr*0.02, hr*0.14, 0, Math.PI*2);
    c.arc(ex + hr*0.42, hy - hr*0.02, hr*0.14, 0, Math.PI*2); c.fill();
    if (eyN > 0.15) {
      const fc = this.tok.firefly;
      c.fillStyle = `rgba(${fc[0]|0},${fc[1]|0},${fc[2]|0},${0.8*eyN*o.alpha})`;
      c.beginPath();
      c.arc(ex - hr*0.42, hy - hr*0.02, hr*0.17, 0, Math.PI*2);
      c.arc(ex + hr*0.42, hy - hr*0.02, hr*0.17, 0, Math.PI*2); c.fill();
    }
    // little beak
    c.fillStyle = o.color;
    c.beginPath();
    c.moveTo(ex, hy + hr*0.12); c.lineTo(ex - hr*0.12, hy + hr*0.52); c.lineTo(ex + hr*0.12, hy + hr*0.52);
    c.closePath(); c.fill();
    c.restore();
  }

  paintDuck(c, o) {
    const s = o.s;
    c.save();
    c.translate(o.x, o.y);
    if (o.flip) c.scale(-1, 1);
    c.globalAlpha = o.alpha;
    c.fillStyle = o.color; c.strokeStyle = o.color;
    c.lineWidth = Math.max(1, s*0.14); c.lineCap = "round";
    c.beginPath(); c.ellipse(0, 0, s, s*0.5, 0, 0, Math.PI*2); c.fill();
    c.beginPath();
    c.moveTo(-s*0.9, -s*0.15); c.lineTo(-s*1.25, -s*0.5);
    c.stroke();
    const hy = -s*0.85 - (o.sing || 0)*s*0.25;
    c.beginPath(); c.arc(s*0.55, hy, s*0.33, 0, Math.PI*2); c.fill();
    c.beginPath();
    c.moveTo(s*0.85, hy); c.lineTo(s*1.3, hy + s*0.06);
    c.stroke();
    c.restore();
  }

  paintWoodpecker(c, o) {
    const s = o.s;
    c.save();
    c.translate(o.x, o.y);
    c.globalAlpha = o.alpha;
    c.fillStyle = o.color; c.strokeStyle = o.color;
    c.lineWidth = Math.max(1, s*0.12); c.lineCap = "round";
    const hammer = Math.abs(Math.sin(o.t*26)) * (o.sing || 0) * s * 0.28;
    c.beginPath(); c.ellipse(s*0.35, 0, s*0.5, s*0.95, 0.15, 0, Math.PI*2); c.fill();
    const hx = s*0.15 - hammer, hy = -s*1.1;
    c.beginPath(); c.arc(hx, hy, s*0.36, 0, Math.PI*2); c.fill();
    c.beginPath();
    c.moveTo(hx - s*0.3, hy); c.lineTo(hx - s*0.85, hy + s*0.05);
    c.stroke();
    c.beginPath();
    c.moveTo(s*0.3, s*0.85); c.lineTo(s*0.05, s*1.5);
    c.stroke();
    c.restore();
  }

  paintWader(c, o) {
    const s = o.s;
    c.save();
    c.translate(o.x, o.y);
    if (o.flip) c.scale(-1, 1);
    c.globalAlpha = o.alpha;
    c.fillStyle = o.color; c.strokeStyle = o.color;
    c.lineCap = "round";
    const sing = o.sing || 0;
    const step = o.walking ? Math.sin(o.t*8) : 0;
    const legLen = s*1.15;
    const bodyRx = s*0.9, bodyRy = s*0.48;
    const cy = -(legLen + bodyRy*0.5);
    const bax = -s*0.1 + step*s*0.2, fax = s*0.28 - step*s*0.2;   // stepping feet
    // long legs
    c.lineWidth = Math.max(1, s*0.09);
    c.beginPath();
    c.moveTo(-s*0.08, cy + bodyRy*0.5); c.lineTo(bax, 0);
    c.moveTo(s*0.26, cy + bodyRy*0.5);  c.lineTo(fax, 0);
    c.moveTo(bax, 0); c.lineTo(bax - s*0.16, s*0.02); c.moveTo(bax, 0); c.lineTo(bax + s*0.14, s*0.02);
    c.moveTo(fax, 0); c.lineTo(fax - s*0.14, s*0.02); c.moveTo(fax, 0); c.lineTo(fax + s*0.16, s*0.02);
    c.stroke();
    // body
    c.beginPath(); c.ellipse(0, cy, bodyRx, bodyRy, -0.1, 0, Math.PI*2); c.fill();
    // neck and head, lifted to call
    const hy = cy - bodyRy*1.35 - sing*s*0.22, hx = bodyRx*0.66, hr = s*0.3;
    c.lineWidth = Math.max(1.4, s*0.2);
    c.beginPath(); c.moveTo(bodyRx*0.42, cy - bodyRy*0.35); c.lineTo(hx, hy); c.stroke();
    c.beginPath(); c.arc(hx, hy, hr, 0, Math.PI*2); c.fill();
    // long straight bill, parting to call
    const gap = sing*0.22;
    c.lineWidth = Math.max(1.1, s*0.09);
    c.beginPath();
    c.moveTo(hx + hr*0.55, hy - gap*s*0.4); c.lineTo(hx + hr*0.55 + s*1.0, hy + s*0.1 - gap*s*0.7);
    c.moveTo(hx + hr*0.55, hy + gap*s*0.4); c.lineTo(hx + hr*0.55 + s*0.95, hy + s*0.16 + gap*s*0.7);
    c.stroke();
    // eye
    c.fillStyle = o.rim;
    c.beginPath(); c.arc(hx + hr*0.25, hy - hr*0.2, Math.max(0.8, hr*0.24), 0, Math.PI*2); c.fill();
    c.restore();
  }

  paintFrog(c, o) {
    const s = o.s;
    c.save();
    c.translate(o.x, o.y);
    c.globalAlpha = o.alpha;
    const colStr = css([o.color[0], o.color[1], o.color[2], 1]);
    c.fillStyle = colStr;
    c.beginPath(); c.ellipse(0, 0, s, s*0.62, 0, Math.PI, 0); c.fill();
    c.beginPath();
    c.arc(-s*0.35, -s*0.52, s*0.16, 0, Math.PI*2);
    c.arc(s*0.15, -s*0.58, s*0.16, 0, Math.PI*2);
    c.fill();
    const sing = o.sing || 0;
    if (sing > 0.05) {
      const lite = mix(o.color, o.bot, 0.55);
      c.fillStyle = css([lite[0], lite[1], lite[2], 1]);
      const r = s*0.32*(0.35 + 0.65*sing);
      c.beginPath(); c.arc(s*0.55, -s*0.08, r, 0, Math.PI*2); c.fill();
    }
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
        && n("butterfly") < (REDUCED ? 1 : 3) && P(0.07)) {
      this.critters.push({ kind: "butterfly", x: Math.random(), y: 0.55 + Math.random()*0.3,
        t: 0, ph: Math.random()*6, drift: (Math.random()-0.5)*0.02, life: 18 + Math.random()*10 });
    }
    if (this.loc === "wetland" && dayish > 0.5 && state.weather !== "rain"
        && n("dragonfly") < 2 && P(0.05)) {
      this.critters.push({ kind: "dragonfly", x: 0.2 + Math.random()*0.6,
        y: this.waterY - 0.03 - Math.random()*0.1, t: 0, mode: "hover",
        timer: 1 + Math.random(), tx: 0, ty: 0, life: 16 + Math.random()*8 });
    }
    if (night > 0.5 && state.weather !== "rain" && this.loc !== "beach"
        && n("bat") < (REDUCED ? 1 : 3) && P(0.09)) {
      const sx = Math.random() < 0.5 ? -0.05 : 1.05;
      this.critters.push({ kind: "bat", x: sx, y: 0.12 + Math.random()*0.28, t: 0,
        vx: (sx < 0 ? 1 : -1)*(0.06 + Math.random()*0.05), vy: 0, turn: 0,
        size: 3.5 + Math.random()*2 });
    }
    if (this.loc === "forest" && duskdawn > 0.5 && n("deer") === 0
        && this.t - this.lastDeer > 90 && P(0.03)) {
      this.lastDeer = this.t;
      const dir = Math.random() < 0.5 ? 1 : -1;
      this.critters.push({ kind: "deer", x: dir > 0 ? -0.08 : 1.08, dir,
        tx: 0.25 + Math.random()*0.5, state: "enter", t: 0, timer: 0,
        head: 0, cycles: 2 + Math.floor(Math.random()*2), lp: 0 });
    }
    if (this.loc === "beach" && night < 0.5 && n("runner") < 3 && P(0.05)) {
      const dir = Math.random() < 0.5 ? 1 : -1;
      this.critters.push({ kind: "runner", x: dir > 0 ? -0.03 : 1.03, dir,
        mode: "dash", timer: 0.4 + Math.random()*0.4, t: 0, ph: 0 });
    }
    if (this.loc === "city" && night > 0.5 && n("cat") === 0
        && this.t - this.lastCat > 70 && P(0.03)
        && this.frontBlocks && this.frontBlocks.length) {
      this.lastCat = this.t;
      const bi = Math.floor(Math.random()*this.frontBlocks.length);
      const dir = Math.random() < 0.5 ? 1 : -1;
      this.critters.push({ kind: "cat", b: bi, u: dir > 0 ? 0 : 1, dir, mode: "walk", timer: 0, t: 0 });
    }
    if (this.loc === "meadow" && dayish > 0.3 && calmW && n("rabbit") === 0
        && this.t - this.lastRabbit > 45 && P(0.02)) {
      this.lastRabbit = this.t;
      const dir = Math.random() < 0.5 ? 1 : -1;
      this.critters.push({ kind: "rabbit", x: dir > 0 ? -0.05 : 1.05, dir,
        mode: "hop", timer: 0.3 + Math.random()*0.3, t: 0, hopPh: 0, ear: 0 });
    }
    if ((this.loc === "meadow" || this.loc === "forest") && (duskdawn > 0.45 || night > 0.4)
        && n("fox") === 0 && this.t - this.lastFox > 80 && P(0.014)) {
      this.lastFox = this.t;
      const dir = Math.random() < 0.5 ? 1 : -1;
      this.critters.push({ kind: "fox", x: dir > 0 ? -0.08 : 1.08, dir,
        mode: "trot", timer: 1.2 + Math.random()*1.5, t: 0, lp: 0, look: 0 });
    }
    if ((this.loc === "wetland" || this.loc === "beach") && dayish > 0.3
        && n("heron") === 0 && this.t - this.lastHeron > 85 && P(0.012)) {
      this.lastHeron = this.t;
      const dir = Math.random() < 0.5 ? 1 : -1;
      const edge = this.loc === "wetland" ? (this.bankY || 0.86) - 0.005 : (this.shoreY || 0.82) + 0.02;
      this.critters.push({ kind: "heron", x: 0.25 + Math.random()*0.5, y: edge, dir,
        mode: "stand", timer: 4 + Math.random()*5, t: 0, vx: 0, flap: 0 });
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

  drawCritters(c, W, H, dt, bot, night) {
    const colDark = css(mix(this.tok.inkDeep, bot, 0.12));
    const colFar = css(mix(this.tok.ink, bot, 0.5));
    for (let i = this.critters.length - 1; i >= 0; i--) {
      const cr = this.critters[i];
      cr.t += dt;
      let dead = false;
      switch (cr.kind) {
        case "butterfly": {
          cr.x += (cr.drift + Math.sin(cr.t*0.8 + cr.ph)*0.015)*dt;
          cr.y += (Math.sin(cr.t*1.9 + cr.ph)*0.05 + Math.cos(cr.t*0.6)*0.02)*dt;
          if (cr.t > cr.life || cr.x < -0.05 || cr.x > 1.05) { dead = true; break; }
          const al = Math.max(0, Math.min(1, cr.life - cr.t)) * 0.85;
          const px = cr.x*W, py = cr.y*H;
          const f = Math.abs(Math.sin(cr.t*15 + cr.ph));
          c.fillStyle = `rgba(${this.tok.amberRGB}, ${0.30*al})`;
          c.strokeStyle = colDark;
          c.lineWidth = 1;
          c.globalAlpha = al;
          c.beginPath();
          c.moveTo(px, py);
          c.quadraticCurveTo(px - 6, py - 5*f - 2, px - 1.5, py + 1);
          c.closePath(); c.fill(); c.stroke();
          c.beginPath();
          c.moveTo(px, py);
          c.quadraticCurveTo(px + 6, py - 5*f - 2, px + 1.5, py + 1);
          c.closePath(); c.fill(); c.stroke();
          c.globalAlpha = 1;
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
          const px = cr.x*W + jx, py = cr.y*H + jy;
          c.strokeStyle = colDark; c.lineWidth = 1.2; c.lineCap = "round";
          c.beginPath(); c.moveTo(px - 5, py); c.lineTo(px + 4, py); c.stroke();
          c.beginPath(); c.arc(px + 5, py, 1.2, 0, Math.PI*2);
          c.fillStyle = colDark; c.fill();
          c.globalAlpha = 0.25 + Math.random()*0.35;
          c.beginPath();
          c.moveTo(px - 2, py - 1); c.lineTo(px - 8, py - 4);
          c.moveTo(px, py - 1); c.lineTo(px - 6, py - 5);
          c.stroke();
          c.globalAlpha = 1;
          break;
        }
        case "bat": {
          cr.turn -= dt;
          if (cr.turn <= 0) { cr.vy = (Math.random()-0.5)*0.16; cr.turn = 0.3 + Math.random()*0.5; }
          cr.x += cr.vx*dt; cr.y += cr.vy*dt;
          cr.y = Math.max(0.05, Math.min(0.6, cr.y));
          if (cr.x < -0.1 || cr.x > 1.1) { dead = true; break; }
          const flap = Math.sin(cr.t*24);
          const px = cr.x*W, py = cr.y*H, s = cr.size;
          c.strokeStyle = colDark; c.lineWidth = 1.2; c.lineCap = "round";
          c.beginPath();
          c.moveTo(px - s, py);
          c.quadraticCurveTo(px - s*0.5, py - s*0.9*flap, px, py);
          c.quadraticCurveTo(px + s*0.5, py - s*0.9*flap, px + s, py);
          c.stroke();
          break;
        }
        case "deer": {
          const walking = cr.state === "enter" || cr.state === "leave" || cr.state === "walkbit";
          if (walking) { cr.x += cr.dir*0.02*dt; cr.lp += dt*6; }
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
              if (cr.cycles <= 0) { cr.state = "leave"; }
              else {
                cr.state = "walkbit";
                cr.tx = Math.min(0.9, Math.max(0.1, cr.x + cr.dir*(0.06 + Math.random()*0.08)));
              }
            }
          } else if (cr.state === "leave") {
            if (cr.x < -0.12 || cr.x > 1.12) { dead = true; break; }
          }
          this.paintDeer(c, { x: cr.x*W, y: 0.93*H, s: H*0.075, dir: cr.dir,
            head: cr.head, walking, lp: cr.lp, color: colDark, t: cr.t,
            grazing: cr.state === "graze" });
          break;
        }
        case "runner": {
          cr.timer -= dt;
          if (cr.mode === "dash") {
            cr.x += cr.dir*0.11*dt; cr.ph += dt*30;
            if (cr.timer <= 0) { cr.mode = "pause"; cr.timer = 0.5 + Math.random()*1.2; }
          } else if (cr.timer <= 0) {
            cr.mode = "dash"; cr.timer = 0.35 + Math.random()*0.5;
            if (Math.random() < 0.25) cr.dir *= -1;
          }
          if (cr.x < -0.06 || cr.x > 1.06) { dead = true; break; }
          const px = cr.x*W, py = ((this.shoreY || 0.82) + 0.035)*H;
          c.save(); c.translate(px, py);
          if (cr.dir < 0) c.scale(-1, 1);
          c.fillStyle = colDark; c.strokeStyle = colDark;
          c.lineWidth = 1; c.lineCap = "round";
          c.beginPath(); c.ellipse(0, 0, 4, 2.4, 0, 0, Math.PI*2); c.fill();
          c.beginPath(); c.arc(3.4, -2, 1.5, 0, Math.PI*2); c.fill();
          c.beginPath(); c.moveTo(4.8, -2); c.lineTo(6.6, -1.6); c.stroke();
          const sw = cr.mode === "dash" ? Math.sin(cr.ph) : 0;
          c.beginPath();
          c.moveTo(-1, 2); c.lineTo(-1 + sw*1.6, 5);
          c.moveTo(1.4, 2); c.lineTo(1.4 - sw*1.6, 5);
          c.stroke();
          c.restore();
          break;
        }
        case "cat": {
          const b = this.frontBlocks && this.frontBlocks[cr.b];
          if (!b) { dead = true; break; }
          if (cr.mode === "walk") {
            cr.u += cr.dir * 0.02 * dt / Math.max(0.04, b.w);
            if (Math.random() < 0.12*dt) { cr.mode = "sit"; cr.timer = 2 + Math.random()*3; }
            if (cr.u < -0.05 || cr.u > 1.05) { dead = true; break; }
          } else {
            cr.timer -= dt;
            if (cr.timer <= 0) cr.mode = "walk";
          }
          this.paintCat(c, { x: (b.x + cr.u*b.w)*W, y: (0.95 - b.h)*H, dir: cr.dir,
            sit: cr.mode === "sit", t: cr.t, color: colDark });
          break;
        }
        case "rabbit": {
          cr.timer -= dt;
          if (cr.mode === "hop") {
            cr.hopPh += dt*7; cr.x += cr.dir*0.05*dt;
            if (cr.timer <= 0) { cr.mode = "sit"; cr.timer = 0.6 + Math.random()*1.6; cr.hopPh = 0; }
          } else {
            cr.ear = Math.max(0, (cr.ear || 0) - dt*2);
            if (Math.random() < 0.6*dt) cr.ear = 1;
            if (cr.timer <= 0) { cr.mode = "hop"; cr.timer = 0.25 + Math.random()*0.4; }
          }
          if (cr.x < -0.08 || cr.x > 1.08) { dead = true; break; }
          const hop = cr.mode === "hop" ? Math.max(0, Math.sin(cr.hopPh)) : 0;
          this.paintRabbit(c, { x: cr.x*W, y: 0.9*H - hop*H*0.035, s: H*0.032,
            dir: cr.dir, hop, sit: cr.mode === "sit", ear: cr.ear || 0, color: colDark });
          break;
        }
        case "fox": {
          cr.timer -= dt;
          const walking = cr.mode === "trot";
          if (walking) {
            cr.x += cr.dir*0.028*dt; cr.lp += dt*7;
            if (cr.timer <= 0) { cr.mode = "pause"; cr.timer = 0.8 + Math.random()*1.8; }
          } else {
            if (cr.timer <= 0) { cr.mode = "trot"; cr.timer = 1.4 + Math.random()*2.2; }
          }
          if (cr.x < -0.12 || cr.x > 1.12) { dead = true; break; }
          const gy = this.loc === "forest" ? 0.925 : 0.9;
          this.paintFox(c, { x: cr.x*W, y: gy*H, s: H*0.05, dir: cr.dir, walking,
            lp: cr.lp, look: walking ? 0 : Math.sin(cr.t*1.8), color: colDark });
          break;
        }
        case "heron": {
          cr.timer -= dt;
          if (cr.mode === "stand") {
            if (cr.timer <= 0) { cr.mode = "fly"; cr.vx = cr.dir*0.03; }
          } else {
            cr.x += cr.vx*dt; cr.y -= dt*0.018; cr.flap += dt*3.4;
            if (cr.x < -0.16 || cr.x > 1.16) { dead = true; break; }
          }
          this.paintHeron(c, { x: cr.x*W, y: cr.y*H, s: H*0.085, dir: cr.dir,
            flying: cr.mode === "fly", flap: Math.sin(cr.flap || 0), color: colDark, t: cr.t });
          break;
        }
        case "porpoise": {
          cr.x += cr.dir*0.05*dt;
          cr.phase += dt*2.1;
          if (cr.x < -0.08 || cr.x > 1.08) { dead = true; break; }
          const arc = Math.sin(cr.phase);          // one hump = one breach
          if (arc > 0.03) {
            const py = (cr.base - arc*0.05)*H;
            this.paintPorpoise(c, { x: cr.x*W, y: py, dir: cr.dir, arc, color: colDark });
          } else if (arc > -0.06 && Math.random() < 0.4) {
            // a small splash ring as it slips back under
            c.strokeStyle = `rgba(${this.tok.foamRGB}, 0.3)`; c.lineWidth = 1;
            c.beginPath(); c.ellipse(cr.x*W, cr.base*H, 10, 3, 0, 0, Math.PI*2); c.stroke();
          }
          break;
        }
        case "skein": {
          cr.x += cr.vx*dt;
          if (cr.x < -0.25 || cr.x > 1.25) { dead = true; break; }
          const trail = -Math.sign(cr.vx);
          c.strokeStyle = colFar; c.lineWidth = 1; c.lineCap = "round";
          for (let k = 0; k < cr.nb; k++) {
            const side = k % 2 === 0 ? 1 : -1;
            const rank = Math.ceil(k/2);
            const bx = (cr.x + trail*rank*0.016)*W;
            const by2 = (cr.y + side*rank*0.011)*H;
            const flap = Math.sin(cr.t*7 + k);
            c.beginPath();
            c.moveTo(bx - 3, by2 - flap*1.8);
            c.quadraticCurveTo(bx, by2 + 1, bx, by2);
            c.quadraticCurveTo(bx, by2 + 1, bx + 3, by2 - flap*1.8);
            c.stroke();
          }
          break;
        }
      }
      if (dead) this.critters.splice(i, 1);
    }
  }

  paintDeer(c, o) {
    const s = o.s;
    c.save();
    c.translate(o.x, o.y);
    if (o.dir < 0) c.scale(-1, 1);
    c.fillStyle = o.color; c.strokeStyle = o.color;
    c.lineWidth = Math.max(1.2, s*0.09); c.lineCap = "round";
    c.beginPath(); c.ellipse(0, -s*0.78, s*0.72, s*0.32, 0, 0, Math.PI*2); c.fill();
    const offs = [-0.5, -0.25, 0.28, 0.52];
    c.beginPath();
    for (let i = 0; i < 4; i++) {
      const sw = o.walking ? Math.sin(o.lp + i*Math.PI)*0.12*s : 0;
      c.moveTo(offs[i]*s*0.72*1.3, -s*0.55);
      c.lineTo(offs[i]*s*0.72*1.3 + sw, 0);
    }
    c.stroke();
    const nib = o.grazing ? Math.sin(o.t*7)*0.03*s : 0;
    const hx = s*0.95, hy = -s*1.45 + o.head*s*1.35 + nib;
    c.lineWidth = Math.max(1.6, s*0.15);
    c.beginPath();
    c.moveTo(s*0.62, -s*0.95);
    c.lineTo(hx, hy);
    c.stroke();
    c.lineWidth = Math.max(1.2, s*0.09);
    c.beginPath(); c.arc(hx + s*0.06, hy, s*0.13, 0, Math.PI*2); c.fill();
    c.beginPath(); c.moveTo(hx + s*0.16, hy); c.lineTo(hx + s*0.34, hy + s*0.03); c.stroke();
    c.beginPath();
    c.moveTo(hx - s*0.02, hy - s*0.1); c.lineTo(hx - s*0.1, hy - s*0.28);
    c.moveTo(hx + s*0.08, hy - s*0.1); c.lineTo(hx + s*0.14, hy - s*0.28);
    c.stroke();
    c.beginPath(); c.moveTo(-s*0.72, -s*0.9); c.lineTo(-s*0.88, -s*1.02); c.stroke();
    c.restore();
  }

  paintCat(c, o) {
    c.save();
    c.translate(o.x, o.y);
    if (o.dir < 0) c.scale(-1, 1);
    c.fillStyle = o.color; c.strokeStyle = o.color;
    c.lineWidth = 1.2; c.lineCap = "round";
    const sway = Math.sin(o.t*2)*1.6;
    if (o.sit) {
      c.beginPath(); c.ellipse(0, -4.2, 3.4, 4.2, 0, 0, Math.PI*2); c.fill();
      c.beginPath(); c.arc(0.6, -9, 2.2, 0, Math.PI*2); c.fill();
      c.beginPath();
      c.moveTo(-0.9, -10.6); c.lineTo(-1.5, -12.3); c.lineTo(0, -11);
      c.moveTo(2.1, -10.6); c.lineTo(2.7, -12.3); c.lineTo(1.2, -11);
      c.stroke();
      c.beginPath();
      c.moveTo(-3, -1);
      c.quadraticCurveTo(-6.5, -2 + sway*0.4, -6, -6 + sway);
      c.stroke();
    } else {
      c.beginPath(); c.ellipse(0, -3.2, 6, 2.8, 0, 0, Math.PI*2); c.fill();
      c.beginPath(); c.arc(6.2, -4.8, 2.2, 0, Math.PI*2); c.fill();
      c.beginPath();
      c.moveTo(5, -6.6); c.lineTo(4.6, -8.4); c.lineTo(6, -7.1);
      c.moveTo(7.4, -6.6); c.lineTo(7.9, -8.4); c.lineTo(6.5, -7.1);
      c.stroke();
      c.beginPath();
      for (let i = 0; i < 4; i++) {
        const lx = -3.6 + i*2.4;
        const sw2 = Math.sin(o.t*8 + i*Math.PI)*0.9;
        c.moveTo(lx, -1); c.lineTo(lx + sw2, 0);
      }
      c.stroke();
      c.beginPath();
      c.moveTo(-5.8, -3.8);
      c.quadraticCurveTo(-9.5, -7 + sway, -8, -10.5 + sway);
      c.stroke();
    }
    c.restore();
  }

  paintRabbit(c, o) {
    const s = o.s;
    c.save();
    c.translate(o.x, o.y);
    if (o.dir < 0) c.scale(-1, 1);
    c.fillStyle = o.color; c.strokeStyle = o.color;
    c.lineWidth = Math.max(1, s*0.12); c.lineCap = "round";
    // cotton tail
    c.beginPath(); c.arc(-s*0.72, -s*0.42, s*0.2, 0, Math.PI*2); c.fill();
    // haunch / body
    c.beginPath(); c.ellipse(0, -s*0.5, s*0.82, s*0.55, 0, 0, Math.PI*2); c.fill();
    // head
    const hx = s*0.68, hy = -s*0.95 - (o.hop || 0)*s*0.12;
    c.beginPath(); c.arc(hx, hy, s*0.34, 0, Math.PI*2); c.fill();
    // long ears, flicking
    const ea = o.ear || 0;
    c.lineWidth = Math.max(1.4, s*0.17);
    c.beginPath();
    c.moveTo(hx - s*0.08, hy - s*0.18); c.lineTo(hx - s*0.18 - ea*s*0.22, hy - s*0.92);
    c.moveTo(hx + s*0.16, hy - s*0.16); c.lineTo(hx + s*0.24 + ea*s*0.18, hy - s*0.96);
    c.stroke();
    // eye glint
    c.save(); c.fillStyle = css(mix(this.tok.ink, this.tok.moon, 0.5));
    c.beginPath(); c.arc(hx + s*0.14, hy - s*0.05, Math.max(0.7, s*0.07), 0, Math.PI*2); c.fill();
    c.restore();
    // forefoot suggestion when sitting
    if (o.sit) {
      c.lineWidth = Math.max(1, s*0.1);
      c.beginPath(); c.moveTo(s*0.35, -s*0.1); c.lineTo(s*0.5, 0); c.stroke();
    }
    c.restore();
  }

  paintFox(c, o) {
    const s = o.s;
    c.save();
    c.translate(o.x, o.y);
    if (o.dir < 0) c.scale(-1, 1);
    c.fillStyle = o.color; c.strokeStyle = o.color;
    c.lineWidth = Math.max(1.2, s*0.1); c.lineCap = "round";
    // legs, trotting
    const off = [-0.5, -0.26, 0.32, 0.56];
    c.beginPath();
    for (let i = 0; i < 4; i++) {
      const sw = o.walking ? Math.sin(o.lp + i*Math.PI)*0.14*s : 0;
      c.moveTo(off[i]*s, -s*0.4); c.lineTo(off[i]*s + sw, 0);
    }
    c.stroke();
    // bushy tail
    c.beginPath();
    c.moveTo(-s*0.58, -s*0.5);
    c.quadraticCurveTo(-s*1.35, -s*0.42, -s*1.16, -s*1.02);
    c.quadraticCurveTo(-s*0.88, -s*0.52, -s*0.58, -s*0.55);
    c.closePath(); c.fill();
    // sleek low body
    c.beginPath(); c.ellipse(0, -s*0.55, s*0.76, s*0.3, 0, 0, Math.PI*2); c.fill();
    // neck + head, turning to look when paused
    const hx = s*0.74 + (o.look || 0)*s*0.05, hy = -s*0.86 - (o.look || 0)*s*0.05;
    c.lineWidth = Math.max(1.6, s*0.2);
    c.beginPath(); c.moveTo(s*0.48, -s*0.6); c.lineTo(hx, hy); c.stroke();
    c.lineWidth = Math.max(1.2, s*0.1);
    c.beginPath(); c.arc(hx, hy, s*0.19, 0, Math.PI*2); c.fill();
    // snout
    c.beginPath();
    c.moveTo(hx + s*0.1, hy - s*0.02); c.lineTo(hx + s*0.44, hy + s*0.05);
    c.lineTo(hx + s*0.1, hy + s*0.13); c.closePath(); c.fill();
    // pricked ears
    c.beginPath();
    c.moveTo(hx - s*0.12, hy - s*0.12); c.lineTo(hx - s*0.2, hy - s*0.46); c.lineTo(hx + s*0.05, hy - s*0.2); c.closePath();
    c.moveTo(hx + s*0.12, hy - s*0.14); c.lineTo(hx + s*0.16, hy - s*0.48); c.lineTo(hx + s*0.34, hy - s*0.18); c.closePath();
    c.fill();
    c.restore();
  }

  paintHeron(c, o) {
    const s = o.s;
    c.save();
    c.translate(o.x, o.y);
    if (o.dir < 0) c.scale(-1, 1);
    c.fillStyle = o.color; c.strokeStyle = o.color;
    c.lineCap = "round"; c.lineJoin = "round";
    if (!o.flying) {
      // long legs down to the water's edge at the origin
      c.lineWidth = Math.max(1, s*0.045);
      c.beginPath();
      c.moveTo(-s*0.05, -s*0.55); c.lineTo(-s*0.1, 0);
      c.moveTo(s*0.12, -s*0.55); c.lineTo(s*0.15, 0);
      c.moveTo(-s*0.1, 0); c.lineTo(s*0.02, s*0.02);
      c.moveTo(s*0.15, 0); c.lineTo(s*0.28, s*0.02);
      c.stroke();
      // body
      c.beginPath(); c.ellipse(0, -s*0.72, s*0.42, s*0.22, -0.16, 0, Math.PI*2); c.fill();
      // folded plume off the back
      c.lineWidth = Math.max(1, s*0.05);
      c.beginPath(); c.moveTo(-s*0.35, -s*0.72); c.lineTo(-s*0.62, -s*0.62); c.stroke();
      // long S-curved neck
      c.lineWidth = Math.max(1.4, s*0.085);
      c.beginPath();
      c.moveTo(s*0.22, -s*0.82);
      c.bezierCurveTo(s*0.62, -s*1.02, s*0.12, -s*1.22, s*0.42, -s*1.5);
      c.stroke();
      // head + dagger bill
      c.beginPath(); c.arc(s*0.42, -s*1.54, s*0.1, 0, Math.PI*2); c.fill();
      c.lineWidth = Math.max(1, s*0.05);
      c.beginPath(); c.moveTo(s*0.5, -s*1.53); c.lineTo(s*0.98, -s*1.46); c.stroke();
      // crest wisp
      c.beginPath(); c.moveTo(s*0.36, -s*1.6); c.lineTo(s*0.18, -s*1.66); c.stroke();
    } else {
      // in flight: slow, broad wings; neck tucked, legs trailing
      const f = o.flap;
      c.lineWidth = Math.max(1.4, s*0.08);
      c.beginPath(); c.ellipse(0, 0, s*0.44, s*0.16, 0, 0, Math.PI*2); c.fill();
      c.beginPath();
      c.moveTo(0, -s*0.05);
      c.quadraticCurveTo(-s*0.55, -s*0.55*f - s*0.1, -s*1.05, -s*0.12 - s*0.32*f);
      c.moveTo(0, -s*0.05);
      c.quadraticCurveTo(s*0.55, -s*0.55*f - s*0.1, s*1.05, -s*0.12 - s*0.32*f);
      c.stroke();
      // bill forward, legs trailing back
      c.lineWidth = Math.max(1, s*0.05);
      c.beginPath(); c.moveTo(s*0.42, 0); c.lineTo(s*0.9, s*0.03); c.stroke();
      c.beginPath(); c.moveTo(-s*0.42, s*0.02); c.lineTo(-s*0.95, s*0.12); c.stroke();
    }
    c.restore();
  }

  paintPorpoise(c, o) {
    const s = this.H*0.05, a = o.arc;   // a: 0..1, how far clear of the water
    c.save();
    c.translate(o.x, o.y);
    if (o.dir < 0) c.scale(-1, 1);
    c.fillStyle = o.color; c.strokeStyle = o.color;
    c.lineCap = "round";
    // the smooth curve of the back breaking the surface
    c.lineWidth = Math.max(2, s*0.5);
    c.beginPath();
    c.moveTo(-s*0.95, s*0.2);
    c.quadraticCurveTo(0, -s*0.55*a - s*0.12, s*0.95, s*0.2);
    c.stroke();
    // dorsal fin
    c.beginPath();
    c.moveTo(-s*0.08, -s*0.32*a - s*0.05);
    c.lineTo(-s*0.34, -s*0.66*a - s*0.1);
    c.lineTo(s*0.16, -s*0.28*a);
    c.closePath(); c.fill();
    c.restore();
  }

  drawFlyers(c, W, H, dt, bot) {
    for (let i = this.flyers.length - 1; i >= 0; i--) {
      const f = this.flyers[i];
      f.age = (f.age || 0) + dt;
      if (f.kind === "lark" && f.hold > 0) {
        f.hold -= dt;
        f.x += Math.sin(f.ph)*0.0003;
        f.y -= dt*0.004;
        f.ph += dt*20;
      } else {
        if (f.kind === "lark" && !f.vx) f.vx = (Math.random() < 0.5 ? 1 : -1)*0.05;
        f.x += f.vx*dt*3;
        f.ph += dt * (f.kind === "swift" ? 16 : f.kind === "gull" ? 5 : f.kind === "lark" ? 20 : 10);
      }
      if (f.x < -0.12 || f.x > 1.12 || f.y < -0.05) { this.flyers.splice(i, 1); continue; }
      const fx = f.x*W;
      const bob = f.kind === "swift" ? Math.sin(f.ph*0.5)*9 : Math.sin(f.ph*0.3)*4;
      const fy = f.y*H + bob;
      const glide = f.kind === "gull" ? (0.35 + 0.65*Math.max(0, Math.sin(f.ph*0.11))) : 1;
      const flap = Math.sin(f.ph)*0.6*glide;
      c.globalAlpha = Math.min(1, f.age*2);
      c.strokeStyle = css(mix(this.tok.ink, bot, 0.2));
      c.lineWidth = f.kind === "gull" ? 1.6 : 1.3;
      c.beginPath();
      c.moveTo(fx - f.size, fy - flap*f.size);
      c.quadraticCurveTo(fx, fy + f.size*0.3, fx, fy);
      c.quadraticCurveTo(fx, fy + f.size*0.3, fx + f.size, fy - flap*f.size);
      c.stroke();
      c.globalAlpha = 1;
    }
  }

  drawFireflies(c, W, H, dt, night) {
    const ffA = night * (state.weather === "rain" ? 0.15 : 1);
    if (ffA < 0.05 || !this.fireflies.length) return;
    const rgb = this.tok.fireflyRGB;
    for (const ff of this.fireflies) {
      ff.x += (ff.dx + Math.sin(this.t*0.3 + ff.ph)*0.006) * dt;
      if (ff.x < 0) ff.x = 1; if (ff.x > 1) ff.x = 0;
      const blink = Math.max(0, Math.sin(this.t*ff.sp*2 + ff.ph));
      const a = blink*blink * 0.8 * ffA;
      if (a < 0.03) continue;
      const fx = ff.x*W, fy = ff.y*H + Math.sin(this.t*0.7+ff.ph)*5;
      this.drawGlow(c, rgb, fx, fy, 7, 7, a);
    }
  }

  drawWeather(c, W, H, dt, night) {
    if (state.weather === "rain") {
      c.strokeStyle = `rgba(${this.tok.rainRGB}, 0.35)`;
      c.lineWidth = 1;
      c.beginPath();
      for (const d of this.rain) {
        d.y += d.sp * dt * 1.6;
        d.x += dt * 0.02;
        if (d.y > 1) { d.y = -0.05; d.x = Math.random(); }
        const rx = d.x*W, ry = d.y*H;
        c.moveTo(rx, ry);
        c.lineTo(rx - W*0.004, ry + d.len*H);
      }
      c.stroke();
    }
    if (state.weather === "breeze") {
      c.fillStyle = `rgba(${this.tok.cloudRGB}, 0.5)`;
      for (const s of this.seeds) {
        s.x += s.sp * dt * 2;
        s.ph += dt;
        if (s.x > 1.05) { s.x = -0.05; s.y = 0.3 + Math.random()*0.5; }
        const sx = s.x*W, sy = s.y*H + Math.sin(s.ph*1.3)*10;
        c.beginPath(); c.arc(sx, sy, 1.3, 0, Math.PI*2); c.fill();
      }
    }
    if (state.weather === "fog") {
      for (const f of this.fog) {
        f.x += f.sp * dt;
        const fy = f.y * H;
        const fg = c.createLinearGradient(0, fy - f.h*H, 0, fy + f.h*H);
        fg.addColorStop(0, `rgba(${this.tok.fogRGB}, 0)`);
        fg.addColorStop(0.5, `rgba(${this.tok.fogRGB}, ${0.28 * (1-night*0.4)})`);
        fg.addColorStop(1, `rgba(${this.tok.fogRGB}, 0)`);
        c.fillStyle = fg;
        const drift = Math.sin(this.t*0.1 + f.x*10) * W * 0.05;
        c.fillRect(-W*0.1 + drift, fy - f.h*H, W*1.2, f.h*H*2);
      }
    }
  }

  drawRipples(c, W, H, dt) {
    for (let i = this.ripples.length - 1; i >= 0; i--) {
      const r = this.ripples[i];
      r.age += dt;
      if (r.age > r.life) { this.ripples.splice(i, 1); continue; }
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
