/* ============================================================
   The audio engine — wind, aeolian drift, place-beds,
   turn-taking voices, and the odd church bell.

   Decoupled from the DOM and the canvas: the scene and the
   subtitle callback are injected, so this module never reaches
   for globals.
   ============================================================ */
import { mulberry32, REDUCED, state } from "./util.js?v=3";
import { SPECIES, CRITTER_VOICES, note, burst } from "./species.js?v=3";

class AudioEngine {
  constructor({ scene, emit }) {
    this.scene = scene;   // the visual Scene, for spawning callers on-screen
    this.emit = emit;     // callback(species, az, depth, dur) — raises a subtitle
    this.ac = null;
    this.running = false;
    this.timers = new Set();  // pending one-shot timers, self-pruning
    this.gen = 0;             // scheduler generation; bumped to stop old loops
    this.quietUntil = 0;
    this.activeVoices = 0;   // live synthesized calls, capped for a calm mix
    this.maxVoices = 6;
    this.rng = mulberry32((state.seed ^ 0xA0D10) >>> 0);
  }

  /* A one-shot timer that removes itself from the pending set when it fires,
     so the set can never grow without bound during a long session. */
  once(fn, ms) {
    const id = setTimeout(() => { this.timers.delete(id); fn(); }, ms);
    this.timers.add(id);
    return id;
  }

  softBuffer(dur) {
    const ac = this.ac;
    const buf = ac.createBuffer(1, ac.sampleRate * dur, ac.sampleRate);
    const d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < d.length; i++) {
      const w = Math.random()*2 - 1;
      b0 = 0.99765*b0 + w*0.0990460;
      b1 = 0.96300*b1 + w*0.2965164;
      b2 = 0.57000*b2 + w*1.0526913;
      d[i] = (b0 + b1 + b2 + w*0.1848) * 0.12;
    }
    return buf;
  }
  loopNoise() {
    const src = this.ac.createBufferSource();
    src.buffer = this.softBuffer(4);
    src.loop = true;
    src.start();
    return src;
  }

  /* Render one long segment of rain once, up front, so it can simply be looped.
     Rain is stationary enough that a loop is indistinguishable from live
     synthesis — and a single looping buffer costs the audio thread almost
     nothing, so it can never stutter. Shaped noise (low body + broadband
     hiss) with a gentle, seamless breathing baked in, and the ends
     cross-faded so the wrap is inaudible. */
  makeRainLoop(seconds) {
    const ac = this.ac, fs = ac.sampleRate;
    const N = Math.floor(fs * seconds);
    const F = Math.floor(fs * 0.05);          // 50 ms cross-fade
    const M = N + F;
    const tmp = new Float32Array(M);
    const aLow = 1 - Math.exp(-2*Math.PI*1000/fs);   // split point ~1 kHz
    let low = 0;
    const twoPiOverN = 2*Math.PI / N;
    for (let i = 0; i < M; i++) {
      const w = Math.random()*2 - 1;
      low += aLow*(w - low);
      const high = w - low;
      const ph = twoPiOverN * (i % N);               // periodic over N → seamless
      const mod = 1 + 0.16*Math.sin(ph*2) + 0.10*Math.sin(ph*5 + 1.3);
      tmp[i] = (low*1.5 + high*0.6) * mod;
    }
    let peak = 1e-6;
    for (let i = 0; i < M; i++) { const a = Math.abs(tmp[i]); if (a > peak) peak = a; }
    const norm = 0.9 / peak;
    const buf = ac.createBuffer(1, N, fs);
    const d = buf.getChannelData(0);
    for (let i = 0; i < N; i++) d[i] = tmp[i] * norm;
    for (let i = 0; i < F; i++) {                     // blend the extra tail into the head
      const fin = i/F;
      d[i] = (tmp[i]*fin + tmp[N + i]*(1 - fin)) * norm;
    }
    return buf;
  }

  async start() {
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ac = new AC();
    const ac = this.ac;
    this.master = ac.createGain();
    this.master.gain.value = state.volume;
    this.comp = ac.createDynamicsCompressor();
    this.comp.threshold.value = -22; this.comp.ratio.value = 4;
    this.master.connect(this.comp);
    this.comp.connect(ac.destination);
    this.voiceFilter = ac.createBiquadFilter();
    this.voiceFilter.type = "lowpass"; this.voiceFilter.frequency.value = 12000;
    this.voiceGain = ac.createGain(); this.voiceGain.gain.value = 0.9;
    this.voiceGain.connect(this.voiceFilter);
    this.voiceFilter.connect(this.master);

    // wind bed
    this.windGain = ac.createGain(); this.windGain.gain.value = 0;
    const wlp = ac.createBiquadFilter(); wlp.type = "lowpass"; wlp.frequency.value = 380;
    const wlp2 = ac.createBiquadFilter(); wlp2.type = "lowpass"; wlp2.frequency.value = 900;
    this.loopNoise().connect(wlp); wlp.connect(wlp2); wlp2.connect(this.windGain);
    this.windGain.connect(this.master);

    // aeolian strings
    this.aeoGain = ac.createGain(); this.aeoGain.gain.value = 0;
    this.aeoGain.connect(this.master);
    this.aeolianFilters = []; this.aeolianStrings = [];
    const src = this.loopNoise();
    const roots = [174.6, 196, 220, 233.1, 261.6];
    const modes = [[1, 1.125, 1.333, 1.5, 1.875], [1, 1.2, 1.5, 1.6, 2], [1, 1.125, 1.25, 1.5, 1.667]];
    const root = roots[Math.floor(this.rng()*roots.length)];
    const mode = modes[Math.floor(this.rng()*modes.length)];
    for (let i = 0; i < 5; i++) {
      const f = ac.createBiquadFilter();
      f.type = "bandpass";
      f.frequency.value = root * mode[i % mode.length] * (i >= mode.length ? 2 : 1);
      f.Q.value = 55;
      const g = ac.createGain(); g.gain.value = 0.12 + this.rng()*0.1;
      src.connect(f); f.connect(g); g.connect(this.aeoGain);
      this.aeolianFilters.push(f); this.aeolianStrings.push(g);
    }

    // rain bed — a single pre-rendered loop, gated on/off. No live filtering
    // and no per-drop scheduling, so the audio thread has nothing to do here
    // beyond reading samples: it cannot stutter.
    this.rainGain = ac.createGain(); this.rainGain.gain.value = 0;
    const rainSrc = ac.createBufferSource();
    rainSrc.buffer = this.makeRainLoop(11);
    rainSrc.loop = true;
    rainSrc.connect(this.rainGain);
    this.rainGain.connect(this.master);
    rainSrc.start();

    // leaf-rustle bed
    this.leavesGain = ac.createGain(); this.leavesGain.gain.value = 0;
    const lhp = ac.createBiquadFilter(); lhp.type = "highpass"; lhp.frequency.value = 1600;
    this.loopNoise().connect(lhp); lhp.connect(this.leavesGain);
    this.leavesGain.connect(this.master);

    // traffic rumble bed
    this.trafficGain = ac.createGain(); this.trafficGain.gain.value = 0;
    const tlp = ac.createBiquadFilter(); tlp.type = "lowpass"; tlp.frequency.value = 120;
    this.loopNoise().connect(tlp); tlp.connect(this.trafficGain);
    this.trafficGain.connect(this.master);

    // surf bed — the low body of the sea (approach and drag-back)
    this.surfGain = ac.createGain(); this.surfGain.gain.value = 0;
    this.surfFilter = ac.createBiquadFilter();
    this.surfFilter.type = "lowpass"; this.surfFilter.frequency.value = 400;
    this.loopNoise().connect(this.surfFilter);
    this.surfFilter.connect(this.surfGain);
    this.surfGain.connect(this.master);

    // surf foam — the bright hiss of a wave breaking and washing back
    this.surfFoamGain = ac.createGain(); this.surfFoamGain.gain.value = 0;
    this.surfFoamFilter = ac.createBiquadFilter();
    this.surfFoamFilter.type = "highpass"; this.surfFoamFilter.frequency.value = 1200;
    this.loopNoise().connect(this.surfFoamFilter);
    this.surfFoamFilter.connect(this.surfFoamGain);
    this.surfFoamGain.connect(this.master);

    this.surfFloor = 0;
    this.applyConditions();
    this.running = true;
    this.resumeSchedulers();
  }

  set(param, v, tau) {
    param.setTargetAtTime(v, this.ac.currentTime, tau || 1.2);
  }

  applyConditions() {
    if (!this.ac) return;
    const w = state.weather, L = state.location;
    const windTable = { clear: 0.06, breeze: 0.30, rain: 0.15, fog: 0.12 };
    const locWind = { meadow: 1, forest: 0.75, beach: 1.25, wetland: 0.9, city: 0.5 };
    this.windBase = windTable[w] * locWind[L];
    this.set(this.windGain.gain, this.windBase);
    const aeoT = { clear: 0.35, breeze: 0.6, rain: 0.2, fog: 0.45 };
    const locAeo = { meadow: 1, forest: 0.55, beach: 0.7, wetland: 0.8, city: 0.3 };
    this.aeoBase = aeoT[w] * locAeo[L] * 0.16;
    this.set(this.aeoGain.gain, this.aeoBase, 2);
    this.set(this.rainGain.gain, w === "rain" ? 0.16 : 0);
    // Leaf hiss follows the wind: a still, clear day in the wood is quiet.
    const leafBase = L === "forest" ? 0.10 : L === "wetland" ? 0.05 : 0;
    const leafWeather = { clear: 0.4, breeze: 1.7, rain: 1.1, fog: 0.7 }[w] || 1;
    this.set(this.leavesGain.gain, leafBase * leafWeather);
    this.set(this.trafficGain.gain, L === "city" ? 0.05 : 0);
    // The sea's resting hiss between waves — kept low so the waves themselves carry.
    const surfWeather = { clear: 1, breeze: 1.5, rain: 1.3, fog: 0.9 }[w] || 1;
    this.surfFloor = L === "beach" ? 0.022 * surfWeather : 0;
    this.set(this.surfGain.gain, this.surfFloor);
    if (this.surfFoamGain && L !== "beach") this.set(this.surfFoamGain.gain, 0, 0.4);
    this.set(this.voiceFilter.frequency, w === "fog" ? 3000 : 12000, 0.8);
  }

  setVolume(v) {
    if (this.ac) this.set(this.master.gain, v, 0.15);
  }

  retune() {
    this.rng = mulberry32((state.seed ^ 0xA0D10) >>> 0);
    if (!this.ac) return;
    const roots = [174.6, 196, 220, 233.1, 261.6];
    const modes = [[1, 1.125, 1.333, 1.5, 1.875], [1, 1.2, 1.5, 1.6, 2], [1, 1.125, 1.25, 1.5, 1.667]];
    const root = roots[Math.floor(this.rng()*roots.length)];
    const mode = modes[Math.floor(this.rng()*modes.length)];
    this.aeolianFilters.forEach((f, i) => {
      f.frequency.setTargetAtTime(root * mode[i % mode.length] * (i >= mode.length ? 2 : 1),
        this.ac.currentTime, 2.5);
    });
  }

  makePanner(az, el, depth) {
    const ac = this.ac;
    const lp = ac.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 16000 / (1 + depth*0.12);
    // A single distance-loudness stage for both listening modes: near voices are
    // clearly louder than far ones, so distance reads whether or not spatial is on.
    const dg = ac.createGain();
    dg.gain.value = Math.max(0.2, Math.min(1, 5 / (3.2 + depth)));
    lp.connect(dg);
    if (state.spatial && ac.createPanner) {
      const p = ac.createPanner();
      p.panningModel = "HRTF";
      p.distanceModel = "inverse";
      p.refDistance = 1; p.rolloffFactor = 0;   // loudness is handled by dg above
      const ang = az * Math.PI / 2;
      const x = Math.sin(ang) * depth, z = -Math.cos(ang) * depth, y = el * 2;
      if (p.positionX) {
        p.positionX.value = x; p.positionY.value = y; p.positionZ.value = z;
      } else p.setPosition(x, y, z);
      dg.connect(p);
      return { node: lp, out: p };
    }
    const sp = ac.createStereoPanner ? ac.createStereoPanner() : ac.createGain();
    if (sp.pan) sp.pan.value = az * 0.8;
    dg.connect(sp);
    return { node: lp, out: sp };
  }

  /* A lightweight panner (stereo only, no HRTF) for small percussive sounds
     like the water laps, so they never overload the audio thread. */
  makeCheapPan(az, depth) {
    const ac = this.ac;
    const g = ac.createGain();
    g.gain.value = Math.max(0.2, Math.min(1, 5 / (3.2 + depth)));
    const sp = ac.createStereoPanner ? ac.createStereoPanner() : ac.createGain();
    if (sp.pan) sp.pan.value = Math.max(-1, Math.min(1, az * 0.8));
    g.connect(sp);
    return { node: g, out: sp };
  }

  performCall(sp) {
    const ac = this.ac, r = this.rng;
    // Hold a calm ceiling on how many voices sound at once — the surest guard
    // against the mix stuttering when the land gets busy.
    if (this.activeVoices >= this.maxVoices) return 0.5;
    let x01, y01, depth, perchType = null;
    if (sp.layer === "perch" && this.scene.perches && this.scene.perches.length) {
      const p = this.scene.perches[Math.floor(r()*this.scene.perches.length)];
      x01 = p.x; y01 = p.y; depth = p.depth; perchType = p.type || null;
    } else if (sp.layer === "air") {
      x01 = r(); y01 = 0.08 + r()*0.28; depth = 6 + r()*8;
    } else if (sp.layer === "far") {
      x01 = r(); y01 = 0.3 + r()*0.2; depth = 16 + r()*10;
    } else {
      x01 = r(); y01 = 0.78 + r()*0.12; depth = 2 + r()*5;
      if (state.location === "wetland" && this.scene.waterY) {
        y01 = this.scene.waterY + 0.08 + r()*(this.scene.bankY - this.scene.waterY - 0.12);
      }
      if (state.location === "beach" && this.scene.shoreY) y01 = this.scene.shoreY + 0.03 + r()*0.08;
    }
    // A little natural spread so callers aren't all at the same distance.
    depth = Math.max(1.5, depth + (r() - 0.5) * depth * 0.35);
    const az = Math.max(-1, Math.min(1, (x01*2 - 1) * 0.9));
    const pan = this.makePanner(az, sp.layer === "air" ? 1.5 : 0.3, depth);
    pan.out.connect(this.voiceGain);
    // Animals that appear on-canvas ease in, settle, and only then call. Fliers
    // (already on the wing) and voice-only species call without a staged entrance.
    const noActor = sp.layer === "air" || sp.layer === "far" ||
                    sp.id === "cricket" || sp.id === "cuckoo" ||
                    sp.id === "curlew" || sp.id === "rooster";
    const enter = noActor ? 0 : 0.9 + r()*0.9;
    const dur = sp.synth(ac, pan.node, ac.currentTime + 0.02 + enter, r) || 1;
    this.activeVoices++;
    this.once(() => { this.activeVoices = Math.max(0, this.activeVoices - 1); },
      (enter + dur + 0.3) * 1000);
    this.scene.spawnForCall(sp, x01, y01, depth, dur, enter, perchType);
    const announce = () => {
      if (!this.running) return;
      this.scene.addRipple(x01, y01, sp.tone);
      this.emit(sp, az, depth, dur);
    };
    if (enter > 0) this.once(announce, enter * 1000);
    else announce();
    return dur + enter;
  }

  startSchedulers(gen) {
    this.quietUntil = 0;
    for (const sp of SPECIES) {
      const loop = () => {
        if (!this.running || gen !== this.gen) return;
        const w = sp.weights[state.time] || 0;
        const habOK = sp.habitats.includes(state.location);
        const hw = habOK ? ((sp.hw && sp.hw[state.location] !== undefined) ? sp.hw[state.location] : 1) : 0;
        const wcut = state.weather === "rain" ? 0.35 : state.weather === "fog" ? 0.8 : 1;
        const eff = w * hw * wcut * (0.1 + state.activity * 1.2);
        let wait = sp.base * 1000 * (0.8 + this.rng()*1.6) / (0.35 + state.activity*1.3);
        if (eff > 0 && this.rng() < Math.min(0.8, eff * 0.85)) {
          const nowMs = performance.now();
          if (sp.chorus || nowMs >= this.quietUntil) {
            const dur = this.performCall(sp);
            if (!sp.chorus) {
              let gap = (2.0 + this.rng()*3.5 - state.activity*2.5) * 1000;
              if (state.time === "dawn") gap *= 0.4;
              this.quietUntil = nowMs + dur*1000 + Math.max(400, gap);
            }
            wait = Math.max(wait, 6000);
          }
        }
        setTimeout(loop, wait);
      };
      setTimeout(loop, 1200 + this.rng() * sp.base * 600);
    }
  }

  startGusts(gen) {
    const gust = () => {
      if (!this.running || gen !== this.gen) return;
      this.set(this.windGain.gain, this.windBase * (0.55 + this.rng()*0.95), 1.6);
      setTimeout(gust, 4000 + this.rng()*5500);
    };
    setTimeout(gust, 2500);
  }

  startSwells(gen) {
    const swell = () => {
      if (!this.running || gen !== this.gen) return;
      const g = this.aeolianStrings[Math.floor(this.rng()*this.aeolianStrings.length)];
      this.set(g.gain, 0.04 + this.rng()*0.24, 2.2);
      setTimeout(swell, 3000 + this.rng()*4500);
    };
    setTimeout(swell, 2000);
  }

  /* The ambient wildlife has voices too. When a critter with one is on
     stage — a fox trotting the field edge, a heron at the water — it may
     speak from wherever it happens to be. Its presence already respects
     place and hour, so the voice needs no weighting of its own. */
  startCritterVoiceScheduler(gen) {
    const tick = () => {
      if (!this.running || gen !== this.gen) return;
      const crs = (this.scene.critters || []).filter(cr => CRITTER_VOICES[cr.kind]);
      if (crs.length && this.activeVoices < this.maxVoices) {
        const cr = crs[Math.floor(this.rng()*crs.length)];
        const v = CRITTER_VOICES[cr.kind];
        if (this.rng() < v.p && cr.x >= -0.02 && cr.x <= 1.02) {
          const az = Math.max(-1, Math.min(1, (cr.x*2 - 1) * 0.9));
          const depth = 4 + this.rng()*5;
          const pan = this.makePanner(az, 0.2, depth);
          pan.out.connect(this.voiceGain);
          const dur = v.synth(this.ac, pan.node, this.ac.currentTime + 0.02, this.rng) || 1;
          this.activeVoices++;
          this.once(() => { this.activeVoices = Math.max(0, this.activeVoices - 1); },
            (dur + 0.3) * 1000);
          this.scene.addRipple(cr.x, cr.y !== undefined ? cr.y : 0.85, v.tone);
          this.emit(v, az, depth, dur);
        }
      }
      setTimeout(tick, 9000 + this.rng()*14000);
    };
    setTimeout(tick, 7000 + this.rng()*8000);
  }

  startFlyerScheduler(gen) {
    const fly = () => {
      if (!this.running || gen !== this.gen) return;
      if (this.rng() < 0.5 && !REDUCED) this.scene.addFlyer(this.rng() < 0.5 ? 1 : -1);
      setTimeout(fly, 12000 + this.rng()*20000);
    };
    setTimeout(fly, 6000 + this.rng()*8000);
  }

  startWaveScheduler(gen) {
    const wave = () => {
      if (!this.running || gen !== this.gen) return;
      if (state.location === "beach" && this.ac) {
        const t = this.ac.currentTime;
        const big = 0.6 + this.rng()*0.9;                 // how large this wave is
        const dur = 6 + this.rng()*5;                     // whole approach-to-wash cycle
        const crest = t + dur * (0.42 + this.rng()*0.12); // the moment it breaks
        const bodyPeak = this.surfFloor + (0.05 + this.rng()*0.04) * big;
        const foamPeak = (0.045 + this.rng()*0.035) * big;

        // Body: the swell rolls in, then drags back out (a low roar).
        const g = this.surfGain.gain;
        g.cancelScheduledValues(t);
        g.setValueAtTime(Math.max(0.001, this.surfFloor), t);
        g.linearRampToValueAtTime(bodyPeak, crest);
        g.setTargetAtTime(Math.max(0.001, this.surfFloor), crest, dur*0.28);
        const ff = this.surfFilter.frequency;
        ff.cancelScheduledValues(t);
        ff.setValueAtTime(190, t);
        ff.linearRampToValueAtTime(760, crest);
        ff.setTargetAtTime(240, crest, dur*0.25);

        // Foam: silent on the approach, then the break and a hissing wash-back.
        const fg = this.surfFoamGain.gain;
        fg.cancelScheduledValues(t);
        fg.setValueAtTime(0.0001, t);
        fg.setValueAtTime(0.0001, Math.max(t, crest - 0.18));
        fg.linearRampToValueAtTime(foamPeak, crest + 0.12);
        fg.exponentialRampToValueAtTime(0.0001, crest + 1.8 + this.rng()*1.3);
        const fff = this.surfFoamFilter.frequency;
        fff.cancelScheduledValues(t);
        fff.setValueAtTime(1700, t);
        fff.linearRampToValueAtTime(850, crest + 1.6);    // foam settles lower as it recedes

        this.once(() => this.scene.foamPulse(), (crest - t + 0.12)*1000);
        setTimeout(wave, dur * 1000 * (0.7 + this.rng()*0.4));
      } else {
        setTimeout(wave, 5000);
      }
    };
    setTimeout(wave, 1500);
  }

  startLapScheduler(gen) {
    const lap = () => {
      if (!this.running || gen !== this.gen) return;
      if (state.location === "wetland" && this.ac) {
        const az = (this.rng()*2 - 1) * 0.8;
        if (this.rng() < 0.22) {
          const pan = this.makeCheapPan(az, 4 + this.rng()*6);
          pan.out.connect(this.master);
          note(this.ac, pan.node, this.ac.currentTime + 0.02,
            290 + this.rng()*160, 90, 0.09, 0.045);
          this.scene.fishRise((az/0.8 + 1) / 2);
        } else {
          const pan = this.makeCheapPan(az, 3 + this.rng()*5);
          pan.out.connect(this.master);
          burst(this.ac, pan.node, this.ac.currentTime + 0.02,
            480 + this.rng()*320, 1.2, 0.25, 0.013);
        }
      }
      setTimeout(lap, 2500 + this.rng()*5500);
    };
    setTimeout(lap, 3000);
  }

  startCarScheduler(gen) {
    const car = () => {
      if (!this.running || gen !== this.gen) return;
      if (state.location === "city" && this.ac && this.rng() < 0.75) {
        const ac = this.ac;
        const src = this.loopNoise();
        const lp = ac.createBiquadFilter();
        lp.type = "lowpass"; lp.frequency.value = 230;
        const g = ac.createGain(); g.gain.value = 0.0001;
        const sp = ac.createStereoPanner ? ac.createStereoPanner() : ac.createGain();
        src.connect(lp); lp.connect(g); g.connect(sp); sp.connect(this.master);
        const t = ac.currentTime, dur = 4.5 + this.rng()*2;
        const dir = this.rng() < 0.5 ? 1 : -1;
        if (sp.pan) {
          sp.pan.setValueAtTime(-0.9*dir, t);
          sp.pan.linearRampToValueAtTime(0.9*dir, t + dur);
        }
        g.gain.exponentialRampToValueAtTime(0.028, t + dur*0.45);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        this.once(() => { try { src.stop(); } catch(e) {} }, (dur + 0.5)*1000);
      }
      setTimeout(car, 18000 + this.rng()*35000);
    };
    setTimeout(car, 8000 + this.rng()*10000);
  }

  startBellScheduler(gen) {
    const bell = () => {
      if (!this.running || gen !== this.gen) return;
      if (state.location === "city" && this.ac && this.rng() < 0.65) this.playBell();
      setTimeout(bell, 70000 + this.rng()*110000);
    };
    setTimeout(bell, 20000 + this.rng()*40000);
  }

  playBell() {
    const ac = this.ac;
    const az = (this.rng()*2 - 1) * 0.8, depth = 18 + this.rng()*8;
    const pan = this.makePanner(az, 1, depth);
    pan.out.connect(this.master);
    const f0 = [196, 220, 246.9][Math.floor(this.rng()*3)];
    const strikes = 1 + Math.floor(this.rng()*3);
    for (let k = 0; k < strikes; k++) {
      const t = ac.currentTime + 0.05 + k*2.6;
      const parts = [[0.5, 0.030], [1, 0.05], [1.183, 0.026], [1.506, 0.018], [2, 0.028]];
      for (const [ra, ga] of parts) {
        const o = ac.createOscillator();
        o.type = "sine"; o.frequency.value = f0 * ra;
        const g = ac.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(ga, t + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 3.5 + this.rng()*1.5);
        o.connect(g); g.connect(pan.node);
        o.start(t); o.stop(t + 5.4);
      }
    }
    this.emit({ id: "bell", name: "Church bell", latin: "",
      desc: "the hour, loosed over the rooftops", tone: "amber" },
      az, depth, strikes*2.6 + 2);
  }

  clearTimers() {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
  }

  resumeSchedulers() {
    this.activeVoices = 0;   // a paused engine clears its in-flight voice timers
    const gen = ++this.gen;  // stamp this run; older scheduler loops self-stop
    this.startGusts(gen); this.startSwells(gen);
    this.startSchedulers(gen);
    this.startCritterVoiceScheduler(gen);
    this.startFlyerScheduler(gen);
    this.startWaveScheduler(gen); this.startLapScheduler(gen);
    this.startCarScheduler(gen); this.startBellScheduler(gen);
  }

  /* Silence, and the schedulers stopped. The master gain is cut to nothing
     first: calls already handed to the audio clock would otherwise resume
     mid-phrase when the context does. */
  pause() {
    this.running = false;
    this.gen++;              // halt every recurring scheduler loop
    this.clearTimers();
    if (this.ac) {
      const g = this.master.gain;
      g.cancelScheduledValues(this.ac.currentTime);
      g.setValueAtTime(0, this.ac.currentTime);
      this.ac.suspend();
    }
  }

  resume() {
    if (this.ac) {
      this.ac.resume();
      const g = this.master.gain;
      g.cancelScheduledValues(this.ac.currentTime);
      g.setValueAtTime(state.volume, this.ac.currentTime);
    }
    this.running = true;
    this.resumeSchedulers();
  }
}

export { AudioEngine };
