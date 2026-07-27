/* ============================================================
   The Bestiary — a field bench for the window's wildlife.
   A developer tool, separate from the piece: it borrows the
   Scene's painters and the species' synths so every creature
   can be inspected at close range — each animation state on
   demand, each voice on a button, and field notes on when
   (hour weights) and where (habitats) it appears.
   ============================================================ */
import { Scene } from "./scene.js?v=6";
import { SPECIES, PSTYLE, ANIM, CRITTER_VOICES, speciesIcon } from "./species.js?v=6";
import { mulberry32, parseColor, css, mix, themeVar, REDUCED } from "./util.js?v=6";

/* One Scene on a hidden canvas lends us its painters and tokens. */
const scene = new Scene(document.getElementById("bz-hidden"));

/* ---- palettes: the same token-mixing the scene itself does ---- */
let PAL = {};
function buildPalettes() {
  scene.refreshTokens();
  PAL = {};
  for (const sky of ["dawn", "day", "dusk", "night"]) {
    const top = parseColor(themeVar(`--scene-sky-${sky}-top`));
    const bot = parseColor(themeVar(`--scene-sky-${sky}-bot`));
    const amt = sky === "night" ? 0.6 : sky === "dusk" ? 0.2 : 0.15;
    const colArr = mix(scene.tok.inkDeep, bot, amt);
    PAL[sky] = {
      top, bot, colArr,
      col: css([colArr[0], colArr[1], colArr[2], 1]),
      rim: css(mix(colArr, bot, 0.6)),
      deep: css(mix(scene.tok.inkDeep, bot, Math.max(0.02, amt - 0.1)))
    };
  }
}
buildPalettes();

/* ---- shared audio: the same synths, through a gentle master ---- */
let ac = null, master = null;
function playVoice(sp, btn) {
  if (!ac) {
    ac = new (window.AudioContext || window.webkitAudioContext)();
    const lp = ac.createBiquadFilter();
    lp.type = "lowpass"; lp.frequency.value = 12000;
    const comp = ac.createDynamicsCompressor();
    comp.threshold.value = -22; comp.ratio.value = 4;
    master = ac.createGain();
    master.gain.value = parseFloat(document.getElementById("bz-vol").value);
    master.connect(lp); lp.connect(comp); comp.connect(ac.destination);
  }
  if (ac.state === "suspended") ac.resume();
  const r = mulberry32((Math.random()*0xFFFFFFFF) >>> 0);
  const dur = sp.synth(ac, master, ac.currentTime + 0.05, r) || 1;
  btn.disabled = true;
  setTimeout(() => { btn.disabled = false; }, (dur + 0.4)*1000);
}
document.getElementById("bz-vol").addEventListener("input", (e) => {
  if (master) master.gain.value = parseFloat(e.target.value);
});

/* ---- little scenery for the cards ---- */
function skyFill(c, W, H, P, sky) {
  const g = c.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, css(P.top));
  g.addColorStop(1, css(P.bot));
  c.fillStyle = g;
  c.fillRect(0, 0, W, H);
  if (sky === "night") {          // a small moon, so night cards read at a glance
    c.fillStyle = css(scene.tok.moon);
    c.globalAlpha = 0.8;
    c.beginPath(); c.arc(W*0.8, H*0.2, 7, 0, Math.PI*2); c.fill();
    c.globalAlpha = 1;
  }
}
function groundBand(c, W, H, P, gy) {
  c.fillStyle = css(mix(scene.tok.inkDeep, P.bot, 0.06));
  c.fillRect(0, gy, W, H - gy);
}
function waterBand(c, W, H, P, wy) {
  c.fillStyle = css(mix(scene.tok.sea, P.bot, 0.3));
  c.fillRect(0, wy, W, H - wy);
  c.fillStyle = `rgba(${scene.tok.foamRGB}, 0.15)`;
  c.fillRect(0, wy, W, 1.5);
}
function sandBand(c, W, H, P, gy) {
  c.fillStyle = css(mix(scene.tok.sand, P.bot, 0.3));
  c.fillRect(0, gy, W, H - gy);
}
function trunk(c, W, H, P, x) {
  c.strokeStyle = css(mix(scene.tok.inkDeep, P.bot, 0.10));
  c.lineCap = "round"; c.lineWidth = 13;
  c.beginPath(); c.moveTo(x, H + 6); c.lineTo(x + 3, -6); c.stroke();
}

/* The sing pulse the scene itself uses while a call plays. */
const pulse = (t) => ANIM.singBase + ANIM.singAmt*Math.abs(Math.sin(t*ANIM.singRate));

/* ---- the card catalogue ---- */
/* Perched songbirds share one draw, differing only in PSTYLE marks. */
function perchDraw(id) {
  return (c, W, H, tm, mode, P) => {
    const ps = PSTYLE[id] || {};
    const s = 30*(ps.sc || 1);
    const cx = W*0.46, gy = H*0.74;
    let sing = 0, fly = 0, flap = 0, x = cx, y = gy, alpha = 1;
    let peck = 0, legTuck = 0, stride = 0;
    if (mode === "sing") sing = pulse(tm);
    if (mode === "forage") {
      // a few steps, then head down to work the turf — the ground routine
      const cyc = tm % 4.2;
      if (cyc < 1.6) {
        if (ps.walks) stride = tm*9;
        else { legTuck = Math.max(0, Math.sin(tm*11)); y = gy - legTuck*s*0.45; }
        x = cx + Math.sin(cyc*1.9)*10;
      } else if (cyc < 3.2) {
        peck = Math.pow(Math.sin(Math.PI*(((cyc - 1.6)/0.42) % 1)), 0.6);
      }
    }
    if (mode === "take off") {
      const cyc = tm % 2.6;
      if (cyc < 1.0) { /* gathering itself on the perch */ }
      else if (cyc < 1.16) y = gy + s*0.16*((cyc - 1.0)/0.16);
      else {
        const ft = cyc - 1.16;
        fly = Math.min(1, ft/0.14);
        flap = Math.sin(ft*20);
        y = gy - s*0.16 - (ft*90 + ft*ft*140);
        x = cx + ft*70;
        alpha = Math.max(0, 1 - ft*0.9);
      }
    }
    scene.drawPerchFooting(c, mode === "forage" ? x : cx, gy, s,
      mode === "forage" ? "ground" : "branch", P.bot, alpha*(1 - fly));
    scene.paintBird(c, {
      x, y, s, flip: false, alpha, color: P.col, rim: P.rim, deep: P.deep, marks: ps,
      plump: ps.plump || 1, tailLen: ps.tail || 1.1, tailUp: !!ps.tailUp,
      billLen: ps.bill || 0.45, crest: false, sing, peck, legTuck, stride,
      breath: Math.sin(tm*ANIM.breathRate),
      headTurn: Math.sin(tm*ANIM.headRate)*ANIM.headAmt
              + Math.pow(Math.max(0, Math.sin(tm*ANIM.lookRate)), ANIM.lookSharp)*ANIM.lookAmt,
      tailFlick: Math.pow(Math.max(0, Math.sin(tm*ANIM.tailRate)), ANIM.tailSharp),
      wingSettle: 0, fly, flap, t: tm
    });
  };
}

const CARDS = [];
/* kinds for the species that have their own painters or flight forms */
const SPECIAL = {
  owl: { sky: "dusk", modes: ["watch", "hoot", "night", "leave"],
    draw(c, W, H, tm, mode, P) {
      const gy = H*0.78;
      if (mode === "leave") {
        // it tips off the branch and rows away — never dissolves in place
        const cyc = tm % 3.2;
        const ft = Math.max(0, cyc - 0.7);
        const x = W*0.5 + (0.09*ft + 0.05*ft*ft)*320;
        const y = gy + Math.min(0.028, ft*0.10)*300 - 0.030*ft*ft*300;
        scene.drawPerchFooting(c, W*0.5, gy, 26, "branch", P.bot, 1);
        scene.paintOwl(c, { x, y, s: 26, alpha: Math.max(0, 1 - Math.max(0, ft - 1.1)*0.85),
          color: P.col, rim: P.rim, deep: P.deep, night: 0, t: tm,
          fly: cyc > 0.7 ? Math.min(1, (cyc - 0.7)/0.35) : 0,
          flap: Math.sin(cyc*8.5), headTurn: 0, blinkPh: 0 });
        return;
      }
      scene.drawPerchFooting(c, W*0.5, gy, 26, "branch", P.bot, 1);
      scene.paintOwl(c, { x: W*0.5, y: gy, s: 26, alpha: 1, color: P.col, rim: P.rim,
        deep: P.deep, night: mode === "night" ? 1 : 0, t: tm,
        sing: mode === "hoot" ? pulse(tm*0.4) : 0,
        breath: Math.sin(tm*2),
        headTurn: Math.sin(tm*0.5)*0.9, blinkPh: 0 });
    } },
  cuckoo: { sky: "day", modes: ["perch", "call", "fly"],
    draw(c, W, H, tm, mode, P) {
      const gy = H*0.7;
      if (mode === "fly") {
        const x = ((tm*90) % (W + 160)) - 80;
        scene.paintCuckoo(c, { x, y: H*0.5, s: 22, flip: false, alpha: 1,
          color: P.col, rim: P.rim, deep: P.deep, t: tm,
          fly: 1, flap: Math.sin(tm*13) });
        return;
      }
      scene.drawPerchFooting(c, W*0.5, gy, 22, "branch", P.bot, 1);
      scene.paintCuckoo(c, { x: W*0.5, y: gy, s: 22, flip: false, alpha: 1,
        color: P.col, rim: P.rim, deep: P.deep, t: tm,
        breath: Math.sin(tm*2), tailFlick: Math.pow(Math.max(0, Math.sin(tm*1.1)), 8),
        sing: mode === "call" ? pulse(tm*0.35) : 0 });
    } },
  rooster: { sky: "dawn", modes: ["stand", "crow", "step"],
    draw(c, W, H, tm, mode, P) {
      const gy = H*0.8;
      groundBand(c, W, H, P, gy);
      scene.paintRooster(c, { x: W*0.5, y: gy, s: 26, flip: false, alpha: 1,
        color: P.col, rim: P.rim, deep: P.deep, t: tm,
        sing: mode === "crow" ? pulse(tm*0.35) : 0,
        walking: mode === "step", lp: tm*4 });
    } },
  mallard: { sky: "day", modes: ["drift", "quack"],
    draw(c, W, H, tm, mode, P) {
      const wy = H*0.58;
      waterBand(c, W, H, P, wy);
      scene.paintDuck(c, { x: W*0.5, y: wy + 26 + Math.sin(tm*1.3)*1.5, s: 26,
        flip: false, alpha: 1, color: P.col, rim: P.rim, deep: P.deep,
        sing: mode === "quack" ? pulse(tm) : 0, breath: 0, t: tm });
    } },
  woodpecker: { sky: "day", modes: ["cling", "drum"],
    draw(c, W, H, tm, mode, P) {
      trunk(c, W, H, P, W*0.36);
      scene.paintWoodpecker(c, { x: W*0.52, y: H*0.55, s: 26, alpha: 1,
        color: P.col, rim: P.rim, deep: P.deep,
        sing: mode === "drum" ? pulse(tm) : 0, t: tm });
    } },
  oystercatcher: { sky: "day", modes: ["stand", "pipe", "walk"],
    draw(c, W, H, tm, mode, P) {
      const gy = H*0.8;
      sandBand(c, W, H, P, gy);
      scene.paintWader(c, { x: W*0.5, y: gy, s: 24, flip: false, alpha: 1,
        color: P.col, rim: P.rim, deep: P.deep,
        sing: mode === "pipe" ? pulse(tm) : 0, walking: mode === "walk", t: tm });
    } },
  frog: { sky: "dusk", modes: ["sit", "croak"],
    draw(c, W, H, tm, mode, P) {
      const gy = H*0.78;
      groundBand(c, W, H, P, gy);
      scene.paintFrog(c, { x: W*0.5, y: gy, s: 32, alpha: 1, color: P.colArr,
        bot: P.bot, sing: mode === "croak" ? pulse(tm*0.5) : 0, breath: 0, t: tm });
    } },
  gull: { sky: "day", modes: ["fly"],
    draw(c, W, H, tm, mode, P) {
      const ph = tm*5;
      const x = ((tm*55) % (W + 130)) - 65;
      scene.paintGullFlight(c, x, H*0.42 + Math.sin(ph*0.3)*6, 15, 1, ph, P.col);
    } },
  swift: { sky: "dusk", modes: ["fly"],
    draw(c, W, H, tm, mode, P) {
      const ph = tm*16;
      const x = ((tm*150) % (W + 150)) - 75;
      scene.paintSwiftFlight(c, x, H*0.42 + Math.sin(ph*0.5)*10, 13, 1, ph, P.col);
    } },
  skylark: { sky: "day", modes: ["song-flight"],
    draw(c, W, H, tm, mode, P) {
      const y = H*0.68 - ((tm*9) % (H*0.38));
      scene.paintLarkFlight(c, W*0.5 + Math.sin(tm)*8, y, 12, tm*22, P.col, true);
    } },
  kingfisher: { sky: "day", modes: ["watch", "call", "dive"],
    draw(c, W, H, tm, mode, P) {
      const wy = H*0.72;
      waterBand(c, W, H, P, wy);
      const ps = PSTYLE.kingfisher, s = 26*ps.sc;
      const px = W*0.42, py = H*0.42;
      scene.drawPerchFooting(c, px, py, s, "reed", P.bot, 1);
      let x = px, y = py, rot = 0, gone = false;
      if (mode === "dive") {
        const cyc = tm % 2.4;
        if (cyc > 0.8) {
          const ft = cyc - 0.8;
          rot = Math.min(1.35, ft*4);
          y = py + ft*ft*520;
          if (y > wy + 6) {
            gone = true;
            c.strokeStyle = `rgba(${scene.tok.foamRGB}, ${Math.max(0, 0.5 - (cyc - 1.5))})`;
            c.lineWidth = 1;
            c.beginPath(); c.ellipse(x, wy + 4, 12 + (cyc - 1.2)*18, 4, 0, 0, Math.PI*2); c.stroke();
          }
        }
      }
      if (!gone) {
        c.save(); c.translate(x, y); c.rotate(rot);
        scene.paintBird(c, { x: 0, y: 0, s, flip: false, alpha: 1,
          color: P.col, rim: P.rim, deep: P.deep, marks: ps,
          plump: ps.plump, tailLen: ps.tail, tailUp: false, billLen: ps.bill,
          sing: mode === "call" ? pulse(tm) : 0, breath: Math.sin(tm*2),
          headTurn: mode === "watch" ? Math.sin(tm*1.2)*0.3 : 0,
          tailFlick: 0, wingSettle: 0, fly: rot ? 1 : 0, flap: rot ? -0.4 : 0, t: tm });
        c.restore();
      }
    } },
  lapwing: { sky: "day", modes: ["stand", "call"],
    draw(c, W, H, tm, mode, P) {
      const gy = H*0.78;
      groundBand(c, W, H, P, gy);
      const ps = PSTYLE.lapwing;
      scene.drawPerchFooting(c, W*0.5, gy, 26, "ground", P.bot, 1);
      scene.paintBird(c, { x: W*0.5, y: gy, s: 26*ps.sc, flip: false, alpha: 1,
        color: P.col, rim: P.rim, deep: P.deep, marks: ps,
        plump: ps.plump, tailLen: 1.1, tailUp: false, billLen: ps.bill, crest: true,
        sing: mode === "call" ? pulse(tm) : 0, breath: Math.sin(tm*2),
        headTurn: Math.sin(tm*0.8)*0.2, tailFlick: 0, wingSettle: 0, fly: 0, flap: 0, t: tm });
    } },
  pheasant: { sky: "dawn", modes: ["strut", "crow", "flush"],
    draw(c, W, H, tm, mode, P) {
      const gy = H*0.8;
      groundBand(c, W, H, P, gy);
      let x = W*0.52, y = gy, fly = 0, flap = 0;
      if (mode === "flush") {
        const cyc = tm % 2.6;
        if (cyc < 0.18) y = gy + cyc*30;
        else {
          const u = cyc - 0.18;
          fly = Math.min(1, u/0.12); flap = Math.sin(cyc*30);
          y = gy - (0.24*u + 0.10*u*u)*420;
          x = W*0.52 + (0.05*u + 0.16*u*u)*420;
        }
      }
      scene.paintPheasant(c, { x, y, s: 34, flip: false, alpha: 1,
        color: P.col, rim: P.rim, deep: P.deep,
        sing: mode === "crow" ? pulse(tm*0.6) : 0,
        walking: mode === "strut", lp: tm*5, fly, flap, t: tm });
    } },
  moorhen: { sky: "day", modes: ["swim", "call"],
    draw(c, W, H, tm, mode, P) {
      const wy = H*0.6;
      waterBand(c, W, H, P, wy);
      scene.paintDuck(c, { x: W*0.5, y: wy + 24 + Math.sin(tm*1.3)*1.5, s: 22,
        flip: false, alpha: 1, color: P.col, rim: P.rim, deep: P.deep, moorhen: true,
        sing: mode === "call" ? pulse(tm) : 0, breath: 0, t: tm });
    } },
  littleegret: { sky: "day", modes: ["stand", "croak", "strike"],
    draw(c, W, H, tm, mode, P) {
      const wy = H*0.78;
      waterBand(c, W, H, P, wy);
      const cyc = tm % 2.2;
      const strike = mode !== "strike" ? 0
        : cyc < 0.16 ? cyc/0.16 : cyc < 0.30 ? 1 : cyc < 0.62 ? 1 - (cyc - 0.30)/0.32 : 0;
      scene.paintHeron(c, { x: W*0.5, y: wy, s: 36, dir: 1, flying: false, flap: 0,
        color: P.col, deep: P.deep, pale: true, neck: mode === "stand" ? 0.55 : 1,
        strike, sing: mode === "croak" ? pulse(tm*0.5) : 0, t: tm });
    } },
  tern: { sky: "day", modes: ["fly"],
    draw(c, W, H, tm, mode, P) {
      const ph = tm*7;
      const x = ((tm*70) % (W + 140)) - 70;
      scene.paintTernFlight(c, x, H*0.42 + Math.sin(ph*0.35)*8, 14, 1, ph, P.col);
    } },
  kestrel: { sky: "day", modes: ["hover", "glide"],
    draw(c, W, H, tm, mode, P) {
      if (mode === "hover") {
        scene.paintKestrelFlight(c, W*0.5 + Math.sin(tm*3.2)*2, H*0.4 + Math.sin(tm*2)*2,
          15, tm*15, P.col, true, 1);
      } else {
        const x = ((tm*80) % (W + 140)) - 70;
        scene.paintKestrelFlight(c, x, H*0.42, 15, tm*7, P.col, false, 1);
      }
    } },
  buzzard: { sky: "day", modes: ["soar"],
    draw(c, W, H, tm, mode, P) {
      const ang = tm*0.55;
      const x = W*0.5 + Math.cos(ang)*W*0.22, y = H*0.42 + Math.sin(ang)*H*0.12;
      scene.paintBuzzardSoar(c, x, y, 16, Math.sin(ang),
        -Math.sin(ang) >= 0 ? 1 : -1, P.col);
    } }
};

for (const sp of SPECIES) {
  const kind = SPECIAL[sp.id];
  const voiceOnly = ["cricket", "curlew"].includes(sp.id);
  CARDS.push({
    id: sp.id, sp, section: "species",
    name: sp.name, latin: sp.latin, desc: sp.desc,
    sky: kind ? kind.sky : "day",
    modes: voiceOnly ? [] : kind ? kind.modes : ["idle", "sing", "forage", "take off"],
    draw: voiceOnly ? null : kind ? kind.draw : perchDraw(sp.id),
    where: sp.habitats.map(h => ({ h, w: (sp.hw && sp.hw[h]) || 1 })),
    when: sp.weights,
    appears: voiceOnly
      ? "Voice only — heard from offstage, never drawn."
      : sp.layer === "air" ? "Crosses the open sky while it calls."
      : sp.id === "owl" ? "Takes a perch in the open after dusk; its eyes catch the light at night, and it leaves by tipping off the branch on soundless wings."
      : sp.id === "cuckoo" ? "On the skyline — a distant treetop or the far ridge — where it calls with wings drooped and tail cocked."
      : sp.id === "rooster" ? "Comes up over the brow of the hill from the farm on the far side, crows, patrols the ridge, and drops back out of sight."
      : sp.id === "mallard" ? "Afloat on the open water, drifting as it quacks and dabbles."
      : sp.id === "woodpecker" ? "Clings to a near trunk and drums against the wood."
      : sp.id === "oystercatcher" ? "On the wet sand, piping, then walking off along the tide line."
      : sp.id === "frog" ? "Down at the water's edge, swelling with each croak."
      : "Alights on a perch near its song — branch, reed, post or roof — sings, lingers, then slips away. On the ground it walks a little, works the turf for food, and flies off when it has had enough.",
    every: sp.base
  });
}

/* Ambient critters: no voices, spawned by the scene's own weather-and-hour
   logic (see spawnCritters); the notes below mirror those conditions. */
const CRITTERS = [
  { id: "deer", name: "Roe Deer", latin: "Capreolus capreolus",
    desc: "steps from the trees to graze, then melts away", sky: "dawn",
    modes: ["walk", "graze", "alert", "bound"], where: [{ h: "forest", w: 1 }],
    when: { dawn: 0.8, day: 0.05, dusk: 0.8, night: 0.15 },
    appears: "Rare — crosses the forest floor at first and last light, grazing, standing to listen, and bounding off if startled.",
    draw(c, W, H, tm, mode, P) {
      const gy = H*0.82;
      groundBand(c, W, H, P, gy);
      const bound = mode === "bound" ? Math.max(0, Math.sin(tm*7)) : 0;
      scene.paintDeer(c, { x: W*0.5, y: gy - bound*16, s: 34, dir: 1,
        head: mode === "graze" ? 1 : 0, walking: mode === "walk" || bound > 0, lp: tm*6,
        color: P.col, t: tm, grazing: mode === "graze",
        alert: mode === "alert", bound });
    } },
  { id: "fox", name: "Red Fox", latin: "Vulpes vulpes",
    desc: "trots the field edge between dusk and dawn", sky: "dusk",
    modes: ["trot", "listen", "sniff", "pounce"], where: [{ h: "meadow", w: 1 }, { h: "forest", w: 1 }],
    when: { dawn: 0.6, day: 0, dusk: 0.7, night: 0.6 },
    appears: "Trots through low ground after dusk, stopping to follow a scent or to listen with turned ears — and now and then going straight up and over in the mousing pounce, coming down nose-first.",
    draw(c, W, H, tm, mode, P) {
      const gy = H*0.82;
      groundBand(c, W, H, P, gy);
      const s = 30;
      const pose = { crouch: 0, lift: 0, rot: 0, air: 0 };
      if (mode === "listen") pose.crouch = 1;
      if (mode === "pounce") {
        // the same phases the scene itself runs, on a loop
        const u = tm % 3.4;
        if (u < 0.9) pose.crouch = Math.min(1, u*2);
        else if (u < 1.16) { pose.crouch = 1; pose.lift = Math.sin((u - 0.9)/0.26*Math.PI*0.5)*s*0.10; }
        else if (u < 1.88) {
          const k = (u - 1.16)/0.72;
          pose.air = Math.min(1, k*4);
          pose.lift = Math.sin(k*Math.PI)*s*1.55;
          pose.rot = -0.55 + k*1.85;
        } else if (u < 2.24) {
          pose.rot = 1.30 - (u - 1.88)*1.9;
          pose.air = Math.max(0, 1 - (u - 1.88)*4);
          pose.crouch = 1;
        } else { pose.crouch = 1; pose.rot = 0.60 + Math.sin(u*9)*0.06; }
      }
      scene.paintFox(c, Object.assign({ x: W*0.5, y: gy, s, dir: 1,
        walking: mode === "trot", lp: tm*7,
        ears: mode === "trot" || mode === "sniff" ? 0 : 1,
        sniff: mode === "sniff" ? 1 : 0,
        look: mode === "listen" ? Math.sin(tm*1.8)*0.3 : 0, color: P.col, t: tm }, pose));
    } },
  { id: "rabbit", name: "European Rabbit", latin: "Oryctolagus cuniculus",
    desc: "hops the meadow in fits and starts", sky: "day",
    modes: ["hop", "sit", "nibble", "wash"], where: [{ h: "meadow", w: 1 }],
    when: { dawn: 0.6, day: 0.6, dusk: 0.3, night: 0 },
    appears: "Crosses the meadow in calm daylight — hop, pause, hop — stopping to crop the grass or wash its face.",
    draw(c, W, H, tm, mode, P) {
      const gy = H*0.8;
      groundBand(c, W, H, P, gy);
      const hop = mode === "hop" ? Math.max(0, Math.sin(tm*7)) : 0;
      scene.paintRabbit(c, { x: W*0.5, y: gy - hop*16, s: 26, dir: 1,
        hop, sit: mode !== "hop", t: tm,
        ear: mode === "sit" ? Math.pow(Math.max(0, Math.sin(tm*0.9)), 8) : 0, color: P.col,
        nibble: mode === "nibble" ? 1 : 0,
        wash: mode === "wash" ? 0.5 + 0.5*Math.sin(tm*9) : 0 });
    } },
  { id: "cat", name: "House Cat", latin: "Felis catus",
    desc: "keeps its own hours on the rooftops", sky: "night",
    modes: ["walk", "sit", "groom", "stretch"], where: [{ h: "city", w: 1 }],
    when: { dawn: 0, day: 0, dusk: 0.2, night: 0.8 },
    appears: "Walks the city parapets after dark, sitting where it pleases, washing, and stretching the length of itself.",
    draw(c, W, H, tm, mode, P) {
      const gy = H*0.8;
      c.fillStyle = css(mix(scene.tok.inkDeep, P.bot, 0.10));
      c.fillRect(0, gy, W, H - gy);
      c.save();
      c.translate(W*0.5, gy); c.scale(3.2, 3.2);
      scene.paintCat(c, { x: 0, y: 0, dir: 1, sit: mode !== "walk", t: tm, color: P.col,
        groom: mode === "groom" ? 1 : 0,
        stretch: mode === "stretch" ? 0.5 + 0.5*Math.sin(tm*1.6) : 0 });
      c.restore();
    } },
  { id: "heron", name: "Grey Heron", latin: "Ardea cinerea",
    desc: "stands sentinel, then rows away on slow wings", sky: "day",
    modes: ["wait", "watch", "stalk", "strike", "preen", "fly"],
    where: [{ h: "wetland", w: 1 }, { h: "beach", w: 1 }],
    when: { dawn: 0.5, day: 0.6, dusk: 0.3, night: 0 },
    appears: "Waits at the water's edge by day — hunched, then drawn up to watch, a slow step, the strike and the swallow — and leaves low and unhurried when it's done.",
    draw(c, W, H, tm, mode, P) {
      const wy = H*0.78;
      waterBand(c, W, H, P, wy);
      if (mode === "fly") {
        const x = ((tm*45) % (W + 170)) - 85;
        scene.paintHeron(c, { x, y: H*0.42, s: 34, dir: 1, flying: true,
          flap: Math.sin(tm*3.4), color: P.col, deep: P.deep, t: tm });
        return;
      }
      const pose = { neck: 0.25, strike: 0, gulp: 0, step: 0, preen: 0 };
      if (mode === "watch") pose.neck = 1;
      else if (mode === "stalk") { pose.neck = 0.85; pose.step = (tm/1.7) % 1; }
      else if (mode === "preen") { pose.neck = 0.6; pose.preen = Math.sin((tm % 1.9)/1.9*Math.PI); }
      else if (mode === "strike") {
        pose.neck = 1;
        const u = tm % 2.6;
        if (u < 0.16) pose.strike = u/0.16;
        else if (u < 0.30) pose.strike = 1;
        else if (u < 0.62) pose.strike = 1 - (u - 0.30)/0.32;
        else if (u < 1.4) pose.gulp = (u - 0.62)/0.78;
      }
      scene.paintHeron(c, Object.assign({ x: W*0.5, y: wy, s: 36, dir: 1, flying: false,
        flap: 0, color: P.col, deep: P.deep, t: tm }, pose));
    } },
  { id: "porpoise", name: "Harbour Porpoise", latin: "Phocoena phocoena",
    desc: "an arched back and a breath, then gone", sky: "day",
    modes: ["breach"], where: [{ h: "beach", w: 1 }],
    when: { dawn: 0.5, day: 0.5, dusk: 0.5, night: 0.5 },
    appears: "Arcs through the offshore water in calm weather, any hour — rare and unhurried.",
    draw(c, W, H, tm, mode, P) {
      const wy = H*0.6;
      waterBand(c, W, H, P, wy);
      const x = ((tm*50) % (W + 130)) - 65;
      const ph = tm*1.8;
      const arc = Math.sin(ph);
      if (arc > 0.02) {
        scene.paintPorpoise(c, { x, y: wy, dir: 1, arc, pitch: Math.cos(ph)*0.34,
          s: 26, color: P.col, rim: P.rim });
      } else {
        const fp = Math.max(0, 1 + arc*1.6);
        const sub = Math.max(0, 1 + arc*3);
        if (sub > 0.02) {
          c.globalAlpha = 0.18*sub; c.fillStyle = P.col;
          c.beginPath(); c.ellipse(x, wy + 8, 30, 6, 0, 0, Math.PI*2); c.fill();
          c.globalAlpha = 1;
        }
        if (fp > 0.02) {
          c.strokeStyle = `rgba(${scene.tok.foamRGB}, ${0.26*fp})`; c.lineWidth = 1;
          c.beginPath(); c.ellipse(x - 16, wy, 15*(2 - fp), 4, 0, 0, Math.PI*2); c.stroke();
        }
      }
    } },
  { id: "bat", name: "Common Pipistrelle", latin: "Pipistrellus pipistrellus",
    desc: "a jinking scrap of night air", sky: "night",
    modes: ["hawk"], where: [{ h: "meadow", w: 1 }, { h: "forest", w: 1 }, { h: "wetland", w: 1 }, { h: "city", w: 1 }],
    when: { dawn: 0, day: 0, dusk: 0.3, night: 0.9 },
    appears: "Hawks the upper air on dry nights, everywhere but the open shore.",
    draw(c, W, H, tm, mode, P) {
      const x = W*0.5 + Math.sin(tm*1.3)*W*0.24 + Math.sin(tm*3.7)*8;
      const y = H*0.45 + Math.sin(tm*2.1)*18;
      scene.paintBat(c, x, y, 15, tm, P.col);
    } },
  { id: "butterfly", name: "Meadow Butterfly", latin: "Maniola jurtina",
    desc: "ambles through the warm hours on paper wings", sky: "day",
    modes: ["flutter"], where: [{ h: "meadow", w: 1 }, { h: "forest", w: 1 }],
    when: { dawn: 0.2, day: 0.9, dusk: 0.1, night: 0 },
    appears: "Drifts over the flowers in fine daytime weather.",
    draw(c, W, H, tm, mode, P) {
      c.save();
      c.translate(W*0.5 + Math.sin(tm*0.6)*26, H*0.5 + Math.sin(tm*1.9)*12);
      c.scale(2.6, 2.6);
      scene.paintButterfly(c, 0, 0, tm, 0, 1, P.col);
      c.restore();
    } },
  { id: "dragonfly", name: "Common Darter", latin: "Sympetrum striolatum",
    desc: "hangs in the air, then is somewhere else", sky: "day",
    modes: ["hover"], where: [{ h: "wetland", w: 1 }],
    when: { dawn: 0.2, day: 0.9, dusk: 0.2, night: 0 },
    appears: "Hovers and darts above the open water on dry days.",
    draw(c, W, H, tm, mode, P) {
      const wy = H*0.82;
      waterBand(c, W, H, P, wy);
      c.save();
      c.translate(W*0.5 + Math.sin(tm*0.9)*24, H*0.45 + Math.sin(tm*2.6)*6);
      c.scale(2.6, 2.6);
      scene.paintDragonfly(c, 0, 0, tm, P.col);
      c.restore();
    } },
  { id: "runner", name: "Sanderling", latin: "Calidris alba",
    desc: "chases the sea's hem back and forth", sky: "day",
    modes: ["dash", "probe"], where: [{ h: "beach", w: 1 }],
    when: { dawn: 0.6, day: 0.7, dusk: 0.5, night: 0 },
    appears: "Runs the tide line through the daylight hours in little bursts.",
    draw(c, W, H, tm, mode, P) {
      const gy = H*0.8;
      sandBand(c, W, H, P, gy);
      c.save();
      c.translate(W*0.5, gy); c.scale(3, 3);
      scene.paintSanderling(c, 0, 0, 1, mode === "dash", tm*30, P.col,
        mode === "probe" ? Math.max(0, Math.sin(tm*7)) : 0);
      c.restore();
    } },
  { id: "skein", name: "Greylag Skein", latin: "Anser anser",
    desc: "a wavering V, high and far off", sky: "dusk",
    modes: ["pass"], where: [{ h: "meadow", w: 1 }, { h: "forest", w: 1 }, { h: "beach", w: 1 }, { h: "wetland", w: 1 }, { h: "city", w: 1 }],
    when: { dawn: 0.8, day: 0.05, dusk: 0.8, night: 0.05 },
    appears: "Crosses any sky at dawn or dusk, in ragged formation.",
    draw(c, W, H, tm, mode, P) {
      const x0 = ((tm*26) % (W + 220)) - 110;
      c.save();
      c.translate(0, 0); c.scale(2, 2);
      c.strokeStyle = css(mix(scene.tok.ink, P.bot, 0.5));
      c.lineCap = "round";
      for (let k = 0; k < 7; k++) {
        const side = k % 2 === 0 ? 1 : -1;
        const rank = Math.ceil(k/2);
        scene.paintGoose(c, x0/2 - rank*11, H*0.22 + side*rank*7.4, 1, Math.sin(tm*7 + k));
      }
      c.restore();
    } },
  { id: "squirrel", name: "Red Squirrel", latin: "Sciurus vulgaris",
    desc: "bounds the litter, sits up, forgets where it buried it", sky: "day",
    modes: ["sit", "bound", "cache"], where: [{ h: "forest", w: 1 }],
    when: { dawn: 0.4, day: 0.8, dusk: 0.2, night: 0 },
    appears: "Crosses the forest floor in fine daylight, pausing upright to nibble — and digs a hole, drops a nut in, noses it down and pats the litter back over it.",
    draw(c, W, H, tm, mode, P) {
      const gy = H*0.82;
      groundBand(c, W, H, P, gy);
      const hopY = mode === "bound" ? Math.abs(Math.sin(tm*9))*8 : 0;
      let dig = 0, bury = 0, pat = 0;
      if (mode === "cache") {
        const u = tm % 4.4;
        if (u < 0.5) dig = u/0.5;
        else if (u < 2.3) dig = 1;
        else if (u < 3.0) { dig = 1; bury = (u - 2.3)/0.7; }
        else if (u < 3.7) { dig = 1 - (u - 3.0)/0.7; pat = 1; }
      }
      scene.paintSquirrel(c, { x: W*0.5, y: gy - hopY, s: 26, dir: 1,
        sit: mode === "sit", ph: tm*9, t: tm, dig, bury, pat, color: P.col });
    } },
  { id: "hare", name: "Brown Hare", latin: "Lepus europaeus",
    desc: "long legs and longer ears at the field edge", sky: "dawn",
    modes: ["lope", "alert", "graze"], where: [{ h: "meadow", w: 1 }],
    when: { dawn: 0.7, day: 0.5, dusk: 0.7, night: 0.1 },
    appears: "Lopes the open meadow at first and last light, drawn up tall when it stops.",
    draw(c, W, H, tm, mode, P) {
      const gy = H*0.82;
      groundBand(c, W, H, P, gy);
      const st = mode === "lope" ? 0.5 + 0.5*Math.sin(tm*8) : 0;
      const lift = mode === "lope" ? Math.max(0, Math.sin(tm*8))*7 : 0;
      scene.paintHare(c, { x: W*0.5, y: gy - lift, s: 30, dir: 1, t: tm,
        hop: st, alert: mode === "alert", graze: mode === "graze" ? 1 : 0, color: P.col });
    } },
  { id: "hedgehog", name: "European Hedgehog", latin: "Erinaceus europaeus",
    desc: "a shuffling dome of spines, nose down", sky: "night",
    modes: ["shuffle", "sniff up"], where: [{ h: "meadow", w: 1 }, { h: "forest", w: 1 }, { h: "city", w: 1 }],
    when: { dawn: 0.1, day: 0, dusk: 0.3, night: 0.9 },
    appears: "Works the ground after dark, snuffling as it goes.",
    draw(c, W, H, tm, mode, P) {
      const gy = H*0.84;
      groundBand(c, W, H, P, gy);
      scene.paintHedgehog(c, { x: W*0.5, y: gy, s: 26, dir: 1,
        t: mode === "shuffle" ? tm : 0.1, color: P.col, rim: P.rim,
        sniffUp: mode === "sniff up" ? 1 : 0 });
    } },
  { id: "badger", name: "European Badger", latin: "Meles meles",
    desc: "trundles its night rounds, striped and certain", sky: "night",
    modes: ["trundle", "dig"], where: [{ h: "forest", w: 1 }],
    when: { dawn: 0.1, day: 0, dusk: 0.3, night: 0.9 },
    appears: "Rare — crosses the forest floor deep in the night, head down.",
    draw(c, W, H, tm, mode, P) {
      const gy = H*0.84;
      groundBand(c, W, H, P, gy);
      scene.paintBadger(c, { x: W*0.5, y: gy, s: 34, dir: 1, lp: tm*5, color: P.col,
        dig: mode === "dig" ? 0.5 + 0.5*Math.sin(tm*11) : 0 });
    } },
  { id: "otter", name: "Eurasian Otter", latin: "Lutra lutra",
    desc: "threads the water, dives, surfaces further on", sky: "day",
    modes: ["swim", "roll"], where: [{ h: "wetland", w: 1 }],
    when: { dawn: 0.7, day: 0.5, dusk: 0.7, night: 0.2 },
    appears: "Swims the open water outside the darkest hours, diving and resurfacing.",
    draw(c, W, H, tm, mode, P) {
      const wy = H*0.6;
      waterBand(c, W, H, P, wy);
      scene.paintOtter(c, { x: W*0.5 + Math.sin(tm*0.5)*20, y: wy + 20, s: 26,
        dir: 1, ph: tm*3, color: P.col, roll: mode === "roll" ? 1 : 0 });
    } },
  { id: "bee", name: "Bumblebee", latin: "Bombus terrestris",
    desc: "a furred knot of purpose among the flowers", sky: "day",
    modes: ["work"], where: [{ h: "meadow", w: 1 }, { h: "forest", w: 1 }],
    when: { dawn: 0.2, day: 0.9, dusk: 0.1, night: 0 },
    appears: "Works the flowers in warm, calm daylight.",
    draw(c, W, H, tm, mode, P) {
      const gy = H*0.86;
      groundBand(c, W, H, P, gy);
      scene.paintBee(c, W*0.5 + Math.sin(tm*0.8)*30, H*0.6 + Math.sin(tm*2.1)*14 + Math.sin(tm*14)*2,
        7, tm, P.col);
    } }
];
for (const cr of CRITTERS) {
  if (CRITTER_VOICES[cr.id]) cr.cv = CRITTER_VOICES[cr.id];
  CARDS.push(Object.assign({ section: "critters", sp: null }, cr));
}

/* ---- build the cards ---- */
const HOURS = ["dawn", "day", "dusk", "night"];
const registry = [];   // { card, canvas, ctx, mode, modeStart }

function buildCard(card) {
  const el = document.createElement("article");
  el.className = "bz-card";
  const entry = { card, mode: card.modes[0] || null, modeStart: performance.now() };

  if (card.draw) {
    const cv = document.createElement("canvas");
    el.appendChild(cv);
    entry.canvas = cv;
    entry.ctx = cv.getContext("2d");
  } else {
    const v = document.createElement("div");
    v.className = "bz-voiceonly";
    v.innerHTML = card.sp ? speciesIcon(card.sp, 56) : "";
    el.appendChild(v);
  }

  const title = document.createElement("div");
  title.className = "bz-title";
  title.innerHTML = `<span class="bz-icon">${speciesIcon(card.sp || { id: card.id }, 20)}</span>`
    + `<span>${card.name}</span><span class="latin">${card.latin}</span>`;
  el.appendChild(title);

  const desc = document.createElement("p");
  desc.className = "bz-desc";
  desc.textContent = card.desc;
  el.appendChild(desc);

  const controls = document.createElement("div");
  controls.className = "bz-row";
  if (card.modes.length > 1) {
    const lbl = document.createElement("span");
    lbl.className = "lbl"; lbl.textContent = "animation";
    controls.appendChild(lbl);
    for (const m of card.modes) {
      const b = document.createElement("button");
      b.type = "button"; b.className = "bz-mode"; b.textContent = m;
      b.setAttribute("aria-pressed", m === entry.mode ? "true" : "false");
      b.addEventListener("click", () => {
        entry.mode = m; entry.modeStart = performance.now();
        controls.querySelectorAll(".bz-mode").forEach(x =>
          x.setAttribute("aria-pressed", x.textContent === m ? "true" : "false"));
        if (REDUCED) renderEntry(entry, performance.now());
      });
      controls.appendChild(b);
    }
  }
  const voiced = card.sp || card.cv;
  if (voiced) {
    const b = document.createElement("button");
    b.type = "button"; b.className = "bz-voice"; b.textContent = "▶ voice";
    b.addEventListener("click", () => playVoice(voiced, b));
    controls.appendChild(b);
  }
  if (controls.children.length) el.appendChild(controls);

  // when — hour weighting as small bars
  const when = document.createElement("div");
  when.className = "bz-row";
  const wrap = document.createElement("div");
  wrap.className = "bz-hourwrap";
  for (const h of HOURS) {
    const col = document.createElement("div");
    col.className = "bz-hourcol";
    const bar = document.createElement("div");
    bar.className = "bar";
    bar.style.height = Math.round(2 + (card.when[h] || 0)*22) + "px";
    bar.title = `${h}: ${Math.round((card.when[h] || 0)*100)}%`;
    const tick = document.createElement("div");
    tick.className = "tick"; tick.textContent = h;
    col.appendChild(bar); col.appendChild(tick);
    wrap.appendChild(col);
  }
  when.innerHTML = '<span class="lbl">when</span>';
  when.appendChild(wrap);
  el.appendChild(when);

  // where — habitat chips, faded when the species is rarer there
  const where = document.createElement("div");
  where.className = "bz-row";
  where.innerHTML = '<span class="lbl">where</span>';
  for (const { h, w } of card.where) {
    const chip = document.createElement("span");
    chip.className = "bz-chip" + (w < 0.7 ? " faded" : "");
    chip.textContent = h + (w < 0.7 ? " (rarer)" : "");
    where.appendChild(chip);
  }
  el.appendChild(where);

  const note = document.createElement("p");
  note.className = "bz-note";
  note.innerHTML = `<strong>Appears:</strong> ${card.appears}`
    + (card.every ? ` <strong>·</strong> tries a call about every ${card.every}s.` : "");
  el.appendChild(note);

  entry.el = el;          // the studio marks the card it is tuning
  registry.push(entry);
  return el;
}

const spGrid = document.getElementById("bz-species");
const crGrid = document.getElementById("bz-critters");
for (const card of CARDS) {
  (card.section === "species" ? spGrid : crGrid).appendChild(buildCard(card));
}

/* ---- render loop: only cards in view are painted ---- */
const visible = new Set();
const io = new IntersectionObserver((ents) => {
  for (const e of ents) {
    const entry = registry.find(r => r.canvas === e.target);
    if (!entry) continue;
    if (e.isIntersecting) visible.add(entry); else visible.delete(entry);
  }
}, { rootMargin: "80px" });
for (const r of registry) if (r.canvas) io.observe(r.canvas);

const dpr = Math.min(window.devicePixelRatio || 1, 2);
function renderEntry(entry, now) {
  const { card, canvas, ctx } = entry;
  if (!canvas) return;
  const w = canvas.clientWidth || 220, h = canvas.clientHeight || 150;
  if (canvas.width !== w*dpr) { canvas.width = w*dpr; canvas.height = h*dpr; }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const sky = card.id === "owl" && entry.mode === "night" ? "night" : card.sky;
  const P = PAL[sky];
  skyFill(ctx, w, h, P, sky);
  const tm = REDUCED ? 1.1 : (now - entry.modeStart)/1000;
  card.draw(ctx, w, h, tm, entry.mode, P);
}
function frame(now) {
  for (const entry of visible) renderEntry(entry, now);
  /* Whatever the studio has under the lamp stays live even when it is not in
     view. Opening the panel reflows the grid, which can carry the very card you
     just clicked off the screen — and a bench that freezes the thing you are
     tuning is worse than no bench. */
  if (tuning && !visible.has(tuning)) renderEntry(tuning, now);
  if (!REDUCED) requestAnimationFrame(frame);
}
if (REDUCED) {
  // honour reduced motion: a still of each card, refreshed on interaction
  registry.forEach(r => renderEntry(r, performance.now()));
} else {
  requestAnimationFrame(frame);
}

/* ---- theme toggle, mirroring main.js ---- */
document.getElementById("bz-theme").addEventListener("click", () => {
  const isLight = document.documentElement.getAttribute("data-theme") === "light";
  if (isLight) document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", "light");
  buildPalettes();
  if (REDUCED) registry.forEach(r => renderEntry(r, performance.now()));
});

/* ============================================================
   The studio — a bench for tuning how the creatures look and move.

   Two tables drive the birds: PSTYLE, which carries each species' marks (how
   long a bill, how plump a body, whether it has a cap or a wingbar), and ANIM,
   which carries the rates and depths of the idle motion they all share. Both
   are plain data, and perchDraw reads them afresh on every frame — so editing
   the table *is* editing the bird, with nothing to rebuild and nothing to wire.

   Every control below is generated from the data rather than written out by
   hand. Add a mark to a species in species.js and a control for it appears
   here on its own; add a rate to ANIM and the same. The ranges come from the
   spread of the values themselves across all the species, so a slider for
   `bill` covers the range of real bills and not some invented nought-to-one.

   What it cannot reach: the eighteen birds with their own painters (the owl,
   the cuckoo, the pheasant and the rest) and every mammal keep their shapes as
   literal numbers inside the painting code, with no table to stand between.
   The studio says so plainly rather than offering sliders that would move
   nothing. Motion is shared by all of them, so that half still applies.
   ============================================================ */

const SHIPPED = { pstyle: JSON.parse(JSON.stringify(PSTYLE)), anim: { ...ANIM } };
const STORE = "lw.bestiary.studio";      // the bestiary only: never read by the piece
const TONES = ["", "amber", "sage"];

/* The observed spread of each numeric mark across every species, which is a
   better range for a slider than anything invented. */
const SPREAD = (() => {
  const out = {};
  for (const row of Object.values(SHIPPED.pstyle)) {
    for (const [k, v] of Object.entries(row)) {
      if (typeof v !== "number") continue;
      const s = out[k] || (out[k] = { min: v, max: v });
      s.min = Math.min(s.min, v); s.max = Math.max(s.max, v);
    }
  }
  for (const s of Object.values(out)) {
    const pad = Math.max(0.1, (s.max - s.min) * 0.6);
    s.lo = Math.max(0, +(s.min - pad).toFixed(2));
    s.hi = +(s.max + pad).toFixed(2);
  }
  return out;
})();
/* Every mark any species uses, so one that has none can still be given one. */
const ALL_MARKS = [...new Set(Object.values(SHIPPED.pstyle).flatMap(Object.keys))].sort();

function loadSaved() {
  try {
    const raw = localStorage.getItem(STORE);
    if (!raw) return;
    const saved = JSON.parse(raw);
    for (const [id, row] of Object.entries(saved.pstyle || {})) {
      PSTYLE[id] = { ...(PSTYLE[id] || {}), ...row };
      for (const [k, v] of Object.entries(row)) if (v === null) delete PSTYLE[id][k];
    }
    Object.assign(ANIM, saved.anim || {});
  } catch (e) { console.warn("studio: could not read saved edits —", e.message); }
}
function save() {
  const pstyle = {};
  for (const [id, row] of Object.entries(PSTYLE)) {
    const base = SHIPPED.pstyle[id] || {};
    const diff = {};
    for (const k of new Set([...Object.keys(base), ...Object.keys(row)])) {
      if (row[k] !== base[k]) diff[k] = k in row ? row[k] : null;
    }
    if (Object.keys(diff).length) pstyle[id] = diff;
  }
  const anim = {};
  for (const [k, v] of Object.entries(ANIM)) if (v !== SHIPPED.anim[k]) anim[k] = v;
  const any = Object.keys(pstyle).length || Object.keys(anim).length;
  try {
    if (any) localStorage.setItem(STORE, JSON.stringify({ pstyle, anim }));
    else localStorage.removeItem(STORE);
  } catch (e) { /* private mode, or a full quota: the edits simply won't outlive the tab */ }
  return { pstyle, anim };
}
loadSaved();

/* ---- control builders. Each returns a row and reports its own changes. ---- */
function fieldRow(label, control, valueEl) {
  const row = document.createElement("div");
  row.className = "bz-f" + (valueEl ? "" : " bool");
  const l = document.createElement("label");
  l.textContent = label;
  row.append(l, control);
  if (valueEl) row.append(valueEl);
  return row;
}
function numberField(label, obj, key, lo, hi, shipped, onChange) {
  const val = document.createElement("span");
  val.className = "val";
  const input = document.createElement("input");
  input.type = "range";
  input.min = lo; input.max = hi;
  input.step = (hi - lo) > 6 ? 0.1 : 0.01;
  input.value = obj[key];
  const paint = () => {
    val.textContent = (+obj[key]).toFixed(input.step === "0.1" ? 1 : 2);
    row.classList.toggle("changed", obj[key] !== shipped);
  };
  input.addEventListener("input", () => { obj[key] = +input.value; paint(); onChange(); });
  const row = fieldRow(label, input, val);
  paint();
  return row;
}
function boolField(label, obj, key, shipped, onChange) {
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = !!obj[key];
  const row = fieldRow(label, input, null);
  const paint = () => row.classList.toggle("changed", !!obj[key] !== !!shipped);
  input.addEventListener("change", () => { obj[key] = input.checked; paint(); onChange(); });
  paint();
  return row;
}
function toneField(label, obj, key, shipped, onChange) {
  const sel = document.createElement("select");
  for (const t of TONES) {
    const o = document.createElement("option");
    o.value = t; o.textContent = t || "—";
    sel.appendChild(o);
  }
  sel.value = obj[key] || "";
  const row = fieldRow(label, sel, null);
  const paint = () => row.classList.toggle("changed", (obj[key] || "") !== (shipped || ""));
  sel.addEventListener("change", () => {
    if (sel.value) obj[key] = sel.value; else delete obj[key];
    paint(); onChange();
  });
  paint();
  return row;
}

/* ---- the panel ---- */
const stWho = document.getElementById("bz-st-who");
const stHint = document.getElementById("bz-st-hint");
const stMarks = document.getElementById("bz-st-marks");
const stMotion = document.getElementById("bz-st-motion");
const stOut = document.getElementById("bz-st-out");
let tuning = null;                        // the entry currently under the lamp

const touched = () => {
  const { pstyle, anim } = save();
  stOut.value = sourceFor(pstyle, anim);
  if (REDUCED) registry.forEach(r => renderEntry(r, performance.now()));
};

/* What to paste back into species.js, in the formatting species.js already
   uses — a row per species, and ANIM's changed rates. */
function sourceFor(pstyleDiff, animDiff) {
  const lines = [];
  const lit = (v) => typeof v === "string" ? `"${v}"` : String(v);
  for (const id of Object.keys(pstyleDiff)) {
    const row = PSTYLE[id];
    const body = Object.entries(row).map(([k, v]) => `${k}: ${lit(v)}`).join(", ");
    lines.push(`  ${id}: { ${body} },`);
  }
  if (Object.keys(animDiff).length) {
    if (lines.length) lines.push("");
    lines.push("// ANIM — changed values only");
    for (const [k, v] of Object.entries(animDiff)) lines.push(`  ${k}: ${v},`);
  }
  return lines.length ? lines.join("\n") : "No edits yet.";
}

function buildMarks(id, name, latin) {
  stMarks.innerHTML = "";
  stWho.innerHTML = `${name} <span class="latin">${latin || ""}</span>`;
  const editable = !!SHIPPED.pstyle[id];
  if (!editable) {
    stHint.textContent = "This one is drawn by its own painter, with its shape "
      + "written as numbers in the painting code — there is no table of marks to "
      + "tune. The motion below still applies to it.";
    return;
  }
  stHint.textContent = "Marks come from PSTYLE. Changes show at once, here and in the window.";
  const row = PSTYLE[id], base = SHIPPED.pstyle[id];
  const h = document.createElement("h3");
  h.textContent = "Marks";
  stMarks.appendChild(h);

  const keys = [...new Set([...Object.keys(base), ...Object.keys(row)])].sort();
  for (const k of keys) {
    const v = k in row ? row[k] : base[k];
    if (typeof v === "number") {
      const sp = SPREAD[k] || { lo: 0, hi: Math.max(1, v * 2) };
      stMarks.appendChild(numberField(k, row, k, sp.lo, sp.hi, base[k], touched));
    } else if (typeof v === "boolean") {
      stMarks.appendChild(boolField(k, row, k, base[k], touched));
    } else {
      stMarks.appendChild(toneField(k, row, k, base[k], touched));
    }
  }

  // and anything this species has not got yet
  const spare = ALL_MARKS.filter(k => !(k in row));
  if (spare.length) {
    const wrap = document.createElement("div");
    wrap.className = "bz-st-add";
    const sel = document.createElement("select");
    sel.innerHTML = `<option value="">add a mark…</option>`
      + spare.map(k => `<option value="${k}">${k}</option>`).join("");
    const add = document.createElement("button");
    add.type = "button"; add.textContent = "add";
    add.addEventListener("click", () => {
      const k = sel.value;
      if (!k) return;
      // take the shape of the value from whatever the other species use for it
      const sample = Object.values(SHIPPED.pstyle).find(r => k in r)[k];
      row[k] = typeof sample === "number" ? (SPREAD[k] ? +((SPREAD[k].min + SPREAD[k].max) / 2).toFixed(2) : 1)
             : typeof sample === "boolean" ? true : "amber";
      touched();
      buildMarks(id, name, latin);
    });
    wrap.append(sel, add);
    stMarks.appendChild(wrap);
  }
}

function buildMotion() {
  stMotion.innerHTML = "";
  const h = document.createElement("h3");
  h.textContent = "Motion — shared by every bird";
  stMotion.appendChild(h);
  for (const k of Object.keys(SHIPPED.anim)) {
    const base = SHIPPED.anim[k];
    const hi = k.endsWith("Sharp") ? 16 : Math.max(1, +(base * 3).toFixed(2));
    stMotion.appendChild(numberField(k, ANIM, k, 0, hi, base, touched));
  }
}

function selectEntry(entry) {
  if (tuning && tuning.el) tuning.el.classList.remove("tuning");
  tuning = entry;
  if (entry.el) entry.el.classList.add("tuning");
  buildMarks(entry.card.id, entry.card.name, entry.card.latin);
  buildMotion();
  touched();
  document.body.classList.add("studio-open");
  document.getElementById("bz-studio-toggle").setAttribute("aria-expanded", "true");
  // The panel has just narrowed the grid; keep the subject where it can be seen.
  if (entry.el) entry.el.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

for (const r of registry) {
  if (!r.canvas) continue;
  r.canvas.addEventListener("click", () => selectEntry(r));
}

document.getElementById("bz-studio-toggle").addEventListener("click", () => {
  const open = document.body.classList.toggle("studio-open");
  document.getElementById("bz-studio-toggle").setAttribute("aria-expanded", String(open));
  if (open && !tuning) { buildMotion(); touched(); }
});
document.getElementById("bz-st-close").addEventListener("click", () => {
  document.body.classList.remove("studio-open");
  document.getElementById("bz-studio-toggle").setAttribute("aria-expanded", "false");
});
document.getElementById("bz-st-copy").addEventListener("click", async (e) => {
  const btn = e.currentTarget, was = btn.textContent;
  try { await navigator.clipboard.writeText(stOut.value); btn.textContent = "copied"; }
  catch (err) { stOut.select(); btn.textContent = "select + copy"; }
  setTimeout(() => { btn.textContent = was; }, 1400);
});
document.getElementById("bz-st-reset").addEventListener("click", () => {
  if (!tuning) return;
  const id = tuning.card.id;
  if (SHIPPED.pstyle[id]) {
    for (const k of Object.keys(PSTYLE[id])) delete PSTYLE[id][k];
    Object.assign(PSTYLE[id], SHIPPED.pstyle[id]);
  }
  selectEntry(tuning);
});
document.getElementById("bz-st-resetall").addEventListener("click", () => {
  for (const [id, base] of Object.entries(SHIPPED.pstyle)) {
    for (const k of Object.keys(PSTYLE[id])) delete PSTYLE[id][k];
    Object.assign(PSTYLE[id], base);
  }
  Object.assign(ANIM, SHIPPED.anim);
  if (tuning) selectEntry(tuning); else { buildMotion(); touched(); }
});
