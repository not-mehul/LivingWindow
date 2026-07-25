/* ============================================================
   Main — the entry point. Wires the DOM to the scene and the
   audio engine, owns the theme toggle, the casement (opening
   and shutting the window), the turning of the hours, and the
   subtitles. Boots everything once the module loads.
   ============================================================ */
import { state, sessionSerial, LOCATIONS } from "./util.js?v=3";
import { speciesIcon } from "./species.js?v=3";
import { Scene } from "./scene.js?v=3";
import { AudioEngine } from "./audio.js?v=3";

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
let capTimer = null;

function direction(az, depth) {
  const side = az < -0.28 ? "off to the left" : az > 0.28 ? "off to the right" : "straight ahead";
  const d = depth < 6 ? "close" : depth < 14 ? "mid-field" : "far off";
  return side + " \u00b7 " + d;
}

function emitSubtitle(sp, az, depth, dur) {
  if (!state.subtitles) return;
  capIcon.innerHTML = speciesIcon(sp, 18);
  capIcon.classList.toggle("sage", sp.tone === "sage");
  capName.textContent = sp.name;
  capLatin.textContent = sp.latin;
  capDesc.textContent = sp.desc;
  capDir.textContent = direction(az, depth);
  captionCard.classList.add("visible");
  clearTimeout(capTimer);
  capTimer = setTimeout(() => captionCard.classList.remove("visible"),
    Math.max(2600, (dur || 1)*1000 + 1600));
}

/* ---- Wiring ---- */
const scene = new Scene(document.getElementById("scene"));
const audio = new AudioEngine({ scene, emit: emitSubtitle });

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
  audio.applyConditions();
});
function setLocation(v) {
  state.location = v;
  scene.reseed(state.seed);
  audio.applyConditions();
  audio.quietUntil = 0;
  syncSeg(document.getElementById("placeSeg"), v);
}
wireSegmented(document.getElementById("placeSeg"), setLocation);

/* Somewhere else, at some other hour. */
on("diceBtn", "click", () => {
  const others = LOCATIONS.filter(l => l !== state.location);
  setLocation(others[Math.floor(Math.random()*others.length)]);
  const hours = PHASES.filter(h => h !== state.time);
  setTime(hours[Math.floor(Math.random()*hours.length)]);
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

function wireMiniSwitch(id, key, cb) {
  const el = on(id, "click", () => {
    state[key] = !state[key];
    el.setAttribute("aria-checked", String(state[key]));
    if (cb) cb(state[key]);
  });
}
wireMiniSwitch("spatialSwitch", "spatial");
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

setInterval(() => {
  const now = performance.now();
  const dt = now - lastTick;
  lastTick = now;
  if (!state.timeFlow || !windowOpen || dt > 5000) return;   // no time passes while shut
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
