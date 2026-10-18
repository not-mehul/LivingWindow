import { LANDSCAPE_IDS, type LandscapeId } from '../landscapes/types';
import type { Viewport } from './Viewport';

export interface KeyboardActions {
  toggleWindow: () => void;
  addSeed: () => void;
  toggleFullscreen: (() => void) | null;
  togglePause: () => void;
  /** Shift the clock by a number of simulated hours. */
  shiftTime: (hours: number) => void;
  toggleRadio: () => void;
  toggleMute: () => void;
  /** Pick up (or put down) the settings tablet. */
  toggleSettings?: () => void;
  setLandscape: (id: LandscapeId) => void;
}

/** Simulated hours moved per `[` / `]` press. */
const TIME_STEP_HOURS = 0.5;
const REPEATABLE_KEYS = new Set(['ArrowLeft', 'ArrowRight', '[', ']']);

/** Speed added per arrow-key press, in world px / s. */
const KEY_NUDGE = 260;

/**
 * Wire DOM input to the viewport: pointer drag / touch panning, wheel and
 * trackpad scrolling, plus keyboard shortcuts.
 */
export function attachInput(canvas: HTMLCanvasElement, viewport: Viewport, actions: KeyboardActions): void {
  canvas.addEventListener('pointerdown', (event) => {
    if (!event.isPrimary || event.button > 0) return;
    viewport.beginDrag(event.pointerId, event.clientX, event.timeStamp);
  });
  window.addEventListener('pointermove', (event) => {
    viewport.moveDrag(event.pointerId, event.clientX, event.timeStamp);
  });
  const end = (event: PointerEvent) => viewport.endDrag(event.pointerId, event.timeStamp);
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', end);

  canvas.addEventListener(
    'wheel',
    (event) => {
      if (!viewport.isPannable) return;
      event.preventDefault();
      // Prefer horizontal trackpad motion; fall back to the vertical wheel.
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      const pixels = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? delta * 16 : delta;
      viewport.panBy((pixels / viewport.layout.scale) * 0.5);
    },
    { passive: false },
  );

  window.addEventListener('keydown', (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    // Let focused controls (buttons, the time slider) handle their own keys.
    if (event.target instanceof HTMLButtonElement || event.target instanceof HTMLInputElement) return;
    // Held arrows / brackets keep panning or scrubbing; other shortcuts fire once.
    if (event.repeat && !REPEATABLE_KEYS.has(event.key)) return;
    switch (event.key) {
      case 'w':
      case 'W':
        actions.toggleWindow();
        break;
      case 'b':
      case 'B':
        actions.addSeed();
        break;
      case 'r':
      case 'R':
        actions.toggleRadio();
        break;
      case 's':
      case 'S':
        actions.toggleSettings?.();
        break;
      case 'm':
      case 'M':
        actions.toggleMute();
        break;
      case 'f':
      case 'F':
        actions.toggleFullscreen?.();
        break;
      case ' ':
        actions.togglePause();
        event.preventDefault();
        break;
      case '[':
        actions.shiftTime(-TIME_STEP_HOURS);
        break;
      case ']':
        actions.shiftTime(TIME_STEP_HOURS);
        break;
      case '1':
      case '2':
      case '3':
      case '4':
        actions.setLandscape(LANDSCAPE_IDS[Number(event.key) - 1]);
        break;
      case 'ArrowLeft':
        viewport.nudge(-KEY_NUDGE);
        event.preventDefault();
        break;
      case 'ArrowRight':
        viewport.nudge(KEY_NUDGE);
        event.preventDefault();
        break;
      default:
        return;
    }
  });
}
