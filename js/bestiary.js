/* ============================================================
   The Bestiary — a field bench for the window's wildlife.
   A developer tool, separate from the piece: it borrows the
   Scene's painters and the species' synths so every creature
   can be inspected at close range — each animation state on
   demand, each voice on a button, and field notes on when
   (hour weights) and where (habitats) it appears.
   ============================================================ */
import { Scene } from "./scene.js";
import { SPECIES, PSTYLE, speciesIcon } from "./species.js";
import { mulberry32, parseColor, css, mix, themeVar, REDUCED } from "./util.js";

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
const pulse = (t) => 0.3 + 0.7*Math.abs(Math.sin(t*11));

/* ---- the card catalogue ---- */
/* Perched songbirds share one draw, differing only in PSTYLE marks. */
function perchDraw(id) {
  return (c, W, H, tm, mode, P) => {
    const ps = PSTYLE[id] || {};
    const s = 30*(ps.sc || 1);
    const cx = W*0.46, gy = H*0.74;
    let sing = 0, fly = 0, flap = 0, x = cx, y = gy, alpha = 1;
    if (mode === "sing") sing = pulse(tm);
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
    scene.drawPerchFooting(c, cx, gy, s, "branch", P.bot, alpha*(1 - fly));
    scene.paintBird(c, {
      x, y, s, flip: false, alpha, color: P.col, rim: P.rim, deep: P.deep, marks: ps,
      plump: ps.plump || 1, tailLen: ps.tail || 1.1, tailUp: !!ps.tailUp,
      billLen: ps.bill || 0.45, crest: false, sing,
      breath: Math.sin(tm*2),
      headTurn: Math.sin(tm*0.8)*0.2 + Math.pow(Math.max(0, Math.sin(tm*0.5)), 6)*0.5,
      tailFlick: Math.pow(Math.max(0, Math.sin(tm*1.15)), 8),
      wingSettle: 0, fly, flap, t: tm
    });
  };
}

const CARDS = [];
/* kinds for the species that have their own painters or flight forms */
const SPECIAL = {
  owl: { sky: "dusk", modes: ["watch", "night"],
    draw(c, W, H, tm, mode, P) {
      const gy = H*0.78;
      scene.drawPerchFooting(c, W*0.5, gy, 26, "branch", P.bot, 1);
      scene.paintOwl(c, { x: W*0.5, y: gy, s: 26, alpha: 1, color: P.col, rim: P.rim,
        deep: P.deep, night: mode === "night" ? 1 : 0, t: tm,
        headTurn: Math.sin(tm*0.5)*0.5, blinkPh: 0 });
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
    } }
};

for (const sp of SPECIES) {
  const kind = SPECIAL[sp.id];
  const voiceOnly = ["cricket", "cuckoo", "curlew", "rooster"].includes(sp.id);
  CARDS.push({
    id: sp.id, sp, section: "species",
    name: sp.name, latin: sp.latin, desc: sp.desc,
    sky: kind ? kind.sky : "day",
    modes: voiceOnly ? [] : kind ? kind.modes : ["idle", "sing", "take off"],
    draw: voiceOnly ? null : kind ? kind.draw : perchDraw(sp.id),
    where: sp.habitats.map(h => ({ h, w: (sp.hw && sp.hw[h]) || 1 })),
    when: sp.weights,
    appears: voiceOnly
      ? "Voice only — heard from offstage, never drawn."
      : sp.layer === "air" ? "Crosses the open sky while it calls."
      : sp.id === "owl" ? "Takes a perch in the open after dusk; its eyes catch the light at night."
      : sp.id === "mallard" ? "Afloat on the open water, drifting as it quacks and dabbles."
      : sp.id === "woodpecker" ? "Clings to a near trunk and drums against the wood."
      : sp.id === "oystercatcher" ? "On the wet sand, piping, then walking off along the tide line."
      : sp.id === "frog" ? "Down at the water's edge, swelling with each croak."
      : "Alights on a perch near its song — branch, reed, post or roof — sings, lingers, then slips away.",
    every: sp.base
  });
}

/* Ambient critters: no voices, spawned by the scene's own weather-and-hour
   logic (see spawnCritters); the notes below mirror those conditions. */
const CRITTERS = [
  { id: "deer", name: "Roe Deer", latin: "Capreolus capreolus",
    desc: "steps from the trees to graze, then melts away", sky: "dawn",
    modes: ["walk", "graze"], where: [{ h: "forest", w: 1 }],
    when: { dawn: 0.8, day: 0.05, dusk: 0.8, night: 0.15 },
    appears: "Rare — crosses the forest floor at first and last light, pausing to graze.",
    draw(c, W, H, tm, mode, P) {
      const gy = H*0.82;
      groundBand(c, W, H, P, gy);
      scene.paintDeer(c, { x: W*0.5, y: gy, s: 34, dir: 1,
        head: mode === "graze" ? 1 : 0, walking: mode === "walk", lp: tm*6,
        color: P.col, t: tm, grazing: mode === "graze" });
    } },
  { id: "fox", name: "Red Fox", latin: "Vulpes vulpes",
    desc: "trots the field edge between dusk and dawn", sky: "dusk",
    modes: ["trot", "listen"], where: [{ h: "meadow", w: 1 }, { h: "forest", w: 1 }],
    when: { dawn: 0.6, day: 0, dusk: 0.7, night: 0.6 },
    appears: "Trots through low ground after dusk, pausing to listen with turned ears.",
    draw(c, W, H, tm, mode, P) {
      const gy = H*0.82;
      groundBand(c, W, H, P, gy);
      scene.paintFox(c, { x: W*0.5, y: gy, s: 30, dir: 1,
        walking: mode === "trot", lp: tm*7,
        look: mode === "listen" ? Math.sin(tm*1.8) : 0, color: P.col, t: tm });
    } },
  { id: "rabbit", name: "European Rabbit", latin: "Oryctolagus cuniculus",
    desc: "hops the meadow in fits and starts", sky: "day",
    modes: ["hop", "sit"], where: [{ h: "meadow", w: 1 }],
    when: { dawn: 0.6, day: 0.6, dusk: 0.3, night: 0 },
    appears: "Crosses the meadow in daylight when the weather is calm — hop, pause, hop.",
    draw(c, W, H, tm, mode, P) {
      const gy = H*0.8;
      groundBand(c, W, H, P, gy);
      const hop = mode === "hop" ? Math.max(0, Math.sin(tm*7)) : 0;
      scene.paintRabbit(c, { x: W*0.5, y: gy - hop*16, s: 26, dir: 1,
        hop, sit: mode === "sit",
        ear: mode === "sit" ? Math.pow(Math.max(0, Math.sin(tm*0.9)), 8) : 0, color: P.col });
    } },
  { id: "cat", name: "House Cat", latin: "Felis catus",
    desc: "keeps its own hours on the rooftops", sky: "night",
    modes: ["walk", "sit"], where: [{ h: "city", w: 1 }],
    when: { dawn: 0, day: 0, dusk: 0.2, night: 0.8 },
    appears: "Walks the city parapets after dark, sitting a while where it pleases.",
    draw(c, W, H, tm, mode, P) {
      const gy = H*0.8;
      c.fillStyle = css(mix(scene.tok.inkDeep, P.bot, 0.10));
      c.fillRect(0, gy, W, H - gy);
      c.save();
      c.translate(W*0.5, gy); c.scale(3.2, 3.2);
      scene.paintCat(c, { x: 0, y: 0, dir: 1, sit: mode === "sit", t: tm, color: P.col });
      c.restore();
    } },
  { id: "heron", name: "Grey Heron", latin: "Ardea cinerea",
    desc: "stands sentinel, then rows away on slow wings", sky: "day",
    modes: ["stand", "fly"], where: [{ h: "wetland", w: 1 }, { h: "beach", w: 1 }],
    when: { dawn: 0.5, day: 0.6, dusk: 0.3, night: 0 },
    appears: "Waits at the water's edge by day; leaves low and unhurried when it's done.",
    draw(c, W, H, tm, mode, P) {
      const wy = H*0.78;
      waterBand(c, W, H, P, wy);
      if (mode === "fly") {
        const x = ((tm*45) % (W + 170)) - 85;
        scene.paintHeron(c, { x, y: H*0.42, s: 34, dir: 1, flying: true,
          flap: Math.sin(tm*3.4), color: P.col, t: tm });
      } else {
        scene.paintHeron(c, { x: W*0.5, y: wy, s: 36, dir: 1, flying: false,
          flap: 0, color: P.col, t: tm });
      }
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
      const arc = Math.sin(tm*1.8);
      const keepH = scene.H;
      scene.H = 330;
      if (arc > 0.03) {
        scene.paintPorpoise(c, { x, y: wy - arc*14, dir: 1, arc, color: P.col });
      } else if (arc > -0.25) {
        c.strokeStyle = `rgba(${scene.tok.foamRGB}, 0.3)`; c.lineWidth = 1;
        c.beginPath(); c.ellipse(x, wy, 10, 3, 0, 0, Math.PI*2); c.stroke();
      }
      scene.H = keepH;
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
    modes: ["dash", "pause"], where: [{ h: "beach", w: 1 }],
    when: { dawn: 0.6, day: 0.7, dusk: 0.5, night: 0 },
    appears: "Runs the tide line through the daylight hours in little bursts.",
    draw(c, W, H, tm, mode, P) {
      const gy = H*0.8;
      sandBand(c, W, H, P, gy);
      c.save();
      c.translate(W*0.5, gy); c.scale(3, 3);
      scene.paintSanderling(c, 0, 0, 1, mode === "dash", tm*30, P.col);
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
    } }
];
for (const cr of CRITTERS) CARDS.push(Object.assign({ section: "critters", sp: null }, cr));

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
  title.innerHTML = (card.sp ? `<span class="bz-icon">${speciesIcon(card.sp, 20)}</span>` : "")
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
  if (card.sp) {
    const b = document.createElement("button");
    b.type = "button"; b.className = "bz-voice"; b.textContent = "▶ voice";
    b.addEventListener("click", () => playVoice(card.sp, b));
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
