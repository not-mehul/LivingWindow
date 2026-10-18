import type { Container } from 'pixi.js';
import type { Environment } from './Environment';
import type { Sky } from './sky/Sky';

/**
 * Contract every landscape implements, so the shared weather and lighting
 * systems can plug into any scene.
 */
export interface WorldScene {
  /** Root of the scene, in native world pixels. */
  readonly container: Container;
  readonly sky: Sky;
  /** World y of the horizon (lightning bolts reach down to here). */
  readonly horizonY: number;
  /** World y range where distant rain lands (and splashes). */
  readonly groundY: readonly [number, number];
  /** Slot behind the nearest scenery for distant rain / snow. */
  readonly weatherBack: Container;
  /** Slot in front of everything in the world for near rain / snow. */
  readonly weatherFront: Container;
  update(dt: number, env: Environment): void;
}
