import { Graphics, type Container } from 'pixi.js';
import { lerpColor, multiplyColor } from '../../core/color';
import type { Environment } from '../../scene/Environment';
import { shorePoint } from '../../sim/shore';
import { APPROACH, BACKWASH, RUN_UP, type Wave } from '../../sim/waves';
import { pixelHash } from '../../sprites/raster';

const r = (min: number, max: number) => min + Math.random() * (max - min);

/** What the froth needs from the beach. */
export interface FrothShore {
  readonly sandFx: Container;
  readonly waves: { readonly waves: readonly Wave[] };
  reachAt(depth: number): number;
  wetAt(depth: number): number;
}

interface Bit {
  depth: number;
  s: number;
  size: number;
  life: number;
  max: number;
  seed: number;
  kind: 'foam' | 'bubble' | 'hole';
}

/** The stretch of beach in view (depths) where the froth is worth drawing. */
const NEAR = 1.04;
const FAR = 3.4;

/**
 * What each wave leaves on the sand: a line of foam stranded at the top of
 * its run, the clumps popping and shrinking away; and as it drains back,
 * the wet sand pricked with tiny holes and bubbling where clams and mole
 * crabs, buried just under, breathe.
 */
export class Froth {
  private readonly gfx = new Graphics();
  private readonly bits: Bit[] = [];
  private readonly peaked = new WeakSet<Wave>();
  private readonly drained = new WeakSet<Wave>();

  constructor(private readonly shore: FrothShore) {
    shore.sandFx.addChild(this.gfx);
  }

  get count(): number {
    return this.bits.length;
  }

  update(dt: number, env: Environment): void {
    for (const w of this.shore.waves.waves) {
      const t = w.age - APPROACH;
      if (t >= RUN_UP * 0.92 && !this.peaked.has(w)) {
        this.peaked.add(w);
        // Foam left along the top of the swash.
        for (let i = 0; i < 18; i++) {
          const depth = r(NEAR, FAR);
          this.bits.push({ depth, s: -this.shore.reachAt(depth) + r(-1, 3), size: r(1, 3.2), life: r(3, 8), max: 0, seed: Math.floor(Math.random() * 1e6), kind: 'foam' });
        }
      }
      if (t >= RUN_UP + BACKWASH * 0.55 && !this.drained.has(w)) {
        this.drained.add(w);
        // The sand it's just uncovered: holes, and bubbles coming up through them.
        for (let i = 0; i < 14; i++) {
          const depth = r(NEAR, FAR);
          const edge = this.shore.reachAt(depth);
          const top = this.shore.wetAt(depth);
          if (top - edge < 3) continue;
          const s = -r(edge + 2, top);
          const hole = Math.random() < 0.6;
          this.bits.push({ depth, s, size: 1, life: hole ? r(4, 12) : r(0.6, 2.2), max: 0, seed: Math.floor(Math.random() * 1e6), kind: hole ? 'hole' : 'bubble' });
        }
      }
    }
    const g = this.gfx;
    g.clear();
    const amb = env.lighting.ambient;
    const foam = lerpColor(multiplyColor(0xf8faf6, amb), 0xffffff, 0.15);
    const hole = multiplyColor(0x5a4630, amb);
    const bubble = lerpColor(multiplyColor(0xe8f4f4, amb), 0xffffff, 0.2);
    for (let i = this.bits.length - 1; i >= 0; i--) {
      const b = this.bits[i];
      if (!b.max) b.max = b.life;
      b.life -= dt;
      // The next wave sweeps it away.
      if (b.life <= 0 || this.shore.reachAt(b.depth) > -b.s + 0.5) {
        this.bits.splice(i, 1);
        continue;
      }
      const p = shorePoint(b.depth, b.s);
      const x = Math.round(p.x);
      const y = Math.round(p.y);
      const left = b.life / b.max;
      if (b.kind === 'foam') {
        // A clump that pops away from its edges.
        const n = Math.max(1, Math.round(b.size * b.size * p.scale * 2.2 * left));
        for (let k = 0; k < n; k++) {
          const dx = Math.round((pixelHash(k, 1, b.seed) - 0.5) * b.size * 2.6 * p.scale);
          const dy = Math.round((pixelHash(k, 2, b.seed) - 0.5) * b.size * 0.9 * p.scale);
          g.rect(x + dx, y + dy, 1, 1).fill({ color: foam, alpha: 0.6 + 0.4 * left });
        }
      } else if (b.kind === 'hole') g.rect(x, y, 1, 1).fill({ color: hole, alpha: 0.7 * Math.min(1, b.life) });
      // A bubble winks: there, gone, there.
      else if (Math.sin(b.life * 18 + b.seed) > -0.2) g.rect(x, y, 1, 1).fill({ color: bubble, alpha: 0.9 });
    }
  }
}
