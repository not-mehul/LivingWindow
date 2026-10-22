import { Application, Container, RenderTexture, Sprite, Texture, TextureStyle } from 'pixi.js';
// Eval-free shader and uniform code paths, so the strict Content-Security-Policy
// served by the Docker image (no 'unsafe-eval') can stay in place.
import 'pixi.js/unsafe-eval';
import './style.css';
import { AudioSystem } from './audio/AudioSystem';
import { WORLD_HEIGHT } from './config';
import { attachInput } from './core/input';
import { quality } from './core/quality';
import { ScreenWakeLock } from './core/wakeLock';
import { Viewport } from './core/Viewport';
import { createLandscape, loadLandscapeChoice, preloadLandscape, saveLandscapeChoice } from './landscapes/registry';
import { LANDSCAPE_IDS, type Landscape, type LandscapeId, type LandscapeLayers } from './landscapes/types';
import type { Environment } from './scene/Environment';
import { computeLighting, interiorTint, type Daylight } from './scene/lighting';
import { guessLocation, moonAge, sunTimes, winterness, type GeoLocation } from './sim/sun';
import { createWeatherAtlas } from './scene/weather/atlas';
import { GlassWeather } from './scene/weather/GlassWeather';
import { Lightning } from './scene/weather/Lightning';
import { PrecipitationLayer } from './scene/weather/Precipitation';
import type { WorldScene } from './scene/WorldScene';
import { BirdseedState } from './state/BirdseedState';
import { Clock } from './state/Clock';
import { mood } from './state/mood';
import { Preferences } from './state/Preferences';
import { parseUrlPreset, presetUrl } from './state/urlPresets';
import { loadSession, saveSession } from './state/session';
import { Weather } from './state/Weather';
import { WindowState } from './state/WindowState';
import { Overlay } from './ui/Overlay';
import { BirdseedBowl } from './window/BirdseedBowl';
import { WindowFrame } from './window/WindowFrame';
import { CasementSashes } from './window/CasementSashes';
import { SillDecor } from './window/SillDecor';
import { SillTablet } from './window/SillTablet';

/** Cap the backing-store density: beyond 3× the extra pixels are invisible. */
const MAX_DEVICE_PIXEL_RATIO = 3;
/** Longest frame step the simulation will take (e.g. after a background tab). */
const MAX_FRAME_SECONDS = 0.1;
/** How often the sky's place-and-date facts (sun times, moon, season) are refreshed (ms). */
const DAYLIGHT_REFRESH_MS = 5 * 60 * 1000;
/** A landscape out of view this long is let go to free its memory (ms). */
const UNMOUNT_AFTER_MS = 3 * 60 * 1000;

function currentDevicePixelRatio(): number {
  return Math.min(window.devicePixelRatio || 1, MAX_DEVICE_PIXEL_RATIO);
}

function localHours(): number {
  const now = new Date();
  return now.getHours() + now.getMinutes() / 60;
}

function fullscreenToggle(): (() => void) | null {
  if (!document.fullscreenEnabled) return null;
  return () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen().catch(() => undefined);
  };
}

/** Distant and near precipitation layers, placed around the scene's nearest scenery. */
function createPrecipitation(scene: WorldScene, atlas: ReturnType<typeof createWeatherAtlas>) {
  const back = new PrecipitationLayer(atlas, {
    maxRain: 480,
    maxSnow: 420,
    rainSpeed: [200, 270],
    snowSpeed: [9, 20],
    rainLengths: [0, 1],
    snowSizes: [0, 0, 1],
    windPush: 70,
    alpha: 0.5,
    groundY: scene.groundY,
    splashes: true,
  });
  const front = new PrecipitationLayer(atlas, {
    maxRain: 340,
    maxSnow: 300,
    rainSpeed: [360, 460],
    snowSpeed: [22, 42],
    rainLengths: [1, 2, 2],
    snowSizes: [1, 1, 2],
    windPush: 120,
    alpha: 0.8,
    groundY: [WORLD_HEIGHT + 8, WORLD_HEIGHT + 16],
    splashes: false,
  });
  scene.weatherBack.addChild(back.container);
  scene.weatherFront.addChild(front.container);
  return [back, front];
}

/** A landscape plus its weather renderers and screen-space layers, built once and kept. */
interface Mounted {
  landscape: Landscape;
  precipitation: PrecipitationLayer[];
  lightning: Lightning;
  layers: LandscapeLayers;
}

/** Seconds for one landscape to dissolve into the next. */
const CROSSFADE_SECONDS = 2.5;

async function boot(): Promise<void> {
  // Every texture in the project is pixel art: never smooth it.
  TextureStyle.defaultOptions.scaleMode = 'nearest';

  const host = document.getElementById('app');
  if (!host) throw new Error('Missing #app element');

  const preferences = new Preferences();
  let dpr = currentDevicePixelRatio();
  const app = new Application();
  await app.init({
    width: host.clientWidth,
    height: host.clientHeight,
    resolution: dpr,
    autoDensity: true,
    antialias: false,
    // No vertex rounding: swaying foliage meshes move by fractions of a pixel, each scanline stepping on its own,
    // which is what makes them fluid. Sprites are placed on whole pixels in code.
    roundPixels: false,
    background: '#1a1626',
  });
  host.appendChild(app.canvas);
  // Drawing faster than needed only costs power: 60, 30 or 20 frames a second, as chosen.
  app.ticker.maxFPS = preferences.get('frameRate');
  // iOS Safari ignores user-scalable=no; stop pinch-zoom from scaling the page.
  document.addEventListener('gesturestart', (event) => event.preventDefault());

  // --- Simulation state -------------------------------------------------
  // Where the window was left last time (weather, the 6× clock, the sash).
  const session = loadSession();
  const windowState = new WindowState(session?.windowOpen ?? true);
  const birdseed = new BirdseedState();
  const clock = new Clock(localHours());
  const weather = new Weather({ initial: 'clear' });
  // A bookmarked view (?place=…&time=…) applies for this visit without changing saved choices.
  const preset = parseUrlPreset(window.location.search);
  if (preset.clockMode) preferences.set('clockMode', preset.clockMode, false);
  if (preset.calm !== undefined) preferences.set('calm', preset.calm, false);
  if (preset.rotateMinutes !== undefined) preferences.set('rotateMinutes', preset.rotateMinutes, false);
  /** Hand the viewer's mood choices to everything that reads them. */
  const applyMood = () => {
    mood.calm = preferences.get('calm');
    weather.setClimate({ winter: winterness(new Date(), geo().latitude), calm: mood.calm });
  };
  /** Where the window is: the viewer's chosen place, or a guess from their time zone. */
  const geo = (): GeoLocation =>
    preferences.get('location') ?? guessLocation(Intl.DateTimeFormat().resolvedOptions().timeZone, -new Date().getTimezoneOffset() / 60);
  /** Today's sun and moon for the window's place. */
  let daylight: Daylight = { sun: sunTimes(new Date(), geo()), moonAge: moonAge(new Date()) };
  let today = new Date().toDateString();
  const refreshDaylight = () => {
    const now = new Date();
    daylight = { sun: sunTimes(now, geo()), moonAge: moonAge(now) };
    applyMood();
  };
  const applyClockMode = () => clock.setRealTime(preferences.get('clockMode') === 'real' ? localHours : null);
  applyMood();
  applyClockMode();
  if (session) {
    weather.restore(session.weather, session.locked);
    if (!clock.isRealTime) clock.setTime(session.hours);
  }
  if (preset.time !== undefined) clock.setTime(preset.time);
  if (preset.weather === 'auto') weather.unlock();
  else if (preset.weather) weather.restore(preset.weather, true);
  const remember = () => saveSession({ weather: weather.type, locked: weather.locked, hours: clock.hours, windowOpen: windowState.isOpen });
  window.setInterval(remember, 30_000);
  window.addEventListener('pagehide', remember);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') remember();
  });
  preferences.on('change', ({ key }) => {
    if (key === 'calm') applyMood();
    if (key === 'location') refreshDaylight();
    if (key === 'clockMode') applyClockMode();
    if (key === 'drift') viewport.setDrift(preferences.get('drift'));
    if (key === 'frameRate') app.ticker.maxFPS = preferences.get('frameRate');
    if (key === 'hideTablet') tablet.setAutoHide(preferences.get('hideTablet'));
  });

  // --- World (native 840×360 pixels, rendered off-screen) ----------------
  const viewport = new Viewport(host.clientWidth, host.clientHeight, dpr);
  const atlas = createWeatherAtlas();
  let audio: AudioSystem | null = null;

  // --- Screen-space window -----------------------------------------------
  const frame = new WindowFrame();
  const toggleWindow = () => windowState.toggle();
  const glass = new GlassWeather(atlas);
  const sashes = new CasementSashes(windowState, glass.container, () => {
    if (!viewport.didDrag) toggleWindow();
  });
  const bowl = new BirdseedBowl(birdseed, () => !viewport.didDrag);
  const decor = new SillDecor(birdseed);
  /** The settings tablet on the sill; `overlay` is set up further down. */
  let overlay: Overlay | null = null;
  const tablet = new SillTablet(() => !viewport.didDrag, () => overlay?.open());
  tablet.setAutoHide(preferences.get('hideTablet'));
  if (preset.hideUi) tablet.setHidden(true);
  viewport.setDrift(preferences.get('drift'));
  // The sashes would sweep the bowl off the sill: it's taken in as they
  // start to close and set back out once the window is fully open.
  windowState.on('toggle', ({ open }) => {
    if (!open) bowl.setPresent(false);
  });
  windowState.on('settled', ({ open }) => {
    if (open) bowl.setPresent(true);
  });
  /** Foreground (z = 0) layer on the sill: visitors behind the bowl, the bowl, then birds. */
  const sillLayer = new Container({ label: 'sill-layer' });
  const sillBack = new Container({ label: 'sill-back' });
  const sillFront = new Container({ label: 'sill-front' });
  const roomLayer = new Container({ label: 'room' });
  sillLayer.addChild(decor.back, sillBack, bowl.container, sillFront, roomLayer);
  /** Creatures flying close to the window, drawn in screen space outside the glass. */
  const nearLayer = new Container({ label: 'near-flight' });
  nearLayer.eventMode = 'none';
  /** Lightning briefly lights up the room too. */
  const roomFlash = new Sprite({ texture: Texture.WHITE, blendMode: 'add', tint: 0xdfe4ff, alpha: 0 });

  app.stage.addChild(
    viewport.view,
    nearLayer,
    sashes.container,
    frame.container,
    frame.sillContainer,
    sillLayer,
    decor.front,
    tablet.container,
    roomFlash,
  );
  // The stage itself is hit-testable so it can show a grab cursor when the
  // view can be panned; interactive children (sashes, bowl) override it.
  app.stage.eventMode = 'static';
  app.stage.hitArea = app.screen;
  // Purely decorative layers must opt out, or (under a static stage) their
  // full-screen bounds would swallow taps meant for the sashes and bowl.
  for (const decorative of [viewport.view, frame.container, frame.sillContainer, decor.back, decor.front, roomFlash]) {
    decorative.eventMode = 'none';
  }
  const interior = [sashes.container, frame.container, frame.sillContainer, bowl.container, decor.back, decor.front];

  // --- Landscapes ------------------------------------------------------------
  const mounted = new Map<LandscapeId, Promise<Mounted>>();
  const mount = (id: LandscapeId): Promise<Mounted> => {
    const existing = mounted.get(id);
    if (existing) return existing;
    const pending = build(id);
    // A failed download can be retried next time.
    pending.catch(() => mounted.delete(id));
    mounted.set(id, pending);
    return pending;
  };
  const all: Mounted[] = [];
  /** When each landscape out of view was last seen (they're let go after a while). */
  const hiddenSince = new Map<Mounted, number>();
  /** The latest build of each landscape (a new day replaces it with a fresh one). */
  const latest = new Map<LandscapeId, Mounted>();
  const build = async (id: LandscapeId): Promise<Mounted> => {
    const layers: LandscapeLayers = {
      near: new Container({ label: `${id}-near` }),
      sillBack: new Container({ label: `${id}-sill-back` }),
      sillFront: new Container({ label: `${id}-sill-front` }),
      room: new Container({ label: `${id}-room` }),
    };
    nearLayer.addChild(layers.near);
    sillBack.addChild(layers.sillBack);
    sillFront.addChild(layers.sillFront);
    roomLayer.addChild(layers.room);
    const landscape = await createLandscape(id, {
      viewport,
      layers,
      birdseed,
      // The window dog is in the room with you, not out in the landscape.
      sound: (soundId, pan, depth) =>
        audio?.engine.playSpatialSound(soundId, pan, depth, depth === 0 && soundId.startsWith('dog-') ? 'indoor' : 'wildlife'),
      canTap: () => !viewport.didDrag,
    });
    const precipitation = createPrecipitation(landscape.scene, atlas);
    const lightning = new Lightning(landscape.scene.horizonY);
    landscape.scene.sky.boltLayer.addChild(lightning.bolt);
    const entry: Mounted = { landscape, precipitation, lightning, layers };
    all.push(entry);
    latest.set(id, entry);
    return entry;
  };

  let current: Mounted = await mount(preset.place ?? loadLandscapeChoice()).catch(() => mount('city'));
  const show = (next: Mounted) => {
    for (const m of all) {
      const active = m === next;
      m.layers.near.visible = m.layers.sillBack.visible = m.layers.sillFront.visible = m.layers.room.visible = active;
    }
    viewport.world.removeChildren();
    viewport.world.addChild(next.landscape.scene.container, next.lightning.overlay);
    frame.setTheme(next.landscape.theme);
    sashes.setTheme(next.landscape.theme);
    audio?.setSoundscape(next.landscape.createSoundscape, next.landscape.id);
    const previous = current;
    current = next;
    hiddenSince.delete(next);
    if (previous !== next) hiddenSince.set(previous, performance.now());
    // A landscape replaced by a fresh build of itself (a new day) is let go at once.
    if (previous !== next && previous.landscape.id === next.landscape.id) unmount(previous);
  };
  show(current);

  /**
   * Pending switch: the current view stays while the new landscape loads,
   * then a snapshot of it dissolves away over the new one.
   */
  let transition: { to: LandscapeId; ready: Mounted | null; failed: boolean } | null = null;
  /** The last frame of the old view, fading out over the new. */
  let veil: { sprite: Sprite; t: number } | null = null;
  /** Real seconds since the place last changed (for changing it on a timer). */
  let sincePlaceChange = 0;
  const coverWithSnapshot = () => {
    const l = viewport.layout;
    const texture = RenderTexture.create({ width: l.screenWidth, height: l.screenHeight, resolution: l.devicePixelRatio });
    // The stage as last drawn (an earlier veil included, so quick switches stay seamless).
    const shift = app.stage.position.clone();
    app.stage.position.set(0, 0);
    app.renderer.render({ container: app.stage, target: texture });
    app.stage.position.copyFrom(shift);
    const previous = veil;
    const sprite = new Sprite(texture);
    sprite.eventMode = 'none';
    app.stage.addChild(sprite);
    veil = { sprite, t: 0 };
    if (previous) previous.sprite.destroy({ texture: true, textureSource: true });
  };
  const landscapeListeners = new Set<(id: LandscapeId) => void>();
  const setLandscape = (id: LandscapeId, rebuild = false) => {
    if (id === current.landscape.id && !transition && !rebuild) return;
    const pending = { to: id, ready: null as Mounted | null, failed: false };
    sincePlaceChange = 0;
    transition = pending;
    void mount(id).then(
      (m) => (pending.ready = m),
      () => (pending.failed = true),
    );
    saveLandscapeChoice(id);
    for (const listener of landscapeListeners) listener(id);
  };

  /** Let a landscape go: its display tree is torn down and it will be rebuilt if chosen again. */
  const unmount = (m: Mounted) => {
    if (m === current || !all.includes(m)) return;
    if (latest.get(m.landscape.id) === m) {
      latest.delete(m.landscape.id);
      mounted.delete(m.landscape.id);
    }
    all.splice(all.indexOf(m), 1);
    hiddenSince.delete(m);
    for (const layer of Object.values(m.layers)) layer.destroy({ children: true });
    m.lightning.overlay.destroy();
    m.landscape.scene.container.destroy({ children: true });
  };
  /** Rebuild every landscape for a new date: the others are dropped now, the current one swapped for a fresh one. */
  const refreshForNewDay = () => {
    for (const m of [...all]) unmount(m);
    const id = current.landscape.id;
    mounted.delete(id);
    setLandscape(id, true);
  };

  const bowlSillX = () => (bowl.container.x - frame.sillSurface.left) / frame.sillSurface.frameScale;
  // Taps that hit no other control may shoo a creature away.
  app.stage.on('pointertap', (event) => {
    if (event.target === app.stage) current.landscape.life.tap(event.global.x, event.global.y);
  });
  birdseed.on('filled', () => current.landscape.life.startleNear(bowlSillX(), 26));
  weather.on('lightning', ({ intensity, distance }) => {
    const x = current.lightning.strike(intensity, distance);
    audio?.weather.thunder(intensity * (mood.calm ? 0.75 : 1), distance, viewport.worldXToStereo(x));
    // A close crack sends birds flying.
    current.landscape.life.startleAll(distance < 0.4 ? 0.6 : 0.25);
    current.landscape.life.thunder?.(distance, intensity);
  });

  const layout = () => {
    const l = viewport.layout;
    frame.layout(l);
    sashes.layout(frame.clearOpening, l.devicePixelRatio);
    glass.layout(sashes.glassRect);
    bowl.layout(frame.sillSurface, l.devicePixelRatio, frame.nearness);
    decor.layout(l, frame.sillSurface, bowl.container.x, frame.nearness);
    tablet.layout(frame.sillSurface, frame.nearness, Math.min(l.screenWidth, l.opening.x + l.opening.width));
    roomFlash.width = l.screenWidth;
    roomFlash.height = l.screenHeight;
  };
  layout();

  const resize = () => {
    const width = host.clientWidth;
    const height = host.clientHeight;
    const nextDpr = currentDevicePixelRatio();
    if (width === viewport.layout.screenWidth && height === viewport.layout.screenHeight && nextDpr === dpr) {
      return;
    }
    dpr = nextDpr;
    app.renderer.resize(width, height, dpr);
    viewport.resize(width, height, dpr);
    layout();
  };
  new ResizeObserver(resize).observe(host);
  // Device-pixel-ratio changes (dragging between monitors, zooming) don't
  // resize the element, so re-check whenever the window is resized as well.
  window.addEventListener('resize', resize);

  // --- Input & UI ---------------------------------------------------------
  const toggleFullscreen = fullscreenToggle();
  const wakeLock = new ScreenWakeLock();
  const addSeed = () => bowl.pour();
  attachInput(app.canvas, viewport, {
    toggleWindow,
    addSeed,
    toggleFullscreen,
    togglePause: () => clock.togglePaused(),
    shiftTime: (hours) => clock.setTime(clock.hours + hours),
    toggleRadio: () => {
      if (audio) void audio.engine.unlock().then(() => audio?.radio.toggle());
    },
    toggleMute: () => audio?.engine.setMuted(!audio.engine.muted),
    toggleSettings: () => overlay?.toggle(),
    setLandscape,
  });
  overlay = new Overlay(document.body, {
    preferences,
    daylight: () => ({ ...daylight.sun, guessed: preferences.get('location') === null }),
    shareUrl: () =>
      presetUrl(window.location.href, {
        place: current.landscape.id,
        time: clock.isRealTime && !clock.isOffset ? undefined : clock.hours,
        weather: weather.locked ? weather.type : undefined,
        clockMode: preferences.get('clockMode'),
        calm: preferences.get('calm'),
        rotateMinutes: preferences.get('rotateMinutes') || undefined,
      }),
    onActivity: () => tablet.nudge(),
    tabletRect: () => tablet.screenBounds(),
    onOpenChange: (open) => tablet.setLifted(open),
    windowState,
    birdseed,
    viewport,
    clock,
    weather,
    onAddSeed: addSeed,
    onToggleFullscreen: toggleFullscreen,
    wakeLock,
    landscape: {
      current: () => (transition && !transition.failed ? transition.to : current.landscape.id),
      set: setLandscape,
      preload: preloadLandscape,
      onChange: (listener) => landscapeListeners.add(listener),
    },
  });

  // --- Audio ---------------------------------------------------------------
  // Built in the background so visuals never wait on audio files.
  void AudioSystem.create(windowState.isOpen).then((system) => {
    if (!system) return;
    audio = system;
    system.setSoundscape(current.landscape.createSoundscape, current.landscape.id);
    overlay?.attachAudio(system);
    windowState.on('toggle', ({ open, durationSeconds }) => {
      system.engine.setWindowOpen(open, durationSeconds);
    });
    windowState.on('settled', ({ open }) => {
      if (!open) system.engine.playUi('window-thunk');
    });
    birdseed.on('filled', () => system.engine.playUi('seed-pour', 0.5));
  });

  // --- Main loop ----------------------------------------------------------
  const env: Environment = {
    time: 0,
    lighting: computeLighting(clock.hours, weather.snapshot, daylight),
    weather: weather.snapshot,
  };

  /**
   * Advance every simulation system by one step (no drawing). The clock gets
   * the full wall time since the last step (`clockDt`), so time keeps up even
   * when frames were throttled; everything else steps at most a tenth of a second.
   */
  const simulate = (dt: number, clockDt = dt) => {
    const simHours = clock.update(clockDt);
    weather.update(dt, simHours);
    windowState.update(dt);

    env.time += dt;
    env.lighting = computeLighting(clock.hours, weather.snapshot, daylight);
    const { landscape, precipitation, lightning } = current;
    landscape.scene.update(dt, env);
    for (const layer of precipitation) layer.update(dt, env);
    landscape.life.update(dt, env, {
      surface: frame.sillSurface,
      bowlX: bowlSillX(),
      bowlHalfWidth: bowl.halfWidth,
      windowOpen: windowState.isOpen && !windowState.isAnimating && bowl.present,
      puddleX: decor.puddleX,
    });
    lightning.update(dt);
    glass.update(dt, env, windowState.openness);
    audio?.update(dt, env, 1 - windowState.openness, landscape.life.ambienceLevel);

    // The room is lit by daylight through the window, and by a lamp at night.
    const roomTint = interiorTint(env.lighting);
    for (const layer of interior) layer.tint = roomTint;
    roomFlash.alpha = lightning.flash * (mood.calm ? 0.07 : 0.12);

    if (transition) {
      if (transition.ready) {
        coverWithSnapshot();
        show(transition.ready);
        transition = null;
      } else if (transition.failed) {
        // Couldn't load (offline?): stay where we are.
        transition = null;
        const stayed = current.landscape.id;
        for (const listener of landscapeListeners) listener(stayed);
      }
    }
    if (veil) {
      veil.t += dt / CROSSFADE_SECONDS;
      const t = Math.min(1, veil.t);
      veil.sprite.alpha = 1 - t * t * (3 - 2 * t);
      if (veil.t >= 1) {
        veil.sprite.destroy({ texture: true, textureSource: true });
        veil = null;
      }
    }
    viewport.update(dt);
    sashes.update();
    bowl.update(dt);
    decor.update(env.time, env.weather.wind, windowState.openness);
    // Rain blowing in at the open window wets the sill.
    decor.weather(dt, env.weather.kind === 'rain' && env.weather.precipitation > 0.15 && windowState.openness > 0.5);
    tablet.update(dt, { hours: clock.hours, weather: weather.type, nightness: env.lighting.nightness }, interiorTint(env.lighting));
  };

  // Landscapes left a few minutes ago are let go, freeing their memory; going
  // back to one rebuilds it (a moment's wait, behind the cross-fade).
  const releaseHidden = (afterMs = UNMOUNT_AFTER_MS) => {
    const now = performance.now();
    for (const [m, since] of hiddenSince) {
      if (now - since >= afterMs && m.landscape.id !== transition?.to) unmount(m);
    }
  };
  window.setInterval(releaseHidden, 15_000);

  // A new day: the sun's times and the moon move on, and each landscape is
  // rebuilt for its new date (crops grow, tides turn) at the next quiet moment.
  window.setInterval(() => {
    refreshDaylight();
    const date = new Date().toDateString();
    if (date !== today) {
      today = date;
      refreshForNewDay();
    }
  }, DAYLIGHT_REFRESH_MS);

  let lastFrame = performance.now();
  app.ticker.add((ticker) => {
    quality.sample(ticker.deltaMS);
    const now = performance.now();
    const wallDt = Math.max(0, (now - lastFrame) / 1000);
    lastFrame = now;
    simulate(Math.min(ticker.deltaMS / 1000, MAX_FRAME_SECONDS), wallDt);
    // Against screen burn-in: everything wanders a pixel or two in a slow loop.
    const t = now / 1000;
    const step = 1 / dpr;
    app.stage.position.set(Math.round((1.5 * Math.sin((2 * Math.PI * t) / 470)) / step) * step, Math.round((1.5 * Math.sin((2 * Math.PI * t) / 610 + 1)) / step) * step);
    // Changing place on a timer, if chosen: on to the next landscape in turn.
    const rotate = preferences.get('rotateMinutes');
    sincePlaceChange += wallDt;
    if (rotate > 0 && !transition && sincePlaceChange >= rotate * 60) {
      const ids = LANDSCAPE_IDS;
      setLandscape(ids[(ids.indexOf(current.landscape.id) + 1) % ids.length]);
    }
    viewport.render(app.renderer);
    sashes.render(app.renderer, glass.sim.drops.length);
    overlay?.tick();
    app.stage.cursor = viewport.isDragging ? 'grabbing' : viewport.isPannable ? 'grab' : 'default';
  });

  if (import.meta.env.DEV) {
    Object.assign(window, {
      livingWindow: {
        app,
        viewport,
        windowState,
        birdseed,
        bowl,
        sashes,
        clock,
        weather,
        preferences,
        glass,
        quality,
        wakeLock,
        setLandscape,
        /** Resolves once a landscape switch has finished. */
        landscapeReady: () =>
          new Promise<void>((resolve) => {
            const check = () => (transition || veil ? requestAnimationFrame(check) : resolve());
            check();
          }),
        get landscape() {
          return current.landscape;
        },
        get life() {
          return current.landscape.life;
        },
        get lightning() {
          return current.lightning;
        },
        audio: () => audio,
        /** Let go of landscapes out of view (normally after three minutes) and say how many are still built. */
        releaseHidden: (afterMs = 0) => {
          releaseHidden(afterMs);
          return all.length;
        },
        /** Rebuild everything as on a new day. */
        newDay: () => refreshForNewDay(),
        /** The interactions this landscape can set going with `stage`. */
        get stages() {
          return current.landscape.life.stages ?? [];
        },
        /** Set one of the landscape's interactions going (see `stages`). */
        stage: (name: string) => current.landscape.life.stage?.(name) ?? false,
        /** Run the simulation forward without drawing (for tests and demos). */
        fastForward: (seconds: number, step = 1 / 30) => {
          for (let t = 0; t < seconds; t += step) simulate(step);
        },
      },
    });
  }
}

// Offline: a service worker keeps the window opening without a connection (built site only).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => void navigator.serviceWorker.register('./sw.js').catch(() => undefined));
}

if (location.hash.startsWith('#gallery')) void import('./dev/gallery').then((m) => m.showGallery());
else boot().catch((error: unknown) => {
  console.error(error);
  document.body.insertAdjacentHTML(
    'beforeend',
    '<p style="color:#f3e6d0;font-family:monospace;padding:24px">Living Window could not start: WebGL or WebGPU is required.</p>',
  );
});
