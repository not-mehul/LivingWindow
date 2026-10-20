import { describe, expect, it } from 'vitest';
import { parseUrlPreset, presetUrl } from './urlPresets';

describe('URL presets', () => {
  it('reads a bookmarked view', () => {
    expect(parseUrlPreset('?place=forest&time=21:30&weather=rain&clock=fast&calm=0&rotate=60&ui=hidden')).toEqual({
      place: 'forest',
      time: 21.5,
      weather: 'light-rain',
      clockMode: 'fast',
      calm: false,
      rotateMinutes: 60,
      hideUi: true,
    });
  });

  it('accepts friendly names and ignores nonsense', () => {
    expect(parseUrlPreset('?place=meadow&weather=storm&time=7')).toEqual({ place: 'meadows', weather: 'thunderstorm', time: 7 });
    expect(parseUrlPreset('?place=mars&time=25:00&weather=hail&rotate=7&calm=maybe')).toEqual({});
  });

  it('writes a view back out as an address', () => {
    const url = presetUrl('https://example.com/window/?seed=1', { place: 'beach', time: 6.25, weather: 'clear', calm: true });
    expect(url).toBe('https://example.com/window/?place=beach&time=06%3A15&weather=clear&calm=1');
    expect(parseUrlPreset(new URL(url).search)).toEqual({ place: 'beach', time: 6.25, weather: 'clear', calm: true });
  });
});
