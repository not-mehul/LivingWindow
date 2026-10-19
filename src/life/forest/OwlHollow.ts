import { Container, Sprite, type Texture } from 'pixi.js';
import { lerpColor } from '../../core/color';
import type { Viewport } from '../../core/Viewport';
import { PixelBuffer } from '../../core/pixelBuffer';
import type { Environment } from '../../scene/Environment';
import { pixelHash } from '../../sprites/raster';
import type { LifeSoundSink } from '../types';
import { wrapHours } from '../../state/timeOfDay';

/** Where the owl is through the day: asleep in the hollow, awake and peering out at dusk, out hunting by night. */
export function owlAtHome(hours: number): 'asleep' | 'peering' | 'out' {
  const h = wrapHours(hours);
  if (h >= 20.4 || h < 5.2) return 'out';
  if (h >= 18.6 || h < 6.4) return 'peering';
  return 'asleep';
}

type Face = 'sleep' | 'blink' | 'awake' | 'look-l' | 'look-r' | 'empty';

/**
 * A tawny owl that lives in the hollow of the great oak: by day it dozes
 * in the mouth of the hole, eyes shut, opening one now and then; at dusk it
 * wakes, peers out and turns its head about, hoots, and slips away to hunt
 * (the owl that perches in the wood at night); it's back before sunrise.
 * Tap the hollow and it opens its eyes on you.
 */
export class OwlHollow {
  private readonly sprite = new Sprite();
  private readonly faces = new Map<Face, Texture>();
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
    for (const face of ['sleep', 'blink', 'awake', 'look-l', 'look-r', 'empty'] as Face[]) this.faces.set(face, owlInHole(hole.r, face).toTexture());
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
    let face: Face;
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

/**
 * The hole's mouth with the owl in it: the dark of the hollow, and the
 * owl's round head filling it, mottled brown with its pale facial disk, ear
 * tufts and a hooked beak; its eyes shut (dozing), one open, both open and
 * gleaming, or the head turned aside. `empty` is just the dark hole.
 */
export function owlInHole(r: number, face: Face): PixelBuffer {
  const ry = r + 2;
  const W = r * 2 + 1;
  const H = ry * 2 + 1;
  const p = new PixelBuffer(W, H);
  const cx = r;
  const cy = ry;
  const inside = (x: number, y: number) => ((y - cy) / ry) ** 2 + ((x - cx) / r) ** 2;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (inside(x, y) < 0.72) p.set(x, y, 0x140e0a);
  if (face === 'empty') return p;
  const turn = face === 'look-l' ? -1 : face === 'look-r' ? 1 : 0;
  // Its body filling the bottom of the hole, streaked.
  for (let y = cy + 2; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (inside(x, y) >= 0.72) continue;
      p.set(x, y, pixelHash(x, y, 7) < 0.25 ? 0x6a4e32 : 0x9a7650);
    }
  }
  // The round head, the facial disk turned with it, and its ear tufts.
  const hx = cx + turn;
  const hy = cy - 1;
  const hr = Math.max(3, r - 1.5);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (inside(x, y) >= 0.72) continue;
      const d = Math.hypot((x - hx) / hr, (y - hy) / (hr * 0.92));
      if (d > 1) continue;
      const disk = Math.hypot((x - hx - turn * 0.6) / (hr * 0.78), (y - hy - 0.4) / (hr * 0.7)) < 1;
      p.set(x, y, disk ? (pixelHash(x, y, 9) < 0.15 ? 0xc8b08a : 0xdcc8a4) : pixelHash(x, y, 8) < 0.3 ? 0x7a5a3a : 0x9a7650);
    }
  }
  for (const side of [-1, 1]) {
    const tx = Math.round(hx + side * (hr * 0.65));
    const ty = Math.round(hy - hr * 0.95);
    if (inside(tx, ty) < 0.72) p.set(tx, ty, 0x6a4e32);
    if (inside(tx + side, ty - 1) < 0.72) p.set(tx + side, ty - 1, 0x5a3e26);
  }
  // Eyes: shut slits while dozing, one open in a blink, or both wide and gold.
  const ey = Math.round(hy);
  const exs = [Math.round(hx - hr * 0.42 + turn * 0.5), Math.round(hx + hr * 0.42 + turn * 0.5)];
  exs.forEach((ex, i) => {
    const open = face === 'awake' || face === 'look-l' || face === 'look-r' || (face === 'blink' && i === 1);
    if (open) {
      // A gold ring round a black pupil.
      p.set(ex + (i === 0 ? -1 : 1), ey, 0xf0c040);
      p.set(ex, ey + 1, 0xd8a030);
      p.set(ex, ey - 1, 0xf8d860);
      p.set(ex, ey, 0x140c08);
    } else {
      p.set(ex - 1, ey, 0x5a3e26);
      p.set(ex, ey, 0x4a3020);
      p.set(ex + 1, ey, 0x5a3e26);
    }
  });
  // The beak.
  p.set(Math.round(hx + turn * 0.8), ey + 2, 0x8a7a60);
  p.set(Math.round(hx + turn * 0.8), ey + 3, 0x6a5a48);
  return p;
}
