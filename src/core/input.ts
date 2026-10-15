import type { Viewport } from './Viewport';

export interface KeyboardActions {
  toggleWindow: () => void;
  addSeed: () => void;
  toggleFullscreen: (() => void) | null;
}

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
    // Held arrow keys keep pushing the view; other shortcuts fire once per press.
    if (event.repeat && event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    switch (event.key) {
      case 'w':
      case 'W':
        actions.toggleWindow();
        break;
      case 'b':
      case 'B':
        actions.addSeed();
        break;
      case 'f':
      case 'F':
        actions.toggleFullscreen?.();
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
