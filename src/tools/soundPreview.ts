import { AudioSystem } from '../audio/AudioSystem';
import { BeachSoundscape } from '../audio/soundscapes/BeachSoundscape';
import { CitySoundscape } from '../audio/soundscapes/CitySoundscape';
import { ForestSoundscape } from '../audio/soundscapes/ForestSoundscape';
import { MeadowSoundscape } from '../audio/soundscapes/MeadowSoundscape';
import { Soundscape } from '../audio/soundscapes/Soundscape';
import type { SoundId } from '../audio/sounds/SoundBank';
import { TextureLayer } from '../audio/textures';
import type { AudioEngine } from '../audio/AudioEngine';
import { Emitter } from '../core/Emitter';
import { rand } from '../core/random';
import { LANDSCAPE_IDS, LANDSCAPE_LABELS, type LandscapeId } from '../landscapes/types';
import type { BeachScene } from '../scene/beach/BeachScene';
import type { Environment } from '../scene/Environment';
import { computeLighting } from '../scene/lighting';
import type { BreakEvent } from '../sim/waves';
import { formatClock } from '../state/timeOfDay';
import { Weather, WEATHER_LABELS, WEATHER_TYPES, type WeatherType } from '../state/Weather';
import { createReviewPage, type PageRow } from './reviewPage';
import { LOOPS, oneShotGroups, PET_SOUNDS, ROOM_SOUNDS, soundLabel } from './soundCatalog';

/**
 * A page for listening to every sound in the app, one at a time, and noting
 * which are good and which need work. It runs the app's own audio engine,
 * so what plays here is exactly what plays in the window. Open it with the
 * dev server at /sounds.html.
 */

interface Row extends PageRow {
  /** Play it once, or switch it on or off. */
  play: () => void;
  /** For things that keep playing: whether it's on now. */
  active?: () => boolean;
  /** More buttons after the play button. */
  extra?: Array<{ label: string; run: () => void }>;
}

/** No landscape: only the weather, the radio and whatever is previewed. */
class Quiet extends Soundscape {
  update(): void {}
}

/** Stands in for the beach scene, whose breaking waves the beach ambience listens for. */
class Shore extends Emitter<{ break: BreakEvent & { pan: number } }> {
  crash(amplitude: number, pan: number): void {
    this.emit('break', { amplitude, pan });
  }
}

const SOUNDSCAPES: Record<LandscapeId, (engine: AudioEngine, shore: Shore, bed?: AudioBuffer) => Soundscape> = {
  city: (engine, _shore, bed) => new CitySoundscape(engine, bed),
  meadows: (engine, _shore, bed) => new MeadowSoundscape(engine, bed),
  beach: (engine, shore, bed) => new BeachSoundscape(engine, shore as unknown as BeachScene, bed),
  forest: (engine, _shore, bed) => new ForestSoundscape(engine, bed),
};

async function start(root: HTMLElement): Promise<void> {
  const audio = await AudioSystem.create(true);
  if (!audio) {
    root.textContent = 'This browser has no Web Audio, so there is nothing to preview.';
    return;
  }
  const { engine, radio } = audio;
  // Muted in the window would make this page silent too.
  if (engine.muted) engine.setMuted(false);
  const shore = new Shore();
  const weather = new Weather({ initial: 'clear' });
  weather.restore('clear', true);
  weather.on('lightning', ({ intensity, distance }) => audio.weather.thunder(intensity, distance, rand(-0.8, 0.8)));

  const scene = { landscape: null as LandscapeId | null, hours: 12, activity: 0.5, windowOpen: true, distance: 0.3, pan: 0 };
  const loops = new Map<string, TextureLayer>();

  /** Browsers start audio only from a tap; every control goes through this. */
  const withSound = (run: () => void) => () => {
    void engine.unlock().then(() => {
      run();
      page.refresh();
    });
  };

  const setLandscape = (id: LandscapeId | null) => {
    scene.landscape = id;
    if (id) audio.setSoundscape((e, bed) => SOUNDSCAPES[id](e, shore, bed), id);
    else audio.setSoundscape((e) => new Quiet(e), 'none');
  };
  const setWeather = (type: WeatherType) => weather.restore(type, true);
  const setWindow = (open: boolean) => {
    scene.windowOpen = open;
    engine.setWindowOpen(open, 0.6);
  };

  // Every row on the page, in the order shown.
  const rows: Row[] = [];
  for (const { group, ids } of oneShotGroups()) {
    for (const id of ids) {
      const recordings = engine.sounds.samplesOf(id).length;
      rows.push({
        item: { id, label: soundLabel(id), group, kind: recordings > 0 ? `recording ×${recordings}` : 'synth' },
        play: () => playOneShot(id),
      });
    }
  }
  const playOneShot = (id: SoundId) => {
    if (ROOM_SOUNDS.has(id)) engine.playUi(id, scene.pan);
    else engine.playSpatialSound(id, scene.pan, PET_SOUNDS.has(id) ? 0 : scene.distance, PET_SOUNDS.has(id) ? 'indoor' : 'wildlife');
  };

  for (const loop of LOOPS) {
    rows.push({
      item: { id: loop.id, label: loop.label, group: 'Loops', kind: 'loop' },
      detail: loop.where,
      active: () => loops.has(loop.id),
      play: () => {
        const playing = loops.get(loop.id);
        if (playing) {
          playing.set(0, 0.2);
          window.setTimeout(() => playing.stop(), 600);
          loops.delete(loop.id);
          return;
        }
        const layer = new TextureLayer(engine.context, engine.inputs.ambience, loop.spec(), Math.floor(Math.random() * 1e6));
        layer.set(loop.level, 0.3);
        loops.set(loop.id, layer);
      },
    });
  }

  for (const id of LANDSCAPE_IDS) {
    rows.push({
      item: { id: `scene:${id}`, label: `${LANDSCAPE_LABELS[id]} ambience`, group: 'Landscapes', kind: 'soundscape' },
      detail: 'set the time, weather and window above',
      active: () => scene.landscape === id,
      play: () => setLandscape(scene.landscape === id ? null : id),
      extra: id === 'beach' ? [{ label: 'Wave', run: () => shore.crash(rand(12, 26), rand(-0.6, 0.6)) }] : undefined,
    });
  }

  for (const type of WEATHER_TYPES.filter((t) => t !== 'clear')) {
    rows.push({
      item: { id: `weather:${type}`, label: WEATHER_LABELS[type], group: 'Weather', kind: 'weather' },
      detail: type === 'thunderstorm' ? 'rain, wind and thunder now and then' : type === 'snow' ? 'the hush of snow' : undefined,
      active: () => weather.type === type,
      play: () => setWeather(weather.type === type ? 'clear' : type),
    });
  }
  rows.push(
    {
      item: { id: 'weather:glass', label: 'Rain on the glass', group: 'Weather', kind: 'weather' },
      detail: 'rain, with the window shut',
      active: () => weather.snapshot.kind === 'rain' && !scene.windowOpen,
      play: () => {
        const on = weather.snapshot.kind === 'rain' && !scene.windowOpen;
        setWeather(on ? 'clear' : 'light-rain');
        setWindow(on);
      },
    },
    {
      item: { id: 'weather:thunder', label: 'Thunder', group: 'Weather', kind: 'synth' },
      detail: 'one clap; plays again further off each time',
      play: () => {
        thunderDistance = (thunderDistance + 0.3) % 1.2;
        audio.weather.thunder(rand(0.6, 1), Math.min(1, thunderDistance), rand(-0.8, 0.8));
      },
    },
    {
      item: { id: 'radio', label: 'Lofi radio', group: 'Radio', kind: 'generative' },
      detail: 'generated live',
      active: () => radio.isOn,
      play: () => radio.setOn(!radio.isOn),
      extra: [{ label: 'Next', run: () => radio.next() }],
    },
  );
  let thunderDistance = 0.1;

  const page = createReviewPage(root, {
    heading: 'Living Window · sounds',
    reportTitle: 'Sound review',
    storageKey: 'livingWindow.soundReview',
    noun: 'sounds',
    rows,
    actions: '<button type="button" data-stop>Stop all</button>',
    controlsLabel: 'Listening conditions',
    controls: `
      <label>Time <input type="range" min="0" max="23.75" step="0.25" value="12" data-hours /> <output data-hours-out></output></label>
      <label>Activity <input type="range" min="0" max="1" step="0.05" value="0.5" data-activity /></label>
      <label>Distance <input type="range" min="0" max="1" step="0.05" value="0.3" data-distance /></label>
      <label>Pan <input type="range" min="-1" max="1" step="0.1" value="0" data-pan /></label>
      <label><input type="checkbox" checked data-window /> Window open</label>
      <span class="sp-meter" title="Output level"><span data-meter></span></span>`,
    build: (row, el) => {
      const play = document.createElement('button');
      play.type = 'button';
      play.className = 'sp-play';
      play.setAttribute('aria-label', `Play ${row.item.label}`);
      play.addEventListener('click', withSound(row.play));
      el.lead.appendChild(play);
      for (const extra of row.extra ?? []) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = extra.label;
        button.addEventListener('click', withSound(extra.run));
        el.extra.appendChild(button);
      }
    },
    update: (row, el) => {
      const on = row.active?.() ?? false;
      const play = el.lead.querySelector<HTMLButtonElement>('.sp-play')!;
      play.textContent = on ? '■' : '▶';
      play.setAttribute('aria-pressed', String(on));
      el.row.classList.toggle('is-on', on);
      if (row.item.id === 'radio' && el.detail) el.detail.textContent = radio.isOn ? radio.title : 'generated live';
    },
  });
  const { $ } = page;
  const refresh = page.refresh;
  $('[data-stop]').addEventListener('click', () => {
    for (const [id, layer] of loops) {
      layer.stop();
      loops.delete(id);
    }
    setLandscape(null);
    setWeather('clear');
    radio.setOn(false);
    refresh();
  });
  const slider = (selector: string, set: (v: number) => void) =>
    $<HTMLInputElement>(selector).addEventListener('input', (e) => {
      set(Number((e.target as HTMLInputElement).value));
      refresh();
    });
  const showHours = () => ($('[data-hours-out]').textContent = formatClock(scene.hours));
  slider('[data-hours]', (v) => {
    scene.hours = v;
    showHours();
  });
  showHours();
  slider('[data-activity]', (v) => (scene.activity = v));
  slider('[data-distance]', (v) => (scene.distance = v));
  slider('[data-pan]', (v) => (scene.pan = v));
  $<HTMLInputElement>('[data-window]').addEventListener('change', (e) => setWindow((e.target as HTMLInputElement).checked));
  radio.on('change', refresh);
  weather.on('change', refresh);

  // Run the world the sounds listen to: the clock, the weather and, at the beach, the waves.
  const env: Environment = { time: 0, lighting: computeLighting(scene.hours, weather.snapshot), weather: weather.snapshot };
  const meter = $('[data-meter]');
  let last = performance.now();
  let nextWave = 2;
  const tick = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    weather.update(dt, 0);
    env.time += dt;
    env.lighting = computeLighting(scene.hours, weather.snapshot);
    audio.update(dt, env, scene.windowOpen ? 0 : 1, scene.activity);
    if (scene.landscape === 'beach' && (nextWave -= dt) <= 0) {
      nextWave = rand(4, 9) * (1.2 - weather.snapshot.lightning * 0.5);
      shore.crash(rand(10, 26) * (0.7 + 0.3 * Math.abs(weather.snapshot.wind)), rand(-0.6, 0.6));
    }
    meter.style.width = `${Math.min(100, engine.outputLevel() * 400)}%`;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  $<HTMLInputElement>('[data-window]').checked = scene.windowOpen;
  refresh();
}

void start(document.getElementById('sounds')!);
