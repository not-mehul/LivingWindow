/* ============================================================
   The audio engine — wind, aeolian drift, place-beds,
   turn-taking voices, and the odd church bell.

   Decoupled from the DOM and the canvas: the scene and the
   subtitle callback are injected, so this module never reaches
   for globals.
   ============================================================ */
import { mulberry32, REDUCED, state } from "./util.js?v=17";
import { SPECIES, CRITTER_VOICES, COUNTERSING, note, burst, noteTrain } from "./species.js?v=17";

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

/* What the loudness slider is worth at the output. Getting the beds down and
   the record into its place left the whole piece peaking at −21 dBFS with the
   slider at three quarters, which is a lot of headroom nobody is using and a
   window you have to turn the system up to hear. This spends it: measured at
   the busiest the piece gets, the peak lands around −15 dBFS with the limiter
   still untouched. It is the last thing in the chain, so it moves everything
   together and changes no balance. */
const OUTPUT = 1.9;
/* Where the city's record sits once it has been through its own compressor.
   With the mix slider at its default this puts it a few decibels over the
   city's own bed and in the same world as every other place — arriving in the
   city used to be a twenty-three decibel jump, which is a shock, not a scene. */
const MUSIC_TRIM = 0.27;

/* How long the land holds its breath after something has come through, and
   how long it takes to come back afterwards, in seconds. The hold is the
   striking part and it is deliberately long — a wood that goes quiet for four
   seconds has not been frightened, it has paused. The recovery is longer
   still, and shaped, so that what comes back is a place filling up rather
   than a switch being thrown.

   A fox comes through a meadow every minute or two. Silencing the land for
   three quarters of a minute every time it does would leave a third of the
   session in the aftermath of something, which is not an event any more —
   it is the weather. So it is both shorter than it first was and only
   sometimes raised at all: see ALARM_ODDS. */
const ALARM_HOLD = 10;
const ALARM_BACK = 22;
/* Not every fox is noticed, and not every bird that notices says so. Half is
   about right: often enough to be a thing the piece does, rare enough that it
   is still startling the fifth time. */
const ALARM_ODDS = 0.5;
const ALARM_CAUSE = {
  fox:    "a fox on the path",
  cat:    "a cat up on the wall",
  badger: "something heavy in the undergrowth",
  otter:  "an otter up among the ducks"
};

/* The room each place is heard in. `send` scales how much of a voice goes to
   the air at all, `tail` is how long the reflections take to come round again,
   `fb` how many times they do, and `tone` how dark they are by the time they
   arrive. These are the numbers, not a metaphor for them:

   - meadow: soft ground and nothing standing up. A little air, no tail.
   - forest: trunks close on every side — the most reflective natural place
     there is at short range, and the only one where the return is dense.
   - beach: the most open place in the piece. Sound goes out over the water and
     does not come back; almost dry, and what does return is long and dark.
   - wetland: flat water is a hard mirror with open sky above it — one long
     bright slap rather than a wash, which is most of why a wetland sounds
     like a wetland and not like a meadow with ducks on it.
   - city: hard walls a few metres off, a long tail down the street, and brick
     takes the top off everything before it gets back. */
const AIR = {
  meadow:  { send: 0.85, tail: 0.081, fb: 0.20, tone: 3200 },
  forest:  { send: 1.15, tail: 0.052, fb: 0.42, tone: 2600 },
  beach:   { send: 0.45, tail: 0.190, fb: 0.16, tone: 2100 },
  wetland: { send: 0.75, tail: 0.155, fb: 0.30, tone: 4200 },
  city:    { send: 1.05, tail: 0.128, fb: 0.46, tone: 1900 }
};

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
    this.alarmAt = 0;         // when something last came through, ms
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
    const aLow = 1 - Math.exp(-2*Math.PI*800/fs);    // split point ~800 Hz
    /* And a roof on it. White noise carries as much power in the octave above
       ten kilohertz as in the whole of the rest of the spectrum, so splitting
       it and weighting the halves still left a measured centroid of 10.2 kHz
       — which is not rain, it is television static. Rain heard from inside a
       room is a wash between about five hundred hertz and five kilohertz.
       One pole is not enough roof: at six decibels an octave it still left the
       centroid at 8.4 kHz. Two of them, lower down, is what actually takes the
       sizzle off. */
    const aTop = 1 - Math.exp(-2*Math.PI*4200/fs);
    let low = 0, t1 = 0, t2 = 0;
    const twoPiOverN = 2*Math.PI / N;
    for (let i = 0; i < M; i++) {
      const w = Math.random()*2 - 1;
      low += aLow*(w - low);
      const high = w - low;
      t1 += aTop*(high - t1);
      t2 += aTop*(t1 - t2);
      const ph = twoPiOverN * (i % N);               // periodic over N → seamless
      const mod = 1 + 0.16*Math.sin(ph*2) + 0.10*Math.sin(ph*5 + 1.3);
      tmp[i] = (low*1.6 + t2*1.5) * mod;
    }

    /* The patter. A wash alone is the *sound* of rain without any of its
       grain: what tells you it is rain and not a fan is that it is made of
       individual impacts, thousands of them, each one a short ring on
       whatever it landed on. Written into the buffer rather than scheduled,
       so a downpour costs exactly what a drizzle does at run time — which is
       nothing, since this is read back as samples.

       Written across the whole of M, tail included, so the cross-fade below
       carries the drops over the seam like everything else. */
    const drops = Math.floor(seconds * 240);
    for (let k = 0; k < drops; k++) {
      const at = Math.floor(Math.random() * (M - 400));
      const f = 700 + Math.random()*2600;            // what it landed on
      const decay = 0.0025 + Math.random()*0.0055;
      const amp = 0.10 + Math.random()*0.30;
      const len = Math.min(400, Math.floor(decay*4*fs));
      const w = 2*Math.PI*f/fs, d = Math.exp(-1/(decay*fs));
      let env = amp;
      for (let j = 0; j < len; j++) {
        tmp[at + j] += Math.sin(w*j) * env * (0.6 + Math.random()*0.4);
        env *= d;
      }
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
    this.master.gain.value = state.volume * OUTPUT;
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
    this.voiceBus = ac.createGain();
    this.voiceBus.gain.value = VOICE_LEVEL * this.g("birds");
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

    /* The air a distant call has to cross: a handful of early reflections off
       the ground and whatever is standing about, rolled off at both ends and
       fed back just enough to hang for a moment. Near voices are sent almost
       none of it; far ones a good deal, which is what tells you they are far.

       Its *character* is the place, not the distance, and it is the strongest
       thing in the piece that says where you are — a wren in a wood and a wren
       on an open shore were arriving in the same room, which is the one thing
       a recording of either never does. So the tail, the feedback and the tone
       are set per place in `applyConditions`; see AIR. Three params on nodes
       that already exist, so a place costs nothing to change. */
    this.airIn = ac.createGain();
    this.airHP = ac.createBiquadFilter();
    this.airHP.type = "highpass"; this.airHP.frequency.value = 320;
    this.airLP = ac.createBiquadFilter();
    this.airLP.type = "lowpass"; this.airLP.frequency.value = 3400;
    for (const d of [0.031, 0.057, 0.089, 0.134]) {
      const dl = ac.createDelay(0.5); dl.delayTime.value = d;
      const g = ac.createGain(); g.gain.value = 0.42 - d;
      this.airIn.connect(dl); dl.connect(g); g.connect(this.airHP);
    }
    this.airTail = ac.createDelay(0.5); this.airTail.delayTime.value = 0.117;
    this.airFB = ac.createGain(); this.airFB.gain.value = 0.33;
    this.airHP.connect(this.airLP);
    this.airLP.connect(this.airTail); this.airTail.connect(this.airFB);
    this.airFB.connect(this.airHP);
    /* The send is taken before the voice bus, so the return has to make up the
       bus's gain or a far bird would arrive with no air around it at all. */
    this.airGain = ac.createGain(); this.airGain.gain.value = 0.5*VOICE_LEVEL;
    this.airLP.connect(this.airGain);
    this.airGain.connect(this.voiceFilter);

    /* Wind. Two lowpasses on noise gives a rush and nothing else, and a rush
       whose level goes up and down is a fan being switched on and off. Real
       wind does two things a fan does not: it gets *brighter* as it gets
       stronger, because a stronger flow carries higher frequencies; and it
       finds edges to sound against, which is the moan under everything. So the
       cutoff rides the gust and there is a second, resonant path that only
       really appears when the gust is up. */
    this.windGain = ac.createGain(); this.windGain.gain.value = 0;
    this.windLP = ac.createBiquadFilter();
    this.windLP.type = "lowpass"; this.windLP.frequency.value = 420; this.windLP.Q.value = 0.4;
    const wlp2 = ac.createBiquadFilter(); wlp2.type = "lowpass"; wlp2.frequency.value = 1500;
    const wsrc = this.wideNoise();
    wsrc.connect(this.windLP); this.windLP.connect(wlp2); wlp2.connect(this.windGain);
    this.windGain.connect(this.bedBus);
    // the moan: one broad resonance somewhere in the lower midrange
    this.windMoan = ac.createGain(); this.windMoan.gain.value = 0;
    this.windMoanBP = ac.createBiquadFilter();
    this.windMoanBP.type = "bandpass";
    this.windMoanBP.frequency.value = 230; this.windMoanBP.Q.value = 3.2;
    wsrc.connect(this.windMoanBP); this.windMoanBP.connect(this.windMoan);
    this.windMoan.connect(this.bedBus);

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
      // a lower Q: fifty-five whistles, this breathes
      f.Q.value = 22 + this.rng()*10;
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

    /* Leaves. Steady high-passed noise is a hiss; what makes it a wood is that
       the sound is *granular* — thousands of small events, thickening and
       thinning several times a second. A second noise source taken down to a
       few hertz and used to modulate the level does exactly that, and costs
       two nodes: it is noise driving noise, which is what the real thing is. */
    this.leavesGain = ac.createGain(); this.leavesGain.gain.value = 0;
    const lhp = ac.createBiquadFilter(); lhp.type = "highpass"; lhp.frequency.value = 1500;
    const lbp = ac.createBiquadFilter();
    lbp.type = "lowpass"; lbp.frequency.value = 7000;     // not a cymbal
    this.leafTex = ac.createGain(); this.leafTex.gain.value = 1;
    this.wideNoise().connect(lhp); lhp.connect(lbp); lbp.connect(this.leafTex);
    this.leafTex.connect(this.leavesGain);
    this.leavesGain.connect(this.bedBus);
    const modSrc = this.loopNoise();
    const modLP = ac.createBiquadFilter();
    modLP.type = "lowpass"; modLP.frequency.value = 5.5; modLP.Q.value = 0.7;
    const modAmt = ac.createGain(); modAmt.gain.value = 26;   // pink noise is small
    modSrc.connect(modLP); modLP.connect(modAmt); modAmt.connect(this.leafTex.gain);

    // Traffic. A lowpass at 120 Hz is a subwoofer with nothing on it; a city
    // heard from a window is that rumble *plus* a wash of tyre noise several
    // octaves up, and it is the wash that says street rather than earthquake.
    this.trafficGain = ac.createGain(); this.trafficGain.gain.value = 0;
    const tsrc = this.wideNoise();
    const tlp = ac.createBiquadFilter(); tlp.type = "lowpass"; tlp.frequency.value = 140;
    tsrc.connect(tlp); tlp.connect(this.trafficGain);
    const twash = ac.createBiquadFilter();
    twash.type = "bandpass"; twash.frequency.value = 620; twash.Q.value = 0.45;
    const twg = ac.createGain(); twg.gain.value = 0.42;
    tsrc.connect(twash); twash.connect(twg); twg.connect(this.trafficGain);
    this.trafficGain.connect(this.bedBus);

    /* Surf body — the low roar of the sea, approaching and dragging back.

       The wave scheduler sweeps this filter and this gain, so during a wave
       it moves plenty. Between waves it did not move at all, and the sea
       between waves is most of the time: a fixed lowpass on steady noise held
       at one level is the definition of static. So it breathes on its own as
       well, slowly and shallowly — the swell that is always there under the
       waves that break out of it. */
    this.surfGain = ac.createGain(); this.surfGain.gain.value = 0;
    this.surfFilter = ac.createBiquadFilter();
    this.surfFilter.type = "lowpass"; this.surfFilter.frequency.value = 400;
    /* The base sits below unity because the modulation is *added* to it: a
       gain of one with noise swinging around it averages more than one and
       peaks a great deal more, which put ten decibels back on the beach and
       took a bird's headroom there from twelve to six. Base and depth are set
       together so the mean comes out where it was. */
    this.surfTex = ac.createGain(); this.surfTex.gain.value = 0.82;
    this.wideNoise().connect(this.surfFilter);
    this.surfFilter.connect(this.surfTex);
    this.surfTex.connect(this.surfGain);
    this.surfGain.connect(this.bedBus);
    const smod = this.loopNoise();
    const smodLP = ac.createBiquadFilter();
    smodLP.type = "lowpass"; smodLP.frequency.value = 1.1; smodLP.Q.value = 0.7;
    const smodAmt = ac.createGain(); smodAmt.gain.value = 11;
    smod.connect(smodLP); smodLP.connect(smodAmt); smodAmt.connect(this.surfTex.gain);

    /* Surf foam — a wave breaking and washing back.

       This was a high-pass at 1100 on pink noise and nothing else, which
       measured a spectral centroid of 8.6 kHz: that is a cymbal, or static,
       and it is not what water sounds like. Breaking water lives between
       about seven hundred hertz and four kilohertz — there is very little of
       it above that, and what there is is the *spray*, not the wave. So the
       band is closed at both ends now.

       And it is made granular. Foam is thousands of bubbles bursting, which
       is why the leaf bed's trick — a second noise source taken down to a few
       hertz and used to modulate the level — is exactly the right one here
       too. Two nodes, and it is noise driving noise, which is what the real
       thing is. Without it the level holds far too still to be liquid. */
    this.surfFoamGain = ac.createGain(); this.surfFoamGain.gain.value = 0;
    this.surfFoamFilter = ac.createBiquadFilter();
    this.surfFoamFilter.type = "highpass"; this.surfFoamFilter.frequency.value = 700;
    const foamTop = ac.createBiquadFilter();
    foamTop.type = "lowpass"; foamTop.frequency.value = 4200; foamTop.Q.value = 0.5;
    this.foamTex = ac.createGain(); this.foamTex.gain.value = 0.74;
    const foamSrc = this.wideNoise();
    foamSrc.connect(this.surfFoamFilter);
    this.surfFoamFilter.connect(foamTop);
    foamTop.connect(this.foamTex);
    this.foamTex.connect(this.surfFoamGain);
    // the bubbles: a few hertz of noise on the level, deeper than the leaves
    const fmod = this.loopNoise();
    const fmodLP = ac.createBiquadFilter();
    fmodLP.type = "lowpass"; fmodLP.frequency.value = 7.5; fmodLP.Q.value = 0.7;
    const fmodAmt = ac.createGain(); fmodAmt.gain.value = 17;   // pink noise is small
    fmod.connect(fmodLP); fmodLP.connect(fmodAmt); fmodAmt.connect(this.foamTex.gain);
    // A broad band low down passes a great deal of pink noise — at a Q of a
    // half and a gain of a half this alone put seventeen decibels back on the
    // beach and buried the birds again. It wants to be a suggestion of body
    // between the sub and the sizzle, not a third bed.
    const roll = ac.createBiquadFilter();
    roll.type = "bandpass"; roll.frequency.value = 520; roll.Q.value = 1.1;
    const rollG = ac.createGain(); rollG.gain.value = 0.14;
    foamSrc.connect(roll); roll.connect(rollG); rollG.connect(this.surfFoamGain);
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

  /* An exponential ramp cannot reach zero, and Web Audio throws rather than
     rounding. Any peak worked out from a mix group can be exactly zero — the
     slider is allowed all the way down — so every such ramp goes through here
     and lands on silence-in-all-but-name instead. */
  ramp(param, v, t) {
    param.exponentialRampToValueAtTime(v > 1e-5 ? v : 1e-5, t);
  }

  /* How much of a group the listener has asked for. Every level in the engine
     goes through this, so a slider is a coefficient rather than another node in
     the graph — and a group turned right down genuinely stops costing anything,
     because the schedulers check it before they build anything at all. */
  g(group) {
    const m = state.mix || {};
    return m[group] === undefined ? 1 : m[group];
  }

  /* Re-apply everything a slider could have changed. */
  applyMix() {
    if (!this.ac) return;
    this.set(this.voiceBus.gain, VOICE_LEVEL * this.g("birds"), 0.15);
    this.applyConditions();          // which re-applies the beds, and the music
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

  /* How far into the night it is, 0 to 1. Borrowed from the scene rather than
     worked out again from `state.time`: the scene crossfades between the four
     hours, so this is a curve rather than four steps, and the sound of the
     place turns over at exactly the rate the light does. */
  nightness() {
    return this.scene && this.scene.nightness ? this.scene.nightness() : 0;
  }

  applyConditions() {
    if (!this.ac) return;
    const L = state.location;
    /* The weather arrives as three dials rather than a name, so every table
       below is a formula over them. It is not only for the sake of a
       transition: the sky can now be halfway between two weathers and stay
       there, and a bed worked out from `wx` is right in that state without
       anybody having had to name it.

       `night` is the hour, and it is here because a place does not sound the
       same at three in the morning as at noon. The air is stiller, the ground
       is cooler and carries less, and there is simply less of everything. */
    const wx = state.wx;
    const night = this.nightness();

    /* Every bed level came down between eight and fourteen decibels, and the
       spread between a still day and a windy one came down with it: five
       times the wind for a breeze was a different room, not a windier one. */
    const locWind = { meadow: 1, forest: 0.75, beach: 1.25, wetland: 0.9, city: 0.5 };
    const stillNight = 1 - night*0.32;         // the wind drops after dark
    this.windBase = (0.030 + wx.gust*0.042 + wx.haze*0.006)
                  * locWind[L] * stillNight;
    this.set(this.windGain.gain, this.windBase * this.g("weather"));
    if (this.windMoan) this.set(this.windMoan.gain, this.windBase * 0.16 * this.g("weather"), 2);
    const locAeo = { meadow: 1, forest: 0.55, beach: 0.7, wetland: 0.8, city: 0.3 };
    this.aeoBase = (0.24 + wx.gust*0.40 + wx.haze*0.16 - wx.wet*0.14)
                 * locAeo[L] * 0.062 * stillNight;
    this.set(this.aeoGain.gain, this.aeoBase * this.g("weather"), 2);
    this.rainTarget = 0.038 * wx.wet;
    this.set(this.rainGain.gain, this.rainTarget * (this.breath || 1) * this.g("weather"));
    // Leaf hiss follows the wind: a still, clear night in the wood is quiet.
    const leafBase = L === "forest" ? 0.034 : L === "wetland" ? 0.017 : 0;
    this.leafTarget = leafBase * (0.32 + wx.gust*1.45 + wx.wet*0.7) * stillNight;
    this.set(this.leavesGain.gain, this.leafTarget * (this.breath || 1) * this.g("weather"));
    /* A city empties out overnight. It never goes silent — a town at four in
       the morning still hums — but the difference between that and the middle
       of the afternoon is most of what tells you which one you are in. */
    this.set(this.trafficGain.gain,
      (L === "city" ? 0.030 * (1 - night*0.55) : 0) * this.g("town"));
    // The sea's resting hiss between waves — kept low so the waves themselves carry.
    this.surfFloor = L === "beach" ? 0.008 * (0.9 + wx.gust*0.55 + wx.wet*0.3) : 0;
    this.set(this.surfGain.gain, this.surfFloor * this.g("water"));
    if (this.surfFoamGain && L !== "beach") this.set(this.surfFoamGain.gain, 0, 0.4);
    /* Haze takes the top off a voice, and so does the hour: night air is dense
       and a call across it arrives duller as well as further away. */
    this.set(this.voiceFilter.frequency,
      12000 - wx.haze*9000 - night*2200, 0.8);

    /* The room. Haze is the one a listener will actually notice: fog does not
       reflect, it absorbs, so a foggy morning anywhere is a shorter, darker
       room than the same place clear — which is the whole reason fog sounds
       like fog rather than merely looking like it. Rain damps it too, being
       water on every surface that would otherwise have sent the sound back. */
    const air = AIR[L] || AIR.meadow;
    const damp = 1 - wx.haze*0.38 - wx.wet*0.18;
    this.airRoom = air.send * damp;
    this.set(this.airFB.gain, air.fb * damp, 1.5);
    this.set(this.airLP.frequency, air.tone * (1 - wx.haze*0.30), 1.5);
    /* A delay line whose time is *ramped* is a delay line being pitch-shifted,
       and sliding the tail from a wood's fifty milliseconds to a shore's
       hundred and ninety is a swoop nobody asked for. So the return is taken
       down for a quarter of a second, the time is moved in one step under the
       cover of that, and it comes back. The direct sound never stops. */
    if (Math.abs(this.airTail.delayTime.value - air.tail) > 0.002) {
      const t = this.ac.currentTime, level = this.airGain.gain.value;
      const gn = this.airGain.gain;
      gn.cancelScheduledValues(t);
      gn.setValueAtTime(level, t);
      gn.linearRampToValueAtTime(0.0001, t + 0.12);
      this.airTail.delayTime.setValueAtTime(air.tail, t + 0.13);
      gn.setValueAtTime(0.0001, t + 0.16);
      gn.linearRampToValueAtTime(level, t + 0.34);
    }
    this.applyMusic();
  }

  setVolume(v) {
    if (this.ac) this.set(this.master.gain, v * OUTPUT, 0.15);
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
    // a new seed is a new session, so the loop is drawn again with it
    this.disposeMusic();
    this.aeolianFilters.forEach((f, i) => {
      f.frequency.setTargetAtTime(root * mode[i % mode.length] * (i >= mode.length ? 2 : 1),
        this.ac.currentTime, 2.5);
    });
    this.applyMusic();
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
      send.gain.value = Math.min(0.6, depth*0.042) * (this.airRoom || 1);
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
        // birds sit out heavy rain and sing less in thick air
        const wcut = (1 - state.wx.wet*0.68) * (1 - state.wx.haze*0.22);
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
      const gw = this.g("weather");
      this.set(this.windGain.gain, this.windBase * (this.breath || 1) * f * gw, 1.6);
      // brighter under load, and the moan comes up with it
      this.set(this.windLP.frequency, 300 + f*520, 2.0);
      this.set(this.windMoan.gain, this.windBase * (this.breath || 1) * gw
        * Math.max(0, f - 0.7) * 0.5, 2.4);
      this.set(this.windMoanBP.frequency, 190 + f*130, 3.0);
      // What the wind does to the leaves is the same thing it does to the
      // grass you can see moving: the two should rise and fall together.
      if (this.leafTarget) {
        this.set(this.leavesGain.gain,
          this.leafTarget * (this.breath || 1) * (0.4 + f*0.85) * this.g("weather"), 2.2);
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
      this.set(this.windGain.gain, this.windBase * this.breath * this.g("weather"), 26);
      this.set(this.rainGain.gain, (this.rainTarget || 0) * this.breath * this.g("weather"), 24);
      this.set(this.surfGain.gain, this.surfFloor * this.breath * this.g("water"), 22);
      if (this.leafTarget)
        this.set(this.leavesGain.gain, this.leafTarget * this.breath * this.g("weather"), 24);
      setTimeout(breathe, 24000 + this.rng()*16000);
    };
    setTimeout(breathe, 3000);
  }

  /* The shape of an hour, and of the day.

     Two things multiplied. The *tide* is the slow one the piece always had:
     over four to seven minutes the land fills up and empties again, and it
     swings widest at dawn and dusk when a wood really does go from empty to
     full and back within the hour.

     Over that sits the day itself, and the dawn chorus is the whole point of
     it. Which birds are awake is already the species' own `weights`; what
     that could never say is that at first light *everything sings at once*,
     far more than the sum of who happens to be up. So dawn is worth nearly
     twice an afternoon, dusk something less than that, and the small hours
     are left to the two or three voices that own them.

     And the third term is the alarm: something has come through, and for a
     while afterwards nothing says anything. It does not switch back on — the
     land creeps back over half a minute, because that is what it does. */
  chorusCurve() {
    const t = (this.ac ? this.ac.currentTime : 0);
    const slow = 0.5 + 0.5*Math.sin(t*2*Math.PI/(this.chorusPeriod || 300) + (this.chorusPh || 0));
    const swing = (state.time === "dawn" || state.time === "dusk") ? 0.8 : 0.34;
    const hour = { dawn: 1.85, day: 1, dusk: 1.35, night: 0.7 }[state.time] || 1;
    return (1 - swing*0.5 + swing*slow) * hour * this.settle();
  }

  /* How far the land has come back since it was frightened. 0 while it is
     still holding its breath, then up to 1 over the following half-minute. */
  settle() {
    if (!this.alarmAt) return 1;
    const since = (performance.now() - this.alarmAt)/1000;
    if (since > ALARM_HOLD + ALARM_BACK) { this.alarmAt = 0; return 1; }
    if (since < ALARM_HOLD) return 0;
    const u = (since - ALARM_HOLD)/ALARM_BACK;
    return u*u;                      // slowest at first, which is how it goes
  }

  /* ============================================================
     Something has come through.

     A fox in the meadow, a cat up on the wall, an otter surfacing among the
     ducks. One bird sees it and says so — and then the whole place shuts up,
     which is the part that carries. A wood going silent is far louder than
     anything in it, and nothing else in the piece does it.

     Who says it is drawn from the birds actually present and weighted by
     `alarm` in `species.js`: a blackbird or a magpie will scold anything that
     moves, a chiffchaff will not. The call is the species' own voice — there
     is no separate alarm synth — but it is placed near, said two or three
     times over, and it does not wait its turn.
     ============================================================ */
  alarm(x, cause) {
    if (!this.ac || !this.running) return;
    const now = performance.now();
    // Once is enough: a second fox two seconds later is the same fox.
    if (this.alarmAt && now - this.alarmAt < (ALARM_HOLD + ALARM_BACK)*1000*0.6) return;
    if (this.g("birds") < 0.02) return;
    if (this.rng() > ALARM_ODDS) return;      // it went through unremarked

    const here = SPECIES.filter(s => s.alarm && s.habitats.includes(state.location)
      && (s.weights[state.time] || 0) > 0.02);
    if (!here.length) return;
    let total = 0;
    for (const s of here) total += s.alarm * (s.weights[state.time] || 0);
    let pick = this.rng() * total, sp = here[here.length - 1];
    for (const s of here) {
      pick -= s.alarm * (s.weights[state.time] || 0);
      if (pick <= 0) { sp = s; break; }
    }

    /* Near, and on the side it came from. An alarm is not a song from across
       the valley — it is a bird four feet above the thing it is shouting at. */
    const at = Math.max(0.06, Math.min(0.94, x + (this.rng() - 0.5)*0.18));
    this.alarmAt = now;
    this.quietUntil = now + ALARM_HOLD*1000;
    const scene = this.scene;
    /* Said two or three times over, one after the other — *after*, not on top
       of. Fixed spacing put three of a blackbird's calls inside the length of
       one of them, three overlapping voices at arm's length, and the master
       went from −16 to −5 dBFS and into the limiter. So each repeat is booked
       from the length the last one actually turned out to be, which is also
       what a bird scolding something does: it says it, then says it again. */
    let says = 2 + Math.floor(this.rng()*2);
    const say = () => {
      if (!this.running || says-- <= 0) return;
      /* Straight to the graph rather than through performCall: that would
         raise an actor and wait for it to arrive, and the whole point is that
         this bird is already there and already going. Near, but not on your
         shoulder — close enough to be the loudest thing for a moment. */
      const az = Math.max(-1, Math.min(1, (at*2 - 1)*0.9));
      /* Near — a few feet above the thing it is shouting at — and at full
         level, which makes it the loudest voice in the piece by a few
         decibels. That is the whole point of it and it needs no help: a
         ninety-second soak appears to show the alarm putting twelve decibels
         on the master peak, but the same soak with no alarms at all ranges
         from −14.8 to −5.8 dBFS between runs. That spread is thunder, which
         is random and bypasses the duck by design. Measured properly — quiet
         ground, twelve of each, medians — an alarm lands a few decibels over
         an ordinary call, which is what it should do. */
      const pan = this.makePanner(az, 0.6, 2.1 + this.rng()*1.7);
      pan.out.connect(this.voiceBus);
      const dur = sp.synth(this.ac, pan.node, this.ac.currentTime + VOICE_LEAD, this.rng) || 1;
      this.duck(this.ac.currentTime + VOICE_LEAD, dur);
      this.retire(pan, VOICE_LEAD + dur + 2);
      this.once(say, (dur + 0.24 + this.rng()*0.4) * 1000);
    };
    say();
    // and the frame empties, a beat after the first bird has said why
    this.once(() => { if (scene && scene.flush) scene.flush(x); }, 240);
    this.emit({ id: "alarm", name: sp.name, latin: sp.latin,
      desc: "the alarm — " + (ALARM_CAUSE[cause] || "something in the grass"),
      tone: "amber" }, (at*2 - 1)*0.9, 3, 2.4);
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
      this.set(g.gain, (0.04 + this.rng()*0.24) * this.g("weather"), 2.2);
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
        const gw = this.g("water");
        /* A wave should be the loudest thing on a beach and it was: measured
           at the master, the shore sat eight to twelve decibels above every
           other place and a bird had nine decibels of room instead of twenty.
           The sea still carries — it is simply no longer the whole picture. */
        const bodyPeak = (this.surfFloor + (0.011 + this.rng()*0.009) * big) * gw;
        const foamPeak = (0.010 + this.rng()*0.008) * big * gw;

        // Body: the swell rolls in, then drags back out (a low roar).
        const g = this.surfGain.gain;
        g.cancelScheduledValues(t);
        g.setValueAtTime(Math.max(0.0001, this.surfFloor*gw), t);
        g.linearRampToValueAtTime(bodyPeak, crest);
        g.setTargetAtTime(Math.max(0.0001, this.surfFloor*gw), crest, dur*0.28);
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
        /* Stones in the backwash, and quietly: this runs on every wave, so
           measured across a minute it *is* a bed, and at the level a one-off
           cue wants it was louder than the sea itself. */
        this.playShingle(crest + 0.22, 1.4 + this.rng()*1.4,
          (0.0013 + this.rng()*0.0015)*big);
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
      if (state.location === "wetland" && this.ac && this.g("water") > 0.02) {
        const az = (this.rng()*2 - 1) * 0.8;
        if (this.rng() < 0.22) {
          const pan = this.makeCheapPan(az, 4 + this.rng()*6);
          pan.out.connect(this.bedDetail);
          note(this.ac, pan.node, this.ac.currentTime + 0.02,
            290 + this.rng()*160, 90, 0.09, 0.030*this.g("water"));
          this.retire(pan, 1.2);
          this.scene.fishRise((az/0.8 + 1) / 2);
        } else {
          const pan = this.makeCheapPan(az, 3 + this.rng()*5);
          pan.out.connect(this.bedDetail);
          burst(this.ac, pan.node, this.ac.currentTime + 0.02,
            480 + this.rng()*320, 1.2, 0.25, 0.009*this.g("water"));
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
      if (state.location === "city" && this.ac && this.g("town") > 0.02 && this.rng() < 0.75) {
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
        this.ramp(g.gain, 0.013*this.g("town"), t + dur*0.45);
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
      if (state.location === "city" && this.ac && state.cue.bell
          && this.g("town") > 0.02 && this.rng() < 0.65) this.playBell();
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
      const gt = this.g("town");
      const parts = [[0.5, 0.030*gt], [1, 0.05*gt], [1.183, 0.026*gt],
                     [1.506, 0.018*gt], [2, 0.028*gt]];
      for (const [ra, ga] of parts) {
        const o = ac.createOscillator();
        o.type = "sine"; o.frequency.value = f0 * ra;
        const g = ac.createGain();
        g.gain.setValueAtTime(0.0001, t);
        this.ramp(g.gain, ga, t + 0.012);
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
    const gm = this.g("weather");
    if (gm < 0.02) return;
    const pan = this.makeCheapPan(az, 2 + this.rng()*3);
    pan.out.connect(this.bedDetail);
    const r = this.rng;
    if (into === "water") {
      // a plop: the pitch *rises* as the cavity closes behind the drop
      note(ac, pan.node, t, 360 + r()*260, 900 + r()*520, 0.075, 0.105*gm);
      burst(ac, pan.node, t, 1400 + r()*900, 1.4, 0.02, 0.030*gm);
    } else if (into === "stone") {
      note(ac, pan.node, t, 2400 + r()*1400, 1500 + r()*700, 0.07, 0.055*gm);
      burst(ac, pan.node, t, 4800 + r()*2600, 2.6, 0.024, 0.048*gm);
    } else if (into === "leaves") {
      burst(ac, pan.node, t, 1900 + r()*1300, 1.1, 0.042, 0.100*gm);
      note(ac, pan.node, t, 1200 + r()*500, 620 + r()*260, 0.045, 0.050*gm);
    } else {
      burst(ac, pan.node, t, 1500 + r()*900, 1.0, 0.05, 0.048*gm);
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
    if (!state.cue.thunder || this.g("weather") < 0.02) return;
    const far = 0.18 + r()*0.82;
    this.scene.lightning(far);
    const delaySec = 0.7 + far*13;
    this.once(() => {
      /* Sound travels: this fires up to fourteen seconds after the flash, and
         in that time the weather group may have gone to nothing. Ask again. */
      const gw = this.g("weather");
      if (!this.running || state.wx.wet < 0.25 || gw < 0.02) return;
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
      const peak = (0.085 - far*0.062) * gw;
      g.gain.setValueAtTime(0.0001, t);
      // the leading edge — a crack near, a swell far off — then the roll,
      // which is two or three swells of it before the long fall away
      this.ramp(g.gain, peak, t + 0.03 + far*0.9);
      let u = 0.35 + far*0.9;
      while (u < dur*0.8) {
        this.ramp(g.gain, peak*(0.3 + r()*0.55), t + u);
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
    if (this.g("birds") < 0.02) return;
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
    const gm = this.g("weather");
    if (gm < 0.02) return;
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
    g.gain.exponentialRampToValueAtTime((0.50 + r()*0.30)*gm, t + dur*0.35);
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
    amp *= this.g("water");
    if (amp < 0.0005) return;
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
    strength *= this.g("weather");
    if (strength < 0.02) return;
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

  /* ============================================================
     The city's lo-fi.

     A window open over a street at night, and somebody two floors down has
     something on. It is the only music in the piece and it sounds in one place
     only, which is the whole justification for it: in a meadow it would be an
     intrusion, in a city it is what a city sounds like through a window.

     Everything about it is built to stay out of the way. It is slow, it is
     soft, it is behind a lowpass with the top rolled off the way a wall rolls
     it off, and it steps back for a bird like the rest of the ambience. The
     harmony is four bars of a minor seventh loop drawn from the session seed,
     so it is the same music all session and different music next time.

     It is scheduled with a look-ahead, which is the only way to make a rhythm
     out of Web Audio that does not stutter: a timer every quarter of a second
     books whatever falls inside the next second against the audio clock, and
     the timer's own jitter never reaches the sound.
     ============================================================ */
  startMusic() {
    const ac = this.ac;
    if (this.musicOn) return;
    /* The graph outlives a pause: leaving the city and coming back should not
       cost a rebuild. Only the look-ahead loop stops and starts. */
    if (!this.musicGain) this.buildMusic();
    this.mNext = ac.currentTime + 0.35;   // the bar line was lost while it slept
    this.musicOn = true;
    const tick = () => {
      if (!this.musicOn) return;
      this.scheduleMusic();
      this.musicTimer = setTimeout(tick, 250);
    };
    tick();
  }

  buildMusic() {
    const ac = this.ac, r = this.rng;
    this.musicGain = ac.createGain();
    this.musicGain.gain.value = this.g("music");
    // the wall between you and it
    // A wall, not a blanket: low enough to be warm and unmistakably filtered,
    // high enough that the hats and the top of the keys are still there. At
    // two kilohertz the whole thing was muffled past the point of listening.
    const wall = ac.createBiquadFilter();
    wall.type = "lowpass"; wall.frequency.value = 3400; wall.Q.value = 0.5;
    const warm = ac.createBiquadFilter();
    warm.type = "highpass"; warm.frequency.value = 55;
    /* Glue. Measured at the master, the kit's transient stood twenty-five
       decibels over the record's own average and the whole city jumped
       twenty-three decibels above the meadow the moment you arrived — the
       loudest thing in the piece by a long way, which is not what somebody
       else's music two floors down does. A record has been through a
       compressor, and this is what makes the genre sound like the genre: the
       kick sits down into the keys instead of standing on top of them. Slow
       release, soft knee, and it never sees a bird — it is only on the music.
       Measured after the trim it takes the crest from 23 dB to 17.5 and leans
       fifteen decibels on a peak. Web Audio's compressor makes its own gain
       back, so a lower threshold is also a louder record; MUSIC_TRIM is set
       against these settings and wants re-measuring if they change. */
    const glue = ac.createDynamicsCompressor();
    glue.threshold.value = -40; glue.knee.value = 18; glue.ratio.value = 8;
    glue.attack.value = 0.004; glue.release.value = 0.22;
    /* The parts run into the compressor hot enough for it to work, and the
       whole record is brought down to its place in the piece afterwards — a
       trim after the glue rather than a quiet input before it, or the
       threshold never gets touched and the kick walks out over everything. */
    this.musicIn = ac.createGain(); this.musicIn.gain.value = 1;
    this.musicTrim = ac.createGain(); this.musicTrim.gain.value = MUSIC_TRIM;
    this.musicIn.connect(warm); warm.connect(glue);
    glue.connect(wall); wall.connect(this.musicTrim);
    this.musicTrim.connect(this.musicGain);
    // it ducks with the beds, so a bird still comes through it
    this.musicGain.connect(this.bedDuck);

    /* Tape wow — a few cents of drift, which is the difference between a
       synthesiser and something played back off a worn cassette. It is worked
       out from the clock rather than run off an LFO node: a shared oscillator
       would have to be wired into every key's `detune` and unwired again when
       the note ended, and there are a thousand notes an hour. Two automation
       events on a param the note already owns cost nothing and leak nothing,
       and every note in a bar reads the same curve, so the whole chord drifts
       together the way a real one does. */
    this.wowRate = 0.31 + r()*0.14;
    this.wowCents = 5.5;

    /* Vinyl: the noise floor a record has, and the crackle on it.

       Two things were wrong with this and they compounded. It ran *into* the
       compressor, so between beats — when the only signal is the noise floor
       — the glue released and its makeup gain lifted the hiss by the better
       part of twenty decibels. And the hiss itself measured a flutter of
       0.039, which is to say it did not move at all: the flattest thing in
       the piece, and the textbook description of static.

       So it goes in *after* the glue and is never compressed, keeping the
       wall and the trim, which is where a record's surface noise belongs
       anyway — it is on the record, not in the mastering. It is darker, and a
       third of what it was. And it is granular, by the same trick the leaves
       use: surface noise crackles, it does not hiss. The clicks that carry
       most of the character are scheduled per bar in `playBar`. */
    this.vinylGain = ac.createGain(); this.vinylGain.gain.value = 0.011;
    const vhp = ac.createBiquadFilter(); vhp.type = "highpass"; vhp.frequency.value = 420;
    const vlp = ac.createBiquadFilter(); vlp.type = "lowpass"; vlp.frequency.value = 2600;
    const vsrc = this.wideNoise();
    this.vinylTex = ac.createGain(); this.vinylTex.gain.value = 0.8;
    vsrc.connect(vhp); vhp.connect(vlp); vlp.connect(this.vinylTex);
    this.vinylTex.connect(this.vinylGain);
    this.vinylGain.connect(wall);            // past the glue: never pumped
    /* The crackle has its own way in. Sending it through `vinylGain` put it
       through the hiss's own level — a hundredth — and a click at a hundredth
       of its amplitude is not a click. It is surface noise like the hiss, so
       it takes the same route past the glue, but at its own level. */
    this.vinylCrackle = ac.createGain(); this.vinylCrackle.gain.value = 0.5;
    this.vinylCrackle.connect(wall);
    const vmod = this.loopNoise();
    const vmodLP = ac.createBiquadFilter();
    vmodLP.type = "lowpass"; vmodLP.frequency.value = 9; vmodLP.Q.value = 0.7;
    const vmodAmt = ac.createGain(); vmodAmt.gain.value = 16;
    vmod.connect(vmodLP); vmodLP.connect(vmodAmt); vmodAmt.connect(this.vinylTex.gain);
    this.musicNodes = [vsrc, vhp, vlp, this.vinylTex, this.vinylGain, this.vinylCrackle,
                       vmod, vmodLP, vmodAmt,
                       this.musicIn, warm, glue, wall, this.musicTrim, this.musicGain];

    this.bpm = 70 + Math.floor(r()*14);            // slow, always
    this.beat = 60/this.bpm;
    this.swing = 0.14 + r()*0.06;
    // a root somewhere low and dark, and one of three loops over it
    const roots = [55, 58.27, 61.74, 65.41, 69.30];
    this.mRoot = roots[Math.floor(r()*roots.length)];
    const loops = [
      [[0, "m7"], [5, "m7"], [3, "maj7"], [-2, "7"]],     // i · iv · VI · V-of
      [[0, "m7"], [-4, "maj7"], [-2, "maj7"], [-5, "m7"]],
      [[0, "m9"], [3, "maj7"], [-2, "m7"], [-4, "maj7"]]
    ];
    this.mLoop = loops[Math.floor(r()*loops.length)];
    this.mBar = 0;
  }

  stopMusic() {
    this.musicOn = false;
    if (this.musicTimer) { clearTimeout(this.musicTimer); this.musicTimer = null; }
  }

  /* Pull the whole thing down — nodes and all. Stopping alone leaves the vinyl
     source looping into a silent gain, which is cheap but not free, and a new
     seed wants a new tempo anyway. */
  disposeMusic() {
    this.stopMusic();
    if (!this.musicNodes) { this.musicGain = null; return; }
    for (const n of this.musicNodes) {
      try { if (n.stop) n.stop(); } catch (e) { /* already stopped */ }
      try { n.disconnect(); } catch (e) { /* already unwired */ }
    }
    this.musicNodes = null;
    this.musicGain = null; this.musicIn = null; this.vinylGain = null;
  }

  /* Book everything that falls inside the next second. */
  scheduleMusic() {
    const ac = this.ac, horizon = ac.currentTime + 1.0;
    let guard = 0;
    while (this.mNext < horizon && guard++ < 8) {
      this.playBar(this.mNext, this.mBar % this.mLoop.length);
      this.mNext += this.beat*4;
      this.mBar++;
    }
    // if the tab has been away, do not try to catch up on a minute of bars
    if (this.mNext < ac.currentTime) this.mNext = ac.currentTime + 0.1;
  }

  /* The tape's drift in cents at a given moment on the audio clock. Two sines
     an irrational ratio apart, so it never quite repeats — a loop you can hear
     the period of is a worse artefact than no wow at all. */
  wowAt(t) {
    const w = this.wowRate;
    return this.wowCents * (Math.sin(t*w*6.2832)*0.68
                          + Math.sin(t*w*2.6180*6.2832)*0.32);
  }

  /* The intervals of a chord, from its name. */
  chordSteps(kind) {
    return kind === "maj7" ? [0, 4, 7, 11]
      : kind === "m9" ? [0, 3, 7, 10, 14]
      : kind === "7" ? [0, 4, 7, 10]
      : [0, 3, 7, 10];                                    // m7
  }

  /* One bar: the keys, the bass under them, a line over the top and a soft kit.

     Four identical bars going round is the thing a listener notices and then
     cannot stop noticing, so the bar knows where it sits in the loop. The last
     bar of the four opens up — a fill on the hats, no kick on the second half
     — and the melody only sounds over half of them, which is what makes the
     ones it does sound over land. */
  playBar(t0, idx) {
    const ac = this.ac, r = this.rng, B = this.beat;
    const [deg, kind] = this.mLoop[idx];
    const root = this.mRoot * Math.pow(2, deg/12);
    const steps = this.chordSteps(kind);
    const last = idx === this.mLoop.length - 1;

    /* Keys: two voicings a bar, struck softly and left to ring, each partial a
       triangle a few cents off its neighbour so the chord moves very slightly
       against itself — which is the whole sound of an old electric piano. The
       tape's wow rides every one of them. */
    for (const [at, len, vel] of [[0, B*2.2, 1], [B*2.5, B*1.6, 0.72]]) {
      const t = t0 + at;
      steps.forEach((st, i) => {
        const f = root * 4 * Math.pow(2, st/12) * (1 + (r() - 0.5)*0.004);
        const o = ac.createOscillator();
        o.type = i === 0 ? "sine" : "triangle";
        o.frequency.value = f;
        o.detune.setValueAtTime(this.wowAt(t), t);
        o.detune.linearRampToValueAtTime(this.wowAt(t + len), t + len);
        const g = ac.createGain();
        // the top of a chord is struck lighter than its root, on any keyboard
        const pk = (0.052 - i*0.008) * vel;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(Math.max(0.002, pk), t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + len);
        o.connect(g); g.connect(this.musicIn);
        o.start(t); o.stop(t + len + 0.05);
      });
    }

    // Bass: the root, and a passing note into the next bar.
    for (const [at, len, mult, pk] of [[0, B*1.5, 1, 0.13], [B*2.5, B*0.9, 1, 0.09]]) {
      const t = t0 + at;
      const o = ac.createOscillator();
      o.type = "sine"; o.frequency.value = root*mult;
      const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(pk, t + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, t + len);
      o.connect(g); g.connect(this.musicIn);
      o.start(t); o.stop(t + len + 0.05);
    }

    /* A line over the top, two octaves above the bass and only on some bars:
       three or four notes drawn from the chord with the ninth allowed in, all
       of them off the beat, none of them in a hurry. Two nodes for the whole
       phrase — `noteTrain` re-tunes one oscillator rather than raising one per
       note, which is what keeps a bar from costing anything. */
    if (r() < 0.62) {
      const tones = steps.concat(kind === "m9" ? [] : [14]);
      const ns = [];
      let at = (r() < 0.5 ? 0.5 : 1.5) * B;
      const count = 3 + (r() < 0.4 ? 1 : 0);
      for (let k = 0; k < count && at < B*3.9; k++) {
        const st = tones[Math.floor(r()*tones.length)];
        const f = root * 8 * Math.pow(2, st/12);
        const d = B * (0.4 + r()*0.55);
        ns.push({ t: t0 + at, f0: f, f1: f, dur: d, peak: 0.020 + r()*0.012 });
        at += B * (0.5 + Math.floor(r()*3)*0.5);
      }
      if (ns.length) noteTrain(ac, this.musicIn, ns, "triangle");
    }

    /* Kit: kick on one and the and-of-three, a brushed snare on two and four,
       and hats on the swung eighths — quiet enough to be a pulse, not a beat.
       The last bar of the loop drops its second kick and doubles the hats
       through the fourth beat, so the loop turns over instead of restarting. */
    this.kick(t0, 0.062);
    if (!last) this.kick(t0 + B*2.5, 0.046);
    this.snare(t0 + B, 0.032); this.snare(t0 + B*3, 0.032);
    for (let e = 0; e < 8; e++) {
      const sw = (e % 2) ? this.swing*B : 0;
      this.hat(t0 + e*B*0.5 + sw, (e % 2) ? 0.009 : 0.014);
    }
    if (last) {
      for (let e = 0; e < 4; e++) this.hat(t0 + B*3 + e*B*0.25, 0.007 + e*0.002);
    }
    /* And the crackle. With the hiss taken down to almost nothing this is
       what says record: a handful of small ticks a bar, none of them in the
       same place twice, most of them barely there and one now and then that
       you actually notice. They go past the glue with the rest of the
       surface noise — a compressor would even them out, and evenness is the
       one thing a scratch does not have. */
    const ticks = 2 + Math.floor(r()*4);
    for (let k = 0; k < ticks; k++) {
      const soft = r() < 0.75;
      burst(ac, this.vinylCrackle, t0 + r()*B*4,
        1800 + r()*4200, 4 + r()*5, 0.004 + r()*0.005,
        soft ? 0.05 + r()*0.10 : 0.22 + r()*0.30);
    }
  }

  kick(t, pk) {
    const ac = this.ac;
    const o = ac.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(115, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.11);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(pk, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.30);
    o.connect(g); g.connect(this.musicIn);
    o.start(t); o.stop(t + 0.35);
  }
  snare(t, pk) {
    // brushed rather than struck: no tone under it, and a slow-ish decay
    burst(this.ac, this.musicIn, t, 1500, 0.8, 0.13, pk);
    burst(this.ac, this.musicIn, t, 340, 1.6, 0.09, pk*0.5);
  }
  hat(t, pk) {
    burst(this.ac, this.musicIn, t, 7200, 1.1, 0.028, pk);
  }

  /* Music only ever sounds in the city, and only if it is wanted. */
  applyMusic() {
    if (!this.ac) return;
    const want = state.location === "city" && state.cue.music && this.g("music") > 0.02;
    if (want) {
      this.startMusic();
      this.set(this.musicGain.gain, this.g("music"), 0.4);
    } else if (this.musicGain) {
      /* Fade it out over a bar's worth of time and only then take the graph
         down, so a slider flicked past zero and back does not hard-cut. */
      this.set(this.musicGain.gain, 0, 0.4);
      this.stopMusic();
      this.once(() => {
        const still = state.location === "city" && state.cue.music && this.g("music") > 0.02;
        if (!still) this.disposeMusic();
      }, 1800);
    }
  }

  /* ---- when each of those happens ---- */

  /* Thunder is rare and mostly distant, because a storm directly overhead is
     not what this piece is for. It only ever comes with rain. */
  startThunderScheduler(gen) {
    const roll = () => {
      if (!this.running || gen !== this.gen) return;
      // a shower has to be more than a few drops before it has thunder in it
      if (state.wx.wet > 0.55 && this.rng() < 0.55) this.playThunder();
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
      // the ground goes on being wet in proportion to how wet it got
      if (state.wx.wet > 0.15) this.wetUntil = now + 50000*state.wx.wet;
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
      const windy = 0.18 + state.wx.gust*0.82;
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
    this.stopMusic();
    this._duckUntil = 0;
    this.alarmAt = 0;        // a shut window does not stay frightened
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
      g.setValueAtTime(state.volume * OUTPUT, this.ac.currentTime);
    }
    this.running = true;
    this.resumeSchedulers();
    this.applyMusic();
  }
}

export { AudioEngine };
