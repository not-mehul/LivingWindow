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
import { loadUiFont } from '../ui/fontBuilder';
import { LOOPS, oneShotGroups, PET_SOUNDS, ROOM_SOUNDS, soundLabel } from './soundCatalog';
import { loadReviews, reviewReport, saveReviews, tally, type ReviewItem, type Verdict } from './soundReview';
import './soundPreview.css';

/**
 * A page for listening to every sound in the app, one at a time, and noting
 * which are good and which need work. It runs the app's own audio engine,
 * so what plays here is exactly what plays in the window. Open it with the
 * dev server at /sounds.html.
 */

interface Row {
  item: ReviewItem;
  detail?: string;
  /** Play it once, or switch it on or off. */
  play: () => void;
  /** For things that keep playing: whether it's on now. */
  active?: () => boolean;
  /** More buttons after the play button. */
  extra?: Array<{ label: string; run: () => void }>;
}

type Filter = 'all' | 'unrated' | 'work' | 'good';

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
  void loadUiFont();
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
  let reviews = loadReviews();
  let filter: Filter = 'all';

  /** Browsers start audio only from a tap; every control goes through this. */
  const withSound = (run: () => void) => () => {
    void engine.unlock().then(() => {
      run();
      refresh();
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
  const items = rows.map((r) => r.item);

  // The page.
  root.innerHTML = `
    <header class="sp-head">
      <h1>Living Window · sounds</h1>
      <p class="sp-tally" data-tally></p>
      <div class="sp-actions">
        <label>Show <select data-filter>
          <option value="all">all</option><option value="unrated">not rated</option><option value="work">needs work</option><option value="good">good</option>
        </select></label>
        <button type="button" data-copy>Copy report</button>
        <button type="button" data-stop>Stop all</button>
        <button type="button" data-clear>Clear marks</button>
      </div>
    </header>
    <section class="sp-controls" aria-label="Listening conditions">
      <label>Time <input type="range" min="0" max="23.75" step="0.25" value="12" data-hours /> <output data-hours-out></output></label>
      <label>Activity <input type="range" min="0" max="1" step="0.05" value="0.5" data-activity /></label>
      <label>Distance <input type="range" min="0" max="1" step="0.05" value="0.3" data-distance /></label>
      <label>Pan <input type="range" min="-1" max="1" step="0.1" value="0" data-pan /></label>
      <label><input type="checkbox" checked data-window /> Window open</label>
      <span class="sp-meter" title="Output level"><span data-meter></span></span>
    </section>
    <main data-groups></main>
    <details class="sp-report"><summary>Report</summary><textarea readonly rows="14" data-report></textarea></details>
  `;
  const $ = <T extends HTMLElement>(selector: string) => root.querySelector<T>(selector)!;
  const groups = $('[data-groups]');
  const rowEls = new Map<string, HTMLElement>();
  let section: HTMLElement | null = null;
  let current = '';
  for (const row of rows) {
    if (row.item.group !== current) {
      current = row.item.group;
      section = document.createElement('section');
      section.className = 'sp-group';
      section.innerHTML = `<h2>${current}</h2>`;
      groups.appendChild(section);
    }
    const el = document.createElement('div');
    el.className = 'sp-row';
    el.innerHTML = `
      <button type="button" class="sp-play" aria-label="Play ${row.item.label}"></button>
      <div class="sp-name">${row.item.label}<small>${row.item.kind}${row.detail ? ` · <span data-detail>${row.detail}</span>` : ''}</small></div>
      <span class="sp-extra"></span>
      <span class="sp-verdict" role="group" aria-label="Verdict on ${row.item.label}">
        <button type="button" data-verdict="good">Good</button><button type="button" data-verdict="work">Needs work</button>
      </span>
      <input type="text" class="sp-note" placeholder="What's wrong with it?" aria-label="Note on ${row.item.label}" />
    `;
    el.querySelector<HTMLButtonElement>('.sp-play')!.addEventListener('click', withSound(row.play));
    for (const extra of row.extra ?? []) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = extra.label;
      button.addEventListener('click', withSound(extra.run));
      el.querySelector('.sp-extra')!.appendChild(button);
    }
    for (const button of el.querySelectorAll<HTMLButtonElement>('[data-verdict]')) {
      button.addEventListener('click', () => {
        const verdict = button.dataset.verdict as Verdict;
        const review = { ...reviews[row.item.id] };
        review.verdict = review.verdict === verdict ? undefined : verdict;
        reviews = { ...reviews, [row.item.id]: review };
        saveReviews(reviews);
        refresh();
      });
    }
    const note = el.querySelector<HTMLInputElement>('.sp-note')!;
    note.value = reviews[row.item.id]?.note ?? '';
    note.addEventListener('input', () => {
      reviews = { ...reviews, [row.item.id]: { ...reviews[row.item.id], note: note.value } };
      saveReviews(reviews);
      refreshReport();
    });
    section!.appendChild(el);
    rowEls.set(row.item.id, el);
  }

  const report = $<HTMLTextAreaElement>('[data-report]');
  const refreshReport = () => {
    const counts = tally(items, reviews);
    $('[data-tally]').textContent = `${items.length} sounds · ${counts.work} need work · ${counts.good} good · ${counts.unrated} not rated`;
    report.value = reviewReport(items, reviews);
  };
  const refresh = () => {
    for (const row of rows) {
      const el = rowEls.get(row.item.id)!;
      const verdict = reviews[row.item.id]?.verdict;
      const on = row.active?.() ?? false;
      const play = el.querySelector<HTMLButtonElement>('.sp-play')!;
      play.textContent = on ? '■' : '▶';
      play.setAttribute('aria-pressed', String(on));
      el.classList.toggle('is-on', on);
      for (const button of el.querySelectorAll<HTMLButtonElement>('[data-verdict]')) button.setAttribute('aria-pressed', String(button.dataset.verdict === verdict));
      el.hidden = filter !== 'all' && (filter === 'unrated' ? Boolean(verdict) : verdict !== filter);
      if (row.item.id === 'radio') el.querySelector('[data-detail]')!.textContent = radio.isOn ? radio.title : 'generated live';
    }
    for (const s of groups.querySelectorAll<HTMLElement>('.sp-group')) s.hidden = ![...s.querySelectorAll<HTMLElement>('.sp-row')].some((r) => !r.hidden);
    $('[data-hours-out]').textContent = formatClock(scene.hours);
    refreshReport();
  };

  $<HTMLSelectElement>('[data-filter]').addEventListener('change', (e) => {
    filter = (e.target as HTMLSelectElement).value as Filter;
    refresh();
  });
  $('[data-copy]').addEventListener('click', () => {
    const done = (text: string) => ($('[data-copy]').textContent = text);
    navigator.clipboard?.writeText(report.value).then(
      () => done('Copied'),
      () => {
        $<HTMLDetailsElement>('.sp-report').open = true;
        report.select();
        done('Select and copy below');
      },
    );
    window.setTimeout(() => done('Copy report'), 2000);
  });
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
  $('[data-clear]').addEventListener('click', () => {
    if (!window.confirm('Clear every mark and note?')) return;
    reviews = {};
    saveReviews(reviews);
    for (const note of root.querySelectorAll<HTMLInputElement>('.sp-note')) note.value = '';
    refresh();
  });
  const slider = (selector: string, set: (v: number) => void) =>
    $<HTMLInputElement>(selector).addEventListener('input', (e) => {
      set(Number((e.target as HTMLInputElement).value));
      refresh();
    });
  slider('[data-hours]', (v) => (scene.hours = v));
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
