/* The balance as a listener meets it: everything, at the master output, after
   the limiter. The steady level of the place with nothing calling, and then
   the peak a call reaches over it. Tapping the buses separately was a way to
   measure something that is not what anybody hears.

   One species — the crow, which lives in all five places — is called in every
   one of them, so the numbers compare like with like. Picking whatever perch
   bird a place happened to have was measuring the species, not the room. */
import { chromium } from 'playwright';
import { chromiumPath } from './lib/browser.mjs';
const URL = (process.env.BENCH_URL || 'http://127.0.0.1:8123/') + '?hook=1';
const b = await chromium.launch({ ...chromiumPath(), args: ['--use-gl=swiftshader', '--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
const page = await b.newPage({ viewport: { width: 900, height: 560 } });
page.on('pageerror', e => console.log('ERR', e.message));
await page.goto(URL, { waitUntil: 'networkidle' });
await page.click('#beginBtn');
await page.waitForTimeout(1500);
const rows = await page.evaluate(async () => {
  const { audio, scene, state } = window.__lw;
  const { SPECIES } = await import('/js/species.js?v=23');
  const ac = audio.ac;
  const an = ac.createAnalyser(); an.fftSize = 2048; an.smoothingTimeConstant = 0;
  audio.comp.connect(an);
  const buf = new Float32Array(2048);
  const meas = () => { an.getFloatTimeDomainData(buf);
    let s = 0, pk = 0;
    for (let i = 0; i < buf.length; i++) { s += buf[i]*buf[i];
      const a = Math.abs(buf[i]); if (a > pk) pk = a; }
    return [Math.sqrt(s/buf.length), pk]; };
  const dB = v => v < 1e-7 ? -140 : 20*Math.log10(v);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const ref = SPECIES.find(s => s.id === 'crow');
  state.weatherFlow = false; state.timeFlow = false;
  const out = [];
  for (const [loc, wx] of [['meadow','clear'],['meadow','breeze'],['forest','clear'],
                           ['beach','clear'],['wetland','clear'],['city','clear'],
                           ['meadow','rain'],['beach','breeze']]) {
    state.location = loc; state.weather = wx;
    scene.reseed(state.seed); audio.applyConditions();
    // let it settle, then hold the land quiet so nothing else calls
    await sleep(2600);
    /* Stopping the timers stops new voices and new waves, but a wave already
       booked keeps unfolding on the audio clock for another ten seconds — and
       whether the room reading caught a crest or missed one moved the beach
       fourteen decibels between runs. So the surf's automation is cancelled
       back to its resting floor too: "room" here means the bed. */
    const gen = audio.gen;
    audio.gen++; audio.clearTimers();
    for (const [node, to] of [[audio.surfGain, audio.surfFloor], [audio.surfFoamGain, 0]]) {
      if (!node) continue;
      node.gain.cancelScheduledValues(ac.currentTime);
      node.gain.setTargetAtTime(Math.max(0.0001, to), ac.currentTime, 0.3);
    }
    /* Long enough for anything already booked to have finished — a wave takes
       eleven seconds to unfold and its shingle another three — and the level
       is the *median* of the short-term rms, not the mean. "The steady level
       of the place" is exactly what a median says and what a mean does not:
       one crest inside the window moved the beach ten decibels between runs
       and made the whole row meaningless. */
    await sleep(6000);
    const lv = []; let roomPk = 0;
    for (let i = 0; i < 240; i++) {
      const [r, p] = meas(); lv.push(r); if (p > roomPk) roomPk = p; await sleep(25);
    }
    lv.sort((a, b) => a - b);
    const room = lv[lv.length >> 1];
    let vPk = 0;
    for (let k = 0; k < 3; k++) {
      audio.performCall(ref, { at: 0.5 });
      for (let i = 0; i < 100; i++) { const p = meas()[1]; if (p > vPk) vPk = p; await sleep(25); }
    }
    audio.gen = gen; audio.resumeSchedulers();
    out.push(`${loc.padEnd(9)} ${wx.padEnd(7)} room ${dB(room).toFixed(1).padStart(7)} dB rms `
      + `(pk ${dB(roomPk).toFixed(1).padStart(6)})   crow peak ${dB(vPk).toFixed(1).padStart(7)} dB`
      + `   clear ${(dB(vPk) - dB(room)).toFixed(1).padStart(6)} dB`);
  }
  return out;
});
await b.close();
for (const r of rows) console.log('  ' + r);
