import { describe, expect, it } from 'vitest';
import { loadSession, saveSession } from './session';

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

describe('session memory', () => {
  it('picks up where the last visit left off', () => {
    const storage = memoryStorage();
    saveSession({ weather: 'snow', locked: true, hours: 21.5, windowOpen: false }, storage);
    expect(loadSession(storage)).toEqual({ weather: 'snow', locked: true, hours: 21.5, windowOpen: false });
  });

  it('starts fresh from anything broken', () => {
    const storage = memoryStorage();
    expect(loadSession(storage)).toBeNull();
    storage.setItem('livingWindow.session', '{"weather":"hail","locked":true,"hours":3,"windowOpen":true}');
    expect(loadSession(storage)).toBeNull();
    storage.setItem('livingWindow.session', 'not json');
    expect(loadSession(storage)).toBeNull();
  });
});
