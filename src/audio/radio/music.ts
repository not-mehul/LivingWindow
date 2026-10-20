/**
 * Music theory for the built-in generative lofi station: keys and modes,
 * jazzy chord progressions, voice-led voicings, song form, swing, and
 * motif-based melodies. Pure functions so the generator's choices can be
 * unit tested.
 */

export function midiToFrequency(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

export const CHORD_QUALITIES = {
  maj7: [0, 4, 7, 11],
  maj9: [0, 4, 7, 11, 14],
  six9: [0, 4, 7, 9, 14],
  m7: [0, 3, 7, 10],
  m9: [0, 3, 7, 10, 14],
  m11: [0, 3, 7, 10, 14, 17],
  dom7: [0, 4, 7, 10],
  dom9: [0, 4, 7, 10, 14],
  sus: [0, 5, 7, 10, 14],
  m7b5: [0, 3, 6, 10],
} as const;

export type ChordQuality = keyof typeof CHORD_QUALITIES;

export interface ChordSymbol {
  /** Semitones above the key's tonic. */
  degree: number;
  quality: ChordQuality;
  /** How long it lasts, in bars (default 1). */
  bars?: number;
}

const c = (degree: number, quality: ChordQuality, bars = 1): ChordSymbol => ({ degree, quality, bars });

export type Mode = 'major' | 'dorian' | 'aeolian';

export const SCALES: Record<Mode, readonly number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  aeolian: [0, 2, 3, 5, 7, 8, 10],
};

/** Progressions by mode, each a loop of chords (lengths in bars). */
export const PROGRESSIONS: Record<Mode, readonly ChordSymbol[][]> = {
  major: [
    [c(2, 'm9'), c(7, 'dom9'), c(0, 'maj9', 2)],
    [c(0, 'maj7'), c(9, 'm9'), c(2, 'm7'), c(7, 'dom7')],
    [c(5, 'maj9'), c(4, 'm7'), c(2, 'm9'), c(0, 'maj7')],
    [c(9, 'm9'), c(2, 'm7'), c(7, 'dom9'), c(0, 'six9')],
    [c(0, 'maj9'), c(5, 'maj7'), c(4, 'm7'), c(9, 'm9')],
    // Borrowed iv: the wistful minor four.
    [c(0, 'maj7'), c(5, 'maj9'), c(5, 'm9'), c(0, 'six9')],
    [c(5, 'maj9', 2), c(7, 'sus'), c(7, 'dom9')],
    [c(4, 'm7'), c(9, 'dom7'), c(2, 'm9'), c(7, 'dom9')],
  ],
  dorian: [
    [c(0, 'm9', 2), c(5, 'dom9', 2)],
    [c(0, 'm11'), c(5, 'dom9'), c(3, 'maj7'), c(10, 'six9')],
    [c(0, 'm9'), c(10, 'maj9'), c(8, 'maj7'), c(7, 'm7')],
    [c(5, 'm9'), c(0, 'm11', 2), c(10, 'sus')],
  ],
  aeolian: [
    [c(0, 'm9'), c(8, 'maj7'), c(3, 'maj9'), c(10, 'dom9')],
    [c(0, 'm7'), c(5, 'm9'), c(8, 'maj9'), c(7, 'm7')],
    [c(5, 'm9'), c(10, 'dom9'), c(3, 'maj7'), c(8, 'maj9')],
    [c(0, 'm11', 2), c(8, 'maj9'), c(2, 'm7b5')],
  ],
};

/** The pitch classes (0..11, relative to C) of a chord in a key. */
export function chordTones(tonic: number, chord: ChordSymbol): number[] {
  return CHORD_QUALITIES[chord.quality].map((i) => (((tonic + chord.degree + i) % 12) + 12) % 12);
}

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

/**
 * Voice-lead into `chord` from the previous voicing: of all its compact
 * voicings within [low, high], pick the one whose notes move least from
 * where the hands already are. Without a previous voicing, voice it
 * around the middle of the range.
 */
export function voiceLead(tonic: number, chord: ChordSymbol, previous: readonly number[] | null, low = 53, high = 74): number[] {
  const tones = chordTones(tonic, chord);
  // Drop the fifth from fuller chords: it adds little but mud.
  const thin = tones.length > 4 ? tones.filter((_, i) => CHORD_QUALITIES[chord.quality][i] !== 7) : tones;
  const candidates: number[][] = [];
  for (let base = low; base <= high - 6; base++) {
    // Stack each tone at the first octave at or above `base`.
    const notes = thin.map((pc) => base + ((pc - base) % 12 + 12) % 12).sort((a, b) => a - b);
    if (notes[notes.length - 1] <= high) candidates.push(notes);
  }
  if (candidates.length === 0) return voiceChord(tonic, chord, (low + high) / 2);
  const centre = (low + high) / 2;
  const cost = (notes: number[]) => {
    if (!previous || previous.length === 0) return Math.abs(notes.reduce((s, n) => s + n, 0) / notes.length - centre);
    // Each note pairs with the nearest note of the last chord.
    return notes.reduce((s, n) => s + Math.min(...previous.map((p) => Math.abs(p - n))), 0);
  };
  return candidates.reduce((best, notes) => (cost(notes) < cost(best) ? notes : best));
}

/** Bass note for a chord: its root, in the low register. */
export function bassNote(tonic: number, chord: ChordSymbol): number {
  let note = tonic + chord.degree;
  while (note >= 46) note -= 12;
  while (note < 34) note += 12;
  return note;
}

export type DrumFeel = 'none' | 'light' | 'full' | 'half';

export interface Section {
  name: 'intro' | 'A' | 'B' | 'outro';
  bars: number;
  progression: readonly ChordSymbol[];
  drums: DrumFeel;
  /** Whether the lead plays its melody here. */
  melody: boolean;
  /** How open the tone is (a low-pass sweep): 0 = muffled, 1 = fully open. */
  brightness: number;
}

/** One note of a motif: when (16th step in the phrase), how long (steps), and which chord tone (0 = lowest in register). */
export interface MotifNote {
  step: number;
  length: number;
  tone: number;
}

/** A short melodic idea, repeated and varied through the A sections. */
export interface Motif {
  /** Phrase length in bars (1 or 2). */
  bars: number;
  notes: MotifNote[];
}

export interface Track {
  title: string;
  /** MIDI note of the key's tonic. */
  tonic: number;
  mode: Mode;
  bpm: number;
  /** Where the off-beat 8th falls within the beat: 0.5 = straight, ~0.6 = lazy swing. */
  swing: number;
  sections: Section[];
  bars: number;
  motif: Motif;
  lead: 'guitar' | 'bell';
}

const ADJECTIVES = ['Rainy', 'Sleepy', 'Late', 'Quiet', 'Foggy', 'Amber', 'Soft', 'Midnight', 'Hazy', 'Warm', 'Slow', 'Paper', 'Velvet', 'Dusty', 'Faded', 'Low'];
const NOUNS = ['Window', 'Rooftop', 'Tram', 'Lanterns', 'Tea', 'Pigeons', 'Static', 'Streetlights', 'Sill', 'Clouds', 'Notebook', 'Avenue', 'Puddles', 'Radiator', 'Moth', 'Balcony'];

/** A motif: a few notes on a lazy rhythm, leaving space. */
export function createMotif(rng: () => number): Motif {
  const bars = rng() < 0.5 ? 1 : 2;
  const notes: MotifNote[] = [];
  let step = Math.floor(rng() * 3) * 2;
  let tone = 1 + Math.floor(rng() * 3);
  const end = bars * 16 - 2;
  while (step < end && notes.length < bars * 5) {
    const length = [2, 2, 3, 4, 6][Math.floor(rng() * 5)];
    notes.push({ step, length, tone });
    // Mostly stepwise between chord tones, with the odd leap.
    tone = Math.max(0, Math.min(5, tone + [-1, -1, 1, 1, 0, 2, -2][Math.floor(rng() * 7)]));
    step += length + (rng() < 0.45 ? 2 + Math.floor(rng() * 2) * 2 : 0);
  }
  return { bars, notes };
}

/**
 * A variation on the motif for its `n`th repeat: the first and every other
 * repeat are as written; the others answer it, nudged up or down a chord
 * tone, with the last note held or dropped.
 */
export function varyMotif(motif: Motif, n: number, rng: () => number): MotifNote[] {
  if (n % 2 === 0) return motif.notes;
  const shift = rng() < 0.5 ? 1 : -1;
  const notes = motif.notes.map((note) => ({ ...note, tone: Math.max(0, note.tone + shift) }));
  if (notes.length > 2 && rng() < 0.5) notes.pop();
  else if (notes.length > 0) notes[notes.length - 1] = { ...notes[notes.length - 1], length: notes[notes.length - 1].length + 2 };
  return notes;
}

/** The melody pitch for a chord tone index, in the lead's register. */
export function melodyNote(tonic: number, chord: ChordSymbol, tone: number, low = 67): number {
  const tones = chordTones(tonic, chord).sort((a, b) => a - b);
  const above: number[] = [];
  for (let n = low; above.length < 8; n++) if (tones.includes(n % 12)) above.push(n);
  return above[Math.min(above.length - 1, tone)];
}

export function createTrack(rng: () => number = Math.random): Track {
  const pick = <T>(items: readonly T[]) => items[Math.floor(rng() * items.length)];
  const roll = rng();
  const mode: Mode = roll < 0.55 ? 'major' : roll < 0.85 ? 'dorian' : 'aeolian';
  const a = pick(PROGRESSIONS[mode]);
  let b = pick(PROGRESSIONS[mode]);
  if (b === a) b = PROGRESSIONS[mode][(PROGRESSIONS[mode].indexOf(a) + 1) % PROGRESSIONS[mode].length];
  const sections: Section[] = [
    { name: 'intro', bars: rng() < 0.5 ? 2 : 4, progression: a, drums: 'none', melody: false, brightness: 0.25 },
    { name: 'A', bars: 8, progression: a, drums: 'full', melody: true, brightness: 0.85 },
    { name: 'B', bars: 8, progression: b, drums: rng() < 0.5 ? 'light' : 'half', melody: false, brightness: 0.7 },
    { name: 'A', bars: 8, progression: a, drums: 'full', melody: true, brightness: 0.9 },
  ];
  if (rng() < 0.5) sections.push({ name: 'B', bars: 8, progression: b, drums: 'full', melody: rng() < 0.5, brightness: 0.8 });
  sections.push({ name: 'outro', bars: 4, progression: a, drums: 'none', melody: false, brightness: 0.3 });
  return {
    title: `${pick(ADJECTIVES)} ${pick(NOUNS)}`,
    // Keys from Bb2 up to F3, comfortable for warm voicings.
    tonic: 46 + Math.floor(rng() * 8),
    mode,
    bpm: 68 + Math.floor(rng() * 19),
    swing: 0.56 + rng() * 0.08,
    sections,
    bars: sections.reduce((n, s) => n + s.bars, 0),
    motif: createMotif(rng),
    lead: rng() < 0.6 ? 'guitar' : 'bell',
  };
}

/** Which section a bar falls in, and the bar's index within it. */
export function sectionAt(track: Track, bar: number): { section: Section; index: number; bar: number } {
  let start = 0;
  for (let i = 0; i < track.sections.length; i++) {
    const section = track.sections[i];
    if (bar < start + section.bars) return { section, index: i, bar: bar - start };
    start += section.bars;
  }
  const last = track.sections[track.sections.length - 1];
  return { section: last, index: track.sections.length - 1, bar: last.bars - 1 };
}

/** The chord sounding at a bar within a section (progressions loop through their chord lengths). */
export function chordAt(section: Section, barInSection: number): { chord: ChordSymbol; first: boolean; next: ChordSymbol } {
  const loop = section.progression.reduce((n, ch) => n + (ch.bars ?? 1), 0);
  let at = barInSection % loop;
  for (let i = 0; i < section.progression.length; i++) {
    const chord = section.progression[i];
    const length = chord.bars ?? 1;
    if (at < length) return { chord, first: at === 0, next: section.progression[(i + 1) % section.progression.length] };
    at -= length;
  }
  return { chord: section.progression[0], first: true, next: section.progression[1 % section.progression.length] };
}

/**
 * When a 16th-note step falls within its beat (as a fraction of the beat).
 * Swing pushes the off-beat 8th late, to `swing` of the way through the
 * beat, and the 16ths either side of it move with it.
 */
export function stepPosition(step: number, swing: number): number {
  switch (step % 4) {
    case 0:
      return 0;
    case 1:
      return swing / 2;
    case 2:
      return swing;
    default:
      return swing + (1 - swing) / 2;
  }
}

/** Seconds from one 16th-note step to the next, with swing applied. */
export function stepDuration(bpm: number, swing: number, step: number): number {
  const beat = 60 / bpm;
  const here = stepPosition(step, swing);
  const next = step % 4 === 3 ? 1 : stepPosition(step + 1, swing);
  return (next - here) * beat;
}
