/* ============================================================
   Main — the entry point. Wires the DOM to the scene and the
   audio engine, owns the theme toggle and the subtitle/field-
   note surface, and boots everything once the module loads.
   ============================================================ */
import { state, sessionSerial, LOCATIONS } from "./util.js";
import { speciesIcon } from "./species.js";
import { Scene } from "./scene.js";
import { AudioEngine } from "./audio.js";

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

/* ---- Subtitles & field notes ---- */
const captionCard = document.getElementById("captionCard");
const capIcon = document.getElementById("capIcon");
const capName = document.getElementById("capName");
const capLatin = document.getElementById("capLatin");
const capDesc = document.getElementById("capDesc");
const capDir = document.getElementById("capDir");
const notesPanel = document.getElementById("notesPanel");
const notesEmpty = document.getElementById("notesEmpty");
let capTimer = null;

function direction(az, depth) {
  const side = az < -0.28 ? "off to the left" : az > 0.28 ? "off to the right" : "straight ahead";
  const d = depth < 6 ? "close" : depth < 14 ? "mid-field" : "far off";
  return side + " \u00b7 " + d;
}

function addNote(sp, time) {
  notesEmpty.style.display = "none";
  const row = document.createElement("div");
  row.className = "note-row";
  const tm = document.createElement("span");
  tm.className = "note-time"; tm.textContent = time;
  const ic = document.createElement("span");
  ic.className = "note-icon" + (sp.tone === "sage" ? " sage" : "");
  ic.innerHTML = speciesIcon(sp, 15);
  const nm = document.createElement("span");
  nm.className = "note-species"; nm.textContent = sp.name;
  const ds = document.createElement("span");
  ds.className = "note-desc"; ds.textContent = sp.desc;
  row.append(tm, ic, nm, ds);
  notesPanel.prepend(row);
  const rows = notesPanel.querySelectorAll(".note-row");
  if (rows.length > 6) rows[rows.length - 1].remove();
}

function emitSubtitle(sp, az, depth, dur) {
  const time = new Date().toTimeString().slice(0, 5);
  addNote(sp, time);
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

function wireSegmented(el, cb) {
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

wireSegmented(document.getElementById("timeSeg"), (v) => { state.time = v; });
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

document.getElementById("diceBtn").addEventListener("click", () => {
  const others = LOCATIONS.filter(l => l !== state.location);
  setLocation(others[Math.floor(Math.random()*others.length)]);
});

const activitySlider = document.getElementById("activitySlider");
const activityVal = document.getElementById("activityVal");
activitySlider.addEventListener("input", () => {
  state.activity = activitySlider.value / 100;
  activityVal.textContent = activitySlider.value;
});
const volumeSlider = document.getElementById("volumeSlider");
const volumeVal = document.getElementById("volumeVal");
volumeSlider.addEventListener("input", () => {
  state.volume = volumeSlider.value / 100;
  volumeVal.textContent = volumeSlider.value;
  audio.setVolume(state.volume);
});

function wireMiniSwitch(el, key, cb) {
  el.addEventListener("click", () => {
    state[key] = !state[key];
    el.setAttribute("aria-checked", String(state[key]));
    if (cb) cb(state[key]);
  });
}
wireMiniSwitch(document.getElementById("spatialSwitch"), "spatial");
wireMiniSwitch(document.getElementById("subsSwitch"), "subtitles", (on) => {
  if (!on) captionCard.classList.remove("visible");
});

const beginOverlay = document.getElementById("beginOverlay");
const pauseBtn = document.getElementById("pauseBtn");
document.getElementById("beginBtn").addEventListener("click", async () => {
  beginOverlay.classList.add("hidden");
  pauseBtn.disabled = false;
  state.listening = true;
  await audio.start();
});
pauseBtn.addEventListener("click", () => {
  if (audio.running) {
    audio.pause();
    pauseBtn.textContent = "Resume";
  } else {
    audio.resume();
    pauseBtn.textContent = "Pause";
  }
});

document.getElementById("reseedBtn").addEventListener("click", () => {
  state.seed = (Math.random() * 0xFFFFFFFF) >>> 0;
  document.getElementById("sessionNo").textContent = sessionSerial(state.seed);
  scene.reseed(state.seed);
  audio.retune();
  audio.quietUntil = 0;
});

const windowFrame = document.getElementById("windowFrame");
document.getElementById("fsBtn").addEventListener("click", () => {
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
settingsBtn.addEventListener("click", openSettings);
settingsClose.addEventListener("click", closeSettings);
settingsOverlay.addEventListener("click", (e) => {
  if (e.target === settingsOverlay) closeSettings();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !settingsOverlay.classList.contains("hidden")) closeSettings();
});

if (matchMedia("(prefers-color-scheme: light)").matches) applyTheme("light");
else applyTheme("dark");
