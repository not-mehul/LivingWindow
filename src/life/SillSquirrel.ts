import { Container, Graphics, Sprite } from 'pixi.js';
import { clamp } from '../core/math';
import type { Environment } from '../scene/Environment';
import { interiorTint } from '../scene/lighting';
import type { BirdseedState } from '../state/BirdseedState';
import { sillVisitInterval, squirrelActivity } from '../sim/wildlife';
import { visitGapScale } from '../state/mood';
import { SQUIRREL_RUN, SquirrelSpriteCache, type SquirrelCoat, type SquirrelPose } from '../sprites/forestSprites';
import { sillWidth, type LifeSoundSink, type SillState, sillPan, sillSnapX } from './types';

type State = 'enter' | 'sit' | 'run' | 'nibble' | 'exit';

const SIZE = 30;
const SPEED = 55;
/** Seed eaten per second of nibbling. */
const NIBBLE_RATE = 0.003;

/**
 * A squirrel that raids the windowsill bowl: it scampers in, sits up to
 * look around, nibbles seed, chatters, and dashes off. Tap it to shoo it.
 */
export class SillSquirrel {
  readonly container = new Container({ label: 'sill-squirrel' });
  private readonly sprite = new Sprite({ anchor: { x: 0.5, y: 1 } });
  private readonly shadow = new Graphics();
  private readonly sprites = new SquirrelSpriteCache();
  private present = false;
  private state: State = 'enter';
  private timer = 0;
  private duration = 0;
  private x = 0;
  private target = 0;
  private dir: 1 | -1 = 1;
  private stride = 0;
  private coat: SquirrelCoat = 'red';
  private visits = 0;
  private nextVisit = 60 + Math.random() * 90;
  private sill: SillState | null = null;

  constructor(
    private readonly birdseed: BirdseedState,
    private readonly sound: LifeSoundSink,
    private readonly canTap: () => boolean,
  ) {
    this.container.addChild(this.shadow, this.sprite);
    this.container.visible = false;
    this.sprite.eventMode = 'static';
    this.sprite.cursor = 'pointer';
    this.sprite.on('pointertap', () => {
      if (this.canTap() && this.present) {
        this.chatter();
        this.leave();
      }
    });
  }

  get position(): number | null {
    return this.present ? this.x : null;
  }

  summon(): void {
    this.nextVisit = 0;
  }

  /** A crack of thunder: off the sill in a flash. */
  bolt(): void {
    if (this.present) this.leave();
  }

  update(dt: number, env: Environment, sill: SillState): void {
    this.sill = sill;
    const wet = env.weather.kind === 'rain' && env.weather.precipitation > 0.1;
    if (!this.present) {
      this.nextVisit -= dt;
      if (this.nextVisit <= 0) {
        if (sill.windowOpen && !wet && squirrelActivity(env.lighting.hours) > 0) this.arrive(sill);
        else this.nextVisit = 30;
      }
      return;
    }
    const width = sillWidth(sill);
    this.timer += dt;
    if ((!sill.windowOpen || wet) && this.state !== 'exit') this.leave();

    switch (this.state) {
      case 'enter':
      case 'run':
      case 'exit': {
        const dx = this.target - this.x;
        this.dir = dx >= 0 ? 1 : -1;
        const step = Math.sign(dx) * Math.min(Math.abs(dx), SPEED * (this.state === 'exit' ? 1.6 : 1) * dt);
        this.x += step;
        this.stride += Math.abs(step);
        if (Math.abs(dx) < 0.5) {
          if (this.state === 'exit') {
            this.present = false;
            this.container.visible = false;
            this.nextVisit = sillVisitInterval(this.birdseed.isStocked) * visitGapScale();
            return;
          }
          this.atBowl() && this.birdseed.isStocked ? this.begin('nibble', 6 + Math.random() * 14) : this.begin('sit', 2 + Math.random() * 3);
        }
        break;
      }
      case 'nibble':
        this.birdseed.consume(NIBBLE_RATE * dt);
        if (this.timer >= this.duration || !this.birdseed.isStocked) this.decide();
        break;
      case 'sit':
        if (this.timer >= this.duration) this.decide();
        break;
    }
    if (this.state !== 'exit' && this.state !== 'enter') this.x = clamp(this.x, 12, width - 12);
    this.draw(env, sill);
  }

  private arrive(sill: SillState): void {
    this.present = true;
    this.container.visible = true;
    this.coat = Math.random() < 0.6 ? 'red' : 'grey';
    const width = sillWidth(sill);
    const fromLeft = Math.random() < 0.5;
    this.x = fromLeft ? -10 : width + 10;
    this.visits = 0;
    this.state = 'enter';
    this.target = this.bowlSpot(sill);
  }

  private decide(): void {
    const sill = this.sill;
    if (!sill) return;
    this.visits++;
    const roll = Math.random();
    if (this.visits > 4 + Math.random() * 4 || roll < 0.15) {
      this.leave();
    } else if (this.birdseed.isStocked && !this.atBowl()) {
      this.state = 'run';
      this.target = this.bowlSpot(sill);
    } else if (roll < 0.45) {
      this.chatter();
      this.begin('sit', 1.5 + Math.random() * 2);
    } else if (this.birdseed.isStocked && roll < 0.85) {
      this.begin('nibble', 5 + Math.random() * 10);
    } else {
      this.state = 'run';
      this.target = clamp(this.x + (Math.random() - 0.5) * 120, 20, sillWidth(sill) - 20);
    }
  }

  private begin(state: State, duration: number): void {
    this.state = state;
    this.timer = 0;
    this.duration = duration;
    if (state === 'nibble' && this.sill) this.dir = this.x < this.sill.bowlX ? 1 : -1;
  }

  private leave(): void {
    const sill = this.sill;
    if (!sill) return;
    this.state = 'exit';
    const width = sillWidth(sill);
    this.target = this.x < width / 2 ? -14 : width + 14;
  }

  private bowlSpot(sill: SillState): number {
    const side = this.x < sill.bowlX ? -1 : 1;
    return sill.bowlX + side * (sill.bowlHalfWidth + 12);
  }

  private atBowl(): boolean {
    const sill = this.sill;
    return !!sill && Math.abs(Math.abs(this.x - sill.bowlX) - (sill.bowlHalfWidth + 12)) < 3;
  }

  private chatter(): void {
    const sill = this.sill;
    if (!sill) return;
    this.sound('squirrel-chatter', sillPan(sill, this.x), 0);
  }

  private draw(env: Environment, sill: SillState): void {
    const fs = sill.surface.frameScale;
    let pose: SquirrelPose;
    if (this.state === 'nibble') pose = Math.floor(this.timer / 0.18) % 3 === 0 ? 'sit' : 'nibble';
    else if (this.state === 'sit') {
      // Sitting up, looking about: a glance the other way now and then.
      pose = 'sit';
    } else pose = SQUIRREL_RUN[Math.floor(this.stride / 4) % 4];
    this.sprite.texture = this.sprites.get(this.coat, pose, SIZE);
    const glance = this.state === 'sit' && Math.floor(this.timer / 1.3) % 3 === 2 ? -1 : 1;
    this.sprite.scale.set(fs * this.dir * glance, fs);
    const x = sillSnapX(sill, this.x);
    this.sprite.position.set(x, sill.surface.y + 2 * fs);
    this.sprite.tint = interiorTint(env.lighting);
    this.shadow.clear();
    this.shadow.ellipse(0, 0, 9, 1.6).fill({ color: 0x000000, alpha: 0.22 });
    this.shadow.scale.set(fs);
    this.shadow.position.set(x, sill.surface.y + fs);
  }
}
