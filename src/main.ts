import { Application, Container, Sprite, Texture, TextureStyle } from 'pixi.js';
import './style.css';
import { AudioSystem } from './audio/AudioSystem';
import { WORLD_HEIGHT } from './config';
import { lerpColor } from './core/color';
import { attachInput } from './core/input';
import { Viewport } from './core/Viewport';
import { CityScene } from './scene/city/CityScene';
import type { Environment } from './scene/Environment';
import { computeLighting } from './scene/lighting';
import { createWeatherAtlas } from './scene/weather/atlas';
import { GlassWeather } from './scene/weather/GlassWeather';
import { Lightning } from './scene/weather/Lightning';
import { PrecipitationLayer } from './scene/weather/Precipitation';
import type { WorldScene } from './scene/WorldScene';
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
/** Warm lamp light inside the room, which takes over from daylight at night. */
const ROOM_LAMP = 0xffd9b0;

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
  const scene: WorldScene = new CityScene();
  const atlas = createWeatherAtlas();
  const precipitation = createPrecipitation(scene, atlas);
  const lightning = new Lightning(scene.horizonY);
  scene.sky.boltLayer.addChild(lightning.bolt);
  viewport.world.addChild(scene.container, lightning.overlay);
  let audio: AudioSystem | null = null;
  weather.on('lightning', ({ intensity, distance }) => {
    const x = lightning.strike(intensity, distance);
    audio?.weather.thunder(intensity, distance, viewport.worldXToStereo(x));
  });

  // --- Screen-space window -----------------------------------------------
  const frame = new WindowFrame();
  const toggleWindow = () => windowState.toggle();
  const sash = new WindowSash(windowState, () => {
    if (!viewport.didDrag) toggleWindow();
  });
  const glass = new GlassWeather(atlas);
  sash.glassLayer.addChild(glass.container);
  const bowl = new BirdseedBowl(birdseed, () => !viewport.didDrag);
  /** Foreground (z = 0) layer on the sill: the bowl now, perched birds later. */
  const sillLayer = new Container({ label: 'sill-layer' });
  sillLayer.addChild(bowl.container);
  /** Lightning briefly lights up the room too. */
  const roomFlash = new Sprite({ texture: Texture.WHITE, blendMode: 'add', tint: 0xdfe4ff, alpha: 0 });

  app.stage.addChild(viewport.view, sash.container, frame.container, frame.sillContainer, sillLayer, roomFlash);
  // The stage itself is hit-testable so it can show a grab cursor when the
  // view can be panned; interactive children (sash rail, bowl) override it.
  app.stage.eventMode = 'static';
  app.stage.hitArea = app.screen;
  // Purely decorative layers must opt out, or (under a static stage) their
  // full-screen bounds would swallow taps meant for the sash and bowl.
  for (const decorative of [viewport.view, frame.container, frame.sillContainer, roomFlash]) {
    decorative.eventMode = 'none';
  }
  const interior = [sash.container, frame.container, frame.sillContainer, sillLayer];

  const layout = () => {
    const l = viewport.layout;
    frame.layout(l);
    sash.layout(l, frame.innerTop, frame.sillSurface);
    glass.layout(sash.glassRect);
    bowl.layout(frame.sillSurface, l.devicePixelRatio);
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
  });
  const overlay = new Overlay(document.body, {
    windowState,
    birdseed,
    viewport,
    clock,
    weather,
    onAddSeed: addSeed,
    onToggleFullscreen: toggleFullscreen,
  });

  // --- Audio ---------------------------------------------------------------
  // Built in the background so visuals never wait on audio files.
  void AudioSystem.create(windowState.isOpen).then((system) => {
    if (!system) return;
    audio = system;
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

  app.ticker.add((ticker) => {
    const dt = Math.min(ticker.deltaMS / 1000, MAX_FRAME_SECONDS);
    const simHours = clock.update(dt);
    weather.update(dt, simHours);
    windowState.update(dt);

    env.time += dt;
    env.lighting = computeLighting(clock.hours, weather.snapshot);
    scene.update(dt, env);
    for (const layer of precipitation) layer.update(dt, env);
    lightning.update(dt);
    glass.update(dt, env, windowState.openness);
    audio?.update(dt, env, 1 - windowState.openness);

    // The room is lit by daylight through the window, and by a lamp at night.
    const { lighting } = env;
    const interiorTint = lerpColor(lerpColor(0xffffff, lighting.ambient, 0.5), ROOM_LAMP, lighting.darkness * 0.55);
    for (const layer of interior) layer.tint = interiorTint;
    roomFlash.alpha = lightning.flash * 0.12;

    viewport.update(dt);
    sash.update();
    bowl.update(dt);
    viewport.render(app.renderer);
    overlay.tick();
    app.stage.cursor = viewport.isDragging ? 'grabbing' : viewport.isPannable ? 'grab' : 'default';
  });

  if (import.meta.env.DEV) {
    Object.assign(window, {
      livingWindow: { app, viewport, windowState, birdseed, clock, weather, lightning, glass, audio: () => audio },
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
