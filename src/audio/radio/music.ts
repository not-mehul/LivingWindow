/**
 * Music theory for the built-in generative lofi station: keys, jazzy
 * seventh-chord progressions, voicings and track metadata. Pure functions so
 * the generator's choices can be unit tested.
 */

export function midiToFrequency(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

export const CHORD_QUALITIES = {
  maj7: [0, 4, 7, 11],
  maj9: [0, 4, 7, 11, 14],
  m7: [0, 3, 7, 10],
  m9: [0, 3, 7, 10, 14],
  dom7: [0, 4, 7, 10],
  dom9: [0, 4, 7, 10, 14],
} as const;

export type ChordQuality = keyof typeof CHORD_QUALITIES;

export interface ChordSymbol {
  /** Semitones above the key's tonic. */
  degree: number;
  quality: ChordQuality;
}

const I = (q: ChordQuality = 'maj7'): ChordSymbol => ({ degree: 0, quality: q });
const ii = (q: ChordQuality = 'm7'): ChordSymbol => ({ degree: 2, quality: q });
const iii = (q: ChordQuality = 'm7'): ChordSymbol => ({ degree: 4, quality: q });
const IV = (q: ChordQuality = 'maj7'): ChordSymbol => ({ degree: 5, quality: q });
const V = (q: ChordQuality = 'dom7'): ChordSymbol => ({ degree: 7, quality: q });
const vi = (q: ChordQuality = 'm7'): ChordSymbol => ({ degree: 9, quality: q });

export const PROGRESSIONS: readonly ChordSymbol[][] = [
  [ii('m9'), V('dom9'), I('maj9'), vi('m7')],
  [I('maj7'), vi('m9'), ii('m7'), V('dom7')],
  [IV('maj9'), iii('m7'), ii('m9'), I('maj7')],
  [vi('m9'), ii('m7'), V('dom9'), I('maj7')],
  [I('maj9'), IV('maj7'), iii('m7'), vi('m9')],
  [ii('m7'), iii('m7'), IV('maj9'), V('dom7')],
];

/**
 * Voice a chord around a centre note: each tone is moved to the octave
 * nearest the centre, giving smooth, compact "piano hands" voicings.
 */
export function voiceChord(tonic: number, chord: ChordSymbol, center = 62): number[] {
  const root = tonic + chord.degree;
  const notes = CHORD_QUALITIES[chord.quality].map((interval) => {
    let note = root + interval;
    while (note - center > 6) note -= 12;
    while (center - note > 6) note += 12;
    return note;
  });
  return [...new Set(notes)].sort((a, b) => a - b);
}

/** Bass note for a chord: its root, in the low register. */
export function bassNote(tonic: number, chord: ChordSymbol): number {
  let note = tonic + chord.degree;
  while (note >= 46) note -= 12;
  while (note < 34) note += 12;
  return note;
}

export interface Track {
  title: string;
  /** MIDI note of the key's tonic. */
  tonic: number;
  bpm: number;
  /** 0.5 = straight eighths; ~0.6 = lazy swing. */
  swing: number;
  progression: ChordSymbol[];
  bars: number;
}

const ADJECTIVES = ['Rainy', 'Sleepy', 'Late', 'Quiet', 'Foggy', 'Amber', 'Soft', 'Midnight', 'Hazy', 'Warm', 'Slow', 'Paper'];
const NOUNS = ['Window', 'Rooftop', 'Tram', 'Lanterns', 'Tea', 'Pigeons', 'Static', 'Streetlights', 'Sill', 'Clouds', 'Notebook', 'Avenue'];

export function createTrack(rng: () => number = Math.random): Track {
  const pick = <T>(items: readonly T[]) => items[Math.floor(rng() * items.length)];
  return {
    title: `${pick(ADJECTIVES)} ${pick(NOUNS)}`,
    // Keys from Bb2 up to F3, comfortable for warm voicings.
    tonic: 46 + Math.floor(rng() * 8),
    bpm: 70 + Math.floor(rng() * 17),
    swing: 0.55 + rng() * 0.08,
    progression: pick(PROGRESSIONS),
    bars: 24 + 8 * Math.floor(rng() * 3),
  };
}

/** Seconds per 16th-note step, with swing applied to every off-beat 16th pair. */
export function stepDuration(bpm: number, swing: number, step: number): number {
  const eighth = 60 / bpm / 2;
  // Each eighth note is split into two 16ths: long-short when swung.
  return step % 2 === 0 ? eighth * swing : eighth * (1 - swing);
}
