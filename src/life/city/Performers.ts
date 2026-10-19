import { Container, Graphics, Sprite, type Texture } from 'pixi.js';
import { gridToTexture } from '../../sprites/birdSprites';
import { drawBusker, drawPerson, randomLook, type PersonFacing, type PersonLook, type PersonPose } from '../../sprites/people';
import type { StallKind } from '../../sprites/streetSprites';
import type { Environment } from '../../scene/Environment';
import { glowTexture } from '../../scene/common/glow';
import { FOCAL } from '../../sim/groundPlane';
import { buskerOut } from '../../sim/wildlife';
import type { LifeSoundSink } from '../types';
import { PERSON_HEIGHT_AT_1 } from '../StreetLife';

const r = (a: number, b: number) => a + Math.random() * (b - a);

interface Bystander {
  look: PersonLook;
  gx: number;
  depth: number;
  dir: 1 | -1;
  /** Seconds before they wander off (and someone else may stop). */
  stay: number;
  phase: number;
  sprite: Sprite;
  textures: Map<string, Texture>;
  /** Walking away once they're done (ground px/s along the street; 0 while they stand). */
  leaving: number;
  /** Looking up at the sky (fireworks) for this long. */
  gazing?: number;
}

export interface PerformersOptions {
  /** Where people stand, sorted with the street's other life. */
  container: Container;
  /** Additive layer (coin glints). */
  lights: Container;
  project: (gx: number, depth: number) => { x: number; y: number };
  tintAt: (gx: number, depth: number) => number;
  /** The stalls open now. */
  openStalls: () => Array<{ kind: StallKind; gx: number; depth: number }>;
  sound: LifeSoundSink;
  /** Stereo pan for a world x. */
  pan: (x: number) => number;
}

/** The busker's pitch: the empty day-stall pitch under the lamp on the right, after the day market packs up. */
const PITCH = { gx: 60, depth: 2.02 };

/**
 * The street's evening entertainment: a busker playing under the lamp with
 * a little crowd swaying in front and now and then tossing a coin into the
 * open guitar case, clapping when each song ends; and a queue at the
 * noodle stall.
 */
export class Performers {
  private readonly busker: { look: PersonLook; sprite: Sprite; textures: Map<string, Texture> };
  private readonly crowd: Bystander[] = [];
  private readonly queue: Bystander[] = [];
  private readonly props = new Graphics();
  private readonly coins: Array<{ x0: number; y0: number; x1: number; y1: number; t: number; sprite: Sprite }> = [];
  private playing = false;
  private forced = false;
  private strumTimer = 0;
  private crowdTimer = 0;
  private queueTimer = 0;
  /** Seconds left of this song; then a pause for applause. */
  private song = r(30, 60);
  private applause = 0;

  constructor(private readonly options: PerformersOptions) {
    this.busker = { look: randomLook(), sprite: new Sprite({ anchor: { x: 0.5, y: 1 } }), textures: new Map() };
    this.busker.sprite.visible = false;
    options.container.addChild(this.busker.sprite, this.props);
    this.props.zIndex = options.project(PITCH.gx, PITCH.depth).y + 0.5;
  }

  /** Have the busker play regardless of the hour (for demos and tests). */
  summon(): void {
    this.forced = true;
  }

  get crowdSize(): number {
    return this.crowd.filter((b) => !b.leaving).length;
  }

  get queueLength(): number {
    return this.queue.filter((b) => !b.leaving).length;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  /** Where the busker plays. */
  get pitch(): { gx: number; depth: number } {
    return { ...PITCH };
  }

  /** A passer-by stops to listen: they join the ring as they are. */
  addListener(look: PersonLook): boolean {
    if (!this.playing || this.crowdSize >= 6) return false;
    this.joinCrowd(look);
    return true;
  }

  /** A passer-by drops a coin in the case as they go. */
  tossFrom(gx: number, depth: number): void {
    if (!this.playing) return;
    this.coinArc(gx, depth);
  }

  /** Everyone standing watching looks up at the sky a while (fireworks). */
  lookUp(seconds: number): void {
    for (const b of [...this.crowd, ...this.queue]) if (!b.leaving) b.gazing = seconds * r(0.7, 1.1);
  }

  update(dt: number, env: Environment): void {
    const raining = env.weather.kind === 'rain' && env.weather.precipitation > 0.15;
    const out = this.forced || buskerOut(env.lighting.hours, raining);
    this.updateBusker(dt, env, out);
    this.updateQueue(dt, env, raining);
  }

  // --- The busker -----------------------------------------------------

  private updateBusker(dt: number, env: Environment, out: boolean): void {
    const { project, tintAt } = this.options;
    this.playing = out;
    const b = this.busker;
    b.sprite.visible = out;
    this.props.clear();
    if (out) {
      const p = project(PITCH.gx, PITCH.depth);
      const h = Math.max(3, Math.round(PERSON_HEIGHT_AT_1 / PITCH.depth));
      const frame = this.applause > 0 ? 0 : Math.floor(env.time * 4) % 2;
      const key = `${frame}:${h}`;
      let t = b.textures.get(key);
      if (!t) {
        const { grid, palette } = drawBusker(b.look, frame, h);
        t = gridToTexture(grid, palette.colors);
        b.textures.set(key, t);
      }
      b.sprite.texture = t;
      b.sprite.position.set(Math.round(p.x), Math.round(p.y));
      b.sprite.zIndex = p.y;
      b.sprite.tint = tintAt(PITCH.gx, PITCH.depth);
      // The open guitar case on the paving in front, a few coins in it.
      const c = project(PITCH.gx - 10, PITCH.depth - 0.03);
      const w = Math.max(3, Math.round(16 / PITCH.depth));
      this.props.rect(Math.round(c.x - w / 2), Math.round(c.y) - 2, w, 2).fill(0x3a2418).rect(Math.round(c.x - w / 2) + 1, Math.round(c.y) - 2, w - 2, 1).fill(0x8a2a3a);
      this.props.rect(Math.round(c.x) - 1, Math.round(c.y) - 2, 1, 1).fill(0xe8c050);
      this.props.tint = tintAt(PITCH.gx, PITCH.depth);
      this.props.zIndex = c.y;
      // A strummed chord every few seconds; between songs, a pause while the crowd claps.
      this.song -= dt;
      if (this.song <= 0 && this.applause <= 0) {
        this.applause = r(3, 4.5);
        if (this.crowdSize > 0) this.options.sound('applause', this.options.pan(p.x), 0.4 + Math.min(0.4, this.crowdSize * 0.08));
      }
      if (this.applause > 0) {
        this.applause -= dt;
        if (this.applause <= 0) this.song = r(30, 70);
      } else {
        this.strumTimer -= dt;
        if (this.strumTimer <= 0) {
          this.strumTimer = r(1.6, 3.2);
          this.options.sound('guitar-strum', this.options.pan(p.x), 0.55);
        }
      }
      // People stop to listen.
      this.crowdTimer -= dt;
      if (this.crowdTimer <= 0) {
        this.crowdTimer = r(4, 12);
        if (this.crowdSize < 5) this.joinCrowd();
      }
    }
    this.stepPeople(this.crowd, dt, env, !out, (bs) => {
      // Now and then someone tosses a coin into the case.
      if (out && Math.random() < dt * 0.05) this.tossCoin(bs);
    });
    this.updateCoins(dt, env);
  }

  private joinCrowd(look?: PersonLook): void {
    // A loose half-ring in front of the busker, on the street side.
    const a = r(-0.9, 0.9);
    const gx = PITCH.gx - 22 - Math.cos(a) * r(6, 14);
    const depth = PITCH.depth + (Math.sin(a) * r(14, 30)) / FOCAL;
    this.crowd.push(this.bystander(gx, depth, 1, r(20, 60), look));
  }

  private tossCoin(from: Bystander): void {
    this.coinArc(from.gx, from.depth);
  }

  private coinArc(gx: number, depth: number): void {
    const from = { gx, depth };
    const { project, lights } = this.options;
    const a = project(from.gx, from.depth);
    const b = project(PITCH.gx - 10, PITCH.depth - 0.03);
    const h = PERSON_HEIGHT_AT_1 / from.depth;
    const sprite = new Sprite({ texture: glowTexture(1, 0xffe080), anchor: 0.5, blendMode: 'add' });
    lights.addChild(sprite);
    this.coins.push({ x0: a.x + 2, y0: a.y - h * 0.5, x1: b.x, y1: b.y - 2, t: 0, sprite });
  }

  private updateCoins(dt: number, env: Environment): void {
    for (let i = this.coins.length - 1; i >= 0; i--) {
      const c = this.coins[i];
      c.t += dt / 0.6;
      if (c.t >= 1) {
        c.sprite.destroy();
        this.coins.splice(i, 1);
        continue;
      }
      const x = c.x0 + (c.x1 - c.x0) * c.t;
      const y = c.y0 + (c.y1 - c.y0) * c.t - Math.sin(c.t * Math.PI) * 8;
      c.sprite.position.set(Math.round(x), Math.round(y));
      c.sprite.alpha = 0.5 + 0.5 * Math.max(env.lighting.emissive, 0.4);
    }
  }

  // --- The noodle queue --------------------------------------------------

  private updateQueue(dt: number, env: Environment, raining: boolean): void {
    const noodles = this.options.openStalls().find((s) => s.kind === 'noodles');
    this.queueTimer -= dt;
    if (noodles && this.queueTimer <= 0) {
      this.queueTimer = r(5, 14) * (raining ? 2 : 1);
      if (this.queueLength < 5 && Math.random() < 0.7) {
        // Join the end of the line, which runs out from the counter into the street.
        const side = Math.sign(noodles.gx);
        const n = this.queueLength;
        const gx = noodles.gx - side * (16 + n * 9);
        this.queue.push(this.bystander(gx, noodles.depth + r(-0.005, 0.005), side > 0 ? 1 : -1, r(15, 40)));
      }
    }
    this.stepPeople(this.queue, dt, env, !noodles, () => undefined, (left) => {
      // The ones behind shuffle up as the front of the queue leaves.
      if (!noodles) return;
      const side = Math.sign(noodles.gx);
      for (const q of this.queue) if (!q.leaving && Math.abs(q.gx - noodles.gx) > Math.abs(left.gx - noodles.gx)) q.gx += side * 9;
    });
  }

  // --- Shared ----------------------------------------------------------

  private bystander(gx: number, depth: number, dir: 1 | -1, stay: number, look?: PersonLook): Bystander {
    const sprite = new Sprite({ anchor: { x: 0.5, y: 1 } });
    this.options.container.addChild(sprite);
    return { look: look ?? randomLook(), gx, depth, dir, stay, phase: Math.random() * 6, sprite, textures: new Map(), leaving: 0 };
  }

  /** Stand, sway, and when their time's up (or the show's over) walk off up or down the street. */
  private stepPeople(list: Bystander[], dt: number, env: Environment, disperse: boolean, onStand: (b: Bystander) => void, onLeave?: (b: Bystander) => void): void {
    const { project, tintAt } = this.options;
    for (let i = list.length - 1; i >= 0; i--) {
      const b = list[i];
      b.stay -= dt;
      if (!b.leaving && (b.stay <= 0 || disperse)) {
        b.leaving = (Math.random() < 0.5 ? 1 : -1) * r(16, 26);
        onLeave?.(b);
      }
      let facing: PersonFacing = 'side';
      let pose: PersonPose = 'stand';
      let frame = 0;
      if (b.leaving) {
        b.depth += (b.leaving * dt) / FOCAL;
        b.phase += Math.abs(b.leaving) * dt * 0.45 / b.depth;
        facing = b.leaving > 0 ? 'back' : 'front';
        pose = 'walk';
        frame = Math.floor(b.phase) % 4;
        if (b.depth < 0.9 || b.depth > 9.5) {
          b.sprite.destroy();
          for (const t of b.textures.values()) t.destroy(true);
          list.splice(i, 1);
          continue;
        }
      } else {
        onStand(b);
        if (b.gazing && b.gazing > 0) {
          // Heads tipped back at the sky.
          b.gazing -= dt;
          facing = 'back';
          pose = 'look-up';
        } else if (this.applause > 0 && list === this.crowd) {
          pose = 'clap';
          frame = Math.floor(env.time * 7 + b.phase) % 2;
        }
      }
      const p = project(b.gx, b.depth);
      const h = Math.max(3, Math.round(PERSON_HEIGHT_AT_1 / b.depth));
      const key = `${facing}:${pose}:${frame}:${h}`;
      let t = b.textures.get(key);
      if (!t) {
        const { grid, palette } = drawPerson(b.look, facing, pose, frame, false, h);
        t = gridToTexture(grid, palette.colors);
        b.textures.set(key, t);
      }
      b.sprite.texture = t;
      // Swaying to the music while they stand.
      const sway = !b.leaving && pose === 'stand' && this.applause <= 0 ? Math.round(Math.sin(env.time * 2.2 + b.phase) * 0.6) : 0;
      b.sprite.position.set(Math.round(p.x) + sway, Math.round(p.y));
      b.sprite.zIndex = p.y;
      b.sprite.scale.x = b.dir;
      b.sprite.tint = tintAt(b.gx, b.depth);
    }
  }
}
