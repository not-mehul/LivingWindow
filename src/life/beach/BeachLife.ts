import type { LandscapeDeps, SceneLife, SillBase } from '../../landscapes/types';
import type { BeachScene } from '../../scene/beach/BeachScene';
import { poolShapes } from '../../scene/beach/rocks';
import type { Environment } from '../../scene/Environment';
import { Cooldown } from '../../sim/interplay';
import { shoreCoords, shorePoint } from '../../sim/shore';
import { PelicanLine } from './PelicanLine';
import { WindowDog } from '../WindowDog';
import { BirdSystem, type BirdEcology } from '../BirdSystem';
import { Bioluminescence, Crabs, Hatchlings, HermitCrabs, Jellyfish, Pelican } from './ShoreCreatures';
import { Dolphins, FishAndGulls, Sandpipers, Turtles } from './Shoreline';
import { TidePools } from './TidePools';
import { BeachAir } from './BeachAir';
import { Boats } from './Boats';
import { Froth } from './Froth';
import { Nightjars } from './NightShore';
import { Bats } from '../common/Bats';
import { Egret, Frigatebird, Gulls, JumpingFish } from './ShoreBirds';
import { Tracks } from './Tracks';
import { Wrack } from './Wrack';

export const BEACH_ECOLOGY: BirdEcology = {
  mix: () => ({ seagull: 1 }),
  maxPerSpecies: { seagull: 6 },
  flockSpecies: ['seagull'],
  perchPreference: (_species, kind) => (kind === 'post' ? 3 : kind === 'rock' ? 2 : kind === 'log' ? 1.5 : 1.2),
};

/**
 * Gulls, sandpipers, a fish school in the shallows, turtles and dolphins;
 * crabs at the water's edge and hermit crabs on the dry sand; a pelican
 * fishing; jellyfish; life in the tide pools; and on some nights a glowing
 * sea or a hatching nest.
 */
export class BeachLife implements SceneLife {
  readonly birds: BirdSystem;
  readonly dog: WindowDog;
  readonly sandpipers: Sandpipers;
  readonly sea: FishAndGulls;
  readonly turtles: Turtles;
  readonly dolphins: Dolphins;
  readonly crabs: Crabs;
  readonly hermits: HermitCrabs;
  readonly pelican: Pelican;
  readonly jellyfish: Jellyfish;
  readonly hatchlings: Hatchlings;
  readonly glow: Bioluminescence;
  readonly pools: TidePools;
  readonly air: BeachAir;
  readonly wrack: Wrack;
  readonly tracks: Tracks;
  readonly froth: Froth;
  readonly egret: Egret;
  readonly gulls: Gulls;
  readonly frigatebird: Frigatebird;
  readonly leapingFish: JumpingFish;
  readonly nightjars: Nightjars;
  readonly bats: Bats;
  readonly boats: Boats;
  readonly pelicanLine: PelicanLine;
  private readonly deps: LandscapeDeps;
  readonly stages = ['pelican', 'dolphins', 'egret', 'coconut', 'fisher', 'pelican-line', 'turtle'] as const;
  private readonly stealCooldown = new Cooldown(20, 60);
  private readonly followCooldown = new Cooldown(90, 240);
  private readonly flushCooldown = new Cooldown(12, 30);
  private scareTimer = 0;

  constructor(scene: BeachScene, deps: LandscapeDeps) {
    this.birds = new BirdSystem({
      ledges: scene.ledges,
      worldLayers: { far: scene.birdsFar, mid: scene.birdsMid, near: scene.birdsNear },
      nearLayer: deps.layers.near,
      sillLayer: deps.layers.sillFront,
      viewport: deps.viewport,
      birdseed: deps.birdseed,
      sound: deps.sound,
      canTap: deps.canTap,
      ecology: BEACH_ECOLOGY,
    });
    // The household dog, up at the window now and then.
    this.dog = new WindowDog(deps.sound, deps.canTap, (x) => this.birds.startleNear(x, 50));
    deps.layers.room.addChild(this.dog.container);
    this.sandpipers = new Sandpipers(scene, deps.viewport, deps.sound);
    this.sea = new FishAndGulls(scene, deps.viewport, deps.sound);
    this.turtles = new Turtles(scene, deps.viewport);
    this.dolphins = new Dolphins(scene, deps.viewport, deps.sound);
    this.crabs = new Crabs(scene);
    this.hermits = new HermitCrabs(scene);
    this.pelican = new Pelican(scene, this.sea, deps.viewport, deps.sound);
    this.jellyfish = new Jellyfish(scene);
    this.hatchlings = new Hatchlings(scene);
    this.glow = new Bioluminescence(scene);
    this.pools = new TidePools(scene, poolShapes());
    // On the sand, bottom to top: the strandline, the tracks, the froth (the blowing sand over them all).
    this.wrack = new Wrack(scene);
    this.tracks = new Tracks(scene);
    this.froth = new Froth(scene);
    this.egret = new Egret(scene, deps.viewport);
    this.gulls = new Gulls(scene, deps.viewport, deps.sound);
    this.frigatebird = new Frigatebird(scene, deps.viewport);
    this.leapingFish = new JumpingFish(scene, deps.viewport);
    // Over the dunes after dark: nightjars after moths, and a few bats.
    this.nightjars = new Nightjars(scene.birdsMid, { x0: 20, x1: 520, y0: 150, y1: 250 }, deps.viewport, deps.sound);
    this.boats = new Boats(scene, deps.viewport);
    this.bats = new Bats(scene.birdsMid, { x0: 0, x1: 560, y0: 140, y1: 240, size: [6, 9] }, 3);
    for (const walker of [this.sandpipers, this.turtles, this.crabs, this.hermits, this.hatchlings, this.egret, this.gulls]) walker.tracks = this.tracks;
    this.air = new BeachAir(scene, deps.viewport, deps.sound);
    this.pelicanLine = new PelicanLine(scene, deps.viewport);
    this.deps = deps;
    // A coconut thumps down: crabs nearby duck into their holes, hermits into their shells.
    this.air.onCoconut = (x, y) => {
      this.crabs.scare(x, y);
      this.hermits.scare(x, y, 50);
    };
    // Dolphins feeding out at sea: the fish leap, the gulls gather and wheel over them, one dives.
    this.dolphins.onSurface = (x, y) => {
      if (Math.random() < 0.7) this.gulls.wheelOver(x + 20, y - 6, 16 + Math.random() * 10);
      this.leapingFish.summon();
      if (Math.random() < 0.5) this.sea.summonHunter();
    };
    // A big wave lifts the gulls riding the swell.
    scene.on('break', ({ amplitude }) => {
      if (amplitude > 30) this.gulls.bigWave();
    });
  }

  get ambienceLevel(): number {
    return 0.5;
  }

  tap(screenX: number, screenY: number): boolean {
    if (this.birds.tap(screenX, screenY)) return true;
    if (!this.deps.canTap()) return false;
    const world = this.deps.viewport.screenToWorld(screenX, screenY);
    return this.hermits.tap(world.x, world.y) || this.crabs.scare(world.x, world.y);
  }

  startleAll(probability: number): void {
    this.birds.startleAll(probability);
  }

  startleNear(sillX: number, radius: number): void {
    this.birds.startleNear(sillX, radius);
  }

  thunder(distance: number): void {
    if (distance < 0.5) this.dog.spook();
  }

  stage(name: string): boolean {
    switch (name) {
      case 'pelican':
        this.pelican.summon();
        return true;
      case 'dolphins':
        this.dolphins.summon();
        return true;
      case 'egret':
        this.egret.summon();
        this.sandpipers.summon();
        this.crabs.summon(4);
        return true;
      case 'coconut':
        this.air.dropCoconut();
        this.crabs.summon(4);
        return true;
      case 'fisher':
        this.boats.summonFisher();
        return true;
      case 'pelican-line':
        this.pelicanLine.summon();
        return true;
      case 'turtle':
        this.turtles.summon();
        return true;
    }
    return false;
  }

  /** Who's noticed whom along the shore: the gull and the pelican's catch, the egret and the little things at its feet. */
  private interplay(dt: number): void {
    for (const c of [this.stealCooldown, this.followCooldown, this.flushCooldown]) c.tick(dt);

    // The pelican down on the water with its catch: a gull comes down right beside it, hoping, and the pelican shakes its pouch at it.
    const pel = this.pelican.floatingAt;
    if (pel && this.stealCooldown.maybe(dt * 0.8)) {
      const at = shoreCoords(pel.x + (Math.random() < 0.5 ? -1 : 1) * 14, pel.y);
      this.gulls.landAt(at.depth, at.s, 4 + Math.random() * 3);
      this.pelican.bothered();
    }

    // The fishing boat out: the gulls go off after it.
    const boat = this.boats.fisherAt;
    if (boat && this.followCooldown.maybe(dt * 0.1)) this.gulls.headFor(boat.x);

    this.scareTimer -= dt;
    if (this.scareTimer > 0) return;
    this.scareTimer = 0.3;
    // The egret stalking the shallows: crabs at its feet duck into their holes, and the sandpipers keep their distance.
    const egret = this.egret.spot;
    if (egret) {
      const p = shorePoint(egret.depth, egret.s);
      this.crabs.scare(p.x, p.y);
      const pipers = this.sandpipers.centre;
      if (pipers && Math.abs(pipers.depth - egret.depth) < 0.2 && this.flushCooldown.use()) this.sandpipers.flush();
    }
    // The turtle hauling itself up the beach: everything small gives it room.
    const turtle = this.turtles.spot;
    if (turtle) {
      const p = shorePoint(turtle.depth, turtle.s);
      this.crabs.scare(p.x, p.y);
      const pipers = this.sandpipers.centre;
      if (pipers && Math.abs(pipers.depth - turtle.depth) < 0.15 && Math.abs(pipers.s - turtle.s) < 40 && this.flushCooldown.use()) this.sandpipers.flush();
    }
  }

  update(dt: number, env: Environment, sill: SillBase): void {
    this.interplay(dt);
    this.pelicanLine.update(dt, env);
    const state = { ...sill, catX: null, catStalking: false };
    this.dog.update(dt, env, state, this.birds.sillBirds());
    const flyby = this.birds.nearFlights(state)[0];
    if (flyby !== undefined) this.dog.glance(flyby);
    this.birds.update(dt, env, state);
    this.sandpipers.update(dt, env);
    this.sea.update(dt, env);
    this.turtles.update(dt, env);
    this.dolphins.update(dt, env);
    this.crabs.update(dt, env);
    this.hermits.update(dt, env);
    this.pelican.update(dt, env);
    this.jellyfish.update(dt, env);
    this.hatchlings.update(dt, env);
    this.glow.update(env);
    this.pools.update(dt, env);
    this.egret.update(dt, env);
    this.gulls.update(dt, env);
    this.frigatebird.update(dt, env);
    this.leapingFish.update(dt, env);
    this.nightjars.update(dt, env);
    this.bats.update(dt, env);
    this.boats.update(dt, env);
    this.wrack.update(dt, env);
    this.tracks.update(dt, env);
    this.froth.update(dt, env);
    this.air.update(dt, env);
  }
}
