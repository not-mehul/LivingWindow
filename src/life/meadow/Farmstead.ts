import { Container, Graphics, Sprite, type Texture } from 'pixi.js';
import { lerpColor } from '../../core/color';
import { PixelBuffer } from '../../core/pixelBuffer';
import type { Environment } from '../../scene/Environment';
import { glowTexture } from '../../scene/common/glow';
import type { FarmLayout } from '../../scene/meadow/farmstead';
import { meadowPlane } from '../../sim/meadowGeometry';
import { BirdSpriteCache, FLAP_CYCLE, gridToTexture, type BirdPose } from '../../sprites/birdSprites';
import { drawPerson, randomLook, type PersonFacing, type PersonLook } from '../../sprites/people';

const r = (min: number, max: number) => min + Math.random() * (max - min);

/** When someone's home and the lights are on: the evening, and before dawn on dark mornings. */
export function farmhouseLit(hours: number, dark: boolean): boolean {
  return (hours > 17.5 && hours < 23.4) || (dark && hours > 5.6 && hours < 7.6);
}

/** When the stove's lit: breakfast, and from teatime into the evening; all day in the snow. */
export function chimneySmoking(hours: number, snowing: boolean): boolean {
  return snowing ? hours > 6 && hours < 23 : (hours > 6 && hours < 9.5) || (hours > 16.5 && hours < 22.5);
}

interface Puff {
  x: number;
  y: number;
  age: number;
  life: number;
  size: number;
}

type CrowState = 'away' | 'in' | 'peck' | 'off';

interface Crow {
  sprite: Sprite;
  state: CrowState;
  timer: number;
  x: number;
  y: number;
  tx: number;
  ty: number;
  vx: number;
  vy: number;
  size: number;
  facing: 1 | -1;
  phase: number;
}

type FarmerState = 'away' | 'walk' | 'work';

/**
 * Life about the farm across the field: its windows lit in the evening (one
 * by one, as people move about the house), smoke from the chimney at
 * breakfast and teatime, a scarecrow in the vegetable patch whose sleeves
 * flap in the gusts, crows that drop in to peck the rows and flap off when it
 * shakes, and now and then the farmer walking down the track to work the
 * patch and back.
 */
export class Farmstead {
  readonly container = new Container({ label: 'farmstead' });
  private readonly windows: Array<{ glow: Sprite; pane: Sprite; on: number; off: number; level: number }> = [];
  private readonly smoke = new Graphics();
  private readonly puffs: Puff[] = [];
  private puffTimer = 0;
  private readonly scarecrow = new Sprite({ anchor: { x: 0.5, y: 1 } });
  private readonly scareFrames: Texture[];
  private shake = 0;
  private readonly crows: Crow[] = [];
  private readonly birdSprites = new BirdSpriteCache();
  private readonly farmer = new Sprite({ anchor: { x: 0.5, y: 1 } });
  private readonly farmerLook: PersonLook;
  private readonly farmerCache = new Map<string, Texture>();
  private farmerState: FarmerState = 'away';
  private farmerTimer = r(60, 240);
  private route: Array<{ gx: number; depth: number }> = [];
  private leg = 0;
  private pos = { gx: 0, depth: 9 };
  private stride = 0;
  private facing: PersonFacing = 'side';
  private dir: 1 | -1 = 1;

  constructor(
    midground: Container,
    private readonly farm: FarmLayout,
  ) {
    // Window panes (lit flat) and their glow; each window has its own hours, as people go from room to room.
    for (const w of farm.windows) {
      const pane = new Sprite(paneTexture(w.w, w.h));
      pane.position.set(w.x, w.y);
      const glow = new Sprite({ texture: glowTexture(Math.max(3, w.w * 2.5), 0xffb860, 0.8, false), anchor: 0.5, blendMode: 'add' });
      glow.position.set(w.x + w.w / 2, w.y + w.h / 2);
      pane.visible = glow.visible = false;
      this.container.addChild(glow, pane);
      this.windows.push({ glow, pane, on: r(-0.6, 0.8), off: r(-1.2, 0.6), level: 0 });
    }
    this.container.addChild(this.smoke);
    this.container.zIndex = farm.houseBaseY + 0.5;
    midground.addChild(this.container);

    this.scareFrames = [0, 1, 2].map((f) => scarecrowArt(farm.scarecrow.height, f).toTexture());
    this.scarecrow.texture = this.scareFrames[0];
    this.scarecrow.position.set(farm.scarecrow.x, farm.scarecrow.baseY);
    this.scarecrow.zIndex = farm.scarecrow.baseY;
    midground.addChild(this.scarecrow);

    const s = meadowPlane.scaleAtY(farm.patch.y1);
    for (let i = 0; i < 3; i++) {
      const sprite = new Sprite({ anchor: { x: 0.5, y: 0.8 } });
      sprite.visible = false;
      midground.addChild(sprite);
      this.crows.push({ sprite, state: 'away', timer: r(10, 90), x: 0, y: 0, tx: 0, ty: 0, vx: 0, vy: 0, size: Math.max(7, Math.round(40 * s)), facing: 1, phase: Math.random() * 4 });
    }

    // The farmer: a flat cap, a waxed jacket and work trousers.
    this.farmerLook = { ...randomLook(), hairStyle: 'cap', hat: 0x5a5040, topStyle: 'jacket', top: 0x4a5a3a, bottom: 0x3a4458, shorts: false, shoes: 0x2a2018, bag: 'none', broad: true };
    this.farmer.visible = false;
    midground.addChild(this.farmer);
  }

  /** How many crows are down in the patch. */
  get crowsDown(): number {
    return this.crows.filter((c) => c.state === 'peck').length;
  }

  get farmerOut(): boolean {
    return this.farmerState !== 'away';
  }

  /** Send the farmer out now (for the debug view). */
  callFarmer(): void {
    this.farmerTimer = 0;
  }

  update(dt: number, env: Environment): void {
    const { lighting, weather } = env;
    const h = lighting.hours;
    const wind = weather.wind ?? 0.2;
    const ambient = lerpColor(lighting.ambient, lighting.haze, 0.25);

    // Lights in the farmhouse.
    const lit = farmhouseLit(h, lighting.emissive > 0.3);
    for (const w of this.windows) {
      const want = lit && h > 17.5 + w.on && h < 23.4 + w.off ? 1 : lit && h < 12 ? 1 : 0;
      w.level += (want - w.level) * Math.min(1, dt * 3);
      const on = w.level > 0.02 && lighting.emissive > 0.12;
      w.pane.visible = w.glow.visible = on;
      if (!on) continue;
      const flicker = 0.92 + 0.08 * Math.sin(env.time * 3 + w.on * 9);
      w.pane.alpha = w.level * Math.min(1, lighting.emissive * 1.4);
      w.glow.alpha = w.level * lighting.emissive * 0.55 * flicker;
    }

    // Smoke from the chimney, leaning with the wind.
    const raining = weather.kind === 'rain' && weather.precipitation > 0.5;
    if (chimneySmoking(h, weather.kind === 'snow') && !raining) {
      this.puffTimer -= dt;
      if (this.puffTimer <= 0) {
        this.puffTimer = r(0.35, 0.7);
        this.puffs.push({ x: this.farm.chimney.x + r(-0.5, 0.5), y: this.farm.chimney.y, age: 0, life: r(4, 6), size: 1 });
      }
    }
    const g = this.smoke;
    g.clear();
    for (let k = this.puffs.length - 1; k >= 0; k--) {
      const p = this.puffs[k];
      p.age += dt;
      if (p.age > p.life) {
        this.puffs.splice(k, 1);
        continue;
      }
      const t = p.age / p.life;
      p.y -= dt * (3 - t * 1.6);
      p.x += dt * (wind * 6 * (0.3 + t)) + Math.sin(p.age * 1.7 + p.life) * dt * 0.6;
      const size = Math.max(1, Math.round(1 + t * 3));
      g.rect(Math.round(p.x - size / 2), Math.round(p.y - size / 2), size, size).fill({ color: 0xe8e8ec, alpha: 0.7 * (1 - t) ** 0.8 });
    }
    g.tint = lerpColor(lighting.ambient, 0xffffff, 0.2);

    // The scarecrow: its sleeves stir in a breeze and flap when a gust shakes it.
    const gust = Math.abs(wind) * (0.6 + 0.4 * Math.sin(env.time * 0.21 - this.farm.scarecrow.x * 0.011));
    if (this.shake > 0) this.shake -= dt;
    else if (Math.random() < dt * gust * 0.08) this.shake = r(1.2, 2.4);
    const flap = this.shake > 0 ? Math.floor(env.time * 7) % 3 : gust > 0.25 && Math.floor(env.time * 1.3) % 4 === 0 ? 1 : 0;
    this.scarecrow.texture = this.scareFrames[flap];
    this.scarecrow.tint = ambient;

    this.updateCrows(dt, env);
    this.updateFarmer(dt, env);
  }

  private updateCrows(dt: number, env: Environment): void {
    const { patch } = this.farm;
    const day = env.lighting.hours > 6.5 && env.lighting.hours < 19.5 && env.weather.precipitation < 0.5;
    const tint = lerpColor(env.lighting.ambient, env.lighting.haze, 0.2);
    for (const c of this.crows) {
      c.timer -= dt;
      if (c.state === 'away') {
        c.sprite.visible = false;
        if (c.timer <= 0) {
          c.timer = r(40, 160);
          if (!day || this.farmerState === 'work') continue;
          // In from the trees, gliding down onto the rows.
          const side = Math.random() < 0.5 ? -1 : 1;
          c.x = (patch.x0 + patch.x1) / 2 + side * r(60, 120);
          c.y = r(150, 175);
          c.tx = r(patch.x0 + 3, patch.x1 - 3);
          c.ty = r(patch.y0 + 1, patch.y1);
          c.state = 'in';
        }
        continue;
      }
      c.sprite.visible = true;
      let pose: BirdPose;
      if (c.state === 'in') {
        const dx = c.tx - c.x;
        const dy = c.ty - c.y;
        const d = Math.hypot(dx, dy);
        const speed = 22;
        if (d < 1) {
          c.state = 'peck';
          c.timer = r(12, 50);
          c.x = c.tx;
          c.y = c.ty;
          pose = 'idle';
        } else {
          c.x += (dx / d) * Math.min(d, speed * dt);
          c.y += (dy / d) * Math.min(d, speed * dt);
          c.facing = dx >= 0 ? 1 : -1;
          pose = d < 8 ? 'glide' : FLAP_CYCLE[Math.floor(env.time * 10 + c.phase) % 4];
        }
      } else if (c.state === 'peck') {
        // Hop and peck along the row; a shaking scarecrow, the farmer or the dark sends them off.
        if (this.shake > 0.8 || this.farmerState === 'work' || !day || c.timer <= 0) {
          c.state = 'off';
          c.vx = (Math.random() < 0.5 ? -1 : 1) * r(18, 26);
          c.vy = -r(10, 16);
          c.facing = c.vx > 0 ? 1 : -1;
        }
        const t = Math.floor(env.time * 2 + c.phase * 3) % 6;
        pose = t < 2 ? 'peck-down' : t < 3 ? 'peck-reach' : t < 5 ? 'idle' : 'look-back';
        if (t === 5 && Math.random() < dt * 2) {
          c.x = Math.max(patch.x0, Math.min(patch.x1, c.x + c.facing * 1));
          if (Math.random() < 0.3) c.facing = c.facing === 1 ? -1 : 1;
        }
      } else {
        c.x += c.vx * dt;
        c.y += c.vy * dt;
        c.vy -= dt * 3;
        pose = FLAP_CYCLE[Math.floor(env.time * 12 + c.phase) % 4];
        if (c.y < 120 || c.x < -20 || c.x > 860) {
          c.state = 'away';
          c.timer = r(30, 120);
        }
      }
      c.sprite.texture = this.birdSprites.get('crow', pose, c.size);
      c.sprite.scale.x = c.facing;
      c.sprite.position.set(Math.round(c.x), Math.round(c.y));
      c.sprite.zIndex = c.state === 'peck' ? c.y : 400;
      c.sprite.tint = tint;
    }
  }

  private updateFarmer(dt: number, env: Environment): void {
    const h = env.lighting.hours;
    const workday = h > 7 && h < 18.5 && env.weather.precipitation < 0.4;
    if (this.farmerState === 'away') {
      this.farmer.visible = false;
      this.farmerTimer -= dt;
      if (this.farmerTimer > 0) return;
      this.farmerTimer = r(420, 1100);
      if (!workday) return;
      // From the yard down the track to the patch, and back.
      const t = this.farm.track;
      const patchSpot = { gx: r(700, 900), depth: r(4.15, 4.45) };
      const gate = { gx: t[1].gx - 60, depth: 4.55 };
      this.route = [t[3], t[2], t[1], gate, patchSpot];
      this.pos = { ...t[3] };
      this.leg = 1;
      this.farmerState = 'walk';
    }
    if (this.farmerState === 'walk') {
      const target = this.route[this.leg];
      const dx = target.gx - this.pos.gx;
      const dz = (target.depth - this.pos.depth) * 700;
      const d = Math.hypot(dx, dz);
      const step = 38 * dt;
      if (d <= step) {
        this.pos = { ...target };
        this.leg++;
        if (this.leg >= this.route.length) {
          if (this.route[this.route.length - 1].depth < 5) {
            // At the patch: work a while, then home the way he came.
            this.farmerState = 'work';
            this.farmerTimer = r(25, 60);
            this.route = [...this.route].reverse();
          } else {
            this.farmerState = 'away';
            this.farmer.visible = false;
            return;
          }
          this.leg = 1;
        }
      } else {
        this.pos.gx += (dx / d) * step;
        this.pos.depth += (dz / d / 700) * step;
        this.stride += step * meadowPlane.project(this.pos.gx, this.pos.depth).scale;
        this.facing = Math.abs(dz) > Math.abs(dx) * 2 ? (dz < 0 ? 'front' : 'back') : 'side';
        if (Math.abs(dx) > 1) this.dir = dx > 0 ? 1 : -1;
      }
    } else if (this.farmerState === 'work') {
      this.farmerTimer -= dt;
      this.facing = 'front';
      if (this.farmerTimer <= 0 || !workday) this.farmerState = 'walk';
    }
    const p = meadowPlane.project(this.pos.gx, this.pos.depth);
    const height = Math.max(4, Math.round(70 * p.scale));
    const pose = this.farmerState === 'work' ? 'browse' : 'walk';
    const frame = this.farmerState === 'work' ? Math.floor(env.time * 0.8) % 2 : Math.floor(this.stride / 2) % 4;
    const key = `${this.facing}:${pose}:${frame}:${height}`;
    let tex = this.farmerCache.get(key);
    if (!tex) {
      const { grid, palette } = drawPerson(this.farmerLook, this.facing, pose, frame, false, height);
      tex = gridToTexture(grid, palette.colors);
      this.farmerCache.set(key, tex);
    }
    this.farmer.texture = tex;
    this.farmer.visible = true;
    this.farmer.scale.x = this.facing === 'side' ? this.dir : 1;
    this.farmer.position.set(Math.round(p.x), Math.round(p.y));
    // Out on the headland and in the patch he's in front of the maize; up the track, between the fields.
    this.farmer.zIndex = p.y + 0.3;
    this.farmer.tint = lerpColor(env.lighting.ambient, env.lighting.haze, 0.2);
  }
}

/** A lit window: warm light, a darker glazing bar across. */
function paneTexture(w: number, h: number): Texture {
  const p = new PixelBuffer(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) p.set(x, y, y === Math.floor(h / 2) && h > 2 ? 0xd88a3a : 0xffd27a);
  return p.toTexture();
}

/** The scarecrow, `h` px tall: a post and crossbar, an old checked coat, a sacking face under a straw hat; frames 1-2 flap its sleeves. */
function scarecrowArt(h: number, frame: number): PixelBuffer {
  const H = Math.max(9, h);
  const s = H / 40;
  const W = Math.round(34 * s) + 4;
  const p = new PixelBuffer(W, H + 2);
  const cx = Math.round(W / 2);
  const post = 0x6a5034;
  // The post, down into the soil.
  for (let y = Math.round(16 * s); y < H + 1; y++) p.set(cx, y, post);
  // The coat: checked red, buttoned, hanging off the crossbar.
  const coatTop = Math.round(14 * s);
  const coatBottom = Math.round(29 * s);
  const half = Math.max(2, Math.round(5 * s));
  for (let y = coatTop; y < coatBottom; y++) {
    const flare = Math.round(((y - coatTop) / (coatBottom - coatTop)) * 1.5 * s);
    for (let x = cx - half - flare; x <= cx + half + flare; x++) p.set(x, y, (x + y) % 3 === 0 ? 0x6a2a24 : (x * 2 + y) % 5 === 0 ? 0x3a3a5a : 0xa83a2e);
  }
  // Sleeves along the crossbar, their cuffs fluttering, straw poking out.
  const armY = coatTop + 1;
  const reach = Math.round(15 * s);
  for (const side of [-1, 1]) {
    for (let k = half; k <= reach; k++) {
      const droop = frame === 0 ? Math.round((k / reach) * 1.2) : frame === 1 ? (side < 0 ? -1 : 1) * Math.round((k / reach) * 1.6) : -(side < 0 ? -1 : 1) * Math.round((k / reach) * 1.6);
      const thick = Math.max(1, Math.round(2.4 * s));
      for (let t = 0; t < thick; t++) p.set(cx + side * k, armY + droop + t, (k + t) % 3 === 0 ? 0x6a2a24 : 0x983428);
      if (k === reach) for (let t = -1; t <= thick; t++) p.set(cx + side * (k + 1), armY + droop + t, 0xe0c060);
    }
  }
  // Straw at the hem, and the trouser legs tied off on the post.
  for (let x = cx - half - 1; x <= cx + half + 1; x += 2) p.set(x, coatBottom, 0xe0c060);
  // The head: sacking, a stitched grin, under a wide straw hat.
  const hy = Math.round(9 * s);
  const hr = Math.max(2, Math.round(3.6 * s));
  for (let y = -hr; y <= hr; y++) for (let x = -hr; x <= hr; x++) if (x * x + y * y <= hr * hr + 1) p.set(cx + x, hy + y, x < 0 ? 0xd8c094 : 0xc0a678);
  if (H >= 14) {
    p.set(cx - 1, hy - 1, 0x2a2018);
    p.set(cx + 1, hy - 1, 0x2a2018);
    for (let x = -1; x <= 1; x++) p.set(cx + x, hy + 1, 0x5a4030);
  }
  const brim = hr + Math.max(2, Math.round(3 * s));
  for (let x = -brim; x <= brim; x++) p.set(cx + x, hy - hr + 1, 0xd8b050);
  for (let y = hy - hr - Math.max(1, Math.round(2.5 * s)); y <= hy - hr; y++) for (let x = -hr + 1; x <= hr - 1; x++) p.set(cx + x, y, 0xe8c460);
  p.outline(0x2a1e14);
  return p;
}
