import { Container, Graphics, Sprite } from 'pixi.js';
import { clamp, lerp } from '../core/math';
import type { Environment } from '../scene/Environment';
import { interiorTint } from '../scene/lighting';
import {
  CAT_FIRST_VISIT,
  CAT_STALK_SPEED,
  CAT_VISIT_INTERVAL,
  CAT_WALK_SPEED,
  catStateDuration,
  chooseCatState,
  type CatState,
} from '../sim/catBrain';
import { CAT_COATS, CAT_GROOM, CAT_STALK, CAT_WALK, CAT_WIDTH, CatSpriteCache, type CatCoat, type CatPose } from '../sprites/catSprites';
import { sillContacts } from '../window/sillContacts';
import { sillWidth, type LifeSoundSink, type SillState } from './types';

/** The wiggle before a pounce, seconds. */
const WINDUP = 0.9;

/**
 * A rare feline visitor to the windowsill. It strolls in, wanders, sits
 * (breathing, blinking slowly, flicking an ear, swishing its tail, glancing
 * round at you), washes, loafs, yawns, stretches and naps, chatters at birds
 * or stalks them (who scatter), and eventually leaves. Tap it for a meow, or
 * a purr if it's napping.
 */
export class RooftopCat {
  readonly container = new Container({ label: 'rooftop-cat' });
  private readonly sprite = new Sprite({ anchor: { x: 0.5, y: 1 } });
  private readonly shadow = new Graphics();
  private readonly sprites = new CatSpriteCache();

  private present = false;
  private state: CatState = 'enter';
  private timer = 0;
  private duration = 0;
  private x = 0;
  private targetX = 0;
  private facing: 1 | -1 = 1;
  private elapsed = 0;
  private visitLength = 0;
  private coat: CatCoat = 'orange-tabby';
  private walked = 0;
  private nextVisit: number;
  private pounceFrom = 0;
  private exitSpeed = 1;
  private sill: SillState | null = null;
  /** A little thing it does while sitting: a blink, a glance, an ear flick, a swish. */
  private micro: { kind: 'blink' | 'look' | 'ear' | 'swish'; t: number; length: number } | null = null;
  private microIn = 2;
  private brush = 0;

  constructor(
    private readonly emitSound: LifeSoundSink,
    private readonly canTap: () => boolean,
    private readonly rng: () => number = Math.random,
  ) {
    this.nextVisit = lerp(CAT_FIRST_VISIT[0], CAT_FIRST_VISIT[1], rng());
    this.container.addChild(this.shadow, this.sprite);
    this.container.visible = false;
    this.sprite.eventMode = 'static';
    this.sprite.cursor = 'pointer';
    this.sprite.on('pointertap', () => {
      if (this.canTap()) this.pet();
    });
  }

  get isPresent(): boolean {
    return this.present;
  }

  /** Sill position in art px, while visiting. */
  get position(): number | null {
    return this.present ? this.x : null;
  }

  get isStalking(): boolean {
    return this.present && (this.state === 'stalk' || this.state === 'pounce');
  }

  get currentState(): CatState | null {
    return this.present ? this.state : null;
  }

  /** Bring the cat over now (if the sill allows it). */
  summon(): void {
    this.nextVisit = 0;
  }

  update(dt: number, env: Environment, sill: SillState, birdsOnSill: number[]): void {
    this.sill = sill;
    const wet = env.weather.kind === 'rain' && env.weather.precipitation > 0.1;
    if (!this.present) {
      this.nextVisit -= dt;
      if (this.nextVisit <= 0 && sill.windowOpen && !wet) this.arrive(sill);
      return;
    }

    this.elapsed += dt;
    this.timer += dt;
    const width = sillWidth(sill);

    // A closing window (or rain) sends it off at a trot.
    if ((!sill.windowOpen || wet) && this.state !== 'exit') this.leave(width, 2.6);

    switch (this.state) {
      case 'enter':
      case 'walk':
      case 'exit':
      case 'stalk': {
        if (this.state === 'stalk' && birdsOnSill.length > 0) {
          const prey = birdsOnSill.reduce((a, b) => (Math.abs(b - this.x) < Math.abs(a - this.x) ? b : a));
          this.targetX = prey;
          if (Math.abs(prey - this.x) < 40) {
            this.pounceFrom = this.x;
            this.begin('pounce');
            break;
          }
        }
        const speed = (this.state === 'stalk' ? CAT_STALK_SPEED : CAT_WALK_SPEED) * (this.state === 'exit' ? this.exitSpeed : 1);
        const dx = this.targetX - this.x;
        const step = Math.sign(dx) * Math.min(Math.abs(dx), speed * dt);
        this.x += step;
        this.walked += Math.abs(step);
        // Brushing past the plant sets it nodding.
        this.brush -= Math.abs(step);
        if (this.brush <= 0 && this.sill) {
          this.brush = 12;
          sillContacts.touch(this.sill.surface.left + this.x * this.sill.surface.frameScale, this.state === 'exit' && this.exitSpeed > 1 ? 0.5 : 0.25);
        }
        if (Math.abs(dx) > 0.5) this.facing = dx > 0 ? 1 : -1;
        if (Math.abs(this.targetX - this.x) < 0.5) {
          if (this.state === 'exit') {
            this.depart();
            return;
          }
          this.decide(birdsOnSill.length, wet);
        }
        break;
      }
      case 'pounce': {
        const t = clamp((this.timer - WINDUP) / (this.duration - WINDUP), 0, 1);
        this.x = this.pounceFrom + this.facing * 26 * t;
        if (this.timer >= this.duration) {
          if (this.sill) sillContacts.touch(this.sill.surface.left + this.x * this.sill.surface.frameScale, 0.8);
          if (this.rng() < 0.5) this.meow();
          this.decide(0, wet);
        }
        break;
      }
      default:
        if (this.state === 'sit') this.fidget(dt);
        if (this.timer >= this.duration) this.decide(birdsOnSill.length, wet);
    }
    this.x = this.state === 'exit' || this.state === 'enter' ? this.x : clamp(this.x, 34, width - 34);
    this.render(env, sill);
  }

  private arrive(sill: SillState): void {
    const width = sillWidth(sill);
    if (width < 170) {
      this.nextVisit = 30;
      return;
    }
    this.present = true;
    this.container.visible = true;
    this.coat = CAT_COATS[Math.floor(this.rng() * CAT_COATS.length)];
    const fromLeft = this.rng() < 0.5;
    this.x = fromLeft ? -CAT_WIDTH / 2 : width + CAT_WIDTH / 2;
    this.facing = fromLeft ? 1 : -1;
    this.elapsed = 0;
    this.visitLength = 60 + this.rng() * 180;
    this.state = 'enter';
    this.targetX = this.pickSpot(width, sill);
    if (this.rng() < 0.3) this.meow();
  }

  private leave(width: number, speed = 1): void {
    this.state = 'exit';
    this.exitSpeed = speed;
    this.timer = 0;
    this.targetX = this.x < width / 2 ? -CAT_WIDTH : width + CAT_WIDTH;
  }

  private depart(): void {
    this.present = false;
    this.container.visible = false;
    this.nextVisit = lerp(CAT_VISIT_INTERVAL[0], CAT_VISIT_INTERVAL[1], this.rng());
  }

  private decide(birds: number, wet: boolean): void {
    const sill = this.sill;
    if (!sill) return;
    const width = sillWidth(sill);
    const next = chooseCatState(this.state, { birdsOnSill: birds, elapsed: this.elapsed, visitLength: this.visitLength, wet }, this.rng);
    if (next === 'exit') {
      this.leave(width);
      return;
    }
    if (next === 'walk') this.targetX = this.pickSpot(width, sill);
    this.begin(next);
  }

  private begin(state: CatState): void {
    this.state = state;
    this.timer = 0;
    this.duration = catStateDuration(state, this.rng);
    this.micro = null;
    this.microIn = 1 + this.rng() * 2;
  }

  /** Every few seconds while it sits, one of its little habits. */
  private fidget(dt: number): void {
    if (this.micro) {
      this.micro.t += dt;
      if (this.micro.t >= this.micro.length) this.micro = null;
      return;
    }
    this.microIn -= dt;
    if (this.microIn > 0) return;
    this.microIn = 1.5 + this.rng() * 3.5;
    const roll = this.rng();
    this.micro =
      roll < 0.35
        ? { kind: 'blink', t: 0, length: 0.5 }
        : roll < 0.6
          ? { kind: 'swish', t: 0, length: 0.9 }
          : roll < 0.8
            ? { kind: 'look', t: 0, length: 1.5 + this.rng() * 2 }
            : { kind: 'ear', t: 0, length: 0.25 };
  }

  /** Somewhere to stroll to, away from the bowl. */
  private pickSpot(width: number, sill: SillState): number {
    for (let i = 0; i < 10; i++) {
      const x = 40 + this.rng() * (width - 80);
      if (Math.abs(x - sill.bowlX) > sill.bowlHalfWidth + 40) return x;
    }
    return 40 + this.rng() * (width - 80);
  }

  private pet(): void {
    if (this.state === 'nap') {
      this.voice('cat-purr');
      this.begin('stretch');
    } else {
      this.meow();
      if (this.state !== 'exit' && this.state !== 'pounce') {
        this.begin('sit');
        // It turns to look at you.
        this.micro = { kind: 'look', t: 0, length: 2.5 };
      }
    }
  }

  private meow(): void {
    this.voice('cat-meow');
  }

  private voice(id: 'cat-meow' | 'cat-purr'): void {
    const sill = this.sill;
    if (!sill) return;
    const { left, right, frameScale } = sill.surface;
    const screenX = left + this.x * frameScale;
    const half = Math.max(1, (right - left) / 2);
    this.emitSound(id, clamp((screenX - (left + half)) / half, -1, 1), 0);
  }

  private pose(): CatPose {
    const t = this.timer;
    switch (this.state) {
      case 'enter':
      case 'walk':
      case 'exit':
        return CAT_WALK[Math.floor(this.walked / 2.5) % CAT_WALK.length];
      case 'stalk':
        return CAT_STALK[Math.floor(this.walked / 2.8) % CAT_STALK.length];
      case 'pounce': {
        if (t < WINDUP) return Math.floor(t / 0.11) % 2 === 0 ? 'wiggle-1' : 'wiggle-2';
        const k = (t - WINDUP) / (this.duration - WINDUP);
        return k < 0.3 ? 'pounce-1' : k < 0.7 ? 'pounce-2' : 'pounce-3';
      }
      case 'sit': {
        const m = this.micro;
        if (m?.kind === 'blink') return m.t > 0.08 && m.t < 0.42 ? 'sit-blink' : 'sit';
        if (m?.kind === 'look') return 'sit-look';
        if (m?.kind === 'ear') return 'sit-ear';
        if (m?.kind === 'swish') {
          const f = Math.floor((m.t / m.length) * 6);
          return (['sit-swish-1', 'sit-swish-2', 'sit-swish-3', 'sit-swish-3', 'sit-swish-2', 'sit-swish-1'] as const)[Math.min(5, f)];
        }
        // Breathing, slow.
        return t % 2.6 < 1.3 ? 'sit' : 'sit-breathe';
      }
      case 'groom':
        // Licks at the paw, then a wash over the ear, with a pause now and then.
        return t % 5 > 4.3 ? 'sit-blink' : CAT_GROOM[Math.floor(t / 0.24) % CAT_GROOM.length];
      case 'loaf':
        return t % 5 > 4.6 ? 'loaf-blink' : 'loaf';
      case 'yawn': {
        const k = t / this.duration;
        return k < 0.15 ? 'yawn-1' : k < 0.3 ? 'yawn-2' : k < 0.7 ? 'yawn-3' : k < 0.85 ? 'yawn-2' : 'yawn-1';
      }
      case 'stretch': {
        const k = t / this.duration;
        return k < 0.2 ? 'stretch-1' : k < 0.65 ? 'stretch-2' : k < 0.85 ? 'stretch-1' : 'stretch-3';
      }
      case 'nap':
        return Math.floor(t / 1.6) % 2 === 0 ? 'nap-1' : 'nap-2';
      case 'chatter':
        // Bursts of chattering, between stares.
        return t % 1.8 < 1.1 && Math.floor(t / 0.08) % 2 === 0 ? 'chatter-1' : 'chatter-2';
    }
  }

  private render(env: Environment, sill: SillState): void {
    const fs = sill.surface.frameScale;
    const leap = this.state === 'pounce' ? clamp((this.timer - WINDUP) / (this.duration - WINDUP), 0, 1) : 0;
    const lift = Math.sin(Math.PI * leap) * 6;
    this.sprite.texture = this.sprites.get(this.coat, this.pose());
    this.sprite.scale.set(fs * this.facing, fs);
    const x = Math.round((sill.surface.left + this.x * fs) / fs) * fs;
    this.sprite.position.set(x, sill.surface.y + Math.round(2 - lift) * fs);
    this.sprite.tint = interiorTint(env.lighting);
    this.shadow.clear();
    const sitting = this.state === 'sit' || this.state === 'groom' || this.state === 'yawn' || this.state === 'chatter';
    this.shadow.ellipse(sitting ? -4 * this.facing : 0, 0, sitting ? 18 : 28, 2).fill({ color: 0x000000, alpha: 0.22 * (1 - lift / 12) });
    this.shadow.scale.set(fs);
    this.shadow.position.set(x, sill.surface.y + fs);
  }
}
