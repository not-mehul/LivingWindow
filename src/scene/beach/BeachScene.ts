import { Container, Graphics, Sprite, type Texture } from 'pixi.js';
import { WORLD_HEIGHT, WORLD_WIDTH } from '../../config';
import { channels, lerpColor, multiplyColor, pack } from '../../core/color';
import { Emitter } from '../../core/Emitter';
import { lerp } from '../../core/math';
import { PixelBuffer } from '../../core/pixelBuffer';
import { createNearestTexture, PixelCanvas } from '../../core/pixelTexture';
import { quality } from '../../core/quality';
import { createRng } from '../../core/random';
import type { Ledge } from '../../life/types';
import { BEACH_HORIZON, beachPlane, BREAK_S, SHALLOWS_S, shorePoint, shoreXAtY } from '../../sim/shore';
import { TIDE_RANGE, tideClock, tideLevel } from '../../sim/tides';
import { WaveModel, type BreakEvent } from '../../sim/waves';
import { pixelHash } from '../../sprites/raster';
import { bayer } from '../common/paint';
import { DayNightSprite, type NightGrade } from '../common/night';
import { rustleTextures } from '../common/rustle';
import { SwayMesh } from '../common/SwayMesh';
import type { Environment } from '../Environment';
import { Sky } from '../sky/Sky';
import type { WorldScene } from '../WorldScene';
import { FROND_COLORS, generateBeach, type BeachLayout } from './beachGenerator';

export { BEACH_HORIZON };

/** Moonlit grades for the beach's layers, after the night drawing. */
const NIGHT: Record<'land' | 'sand' | 'scrub' | 'props', NightGrade> = {
  land: { desaturate: 0.5, tint: [0.3, 0.36, 0.46], lift: [8, 10, 22] },
  // Sand glows a pale lavender grey under the moon.
  sand: { desaturate: 0.85, tint: [0.52, 0.52, 0.6], lift: [12, 12, 24] },
  scrub: { desaturate: 0.55, tint: [0.36, 0.42, 0.46], lift: [6, 8, 14] },
  props: { desaturate: 0.7, tint: [0.56, 0.56, 0.64], lift: [8, 8, 16] },
};
const NIGHT_PLANTS = 0x4c5c66;

/** Dusk and dawn, after the drawing: rosy sand, the palms and scrub near silhouettes against the glow. */
const DUSK: typeof NIGHT = {
  land: { desaturate: 0.5, tint: [0.42, 0.36, 0.44], lift: [10, 8, 18] },
  sand: { desaturate: 0.3, tint: [0.92, 0.72, 0.8], lift: [0, 0, 12] },
  scrub: { desaturate: 0.5, tint: [0.72, 0.62, 0.7], lift: [6, 4, 12] },
  props: { desaturate: 0.4, tint: [0.78, 0.62, 0.7], lift: [4, 2, 10] },
};
const DUSK_PLANTS = 0x7a6470;

const WATER_TOP = BEACH_HORIZON + 1;
const WATER_HEIGHT = WORLD_HEIGHT - WATER_TOP;
/** Rebuild the water texture at this rate (it's the heaviest per-frame work). */
const WATER_FPS = 30;
/** Wet sand dries back this fast (ground px per second). */
const DRY_RATE = 1.6;
/** Old run-up figures were screen px at the shore; across the shore they are this many ground px. */
const RUN_UP_SCALE = 2.4;
/** Swells first show this far out (ground px). */
const SWELL_START = 820;

/** A palm as it moves: its trunk, and the fronds (and the coconut hub) riding its crown. */
interface PalmSway {
  trunk: SwayMesh;
  fronds: Array<{ sway?: SwayMesh; sprite?: Sprite; x: number; y: number }>;
  view: Container;
  haze: number;
  /** Where the crown is on the trunk's art, and how far it has moved this frame. */
  crown?: { x: number; y: number };
  crownOffset?: { x: number; y: number };
}

export interface BeachEvents {
  break: BreakEvent & { pan: number };
}

/**
 * Scene 3: the beach, after the reference drawing. Palms lean in over a dune
 * path on the left; the beach runs away to a wooded point on the horizon;
 * the sea lies to the right, its swells rolling in parallel to the curving
 * shore, breaking, washing up the sand (leaving it wet to dry slowly), with a
 * glitter path under the sun or moon.
 */
export class BeachScene extends Emitter<BeachEvents> implements WorldScene {
  readonly container = new Container({ label: 'beach-scene' });
  readonly sky = new Sky({ horizonY: BEACH_HORIZON, seed: 909, milkyWay: true });
  readonly horizonY = BEACH_HORIZON;
  readonly groundY = [BEACH_HORIZON + 10, 340] as const;
  readonly weatherBack = new Container({ label: 'weather-back' });
  readonly weatherFront = new Container({ label: 'weather-front' });
  readonly birdsFar = new Container({ label: 'birds-far' });
  readonly birdsMid = new Container({ label: 'birds-mid' });
  readonly birdsNear = new Container({ label: 'birds-near' });
  /** Fish under the shallows, dolphins at the horizon, splashes. */
  readonly fishLayer = new Graphics();
  /** Jellyfish drifting in the shallows, over the water and under the shore life. */
  readonly seaLife = new Container({ label: 'sea-life' });
  /** How brightly the surf glows blue tonight (0 most nights): a bloom in the water, set by the shore life. */
  bioluminescence = 0;
  readonly horizonLayer = new Container({ label: 'horizon-life' });
  readonly splashLayer = new Graphics();
  /** The tide pools on the rock shelf: under the water, so waves and the tide wash over them. */
  readonly poolLayer = new Container({ label: 'tide-pools' });
  /** Low over the open sand (blowing sand), over the surf (spray haze), and the far sand bending in the heat. */
  readonly sandFx = new Container({ label: 'sand-fx' });
  readonly airLayer = new Container({ label: 'air' });
  readonly shimmerLayer = new Container({ label: 'shimmer' });
  /** How big the sea is running (0 calm .. 1 storm). */
  seaEnergy = 0;
  /** Turtles and shorebirds on the sand, sorted by depth (the rocks among them). */
  readonly shoreLayer = new Container({ label: 'shore-life', sortableChildren: true });
  readonly ledges: Ledge[];
  readonly waves: WaveModel;
  readonly layout: BeachLayout;

  private readonly land: DayNightSprite;
  private readonly sand: DayNightSprite;
  private readonly scrub: DayNightSprite;
  private readonly props: DayNightSprite;
  private readonly dune: DayNightSprite;
  private readonly water: Sprite;
  private readonly waterCanvas = new PixelCanvas(WORLD_WIDTH, WATER_HEIGHT);
  private readonly waterImage: ImageData;
  private readonly waterTexture: Texture;
  /** Per world row (along the beach): how far up the sand is still wet, in ground px. */
  private readonly wetLine = new Float32Array(WATER_HEIGHT);
  /** Per world row: how glassy the sand the last wave ran over still is (1 just drained .. 0 dried off). */
  private readonly gloss = new Float32Array(WATER_HEIGHT);
  /** Per world row: how far up the sand the water has run this moment (ground px). */
  private readonly reach = new Float32Array(WATER_HEIGHT);
  /** Per world row, fixed: its depth, where the still waterline is, how near, and its colour band. */
  private readonly rows = waterRows();
  /** The water's pixels (RGBA, little-endian), and this frame's sea colours. */
  private readonly waterPixels: Uint32Array;
  private readonly ramps = new Uint32Array(6 * SHADES);
  private readonly faces = new Uint32Array(6);
  private readonly palms: PalmSway[] = [];
  /** The palms and the dune plants among them, sorted by depth (a fallen coconut goes here too). */
  readonly palmLayer = new Container({ label: 'palms', sortableChildren: true });
  private readonly tufts: SwayMesh[] = [];
  private readonly tuftLayer = new Container({ label: 'tufts' });
  private readonly rocks: DayNightSprite[] = [];
  /** Spray waiting to burst off the rocks as a breaker reaches them. */
  private readonly sprays: Array<{ x: number; y: number; delay: number; size: number }> = [];
  /** The tide: hours since the epoch at midnight today, and how high it is now (-1..1). */
  private readonly tideMidnight = tideClock(new Date(), 0);
  private tideDays = 0;
  private lastHours = Number.NaN;
  private tide = 0;
  /** How churned up the water round the rocks is, after the last breaker (0..1). */
  private surge = 0;
  private waterTimer = 0;
  private tick = 0;
  private readonly splashes: Array<{ x: number; y: number; vx: number; vy: number; life: number }> = [];

  constructor() {
    super();
    this.layout = generateBeach();
    this.ledges = this.layout.ledges;
    this.waves = new WaveModel(createRng(31));
    this.land = new DayNightSprite(this.layout.land, NIGHT.land, DUSK.land);
    this.sand = new DayNightSprite(this.layout.sand, NIGHT.sand, DUSK.sand);
    this.scrub = new DayNightSprite(this.layout.scrub, NIGHT.scrub, DUSK.scrub);
    this.props = new DayNightSprite(this.layout.props, NIGHT.props, DUSK.props);
    this.dune = new DayNightSprite(this.layout.dune, NIGHT.sand, DUSK.sand);

    this.waterImage = this.waterCanvas.ctx.createImageData(WORLD_WIDTH, WATER_HEIGHT);
    this.waterPixels = new Uint32Array(this.waterImage.data.buffer);
    this.waterTexture = createNearestTexture(this.waterCanvas.canvas);
    this.water = new Sprite(this.waterTexture);
    this.water.y = WATER_TOP;

    for (const [i, palm] of this.layout.palms.entries()) {
      // Neighbouring palms are in step, give or take, as the same gusts reach them.
      const phase = palm.x * 0.004 + i * 0.3;
      const parts = palm.parts;
      if (!parts) {
        const sway = new SwayMesh(palm.art.toTexture(), { anchor: 'bottom', amplitude: 1 + palm.art.height / 25, frequency: 0.8, phase, rustle: rustleTextures(palm.art, palm.leaves ?? [], 400 + i, 3) });
        sway.mesh.position.set(palm.x, palm.y);
        sway.mesh.zIndex = palm.baseY;
        this.palmLayer.addChild(sway.mesh);
        this.palms.push({ trunk: sway, fronds: [], view: sway.mesh, haze: palm.haze });
        continue;
      }
      // A near palm in parts: the trunk bends slowly from its foot, the crown rides on top of it,
      // and each frond bobs and whips about its root on its own.
      const view = new Container({ label: 'palm' });
      view.zIndex = palm.baseY;
      const trunk = new SwayMesh(parts.trunk.art.toTexture(), { anchor: 'bottom', amplitude: 0.6 + parts.trunk.art.height / 150, frequency: 0.55, phase });
      trunk.mesh.position.set(parts.trunk.x, parts.trunk.y);
      view.addChild(trunk.mesh);
      const fronds: PalmSway['fronds'] = [];
      for (const [k, f] of parts.fronds.entries()) {
        const sway = new SwayMesh(f.art.toTexture(), {
          anchor: f.side < 0 ? 'right' : 'left',
          pivotX: f.pivotX,
          amplitude: 0.8 + f.art.width / 30,
          frequency: 1.15 + ((k * 0.37) % 0.5),
          phase: phase + k * 0.45,
          rustle: rustleTextures(f.art, FROND_COLORS, 500 + i * 31 + k, 3),
          rustleRate: 4,
        });
        sway.mesh.position.set(f.x, f.y);
        view.addChild(sway.mesh);
        fronds.push({ sway, x: f.x, y: f.y });
      }
      const hub = new Sprite(parts.hub.art.toTexture());
      hub.position.set(parts.hub.x, parts.hub.y);
      view.addChild(hub);
      fronds.push({ sprite: hub, x: parts.hub.x, y: parts.hub.y });
      this.palmLayer.addChild(view);
      const crown = { x: parts.crown.x - parts.trunk.x, y: parts.crown.y - parts.trunk.y };
      const entry: PalmSway = { trunk, fronds, view, haze: palm.haze, crown, crownOffset: { x: 0, y: 0 } };
      this.palms.push(entry);
      if (palm.ledge) palm.ledge.sway = () => entry.crownOffset!;
    }
    for (const [i, tuft] of this.layout.tufts.entries()) {
      const sway = new SwayMesh(tuft.art.toTexture(), {
        anchor: 'bottom',
        amplitude: tuft.amp ?? 1 + tuft.art.height / 10,
        frequency: 1.6,
        rustle: tuft.leaves ? rustleTextures(tuft.art, tuft.leaves, 700 + i, 3) : undefined,
        rustleRate: 4,
      });
      sway.mesh.position.set(Math.round(tuft.x), Math.round(tuft.y));
      this.tufts.push(sway);
      // The front dune bank's tufts sit on it; the dunes' plants sort among the palms.
      if (tuft.baseY >= 286) this.tuftLayer.addChild(sway.mesh);
      else {
        sway.mesh.zIndex = tuft.baseY;
        this.palmLayer.addChild(sway.mesh);
      }
    }

    for (const c of this.layout.outcrop.clusters) {
      const rock = new DayNightSprite(c.art, NIGHT.props, DUSK.props);
      rock.container.position.set(c.x, c.y);
      rock.container.zIndex = c.baseY;
      this.shoreLayer.addChild(rock.container);
      this.rocks.push(rock);
    }

    this.container.addChild(
      this.sky.container,
      this.land.container,
      this.sand.container,
      this.scrub.container,
      this.shimmerLayer,
      this.poolLayer,
      this.water,
      this.sandFx,
      this.fishLayer,
      this.seaLife,
      this.airLayer,
      this.horizonLayer,
      this.birdsFar,
      this.shoreLayer,
      this.props.container,
      this.palmLayer,
      this.birdsMid,
      this.splashLayer,
      this.weatherBack,
      this.dune.container,
      this.tuftLayer,
      this.birdsNear,
      this.weatherFront,
    );
  }

  /** How far the water has run up the sand at a depth along the beach (ground px from the still waterline; below it at low tide). */
  reachAt(depth: number): number {
    const y = beachPlane.project(0, depth).y;
    return this.waves.runUp(Math.round(y * 3)) * RUN_UP_SCALE + this.tideS;
  }

  /** The crowns of the near palms where they are this moment, with the ground beneath. */
  palmCrowns(): Array<{ x: number; y: number; ground: number; scale: number }> {
    const out: Array<{ x: number; y: number; ground: number; scale: number }> = [];
    for (const [i, p] of this.palms.entries()) {
      const parts = this.layout.palms[i].parts;
      if (!parts || !p.crownOffset) continue;
      const ground = this.layout.palms[i].baseY;
      out.push({ x: parts.crown.x + p.crownOffset.x, y: parts.crown.y + p.crownOffset.y, ground, scale: beachPlane.scaleAtY(ground) });
    }
    return out;
  }

  /** The sand with the far scrub over it, as painted. */
  get farGround(): PixelBuffer {
    const p = new PixelBuffer(WORLD_WIDTH, WORLD_HEIGHT);
    p.draw(this.layout.sand, 0, 0);
    p.draw(this.layout.scrub, 0, 0);
    return p;
  }

  /** The tide's clock: hours since the epoch, as the clock has it now. */
  get tideHours(): number {
    return this.tideMidnight + this.tideDays * 24 + (Number.isNaN(this.lastHours) ? 12 : this.lastHours);
  }

  /** How high the tide is (-1 low .. 1 high springs). */
  get tideLevel(): number {
    return this.tide;
  }

  /** How far the tide has moved the waterline up the sand (ground px; negative when it's out). */
  get tideS(): number {
    return this.tide * TIDE_RANGE;
  }

  /** World position of the water's edge right now at a depth along the beach, offset `up` ground px up the sand. */
  edgePoint(depth: number, up = 0): { x: number; y: number; scale: number } {
    return shorePoint(depth, -this.reachAt(depth) - up);
  }

  /** How far up the sand is still wet at a depth (ground px from the still waterline; below it at low tide). */
  wetAt(depth: number): number {
    const y = Math.round(beachPlane.project(0, depth).y);
    return this.wetLine[Math.max(0, Math.min(WATER_HEIGHT - 1, y - WATER_TOP))];
  }

  /** A burst of spray (a diving gull, a breaching dolphin). */
  splash(x: number, y: number, size = 1): void {
    for (let i = 0; i < 10 * size; i++) {
      this.splashes.push({ x, y, vx: (Math.random() - 0.5) * 30 * size, vy: -20 - Math.random() * 30 * size, life: 0.6 + Math.random() * 0.4 });
    }
  }

  /** Spray dashed up off a rock: a tall, spreading fountain of drops, carried off by the wind. */
  private burst(x: number, y: number, size: number, wind: number): void {
    for (let i = 0; i < 22 * size; i++) {
      const up = 35 + Math.random() * 45 * size;
      this.splashes.push({ x: x + (Math.random() - 0.5) * 8 * size, y: y + Math.random() * 3, vx: (Math.random() - 0.5) * 26 * size + wind * 14, vy: -up, life: 0.7 + Math.random() * 0.7 });
    }
  }

  update(dt: number, env: Environment): void {
    const { lighting, weather, time } = env;
    this.sky.update(dt, env);
    this.land.update(lerpColor(lighting.haze, lighting.ambient, 0.3), lighting);
    this.sand.update(lighting.ambient, lighting);
    this.scrub.update(lighting.ambient, lighting);
    this.props.update(lighting.ambient, lighting);
    this.dune.update(lighting.ambient, lighting);
    for (const rock of this.rocks) rock.update(lighting.ambient, lighting);
    // The tide follows the clock (counting the days as it goes round).
    if (lighting.hours < this.lastHours - 12) this.tideDays++;
    else if (lighting.hours > this.lastHours + 12) this.tideDays--;
    this.lastHours = lighting.hours;
    this.tide = tideLevel(this.tideMidnight + this.tideDays * 24 + lighting.hours);
    // By moonlight the palms and grasses are dark grey-green against pale sand.
    const plants = lerpColor(lerpColor(lighting.ambient, DUSK_PLANTS, lighting.twilight * 0.6), NIGHT_PLANTS, lighting.nightness * 0.85);
    this.tuftLayer.tint = plants;
    for (const palm of this.palms) {
      palm.view.tint = lerpColor(plants, lighting.haze, palm.haze);
      palm.trunk.update(time, weather.wind);
      if (!palm.crown) continue;
      // The crown rides the top of the trunk.
      const o = palm.trunk.offsetAt(palm.crown.x, palm.crown.y);
      palm.crownOffset = o;
      for (const f of palm.fronds) {
        const view = f.sway ? f.sway.mesh : f.sprite!;
        view.position.set(f.x + o.x, f.y + o.y);
        f.sway?.update(time, weather.wind);
      }
    }
    for (const g of this.tufts) {
      g.update(time * 1.2, weather.wind);
      if (g.mesh.parent === this.palmLayer) g.mesh.tint = plants;
    }

    const energy = Math.min(1, Math.abs(weather.wind) * 0.8 + weather.lightning * 0.6 + (weather.kind === 'rain' ? 0.15 : 0));
    this.seaEnergy = energy;
    for (const event of this.waves.update(dt, energy)) {
      // The sea is to the right: breaks sound from the right-hand side.
      this.emit('break', { ...event, pan: 0.15 + Math.random() * 0.6 });
      this.surge = Math.min(1, 0.4 + event.amplitude / 40);
      // Spray thrown up off the rocks out in the surf, the outer ones first.
      for (const p of this.layout.outcrop.spray) {
        if (Math.random() < 0.25) continue;
        this.sprays.push({ x: p.x, y: p.y, delay: Math.max(0, (120 - p.s) / 300) + Math.random() * 0.2, size: Math.min(1.6, (0.4 + event.amplitude / 30) * beachPlane.scaleAtY(p.y) * 2) });
      }
    }
    this.surge = Math.max(0, this.surge - dt * 0.25);
    for (let i = this.sprays.length - 1; i >= 0; i--) {
      const p = this.sprays[i];
      p.delay -= dt;
      if (p.delay > 0) continue;
      this.burst(p.x + (Math.random() - 0.5) * 6, p.y, p.size, env.weather.wind);
      this.sprays.splice(i, 1);
    }
    for (let row = 0; row < WATER_HEIGHT; row++) {
      const reach = this.waves.runUp(Math.round((row + WATER_TOP) * 3)) * RUN_UP_SCALE;
      this.reach[row] = reach;
      // Kept from the still waterline, so the tide going out leaves the sand behind it wet.
      const top = reach + this.tideS;
      // While the water is still running up, the sand it leaves will be glassy; it dries off after.
      this.gloss[row] = top >= this.wetLine[row] - 0.5 ? 1 : Math.max(0, this.gloss[row] - dt / 3);
      this.wetLine[row] = Math.max(top, this.wetLine[row] - DRY_RATE * dt);
    }

    this.waterTimer -= dt;
    if (this.waterTimer <= 0) {
      this.waterTimer = 1 / (WATER_FPS * quality.scale);
      this.tick++;
      this.drawWater(env);
    }
    this.updateSplashes(dt, lighting.ambient);
  }

  private drawWater(env: Environment): void {
    const { lighting } = env;
    const amb = lighting.ambient;
    // By moonlight: a deep navy sea with silvery crests and bright white foam, as in the night drawing.
    const n = lighting.nightness;
    const moon = n * lighting.moonlight;
    // At dusk and dawn: a deep navy-violet sea, its crests and foam catching the pink of the sky.
    const t = lighting.twilight;
    const grade = (day: number, dusk: number, night: number, nightAmount = n) => lerpColor(lerpColor(day, dusk, t), night, nightAmount);
    const seaFar = grade(lerpColor(lighting.skyHorizon, multiplyColor(0x2a6496, amb), 0.55), 0x2c2a5c, 0x1a2450);
    const seaNear = grade(lerpColor(lighting.skyHorizon, multiplyColor(0x2a8cae, amb), 0.12), 0x34346c, 0x24366a);
    const shallow = grade(multiplyColor(0x4ec6c2, amb), 0x5a5280, 0x3a5888);
    const crest = rgba(grade(lerpColor(seaNear, multiplyColor(0xe2f2f4, amb), 0.6), 0xc898ac, 0x8a9ccc, moon));
    const ripple = rgba(grade(lerpColor(seaNear, multiplyColor(0xbfe2ea, amb), 0.45), 0x7a6890, 0x5a6ca4));
    const foamColor = grade(lerpColor(multiplyColor(0xf6f8f6, amb), 0xffffff, 0.15 + 0.2 * (1 - lighting.darkness)), 0xf4d4d4, 0xe4ecf8, moon);
    const foam = rgba(foamColor);
    const sheetColor = grade(lerpColor(multiplyColor(0xd8c08a, amb), multiplyColor(0x9ad4d4, amb), 0.6), 0xb08a98, 0x7686b0);
    const sheet = rgba(sheetColor, 215);
    const sheetEdge = rgba(sheetColor);
    const wetColor = grade(multiplyColor(0x9a7c50, amb), 0x7a5a5e, 0x50506a);
    const wet = rgba(wetColor, 225);
    // Freshly drained sand shines with a film of water, holding the sky.
    const glassy = rgba(lerpColor(wetColor, lerpColor(lighting.skyHorizon, lighting.skyTop, 0.3), 0.42), 225);
    const surf = [0, 1, 2, 3].map((k) => rgba(lerpColor(shallow, foamColor, 0.95 - k * 0.16)));
    // On a bloom night, the churning water sparks electric blue.
    const bio = this.bioluminescence;
    const tick = this.tick;
    const glow = (x: number, y: number, chance: number): number => (bio > 0 && pixelHash(x, y + tick * 3, 77) < chance * bio ? BIO[(x + y + tick) % 3] : 0);

    // Glitter path under the sun (or the moon, faintly).
    const body = lighting.sun.visible && lighting.sun.elevation > 0.02 ? lighting.sun : lighting.moon.visible ? lighting.moon : null;
    const glintX = body ? lerp(70, WORLD_WIDTH - 70, body.progress) : -999;
    // The moon lays a broad silver path across the water.
    const glintStrength = body === lighting.sun ? body.glow * 1.2 + 0.2 : body ? body.glow * 2.2 : 0;
    const glint = rgba(body ? lerpColor(body.color, 0xffffff, body === lighting.sun ? 0.3 : 0.6) : 0xffffff);
    const glintWidth = body === lighting.moon ? 2 : 1;
    // On a dark, clear night the stars show in the wet sand; on a bloom night, the sand the waves wash over sparks blue.
    const starsInSand = lighting.stars * lighting.nightness * (1 - lighting.moonlight * 0.5);
    const starPixel = rgba(0xdce4ff, 230);

    // The sea's colour steps from the horizon towards us, each with its shallows ramp.
    const ramps = this.ramps;
    const faces = this.faces;
    for (let step = 0; step <= 5; step++) {
      const base = lerpColor(seaFar, seaNear, step / 5);
      for (let i = 0; i < SHADES; i++) ramps[step * SHADES + i] = rgba(lerpColor(base, shallow, (i / (SHADES - 1)) * 0.85));
      faces[step] = rgba(lerpColor(base, seaFar, 0.25));
    }

    const swells = this.waves.swells();
    const breakers = this.waves.breakers();
    const out = this.waterPixels;
    const rows = this.rows;
    const W = WORLD_WIDTH;
    const tideS = this.tideS;

    for (let row = 0; row < WATER_HEIGHT; row++) {
      const y = row + WATER_TOP;
      const depth = rows.depth[row];
      // Everything is measured from where the tide has the waterline now.
      const shoreX = rows.shoreX[row] - tideS / depth;
      const reach = this.reach[row];
      const wetTo = this.wetLine[row] - tideS;
      const level = rows.level[row];
      const o = row * W;
      const x0 = Math.min(W, Math.max(0, Math.floor(shoreX - (wetTo + 4) / depth)));
      // The first column of open sea (s ≥ 0), and how s grows across the row.
      const xs = Math.min(W, Math.max(x0, Math.ceil(shoreX)));
      out.fill(0, o, o + x0);
      const dRow = BAYER_ROWS[y & 3];
      const gloss = this.gloss[row] * 1.25;
      const band = Math.max(1, wetTo - reach);

      // The sand: a thin sheet of a wave washing up it, edged with lacy foam, and wet sand drying back from its top edge.
      for (let x = x0; x < xs; x++) {
        const s = (x - shoreX) * depth;
        if (-s < reach) {
          const atEdge = reach + s < 3 * depth;
          out[o + x] = !atEdge ? sheet : pixelHash(x, y, tick >> 1) > 0.3 ? glow(x, y, 0.6) || foam : sheetEdge;
        } else if (-s < wetTo && (wetTo + s) / Math.max(1, wetTo) > dRow[x & 3] * 0.5) {
          // The sheen dries off from the top of the washed band down towards the water.
          const shiny = gloss > 0 && (-s - reach) / band < gloss - dRow[x & 3] * 0.35;
          let c = shiny ? glassy : wet;
          if (starsInSand > 0.05 && pixelHash(x, y, 501) > 1 - 0.022 * starsInSand && pixelHash(x, y, 502 + (tick >> 3)) > 0.35) c = starPixel;
          if (bio > 0 && shiny) c = glow(x, y, 0.1 * gloss) || c;
          out[o + x] = c;
        } else out[o + x] = 0;
      }
      if (xs >= W) continue;

      // Open sea: banded and dithered from the horizon towards us, greener in the shallows, with wind ripples drifting across the open water.
      const stepLo = Math.min(5, Math.floor(level));
      const frac = level % 1;
      const shallowEnd = Math.min(W, shoreX + SHALLOWS_S / depth);
      const rippleAt = 0.975 - rows.nearness[row] * 0.02;
      let cell = -1;
      let rippled = false;
      for (let x = xs; x < W; x++) {
        const dither = dRow[x & 3];
        const step = frac > dither ? Math.min(5, stepLo + 1) : stepLo;
        if (x < shallowEnd) {
          const s = (x - shoreX) * depth;
          out[o + x] = ramps[step * SHADES + Math.min(SHADES - 1, Math.floor((1 - s / SHALLOWS_S) * (SHADES - 1) + dither))];
          continue;
        }
        const c = Math.floor((x + tick * 0.25) / 3);
        if (c !== cell) {
          cell = c;
          rippled = pixelHash(c, y, 5) > rippleAt;
        }
        // Exactly at the shallows' edge s = SHALLOWS_S: no ripple, deepest shade.
        out[o + x] = rippled && (x - shoreX) * depth > SHALLOWS_S ? ripple : ramps[step * SHADES];
      }

      // The rest is laid over the sea in spans: s = (x - shoreX) · depth, so each band of s is a run of columns.
      const span = (sFrom: number, sTo: number): [number, number] => [Math.max(xs, Math.floor(shoreX + sFrom / depth)), Math.min(W - 1, Math.ceil(shoreX + sTo / depth))];
      // Swell crests rolling in, parallel to the shore, with a darker face behind.
      const crestHalf = rows.crestHalf[row];
      const faceTo = crestHalf + 4 * depth;
      for (let i = 0; i < swells.length; i++) {
        const p = swells[i];
        const at = lerp(SWELL_START, BREAK_S + 4, p ** 1.25) + Math.sin(depth * 6 + p * 9) * 5;
        const [a, b] = span(at - crestHalf, at + faceTo);
        for (let x = a; x <= b; x++) {
          const off = (x - shoreX) * depth - at;
          if (off > -crestHalf && off < crestHalf) out[o + x] = crest;
          else if (off > crestHalf && off < faceTo) out[o + x] = faces[Math.min(5, Math.floor(level) + (frac > dRow[x & 3] ? 1 : 0))];
        }
      }
      // Lines of white surf lying parallel to the shore, shifting gently.
      for (let k = 0; k < 4; k++) {
        const at = 14 + k * 26 + Math.sin(depth * 5 + k * 2 + tick * 0.02) * 4;
        const half = LINE_HALF[k] * depth + 1.2;
        const [a, b] = span(at - half, Math.min(SHALLOWS_S, at + half));
        for (let x = a; x <= b; x++) {
          const s = (x - shoreX) * depth;
          const off = s - at;
          if (s < SHALLOWS_S && off > -half && off < half && pixelHash(Math.floor(x / 2), y + k * 31, (tick >> 3) + k) > 0.2 + k * 0.14) out[o + x] = glow(x, y, 0.35 - k * 0.06) || surf[k];
        }
      }
      // Breakers churning into foam, trailing lace behind them.
      for (let i = 0; i < breakers.length; i++) {
        const front = lerp(BREAK_S, -2, breakers[i].progress);
        const thick = 14 * (1 - breakers[i].progress) + 6;
        const seed = Math.floor(breakers[i].seed);
        const [a, b] = span(front - thick, front + thick + 30);
        for (let x = a; x <= b; x++) {
          const off = (x - shoreX) * depth - front;
          if (off > -thick && off < thick) {
            if (pixelHash(x, y + tick, seed) > 0.22 + (Math.abs(off) / thick) * 0.4) out[o + x] = glow(x, y, 0.75) || foam;
          } else if (off > thick && off < thick + 30 && pixelHash(x, y, seed + (tick >> 2)) > 0.9) out[o + x] = glow(x, y, 0.5) || foam;
        }
      }
      // Foam swirling round the feet of the rocks standing in the sea, thicker after a breaker.
      for (const f of this.layout.outcrop.feet) {
        const ry = f.ry + 1.5;
        if (Math.abs(y - f.y) > ry) continue;
        const rx = f.rx * 1.2;
        const a = Math.max(xs, Math.floor(f.x - rx));
        const b = Math.min(W - 1, Math.ceil(f.x + rx));
        for (let x = a; x <= b; x++) {
          const u = (x - f.x) / rx;
          const v = (y - f.y) / ry;
          const d = u * u + v * v;
          if (d < 1 && d > 0.35 && pixelHash(x, y + (tick >> 1), 91) > 0.75 - this.surge * 0.4 - d * 0.1) out[o + x] = glow(x, y, 0.6) || foam;
        }
      }
      // Sun or moon glitter: short sparkles fanning out towards us.
      if (glintStrength > 0.05 && row > 0) {
        const glintHalf = (4 + row * 0.5) * glintWidth;
        const a = Math.max(xs, Math.floor(glintX - glintHalf));
        const b = Math.min(W - 1, Math.ceil(glintX + glintHalf));
        for (let x = a; x <= b; x++) {
          const off = Math.abs(x - glintX);
          if (off < glintHalf && pixelHash(Math.floor(x / 3), y, tick) > 1 - 0.07 * glintStrength * (1 - off / glintHalf)) out[o + x] = glint;
        }
      }
    }
    this.waterCanvas.ctx.putImageData(this.waterImage, 0, 0);
    this.waterTexture.source.update();
  }

  private updateSplashes(dt: number, tint: number): void {
    const g = this.splashLayer;
    g.clear();
    for (let i = this.splashes.length - 1; i >= 0; i--) {
      const s = this.splashes[i];
      s.life -= dt;
      if (s.life <= 0) {
        this.splashes.splice(i, 1);
        continue;
      }
      s.vy += 120 * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      g.rect(Math.round(s.x), Math.round(s.y), 1, 1).fill({ color: lerpColor(tint, 0xffffff, 0.5), alpha: Math.min(1, s.life * 2) });
    }
  }
}

/** Shades in each band of the sea's ramp, from open water to the shallows. */
const SHADES = 6;
/** Half-widths of the four surf lines (per unit of depth). */
const LINE_HALF = [1.4, 0.9, 0.9, 0.9];
/** The 4×4 ordered dither, a row at a time. */
const BAYER_ROWS = [0, 1, 2, 3].map((y) => Float32Array.from([0, 1, 2, 3], (x) => bayer(x, y)));
/** The bloom's electric blues. */
const BIO = [0x2a5aff, 0x3aa8ff, 0x7ae8ff].map((c) => rgba(c));

/** A colour as a pixel in an RGBA image's 32-bit view (little-endian: alpha in the top byte). */
function rgba(c: number, alpha = 255): number {
  return ((alpha << 24) | ((c & 0xff) << 16) | (c & 0xff00) | ((c >> 16) & 0xff)) >>> 0;
}

/** What doesn't change about each row of the water: computed once. */
function waterRows() {
  const depth = new Float64Array(WATER_HEIGHT);
  const shoreX = new Float64Array(WATER_HEIGHT);
  const nearness = new Float64Array(WATER_HEIGHT);
  const level = new Float64Array(WATER_HEIGHT);
  const crestHalf = new Float64Array(WATER_HEIGHT);
  for (let row = 0; row < WATER_HEIGHT; row++) {
    const y = row + WATER_TOP;
    depth[row] = beachPlane.depthAtY(y);
    shoreX[row] = shoreXAtY(y);
    nearness[row] = row / WATER_HEIGHT;
    level[row] = nearness[row] ** 0.7 * 5;
    crestHalf[row] = 0.8 * depth[row] + 1.2;
  }
  return { depth, shoreX, nearness, level, crestHalf };
}

/** Shared helper for the darker-than-water fish colour. */
export function fishColor(ambient: number): number {
  const [r, g, b] = channels(multiplyColor(0x1e4a5a, ambient));
  return pack(r, g, b);
}


