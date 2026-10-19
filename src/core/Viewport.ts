import { Container, RenderTexture, Sprite, type Renderer } from 'pixi.js';
import { DRAG_THRESHOLD_PX, WORLD_HEIGHT, WORLD_WIDTH } from '../config';
import { Emitter } from './Emitter';
import { clamp, snapToDevicePixel } from './math';
import {
  centeredPan,
  clampPan,
  computeViewportLayout,
  panAfterResize,
  type ViewportLayout,
} from './viewportLayout';

export interface ViewportEvents {
  layout: ViewportLayout;
}

/** Exponential decay rate of pan inertia, per second. */
const PAN_FRICTION = 5;
/** Below this speed (world px / s) inertia stops. */
const MIN_INERTIA_SPEED = 4;
/** A release this long after the last movement carries no inertia. */
const INERTIA_RELEASE_WINDOW_MS = 90;

/**
 * Owns the panoramic world and maps it onto the screen.
 *
 * The world is rendered at its native resolution (840×360) into an
 * off-screen render texture, which is then shown scaled up with
 * nearest-neighbour sampling. That guarantees a true pixel grid for every
 * entity, while panning stays smooth because the scaled-up image itself
 * moves in device pixels.
 */
export class Viewport extends Emitter<ViewportEvents> {
  /** Container for world-space content, in native world pixels. Not on the stage. */
  readonly world = new Container({ label: 'world' });
  /** The scaled-up view of the world to add to the stage. */
  readonly view: Sprite;

  private readonly target: RenderTexture;
  private _layout: ViewportLayout;
  private _panX: number;
  private velocity = 0;

  private dragPointerId: number | null = null;
  private dragStartX = 0;
  private dragLastX = 0;
  private dragLastTime = 0;
  private dragging = false;
  private _didDrag = false;

  constructor(screenWidth: number, screenHeight: number, devicePixelRatio: number) {
    super();
    this.target = RenderTexture.create({
      width: WORLD_WIDTH,
      height: WORLD_HEIGHT,
      resolution: 1,
      scaleMode: 'nearest',
      antialias: false,
    });
    this.view = new Sprite({ texture: this.target, label: 'world-view' });
    this._layout = computeViewportLayout(screenWidth, screenHeight, devicePixelRatio);
    this._panX = centeredPan(this._layout);
    this.applyTransform();
  }

  get layout(): ViewportLayout {
    return this._layout;
  }

  /** Left edge of the visible slice of the world, in world pixels. */
  get panX(): number {
    return this._panX;
  }

  get isPannable(): boolean {
    return this._layout.maxPanX > 0;
  }

  get isDragging(): boolean {
    return this.dragging;
  }

  /**
   * True when the most recent press turned into a pan. Tap handlers check
   * this so that dragging across the birdseed bowl doesn't also fill it.
   */
  get didDrag(): boolean {
    return this._didDrag;
  }

  resize(screenWidth: number, screenHeight: number, devicePixelRatio: number): void {
    const previous = this._layout;
    this._layout = computeViewportLayout(screenWidth, screenHeight, devicePixelRatio);
    this._panX = panAfterResize(this._panX, previous, this._layout);
    if (!this.isPannable) this.velocity = 0;
    this.applyTransform();
    this.emit('layout', this._layout);
  }

  setPan(panX: number): void {
    const next = clampPan(panX, this._layout);
    if (next === this._panX) return;
    this._panX = next;
    this.applyTransform();
  }

  /** Pan by a distance in world pixels (positive looks further right). */
  panBy(deltaWorldX: number): void {
    this.setPan(this._panX + deltaWorldX);
  }

  /** Add pan momentum in world pixels per second (keyboard / wheel flicks). */
  nudge(velocity: number): void {
    if (!this.isPannable) return;
    this.velocity = clamp(this.velocity + velocity, -2000, 2000);
  }

  beginDrag(pointerId: number, screenX: number, timeMs: number): void {
    if (this.dragPointerId !== null) return;
    this.dragPointerId = pointerId;
    this.dragStartX = screenX;
    this.dragLastX = screenX;
    this.dragLastTime = timeMs;
    this.dragging = false;
    this._didDrag = false;
    this.velocity = 0;
  }

  moveDrag(pointerId: number, screenX: number, timeMs: number): void {
    if (pointerId !== this.dragPointerId) return;
    if (!this.dragging) {
      if (Math.abs(screenX - this.dragStartX) < DRAG_THRESHOLD_PX) return;
      if (!this.isPannable) return;
      this.dragging = true;
      this._didDrag = true;
      // Start from the current pointer so the view doesn't jump by the threshold.
      this.dragLastX = screenX;
      this.dragLastTime = timeMs;
      return;
    }
    const deltaWorld = (this.dragLastX - screenX) / this._layout.scale;
    const elapsed = Math.max(1, timeMs - this.dragLastTime) / 1000;
    // Smooth the release velocity so a single jittery sample can't fling the view.
    this.velocity = this.velocity * 0.6 + (deltaWorld / elapsed) * 0.4;
    this.dragLastX = screenX;
    this.dragLastTime = timeMs;
    this.panBy(deltaWorld);
  }

  endDrag(pointerId: number, timeMs: number): void {
    if (pointerId !== this.dragPointerId) return;
    if (!this.dragging || timeMs - this.dragLastTime > INERTIA_RELEASE_WINDOW_MS) {
      this.velocity = 0;
    }
    this.dragPointerId = null;
    this.dragging = false;
  }

  update(deltaSeconds: number): void {
    if (this.dragging || this.velocity === 0) return;
    const before = this._panX;
    this.panBy(this.velocity * deltaSeconds);
    const hitEdge = this._panX === before;
    this.velocity *= Math.exp(-PAN_FRICTION * deltaSeconds);
    if (hitEdge || Math.abs(this.velocity) < MIN_INERTIA_SPEED) this.velocity = 0;
  }

  /** Draw the world into its native-resolution render texture. */
  render(renderer: Renderer): void {
    renderer.render({ container: this.world, target: this.target, clear: true });
  }

  /** Convert a world-pixel position to screen (CSS px) coordinates. */
  worldToScreen(worldX: number, worldY: number): { x: number; y: number } {
    const { opening, scale, cropY } = this._layout;
    return {
      x: opening.x + (worldX - this._panX) * scale,
      y: opening.y + (worldY - cropY) * scale,
    };
  }

  /** Convert a screen (CSS px) position to world-pixel coordinates. */
  screenToWorld(screenX: number, screenY: number): { x: number; y: number } {
    const { opening, scale, cropY } = this._layout;
    return {
      x: (screenX - opening.x) / scale + this._panX,
      y: (screenY - opening.y) / scale + cropY,
    };
  }

  /**
   * Stereo position in [-1, 1] of a world x coordinate relative to what the
   * viewer is currently looking at — for spatial audio panning (Step 3).
   */
  worldXToStereo(worldX: number): number {
    const { visibleWorldWidth } = this._layout;
    const relative = (worldX - this._panX) / visibleWorldWidth;
    return clamp(relative * 2 - 1, -1, 1);
  }

  private applyTransform(): void {
    const { opening, scale, cropY, devicePixelRatio } = this._layout;
    this.view.scale.set(scale);
    this.view.position.set(
      snapToDevicePixel(opening.x - this._panX * scale, devicePixelRatio),
      snapToDevicePixel(opening.y - cropY * scale, devicePixelRatio),
    );
  }
}
