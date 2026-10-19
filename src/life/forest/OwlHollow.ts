import { Container, Sprite, type Texture } from 'pixi.js';
import { lerpColor } from '../../core/color';
import type { Viewport } from '../../core/Viewport';
import type { Environment } from '../../scene/Environment';
import { gridToTexture } from '../../sprites/cache';
import { drawOwlInHollow, type HollowFace } from '../../sprites/owlSprites';
import type { LifeSoundSink } from '../types';
import { wrapHours } from '../../state/timeOfDay';

/** Where the owl is through the day: asleep in the hollow, awake and peering out at dusk, out hunting by night. */
export function owlAtHome(hours: number): 'asleep' | 'peering' | 'out' {
  const h = wrapHours(hours);
  if (h >= 20.4 || h < 5.2) return 'out';
  if (h >= 18.6 || h < 6.4) return 'peering';
  return 'asleep';
}

/**
 * A tawny owl that lives in the hollow of the great oak: by day it dozes
 * in the mouth of the hole, eyes shut, opening one now and then; at dusk it
 * wakes, peers out and turns its head about, hoots, and slips away to hunt
 * (the owl that perches in the wood at night); it's back before sunrise.
 * Tap the hollow and it opens its eyes on you.
 */
export class OwlHollow {
  private readonly sprite = new Sprite();
  private readonly faces = new Map<HollowFace, Texture>();
  private blink = 0;
  private nextBlink = 8;
  private look = 0;
  private lookTimer = 3;
  private stare = 0;
  private hootTimer = 20;
  /** Shrunk back into the dark of the hole (s left): mobbed by small birds. */
  private hiding = 0;
  /** Turned to look towards a sound (−1 left, 1 right), for a while. */
  private heed = 0;
  private heedFor = 0;

  constructor(
    container: Container,
    /** The hole in the bark: its middle and half-width (the near oak's lower knot hole). */
    private readonly hole: { x: number; y: number; r: number },
    private readonly viewport: Viewport,
    private readonly sound: LifeSoundSink,
  ) {
    for (const face of ['sleep', 'blink', 'awake', 'look-l', 'look-r', 'empty'] as HollowFace[]) {
      const { grid, palette } = drawOwlInHollow(hole.r, face);
      this.faces.set(face, gridToTexture(grid, palette.colors));
    }
    const w = hole.r * 2 + 1;
    const h = (hole.r + 2) * 2 + 1;
    this.sprite.position.set(Math.round(hole.x - (w - 1) / 2), Math.round(hole.y - (h - 1) / 2));
    container.addChild(this.sprite);
  }

  /** Is the owl in at the moment? */
  home(hours: number): boolean {
    return owlAtHome(hours) !== 'out';
  }

  /** The hole (world px), for small birds to come and scold it. */
  get mouth(): { x: number; y: number } {
    return { x: this.hole.x, y: this.hole.y };
  }

  /** A sound off in the wood at world x (wolves howling): it turns its head that way and stares. */
  heedSound(x: number): void {
    this.heed = x < this.hole.x ? -1 : 1;
    this.heedFor = 4 + Math.random() * 3;
  }

  /** Scolded by small birds: it blinks at them, then shrinks back out of sight a while. */
  mobbed(): void {
    this.stare = 1.2;
    this.hiding = 8 + Math.random() * 8;
  }

  tap(x: number, y: number, hours: number): boolean {
    if (Math.abs(x - this.hole.x) > this.hole.r + 3 || Math.abs(y - this.hole.y) > this.hole.r + 5) return false;
    if (!this.home(hours)) return false;
    this.stare = 3;
    if (owlAtHome(hours) === 'peering') this.sound('owl-hoot', this.viewport.worldXToStereo(this.hole.x), 0.6);
    return true;
  }

  update(dt: number, env: Environment): void {
    const where = owlAtHome(env.lighting.hours);
    let face: HollowFace;
    if (this.heedFor > 0) this.heedFor -= dt;
    if (where === 'out') face = 'empty';
    else if (this.heedFor > 0) face = this.heed < 0 ? 'look-l' : 'look-r';
    else if (this.stare > 0) {
      this.stare -= dt;
      face = this.hiding > 0 && Math.floor(this.stare * 6) % 3 === 0 ? 'blink' : 'awake';
    } else if (this.hiding > 0) {
      this.hiding -= dt;
      face = 'empty';
    } else if (where === 'asleep') {
      // Dozing; one eye opens now and then to see what's about.
      this.nextBlink -= dt;
      if (this.nextBlink <= 0) {
        this.blink = 0.9 + Math.random() * 0.8;
        this.nextBlink = 10 + Math.random() * 25;
      }
      if (this.blink > 0) this.blink -= dt;
      face = this.blink > 0 ? 'blink' : 'sleep';
    } else {
      // Awake at dusk: it turns its head this way and that, and hoots into the gloom.
      this.lookTimer -= dt;
      if (this.lookTimer <= 0) {
        this.look = this.look === 0 ? (Math.random() < 0.5 ? -1 : 1) : 0;
        this.lookTimer = 1.5 + Math.random() * 4;
      }
      this.hootTimer -= dt;
      if (this.hootTimer <= 0) {
        this.hootTimer = 25 + Math.random() * 50;
        this.sound('owl-hoot', this.viewport.worldXToStereo(this.hole.x), 0.5);
      }
      face = this.look < 0 ? 'look-l' : this.look > 0 ? 'look-r' : Math.sin(env.time * 0.7) > 0.97 ? 'blink' : 'awake';
    }
    this.sprite.texture = this.faces.get(face)!;
    this.sprite.tint = lerpColor(env.lighting.ambient, 0xffffff, 0.05);
  }
}
