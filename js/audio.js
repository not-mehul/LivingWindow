/* ============================================================
   The audio engine — wind, aeolian drift, place-beds,
   turn-taking voices, and the odd church bell.

   Decoupled from the DOM and the canvas: the scene and the
   subtitle callback are injected, so this module never reaches
   for globals.
   ============================================================ */
import { mulberry32, REDUCED, state } from "./util.js?v=13";
import { SPECIES, CRITTER_VOICES, COUNTERSING, note, burst } from "./species.js?v=13";

/* Unwire a set of nodes. Disconnecting is always safe to attempt twice. */
/* How far ahead of its first sample a voice's graph is built. See performCall. */
const VOICE_LEAD = 0.12;

/* The two numbers the whole balance hangs off. The beds were measured at
   −24 to −40 dB RMS and a call's peak at −28 to −36, which put the birds under
   the weather in half the settings; these put a call's peak fifteen to twenty
   decibels clear of the bed it is heard over, which is about where a small
   sound stops being something you strain for. */
const VOICE_LEVEL = 2.4;
const BED_DUCK = 0.55;        // how far the beds step back under a voice (−5 dB)
/* How many head-related convolutions may run at once. See makePanner. */
const HRTF_BUDGET = 4;

function disconnect(...nodes) {
  for (const n of nodes) { try { n.disconnect(); } catch (e) { /* already gone */ } }
}

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
    this.duelUntil = 0;      // an exchange of songs is running until this time
    this.lastCallX = 0.5;    // where the last voice sounded, for the reply
    this.live = new Set();   // signal chains still sounding, torn down when done
    this.hrtfLive = 0;       // head-related panners in the graph right now
    this.rng = mulberry32((state.seed ^ 0xA0D10) >>> 0);
    this.breath = 1;
    this.wetUntil = 0;        // how long the ground goes on dripping
    this.chorusPh = this.rng()*Math.PI*2;
    this.chorusPeriod = 240 + this.rng()*200;   // four to seven minutes
  }

  /* A one-shot timer that removes itself from the pending set when it fires,
     so the set can never grow without bound during a long session. */
  once(fn, ms) {
    const id = setTimeout(() => { this.timers.delete(id); fn(); }, ms);
    this.timers.add(id);
    return id;
  }

  /* Four seconds of pink noise, generated once and shared by every bed that
     needs it. Filling this costs a couple of hundred thousand iterations on
     the main thread, so building a fresh one per bed (and again per passing
     car) was a self-inflicted stall. */
  softBuffer() {
    if (this._soft) return this._soft;
    const ac = this.ac;
    const buf = ac.createBuffer(1, ac.sampleRate * 4, ac.sampleRate);
    this.fillPink(buf.getChannelData(0));
    this._soft = buf;
    return buf;
  }
  fillPink(d) {
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < d.length; i++) {
      const w = Math.random()*2 - 1;
      b0 = 0.99765*b0 + w*0.0990460;
      b1 = 0.96300*b1 + w*0.2965164;
      b2 = 0.57000*b2 + w*1.0526913;
      d[i] = (b0 + b1 + b2 + w*0.1848) * 0.12;
    }
  }
  loopNoise() {
    const src = this.ac.createBufferSource();
    src.buffer = this.softBuffer();
    src.loop = true;
    src.start();
    return src;
  }

  /* The same noise, but two independent channels of it.

     Every bed used to be one channel of pink noise, which puts the whole of
     the weather in the exact middle of the head — the one place a bird also
     has to be heard. Two uncorrelated channels put the wind and the rain
     *around* the listener instead and leave the centre empty, which buys the
     voices several dB of clarity without anything being made louder. It costs
     nothing at all in the graph: a two-channel buffer goes through the same
     filters a one-channel buffer did. */
  wideBuffer() {
    if (this._wide) return this._wide;
    const ac = this.ac;
    const buf = ac.createBuffer(2, ac.sampleRate * 4, ac.sampleRate);
    this.fillPink(buf.getChannelData(0));
    this.fillPink(buf.getChannelData(1));
    this._wide = buf;
    return buf;
  }
  wideNoise() {
    const src = this.ac.createBufferSource();
    src.buffer = this.wideBuffer();
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
    /* ---- the mix ----

       Everything used to go straight to one gain and through one compressor,
       which is why the weather drowned the birds. A continuous bed feeding a
       4:1 compressor holds the whole mix down all the time, so a bird arrives
       into a room that has already been turned down for it; measured, a call's
       *peak* sat seven or eight decibels *below* the bed's steady level in a
       breeze or in rain. Inaudible is the right word for that.

       So there are two buses now. The beds run through their own shaping and
       are ducked out of the way when something is calling; the voices run
       clean and loud into a master that carries nothing but a limiter, and the
       limiter is set high enough that it only ever catches a peak. Nothing in
       here makes the piece louder — the beds come down a long way and the
       voices come up — because the goal is a quiet room in which a small sound
       is perfectly clear, not a loud one. */
    this.master = ac.createGain();
    this.master.gain.value = state.volume;
    // A limiter, not a compressor: it does nothing at all until something is
    // about to clip, so it cannot pump the beds or flatten a call.
    this.comp = ac.createDynamicsCompressor();
    this.comp.threshold.value = -6; this.comp.ratio.value = 20;
    this.comp.knee.value = 3; this.comp.attack.value = 0.003;
    this.comp.release.value = 0.25;
    this.master.connect(this.comp);
    this.comp.connect(ac.destination);

    // The voices: their own bus, well clear of the beds.
    this.voiceFilter = ac.createBiquadFilter();
    this.voiceFilter.type = "lowpass"; this.voiceFilter.frequency.value = 12000;
    this.voiceBus = ac.createGain(); this.voiceBus.gain.value = VOICE_LEVEL;
    this.voiceGain = this.voiceBus;          // what the callers wire themselves to
    this.voiceBus.connect(this.voiceFilter);
    this.voiceFilter.connect(this.master);

    /* The beds: one bus, and two filters on it that are worth more to clarity
       than any amount of turning things down. The first throws away everything
       below forty hertz — inaudible on most speakers, but it is real energy and
       it eats the headroom a call needs. The second takes three decibels out of
       a wide band around three kilohertz, which is where nearly every bird in
       the catalogue lives: the weather gives up the one part of the spectrum it
       does not need, and the birds have it to themselves. */
    this.bedBus = ac.createGain(); this.bedBus.gain.value = 1;
    this.bedDuck = ac.createGain(); this.bedDuck.gain.value = 1;
    const bedHP = ac.createBiquadFilter();
    bedHP.type = "highpass"; bedHP.frequency.value = 40; bedHP.Q.value = 0.6;
    const bedDip = ac.createBiquadFilter();
    bedDip.type = "peaking"; bedDip.frequency.value = 3200;
    bedDip.Q.value = 0.85; bedDip.gain.value = -3.2;
    this.bedBus.connect(bedHP); bedHP.connect(bedDip);
    bedDip.connect(this.bedDuck); this.bedDuck.connect(this.master);

    /* The land's discrete noises — a drip, a creak, stones in the backwash —
       take the duck with the rest of the weather but not the shaping. They are
       foreground detail rather than bed, and the three kilohertz the dip takes
       out to make room for the birds is exactly where a drop landing on a
       stone lives; run through it they were inaudible. */
    this.bedDetail = ac.createGain(); this.bedDetail.gain.value = 1;
    this.bedDetail.connect(this.bedDuck);

    // The air a distant call has to cross: a handful of early reflections off
    // the ground and whatever is standing about, rolled off at both ends and
    // fed back just enough to hang for a moment. Near voices are sent almost
    // none of it; far ones a good deal, which is what tells you they are far.
    this.airIn = ac.createGain();
    const airHP = ac.createBiquadFilter();
    airHP.type = "highpass"; airHP.frequency.value = 320;
    const airLP = ac.createBiquadFilter();
    airLP.type = "lowpass"; airLP.frequency.value = 3400;
    for (const d of [0.031, 0.057, 0.089, 0.134]) {
      const dl = ac.createDelay(0.5); dl.delayTime.value = d;
      const g = ac.createGain(); g.gain.value = 0.42 - d;
      this.airIn.connect(dl); dl.connect(g); g.connect(airHP);
    }
    const tail = ac.createDelay(0.5); tail.delayTime.value = 0.117;
    const fb = ac.createGain(); fb.gain.value = 0.33;
    airHP.connect(airLP);
    airLP.connect(tail); tail.connect(fb); fb.connect(airHP);
    /* The send is taken before the voice bus, so the return has to make up the
       bus's gain or a far bird would arrive with no air around it at all. */
    this.airGain = ac.createGain(); this.airGain.gain.value = 0.5*VOICE_LEVEL;
    airLP.connect(this.airGain);
    this.airGain.connect(this.voiceFilter);

    // wind bed
    this.windGain = ac.createGain(); this.windGain.gain.value = 0;
    const wlp = ac.createBiquadFilter(); wlp.type = "lowpass"; wlp.frequency.value = 380;
    const wlp2 = ac.createBiquadFilter(); wlp2.type = "lowpass"; wlp2.frequency.value = 900;
    this.wideNoise().connect(wlp); wlp.connect(wlp2); wlp2.connect(this.windGain);
    this.windGain.connect(this.bedBus);

    // aeolian strings
    this.aeoGain = ac.createGain(); this.aeoGain.gain.value = 0;
    this.aeoGain.connect(this.bedBus);
    this.aeolianFilters = []; this.aeolianStrings = [];
    const src = this.wideNoise();
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
    this.rainGain.connect(this.bedBus);
    rainSrc.start();

    // leaf-rustle bed
    this.leavesGain = ac.createGain(); this.leavesGain.gain.value = 0;
    const lhp = ac.createBiquadFilter(); lhp.type = "highpass"; lhp.frequency.value = 1600;
    this.wideNoise().connect(lhp); lhp.connect(this.leavesGain);
    this.leavesGain.connect(this.bedBus);

    // traffic rumble bed
    this.trafficGain = ac.createGain(); this.trafficGain.gain.value = 0;
    const tlp = ac.createBiquadFilter(); tlp.type = "lowpass"; tlp.frequency.value = 120;
    this.wideNoise().connect(tlp); tlp.connect(this.trafficGain);
    this.trafficGain.connect(this.bedBus);

    // surf bed — the low body of the sea (approach and drag-back)
    this.surfGain = ac.createGain(); this.surfGain.gain.value = 0;
    this.surfFilter = ac.createBiquadFilter();
    this.surfFilter.type = "lowpass"; this.surfFilter.frequency.value = 400;
    this.wideNoise().connect(this.surfFilter);
    this.surfFilter.connect(this.surfGain);
    this.surfGain.connect(this.bedBus);

    // surf foam — the bright hiss of a wave breaking and washing back
    this.surfFoamGain = ac.createGain(); this.surfFoamGain.gain.value = 0;
    this.surfFoamFilter = ac.createBiquadFilter();
    this.surfFoamFilter.type = "highpass"; this.surfFoamFilter.frequency.value = 1200;
    this.wideNoise().connect(this.surfFoamFilter);
    this.surfFoamFilter.connect(this.surfFoamGain);
    this.surfFoamGain.connect(this.bedBus);

    this.surfFloor = 0;
    /* Warm the two things that cost their whole price the first time they are
       asked for: the HRTF impulse set, which the first spatial panner loads,
       and the shared noise buffer, which the first burst fills. Both used to be
       paid for by whichever bird happened to sing first, and both are paid for
       here instead, while nothing is listening. */
    const warm = this.makePanner(0, 0.3, 4);
    burst(ac, warm.node, ac.currentTime + 0.01, 1000, 4, 0.02, 0.0001);
    this.once(() => warm.dispose(), 400);
    this.applyConditions();
    this.running = true;
    this.resumeSchedulers();
  }

  set(param, v, tau) {
    param.setTargetAtTime(v, this.ac.currentTime, tau || 1.2);
  }

  /* Step the beds back while something is calling, and let them come back
     afterwards. This is worth more than any amount of turning the weather
     down, because it only costs anything in the moment a voice is actually
     there: the room is as full as it ever was between calls, and the bird
     still arrives into a gap. Five decibels is enough to be certain of and
     little enough not to be noticed as an effect — and the recovery is slow,
     so the weather comes back the way attention does.

     There is no analyser and no sidechain: the engine knows exactly when every
     call starts and how long it runs, so the whole thing is two scheduled
     ramps on one gain. */
  duck(at, dur) {
    if (!this.bedDuck) return;
    const g = this.bedDuck.gain, t = Math.max(this.ac.currentTime, at - 0.06);
    const until = at + dur;
    if (this._duckUntil && until <= this._duckUntil) return;   // already down
    this._duckUntil = until;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(BED_DUCK, at + 0.10);
    g.setValueAtTime(BED_DUCK, until);
    g.setTargetAtTime(1, until, 0.85);
  }

  applyConditions() {
    if (!this.ac) return;
    const w = state.weather, L = state.location;
    /* Every bed level below came down between eight and fourteen decibels, and
       the spread between a still day and a windy one came down with them: five
       times the wind for a breeze was a different room, not a windier one. */
    const windTable = { clear: 0.038, breeze: 0.070, rain: 0.036, fog: 0.042 };
    const locWind = { meadow: 1, forest: 0.75, beach: 1.25, wetland: 0.9, city: 0.5 };
    this.windBase = windTable[w] * locWind[L];
    this.set(this.windGain.gain, this.windBase);
    const aeoT = { clear: 0.35, breeze: 0.6, rain: 0.2, fog: 0.45 };
    const locAeo = { meadow: 1, forest: 0.55, beach: 0.7, wetland: 0.8, city: 0.3 };
    this.aeoBase = aeoT[w] * locAeo[L] * 0.062;
    this.set(this.aeoGain.gain, this.aeoBase, 2);
    this.rainTarget = w === "rain" ? 0.038 : 0;
    this.set(this.rainGain.gain, this.rainTarget * (this.breath || 1));
    // Leaf hiss follows the wind: a still, clear day in the wood is quiet.
    const leafBase = L === "forest" ? 0.034 : L === "wetland" ? 0.017 : 0;
    const leafWeather = { clear: 0.4, breeze: 1.7, rain: 1.1, fog: 0.7 }[w] || 1;
    this.leafTarget = leafBase * leafWeather;
    this.set(this.leavesGain.gain, this.leafTarget * (this.breath || 1));
    this.set(this.trafficGain.gain, L === "city" ? 0.030 : 0);
    // The sea's resting hiss between waves — kept low so the waves themselves carry.
    const surfWeather = { clear: 1, breeze: 1.5, rain: 1.3, fog: 0.9 }[w] || 1;
    this.surfFloor = L === "beach" ? 0.012 * surfWeather : 0;
    this.set(this.surfGain.gain, this.surfFloor);
    if (this.surfFoamGain && L !== "beach") this.set(this.surfFoamGain.gain, 0, 0.4);
    this.set(this.voiceFilter.frequency, w === "fog" ? 3000 : 12000, 0.8);
  }

  setVolume(v) {
    if (this.ac) this.set(this.master.gain, v, 0.15);
  }

  retune() {
    this.rng = mulberry32((state.seed ^ 0xA0D10) >>> 0);
    this.chorusPh = this.rng()*Math.PI*2;
    this.chorusPeriod = 240 + this.rng()*200;
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

  /* A voice's own little signal chain. Every call built one of these and left
     it wired to the mix for the rest of the session: after ten minutes the
     graph carried a hundred idle HRTF panners, each still convolving silence.
     That is what made the soundscape thicken and then stutter. So each chain
     now comes with a `dispose`, and the caller unwires it the moment the call
     has finished sounding. */
  makePanner(az, el, depth) {
    const ac = this.ac;
    const lp = ac.createBiquadFilter();
    lp.type = "lowpass";
    // Air swallows the top of a sound over distance: a far bird is duller as
    // well as quieter, which is most of what makes it sound far away.
    lp.frequency.value = 15000 / (1 + depth*0.24);
    // A single distance-loudness stage for both listening modes: near voices are
    // clearly louder than far ones, so distance reads whether or not spatial is on.
    const dg = ac.createGain();
    dg.gain.value = Math.max(0.2, Math.min(1, 5 / (3.2 + depth)));
    lp.connect(dg);
    let out, send = null;
    if (this.airIn) {                       // the further off, the more room
      send = ac.createGain();
      send.gain.value = Math.min(0.6, depth*0.042);
      dg.connect(send); send.connect(this.airIn);
    }
    /* HRTF convolution is the most expensive thing in this graph and the whole
       reason the beds stuttered when the land got busy. It also buys least on
       a far-off voice, which is already dull and quiet and carries almost no
       localisation cue. So it is spent where it is worth spending: on near
       voices, and only up to a handful at a time. Everything else gets an
       ordinary stereo pan, which sounds all but identical at that distance and
       costs a rounding error. */
    const wantHRTF = state.spatial && ac.createPanner
      && depth < 11 && this.hrtfLive < HRTF_BUDGET;
    if (wantHRTF) {
      const p = ac.createPanner();
      p.panningModel = "HRTF";
      p.distanceModel = "inverse";
      p.refDistance = 1; p.rolloffFactor = 0;   // loudness is handled by dg above
      const ang = az * Math.PI / 2;
      const x = Math.sin(ang) * depth, z = -Math.cos(ang) * depth, y = el * 2;
      if (p.positionX) {
        p.positionX.value = x; p.positionY.value = y; p.positionZ.value = z;
      } else p.setPosition(x, y, z);
      out = p;
      this.hrtfLive++;
    } else {
      out = ac.createStereoPanner ? ac.createStereoPanner() : ac.createGain();
      if (out.pan) out.pan.value = Math.max(-1, Math.min(1, az * 0.8));
    }
    dg.connect(out);
    let done = false;
    return { node: lp, out, dispose: () => {
      if (done) return;
      done = true;
      if (wantHRTF) this.hrtfLive = Math.max(0, this.hrtfLive - 1);
      disconnect(lp, dg, out, send);
    } };
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
    return { node: g, out: sp, dispose: () => disconnect(g, sp) };
  }

  /* Wire a finished chain out of the graph once its last sound has decayed.
     Live chains are also tracked so that pausing tears the whole lot down at
     once rather than leaving them stranded when the timers are cleared. */
  retire(chain, afterSec) {
    this.live.add(chain);
    this.once(() => { chain.dispose(); this.live.delete(chain); },
      Math.max(200, afterSec*1000));
  }

  performCall(sp, opts) {
    const ac = this.ac, r = this.rng;
    // Hold a calm ceiling on how many voices sound at once — the surest guard
    // against the mix stuttering when the land gets busy.
    if (this.activeVoices >= this.voiceCap()) return 0.5;
    opts = opts || {};
    let x01, y01, depth, perchType = null;
    if (sp.layer === "perch" && this.scene.perches && this.scene.perches.length) {
      // The scene keeps track of who is standing where, so a new arrival takes
      // a free song post rather than landing on an occupant's head.
      const p = this.scene.pickPerch(r, opts);
      x01 = p.x; y01 = p.y; depth = p.depth; perchType = p.type || null;
    } else if (sp.layer === "air") {
      x01 = r(); y01 = 0.08 + r()*0.28; depth = 6 + r()*8;
    } else if (sp.layer === "far") {
      // A far caller has no perch list to draw on, so an answering bird is
      // simply placed well off across the valley from the one it is answering.
      x01 = opts.at !== undefined ? opts.at
        : opts.awayFrom !== undefined
          ? Math.min(0.94, Math.max(0.06,
              opts.awayFrom + (opts.awayFrom < 0.5 ? 1 : -1)*(0.28 + r()*0.34)))
          : r();
      y01 = 0.3 + r()*0.2; depth = 16 + r()*10;
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
    // A bird already on its perch answers a rival at once — it does not fly in
    // again to say the second half of an argument.
    const noActor = sp.layer === "air" || sp.layer === "far" ||
                    sp.id === "cricket" || sp.id === "curlew";
    const settled = opts.reply && this.scene.hasSingerNear(sp.id, x01);
    const enter = (noActor || settled) ? 0 : 0.9 + r()*0.9;
    /* Lead time. Building a voice is 2 ms of node construction on a good day
       and sixteen on a bad one, and it takes the graph lock while it does it.
       Scheduled twenty milliseconds out — which is what a reply or a flier got,
       since neither waits to arrive — the render thread could still be waiting
       on that lock when the first sample of the call was due, and the beds
       would stutter just before the bird was heard. A tenth of a second is
       inaudible as a delay and puts the whole build several buffers clear. */
    const dur = sp.synth(ac, pan.node, ac.currentTime + VOICE_LEAD + enter, r) || 1;
    this.duck(ac.currentTime + VOICE_LEAD + enter, dur);
    this.activeVoices++;
    this.once(() => { this.activeVoices = Math.max(0, this.activeVoices - 1); },
      (enter + dur + 0.3) * 1000);
    this.retire(pan, VOICE_LEAD + enter + dur + 2.5);
    this.scene.spawnForCall(sp, x01, y01, depth, dur, enter, perchType);
    this.lastCallX = x01;
    const announce = () => {
      if (!this.running) return;
      this.scene.addRipple(x01, y01, sp.tone);
      this.emit(sp, az, depth, dur);
    };
    this.once(announce, (VOICE_LEAD + enter) * 1000);
    if (!opts.reply) this.maybeCounterSing(sp, enter + dur, x01);
    return dur + enter;
  }

  /* Counter-singing. Two neighbours of the same species answer each other
     across a boundary: one sings, the other replies from its own song post the
     moment the first falls quiet, and back again. The turns tighten as the
     exchange goes on — that quickening is what makes it sound like an argument
     rather than a chorus — and then it simply stops. Nothing overlaps, because
     birds contesting a boundary listen: singing over a rival is a different
     signal altogether, and a rarer one. */
  maybeCounterSing(sp, dur, fromX) {
    const readiness = COUNTERSING[sp.id];
    // Needs a song post to answer from — or, for a cuckoo, the far side of
    // the valley, which comes to the same thing.
    if (!readiness || (sp.layer !== "perch" && sp.layer !== "far")) return;
    const now = performance.now();
    if (now < this.duelUntil) return;                       // one argument at a time
    if (this.rng() >= readiness * (0.35 + state.activity*0.75)) return;
    const rounds = 2 + Math.floor(this.rng()*4);            // 2–5 answers
    // Hold the rest of the land back so the exchange can be heard for what it is.
    this.duelUntil = now + (dur + rounds*3.4)*1000;
    this.quietUntil = Math.max(this.quietUntil, this.duelUntil - 1200);
    this.answer(sp, rounds, dur + 0.45 + this.rng()*0.6,
      0.5 + this.rng()*0.55, fromX, null, true);
  }

  /* One turn of the exchange, which books the next. The rival claims a post of
     its own on its first reply and the two then alternate between the posts
     they hold, so the argument stays between two birds in two places. */
  answer(sp, left, delaySec, gap, postA, postB, rivalsTurn) {
    if (left <= 0) return;
    this.once(() => {
      if (!this.running) return;
      const opts = { reply: true };
      if (!rivalsTurn) opts.at = postA;
      else if (postB === null) opts.awayFrom = postA;
      else opts.at = postB;
      const dur = this.performCall(sp, opts);
      const b = (rivalsTurn && postB === null) ? this.lastCallX : postB;
      this.answer(sp, left - 1, dur + gap, Math.max(0.3, gap*0.84),
        postA, b, !rivalsTurn);
    }, delaySec*1000);
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
        const curve = this.chorusCurve();
        const eff = w * hw * wcut * (0.02 + state.activity * 1.25) * curve;
        let wait = sp.base * 1000 * (0.8 + this.rng()*1.6)
          / Math.max(0.12, (0.18 + state.activity*1.5) * curve);
        if (eff > 0 && this.rng() < Math.min(0.8, eff * 0.85)) {
          const nowMs = performance.now();
          if (sp.chorus || nowMs >= this.quietUntil) {
            const dur = this.performCall(sp);
            if (!sp.chorus) {
              // Silence is part of the score: the emptier the setting, the
              // longer the land is left to itself between voices.
              let gap = (2.5 + this.rng()*4.0) * (1.7 - state.activity) * 1000;
              if (state.time === "dawn") gap *= 0.45;
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
      const f = 0.55 + this.rng()*0.95;
      this.set(this.windGain.gain, this.windBase * (this.breath || 1) * f, 1.6);
      // What the wind does to the leaves is the same thing it does to the
      // grass you can see moving: the two should rise and fall together.
      if (this.leafTarget) {
        this.set(this.leavesGain.gain,
          this.leafTarget * (this.breath || 1) * (0.4 + f*0.85), 2.2);
      }
      // dry reeds knock together in the same gust the grass is answering
      if (state.location === "wetland" && f > 0.9 && this.rng() < 0.6) {
        this.once(() => this.playReedRattle((this.rng()*2 - 1)*0.8,
          Math.min(1, (f - 0.9)*2.2)), 400 + this.rng()*900);
      }
      setTimeout(gust, 4000 + this.rng()*5500);
    };
    setTimeout(gust, 2500);
  }

  /* The weather has long tides in it as well as gusts. Every half minute or
     so the whole bed is given a new weight and takes the best part of a
     minute to get there, so the room breathes instead of holding one note. */
  startBreath(gen) {
    const breathe = () => {
      if (!this.running || gen !== this.gen) return;
      this.breath = 0.68 + this.rng()*0.62;
      this.set(this.windGain.gain, this.windBase * this.breath, 26);
      this.set(this.rainGain.gain, (this.rainTarget || 0) * this.breath, 24);
      this.set(this.surfGain.gain, this.surfFloor * this.breath, 22);
      if (this.leafTarget) this.set(this.leavesGain.gain, this.leafTarget * this.breath, 24);
      setTimeout(breathe, 24000 + this.rng()*16000);
    };
    setTimeout(breathe, 3000);
  }

  /* The shape of an hour. At dawn and dusk the land fills up and empties
     again over some minutes; at noon and midnight it holds steadier. A
     chorus should have a tide, not a rate. */
  chorusCurve() {
    const t = (this.ac ? this.ac.currentTime : 0);
    const slow = 0.5 + 0.5*Math.sin(t*2*Math.PI/(this.chorusPeriod || 300) + (this.chorusPh || 0));
    const swing = (state.time === "dawn" || state.time === "dusk") ? 0.8 : 0.34;
    return 1 - swing*0.5 + swing*slow;
  }

  /* How many voices may sound at once — a quiet setting should mean a quiet
     room, not the same room with softer birds. */
  voiceCap() {
    return 2 + Math.round(state.activity * 4);
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
      if (crs.length && this.activeVoices < this.voiceCap()) {
        const cr = crs[Math.floor(this.rng()*crs.length)];
        const v = CRITTER_VOICES[cr.kind];
        if (this.rng() < v.p && cr.x >= -0.02 && cr.x <= 1.02) {
          const az = Math.max(-1, Math.min(1, (cr.x*2 - 1) * 0.9));
          const depth = 4 + this.rng()*5;
          const pan = this.makePanner(az, 0.2, depth);
          pan.out.connect(this.voiceGain);
          const dur = v.synth(this.ac, pan.node, this.ac.currentTime + VOICE_LEAD, this.rng) || 1;
          this.duck(this.ac.currentTime + VOICE_LEAD, dur);
          this.activeVoices++;
          this.once(() => { this.activeVoices = Math.max(0, this.activeVoices - 1); },
            (dur + 0.3) * 1000);
          this.retire(pan, VOICE_LEAD + dur + 2.5);
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
        const bodyPeak = this.surfFloor + (0.020 + this.rng()*0.016) * big;
        const foamPeak = (0.018 + this.rng()*0.014) * big;

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

        // and the stones going back down the beach with the water
        this.playShingle(crest + 0.22, 1.4 + this.rng()*1.4, (0.006 + this.rng()*0.007)*big);
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
          pan.out.connect(this.bedDetail);
          note(this.ac, pan.node, this.ac.currentTime + 0.02,
            290 + this.rng()*160, 90, 0.09, 0.030);
          this.retire(pan, 1.2);
          this.scene.fishRise((az/0.8 + 1) / 2);
        } else {
          const pan = this.makeCheapPan(az, 3 + this.rng()*5);
          pan.out.connect(this.bedDetail);
          burst(this.ac, pan.node, this.ac.currentTime + 0.02,
            480 + this.rng()*320, 1.2, 0.25, 0.009);
          this.retire(pan, 1.2);
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
        src.connect(lp); lp.connect(g); g.connect(sp); sp.connect(this.bedBus);
        const t = ac.currentTime, dur = 4.5 + this.rng()*2;
        const dir = this.rng() < 0.5 ? 1 : -1;
        if (sp.pan) {
          sp.pan.setValueAtTime(-0.9*dir, t);
          sp.pan.linearRampToValueAtTime(0.9*dir, t + dur);
        }
        g.gain.exponentialRampToValueAtTime(0.013, t + dur*0.45);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        this.once(() => {
          try { src.stop(); } catch (e) { /* already stopped */ }
          disconnect(src, lp, g, sp);
        }, (dur + 0.5)*1000);
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
    pan.out.connect(this.voiceBus);
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
    this.duck(ac.currentTime + 0.05, strikes*2.6 + 2.5);
    this.retire(pan, strikes*2.6 + 7);
    this.emit({ id: "bell", name: "Church bell", latin: "",
      desc: "the hour, loosed over the rooftops", tone: "amber" },
      az, depth, strikes*2.6 + 2);
  }

  /* ============================================================
     The land's own noises — the things that are not anybody's voice.

     Each is built from the same two primitives the birds are, torn down as
     soon as it has finished sounding, and sent to the bed bus so that it steps
     back under a call like the rest of the weather. Thunder is the exception
     and has its own way out, because a robin should not duck a storm.
     ============================================================ */

  /* One drop, off a leaf or an eave or into the water. It is a tiny sound and
     it is the whole difference between rain as a texture and rain as something
     falling on a particular place: leaf-litter knocks, stone rings, and water
     answers with the rising note everybody knows and nobody can place. */
  playDrip(az, into) {
    const ac = this.ac, t = ac.currentTime + 0.02;
    const pan = this.makeCheapPan(az, 2 + this.rng()*3);
    pan.out.connect(this.bedDetail);
    const r = this.rng;
    if (into === "water") {
      // a plop: the pitch *rises* as the cavity closes behind the drop
      note(ac, pan.node, t, 360 + r()*260, 900 + r()*520, 0.075, 0.105);
      burst(ac, pan.node, t, 1400 + r()*900, 1.4, 0.02, 0.030);
    } else if (into === "stone") {
      note(ac, pan.node, t, 2400 + r()*1400, 1500 + r()*700, 0.07, 0.055);
      burst(ac, pan.node, t, 4800 + r()*2600, 2.6, 0.024, 0.048);
    } else if (into === "leaves") {
      burst(ac, pan.node, t, 1900 + r()*1300, 1.1, 0.042, 0.100);
      note(ac, pan.node, t, 1200 + r()*500, 620 + r()*260, 0.045, 0.050);
    } else {
      burst(ac, pan.node, t, 1500 + r()*900, 1.0, 0.05, 0.048);
    }
    this.retire(pan, 0.5);
  }

  /* A stroke of lightning, and the roll it sends after itself. The flash goes
     to the scene at once and the sound waits out the distance at a third of a
     kilometre a second, which is the only thing that has ever told anybody how
     far away a storm is. Far strokes are duller as well as later — the air
     takes the top off a rumble over a few kilometres — and longer, because
     what arrives has come off more of the sky. */
  playThunder() {
    const ac = this.ac, r = this.rng;
    const far = 0.18 + r()*0.82;
    this.scene.lightning(far);
    const delaySec = 0.7 + far*13;
    this.once(() => {
      if (!this.running || state.weather !== "rain") return;
      const t = ac.currentTime + 0.02;
      const dur = 2.4 + far*6.5;
      const src = this.wideNoise();
      const lp = ac.createBiquadFilter();
      lp.type = "lowpass";
      const cut = 2500 - far*2050;
      lp.frequency.setValueAtTime(cut*1.7, t);
      lp.frequency.exponentialRampToValueAtTime(Math.max(80, cut*0.4), t + dur);
      const hp = ac.createBiquadFilter();
      hp.type = "highpass"; hp.frequency.value = 26;
      const g = ac.createGain();
      const peak = 0.085 - far*0.062;
      g.gain.setValueAtTime(0.0001, t);
      // the leading edge — a crack near, a swell far off — then the roll,
      // which is two or three swells of it before the long fall away
      g.gain.exponentialRampToValueAtTime(peak, t + 0.03 + far*0.9);
      let u = 0.35 + far*0.9;
      while (u < dur*0.8) {
        g.gain.exponentialRampToValueAtTime(peak*(0.3 + r()*0.55), t + u);
        u += 0.35 + r()*0.8;
      }
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      const pan = ac.createStereoPanner ? ac.createStereoPanner() : ac.createGain();
      if (pan.pan) pan.pan.value = (r()*2 - 1)*0.4;
      src.connect(hp); hp.connect(lp); lp.connect(g); g.connect(pan);
      // straight past the duck: a storm does not step back for a wren
      pan.connect(this.master);
      this.once(() => {
        try { src.stop(); } catch (e) { /* already stopped */ }
        disconnect(src, hp, lp, g, pan);
      }, (dur + 0.4)*1000);
    }, delaySec*1000);
  }

  /* Cattle on the far hill. A low is a long way down and a long way off: a
     falling note with a pair of formants over it, and no hurry about it. */
  playCattleLow(az) {
    const ac = this.ac, r = this.rng;
    const t = ac.currentTime + 0.02;
    const dur = 1.1 + r()*0.9;
    const pan = this.makeCheapPan(az, 14 + r()*8);
    pan.out.connect(this.voiceBus);
    const f0 = 108 + r()*26;
    // One broad formant low down, not a narrow one up at the fourth harmonic:
    // a cow is a big animal and almost all of a low is under 500 Hz.
    const bp = ac.createBiquadFilter();
    bp.type = "bandpass"; bp.frequency.value = 300 + r()*130; bp.Q.value = 0.9;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.26, t + 0.22);
    g.gain.setValueAtTime(0.26, t + dur*0.55);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    bp.connect(g); g.connect(pan.node);
    for (const [mult, amp] of [[1, 0.6], [2, 0.42], [3, 0.22], [4, 0.10]]) {
      const o = ac.createOscillator();
      o.type = "sawtooth";
      o.frequency.setValueAtTime(f0*mult, t);
      o.frequency.linearRampToValueAtTime(f0*mult*0.86, t + dur);
      const og = ac.createGain(); og.gain.value = amp;
      o.connect(og); og.connect(bp);
      o.start(t); o.stop(t + dur + 0.1);
    }
    this.duck(t, dur);
    this.retire(pan, dur + 1.2);
    this.emit({ id: "cattle", name: "Cattle", latin: "Bos taurus",
      desc: "a low from the far hill", tone: "sage" }, az, 16, dur);
  }

  /* Two trunks leaning on each other in the wind. A creak is one narrow band
     of noise being bent slowly about — the narrower and slower, the more it
     sounds like something under load rather than something breaking. */
  playCreak(az) {
    const ac = this.ac, r = this.rng;
    const t = ac.currentTime + 0.02;
    const dur = 0.9 + r()*1.4;
    const pan = this.makeCheapPan(az, 5 + r()*6);
    pan.out.connect(this.bedDetail);
    const src = this.loopNoise();
    const bp = ac.createBiquadFilter();
    bp.type = "bandpass"; bp.Q.value = 22 + r()*16;
    const f0 = 190 + r()*260;
    bp.frequency.setValueAtTime(f0, t);
    bp.frequency.linearRampToValueAtTime(f0*(1.5 + r()*0.9), t + dur*0.62);
    bp.frequency.linearRampToValueAtTime(f0*0.85, t + dur);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.50 + r()*0.30, t + dur*0.35);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bp); bp.connect(g); g.connect(pan.node);
    this.once(() => {
      try { src.stop(); } catch (e) { /* already stopped */ }
      disconnect(src, bp, g);
    }, (dur + 0.3)*1000);
    this.retire(pan, dur + 0.6);
  }

  /* The backwash dragging shingle down the beach: a band of hiss with a rattle
     shaken through it. It belongs to a particular wave, so the wave scheduler
     starts it as the water turns and takes it back down with the water. */
  playShingle(at, len, amp) {
    const ac = this.ac, r = this.rng;
    const pan = this.makeCheapPan((r()*2 - 1)*0.5, 5);
    pan.out.connect(this.bedDetail);
    const src = this.wideNoise();
    const bp = ac.createBiquadFilter();
    bp.type = "bandpass"; bp.frequency.value = 2100 + r()*1100; bp.Q.value = 0.9;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.linearRampToValueAtTime(amp, at + len*0.22);
    g.gain.exponentialRampToValueAtTime(0.0001, at + len);
    // the rattle: the individual stones, as a fast wobble on the level
    const lfo = ac.createOscillator();
    lfo.type = "sawtooth"; lfo.frequency.value = 21 + r()*13;
    const lg = ac.createGain(); lg.gain.value = amp*0.55;
    lfo.connect(lg); lg.connect(g.gain);
    lfo.start(at); lfo.stop(at + len + 0.05);
    src.connect(bp); bp.connect(g); g.connect(pan.node);
    this.once(() => {
      try { src.stop(); } catch (e) { /* already stopped */ }
      disconnect(src, bp, g, lg);
    }, (at - ac.currentTime + len + 0.4)*1000);
    this.retire(pan, at - ac.currentTime + len + 0.6);
  }

  /* Dry reeds knocking together when a gust goes through them: a scatter of
     ticks rather than a hiss, which is what tells reed from leaf. */
  playReedRattle(az, strength) {
    const ac = this.ac, r = this.rng;
    const pan = this.makeCheapPan(az, 3 + r()*4);
    pan.out.connect(this.bedDetail);
    const n = 4 + Math.floor(r()*7);
    let t = ac.currentTime + 0.02;
    for (let i = 0; i < n; i++) {
      burst(ac, pan.node, t, 2600 + r()*2600, 3.5, 0.022, (0.060 + r()*0.065)*strength);
      t += 0.03 + r()*0.10;
    }
    this.retire(pan, (t - ac.currentTime) + 0.6);
  }

  /* ---- when each of those happens ---- */

  /* Thunder is rare and mostly distant, because a storm directly overhead is
     not what this piece is for. It only ever comes with rain. */
  startThunderScheduler(gen) {
    const roll = () => {
      if (!this.running || gen !== this.gen) return;
      if (state.weather === "rain" && this.rng() < 0.55) this.playThunder();
      setTimeout(roll, 45000 + this.rng()*90000);
    };
    setTimeout(roll, 20000 + this.rng()*40000);
  }

  /* Drips. Rain falling on a surface is not the same sound as rain falling,
     and it goes on for a while after the rain itself has stopped — which is
     the detail that makes a wood sound wet rather than merely rained on. */
  startDripScheduler(gen) {
    const into = { forest: "leaves", city: "stone", wetland: "water",
                   beach: "ground", meadow: "leaves" };
    const drip = () => {
      if (!this.running || gen !== this.gen) return;
      const now = performance.now();
      if (state.weather === "rain") this.wetUntil = now + 50000;
      if (this.wetUntil && now < this.wetUntil) {
        // thinning out as the ground dries, so the last ones are far apart
        const wet = Math.min(1, (this.wetUntil - now)/50000);
        if (this.rng() < 0.35 + wet*0.5) {
          this.playDrip((this.rng()*2 - 1)*0.85, into[state.location] || "ground");
        }
      }
      setTimeout(drip, 260 + this.rng()*1500);
    };
    setTimeout(drip, 4000 + this.rng()*6000);
  }

  /* Cattle, but only the ones actually standing on the hill. */
  startCattleScheduler(gen) {
    const low = () => {
      if (!this.running || gen !== this.gen) return;
      const herd = (state.location === "meadow" && this.scene.cattle) || [];
      if (herd.length && this.activeVoices < this.voiceCap() && this.rng() < 0.5
          && performance.now() >= this.quietUntil) {
        const cw = herd[Math.floor(this.rng()*herd.length)];
        this.playCattleLow(Math.max(-1, Math.min(1, (cw.x*2 - 1)*0.85)));
      }
      setTimeout(low, 34000 + this.rng()*62000);
    };
    setTimeout(low, 15000 + this.rng()*30000);
  }

  /* Timber, when there is enough wind in the wood to load it. */
  startTimberScheduler(gen) {
    const creak = () => {
      if (!this.running || gen !== this.gen) return;
      const windy = state.weather === "breeze" ? 1
        : state.weather === "rain" ? 0.5 : state.weather === "fog" ? 0.3 : 0.22;
      if (state.location === "forest" && this.rng() < windy*0.7) {
        this.playCreak((this.rng()*2 - 1)*0.8);
      }
      setTimeout(creak, 12000 + this.rng()*26000);
    };
    setTimeout(creak, 9000 + this.rng()*14000);
  }

  clearTimers() {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
  }

  resumeSchedulers() {
    this.activeVoices = 0;   // a paused engine clears its in-flight voice timers
    this.duelUntil = 0;
    const gen = ++this.gen;  // stamp this run; older scheduler loops self-stop
    this.startGusts(gen); this.startSwells(gen); this.startBreath(gen);
    this.startSchedulers(gen);
    this.startCritterVoiceScheduler(gen);
    this.startFlyerScheduler(gen);
    this.startWaveScheduler(gen); this.startLapScheduler(gen);
    this.startCarScheduler(gen); this.startBellScheduler(gen);
    this.startThunderScheduler(gen); this.startDripScheduler(gen);
    this.startCattleScheduler(gen); this.startTimberScheduler(gen);
  }

  /* Silence, and the schedulers stopped. The master gain is cut to nothing
     first: calls already handed to the audio clock would otherwise resume
     mid-phrase when the context does. */
  pause() {
    this.running = false;
    this._duckUntil = 0;
    if (this.bedDuck) {
      const d = this.bedDuck.gain;
      d.cancelScheduledValues(this.ac ? this.ac.currentTime : 0);
      d.value = 1;
    }
    this.gen++;              // halt every recurring scheduler loop
    this.clearTimers();
    for (const chain of this.live) chain.dispose();
    this.live.clear();
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
