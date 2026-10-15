import { describe, expect, it } from 'vitest';
import { dbToGain, DEFAULT_VOLUMES, loadAudioSettings, saveAudioSettings, volumeToGain } from './mixer';

class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  get length() {
    return this.data.size;
  }
  clear() {
    this.data.clear();
  }
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  key(index: number) {
    return [...this.data.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
  setItem(key: string, value: string) {
    this.data.set(key, value);
  }
}

describe('mixer', () => {
  it('maps slider positions to gain on a perceptual curve', () => {
    expect(volumeToGain(0)).toBe(0);
    expect(volumeToGain(1)).toBe(1);
    expect(volumeToGain(0.5)).toBe(0.25);
    expect(volumeToGain(2)).toBe(1);
    expect(volumeToGain(-1)).toBe(0);
  });

  it('converts decibels', () => {
    expect(dbToGain(0)).toBe(1);
    expect(dbToGain(-8)).toBeCloseTo(0.398, 3);
  });

  it('round-trips settings through storage', () => {
    const storage = new MemoryStorage();
    const settings = loadAudioSettings(storage);
    expect(settings.volumes).toEqual(DEFAULT_VOLUMES);
    settings.volumes.radio = 0.2;
    settings.muted = true;
    settings.radioOn = true;
    settings.streamUrl = 'https://radio.example/lofi';
    saveAudioSettings(settings, storage);
    expect(loadAudioSettings(storage)).toEqual(settings);
  });

  it('ignores corrupt or out-of-range saved values', () => {
    const storage = new MemoryStorage();
    storage.setItem('livingWindow.audio', '{"volumes":{"master":7,"weather":"loud"},"muted":"yes"}');
    const settings = loadAudioSettings(storage);
    expect(settings.volumes.master).toBe(1);
    expect(settings.volumes.weather).toBe(DEFAULT_VOLUMES.weather);
    expect(settings.muted).toBe(false);
    storage.setItem('livingWindow.audio', 'not json');
    expect(loadAudioSettings(storage).volumes).toEqual(DEFAULT_VOLUMES);
  });

  it('works without storage at all', () => {
    expect(loadAudioSettings(null).volumes).toEqual(DEFAULT_VOLUMES);
    expect(() => saveAudioSettings(loadAudioSettings(null), null)).not.toThrow();
  });
});
