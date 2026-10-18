import { describe, expect, it } from 'vitest';
import { createRng } from '../../core/random';
import { bassNote, CHORD_QUALITIES, createTrack, midiToFrequency, PROGRESSIONS, stepDuration, voiceChord } from './music';

describe('music theory', () => {
  it('converts MIDI notes to frequencies', () => {
    expect(midiToFrequency(69)).toBe(440);
    expect(midiToFrequency(57)).toBe(220);
    expect(midiToFrequency(60)).toBeCloseTo(261.63, 1);
  });

  it('voices every chord compactly around the centre with the right pitch classes', () => {
    for (const progression of PROGRESSIONS) {
      for (const chord of progression) {
        const notes = voiceChord(50, chord, 62);
        expect(Math.max(...notes) - Math.min(...notes)).toBeLessThanOrEqual(12);
        for (const n of notes) expect(Math.abs(n - 62)).toBeLessThanOrEqual(6);
        const expected = new Set(CHORD_QUALITIES[chord.quality].map((i) => (50 + chord.degree + i) % 12));
        expect(new Set(notes.map((n) => n % 12))).toEqual(expected);
      }
    }
  });

  it('keeps the bass in a low register on the chord root', () => {
    for (const chord of PROGRESSIONS.flat()) {
      const note = bassNote(53, chord);
      expect(note).toBeGreaterThanOrEqual(34);
      expect(note).toBeLessThan(46);
      expect(Math.abs((note - 53 - chord.degree) % 12)).toBe(0);
    }
  });

  it('generates varied, sensible tracks', () => {
    const rng = createRng(12);
    const tracks = Array.from({ length: 50 }, () => createTrack(rng));
    for (const t of tracks) {
      expect(t.bpm).toBeGreaterThanOrEqual(70);
      expect(t.bpm).toBeLessThanOrEqual(86);
      expect(t.swing).toBeGreaterThanOrEqual(0.55);
      expect(t.swing).toBeLessThan(0.64);
      expect(t.bars % 4).toBe(0);
      expect(t.title).toMatch(/^\w+ \w+$/);
    }
    expect(new Set(tracks.map((t) => t.title)).size).toBeGreaterThan(20);
  });

  it('swings sixteenths without changing the tempo', () => {
    const bpm = 80;
    const beat = 60 / bpm;
    let bar = 0;
    for (let step = 0; step < 16; step++) bar += stepDuration(bpm, 0.6, step);
    expect(bar).toBeCloseTo(beat * 4);
    expect(stepDuration(bpm, 0.6, 0)).toBeGreaterThan(stepDuration(bpm, 0.6, 1));
    expect(stepDuration(bpm, 0.5, 0)).toBeCloseTo(stepDuration(bpm, 0.5, 1));
  });
});
