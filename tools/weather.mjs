/* The sky, the alarm and the hour.

   Three things this checks, none of which a still screenshot would show:

   1. The weather drifts on its own, plausibly, and every dial moves smoothly
      — the largest single-frame step is the number that matters, because a
      hard cut is exactly what this replaced.
   2. Something coming through empties the frame, shuts the land up, and lets
      it back gradually rather than all at once.
   3. The hour is audible: the beds and the chorus differ between noon and
      the small hours, and dawn is the loudest part of the day. */
import { chromium } from 'playwright';
import { chromiumPath } from './lib/browser.mjs';
const URL = (process.env.BENCH_URL || 'http://127.0.0.1:8123/') + '?perf=1';
const b = await chromium.launch({ ...chromiumPath(), args: ['--use-gl=swiftshader', '--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
const page = await b.newPage({ viewport: { width: 1100, height: 700 } });
const errs = [];
page.on('pageerror', e => errs.push(e.message));
page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
await page.goto(URL, { waitUntil: 'networkidle' });
await page.click('#beginBtn');
await page.waitForTimeout(1200);

const out = await page.evaluate(async () => {
  const { audio, scene, state } = window.__lw;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const log = [];

  /* ---- 1. the sky comes over, and does it smoothly ---- */
  state.weatherFlow = true;
  state.location = 'meadow'; state.weather = 'clear';
  scene.reseed(state.seed); audio.applyConditions();
  await sleep(400);
  // Drive the weather by hand through every pairing and watch each dial: the
  // drift itself is minutes long, and what matters is the size of a step.
  let worstStep = 0, worstAt = '';
  const names = ['clear', 'breeze', 'rain', 'fog'];
  for (const from of names) {
    for (const to of names) {
      if (from === to) continue;
      state.weather = from;
      for (let i = 0; i < 120; i++) await sleep(8);   // settle at the corner
      state.weather = to;
      let prev = { ...state.wx };
      for (let i = 0; i < 260; i++) {
        await sleep(8);
        for (const k of ['wet', 'haze', 'gust']) {
          const step = Math.abs(state.wx[k] - prev[k]);
          if (step > worstStep) { worstStep = step; worstAt = `${from}->${to} ${k}`; }
        }
        prev = { ...state.wx };
      }
    }
  }
  log.push(`largest single-frame step in any dial: ${worstStep.toFixed(4)}  (${worstAt})`);

  // and that it picks a new weather on its own, plausibly
  state.weather = 'clear'; state.weatherFlow = true;
  const seen = {}; let changes = 0, last = 'clear';
  const oldSpeed = state.timeSpeed;
  state.timeSpeed = 400;                    // a day's worth of sky in a moment
  for (let i = 0; i < 900; i++) {
    await sleep(6);
    if (state.weather !== last) { changes++; seen[last + '->' + state.weather] = 1; last = state.weather; }
  }
  state.timeSpeed = oldSpeed;
  log.push(`weather changed ${changes} times unattended; transitions seen: `
    + Object.keys(seen).sort().join(', '));

  /* ---- 2. something comes through ---- */
  state.weatherFlow = false;
  state.weather = 'clear'; state.time = 'dawn';
  state.location = 'meadow'; scene.reseed(state.seed); audio.applyConditions();
  await sleep(2500);
  // let the meadow fill up first
  const { SPECIES } = await import('/js/species.js?v=23');
  const perch = SPECIES.filter(s => s.layer === 'perch' && s.habitats.includes('meadow'));
  for (let i = 0; i < 8; i++) { audio.performCall(perch[i % perch.length]); await sleep(150); }
  await sleep(1800);
  const before = scene.actors.length;
  audio.alarmAt = 0;              // a fox may have come through unbidden already
  const curveBefore = audio.chorusCurve();
  /* Clear any alarm that happened on its own first: with one already
     standing, the repeat guard turns this one away and the test measures
     nothing. Then ask until one is taken up — half go unremarked by design. */
  audio.alarmAt = 0;
  for (let i = 0; i < 20 && !audio.alarmAt; i++) audio.alarm(0.4, 'fox');
  await sleep(500);
  const staying = scene.actors.filter(a => !a.leave).length;
  const curveDuring = audio.chorusCurve();
  log.push(`alarm: ${before} on the perches, ${before - staying} went, ${staying} stayed`);
  log.push(`chorus  before ${curveBefore.toFixed(2)}   during ${curveDuring.toFixed(2)}`
    + `   settle ${audio.settle().toFixed(2)}`);
  // and it comes back gradually, not at once
  const back = [];
  for (const at of [17, 25, 35, 48]) {
    audio.alarmAt = performance.now() - at*1000;
    back.push(`${at}s ${audio.settle().toFixed(2)}`);
  }
  audio.alarmAt = 0;
  log.push(`coming back: ${back.join('  ')}`);

  /* ---- 3. the hour is audible ----
     Every bed is a setTargetAtTime, so a reading taken straight after
     applyConditions is a number on its way somewhere. Four seconds is five
     time constants: what is read here is where it actually settles. */
  const rows = [];
  for (const hour of ['dawn', 'day', 'dusk', 'night']) {
    state.time = hour;
    scene.timeMix = { dawn: 0, day: 0, dusk: 0, night: 0 };
    scene.timeMix[hour] = 1;
    state.location = 'city'; audio.applyConditions();
    await sleep(4000);
    rows.push(`${hour.padEnd(6)} wind ${audio.windBase.toFixed(4)}`
      + `  traffic ${audio.trafficGain.gain.value.toFixed(4)}`
      + `  voice LP ${String(Math.round(audio.voiceFilter.frequency.value)).padStart(5)} Hz`
      + `  chorus ×${(audio.chorusCurve()).toFixed(2)}`);
  }

  /* And what that is actually worth in voices. The chorus curve is only a
     coefficient; this counts calls that really happened, per hour, which is
     the number that says whether dawn sounds like dawn. */
  /* At the default density the land is deliberately sparse — one voice every
     ten seconds or so — which is too coarse to read an hour against. Turned
     up, the same curve resolves. */
  const dens = [];
  state.location = 'meadow'; state.activity = 1;
  scene.onAlarm = null;          // a fox mid-window would zero the whole count
  /* And the tide has to be taken out. Over the curve's own four-to-seven
     minute swing, four hours measured back to back each land on a different
     phase of it — which moved dawn from 74% to 30% between runs and said
     nothing about dawn. Shortening the period to twenty seconds puts several
     whole cycles inside every window, so each hour is measured against the
     same average tide and what is left is the hour itself. */
  audio.chorusPh = 0; audio.chorusPeriod = 20;
  for (const hour of ['dawn', 'day', 'dusk', 'night']) {
    state.time = hour;
    scene.timeMix = { dawn: 0, day: 0, dusk: 0, night: 0 };
    scene.timeMix[hour] = 1;
    scene.reseed(state.seed); audio.applyConditions();
    audio.alarmAt = 0; audio.quietUntil = 0;
    /* Neutralise the slow tide. It runs on a four-to-seven-minute period, so
       a seventy-five second window samples whatever part of it happens to be
       passing — which swung dawn from 1.03 voices to 0.32 between runs that
       changed nothing. Wound right up, several whole cycles fall inside the
       window and average out, leaving the hour as the only term moving. */
    audio.chorusPeriod = 9;
    /* Counting calls to performCall counts attempts, and an attempt that is
       turned away at the voice cap sounds like nothing at all. What a listener
       hears is how many voices are going and how much of the time any are, so
       that is what is sampled. */
    let sum = 0, n = 0, busy = 0;
    for (let i = 0; i < 750; i++) {
      sum += audio.activeVoices; if (audio.activeVoices > 0) busy++; n++;
      await sleep(100);
    }
    dens.push(`${hour.padEnd(6)} mean ${(sum/n).toFixed(2)} voices`
      + `   ${Math.round(busy/n*100)}% of the time something is calling`
      + `   [curve ×${audio.chorusCurve().toFixed(2)}]`);
  }
  return { log, rows, dens, actors: scene.actors.length };
});
await b.close();
for (const l of out.log) console.log('  ' + l);
console.log('');
for (const r of out.rows) console.log('  ' + r);
console.log('');
for (const d of out.dens) console.log('  ' + d);
console.log(errs.length ? '\n  ERRORS:\n    ' + errs.slice(0, 6).join('\n    ')
  : '\n  clean');
process.exit(errs.length ? 1 : 0);
