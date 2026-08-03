/* ============================================================
   Main — the entry point. Wires the DOM to the scene and the
   audio engine, owns the theme toggle, the casement (opening
   and shutting the window), the turning of the hours, and the
   subtitles. Boots everything once the module loads.
   ============================================================ */
import { state, sessionSerial, LOCATIONS, holdWeather } from "./util.js?v=15";
import { speciesIcon } from "./species.js?v=15";
import { Scene } from "./scene.js?v=15";
import { AudioEngine } from "./audio.js?v=15";

/* ---- Theme ---- */
const themeSwitch = document.getElementById("themeSwitch");
function applyTheme(mode) {
  if (mode === "light") document.documentElement.setAttribute("data-theme", "light");
  else document.documentElement.removeAttribute("data-theme");
  const isLight = mode === "light";
  themeSwitch.setAttribute("aria-checked", String(isLight));
  themeSwitch.setAttribute("aria-label", isLight ? "Switch to dark theme" : "Switch to light theme");
  document.getElementById("iconMoon").classList.toggle("active", !isLight);
  document.getElementById("iconSun").classList.toggle("active", isLight);
  scene.refreshTokens();
}
themeSwitch.addEventListener("click", () => {
  const isLight = document.documentElement.getAttribute("data-theme") === "light";
  applyTheme(isLight ? "dark" : "light");
});

/* ---- Session number ---- */
document.getElementById("sessionNo").textContent = sessionSerial(state.seed);

/* ---- Subtitles ---- */
const captionCard = document.getElementById("captionCard");
const capIcon = document.getElementById("capIcon");
const capName = document.getElementById("capName");
const capLatin = document.getElementById("capLatin");
const capDesc = document.getElementById("capDesc");
const capDir = document.getElementById("capDir");
let capTimer = null, capFrame = 0, capShown = null;

function direction(az, depth) {
  const side = az < -0.28 ? "off to the left" : az > 0.28 ? "off to the right" : "straight ahead";
  const d = depth < 6 ? "close" : depth < 14 ? "mid-field" : "far off";
  return side + " \u00b7 " + d;
}

/* Each pictogram is parsed once and kept. Setting innerHTML to a string of SVG
   builds a document fragment from scratch every time, and this ran at the exact
   instant a call began sounding. */
const capIcons = new Map();
function iconFor(sp) {
  let n = capIcons.get(sp.id);
  if (!n) {
    const holder = document.createElement("span");
    holder.innerHTML = speciesIcon(sp, 18);
    n = holder.firstElementChild;
    capIcons.set(sp.id, n);
  }
  return n;
}

/* The caption is the one piece of DOM that moves while the piece is running,
   and it used to be written on the same tick the sound started: an SVG parse
   and a style recalculation, landing inside the window in which the audio
   graph is also being built. That is enough to make the render thread miss a
   buffer, which is heard as the beds stuttering just before a bird sings.
   Nothing here needs to be exact to the millisecond, so it waits for the
   browser's own next frame \u2014 and does no work at all if the same species is
   already up, which happens whenever a bird sings twice. */
function emitSubtitle(sp, az, depth, dur) {
  if (!state.subtitles) return;
  clearTimeout(capTimer);
  capTimer = setTimeout(() => {
    captionCard.classList.remove("visible"); capShown = null;
  }, Math.max(2600, (dur || 1)*1000 + 1600));
  if (capFrame) cancelAnimationFrame(capFrame);
  capFrame = requestAnimationFrame(() => {
    capFrame = 0;
    if (capShown !== sp.id) {
      capIcon.replaceChildren(iconFor(sp));
      capIcon.classList.toggle("sage", sp.tone === "sage");
      capName.textContent = sp.name;
      capLatin.textContent = sp.latin;
      capDesc.textContent = sp.desc;
      capShown = sp.id;
    }
    capDir.textContent = direction(az, depth);
    captionCard.classList.add("visible");
  });
}

/* ---- Wiring ---- */
const scene = new Scene(document.getElementById("scene"), document.getElementById("sky"));
const audio = new AudioEngine({ scene, emit: emitSubtitle });
/* The scene knows a fox has walked in; the engine decides what is said about
   it and how long the silence afterwards runs. Nothing else couples them. */
scene.onAlarm = (x, cause) => audio.alarm(x, cause);

/* Put the scene and the engine where a harness can reach them. Comparing
   pictures can tell you the land still looks like the land; it cannot tell
   you a deer still decides to graze at the same moment. For that you need to
   read the animals themselves.

   Two flags, because they are two different needs. `?perf=1` also turns on
   the on-screen readout, which is exactly what a bench must not have — it
   wraps every drawing call a second time and paints a panel over the land.
   `?hook=1` is the hook alone, so the frame bench can hold the hour and the
   weather still without driving the settings panel: the card scrolls, and a
   forced click at a stale coordinate lands on the casement. */
const flags = new URLSearchParams(location.search);
if (flags.has("perf") || flags.has("hook")) {
  window.__lw = { scene, audio, state };
}

/* Bind a handler by id, tolerating an element that isn't there. A stale
   cached script against fresh markup used to throw here and take every
   later control down with it; now the odd missing control is just missing. */
function on(id, evt, fn) {
  const el = document.getElementById(id);
  if (!el) { console.warn("The Living Window: no #" + id + " to wire."); return null; }
  el.addEventListener(evt, fn);
  return el;
}

function wireSegmented(el, cb) {
  if (!el) return;
  el.addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    el.querySelectorAll("button").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    cb(btn.dataset.val);
  });
}
function syncSeg(el, val) {
  el.querySelectorAll("button").forEach(b =>
    b.classList.toggle("active", b.dataset.val === val));
}

wireSegmented(document.getElementById("timeSeg"), (v) => { setTime(v); });
wireSegmented(document.getElementById("weatherSeg"), (v) => {
  state.weather = v;
  holdWeather();              // a weather asked for gets its full span
  audio.applyConditions();
});
function setLocation(v) {
  state.location = v;
  scene.clearLife();          // the old place's company doesn't come along
  scene.reseed(state.seed);
  audio.applyConditions();
  audio.quietUntil = 0;
  syncSeg(document.getElementById("placeSeg"), v);
}
wireSegmented(document.getElementById("placeSeg"), setLocation);

/* Somewhere else, at some other hour — and a land never seen before.
   A fresh seed is what makes it new ground rather than the same meadow
   this session has always had, so the serial in the header follows it. */
on("diceBtn", "click", () => {
  state.seed = (Math.random() * 0xFFFFFFFF) >>> 0;
  const el = document.getElementById("sessionNo");
  if (el) el.textContent = sessionSerial(state.seed);
  const others = LOCATIONS.filter(l => l !== state.location);
  setLocation(others[Math.floor(Math.random()*others.length)]);   // reseeds the land
  const hours = PHASES.filter(h => h !== state.time);
  setTime(hours[Math.floor(Math.random()*hours.length)]);
  audio.retune();             // the aeolian strings are tuned from the seed
});

const activitySlider = document.getElementById("activitySlider");
const activityVal = document.getElementById("activityVal");
on("activitySlider", "input", () => {
  state.activity = activitySlider.value / 100;
  activityVal.textContent = activitySlider.value;
});
const volumeSlider = document.getElementById("volumeSlider");
const volumeVal = document.getElementById("volumeVal");
on("volumeSlider", "input", () => {
  state.volume = volumeSlider.value / 100;
  volumeVal.textContent = volumeSlider.value;
  audio.setVolume(state.volume);
});

/* The mix. Each slider is a plain coefficient the engine multiplies into every
   level in its group, so a group at zero costs nothing rather than being
   turned down: the schedulers check it before they build anything at all. */
for (const [id, key] of [["mixBirds", "birds"], ["mixWeather", "weather"],
                         ["mixWater", "water"], ["mixTown", "town"],
                         ["mixMusic", "music"]]) {
  const el = document.getElementById(id);
  const val = document.getElementById(id + "Val");
  if (!el) continue;
  el.value = Math.round(state.mix[key]*100);
  if (val) val.textContent = el.value;
  el.addEventListener("input", () => {
    state.mix[key] = el.value / 100;
    if (val) val.textContent = el.value;
    audio.applyMix();
  });
}

function wireMiniSwitch(id, key, cb) {
  const el = on(id, "click", () => {
    state[key] = !state[key];
    el.setAttribute("aria-checked", String(state[key]));
    if (cb) cb(state[key]);
  });
}
wireMiniSwitch("spatialSwitch", "spatial");

/* The occasional sounds — the ones somebody might not want at all. */
for (const [id, key] of [["thunderSwitch", "thunder"], ["bellSwitch", "bell"],
                         ["musicSwitch", "music"]]) {
  const el = document.getElementById(id);
  if (!el) continue;
  el.setAttribute("aria-checked", String(state.cue[key]));
  el.addEventListener("click", () => {
    state.cue[key] = !state.cue[key];
    el.setAttribute("aria-checked", String(state.cue[key]));
    audio.applyMix();
  });
}
wireMiniSwitch("subsSwitch", "subtitles", (on2) => {
  if (!on2) captionCard.classList.remove("visible");
});

/* ---- The turning of the hours ----
   Left to itself the light moves on: dawn to day to dusk to night and round
   again, an hour of the day every half hour at the ordinary pace. The clock
   only runs while the window is open — a shut window keeps no time. */
const PHASES = ["dawn", "day", "dusk", "night"];
const PHASE_MS = 30 * 60 * 1000;
let phaseElapsed = 0;
let lastTick = performance.now();

function setTime(v) {
  state.time = v;
  phaseElapsed = 0;                       // a chosen hour gets its full span
  syncSeg(document.getElementById("timeSeg"), v);
}

/* The scene steps the weather every frame, because that is what has to look
   smooth. The engine only needs to hear about it now and then: every bed level
   is a setTargetAtTime with a second or more of time constant, so re-applying
   at one hertz is already finer-grained than anything it does. It is skipped
   entirely while the sky is holding still, which is most of the time. */
let lastWx = { wet: -1, haze: -1, gust: -1 }, lastNight = -1, lastWeather = null;
function followWeather() {
  const wx = state.wx;
  const night = scene.nightness();
  const moved = Math.abs(wx.wet - lastWx.wet) + Math.abs(wx.haze - lastWx.haze)
              + Math.abs(wx.gust - lastWx.gust) + Math.abs(night - lastNight)*0.5;
  if (moved < 0.004) return;
  lastWx = { wet: wx.wet, haze: wx.haze, gust: wx.gust };
  lastNight = night;
  audio.applyConditions();
  // and the buttons show where the sky actually went, not what was last asked
  if (state.weather !== lastWeather) {
    lastWeather = state.weather;
    syncSeg(document.getElementById("weatherSeg"), state.weather);
  }
}

setInterval(() => {
  const now = performance.now();
  const dt = now - lastTick;
  lastTick = now;
  if (!windowOpen || dt > 5000) return;          // no time passes while shut
  followWeather();
  if (!state.timeFlow) return;
  phaseElapsed += dt * state.timeSpeed;
  if (phaseElapsed >= PHASE_MS) {
    phaseElapsed = 0;
    setTime(PHASES[(PHASES.indexOf(state.time) + 1) % PHASES.length]);
  }
}, 1000);

const timeSpeedSlider = document.getElementById("timeSpeedSlider");
const timeSpeedVal = document.getElementById("timeSpeedVal");
const timeSpeedRow = document.getElementById("timeSpeedRow");
function applyTimeSpeed() {
  if (!timeSpeedSlider) return;
  // a gentle exponential either side of the ordinary half-hour
  state.timeSpeed = Math.pow(2, (timeSpeedSlider.value - 50) / 15);
  const mins = 30 / state.timeSpeed;
  if (timeSpeedVal) {
    timeSpeedVal.textContent = mins >= 90 ? (mins/60).toFixed(1).replace(/\.0$/, "") + " h"
      : mins >= 1 ? Math.round(mins) + " min"
      : Math.round(mins*60) + " s";
  }
}
on("timeSpeedSlider", "input", applyTimeSpeed);
applyTimeSpeed();

wireMiniSwitch("timeFlowSwitch", "timeFlow", (running) => {
  phaseElapsed = 0;
  if (timeSpeedRow) timeSpeedRow.classList.toggle("disabled", !running);
});
wireMiniSwitch("weatherFlowSwitch", "weatherFlow", () => holdWeather());

/* ---- The casement ---- */
const windowFrame = document.getElementById("windowFrame");
const beginOverlay = document.getElementById("beginOverlay");
let windowOpen = false;
let closing = null;

async function openWindow() {
  if (windowOpen) return;
  clearTimeout(closing);
  windowOpen = true;
  state.listening = true;
  // Every opening is a new session: a fresh seed, an empty land, its own serial.
  state.seed = (Math.random() * 0xFFFFFFFF) >>> 0;
  document.getElementById("sessionNo").textContent = sessionSerial(state.seed);
  phaseElapsed = 0;
  lastTick = performance.now();
  scene.clearLife();
  scene.reseed(state.seed);
  scene.setActive(true);
  beginOverlay.classList.add("hidden");
  windowFrame.classList.remove("closed");
  if (!audio.ac) await audio.start();
  else { audio.retune(); audio.applyConditions(); audio.quietUntil = 0; audio.resume(); }
}

function closeWindow() {
  if (!windowOpen) return;
  windowOpen = false;
  state.listening = false;
  audio.pause();                       // silence at once, and the schedulers stop
  captionCard.classList.remove("visible");
  clearTimeout(capTimer);
  windowFrame.classList.add("closed");
  beginOverlay.classList.remove("hidden");
  if (document.fullscreenElement) document.exitFullscreen();
  // Let the leaves swing shut over the land before stopping the world behind them.
  closing = setTimeout(() => {
    scene.setActive(false);
    scene.clearLife();
  }, 1200);
}

on("beginBtn", "click", openWindow);
on("closeWinBtn", "click", closeWindow);
on("fsBtn", "click", () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else if (windowFrame.requestFullscreen) windowFrame.requestFullscreen();
});

const settingsOverlay = document.getElementById("settingsOverlay");
const settingsBtn = document.getElementById("settingsBtn");
const settingsClose = document.getElementById("settingsClose");
function openSettings() {
  settingsOverlay.classList.remove("hidden");
  settingsClose.focus();
}
function closeSettings() {
  settingsOverlay.classList.add("hidden");
  settingsBtn.focus();
}
on("settingsBtn", "click", openSettings);
on("settingsClose", "click", closeSettings);
on("settingsOverlay", "click", (e) => {
  if (e.target === settingsOverlay) closeSettings();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !settingsOverlay.classList.contains("hidden")) closeSettings();
});

if (matchMedia("(prefers-color-scheme: light)").matches) applyTheme("light");
else applyTheme("dark");

// The window starts shut: the land behind it is still, and costs nothing.
scene.setActive(false);
