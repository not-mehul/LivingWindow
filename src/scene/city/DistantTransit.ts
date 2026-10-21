import { Container, Sprite, Texture } from 'pixi.js';
import { cityBusyness } from '../../audio/soundscapes/schedules';
import { lerpColor } from '../../core/color';
import { PixelBuffer } from '../../core/pixelBuffer';
import { createRng, randomInt, randomRange } from '../../core/random';
import { WORLD_WIDTH } from '../../config';
import type { Environment } from '../Environment';
import { DayNightSprite, type NightGrade } from '../common/night';

/**
 * Far off across the city, between the skyline's towers: an elevated super
 * highway on tall pillars, its two carriageways streaming with fast traffic
 * (headlights one way, tail-lights the other, after dark, under a string of
 * sodium lamps), and just below it a steel rail viaduct that a long freight
 * train rolls along now and then. Too far off to hear; it sits in front of
 * the far skyline and behind everything nearer, hazed like the distance.
 *
 * Coordinates are world px. The near towers hide the left end, so traffic
 * comes and goes behind them.
 */

/** Where the deck runs: from behind the left-hand towers to past the right edge. */
export const TRANSIT_X0 = 340;
export const TRANSIT_X1 = WORLD_WIDTH + 12;
/** Rows: the deck's top edge (the road the cars stand on), and the rail the wagons' wheels run on. */
export const DECK_Y = 107;
export const RAIL_Y = 121;
const ART_Y0 = 98;
const ART_Y1 = 168;

/** Highway speeds (world px/s): fast, as seen from far away. */
const CAR_SPEED: readonly [number, number] = [58, 92];
const TRUCK_SPEED: readonly [number, number] = [46, 62];
/** Least gap between one vehicle's tail and the next one's nose (px). */
const MIN_GAP = 3;
const TRAIN_SPEED: readonly [number, number] = [26, 36];
/** Seconds between freight trains: now and then, not all the time. */
const TRAIN_EVERY: readonly [number, number] = [100, 300];
const FIRST_TRAIN: readonly [number, number] = [15, 60];

const CONCRETE = { light: 0xc6c2b8, base: 0xa29e96, shade: 0x7e7b76, dark: 0x5e5c5a };
const STEEL = { light: 0x8a7a6a, base: 0x6a5a4e, dark: 0x463c36 };
const SODIUM = 0xffb860;
const HEADLIGHT = 0xfff2c8;
const TAILLIGHT = 0xff3a2a;

/** The far band's grades (see CityScene), so the highway goes violet into the night with the skyline. */
const NIGHT: NightGrade = { desaturate: 0.5, tint: [0.24, 0.24, 0.42], lift: [18, 10, 34] };
const DUSK: NightGrade = { desaturate: 0.55, tint: [0.5, 0.44, 0.64], lift: [12, 8, 24] };

export type VehicleKind = 'car' | 'van' | 'truck';

export interface Vehicle {
  kind: VehicleKind;
  /** Front of the vehicle, in world px along the deck. */
  x: number;
  speed: number;
  color: number;
  length: number;
}

const LENGTH: Record<VehicleKind, number> = { car: 5, van: 6, truck: 10 };
const BODY_COLORS = [0xdedcd4, 0xa8acb4, 0x34383e, 0x9a3a36, 0x3c5a88, 0xd0a83c, 0x5a6e50, 0xe0e0e0, 0x6a6e78];

/**
 * One carriageway: vehicles enter at one end, keep their distance from the
 * one ahead and leave at the other. `dir` is +1 (left to right) or -1.
 */
export class Carriageway {
  readonly vehicles: Vehicle[] = [];
  private spawnIn: number;

  constructor(
    readonly dir: 1 | -1,
    private readonly rng: () => number,
    readonly from = TRANSIT_X0,
    readonly to = TRANSIT_X1,
  ) {
    this.spawnIn = randomRange(rng, 0, 1);
    // Start with traffic already flowing rather than an empty road.
    for (let x = this.entry + this.dir * 20; this.dir > 0 ? x < to : x > from; x += this.dir * randomRange(rng, 18, 60)) {
      const v = this.make();
      v.x = x;
      this.vehicles.push(v);
    }
    this.vehicles.sort((a, b) => (b.x - a.x) * this.dir);
  }

  private get entry(): number {
    return this.dir > 0 ? this.from : this.to;
  }

  private make(): Vehicle {
    const roll = this.rng();
    const kind: VehicleKind = roll < 0.14 ? 'truck' : roll < 0.3 ? 'van' : 'car';
    const [s0, s1] = kind === 'truck' ? TRUCK_SPEED : CAR_SPEED;
    return { kind, x: this.entry, speed: randomRange(this.rng, s0, s1), color: BODY_COLORS[randomInt(this.rng, 0, BODY_COLORS.length - 1)], length: LENGTH[kind] };
  }

  /** `busy` 0..1: how much traffic there is (rush hour full, the small hours a trickle). */
  update(dt: number, busy: number): void {
    // Vehicles are kept front first: each follows the one ahead.
    for (let i = 0; i < this.vehicles.length; i++) {
      const v = this.vehicles[i];
      let step = v.speed * dt;
      const ahead = this.vehicles[i - 1];
      if (ahead) {
        const gap = (ahead.x - v.x) * this.dir - ahead.length - MIN_GAP;
        step = Math.max(0, Math.min(step, gap));
      }
      v.x += step * this.dir;
    }
    while (this.vehicles.length > 0) {
      const lead = this.vehicles[0];
      const gone = this.dir > 0 ? lead.x - lead.length > this.to : lead.x + lead.length < this.from;
      if (!gone) break;
      this.vehicles.shift();
    }
    this.spawnIn -= dt;
    if (this.spawnIn <= 0) {
      const last = this.vehicles[this.vehicles.length - 1];
      const room = !last || (last.x - this.entry) * this.dir - last.length > MIN_GAP + 2;
      if (room) this.vehicles.push(this.make());
      // Gaps of a fraction of a second at rush hour, several seconds at night.
      this.spawnIn = randomRange(this.rng, 0.25, 0.9) / Math.max(0.06, busy);
    }
  }
}

export type WagonKind = 'container' | 'tank' | 'hopper' | 'flat';

export interface Train {
  dir: 1 | -1;
  /** Front of the locomotive, world px. */
  x: number;
  speed: number;
  wagons: Array<{ kind: WagonKind; color: number }>;
}

const WAGON_LENGTH = 9;
const LOCO_LENGTH = 12;
const CONTAINER_COLORS = [0xa0442e, 0x2e5a8a, 0x3e6e4a, 0xc07a2a, 0x8a8a8a, 0xd8d0c0, 0x6a3a5a, 0xb0a040];

export function trainLength(train: Pick<Train, 'wagons'>): number {
  return LOCO_LENGTH + train.wagons.length * WAGON_LENGTH;
}

/** Freight now and then: a locomotive and a long, mixed rake of wagons. */
export class FreightLine {
  train: Train | null = null;
  private waitFor: number;

  constructor(
    private readonly rng: () => number,
    readonly from = TRANSIT_X0,
    readonly to = TRANSIT_X1,
  ) {
    this.waitFor = randomRange(rng, FIRST_TRAIN[0], FIRST_TRAIN[1]);
  }

  update(dt: number): void {
    if (this.train) {
      const t = this.train;
      t.x += t.speed * dt * t.dir;
      const tail = t.x - trainLength(t) * t.dir;
      if (t.dir > 0 ? tail > this.to : tail < this.from) {
        this.train = null;
        this.waitFor = randomRange(this.rng, TRAIN_EVERY[0], TRAIN_EVERY[1]);
      }
      return;
    }
    this.waitFor -= dt;
    if (this.waitFor <= 0) this.dispatch();
  }

  /** Send a train through now. */
  dispatch(): Train {
    const dir: 1 | -1 = this.rng() < 0.5 ? 1 : -1;
    const count = randomInt(this.rng, 16, 30);
    // Wagons come in runs of a kind, as freight is marshalled.
    const wagons: Train['wagons'] = [];
    while (wagons.length < count) {
      const roll = this.rng();
      const kind: WagonKind = roll < 0.55 ? 'container' : roll < 0.75 ? 'tank' : roll < 0.92 ? 'hopper' : 'flat';
      const run = randomInt(this.rng, 2, 6);
      for (let i = 0; i < run && wagons.length < count; i++) {
        const color = kind === 'container' ? CONTAINER_COLORS[randomInt(this.rng, 0, CONTAINER_COLORS.length - 1)] : kind === 'tank' ? 0x2e2e32 : kind === 'hopper' ? 0x6a5a46 : 0x5a564e;
        wagons.push({ kind, color });
      }
    }
    this.train = { dir, x: dir > 0 ? this.from : this.to, speed: randomRange(this.rng, TRAIN_SPEED[0], TRAIN_SPEED[1]), wagons };
    return this.train;
  }
}

// ---------------------------------------------------------------- Drawing

/** The deck, its lamps and pillars, and the rail viaduct below, in world px from (TRANSIT_X0, ART_Y0). */
export function drawTransitArt(): { art: PixelBuffer; lamps: PixelBuffer } {
  const w = TRANSIT_X1 - TRANSIT_X0;
  const art = new PixelBuffer(w, ART_Y1 - ART_Y0);
  const lamps = new PixelBuffer(w, ART_Y1 - ART_Y0);
  const y = (worldY: number) => worldY - ART_Y0;
  // Pillars under the highway: tall, pale, each shaded on its right.
  for (let x = 14; x < w; x += 38) {
    for (let yy = DECK_Y + 4; yy < ART_Y1; yy++) {
      art.set(x, y(yy), CONCRETE.light);
      art.set(x + 1, y(yy), CONCRETE.base);
      art.set(x + 2, y(yy), CONCRETE.shade);
    }
  }
  // The deck: a lit edge the cars run on, the side face, a shadowed lip.
  for (let x = 0; x < w; x++) {
    art.set(x, y(DECK_Y), CONCRETE.light);
    art.set(x, y(DECK_Y + 1), CONCRETE.base);
    art.set(x, y(DECK_Y + 2), x % 19 === 0 ? CONCRETE.dark : CONCRETE.base);
    art.set(x, y(DECK_Y + 3), CONCRETE.dark);
  }
  // At night the lamps light the road and its edge: a warm band, brightest under each lamp.
  for (let x = 0; x < w; x++) {
    const near = Math.abs(((x - 7 + 16) % 16) - 8);
    lamps.set(x, y(DECK_Y), SODIUM, 40 + Math.max(0, 5 - near) * 12);
    lamps.set(x, y(DECK_Y + 1), SODIUM, 18);
  }
  // Lamp posts along the deck, each leaning over the road with a sodium lamp.
  for (let x = 6; x < w; x += 16) {
    for (let yy = DECK_Y - 5; yy < DECK_Y; yy++) art.set(x, y(yy), CONCRETE.dark);
    art.set(x + 1, y(DECK_Y - 5), CONCRETE.dark);
    lamps.set(x + 1, y(DECK_Y - 5), SODIUM);
    lamps.set(x + 1, y(DECK_Y - 4), SODIUM, 70);
    lamps.set(x, y(DECK_Y - 6), SODIUM, 50);
    lamps.set(x + 2, y(DECK_Y - 5), SODIUM, 50);
  }
  // The rail viaduct: a steel girder under the track, braced in a zig-zag, on slimmer piers.
  for (let x = 0; x < w; x++) {
    art.set(x, y(RAIL_Y), STEEL.dark);
    art.set(x, y(RAIL_Y + 1), STEEL.light);
    art.set(x, y(RAIL_Y + 2), (x + (x % 6 < 3 ? 0 : 1)) % 6 === 0 || x % 6 === 3 ? STEEL.light : STEEL.base);
    art.set(x, y(RAIL_Y + 3), STEEL.dark);
  }
  for (let x = 30; x < w; x += 52) {
    for (let yy = RAIL_Y + 4; yy < ART_Y1; yy++) {
      art.set(x, y(yy), STEEL.base);
      art.set(x + 1, y(yy), STEEL.dark);
    }
  }
  return { art, lamps };
}

/** A vehicle seen side on, facing right: body and (separately) its lights. */
export function drawVehicle(kind: VehicleKind, color: number): { body: PixelBuffer; lights: PixelBuffer } {
  const len = LENGTH[kind];
  const h = kind === 'truck' ? 3 : 2;
  const body = new PixelBuffer(len, h);
  const lights = new PixelBuffer(len + 3, h);
  const glass = lerpColor(color, 0x202838, 0.6);
  if (kind === 'truck') {
    // A box trailer and a cab.
    for (let x = 0; x < 7; x++) for (let yy = 0; yy < 3; yy++) body.set(x, yy, yy === 2 ? lerpColor(color, 0x000000, 0.3) : color);
    body.set(8, 1, 0x8a8e94);
    body.set(9, 1, glass);
    body.set(8, 2, 0x8a8e94);
    body.set(9, 2, 0x8a8e94);
    body.set(7, 2, 0x303030);
  } else {
    // A cabin over a longer body; a van's cabin runs further back.
    const cabin = kind === 'van' ? [0, len - 2] : [1, len - 2];
    for (let x = cabin[0]; x <= cabin[1]; x++) body.set(x, 0, x === cabin[1] ? glass : color);
    for (let x = 0; x < len; x++) body.set(x, 1, color);
  }
  const bottom = h - 1;
  lights.set(len - 1, bottom, HEADLIGHT);
  lights.set(len, bottom, HEADLIGHT, 110);
  lights.set(len + 1, bottom, HEADLIGHT, 50);
  lights.set(0, bottom, TAILLIGHT);
  return { body, lights };
}

/** A locomotive facing right, and a wagon of each kind. */
export function drawLoco(): { body: PixelBuffer; lights: PixelBuffer } {
  const body = new PixelBuffer(LOCO_LENGTH, 4);
  const lights = new PixelBuffer(LOCO_LENGTH + 3, 4);
  const paint = 0xd0a030;
  for (let x = 0; x < LOCO_LENGTH - 1; x++) {
    body.set(x, 0, x > 0 && x < LOCO_LENGTH - 2 ? lerpColor(paint, 0xffffff, 0.2) : paint);
    body.set(x, 1, paint);
    body.set(x, 2, x % 4 === 1 ? 0x3a3a3a : 0x8a2a22);
  }
  body.set(LOCO_LENGTH - 2, 1, 0x283040);
  for (const x of [1, 3, 7, 9]) body.set(x, 3, 0x202020);
  lights.set(LOCO_LENGTH - 1, 2, HEADLIGHT);
  lights.set(LOCO_LENGTH, 2, HEADLIGHT, 120);
  lights.set(LOCO_LENGTH + 1, 2, HEADLIGHT, 60);
  return { body, lights };
}

export function drawWagon(kind: WagonKind, color: number): PixelBuffer {
  const p = new PixelBuffer(WAGON_LENGTH, 4);
  const dark = lerpColor(color, 0x000000, 0.35);
  const light = lerpColor(color, 0xffffff, 0.2);
  // The underframe and its two bogies.
  for (let x = 0; x < WAGON_LENGTH - 1; x++) p.set(x, 2, 0x3a3634);
  for (const x of [1, 6]) p.set(x, 3, 0x1e1e1e);
  if (kind === 'container') {
    for (let x = 0; x < WAGON_LENGTH - 1; x++) {
      p.set(x, 0, x % 2 === 0 ? light : color);
      p.set(x, 1, x % 2 === 0 ? color : dark);
    }
  } else if (kind === 'tank') {
    for (let x = 1; x < WAGON_LENGTH - 2; x++) p.set(x, 0, light);
    for (let x = 0; x < WAGON_LENGTH - 1; x++) p.set(x, 1, color);
  } else if (kind === 'hopper') {
    for (let x = 0; x < WAGON_LENGTH - 1; x++) p.set(x, 0, x === 0 || x === WAGON_LENGTH - 2 ? dark : light);
    for (let x = 1; x < WAGON_LENGTH - 2; x++) p.set(x, 1, color);
  } else {
    // A flat wagon: a low load under a tarp.
    for (let x = 2; x < WAGON_LENGTH - 3; x++) p.set(x, 1, 0x4a5a4a);
  }
  return p;
}

// ---------------------------------------------------------------- The scene piece

interface VehicleSprites {
  body: Sprite;
  lights: Sprite;
}

export class DistantTransit {
  readonly container = new Container({ label: 'distant-transit' });
  private readonly art: DayNightSprite;
  private readonly lampGlow: Sprite;
  private readonly vehicleLayer = new Container({ label: 'highway-traffic' });
  private readonly trainLayer = new Container({ label: 'freight' });
  private readonly glowLayer = new Container({ label: 'transit-lights' });
  private readonly lanes: Carriageway[];
  readonly freight: FreightLine;
  private readonly textures = new Map<string, { body: Texture; lights: Texture }>();
  private readonly pool: VehicleSprites[] = [];
  private trainSprites: { body: Sprite[]; lights: Sprite[]; train: Train } | null = null;
  private vehicleTint = 0xffffff;
  private trainTint = 0xffffff;

  constructor(seed = 4242) {
    const rng = createRng(seed);
    const { art, lamps } = drawTransitArt();
    this.art = new DayNightSprite(art, NIGHT, DUSK);
    this.art.container.position.set(TRANSIT_X0, ART_Y0);
    this.lampGlow = new Sprite({ texture: lamps.toTexture(), blendMode: 'add' });
    this.lampGlow.position.set(TRANSIT_X0, ART_Y0);
    // Left to right on the nearer carriageway, right to left a pixel higher on the far one.
    this.lanes = [new Carriageway(-1, rng), new Carriageway(1, rng)];
    this.freight = new FreightLine(rng);
    this.container.addChild(this.art.container, this.trainLayer, this.vehicleLayer, this.glowLayer);
    this.glowLayer.addChild(this.lampGlow);
  }

  private texturesFor(kind: VehicleKind, color: number): { body: Texture; lights: Texture } {
    const key = `${kind}:${color}`;
    let t = this.textures.get(key);
    if (!t) {
      const drawn = drawVehicle(kind, color);
      t = { body: drawn.body.toTexture(), lights: drawn.lights.toTexture() };
      this.textures.set(key, t);
    }
    return t;
  }

  /** `farTint` is the far skyline's day tint, so the traffic sits in the same haze. */
  update(dt: number, env: Environment, farTint: number): void {
    const { lighting } = env;
    this.art.update(farTint, lighting);
    const night = lighting.nightness;
    const glow = Math.max(0, lighting.emissive - 0.15) / 0.85;
    this.lampGlow.alpha = glow;
    this.lampGlow.visible = glow > 0.01;
    // Vehicles fade into the dusk with the deck; after dark they're dim shapes in the city's glow, and their lights.
    const dusk = lerpColor(farTint, 0x9a8ab4, lighting.twilight * 0.5);
    this.vehicleTint = lerpColor(dusk, 0x5a5c7e, night * 0.8);
    this.trainTint = lerpColor(dusk, 0x8a86a8, night * 0.8);

    const busy = cityBusyness(lighting.hours);
    for (const lane of this.lanes) lane.update(dt, busy);
    this.freight.update(dt);
    this.drawTraffic(glow);
    this.drawTrain(glow);
  }

  private drawTraffic(glow: number): void {
    let used = 0;
    for (const [i, lane] of this.lanes.entries()) {
      // The far carriageway (right to left) runs a pixel higher.
      const baseY = DECK_Y - (i === 0 ? 1 : 0);
      for (const v of lane.vehicles) {
        let sprites = this.pool[used];
        if (!sprites) {
          sprites = { body: new Sprite(), lights: new Sprite({ blendMode: 'add' }) };
          this.pool.push(sprites);
          this.vehicleLayer.addChild(sprites.body);
          this.glowLayer.addChild(sprites.lights);
        }
        used++;
        const t = this.texturesFor(v.kind, v.color);
        const h = v.kind === 'truck' ? 3 : 2;
        const y = baseY - h;
        const x = Math.round(v.x);
        // Textures face right; a right-to-left vehicle is mirrored about its front.
        for (const s of [sprites.body, sprites.lights]) {
          s.visible = true;
          s.scale.x = lane.dir;
          s.y = y;
        }
        sprites.body.texture = t.body;
        sprites.lights.texture = t.lights;
        sprites.body.x = lane.dir > 0 ? x - v.length : x + v.length;
        sprites.lights.x = sprites.body.x;
        sprites.body.tint = this.vehicleTint;
        sprites.lights.alpha = glow;
        sprites.lights.visible = glow > 0.01;
      }
    }
    for (let i = used; i < this.pool.length; i++) {
      this.pool[i].body.visible = false;
      this.pool[i].lights.visible = false;
    }
  }

  private drawTrain(glow: number): void {
    const train = this.freight.train;
    if (this.trainSprites && this.trainSprites.train !== train) {
      for (const s of [...this.trainSprites.body, ...this.trainSprites.lights]) s.destroy({ texture: true, textureSource: true });
      this.trainSprites = null;
    }
    if (!train) return;
    if (!this.trainSprites) {
      const loco = drawLoco();
      const body = [new Sprite(loco.body.toTexture()), ...train.wagons.map((w) => new Sprite(drawWagon(w.kind, w.color).toTexture()))];
      // A red lamp on the last wagon.
      const tailLamp = new PixelBuffer(1, 1);
      tailLamp.set(0, 0, TAILLIGHT);
      const lights = [new Sprite({ texture: loco.lights.toTexture(), blendMode: 'add' }), new Sprite({ texture: tailLamp.toTexture(), blendMode: 'add' })];
      for (const s of body) this.trainLayer.addChild(s);
      for (const s of lights) this.glowLayer.addChild(s);
      this.trainSprites = { body, lights, train };
    }
    const { body, lights } = this.trainSprites;
    const front = Math.round(train.x);
    const d = train.dir;
    // Each piece faces right in its texture; mirrored ones are placed from their right edge.
    const place = (s: Sprite, nose: number, length: number, top: number) => {
      s.scale.x = d;
      s.x = d > 0 ? nose - length : nose + length;
      s.y = top;
    };
    place(body[0], front, LOCO_LENGTH, RAIL_Y - 4);
    place(lights[0], front, LOCO_LENGTH, RAIL_Y - 4);
    for (let i = 1; i < body.length; i++) place(body[i], front - d * (LOCO_LENGTH + (i - 1) * WAGON_LENGTH), WAGON_LENGTH, RAIL_Y - 4);
    const tail = front - d * trainLength(train);
    lights[1].position.set(d > 0 ? tail : tail - 1, RAIL_Y - 3);
    for (const s of body) s.tint = this.trainTint;
    for (const s of lights) {
      s.alpha = glow;
      s.visible = glow > 0.01;
    }
  }
}
