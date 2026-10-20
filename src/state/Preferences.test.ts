import { describe, expect, it } from 'vitest';
import { DEFAULT_PREFERENCES, Preferences, sanitizePreferences } from './Preferences';

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (k) => data.get(k) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => void data.delete(k),
    setItem: (k, v) => void data.set(k, v),
  };
}

describe('preferences', () => {
  it('starts calm, on real time', () => {
    const prefs = new Preferences(memoryStorage());
    expect(prefs.get('calm')).toBe(true);
    expect(prefs.get('clockMode')).toBe('real');
  });

  it('remembers choices between visits', () => {
    const storage = memoryStorage();
    const prefs = new Preferences(storage);
    prefs.set('calm', false);
    prefs.set('rotateMinutes', 60);
    const again = new Preferences(storage);
    expect(again.get('calm')).toBe(false);
    expect(again.get('rotateMinutes')).toBe(60);
  });

  it('ignores anything malformed', () => {
    expect(sanitizePreferences({ calm: 'yes', frameRate: 144, rotateMinutes: 7, location: { latitude: 300, longitude: 0 } })).toEqual(DEFAULT_PREFERENCES);
    expect(sanitizePreferences('nonsense')).toEqual(DEFAULT_PREFERENCES);
    expect(sanitizePreferences({ location: { latitude: 51.5, longitude: -0.1 } }).location).toEqual({ latitude: 51.5, longitude: -0.1 });
  });

  it('tells listeners what changed', () => {
    const prefs = new Preferences(memoryStorage());
    const keys: string[] = [];
    prefs.on('change', ({ key }) => keys.push(key));
    prefs.set('drift', false);
    prefs.set('drift', false);
    expect(keys).toEqual(['drift']);
  });
});
