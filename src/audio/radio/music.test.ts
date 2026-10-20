import { describe, expect, it } from 'vitest';
import { createRng } from '../../core/random';
import {
  bassNote,
  CHORD_QUALITIES,
  chordAt,
  chordTones,
  createMotif,
  createTrack,
  melodyNote,
  midiToFrequency,
  PROGRESSIONS,
  sectionAt,
  stepDuration,
  stepPosition,
  varyMotif,
  voiceChord,
  voiceLead,
} from './music';

const ALL_CHORDS = Object.values(PROGRESSIONS).flat(2);

describe('music theory', () => {
  it('converts MIDI notes to frequencies', () => {
    expect(midiToFrequency(69)).toBe(440);
    expect(midiToFrequency(57)).toBe(220);
    expect(midiToFrequency(60)).toBeCloseTo(261.63, 1);
  });

  it('voices every chord compactly around the centre with the right pitch classes', () => {
    for (const chord of ALL_CHORDS) {
      const notes = voiceChord(50, chord, 62);
      expect(Math.max(...notes) - Math.min(...notes)).toBeLessThanOrEqual(12);
      for (const n of notes) expect(Math.abs(n - 62)).toBeLessThanOrEqual(6);
      const expected = new Set(CHORD_QUALITIES[chord.quality].map((i) => (50 + chord.degree + i) % 12));
      expect(new Set(notes.map((n) => n % 12))).toEqual(expected);
    }
  });

  it('voice-leads: each chord moves as little as it can from the last', () => {
    for (const progression of Object.values(PROGRESSIONS).flat()) {
      let previous: number[] | null = null;
      for (const chord of [...progression, ...progression]) {
        const notes = voiceLead(50, chord, previous);
        for (const n of notes) {
          expect(n).toBeGreaterThanOrEqual(53);
          expect(n).toBeLessThanOrEqual(74);
          expect(chordTones(50, chord)).toContain(n % 12);
        }
        if (previous) {
          // Smoother than simply re-voicing around a fixed centre.
          const moved = (to: number[]) => to.reduce((s, n) => s + Math.min(...previous!.map((p) => Math.abs(p - n))), 0);
          expect(moved(notes)).toBeLessThanOrEqual(moved(voiceChord(50, chord, 63)));
        }
        previous = notes;
      }
    }
  });

  it('keeps the bass in a low register on the chord root', () => {
    for (const chord of ALL_CHORDS) {
      const note = bassNote(53, chord);
      expect(note).toBeGreaterThanOrEqual(34);
      expect(note).toBeLessThan(46);
      expect(Math.abs((note - 53 - chord.degree) % 12)).toBe(0);
    }
  });

  it('generates varied, sensible tracks with a song form', () => {
    const rng = createRng(12);
    const tracks = Array.from({ length: 50 }, () => createTrack(rng));
    for (const t of tracks) {
      expect(t.bpm).toBeGreaterThanOrEqual(68);
      expect(t.bpm).toBeLessThanOrEqual(86);
      expect(t.swing).toBeGreaterThanOrEqual(0.56);
      expect(t.swing).toBeLessThan(0.64);
      expect(t.title).toMatch(/^\w+ \w+$/);
      expect(t.sections[0].name).toBe('intro');
      expect(t.sections[t.sections.length - 1].name).toBe('outro');
      expect(t.sections.some((s) => s.name === 'B')).toBe(true);
      expect(t.bars).toBe(t.sections.reduce((n, s) => n + s.bars, 0));
      expect(t.bars).toBeGreaterThanOrEqual(30);
    }
    expect(new Set(tracks.map((t) => t.title)).size).toBeGreaterThan(20);
    expect(new Set(tracks.map((t) => t.mode)).size).toBe(3);
  });

  it('finds the section and chord for every bar', () => {
    const track = createTrack(createRng(4));
    expect(sectionAt(track, 0).section.name).toBe('intro');
    expect(sectionAt(track, track.bars - 1).section.name).toBe('outro');
    const a = track.sections[1];
    // Chords that last two bars sound for both.
    const loop = a.progression.reduce((n, ch) => n + (ch.bars ?? 1), 0);
    for (let bar = 0; bar < loop; bar++) expect(a.progression).toContain(chordAt(a, bar).chord);
    expect(chordAt(a, 0).first).toBe(true);
  });

  it('swings the off-beat eighths late without changing the tempo', () => {
    const bpm = 80;
    const beat = 60 / bpm;
    let bar = 0;
    for (let step = 0; step < 16; step++) bar += stepDuration(bpm, 0.6, step);
    expect(bar).toBeCloseTo(beat * 4);
    // The "and" of each beat lands 60% of the way through it, not halfway.
    expect(stepPosition(2, 0.6)).toBeCloseTo(0.6);
    expect(stepPosition(6, 0.6)).toBeCloseTo(0.6);
    expect(stepDuration(bpm, 0.6, 0) + stepDuration(bpm, 0.6, 1)).toBeGreaterThan(stepDuration(bpm, 0.6, 2) + stepDuration(bpm, 0.6, 3));
    // Straight time is even.
    expect(stepDuration(bpm, 0.5, 0)).toBeCloseTo(stepDuration(bpm, 0.5, 2));
  });

  it('writes motifs that leave space and vary on repeats', () => {
    const rng = createRng(8);
    for (let i = 0; i < 30; i++) {
      const motif = createMotif(rng);
      expect(motif.notes.length).toBeGreaterThan(0);
      for (const n of motif.notes) expect(n.step).toBeLessThan(motif.bars * 16);
      expect(varyMotif(motif, 0, rng)).toEqual(motif.notes);
    }
  });

  it('puts melody notes on chord tones in the lead register', () => {
    for (const chord of ALL_CHORDS) {
      for (let tone = 0; tone < 6; tone++) {
        const note = melodyNote(50, chord, tone);
        expect(note).toBeGreaterThanOrEqual(67);
        expect(note).toBeLessThan(67 + 24);
        expect(chordTones(50, chord)).toContain(note % 12);
      }
    }
  });
});
