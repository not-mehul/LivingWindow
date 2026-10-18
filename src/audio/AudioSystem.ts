import type { Environment } from '../scene/Environment';
import { AudioEngine } from './AudioEngine';
import { decodeAll, loadManifest, shuffle } from './manifest';
import { loadAudioSettings, saveAudioSettings, type AudioSettings } from './mixer';
import { Radio } from './radio/Radio';
import type { Soundscape } from './soundscapes/Soundscape';
import { WeatherSound } from './soundscapes/WeatherSound';
import { SOUND_IDS } from './sounds/SoundBank';

const UNLOCK_EVENTS = ['pointerdown', 'keydown', 'touchend'] as const;
/** Manifest `beds` keys for each landscape's ambience recording. */
const LANDSCAPE_BEDS = ['city', 'meadows', 'beach', 'forest'] as const;

/**
 * Everything audible, assembled: the mixer engine, the radio, the weather
 * sounds and the current scene's soundscape. Created once at start-up; the
 * browser keeps it silent until the first user gesture.
 */
export class AudioSystem {
  private saveTimer: number | undefined;
  private ambience: Soundscape | null = null;

  private constructor(
    readonly engine: AudioEngine,
    readonly radio: Radio,
    readonly weather: WeatherSound,
    /** Recorded ambience beds by landscape id (from the manifest), if any. */
    readonly beds: Readonly<Record<string, AudioBuffer | undefined>>,
    private readonly settings: AudioSettings,
  ) {
    const save = () => {
      window.clearTimeout(this.saveTimer);
      this.saveTimer = window.setTimeout(() => saveAudioSettings(this.settings), 300);
    };
    engine.on('volume', save);
    engine.on('mute', save);
    radio.on('change', save);

    // Any tap or key press (re)starts audio when the browser has suspended it:
    // at first load, and after iOS interrupts it (a call, switching apps).
    const unlock = () => {
      if (engine.running) return;
      void engine.unlock().then(() => {
        if (engine.running && this.settings.radioOn && !radio.isOn) radio.setOn(true);
      });
    };
    for (const event of UNLOCK_EVENTS) window.addEventListener(event, unlock, { passive: true });
    // Coming back to the tab: try to resume straight away (works where allowed).
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && !engine.running) void engine.unlock();
    });
  }

  /** Returns null when the browser has no Web Audio support. */
  static async create(windowOpen: boolean): Promise<AudioSystem | null> {
    if (typeof AudioContext === 'undefined') return null;
    const settings = loadAudioSettings();
    const engine = new AudioEngine(settings);
    engine.snapWindow(windowOpen);

    const manifest = await loadManifest();
    const ctx = engine.context;
    await Promise.all(
      SOUND_IDS.map(async (id) => engine.sounds.addSamples(id, await decodeAll(ctx, manifest.sounds?.[id]))),
    );
    const bedUrl = (key: string) => {
      const url = (manifest.beds as Record<string, string | undefined> | undefined)?.[key];
      return url ? [url] : [];
    };
    const [rain, wind, thunder, ...landscapeBeds] = await Promise.all([
      decodeAll(ctx, bedUrl('rain')),
      decodeAll(ctx, bedUrl('wind')),
      decodeAll(ctx, manifest.thunder),
      ...LANDSCAPE_BEDS.map((key) => decodeAll(ctx, bedUrl(key))),
    ]);
    const beds = Object.fromEntries(LANDSCAPE_BEDS.map((key, i) => [key, landscapeBeds[i][0]]));
    if (!settings.streamUrl && manifest.radio?.stream) settings.streamUrl = manifest.radio.stream;

    const radio = new Radio(engine, settings, shuffle(manifest.radio?.playlist ?? []));
    const weather = new WeatherSound(engine, { rain: rain[0], wind: wind[0], thunder });
    return new AudioSystem(engine, radio, weather, beds, settings);
  }

  /** Swap the landscape ambience (the old one fades out). */
  setSoundscape(create: (engine: AudioEngine, bed?: AudioBuffer) => Soundscape, bedKey: string): void {
    this.ambience?.dispose();
    this.ambience = create(this.engine, this.beds[bedKey]);
  }

  update(dt: number, env: Environment, glassExposure: number, level = 0.5): void {
    this.weather.update(dt, env, glassExposure);
    this.ambience?.update(dt, env, level);
  }
}
