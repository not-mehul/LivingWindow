/* ============================================================
   The scene — five etched landscapes behind one pane of glass,
   now inhabited: singers appear where they sing, and the land
   has its own quiet traffic of butterflies, bats, deer and cats.
   ============================================================ */
import {
  mulberry32, parseColor, css, mix, themeVar, REDUCED, LOC_HASH, state
} from "./util.js";
import { PSTYLE } from "./species.js";

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
    this.timeMix = { dawn: 1, day: 0, dusk: 0, night: 0 };
    this.refreshTokens();
    this.reseed(state.seed);
    const ro = new ResizeObserver(() => this.resize());
    ro.observe(canvas);
    this.resize();
    this.last = performance.now();
    requestAnimationFrame((n) => this.frame(n));
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
  }

  reseed(seedBase) {
    const loc = state.location;
    const rng = mulberry32((seedBase ^ LOC_HASH[loc]) >>> 0);
    this.loc = loc;
    this.flyers = []; this.ripples = [];
    this.actors = []; this.critters = [];
    this.fishRings = []; this.meteors = [];
    this.lastDeer = this.t - 60; this.lastCat = this.t - 40; this.lastSkein = this.t - 20;

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

    if (loc === "meadow") {
      this.hillA = this.makeRidge(rng, 0.62, 0.10);
      this.hillB = this.makeRidge(rng, 0.78, 0.07);
      this.treeX = rng() < 0.5 ? 0.12 + rng()*0.1 : 0.78 + rng()*0.1;
      this.tree = this.makeTree(rng);
      this.grass = this.makeGrass(rng, 70, 0.03, 0.05);
      this.perches = [
        { x: this.treeX + 0.02, y: 0.36, depth: 4 },
        { x: this.treeX - 0.04, y: 0.44, depth: 4 },
        { x: 0.5 + (rng()-0.5)*0.3, y: 0.66, depth: 10 },
        { x: 0.3 + rng()*0.4, y: 0.86, depth: 3 },
        { x: rng()*0.9 + 0.05, y: 0.74, depth: 7 }
      ];
    } else if (loc === "forest") {
      this.hillA = this.makeRidge(rng, 0.55, 0.06);
      this.trunksFar = []; this.trunksNear = [];
      for (let i = 0; i < 7; i++) this.trunksFar.push(this.makeTrunk(rng, 0.30 + rng()*0.12, 1.6 + rng()*1.4));
      for (let i = 0; i < 5; i++) this.trunksNear.push(this.makeTrunk(rng, 0.16 + rng()*0.10, 3.5 + rng()*3));
      this.grass = this.makeGrass(rng, 46, 0.04, 0.07);
      this.perches = this.trunksNear.slice(0, 4).map(tr => (
        { x: tr.x, y: tr.top + 0.06 + rng()*0.06, depth: 3 + rng()*4 }
      ));
      this.perches.push({ x: 0.5 + (rng()-0.5)*0.6, y: 0.42, depth: 11 });
    } else if (loc === "beach") {
      this.horizonY = 0.50 + rng()*0.05;
      this.shoreY = 0.80 + rng()*0.03;
      this.foam = [{ p: rng() }, { p: rng() }, { p: rng() }];
      this.duneSide = rng() < 0.5 ? 0 : 1;
      this.duneGrass = [];
      for (let i = 0; i < 20; i++) {
        const gx = this.duneSide === 0 ? rng()*0.22 : 0.78 + rng()*0.22;
        this.duneGrass.push({ x: gx, h: 0.05 + rng()*0.06, ph: rng()*Math.PI*2, lean: (rng()-0.5)*0.8 });
      }
      this.posts = [];
      const npost = 2 + Math.floor(rng()*2);
      for (let i = 0; i < npost; i++) this.posts.push({ x: 0.2 + rng()*0.6, h: 0.05 + rng()*0.03 });
      this.perches = this.posts.map(p => ({ x: p.x, y: this.shoreY - p.h, depth: 5 + rng()*4 }));
      this.perches.push({ x: 0.3 + rng()*0.4, y: this.shoreY + 0.08, depth: 3 });
    } else if (loc === "wetland") {
      this.treeline = this.makeRidge(rng, 0.50, 0.03);
      this.waterY = 0.56 + rng()*0.03;
      this.bankY = 0.86;
      this.rippleLines = [];
      for (let i = 0; i < 5; i++) {
        this.rippleLines.push({ y: this.waterY + 0.05 + rng()*(this.bankY - this.waterY - 0.08), ph: rng()*Math.PI*2, sp: 0.06 + rng()*0.08 });
      }
      this.reeds = [];
      for (let i = 0; i < 28; i++) {
        const side = rng();
        const x = side < 0.55 ? rng()*0.30 : 0.70 + rng()*0.30;
        this.reeds.push({ x, h: 0.14 + rng()*0.14, ph: rng()*Math.PI*2, head: rng() < 0.45, lean: (rng()-0.5)*0.5 });
      }
      const tall = this.reeds.filter(r => r.h > 0.2);
      this.perches = tall.slice(0, 4).map(r => ({ x: r.x, y: this.bankY - r.h, depth: 3 + rng()*4 }));
      this.perches.push({ x: 0.4 + rng()*0.2, y: this.waterY + 0.1, depth: 12 });
    } else {
      this.backBlocks = this.makeSkyline(rng, 0.30, 0.28, 0.05, 0.10);
      this.frontBlocks = this.makeSkyline(rng, 0.55, 0.30, 0.07, 0.13);
      for (const b of this.frontBlocks) {
        b.antenna = rng() < 0.35;
        b.lit = [];
        const n = 3 + Math.floor(rng() * 9);
        for (let i = 0; i < n; i++) b.lit.push({ u: 0.12 + rng()*0.76, v: 0.08 + rng()*0.8, ph: rng()*Math.PI*2 });
      }
      this.perches = [];
      for (let i = 0; i < 4 && this.frontBlocks.length; i++) {
        const b = this.frontBlocks[Math.floor(rng()*this.frontBlocks.length)];
        this.perches.push({ x: b.x + b.w * rng(), y: 0.95 - b.h, depth: 4 + rng()*5 });
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
  spawnForCall(sp, x01, y01, depth, dur) {
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
    const a = {
      id, x: x01, y: y01,
      s: Math.max(5, Math.min(15, 16 - depth*0.55)) * hs,
      t: 0, dur, alpha: 1, flip: x01 > 0.55,
      linger: 1.2 + Math.random()*1.6, leave: null,
      depthMix: Math.min(0.4, 0.10 + depth*0.012), data: {}
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
    for (const k of ["dawn","day","dusk","night"]) {
      const target = state.time === k ? 1 : 0;
      this.timeMix[k] += (target - this.timeMix[k]) * Math.min(1, dt * 1.2);
    }
    this.draw(dt);
    this.spawnCritters(dt);
    requestAnimationFrame((n) => this.frame(n));
  }

  skyColors() {
    const m = this.timeMix;
    const total = m.dawn + m.day + m.dusk + m.night || 1;
    let top = [0,0,0,1], bot = [0,0,0,1];
    for (const k of ["dawn","day","dusk","night"]) {
      const w = m[k] / total;
      top = [top[0]+this.tok.sky[k][0][0]*w, top[1]+this.tok.sky[k][0][1]*w, top[2]+this.tok.sky[k][0][2]*w, 1];
      bot = [bot[0]+this.tok.sky[k][1][0]*w, bot[1]+this.tok.sky[k][1][1]*w, bot[2]+this.tok.sky[k][1][2]*w, 1];
    }
    return [top, bot];
  }

  nightness() {
    const m = this.timeMix, total = m.dawn+m.day+m.dusk+m.night || 1;
    return (m.night + m.dusk * 0.35) / total;
  }

  draw(dt) {
    const c = this.ctx, W = this.W, H = this.H;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.clearRect(0, 0, W, H);

    const [top, bot] = this.skyColors();
    const night = this.nightness();

    const g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, css(top));
    g.addColorStop(1, css(bot));
    c.fillStyle = g;
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
    const m = this.timeMix, total = m.dawn+m.day+m.dusk+m.night || 1;
    const sunA = (m.dawn*0.9 + m.day + m.dusk*0.8) / total;
    if (sunA > 0.03) {
      const denom = Math.max(0.001, m.dawn+m.day+m.dusk);
      const sx = W * (0.22*m.dawn + 0.5*m.day + 0.8*m.dusk) / denom;
      const sy = H * (0.42*m.dawn + 0.16*m.day + 0.46*m.dusk) / denom;
      const rr = Math.min(W,H)*0.05;
      const halo = c.createRadialGradient(sx, sy, 0, sx, sy, rr*5);
      halo.addColorStop(0, `rgba(${this.tok.amberRGB}, ${0.30*sunA})`);
      halo.addColorStop(1, `rgba(${this.tok.amberRGB}, 0)`);
      c.fillStyle = halo;
      c.fillRect(sx-rr*5, sy-rr*5, rr*10, rr*10);
      const sc = this.tok.sun.slice(); sc[3] = sunA;
      c.fillStyle = css(sc);
      c.beginPath(); c.arc(sx, sy, rr, 0, Math.PI*2); c.fill();
      this.celX = sx / W;
    }
    const moonA = m.night / total;
    if (moonA > 0.03) {
      const mx = W*0.72, my = H*0.2, rr = Math.min(W,H)*0.04;
      const halo = c.createRadialGradient(mx, my, 0, mx, my, rr*6);
      halo.addColorStop(0, `rgba(${this.tok.cloudRGB}, ${0.12*moonA})`);
      halo.addColorStop(1, `rgba(${this.tok.cloudRGB}, 0)`);
      c.fillStyle = halo;
      c.fillRect(mx-rr*6, my-rr*6, rr*12, rr*12);
      const mc = this.tok.moon.slice(); mc[3] = moonA;
      c.fillStyle = css(mc);
      c.beginPath(); c.arc(mx, my, rr, 0, Math.PI*2); c.fill();
      c.fillStyle = css(mix(top, this.tok.moon, 0.08).slice(0,3).concat([moonA]));
      c.beginPath(); c.arc(mx - rr*0.42, my - rr*0.18, rr*0.85, 0, Math.PI*2); c.fill();
      if (moonA > 0.4) {
        const srng = mulberry32(state.seed ^ 0x5EED);
        for (let i = 0; i < 40; i++) {
          const x = srng()*W, y = srng()*H*0.5;
          const tw = 0.5 + 0.5*Math.sin(this.t*(1+srng()*2) + i);
          c.globalAlpha = 0.25 * moonA * tw;
          c.fillStyle = `rgba(${this.tok.cloudRGB}, 0.5)`;
          c.fillRect(x, y, 1.2, 1.2);
        }
        c.globalAlpha = 1;
      }
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
    for (const cl of this.clouds) {
      cl.x += cl.s * dt * (state.weather === "breeze" ? 3 : 1);
      if (cl.x > 1.3) cl.x = -0.3;
      const cx = cl.x * W, cy = cl.y * H, cw = cl.w * W;
      const cg = c.createRadialGradient(cx, cy, 0, cx, cy, cw);
      const alpha = cl.a * (state.weather === "rain" ? 1.5 : 1) * (1 - night*0.5);
      cg.addColorStop(0, `rgba(${this.tok.cloudRGB}, ${alpha})`);
      cg.addColorStop(1, `rgba(${this.tok.cloudRGB}, 0)`);
      c.fillStyle = cg;
      c.save(); c.translate(cx, cy); c.scale(1, 0.35); c.translate(-cx, -cy);
      c.beginPath(); c.arc(cx, cy, cw, 0, Math.PI*2); c.fill();
      c.restore();
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
      const sway = Math.sin(this.t*1.8 + gr.ph) * 6 * wa + gr.lean*4;
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

  drawMeadow(c, W, H, dt, bot) {
    this.drawRidge(c, this.hillA, mix(this.tok.ink, bot, 0.45), W, H);
    this.drawRidge(c, this.hillB, mix(this.tok.ink, bot, 0.18), W, H);
    const baseY = this.hillB(this.treeX) * H;
    c.strokeStyle = css(mix(this.tok.inkDeep, bot, 0.06));
    c.lineCap = "round";
    for (const s of this.tree) {
      c.lineWidth = 0.8 + s.w * 1.1;
      const sway = state.weather === "breeze" ? Math.sin(this.t*1.4 + s.y1*8) * (4 - s.w) * 0.8 : 0;
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
    this.drawGrassTufts(c, W, H, this.grass,
      (x) => 0.92 - (x*0.5 - 0.25)*(x*0.5-0.25)*0.1,
      css(mix(this.tok.inkDeep, bot, 0.10)));
  }

  drawForest(c, W, H, dt, bot) {
    this.drawRidge(c, this.hillA, mix(this.tok.ink, bot, 0.5), W, H);
    const wa = this.windAmt();
    const drawTrunk = (tr, color) => {
      const groundY = H * 0.93;
      const topY = H * tr.top;
      const sway = Math.sin(this.t*1.1 + tr.x*9) * 2.2 * wa;
      c.strokeStyle = css(color);
      c.lineCap = "round";
      c.lineWidth = tr.w;
      c.beginPath();
      c.moveTo(tr.x*W, groundY);
      c.quadraticCurveTo(tr.x*W + tr.lean*W, (groundY+topY)/2, tr.x*W + tr.lean*W*2 + sway, topY);
      c.stroke();
      c.fillStyle = css(color);
      for (const b of tr.canopy) {
        c.beginPath();
        c.arc(tr.x*W + tr.lean*W*2 + sway + b.dx*W, topY + b.dy*H, b.r*Math.min(W,H), 0, Math.PI*2);
        c.fill();
      }
    };
    for (const tr of this.trunksFar) drawTrunk(tr, mix(this.tok.ink, bot, 0.34));
    for (const tr of this.trunksNear) drawTrunk(tr, mix(this.tok.inkDeep, bot, 0.10));
    c.fillStyle = css(mix(this.tok.inkDeep, bot, 0.05));
    c.fillRect(0, H*0.93, W, H*0.07);
    this.drawGrassTufts(c, W, H, this.grass, () => 0.93,
      css(mix(this.tok.inkDeep, bot, 0.12)));
  }

  drawBeach(c, W, H, dt, top, bot, night) {
    const hy = this.horizonY * H, sy = this.shoreY * H;
    const sg = c.createLinearGradient(0, hy, 0, sy);
    sg.addColorStop(0, css(mix(this.tok.sea, top, 0.40)));
    sg.addColorStop(1, css(mix(this.tok.sea, bot, 0.22)));
    c.fillStyle = sg;
    c.fillRect(0, hy, W, sy - hy);
    c.fillStyle = `rgba(${this.tok.foamRGB}, 0.14)`;
    c.fillRect(0, hy, W, 1);
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
    this.drawRidge(c, this.treeline, mix(this.tok.ink, bot, 0.42), W, H);
    const wy = this.waterY * H, by = this.bankY * H;
    const wg = c.createLinearGradient(0, wy, 0, by);
    wg.addColorStop(0, css(mix(this.tok.sea, top, 0.45)));
    wg.addColorStop(1, css(mix(this.tok.sea, bot, 0.20)));
    c.fillStyle = wg;
    c.fillRect(0, wy, W, by - wy);
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
      if (p < 0.15) {
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
    for (const r of this.reeds) {
      const rx = r.x * W;
      const sway = Math.sin(this.t*1.3 + r.ph) * 7 * wa + r.lean*5;
      const topX = rx + sway, topY = by - r.h*H;
      c.strokeStyle = css(mix(this.tok.inkDeep, bot, 0.10));
      c.lineWidth = 1.3;
      c.beginPath();
      c.moveTo(rx, by + 3);
      c.quadraticCurveTo(rx + sway*0.35, by - r.h*H*0.55, topX, topY);
      c.stroke();
      if (r.head) {
        c.fillStyle = css(mix(this.tok.inkDeep, bot, 0.10));
        c.save();
        c.translate(topX, topY);
        c.rotate(sway * 0.01);
        c.beginPath(); c.ellipse(0, 2, 2, 7, 0, 0, Math.PI*2); c.fill();
        c.restore();
      }
    }
  }

  drawCity(c, W, H, dt, bot, night) {
    const groundY = H * 0.95;
    c.fillStyle = css(mix(this.tok.ink, bot, 0.42));
    for (const b of this.backBlocks) {
      c.fillRect(b.x*W, groundY - (b.h + 0.18)*H, b.w*W, (b.h + 0.18)*H);
    }
    const frontColor = mix(this.tok.inkDeep, bot, 0.10);
    c.fillStyle = css(frontColor);
    for (const b of this.frontBlocks) {
      const bx = b.x*W, bw = b.w*W, bh = b.h*H, byTop = groundY - bh;
      c.fillRect(bx, byTop, bw, bh);
      if (b.antenna) {
        c.strokeStyle = css(frontColor);
        c.lineWidth = 1.2;
        c.beginPath();
        c.moveTo(bx + bw*0.5, byTop);
        c.lineTo(bx + bw*0.5, byTop - H*0.035);
        c.stroke();
      }
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
  }

  /* ---- the singers, drawn where they sing ---- */
  drawActors(c, W, H, dt, bot, night) {
    for (let i = this.actors.length - 1; i >= 0; i--) {
      const a = this.actors[i];
      a.t += dt;
      const singing = a.t < a.dur;
      const sing = singing ? 0.3 + 0.7*Math.abs(Math.sin(a.t*11)) : 0;
      if (!a.leave && a.t > a.dur + a.linger) {
        if (a.beh === "perch" && Math.random() < 0.6) {
          this.flyers.push({ kind: "bird", x: a.x, y: a.y, age: 0,
            vx: (a.flip ? -1 : 1) * (0.03 + Math.random()*0.02),
            ph: Math.random()*6, size: Math.max(2.5, a.s*0.35) });
          this.actors.splice(i, 1); continue;
        }
        a.leave = "fade";
      }
      if (a.leave === "fade") {
        a.alpha -= dt * 1.5;
        if (a.alpha <= 0) { this.actors.splice(i, 1); continue; }
      }
      if (a.beh === "wader" && a.t > a.dur) {
        a.x += a.data.dir * 0.015 * dt;
        if (a.x < -0.05 || a.x > 1.05) { this.actors.splice(i, 1); continue; }
      }
      if (a.beh === "duck") a.x += a.data.dir * 0.006 * dt;

      const col = mix(this.tok.inkDeep, bot, a.depthMix);
      const colStr = css([col[0], col[1], col[2], 1]);
      const x = a.x*W, y = a.y*H;
      switch (a.beh) {
        case "perch": {
          const st = PSTYLE[a.id] || {};
          this.paintBird(c, { x, y, s: a.s*(st.sc || 1), flip: a.flip, alpha: a.alpha,
            color: colStr, plump: st.plump || 1, tailLen: st.tail || 1.1,
            tailUp: !!st.tailUp, billLen: st.bill || 0.5, sing });
          break;
        }
        case "owl": this.paintOwl(c, { x, y, s: a.s, alpha: a.alpha, color: colStr, night, t: a.t }); break;
        case "duck": this.paintDuck(c, { x, y: y + Math.sin(a.t*1.3)*1.5, s: a.s,
          flip: a.data.dir < 0, alpha: a.alpha, color: colStr, sing }); break;
        case "pecker": this.paintWoodpecker(c, { x, y, s: a.s, alpha: a.alpha, color: colStr, sing, t: a.t }); break;
        case "wader": this.paintWader(c, { x, y, s: a.s, flip: a.data.dir < 0,
          alpha: a.alpha, color: colStr, sing, walking: a.t > a.dur, t: a.t }); break;
        case "frog": this.paintFrog(c, { x, y, s: a.s, alpha: a.alpha, color: col, bot, sing }); break;
      }
    }
  }

  paintBird(c, o) {
    const s = o.s;
    c.save();
    c.translate(o.x, o.y);
    if (o.flip) c.scale(-1, 1);
    c.globalAlpha = o.alpha;
    c.fillStyle = o.color; c.strokeStyle = o.color;
    c.lineWidth = Math.max(1, s*0.14); c.lineCap = "round";
    const ry = s*0.62*(o.plump || 1);
    const tAng = o.tailUp ? -0.9 : 0.38;
    const tl = (o.tailLen || 1.1) * s;
    c.beginPath();
    c.moveTo(-s*0.85, -ry*0.15);
    c.lineTo(-s*0.85 - Math.cos(tAng)*tl, -ry*0.15 + Math.sin(tAng)*tl);
    c.stroke();
    c.beginPath(); c.ellipse(0, 0, s, ry, 0, 0, Math.PI*2); c.fill();
    const sing = o.sing || 0;
    const hx = s*0.72, hy = -ry*0.75 - sing*s*0.22, hr = s*0.42;
    c.beginPath(); c.arc(hx, hy, hr, 0, Math.PI*2); c.fill();
    const gap = 0.12 + sing*0.5;
    const bx = hx + hr*0.7, by2 = hy;
    const bl = (o.billLen || 0.5) * s;
    c.lineWidth = Math.max(1, s*0.12);
    c.beginPath();
    c.moveTo(bx, by2); c.lineTo(bx + Math.cos(-gap)*bl, by2 + Math.sin(-gap)*bl);
    c.moveTo(bx, by2); c.lineTo(bx + Math.cos(gap*0.8)*bl, by2 + Math.sin(gap*0.8)*bl);
    c.stroke();
    if (o.legs !== false) {
      c.beginPath();
      c.moveTo(-s*0.15, ry*0.85); c.lineTo(-s*0.2, ry*0.85 + s*0.55);
      c.moveTo(s*0.25, ry*0.8); c.lineTo(s*0.28, ry*0.8 + s*0.55);
      c.stroke();
    }
    c.restore();
  }

  paintOwl(c, o) {
    const s = o.s;
    c.save();
    c.translate(o.x, o.y);
    c.rotate(Math.sin(o.t*0.6)*0.03);
    c.globalAlpha = o.alpha;
    c.fillStyle = o.color; c.strokeStyle = o.color;
    c.lineWidth = Math.max(1, s*0.12); c.lineCap = "round";
    const w = s*0.62, h = s*1.15;
    c.beginPath(); c.ellipse(0, -h*0.5, w, h*0.6, 0, 0, Math.PI*2); c.fill();
    c.beginPath();
    c.moveTo(-w*0.55, -h*1.0); c.lineTo(-w*0.85, -h*1.35);
    c.moveTo(w*0.55, -h*1.0); c.lineTo(w*0.85, -h*1.35);
    c.stroke();
    if (o.night > 0.15) {
      const fc = this.tok.firefly;
      c.fillStyle = `rgba(${fc[0]|0},${fc[1]|0},${fc[2]|0},${0.9*o.night*o.alpha})`;
      c.beginPath();
      c.arc(-w*0.3, -h*0.88, Math.max(1, s*0.09), 0, Math.PI*2);
      c.arc(w*0.3, -h*0.88, Math.max(1, s*0.09), 0, Math.PI*2);
      c.fill();
    }
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
    c.lineWidth = Math.max(1, s*0.13); c.lineCap = "round";
    const step = o.walking ? Math.sin(o.t*8) : 0;
    c.beginPath(); c.ellipse(0, 0, s*0.9, s*0.5, 0, 0, Math.PI*2); c.fill();
    const sing = o.sing || 0;
    const hy = -s*0.75 - sing*s*0.2;
    c.beginPath(); c.arc(s*0.7, hy, s*0.3, 0, Math.PI*2); c.fill();
    c.beginPath();
    c.moveTo(s*0.95, hy); c.lineTo(s*1.85, hy + s*0.12);
    if (sing > 0.4) { c.moveTo(s*0.95, hy + s*0.06); c.lineTo(s*1.7, hy + s*0.28); }
    c.stroke();
    c.beginPath();
    c.moveTo(-s*0.2, s*0.45); c.lineTo(-s*0.2 + step*s*0.18, s*1.55);
    c.moveTo(s*0.25, s*0.45); c.lineTo(s*0.25 - step*s*0.18, s*1.55);
    c.stroke();
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
    for (const ff of this.fireflies) {
      ff.x += (ff.dx + Math.sin(this.t*0.3 + ff.ph)*0.006) * dt;
      if (ff.x < 0) ff.x = 1; if (ff.x > 1) ff.x = 0;
      const blink = Math.max(0, Math.sin(this.t*ff.sp*2 + ff.ph));
      const a = blink*blink * 0.8 * ffA;
      if (a < 0.03) continue;
      const fx = ff.x*W, fy = ff.y*H + Math.sin(this.t*0.7+ff.ph)*5;
      const fg = c.createRadialGradient(fx, fy, 0, fx, fy, 7);
      const fc = this.tok.firefly;
      fg.addColorStop(0, `rgba(${fc[0]|0},${fc[1]|0},${fc[2]|0},${a})`);
      fg.addColorStop(1, `rgba(${fc[0]|0},${fc[1]|0},${fc[2]|0},0)`);
      c.fillStyle = fg;
      c.beginPath(); c.arc(fx, fy, 7, 0, Math.PI*2); c.fill();
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
