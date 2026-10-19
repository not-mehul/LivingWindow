import { Container, Sprite, type Texture } from 'pixi.js';
import { gridToTexture } from '../../sprites/cache';
import { drawPerson, randomLook, type PersonLook } from '../../sprites/people';
import {
  drawPushcart,
  drawRider,
  drawSweeper,
  drawTaxi,
  LAMP_COLORS,
  randomRiderLook,
  type DrawnVehicle,
  type RiderLook,
  type VehicleFacing,
} from '../../sprites/vehicleSprites';
import type { Environment } from '../../scene/Environment';
import { glowTexture } from '../../scene/common/glow';
import { FOCAL } from '../../sim/groundPlane';
import { deliveryRiders, foodCartOut, sweeperOut, taxiHours } from '../../sim/wildlife';
import { FAR_END, NEAR_END, personHeightAt } from '../StreetLife';
import { evenSize } from '../../sprites/kit';

type VehicleKind = 'bike' | 'scooter' | 'sweeper' | 'taxi' | 'cart';

interface Vehicle {
  id: number;
  kind: VehicleKind;
  gx: number;
  /** Lane position it weaves about. */
  lane: number;
  depth: number;
  /** Ground px per second along the street (+ is away from us). */
  speed: number;
  facing: VehicleFacing;
  look: RiderLook | null;
  stride: number;
  /** Seconds left stopped (the food cart serving, the taxi waiting for a fare). */
  stop: number;
  stopped: boolean;
  /** Pulling in for a fare who hailed it, here (depth), rather than at its usual spot. */
  stopAt: number | null;
  sprite: Sprite;
  lamps: Sprite[];
  /** The taxi's headlight beam on the road ahead. */
  beam: Sprite | null;
  /** Whoever pushes the food cart. */
  pusher: { look: PersonLook; sprite: Sprite } | null;
}

/** Heights at depth 1 (world px). */
const HEIGHT_AT_1: Record<VehicleKind, number> = { bike: 31, scooter: 31, sweeper: 40, taxi: 25, cart: 31 };

export interface TrafficOptions {
  /** Where vehicles go, sorted by depth among the people and stalls. */
  container: Container;
  /** Additive layer for their lamps. */
  lights: Container;
  laneHalf: number;
  project: (gx: number, depth: number) => { x: number; y: number };
  /** How a point of the street is lit (the street life's tint there). */
  tintAt: (gx: number, depth: number) => number;
  rng?: () => number;
}

/**
 * Wheels in the market street: delivery riders on bikes and scooters weaving
 * up and down it by day (more at mealtimes and in the rain), the little
 * sweeper brushing it at dawn, a noodle cart pushed along after the market
 * shuts, and in the small hours a taxi creeping through, headlamps on.
 */
export class Traffic {
  private readonly vehicles: Vehicle[] = [];
  private readonly textures = new Map<string, { texture: Texture; drawn: DrawnVehicle }>();
  private readonly rng: () => number;
  private nextId = 1;
  private riderTimer = 2;
  private sweeperDone = false;
  private cartDone = false;
  private taxiTimer = 30;

  constructor(private readonly options: TrafficOptions) {
    this.rng = options.rng ?? Math.random;
  }

  /** How many of each are on the street. */
  get counts(): Record<VehicleKind, number> {
    const out: Record<VehicleKind, number> = { bike: 0, scooter: 0, sweeper: 0, taxi: 0, cart: 0 };
    for (const v of this.vehicles) out[v.kind]++;
    return out;
  }

  /** Send one of each kind out now (for demos and tests). */
  summon(kind: VehicleKind): void {
    this.spawn(kind, this.rng() < 0.5);
  }

  /** What's on the street, and where. */
  traffic(): Array<{ kind: VehicleKind; gx: number; depth: number; speed: number; stopped: boolean }> {
    return this.vehicles.map(({ kind, gx, depth, speed, stopped }) => ({ kind, gx, depth, speed, stopped }));
  }

  /** The taxi, if one's coming that hasn't a fare: where it is and which way it's going. */
  get freeTaxi(): { depth: number; speed: number } | null {
    const t = this.vehicles.find((v) => v.kind === 'taxi' && v.stopAt === null && !v.stopped);
    return t ? { depth: t.depth, speed: t.speed } : null;
  }

  /** Someone at this depth has hailed the taxi: it pulls in there and waits a moment for them to get in. */
  hail(depth: number): boolean {
    const t = this.vehicles.find((v) => v.kind === 'taxi' && v.stopAt === null);
    if (!t || (depth - t.depth) * Math.sign(t.speed) < 0.2) return false;
    t.stopAt = depth;
    t.stop = 4 + this.rng() * 2;
    return true;
  }

  /** The taxi standing at the kerb for its fare, if it's there now. */
  get taxiWaiting(): number | null {
    const t = this.vehicles.find((v) => v.kind === 'taxi' && v.stopAt !== null && v.stopped);
    return t ? t.depth : null;
  }

  update(dt: number, env: Environment): void {
    const h = env.lighting.hours;
    const raining = env.weather.kind === 'rain' && env.weather.precipitation > 0.2;
    // Delivery riders.
    const riders = this.vehicles.filter((v) => v.kind === 'bike' || v.kind === 'scooter').length;
    this.riderTimer -= dt;
    if (this.riderTimer <= 0) {
      this.riderTimer = 4 + this.rng() * 10;
      if (riders < deliveryRiders(h, raining)) this.spawn(this.rng() < 0.55 ? 'bike' : 'scooter', this.rng() < 0.5);
    }
    // One sweep of the street each dawn, one cart each night.
    if (sweeperOut(h)) {
      if (!this.sweeperDone && !this.has('sweeper')) {
        this.sweeperDone = true;
        this.spawn('sweeper', false);
      }
    } else this.sweeperDone = false;
    if (foodCartOut(h)) {
      if (!this.cartDone && !this.has('cart')) {
        this.cartDone = true;
        this.spawn('cart', this.rng() < 0.5);
      }
    } else this.cartDone = false;
    if (taxiHours(h)) {
      this.taxiTimer -= dt;
      if (this.taxiTimer <= 0 && !this.has('taxi')) {
        this.taxiTimer = 90 + this.rng() * 240;
        this.spawn('taxi', this.rng() < 0.5);
      }
    }

    for (let i = this.vehicles.length - 1; i >= 0; i--) {
      const v = this.vehicles[i];
      if (this.move(v, dt)) {
        this.remove(i);
        continue;
      }
      this.draw(v, env);
    }
  }

  private has(kind: VehicleKind): boolean {
    return this.vehicles.some((v) => v.kind === kind);
  }

  private spawn(kind: VehicleKind, away: boolean): void {
    const { laneHalf, container, lights } = this.options;
    const speeds: Record<VehicleKind, [number, number]> = { bike: [55, 80], scooter: [80, 115], sweeper: [12, 16], taxi: [28, 40], cart: [11, 15] };
    const [s0, s1] = speeds[kind];
    const lane = kind === 'sweeper' || kind === 'taxi' ? (this.rng() - 0.5) * laneHalf * 0.3 : (this.rng() * 2 - 1) * laneHalf * 0.6;
    const sprite = new Sprite({ anchor: { x: 0.5, y: 1 } });
    container.addChild(sprite);
    let beam: Sprite | null = null;
    if (kind === 'taxi') {
      beam = new Sprite({ anchor: 0.5, blendMode: 'add' });
      lights.addChild(beam);
    }
    let pusher: Vehicle['pusher'] = null;
    if (kind === 'cart') {
      pusher = { look: randomLook(this.rng), sprite: new Sprite({ anchor: { x: 0.5, y: 1 } }) };
      container.addChild(pusher.sprite);
    }
    this.vehicles.push({
      id: this.nextId++,
      kind,
      gx: lane,
      lane,
      depth: away ? NEAR_END : FAR_END,
      speed: (away ? 1 : -1) * (s0 + this.rng() * (s1 - s0)),
      facing: away ? 'back' : 'front',
      look: kind === 'bike' || kind === 'scooter' ? randomRiderLook(this.rng) : null,
      stride: 0,
      // The food cart stops a while mid-street to serve; the taxi pulls up for a fare now and then.
      stop: kind === 'cart' ? 40 + this.rng() * 60 : kind === 'taxi' && this.rng() < 0.4 ? 6 + this.rng() * 10 : 0,
      stopped: false,
      stopAt: null,
      sprite,
      lamps: [],
      beam,
      pusher,
    });
  }

  /** Returns true once it has left the street. */
  private move(v: Vehicle, dt: number): boolean {
    const mid = (NEAR_END + FAR_END) / 2;
    // Stopping mid-street once, if it has a reason to (or where its fare is waiting).
    const at = v.stopAt ?? mid * 0.6;
    if (v.stop > 0 && Math.abs(v.depth - at) < 0.15) {
      v.stopped = true;
      v.stop -= dt;
      return false;
    }
    v.stopped = false;
    v.depth += (v.speed * dt) / FOCAL;
    v.stride += Math.abs(v.speed) * dt;
    // Riders weave a little round the lane.
    if (v.kind === 'bike' || v.kind === 'scooter') v.gx = v.lane + Math.sin(v.stride * 0.02 + v.id) * 8;
    return v.depth > FAR_END + 0.5 || v.depth < NEAR_END - 0.15;
  }

  private texture(v: Vehicle, height: number): { texture: Texture; drawn: DrawnVehicle } {
    const frame = v.kind === 'bike' ? Math.floor(v.stride / 6) % 2 : v.kind === 'sweeper' ? Math.floor(v.stride / 2) % 2 : v.kind === 'cart' ? Math.floor(v.stride / 8) % 2 : 0;
    // Riders each have their own look; the rest share their textures.
    const key = `${v.kind === 'bike' || v.kind === 'scooter' ? `v${v.id}/` : ''}${v.kind}:${v.facing}:${frame}:${height}`;
    let t = this.textures.get(key);
    if (!t) {
      const drawn =
        v.kind === 'bike' || v.kind === 'scooter'
          ? drawRider(v.kind, v.look!, v.facing, frame, height)
          : v.kind === 'sweeper'
            ? drawSweeper(v.facing, frame, height)
            : v.kind === 'taxi'
              ? drawTaxi(v.facing, height)
              : drawPushcart(v.facing, frame, height);
      t = { texture: gridToTexture(drawn.grid, drawn.palette.colors), drawn };
      this.textures.set(key, t);
    }
    return t;
  }

  private draw(v: Vehicle, env: Environment): void {
    const { project, tintAt, lights } = this.options;
    const height = evenSize(HEIGHT_AT_1[v.kind] / v.depth, 4);
    const { texture, drawn } = this.texture(v, height);
    const p = project(v.gx, v.depth);
    v.sprite.texture = texture;
    v.sprite.position.set(Math.round(p.x), Math.round(p.y));
    v.sprite.zIndex = p.y;
    v.sprite.tint = tintAt(v.gx, v.depth);
    // Lamps: lit after dark (the sweeper's beacon turns day and night).
    const glow = env.lighting.emissive;
    while (v.lamps.length < drawn.lamps.length) {
      const s = new Sprite({ anchor: 0.5, blendMode: 'add' });
      lights.addChild(s);
      v.lamps.push(s);
    }
    const left = p.x - drawn.grid.width / 2;
    const top = p.y - drawn.grid.height;
    drawn.lamps.forEach((lamp, i) => {
      const s = v.lamps[i];
      const radius = lamp.size * (lamp.color === 'white' ? 3 : 2.4);
      s.texture = glowTexture(radius, LAMP_COLORS[lamp.color]);
      s.position.set(Math.round(left + lamp.x), Math.round(top + lamp.y));
      let alpha = Math.min(1, glow * 1.2);
      if (lamp.color === 'amber' && v.kind === 'sweeper') alpha = (Math.floor(env.time * 3) % 2 === 0 ? 1 : 0.15) * (0.45 + 0.55 * glow);
      if (lamp.color === 'red' && v.kind === 'taxi' && v.stopped) alpha = Math.min(1, alpha * 1.5);
      s.alpha = alpha;
      s.visible = alpha > 0.03;
    });
    for (let i = drawn.lamps.length; i < v.lamps.length; i++) v.lamps[i].visible = false;
    // The taxi's headlamps throw a pool of light on the road ahead of it.
    if (v.beam) {
      const ahead = v.facing === 'front' ? -0.22 : 0.22;
      const bp = project(v.gx, Math.max(0.5, v.depth + ahead));
      v.beam.texture = glowTexture(Math.max(2, Math.round(26 / v.depth)), 0xfff0d0, 0.35, false);
      v.beam.position.set(Math.round(bp.x), Math.round(bp.y));
      v.beam.alpha = v.facing === 'front' ? Math.min(0.9, glow) : Math.min(0.5, glow * 0.6);
      v.beam.visible = glow > 0.05;
    }
    // The food cart's pusher walks behind it.
    if (v.pusher) {
      const behind = v.facing === 'front' ? 0.035 : -0.035;
      const pd = v.depth + behind;
      const pp = project(v.gx + 2, pd);
      const ph = personHeightAt(pd);
      const frame = v.stopped ? 0 : Math.floor(v.stride / 5) % 4;
      const key = `v${v.id}/pusher:${v.facing}:${v.stopped ? 'stand' : 'walk'}:${frame}:${ph}`;
      let t = this.textures.get(key);
      if (!t) {
        const drawnPerson = drawPerson(v.pusher.look, v.facing, v.stopped ? 'browse' : 'walk', frame, false, ph);
        t = { texture: gridToTexture(drawnPerson.grid, drawnPerson.palette.colors), drawn: { ...drawnPerson, lamps: [] } };
        this.textures.set(key, t);
      }
      v.pusher.sprite.texture = t.texture;
      v.pusher.sprite.position.set(Math.round(pp.x), Math.round(pp.y));
      v.pusher.sprite.zIndex = pp.y;
      v.pusher.sprite.tint = tintAt(v.gx, pd);
    }
  }

  private remove(index: number): void {
    const v = this.vehicles[index];
    v.sprite.destroy();
    v.beam?.destroy();
    v.pusher?.sprite.destroy();
    for (const s of v.lamps) s.destroy();
    // Riders' and pushers' own textures go with them.
    for (const [key, t] of [...this.textures]) {
      if (key.startsWith(`v${v.id}/`)) {
        t.texture.destroy(true);
        this.textures.delete(key);
      }
    }
    this.vehicles.splice(index, 1);
  }
}
