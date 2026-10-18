import { Container, Graphics, Sprite, type Texture } from 'pixi.js';
import { WORLD_WIDTH } from '../../config';
import { lerpColor } from '../../core/color';
import { PixelBuffer } from '../../core/pixelBuffer';
import type { Environment } from '../../scene/Environment';
import { bayer } from '../../scene/common/paint';
import { glowTexture } from '../../scene/common/glow';
import { gridToTexture } from '../../sprites/birdSprites';
import { Palette, shadedEllipse } from '../../sprites/kit';
import { PixelGrid } from '../../sprites/raster';
import { adDronesOut, blimpOut } from '../../sim/wildlife';
import { drawText, textWidth } from '../../scene/city/pixelFont';

const r = (a: number, b: number) => a + Math.random() * (b - a);

type CraftKind = 'plane' | 'helicopter' | 'drone' | 'blimp' | 'addrone';

interface Craft {
  kind: CraftKind;
  x: number;
  y: number;
  dir: 1 | -1;
  speed: number;
  t: number;
  /** Day contrail points behind a plane. */
  trail: Array<{ x: number; y: number; age: number }>;
  searchlight: Sprite | null;
}

/** The blimp, drawn once: a silver envelope with fins, a gondola and a dark band for its sign. */
function blimpTexture(): Texture {
  const W = 56;
  const H = 22;
  const g = new PixelGrid(W, H);
  const palette = new Palette();
  const skin = palette.ramp(0xd8dce0, 0.8);
  const fin = palette.ramp(0x3a6ab0);
  const gondola = palette.ramp(0x4a4e56);
  // Tail fins.
  g.polygon([[2, 3], [12, 8], [12, 13], [2, 18]], fin[2]);
  shadedEllipse(g, 29, 10.5, 24, 8.5, skin, { dither: false, min: 1 });
  g.rect(25, 19, 10, 2, gondola[2]);
  g.rect(26, 19, 1, 1, gondola[4]);
  g.rect(30, 19, 1, 1, gondola[4]);
  // A dark band where the sign runs, inked top and bottom.
  const band = palette.add(0x0c0e14);
  const ink = palette.add(0x1e2430);
  for (let x = BAND_X0; x < BAND_X0 + BAND_W; x++) {
    for (let y = BAND_Y0 - 1; y <= BAND_Y0 + 5; y++) if (g.get(x, y)) g.set(x, y, y === BAND_Y0 - 1 || y === BAND_Y0 + 5 ? ink : band);
  }
  return gridToTexture(g, palette.colors);
}

/** Where the blimp's sign runs on its texture. */
const BAND_X0 = 15;
const BAND_W = 32;
const BAND_Y0 = 8;
const BLIMP_MESSAGE = 'NEUROCOLA · TASTE THE SIGNAL · ASK KAI · ALWAYS LISTENING · DREAMDIVE 12¥/HR · ';

/** The message as columns of lit pixels (bit k = row k), for scrolling. */
function messageColumns(text: string): number[] {
  const buf = new PixelBuffer(textWidth(text, 'small') + 1, 5);
  drawText(buf, text, 0, 0, 0xffffff, 'small');
  const cols: number[] = [];
  for (let x = 0; x < buf.width; x++) {
    let bits = 0;
    for (let y = 0; y < 5; y++) if (buf.isSet(x, y)) bits |= 1 << y;
    cols.push(bits);
  }
  return cols;
}

/** A searchlight's beam: a long dithered wedge, brightest at the lamp. */
function beamTexture(): Texture {
  const W = 31;
  const H = 110;
  const p = new PixelBuffer(W, H);
  for (let y = 0; y < H; y++) {
    const t = y / H;
    const half = 1 + t * (W / 2 - 1);
    for (let x = 0; x < W; x++) {
      const u = Math.abs(x + 0.5 - W / 2) / half;
      if (u >= 1) continue;
      const level = (1 - t * 0.8) * (1 - u * u) * 2.6;
      let step = Math.floor(level);
      if (level - step > bayer(x, y)) step++;
      if (step > 0) p.set(x, y, lerpColor(0, 0xe8f0ff, Math.min(1, step * 0.16)));
    }
  }
  return p.toTexture();
}

/**
 * Traffic in the sky over the city: planes crossing high (a contrail behind
 * them by day, blinking navigation lights by night), a helicopter now and
 * then (sweeping a searchlight over the streets after dark), a little
 * delivery drone darting across the canyon, and on fair days the
 * advertising blimp drifting by with its sign running.
 */
export class SkyTraffic {
  /** Far behind the buildings. */
  readonly container = new Container({ label: 'sky-traffic' });
  /** Closer in: the drone crosses the street canyon. */
  readonly nearContainer = new Container({ label: 'drones' });
  private readonly gfx = new Graphics();
  private readonly lights = new Graphics();
  private readonly nearGfx = new Graphics();
  private readonly nearLights = new Graphics();
  private readonly crafts: Craft[] = [];
  private readonly blimpSprite: Sprite;
  private readonly message = messageColumns(BLIMP_MESSAGE);
  private beam: Texture | null = null;
  private timers: Record<CraftKind, number> = { plane: r(10, 60), helicopter: r(120, 300), drone: r(60, 180), blimp: r(30, 120), addrone: r(10, 60) };
  private blimpToday = false;

  constructor() {
    this.blimpSprite = new Sprite({ texture: blimpTexture(), anchor: 0.5 });
    this.blimpSprite.visible = false;
    this.lights.blendMode = 'add';
    this.container.addChild(this.gfx, this.blimpSprite, this.lights);
    this.nearLights.blendMode = 'add';
    this.nearContainer.addChild(this.nearGfx, this.nearLights);
  }

  get counts(): Record<CraftKind, number> {
    const out: Record<CraftKind, number> = { plane: 0, helicopter: 0, drone: 0, blimp: 0, addrone: 0 };
    for (const c of this.crafts) out[c.kind]++;
    return out;
  }

  summon(kind: CraftKind): void {
    this.launch(kind);
  }

  update(dt: number, env: Environment): void {
    const h = env.lighting.hours;
    const clear = env.weather.cloudCover < 0.6 && env.weather.precipitation < 0.1;
    for (const kind of ['plane', 'helicopter', 'drone'] as const) {
      this.timers[kind] -= dt;
      if (this.timers[kind] <= 0) {
        this.timers[kind] = kind === 'plane' ? r(60, 180) : kind === 'helicopter' ? r(180, 480) : r(90, 240);
        const ok = kind !== 'drone' || (h >= 8 && h < 22);
        if (ok && !this.crafts.some((c) => c.kind === kind)) this.launch(kind);
      }
    }
    // Ad drones work the evening, a couple at a time, each with a little screen slung under it.
    this.timers.addrone -= dt;
    if (this.timers.addrone <= 0) {
      this.timers.addrone = r(40, 110);
      if (adDronesOut(h) && this.crafts.filter((c) => c.kind === 'addrone').length < 2) this.launch('addrone');
    }
    // The blimp goes up once on a fair day.
    if (blimpOut(h, clear)) {
      this.timers.blimp -= dt;
      if (!this.blimpToday && this.timers.blimp <= 0) {
        this.blimpToday = true;
        this.launch('blimp');
      }
    } else if (h < 9) this.blimpToday = false;

    this.gfx.clear();
    this.lights.clear();
    this.nearGfx.clear();
    this.nearLights.clear();
    const night = env.lighting.emissive;
    for (let i = this.crafts.length - 1; i >= 0; i--) {
      const c = this.crafts[i];
      c.t += dt;
      c.x += c.dir * c.speed * dt;
      if (c.kind === 'drone') c.y += Math.sin(c.t * 2.3) * 6 * dt;
      if (c.kind === 'addrone') c.y += Math.sin(c.t * 0.9) * 3 * dt;
      if (c.x < -60 || c.x > WORLD_WIDTH + 60) {
        c.searchlight?.destroy();
        if (c.kind === 'blimp') this.blimpSprite.visible = false;
        this.crafts.splice(i, 1);
        continue;
      }
      this.draw(c, dt, env, night);
    }
  }

  private launch(kind: CraftKind): void {
    const dir: 1 | -1 = Math.random() < 0.5 ? 1 : -1;
    const x = dir > 0 ? -50 : WORLD_WIDTH + 50;
    const y = kind === 'plane' ? r(18, 60) : kind === 'helicopter' ? r(70, 115) : kind === 'drone' ? r(175, 205) : kind === 'addrone' ? r(120, 165) : r(40, 75);
    const speed = kind === 'plane' ? r(14, 22) : kind === 'helicopter' ? r(16, 24) : kind === 'drone' ? r(30, 45) : kind === 'addrone' ? r(6, 10) : r(3.5, 5);
    let searchlight: Sprite | null = null;
    if (kind === 'helicopter') {
      this.beam ??= beamTexture();
      searchlight = new Sprite({ texture: this.beam, anchor: { x: 0.5, y: 0 }, blendMode: 'add' });
      searchlight.visible = false;
      this.container.addChild(searchlight);
    }
    this.crafts.push({ kind, x, y, dir, speed, t: 0, trail: [], searchlight });
  }

  private draw(c: Craft, dt: number, env: Environment, night: number): void {
    const x = Math.round(c.x);
    const y = Math.round(c.y);
    const g = this.gfx;
    const tint = env.lighting.ambient;
    const shade = lerpColor(0x9aa0aa, tint, 0.5);
    const dark = lerpColor(0x3a3e46, tint, 0.4);
    const blink = Math.floor(env.time * 1.4 + c.x * 0.01) % 2 === 0;
    switch (c.kind) {
      case 'plane': {
        // A contrail by day, spreading and fading behind it.
        if (env.lighting.darkness < 0.6) {
          c.trail.push({ x: c.x - c.dir * 5, y: c.y, age: 0 });
          for (const p of c.trail) p.age += dt;
          while (c.trail.length && c.trail[0].age > 25) c.trail.shift();
          for (let k = 0; k < c.trail.length; k += 2) {
            const p = c.trail[k];
            const a = 0.55 * (1 - p.age / 25) * (1 - env.lighting.darkness);
            const w = 1 + Math.floor(p.age / 9);
            g.rect(Math.round(p.x), Math.round(p.y - (w - 1) / 2), 2, w).fill({ color: 0xffffff, alpha: a });
          }
        }
        // Fuselage, wings and tail, tiny with height.
        g.rect(x - 3, y, 7, 1).fill(shade);
        g.rect(x - c.dir, y - 1, 1, 1).fill(dark).rect(x, y + 1, 1, 1).fill(dark);
        g.rect(x - c.dir * 3, y - 1, 1, 1).fill(dark);
        if (night > 0.1) {
          this.lights.rect(x - 1, y - 1, 1, 1).fill({ color: 0xff3a2a, alpha: night });
          this.lights.rect(x + 1, y + 1, 1, 1).fill({ color: 0x3aff6a, alpha: night });
          if (Math.floor(env.time * 1.1) % 2 === 0 && env.time % 1 < 0.12) this.lights.rect(x - c.dir * 3, y, 1, 1).fill({ color: 0xffffff, alpha: night });
        }
        break;
      }
      case 'helicopter': {
        // Body, tail boom, skids and the rotor's flicker.
        g.rect(x - 2, y, 5, 3).fill(dark).rect(x - 1, y, 3, 1).fill(shade);
        g.rect(x - c.dir * 7, y + 1, 5, 1).fill(dark);
        g.rect(x - c.dir * 7, y - 1, 1, 2).fill(dark);
        g.rect(x - 2, y + 4, 6, 1).fill(dark);
        const rotor = Math.floor(env.time * 18) % 2 === 0;
        g.rect(x - (rotor ? 5 : 3), y - 1, rotor ? 11 : 7, 1).fill({ color: dark, alpha: 0.7 });
        if (night > 0.1 && blink) this.lights.rect(x, y - 1, 1, 1).fill({ color: 0xff3a2a, alpha: night });
        if (c.searchlight) {
          // After dark it sweeps a searchlight over the streets.
          c.searchlight.visible = night > 0.3;
          c.searchlight.position.set(x, y + 3);
          c.searchlight.rotation = Math.sin(c.t * 0.6) * 0.45 - c.dir * 0.15;
          c.searchlight.alpha = Math.min(0.9, night);
        }
        break;
      }
      case 'drone': {
        // A little quadcopter darting across the canyon, its light winking.
        const n = this.nearGfx;
        n.rect(x - 2, y, 5, 1).fill(dark).rect(x - 1, y + 1, 3, 1).fill(dark);
        const props = Math.floor(env.time * 20) % 2 === 0;
        n.rect(x - 3, y - 1, 2, 1).fill({ color: shade, alpha: props ? 0.8 : 0.3 }).rect(x + 2, y - 1, 2, 1).fill({ color: shade, alpha: props ? 0.3 : 0.8 });
        if (blink) n.rect(x, y + 2, 1, 1).fill({ color: night > 0.1 ? 0x3aff6a : 0x2a8a3a, alpha: 0.6 + 0.4 * night });
        break;
      }
      case 'addrone': {
        // A drone dragging a screen through the evening: rotors flickering, the screen cycling its ads.
        const n = this.nearGfx;
        n.rect(x - 4, y, 9, 1).fill(dark).rect(x - 2, y + 1, 5, 1).fill(dark);
        const props = Math.floor(env.time * 24) % 2 === 0;
        n.rect(x - 6, y - 1, 3, 1).fill({ color: shade, alpha: props ? 0.8 : 0.3 }).rect(x + 4, y - 1, 3, 1).fill({ color: shade, alpha: props ? 0.3 : 0.8 });
        // Tethers down to the screen.
        n.rect(x - 4, y + 2, 1, 3).fill(dark).rect(x + 4, y + 2, 1, 3).fill(dark);
        const sx = x - 7;
        const sy = y + 5;
        n.rect(sx, sy, 15, 10).fill(0x101418);
        const ad = Math.floor((env.time + c.speed * 10) / 2.5) % 3;
        const lit = 0.55 + 0.45 * night;
        const bright = (color: number) => ({ color: lerpColor(lerpColor(color, tint, 0.4), color, night), alpha: lit });
        if (ad === 0) {
          // A heart, beating: SOULSYNC.
          n.rect(sx + 1, sy + 1, 13, 8).fill(bright(0x5a1450));
          const beat = Math.floor(env.time * 3) % 2;
          n.rect(sx + 4 - beat, sy + 3, 3 + beat, 2).fill(bright(0xff3a7a)).rect(sx + 8, sy + 3, 3 + beat, 2).fill(bright(0xff3a7a)).rect(sx + 5, sy + 5, 5, 1).fill(bright(0xff3a7a)).rect(sx + 6, sy + 6, 3, 1).fill(bright(0xff3a7a));
        } else if (ad === 1) {
          // Kai's eyes, blinking.
          n.rect(sx + 1, sy + 1, 13, 8).fill(bright(0x163e66));
          const blink = Math.floor(env.time * 1.3) % 4 === 0;
          n.rect(sx + 4, sy + (blink ? 4 : 3), 2, blink ? 1 : 3).fill(bright(0xd8ffff)).rect(sx + 9, sy + (blink ? 4 : 3), 2, blink ? 1 : 3).fill(bright(0xd8ffff));
        } else {
          // A can of NEUROCOLA, and its price.
          n.rect(sx + 1, sy + 1, 13, 8).fill(bright(0x5a0a2a));
          n.rect(sx + 3, sy + 2, 3, 6).fill(bright(0xd01c3a)).rect(sx + 3, sy + 2, 3, 1).fill(bright(0xc8cad4));
          n.rect(sx + 8, sy + 3, 4, 1).fill(bright(0xffffff)).rect(sx + 8, sy + 5, 3, 1).fill(bright(0xffd020));
        }
        if (night > 0.2) this.nearLights.texture(glowTexture(6, [0xff3a7a, 0x3ae8ff, 0xff3a5a][ad], 0.7, false), 0xffffff, sx - 2, sy - 2, 19, 14);
        if (blink) n.rect(x, y + 1, 1, 1).fill({ color: 0xff3a3a, alpha: 0.6 + 0.4 * night });
        break;
      }
      case 'blimp': {
        this.blimpSprite.visible = true;
        this.blimpSprite.position.set(x, y);
        this.blimpSprite.scale.x = c.dir;
        this.blimpSprite.tint = lerpColor(tint, 0xffffff, 0.2);
        // Its sign: a message scrolling along the band, readable whichever way it flies.
        const offset = Math.floor(env.time * 9);
        const x0 = Math.round(x) - 28 + (c.dir > 0 ? BAND_X0 : 56 - BAND_X0 - BAND_W);
        const y0 = Math.round(y) - 11 + BAND_Y0;
        const cols = this.message;
        for (let k = 0; k < BAND_W; k++) {
          const bits = cols[(k + offset) % cols.length];
          if (!bits) continue;
          const color = [0xffe060, 0xff6a8a, 0x6ad8ff][Math.floor((k + offset) / 40) % 3];
          for (let r = 0; r < 5; r++) if (bits & (1 << r)) this.lights.rect(x0 + k, y0 + r, 1, 1).fill({ color, alpha: 0.55 + 0.45 * night });
        }
        break;
      }
    }
    // A soft glow round the lights after dark, so they read against the sky.
    if (night > 0.3 && c.kind !== 'blimp' && c.kind !== 'drone' && c.kind !== 'addrone' && blink) {
      this.lights.texture(glowTexture(2, 0xff5040), 0xffffff, x - 2, y - 3, 5, 5);
    }
  }
}
