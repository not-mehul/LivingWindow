/* What makes filtered noise sound like *something* rather than like static.

   Two numbers per bed, both taken from the bed's own tap:

   flutter  the standard deviation of the short-term level, as a fraction of
            its mean. Static holds one level and scores near zero. Anything
            granular — leaves, foam, rain on a roof — is thousands of small
            events and scores high.
   drift    the standard deviation of the spectral centroid, in per-cent of
            its mean. A fixed filter on steady noise never moves; water gets
            brighter as it breaks and darker as it drains.

   The leaf bed is the reference: it already does the granular trick (noise
   driving noise) and is the one bed nobody has complained about. */
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=swiftshader', '--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
const p = await b.newPage({ viewport: { width: 900, height: 560 } });
p.on('pageerror', e => console.log('ERR', e.message));
await p.goto('http://127.0.0.1:8123/?hook=1', { waitUntil: 'networkidle' });
await p.click('#beginBtn'); await p.waitForTimeout(1500);
for (const line of await p.evaluate(async () => {
  const { audio, scene, state } = window.__lw;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const ac = audio.ac;
  /* The spectral centroid, counting only what is actually there.
     `getFloatFrequencyData` floors every empty bin at minDecibels, and a
     thousand bins sitting on that floor outweigh the handful carrying the
     signal — which is how a cow's low and a church bell both measured five
     kilohertz. Everything more than 40 dB below the loudest bin is bed
     noise or nothing, and is not counted. */
  const centroid = (an, fd) => {
    an.getFloatFrequencyData(fd);
    let top = -Infinity;
    for (let k = 2; k < fd.length; k++) if (fd[k] > top) top = fd[k];
    if (!isFinite(top) || top < -95) return -1;
    const cut = top - 40;
    let num = 0, den = 0;
    for (let k = 2; k < fd.length; k++) {
      if (fd[k] < cut) continue;
      const mag = Math.pow(10, fd[k]/20);
      num += mag * k * ac.sampleRate/2/fd.length; den += mag;
    }
    return den > 0 ? num/den : -1;
  };
  const out = [];

  const measure = async (label, node, ms) => {
    const an = ac.createAnalyser();
    an.fftSize = 2048; an.smoothingTimeConstant = 0;
    node.connect(an);
    const td = new Float32Array(2048), fd = new Float32Array(1024);
    const lv = [], ce = [];
    const end = performance.now() + ms;
    while (performance.now() < end) {
      an.getFloatTimeDomainData(td);
      let s = 0;
      for (let i = 0; i < td.length; i++) s += td[i]*td[i];
      const rms = Math.sqrt(s/td.length);
      if (rms > 1e-7) {
        lv.push(rms);
        an.getFloatFrequencyData(fd);
        let num = 0, den = 0;
        for (let k = 2; k < fd.length; k++) {
          const mag = Math.pow(10, fd[k]/20);
          num += mag * k * ac.sampleRate/2/fd.length;
          den += mag;
        }
        if (den > 0) ce.push(num/den);
      }
      await sleep(20);
    }
    try { node.disconnect(an); } catch (e) {}
    const sd = a => {
      if (a.length < 4) return [0, 0];
      const m = a.reduce((x, y) => x + y, 0)/a.length;
      const v = a.reduce((x, y) => x + (y - m)*(y - m), 0)/a.length;
      return [m, Math.sqrt(v)];
    };
    const [lm, ls] = sd(lv), [cm, cs] = sd(ce);
    out.push(`${label.padEnd(22)} flutter ${(ls/(lm || 1)).toFixed(3).padStart(6)}`
      + `   drift ${(cs/(cm || 1)*100).toFixed(1).padStart(5)}%`
      + `   centroid ${Math.round(cm)} Hz`);
  };

  // the reference, and the ones complained about
  state.location = 'forest'; state.weather = 'breeze';
  scene.reseed(state.seed); audio.applyConditions(); await sleep(3000);
  await measure('leaves (reference)', audio.leavesGain, 6000);
  await measure('wind', audio.windGain, 6000);

  state.location = 'meadow'; state.weather = 'rain';
  audio.applyConditions(); await sleep(3000);
  await measure('rain', audio.rainGain, 6000);

  state.location = 'beach'; state.weather = 'clear';
  scene.reseed(state.seed); audio.applyConditions(); await sleep(3000);
  await measure('surf body', audio.surfGain, 14000);
  await measure('surf foam', audio.surfFoamGain, 14000);

  state.location = 'city'; state.weather = 'clear';
  scene.reseed(state.seed); audio.applyConditions(); await sleep(3000);
  await measure('traffic', audio.trafficGain, 6000);
  if (audio.vinylGain) await measure('the record: vinyl', audio.vinylGain, 6000);
  if (audio.musicTrim) await measure('the record: all', audio.musicTrim, 8000);
  return out;
})) console.log('  ' + line);
await b.close();
