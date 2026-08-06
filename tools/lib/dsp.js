/* The measuring stick, shared by everything that measures.

   `voice.mjs` takes the piece's synthesised calls apart, `texture.mjs` takes
   its beds apart, and `reference.mjs` does both to real field recordings. A
   comparison between the piece and the world is worth exactly nothing unless
   the two sides are measured by the same instrument, so the instrument lives
   here and all three import it in the page.

   Everything below works on a plain Float32Array of samples plus a sample
   rate. Nothing here knows about Web Audio, the scene, or the app. */

/* ---- an FFT, because a DFT is too slow to do this honestly ----------------
   The first version of the voice bench used a naive O(N²) transform. That is
   fine for three frames of one call and hopeless for two hundred frames of
   seventy-seven recordings — it would have been half an hour of arithmetic,
   which in practice means the comparison does not get made. Radix-2,
   in-place, real input. */
export function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2*Math.PI/len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len/2; k++) {
        const ur = re[i + k], ui = im[i + k];
        const vr = re[i + k + len/2]*cr - im[i + k + len/2]*ci;
        const vi = re[i + k + len/2]*ci + im[i + k + len/2]*cr;
        re[i + k] = ur + vr; im[i + k] = ui + vi;
        re[i + k + len/2] = ur - vr; im[i + k + len/2] = ui - vi;
        const ncr = cr*wr - ci*wi;
        ci = cr*wi + ci*wr; cr = ncr;
      }
    }
  }
}

const _win = new Map();
function hann(N) {
  let w = _win.get(N);
  if (w) return w;
  w = new Float64Array(N);
  for (let i = 0; i < N; i++) w[i] = 0.5 - 0.5*Math.cos(2*Math.PI*i/(N - 1));
  _win.set(N, w);
  return w;
}

/* Magnitude spectrum of one Hann-windowed frame starting at `at`. */
export function spectrumAt(d, at, N) {
  const re = new Float64Array(N), im = new Float64Array(N);
  const w = hann(N);
  for (let i = 0; i < N; i++) re[i] = (d[at + i] || 0)*w[i];
  fft(re, im);
  const mag = new Float64Array(N/2);
  for (let k = 0; k < N/2; k++) mag[k] = Math.hypot(re[k], im[k]);
  return mag;
}

/* The spectral centroid of one frame, counting only what is actually there.

   Every empty bin sits on the analysis floor, and a thousand bins on the
   floor outweigh the handful carrying the signal — which is how a cow's low
   and a church bell can both measure five kilohertz. Everything more than
   40 dB below the loudest bin is bed noise or nothing, and is not counted.

   This rule was written down in `texture.mjs` and then not applied: the
   helper carrying it was dead code and the measurement inlined an
   unthresholded version, so every bed's centroid was pulled toward the
   middle of the spectrum by the analyser's own silence. */
export function centroidOf(mag, sr, N) {
  let top = 0;
  for (let k = 2; k < mag.length; k++) if (mag[k] > top) top = mag[k];
  if (top <= 0) return -1;
  const cut = top*0.01;                       // 40 dB down
  let num = 0, den = 0;
  for (let k = 2; k < mag.length; k++) {
    if (mag[k] < cut) continue;
    num += mag[k]*k*sr/N; den += mag[k];
  }
  return den > 0 ? num/den : -1;
}

/* The envelope, as the running peak over a short hop.

   Walking raw samples for an attack time does not work, and the way it fails
   is silent: a sine passes through zero every half cycle, so a walk back from
   the peak "while the sample is loud" stops at the first crossing and every
   voice reports an attack of half a millisecond. */
export const ENV_HOP = 128;
export function envelope(d) {
  const e = new Float64Array(Math.ceil(d.length/ENV_HOP));
  for (let i = 0; i < e.length; i++) {
    let m = 0;
    const end = Math.min(d.length, (i + 1)*ENV_HOP);
    for (let j = i*ENV_HOP; j < end; j++) { const v = Math.abs(d[j]); if (v > m) m = v; }
    e[i] = m;
  }
  return e;
}

/* Sub-bin frequency of a peak, by fitting a parabola through it and its two
   neighbours. Without it the estimate is quantised to the bin spacing, and a
   held note wavering seven cents at 400 Hz moves a fourteenth of one bin. */
function refine(mag, k) {
  if (k < 1 || k >= mag.length - 1) return k;
  const l = Math.log(Math.max(1e-30, mag[k - 1]));
  const m = Math.log(Math.max(1e-30, mag[k]));
  const r = Math.log(Math.max(1e-30, mag[k + 1]));
  const den = l - 2*m + r;
  return k + (den !== 0 ? Math.max(-0.5, Math.min(0.5, 0.5*(l - r)/den)) : 0);
}

/* Energy in a narrow band about a frequency, in bins. */
function bandE(mag, kf, half) {
  let e = 0;
  const k0 = Math.max(1, Math.round(kf - half)), k1 = Math.min(mag.length - 1, Math.round(kf + half));
  for (let k = k0; k <= k1; k++) e += mag[k]*mag[k];
  return e;
}

/* The fundamental. The loudest partial is usually it, but not always — a
   voice whose second partial dominates would otherwise be reported an octave
   high, which then makes its harmonics look like nothing. So the loudest peak
   is tested against the hypothesis that it is really the second or third
   partial of something lower. */
function findF0(mag, sr, N) {
  let top = 0, topK = 1;
  for (let k = 2; k < mag.length - 1; k++) if (mag[k] > top) { top = mag[k]; topK = k; }
  if (top <= 0) return 0;
  let best = topK;
  for (const div of [2, 3]) {
    const k = topK/div;
    if (k < 3) continue;
    // a real sub-harmonic carries a fair share; a spurious one carries none
    if (bandE(mag, k, 2) > bandE(mag, topK, 2)*0.08) { best = k; break; }
  }
  return refine(mag, Math.round(best))*sr/N;
}

/* What a voice is made of, measured on the loudest note.

   `harmonics`  the share of *harmonic* energy that is not in the fundamental.
                Summed at k·f0 only, so background noise, wind and other birds
                in a field recording do not count toward it. A pure sine reads
                near 0; a reedy passerine reads 0.3 – 0.6.
   `breath`     the share of the frame's total energy that is not at any
                harmonic. A synthesised oscillator reads near 0. A real animal
                reads high — partly its own breath, partly the room it is in.
   `wobble`     scatter of the fundamental about its own trend, in per cent.
                Detrended, so an intentional glide is not counted as vibrato.
   `attack`     seconds from -30 dB to peak, off the envelope.
   `ad`         attack over decay.
   `crest`      peak over rms across the whole call. */
export function voiceMetrics(d, sr, opt) {
  const N = (opt && opt.N) || 2048, HOPF = N/4;
  const env = envelope(d);
  let pk = 0, pkAt = 0;
  for (let i = 0; i < d.length; i++) { const v = Math.abs(d[i]); if (v > pk) { pk = v; pkAt = i; } }
  if (pk < 1e-5) return null;

  let i0 = 0, i1 = d.length - 1;
  const gate = pk*0.03;
  while (i0 < d.length && Math.abs(d[i0]) < gate) i0++;
  while (i1 > i0 && Math.abs(d[i1]) < gate) i1--;
  if (i1 - i0 < N) return null;
  let s = 0;
  for (let i = i0; i < i1; i++) s += d[i]*d[i];
  const crest = pk/Math.max(1e-9, Math.sqrt(s/(i1 - i0)));

  /* Attack and decay, off the envelope — and only when the call is actually
     *isolated*. A synthesised call is rendered into silence, so the envelope
     really does fall 30 dB either side of the peak and the reading means
     something. A five-second field recording is a continuous scene: the level
     never drops to the floor, the walk runs to the edge of the clip, and the
     tool cheerfully reports that a real blackbird has a two-and-a-half-second
     attack. It has no such thing — the number is the length of the recording.
     Where the floor is never reached, there is no reading to give. */
  const ePk = Math.round(pkAt/ENV_HOP), lo = pk*0.0316;
  let a0 = ePk; while (a0 > 0 && env[a0] > lo) a0--;
  let d1 = ePk; while (d1 < env.length - 1 && env[d1] > lo) d1++;
  const isolated = a0 > 0 && d1 < env.length - 1;
  const attack = isolated ? (ePk - a0)*ENV_HOP/sr : null;
  const decay = isolated ? (d1 - ePk)*ENV_HOP/sr : null;

  const fr = [];
  const from = Math.max(0, pkAt - N), to = Math.min(d.length - N - 1, pkAt + sr*0.30);
  for (let at = from; at < to; at += HOPF) {
    const ei = Math.round((at + N/2)/ENV_HOP);
    if (!(env[ei] > pk*0.30)) continue;
    const mag = spectrumAt(d, at, N);
    const f0 = findF0(mag, sr, N);
    if (!(f0 > 30)) continue;
    const kf = f0*N/sr;
    if (kf < 3) continue;
    let tot = 0;
    for (let k = 2; k < mag.length; k++) tot += mag[k]*mag[k];
    let e1 = bandE(mag, kf, 2), up = 0;
    for (let h = 2; h <= 8; h++) {
      const k = kf*h;
      if (k >= mag.length - 2) break;
      up += bandE(mag, k, 2);
    }
    if (e1 + up <= 0 || tot <= 0) continue;
    fr.push({ t: (at + N/2)/sr, f: f0,
      harm: up/(e1 + up), breath: Math.max(0, 1 - (e1 + up)/tot) });
  }
  const ad = isolated ? attack/Math.max(1e-4, decay) : null;
  if (fr.length < 2) return { harmonics: null, breath: null, wobble: null,
    attack, ad, crest, f0: null };

  const mean = a => a.reduce((x, y) => x + y, 0)/a.length;
  let wobble = null;
  if (fr.length >= 5) {
    /* A glide is not a waver. Most notes sweep from one pitch to another on
       purpose, and the raw spread of the frequency track is mostly that
       sweep — so fit a line through it and take the scatter about the line. */
    const mt = mean(fr.map(x => x.t)), mf = mean(fr.map(x => x.f));
    let num = 0, den = 0;
    for (const x of fr) { num += (x.t - mt)*(x.f - mf); den += (x.t - mt)*(x.t - mt); }
    const slope = den > 0 ? num/den : 0;
    let v = 0;
    for (const x of fr) { const e = x.f - (mf + slope*(x.t - mt)); v += e*e; }
    wobble = Math.sqrt(v/fr.length)/Math.max(1, mf);
  }
  return { harmonics: mean(fr.map(x => x.harm)), breath: mean(fr.map(x => x.breath)),
    wobble, attack, ad, crest, f0: mean(fr.map(x => x.f)) };
}

/* What a bed is made of. Windows of 2048 samples every twenty milliseconds,
   which is what the live bed tap does, so a bed measured off a tap and a bed
   measured off a file are the same measurement. */
export function bedMetrics(d, sr) {
  const N = 2048, hop = Math.max(1, Math.round(sr*0.020));
  const lv = [], ce = [];
  for (let at = 0; at + N < d.length; at += hop) {
    let s = 0;
    for (let i = 0; i < N; i++) { const v = d[at + i]; s += v*v; }
    const rms = Math.sqrt(s/N);
    if (rms < 1e-6) continue;
    lv.push(rms);
    const c = centroidOf(spectrumAt(d, at, N), sr, N);
    if (c > 0) ce.push(c);
  }
  const sd = a => {
    if (a.length < 4) return [0, 0];
    const m = a.reduce((x, y) => x + y, 0)/a.length;
    const v = a.reduce((x, y) => x + (y - m)*(y - m), 0)/a.length;
    return [m, Math.sqrt(v)];
  };
  const [lm, ls] = sd(lv), [cm, cs] = sd(ce);
  return { flutter: ls/(lm || 1), drift: cs/(cm || 1), centroid: cm, n: lv.length };
}

export function median(a) {
  if (!a.length) return null;
  const s = a.slice().sort((x, y) => x - y);
  return s[s.length >> 1];
}
