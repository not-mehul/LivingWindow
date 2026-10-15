import { Application, Container, Sprite, Texture, TextureStyle } from 'pixi.js';
import './style.css';
import { AudioSystem } from './audio/AudioSystem';
import { WORLD_HEIGHT } from './config';
import { attachInput } from './core/input';
import { Viewport } from './core/Viewport';
import { createLandscape, loadLandscapeChoice, saveLandscapeChoice } from './landscapes/registry';
import type { Landscape, LandscapeId, LandscapeLayers } from './landscapes/types';
import type { Environment } from './scene/Environment';
import { computeLighting, interiorTint } from './scene/lighting';
import { createWeatherAtlas } from './scene/weather/atlas';
import { GlassWeather } from './scene/weather/GlassWeather';
import { Lightning } from './scene/weather/Lightning';
import { PrecipitationLayer } from './scene/weather/Precipitation';
import type { WorldScene } from './scene/WorldScene';
import { BOWL_HALF_WIDTH } from './window/BirdseedBowl';
import { BirdseedState } from './state/BirdseedState';
import { Clock } from './state/Clock';
import { Weather } from './state/Weather';
import { WindowState } from './state/WindowState';
import { Overlay } from './ui/Overlay';
import { BirdseedBowl } from './window/BirdseedBowl';
import { WindowFrame } from './window/WindowFrame';
import { WindowSash } from './window/WindowSash';

/** Cap the backing-store density: beyond 3× the extra pixels are invisible. */
const MAX_DEVICE_PIXEL_RATIO = 3;
/** Longest frame step the simulation will take (e.g. after a background tab). */
const MAX_FRAME_SECONDS = 0.1;

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

/** Seconds for each half of the fade between landscapes. */
const FADE_SECONDS = 0.35;

async function boot(): Promise<void> {
  // Every texture in the project is pixel art: never smooth it.
  TextureStyle.defaultOptions.scaleMode = 'nearest';

  const host = document.getElementById('app');
  if (!host) throw new Error('Missing #app element');

  let dpr = currentDevicePixelRatio();
  const app = new Application();
  await app.init({
    width: host.clientWidth,
    height: host.clientHeight,
    resolution: dpr,
    autoDensity: true,
    antialias: false,
    roundPixels: true,
    background: '#1a1626',
  });
  host.appendChild(app.canvas);

  // --- Simulation state -------------------------------------------------
  const windowState = new WindowState(true);
  const birdseed = new BirdseedState();
  const clock = new Clock(localHours());
  const weather = new Weather({ initial: 'clear' });

  // --- World (native 840×360 pixels, rendered off-screen) ----------------
  const viewport = new Viewport(host.clientWidth, host.clientHeight, dpr);
  const atlas = createWeatherAtlas();
  let audio: AudioSystem | null = null;

  // --- Screen-space window -----------------------------------------------
  const frame = new WindowFrame();
  const toggleWindow = () => windowState.toggle();
  const sash = new WindowSash(windowState, () => {
    if (!viewport.didDrag) toggleWindow();
  });
  const glass = new GlassWeather(atlas);
  sash.glassLayer.addChild(glass.container);
  const bowl = new BirdseedBowl(birdseed, () => !viewport.didDrag);
  /** Foreground (z = 0) layer on the sill: visitors behind the bowl, the bowl, then birds. */
  const sillLayer = new Container({ label: 'sill-layer' });
  const sillBack = new Container({ label: 'sill-back' });
  const sillFront = new Container({ label: 'sill-front' });
  sillLayer.addChild(sillBack, bowl.container, sillFront);
  /** Creatures flying close to the window, drawn in screen space outside the glass. */
  const nearLayer = new Container({ label: 'near-flight' });
  nearLayer.eventMode = 'none';
  /** Lightning briefly lights up the room too. */
  const roomFlash = new Sprite({ texture: Texture.WHITE, blendMode: 'add', tint: 0xdfe4ff, alpha: 0 });
  /** Darkens the view while switching landscapes. */
  const fade = new Sprite({ texture: Texture.WHITE, tint: 0x0c0a12, alpha: 0 });

  app.stage.addChild(viewport.view, nearLayer, sash.container, frame.container, frame.sillContainer, sillLayer, roomFlash, fade);
  // The stage itself is hit-testable so it can show a grab cursor when the
  // view can be panned; interactive children (sash rail, bowl) override it.
  app.stage.eventMode = 'static';
  app.stage.hitArea = app.screen;
  // Purely decorative layers must opt out, or (under a static stage) their
  // full-screen bounds would swallow taps meant for the sash and bowl.
  for (const decorative of [viewport.view, frame.container, frame.sillContainer, roomFlash, fade]) {
    decorative.eventMode = 'none';
  }
  const interior = [sash.container, frame.container, frame.sillContainer, bowl.container];

  // --- Landscapes ------------------------------------------------------------
  const mounted = new Map<LandscapeId, Mounted>();
  const mount = (id: LandscapeId): Mounted => {
    const existing = mounted.get(id);
    if (existing) return existing;
    const layers: LandscapeLayers = {
      near: new Container({ label: `${id}-near` }),
      sillBack: new Container({ label: `${id}-sill-back` }),
      sillFront: new Container({ label: `${id}-sill-front` }),
    };
    nearLayer.addChild(layers.near);
    sillBack.addChild(layers.sillBack);
    sillFront.addChild(layers.sillFront);
    const landscape = createLandscape(id, {
      viewport,
      layers,
      birdseed,
      sound: (soundId, pan, depth) => audio?.engine.playSpatialSound(soundId, pan, depth, 'wildlife'),
      canTap: () => !viewport.didDrag,
    });
    const precipitation = createPrecipitation(landscape.scene, atlas);
    const lightning = new Lightning(landscape.scene.horizonY);
    landscape.scene.sky.boltLayer.addChild(lightning.bolt);
    const entry: Mounted = { landscape, precipitation, lightning, layers };
    mounted.set(id, entry);
    return entry;
  };

  let current: Mounted = mount(loadLandscapeChoice());
  const show = (next: Mounted) => {
    for (const m of mounted.values()) {
      const active = m === next;
      m.layers.near.visible = m.layers.sillBack.visible = m.layers.sillFront.visible = active;
    }
    viewport.world.removeChildren();
    viewport.world.addChild(next.landscape.scene.container, next.lightning.overlay);
    frame.setTheme(next.landscape.theme);
    sash.setTheme(next.landscape.theme);
    audio?.setSoundscape(next.landscape.createSoundscape, next.landscape.id);
    current = next;
  };
  show(current);

  /** Pending switch: fade out, swap, fade back in. */
  let transition: { to: LandscapeId; t: number; swapped: boolean } | null = null;
  const landscapeListeners = new Set<(id: LandscapeId) => void>();
  const setLandscape = (id: LandscapeId) => {
    if (id === current.landscape.id && !transition) return;
    transition = { to: id, t: 0, swapped: false };
    saveLandscapeChoice(id);
    for (const listener of landscapeListeners) listener(id);
  };

  const bowlSillX = () => (bowl.container.x - frame.sillSurface.left) / frame.sillSurface.frameScale;
  // Taps that hit no other control may shoo a creature away.
  app.stage.on('pointertap', (event) => {
    if (event.target === app.stage) current.landscape.life.tap(event.global.x, event.global.y);
  });
  birdseed.on('filled', () => current.landscape.life.startleNear(bowlSillX(), 26));
  weather.on('lightning', ({ intensity, distance }) => {
    const x = current.lightning.strike(intensity, distance);
    audio?.weather.thunder(intensity, distance, viewport.worldXToStereo(x));
    // A close crack sends birds flying.
    current.landscape.life.startleAll(distance < 0.4 ? 0.6 : 0.25);
  });

  const layout = () => {
    const l = viewport.layout;
    frame.layout(l);
    sash.layout(l, frame.innerTop, frame.sillSurface);
    glass.layout(sash.glassRect);
    bowl.layout(frame.sillSurface, l.devicePixelRatio);
    roomFlash.width = fade.width = l.screenWidth;
    roomFlash.height = fade.height = l.screenHeight;
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
    setLandscape,
  });
  const overlay = new Overlay(document.body, {
    windowState,
    birdseed,
    viewport,
    clock,
    weather,
    onAddSeed: addSeed,
    onToggleFullscreen: toggleFullscreen,
    landscape: {
      current: () => (transition?.to ?? current.landscape.id),
      set: setLandscape,
      onChange: (listener) => landscapeListeners.add(listener),
    },
  });

  // --- Audio ---------------------------------------------------------------
  // Built in the background so visuals never wait on audio files.
  void AudioSystem.create(windowState.isOpen).then((system) => {
    if (!system) return;
    audio = system;
    system.setSoundscape(current.landscape.createSoundscape, current.landscape.id);
    overlay.attachAudio(system);
    windowState.on('toggle', ({ open, durationSeconds }) => {
      system.engine.setWindowOpen(open, durationSeconds);
      system.engine.playUi('window-slide');
    });
    windowState.on('settled', ({ open }) => {
      if (!open) system.engine.playUi('window-thunk');
    });
    birdseed.on('filled', () => system.engine.playUi('seed-pour', 0.5));
  });

  // --- Main loop ----------------------------------------------------------
  const env: Environment = {
    time: 0,
    lighting: computeLighting(clock.hours, weather.snapshot),
    weather: weather.snapshot,
  };

  /** Advance every simulation system by one step (no drawing). */
  const simulate = (dt: number) => {
    const simHours = clock.update(dt);
    weather.update(dt, simHours);
    windowState.update(dt);

    env.time += dt;
    env.lighting = computeLighting(clock.hours, weather.snapshot);
    const { landscape, precipitation, lightning } = current;
    landscape.scene.update(dt, env);
    for (const layer of precipitation) layer.update(dt, env);
    landscape.life.update(dt, env, {
      surface: frame.sillSurface,
      bowlX: bowlSillX(),
      bowlHalfWidth: BOWL_HALF_WIDTH,
      windowOpen: windowState.isOpen && !windowState.isAnimating,
    });
    lightning.update(dt);
    glass.update(dt, env, windowState.openness);
    audio?.update(dt, env, 1 - windowState.openness, landscape.life.ambienceLevel);

    // The room is lit by daylight through the window, and by a lamp at night.
    const roomTint = interiorTint(env.lighting);
    for (const layer of interior) layer.tint = roomTint;
    roomFlash.alpha = lightning.flash * 0.12;

    if (transition) {
      transition.t += dt / FADE_SECONDS;
      if (!transition.swapped && transition.t >= 1) {
        transition.swapped = true;
        show(mount(transition.to));
      }
      fade.alpha = transition.swapped ? Math.max(0, 2 - transition.t) : Math.min(1, transition.t);
      if (transition.t >= 2) {
        transition = null;
        fade.alpha = 0;
      }
    }

    viewport.update(dt);
    sash.update();
    bowl.update(dt);
  };

  app.ticker.add((ticker) => {
    simulate(Math.min(ticker.deltaMS / 1000, MAX_FRAME_SECONDS));
    viewport.render(app.renderer);
    overlay.tick();
    app.stage.cursor = viewport.isDragging ? 'grabbing' : viewport.isPannable ? 'grab' : 'default';
  });

  if (import.meta.env.DEV) {
    Object.assign(window, {
      livingWindow: {
        app,
        viewport,
        windowState,
        birdseed,
        clock,
        weather,
        glass,
        setLandscape,
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
        /** Run the simulation forward without drawing (for tests and demos). */
        fastForward: (seconds: number, step = 1 / 30) => {
          for (let t = 0; t < seconds; t += step) simulate(step);
        },
      },
    });
  }
}

boot().catch((error: unknown) => {
  console.error(error);
  document.body.insertAdjacentHTML(
    'beforeend',
    '<p style="color:#f3e6d0;font-family:monospace;padding:24px">Living Window could not start: WebGL or WebGPU is required.</p>',
  );
});
