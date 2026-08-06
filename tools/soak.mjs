/* A long run at the busiest the piece gets, watching for anything that grows
   and for the output ever clipping. Nothing is hushed and nothing is faked:
   this is the piece running. */
import { chromium } from 'playwright';
import { chromiumPath } from './lib/browser.mjs';
const b = await chromium.launch({ ...chromiumPath(), args: ['--use-gl=swiftshader', '--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
const page = await b.newPage({ viewport: { width: 1280, height: 720 } });
const errs = []; page.on('pageerror', e => errs.push(e.message));
page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
await page.goto('http://127.0.0.1:8123/?hook=1', { waitUntil: 'networkidle' });
await page.click('#beginBtn');
await page.waitForTimeout(1500);
const out = await page.evaluate(async () => {
  const { audio, scene, state } = window.__lw;
  const ac = audio.ac;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const an = ac.createAnalyser(); an.fftSize = 2048; an.smoothingTimeConstant = 0;
  audio.comp.connect(an);
  const buf = new Float32Array(2048);
  state.activity = 1; state.location = 'city'; state.weather = 'rain';
  state.weatherFlow = false; state.timeSpeed = 12;
  scene.reseed(state.seed); audio.applyConditions();
  const rows = [];
  let peak = 0, clipped = 0, next = 0, alarms = 0;
  const t0 = performance.now();
  while (performance.now() - t0 < 90000) {
    an.getFloatTimeDomainData(buf);
    for (let i = 0; i < buf.length; i++) {
      const a = Math.abs(buf[i]);
      if (a > peak) peak = a;
      if (a >= 0.999) clipped++;
    }
    const el = (performance.now() - t0)/1000;
    if (el >= next) {
      next += 15;
      rows.push(`${String(Math.round(el)).padStart(6)}${String(audio.timers.size).padStart(8)}`
        + `${String(audio.live.size).padStart(6)}${String(audio.hrtfLive).padStart(6)}`
        + `${String(audio.activeVoices).padStart(8)}${String(scene.actors.length).padStart(8)}`
        + `${String(scene.critters.length).padStart(9)}`);
    }
    if (Math.random() < 0.012) { audio.alarm(Math.random(), 'fox'); alarms++; }
    await sleep(40);
  }
  return { rows, peak, clipped, alarms };
});
await b.close();
console.log('   t(s)  timers  live  hrtf  voices  actors  critters');
for (const r of out.rows) console.log(r);
console.log(`\n  output peak ${(20*Math.log10(out.peak)).toFixed(1)} dBFS, clipped samples ${out.clipped}`);
console.log(errs.length ? '  ERRORS:\n    ' + errs.slice(0, 6).join('\n    ') : '  clean');
process.exit(errs.length || out.clipped ? 1 : 0);
