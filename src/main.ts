import { Application, Container, TextureStyle } from 'pixi.js';
import './style.css';
import { attachInput } from './core/input';
import { Viewport } from './core/Viewport';
import { PlaceholderCityScene } from './scene/PlaceholderCityScene';
import { BirdseedState } from './state/BirdseedState';
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

function fullscreenToggle(): (() => void) | null {
  if (!document.fullscreenEnabled) return null;
  return () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen().catch(() => undefined);
  };
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

  // --- World (native 840×360 pixels, rendered off-screen) ----------------
  const viewport = new Viewport(host.clientWidth, host.clientHeight, dpr);
  const scene = new PlaceholderCityScene();
  viewport.world.addChild(scene.container);

  // --- Screen-space window -----------------------------------------------
  const frame = new WindowFrame();
  const toggleWindow = () => windowState.toggle();
  const sash = new WindowSash(windowState, () => {
    if (!viewport.didDrag) toggleWindow();
  });
  const bowl = new BirdseedBowl(birdseed, () => !viewport.didDrag);
  /** Foreground (z = 0) layer on the sill: the bowl now, perched birds later. */
  const sillLayer = new Container({ label: 'sill-layer' });
  sillLayer.addChild(bowl.container);

  app.stage.addChild(viewport.view, sash.container, frame.container, frame.sillContainer, sillLayer);
  // The stage itself is hit-testable so it can show a grab cursor when the
  // view can be panned; interactive children (sash rail, bowl) override it.
  app.stage.eventMode = 'static';
  app.stage.hitArea = app.screen;
  // Purely decorative layers must opt out, or (under a static stage) their
  // full-screen bounds would swallow taps meant for the sash and bowl.
  for (const decorative of [viewport.view, frame.container, frame.sillContainer]) {
    decorative.eventMode = 'none';
  }

  const layout = () => {
    const l = viewport.layout;
    frame.layout(l);
    sash.layout(l, frame.innerTop, frame.sillSurface);
    bowl.layout(frame.sillSurface, l.devicePixelRatio);
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
  attachInput(app.canvas, viewport, { toggleWindow, addSeed, toggleFullscreen });
  new Overlay(document.body, { windowState, birdseed, viewport, onAddSeed: addSeed, onToggleFullscreen: toggleFullscreen });

  // --- Main loop ----------------------------------------------------------
  app.ticker.add((ticker) => {
    const dt = Math.min(ticker.deltaMS / 1000, MAX_FRAME_SECONDS);
    windowState.update(dt);
    viewport.update(dt);
    scene.update(dt);
    sash.update();
    bowl.update(dt);
    viewport.render(app.renderer);
    app.stage.cursor = viewport.isDragging ? 'grabbing' : viewport.isPannable ? 'grab' : 'default';
  });

  if (import.meta.env.DEV) {
    Object.assign(window, { livingWindow: { app, viewport, windowState, birdseed } });
  }
}

boot().catch((error: unknown) => {
  console.error(error);
  document.body.insertAdjacentHTML(
    'beforeend',
    '<p style="color:#f3e6d0;font-family:monospace;padding:24px">Living Window could not start: WebGL or WebGPU is required.</p>',
  );
});
