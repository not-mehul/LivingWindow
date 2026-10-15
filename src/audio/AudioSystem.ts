import type { Environment } from '../scene/Environment';
import { AudioEngine } from './AudioEngine';
import { decodeAll, loadManifest, shuffle } from './manifest';
import { loadAudioSettings, saveAudioSettings, type AudioSettings } from './mixer';
import { Radio } from './radio/Radio';
import { CitySoundscape } from './soundscapes/CitySoundscape';
import { WeatherSound } from './soundscapes/WeatherSound';
import { SOUND_IDS } from './sounds/SoundBank';

const UNLOCK_EVENTS = ['pointerdown', 'keydown', 'touchend'] as const;

/**
 * Everything audible, assembled: the mixer engine, the radio, the weather
 * sounds and the current scene's soundscape. Created once at start-up; the
 * browser keeps it silent until the first user gesture.
 */
export class AudioSystem {
  private saveTimer: number | undefined;

  private constructor(
    readonly engine: AudioEngine,
    readonly radio: Radio,
    readonly weather: WeatherSound,
    readonly ambience: CitySoundscape,
    private readonly settings: AudioSettings,
  ) {
    const save = () => {
      window.clearTimeout(this.saveTimer);
      this.saveTimer = window.setTimeout(() => saveAudioSettings(this.settings), 300);
    };
    engine.on('volume', save);
    engine.on('mute', save);
    radio.on('change', save);

    // The first tap or key press anywhere unlocks audio (browser policy).
    const unlock = () => {
      void engine.unlock().then(() => {
        if (!engine.running) return;
        for (const event of UNLOCK_EVENTS) window.removeEventListener(event, unlock);
        if (this.settings.radioOn && !radio.isOn) radio.setOn(true);
      });
    };
    for (const event of UNLOCK_EVENTS) window.addEventListener(event, unlock);
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
    const [rain, wind, city, thunder] = await Promise.all([
      decodeAll(ctx, manifest.beds?.rain ? [manifest.beds.rain] : []),
      decodeAll(ctx, manifest.beds?.wind ? [manifest.beds.wind] : []),
      decodeAll(ctx, manifest.beds?.city ? [manifest.beds.city] : []),
      decodeAll(ctx, manifest.thunder),
    ]);
    if (!settings.streamUrl && manifest.radio?.stream) settings.streamUrl = manifest.radio.stream;

    const radio = new Radio(engine, settings, shuffle(manifest.radio?.playlist ?? []));
    const weather = new WeatherSound(engine, { rain: rain[0], wind: wind[0], thunder });
    const ambience = new CitySoundscape(engine, city[0]);
    return new AudioSystem(engine, radio, weather, ambience, settings);
  }

  update(dt: number, env: Environment, glassExposure: number): void {
    this.weather.update(dt, env, glassExposure);
    this.ambience.update(dt, env);
  }
}
