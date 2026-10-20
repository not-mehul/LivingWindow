import { Container, Sprite } from 'pixi.js';
import { clamp, lerp } from '../core/math';
import type { Environment } from '../scene/Environment';
import { interiorTint } from '../scene/lighting';
import { DOG_HEIGHT, DOG_PANT_FACE, DOG_PANT_SIDE, DOG_SURFACE_ROW, DogSpriteCache, randomDogLook, type DogLook, type DogPose } from '../sprites/dogSprites';
import { sillContacts } from '../window/sillContacts';
import { visitGapScale } from '../state/mood';
import { sillWidth, type LifeSoundSink, type SillState, sillPan, sillScreenX, sillSnapX } from './types';

/** Seconds between visits (min, max). */
export const DOG_VISIT_INTERVAL: readonly [number, number] = [4 * 60, 12 * 60];
const DOG_FIRST_VISIT: readonly [number, number] = [45, 150];
/** How long it stays up at the window (s). */
const DOG_STAY: readonly [number, number] = [15, 60];
const RISE_TIME = 0.75;
const DROP_TIME = 0.55;
/** How far below its place it starts and ends (art px): out of sight below the sill. */
const HIDDEN_DROP = 92;

type Phase = 'gone' | 'rise' | 'up' | 'drop';
type Gaze = 'out' | 'side' | 'face';

/** Where the dog looks next: out of the window, along it (at a bird if there is one), or round at you. */
export function chooseGaze(current: Gaze, birdNear: boolean, rng: () => number): Gaze {
  const weights: Array<[Gaze, number]> = [
    ['out', current === 'out' ? 0.6 : 1.4],
    ['side', birdNear ? 3 : current === 'side' ? 0.8 : 1.6],
    ['face', current === 'face' ? 0.3 : 1],
  ];
  const total = weights.reduce((sum, [, w]) => sum + w, 0);
  let roll = rng() * total;
  for (const [gaze, w] of weights) {
    roll -= w;
    if (roll < 0) return gaze;
  }
  return 'out';
}

/**
 * The household dog, in the meadow, forest and beach houses. Now and then it
 * comes up to the open window, front paws on the sill, and looks out: the
 * back of its head as it gazes off, its head turned along the window (to
 * follow a bird on the sill), or round over its shoulder at you, panting
 * happily with its tongue out. It blinks, flicks an ear, sniffs the breeze,
 * licks its chops, and gives a soft "boof" when a bird lands. Tap it and it
 * cocks its head at you. When the window shuts, or it's had enough, it
 * drops back down into the room.
 */
export class WindowDog {
  readonly container = new Container({ label: 'window-dog' });
  private readonly sprite = new Sprite({ anchor: { x: 0.5, y: 1 } });
  private readonly sprites = new DogSpriteCache();
  private look: DogLook;
  private phase: Phase = 'gone';
  private timer = 0;
  private nextVisit: number;
  private stay = 0;
  private x = 0;
  private gaze: Gaze = 'out';
  private gazeTime = 0;
  private gazeFor = 3;
  /** Which way it faces when it looks along the window. */
  private facing: 1 | -1 = 1;
  private panting = false;
  private pantTimer = 0;
  private time = 0;
  /** A brief flourish: a blink, an ear flick, a sniff, a lick, or its head on one side. */
  private flourish: { pose: DogPose; until: number } | null = null;
  private flourishIn = 2;
  private lastBirds = 0;
  private boofCooldown = 0;
  private sill: SillState | null = null;
  /** Something out there it's keen on (sill art px along the window), e.g. the sheepdog at work. */
  private interest: number | null = null;
  /** About to howl along with something (s), or negative. */
  private pendingHowl = -1;
  /** Not to snap round at every bird: the next glance no sooner than this. */
  private glanceAt = 0;

  constructor(
    private readonly emitSound: LifeSoundSink,
    private readonly canTap: () => boolean,
    /** It comes up among the birds on the sill, or boofs at them: they scatter from round it. */
    private readonly startle: (sillX: number) => void = () => {},
    private readonly rng: () => number = Math.random,
  ) {
    this.look = randomDogLook(rng);
    this.nextVisit = lerp(DOG_FIRST_VISIT[0], DOG_FIRST_VISIT[1], rng()) * visitGapScale();
    this.container.addChild(this.sprite);
    this.container.visible = false;
    this.sprite.eventMode = 'static';
    this.sprite.cursor = 'pointer';
    this.sprite.on('pointertap', () => {
      if (this.canTap()) this.pet();
    });
  }

  get isPresent(): boolean {
    return this.phase !== 'gone';
  }

  /** Its place along the sill (art px from the left), while it's up. */
  get position(): number | null {
    return this.phase === 'up' ? this.x : null;
  }

  /** Bring the dog to the window now. */
  summon(): void {
    this.nextVisit = 0;
  }

  /** Thunder right overhead: down from the window it goes, and it won't come back for a good while. */
  spook(): void {
    if (this.phase === 'up' || this.phase === 'rise') this.leave();
    this.pendingHowl = -1;
    this.nextVisit = Math.max(this.nextVisit, 300 + this.rng() * 300);
  }

  /** A bird flashing past close to the window (sill art px): its head snaps round to follow it. */
  glance(sillX: number): void {
    if (this.phase !== 'up' || this.flourish?.pose === 'howl' || this.time < this.glanceAt) return;
    this.glanceAt = this.time + 4;
    this.gaze = 'side';
    this.gazeTime = 0;
    this.gazeFor = 1.2 + this.rng();
    this.facing = sillX >= this.x ? 1 : -1;
    this.flourish = null;
  }

  /** Wolves howling far off: it comes to the window (if it can) and, head back, howls along. */
  answerHowl(): void {
    if (this.phase === 'gone') {
      if (this.rng() < 0.6) {
        this.nextVisit = 0;
        this.pendingHowl = 2.5 + this.rng() * 2;
      }
      return;
    }
    this.pendingHowl = 0.8 + this.rng() * 1.5;
  }

  /**
   * Something going on outside that a dog can't ignore (sill art px along
   * the window, or null when it's over): it's likelier to come and look,
   * and keeps turning its head to watch it, with the odd boof.
   */
  watch(sillX: number | null): void {
    if (sillX !== null && this.interest === null && this.phase === 'gone' && this.nextVisit > 8 && this.rng() < 0.6) this.nextVisit = 2 + this.rng() * 5;
    this.interest = sillX;
  }

  /** `birds`: sill x of each bird on the sill. */
  update(dt: number, env: Environment, sill: SillState, birds: number[]): void {
    this.sill = sill;
    this.time += dt;
    this.timer += dt;
    this.boofCooldown -= dt;
    const width = sillWidth(sill);
    switch (this.phase) {
      case 'gone':
        this.nextVisit -= dt;
        if (this.nextVisit <= 0) {
          if (sill.windowOpen && width >= 130) this.arrive(width, sill);
          else this.nextVisit = 20;
        }
        return;
      case 'rise':
        if (this.timer >= RISE_TIME) {
          this.phase = 'up';
          this.timer = 0;
          // Paws down on the sill: the plant feels it.
          this.touch(0.6);
        }
        break;
      case 'up':
        if (!sill.windowOpen || this.timer > this.stay) this.leave();
        else this.behave(dt, birds);
        break;
      case 'drop':
        if (this.timer >= DROP_TIME) {
          this.phase = 'gone';
          this.container.visible = false;
          this.nextVisit = Math.max(this.nextVisit, lerp(DOG_VISIT_INTERVAL[0], DOG_VISIT_INTERVAL[1], this.rng()) * visitGapScale());
          return;
        }
        break;
    }
    this.lastBirds = birds.length;
    this.render(env, sill);
  }

  private arrive(width: number, sill: SillState): void {
    // A different dog each time, as if from a different house along the way.
    this.look = randomDogLook(this.rng);
    const margin = Math.min(width / 2, 52);
    for (let i = 0; i < 8; i++) {
      this.x = margin + this.rng() * Math.max(0, width - margin * 2);
      if (Math.abs(this.x - sill.bowlX) > sill.bowlHalfWidth + 30) break;
    }
    this.phase = 'rise';
    this.timer = 0;
    this.stay = lerp(DOG_STAY[0], DOG_STAY[1], this.rng());
    this.gaze = 'out';
    this.gazeTime = 0;
    this.gazeFor = 2 + this.rng() * 3;
    this.panting = this.rng() < 0.5;
    this.pantTimer = 4 + this.rng() * 8;
    this.flourish = null;
    this.container.visible = true;
    this.startle(this.x);
  }

  private leave(): void {
    this.phase = 'drop';
    this.timer = 0;
    this.touch(0.4);
  }

  private behave(dt: number, birds: number[]): void {
    if (this.pendingHowl >= 0) {
      this.pendingHowl -= dt;
      if (this.pendingHowl < 0) {
        // Head back, a long soft howl, side on to the window.
        this.gaze = 'side';
        this.gazeTime = 0;
        this.gazeFor = 4;
        this.flourish = { pose: 'howl', until: this.time + 2.2 };
        this.stay = Math.max(this.stay, this.timer + 8);
        const sill = this.sill;
        if (sill) {
          this.emitSound('dog-howl', sillPan(sill, this.x), 0);
        }
        return;
      }
    }
    // Birds landing: it's very interested.
    if (birds.length > this.lastBirds) {
      this.gaze = 'side';
      this.gazeTime = 0;
      this.gazeFor = 3 + this.rng() * 3;
      this.facing = this.nearest(birds) >= this.x ? 1 : -1;
      if (this.boofCooldown <= 0 && this.rng() < 0.45) this.boof();
    }
    this.gazeTime += dt;
    if (this.gazeTime >= this.gazeFor) {
      const keen = this.interest;
      this.gaze = keen !== null && this.rng() < 0.7 ? 'side' : chooseGaze(this.gaze, birds.length > 0, this.rng);
      this.gazeTime = 0;
      this.gazeFor = this.gaze === 'face' ? 1.5 + this.rng() * 2.5 : 2 + this.rng() * 4;
      if (this.gaze === 'side') {
        if (keen !== null) this.facing = keen >= this.x ? 1 : -1;
        else this.facing = birds.length > 0 ? (this.nearest(birds) >= this.x ? 1 : -1) : this.rng() < 0.5 ? 1 : -1;
      }
      this.flourish = null;
    }
    if (this.interest !== null) {
      // Following it with its head as it goes.
      if (this.gaze === 'side') this.facing = this.interest >= this.x ? 1 : -1;
      if (this.boofCooldown <= 0 && this.rng() < dt / 25) this.boof();
    }
    this.pantTimer -= dt;
    if (this.pantTimer <= 0) {
      this.panting = !this.panting;
      this.pantTimer = this.panting ? 6 + this.rng() * 10 : 4 + this.rng() * 8;
    }
    if (this.flourish && this.time >= this.flourish.until) this.flourish = null;
    this.flourishIn -= dt;
    if (!this.flourish && this.flourishIn <= 0) {
      this.flourishIn = 1.2 + this.rng() * 2.5;
      this.flourish = this.pickFlourish();
    }
  }

  private pickFlourish(): { pose: DogPose; until: number } | null {
    const r = this.rng();
    const at = (pose: DogPose, length: number) => ({ pose, until: this.time + length });
    switch (this.gaze) {
      case 'out':
        return r < 0.5 ? at('away-ear', 0.3) : null;
      case 'side':
        if (r < 0.3) return at('side-blink', 0.18);
        if (r < 0.5) return at('side-ear', 0.3);
        if (r < 0.7) return at('side-sniff', 0.9);
        if (r < 0.82 && !this.panting) return at('side-lick', 0.35);
        return at(this.panting ? 'side-up-pant' : 'side-up', 1.4);
      case 'face':
        if (r < 0.35) return at('face-blink', 0.18);
        if (r < 0.7) return at(this.panting ? 'face-tilt-pant' : 'face-tilt', 1.4);
        return this.panting ? null : at('face-lick', 0.35);
    }
  }

  private nearest(birds: number[]): number {
    return birds.reduce((a, b) => (Math.abs(b - this.x) < Math.abs(a - this.x) ? b : a));
  }

  private pet(): void {
    if (this.phase !== 'up') return;
    // It turns round to you, head on one side, delighted.
    this.gaze = 'face';
    this.gazeTime = 0;
    this.gazeFor = 3;
    this.panting = true;
    this.pantTimer = 6;
    this.flourish = { pose: 'face-tilt-pant', until: this.time + 1.2 };
    this.stay = Math.max(this.stay, this.timer + 8);
    if (this.rng() < 0.3) this.boof();
  }

  private boof(): void {
    this.boofCooldown = 12;
    this.startle(this.x);
    const sill = this.sill;
    if (!sill) return;
    this.emitSound('dog-boof', sillPan(sill, this.x), 0);
  }

  private touch(strength: number): void {
    const sill = this.sill;
    if (sill) sillContacts.touch(sillScreenX(sill, this.x), strength);
  }

  private pose(): DogPose {
    if (this.phase !== 'up') return this.phase === 'rise' && this.timer > RISE_TIME * 0.8 ? 'away' : 'reach';
    if (this.flourish) return this.flourish.pose;
    const breathe = Math.floor(this.time / 1.1) % 2 === 0;
    const pant = Math.floor(this.time / 0.13) % 4;
    switch (this.gaze) {
      case 'out':
        return breathe ? 'away' : 'away-breathe';
      case 'side':
        return this.panting ? DOG_PANT_SIDE[pant] : breathe ? 'side' : 'side-breathe';
      case 'face':
        return this.panting ? DOG_PANT_FACE[pant] : 'face';
    }
  }

  private render(env: Environment, sill: SillState): void {
    const fs = sill.surface.frameScale;
    const k = this.phase === 'rise' ? clamp(this.timer / RISE_TIME, 0, 1) : this.phase === 'drop' ? 1 - clamp(this.timer / DROP_TIME, 0, 1) : 1;
    // Up quick and eager, a little bounce as the paws land; down in a slump.
    const ease = this.phase === 'rise' ? 1 - (1 - k) ** 3 + Math.sin(k * Math.PI) * 0.06 : k * k;
    const drop = Math.round((1 - ease) * HIDDEN_DROP);
    this.sprite.texture = this.sprites.get(this.look, this.pose());
    // Only its head turns: the body stays square to the window.
    const flip = this.gaze === 'side' && this.phase === 'up' ? this.facing : 1;
    this.sprite.scale.set(fs * flip, fs);
    const x = sillSnapX(sill, this.x);
    this.sprite.position.set(x, sill.surface.y + (DOG_HEIGHT - DOG_SURFACE_ROW + drop) * fs);
    this.sprite.tint = interiorTint(env.lighting);
  }
}
