import type { LandscapeDeps, SceneLife, SillBase } from '../landscapes/types';
import type { CityScene } from '../scene/city/CityScene';
import type { Environment } from '../scene/Environment';
import type { BirdSystem } from './BirdSystem';
import { makeBirds } from './common/windowLife';
import { Fireworks } from './city/Fireworks';
import { Performers } from './city/Performers';
import { Rooftops } from './city/Rooftops';
import { SkyTraffic } from './city/SkyTraffic';
import { StreetPigeons } from './city/StreetPigeons';
import { chance } from '../sim/interplay';
import { Traffic } from './city/Traffic';
import { RooftopCat } from './RooftopCat';
import { StreetLife } from './StreetLife';
import type { SillState } from './types';

/**
 * Everything alive in the downtown scene: birds, people, stalls and the cat;
 * riders, the sweeper, the noodle cart and taxis in the street; life on the
 * rooftops; traffic in the sky; the busker; and fireworks on some nights.
 */
export class CityLife implements SceneLife {
  readonly birds: BirdSystem;
  readonly street: StreetLife;
  readonly cat: RooftopCat;
  readonly traffic: Traffic;
  readonly rooftops: Rooftops;
  readonly sky: SkyTraffic;
  readonly fireworks: Fireworks;
  readonly performers: Performers;
  readonly pigeons: StreetPigeons;
  readonly stages = ['fireworks', 'taxi', 'busker', 'pigeons', 'washing', 'searchlight'] as const;
  private readonly scene: CityScene;
  /** Someone who's hailed the taxi: who, and how long they've waited at the kerb since it pulled in. */
  private fare: { id: number; depth: number; boarding: number } | null = null;
  /** Passers-by the busker has already had a chance with. */
  private readonly passed = new Set<number>();
  private lookTimer = 0;

  constructor(scene: CityScene, deps: LandscapeDeps) {
    this.scene = scene;
    this.birds = makeBirds(scene, scene.city.ledges, deps);
    this.street = new StreetLife({
      doors: scene.city.doors,
      stallSpots: scene.city.stallSpots,
      laneHalf: scene.laneHalf,
      project: scene.project,
      lightAt: (gx, depth) => scene.lightAt(gx, depth),
    });
    scene.stallLight = (i) => this.street.stallLit(i);
    scene.street.addChild(this.street.container);
    scene.streetLights.addChild(this.street.lightsContainer);
    const tintAt = (gx: number, depth: number) => this.street.tintAt(gx, depth);
    const pan = (x: number) => deps.viewport.worldXToStereo(x);
    this.traffic = new Traffic({ container: this.street.container, lights: scene.streetLights, laneHalf: scene.laneHalf, project: scene.project, tintAt });
    this.performers = new Performers({
      container: this.street.container,
      lights: scene.streetLights,
      project: scene.project,
      tintAt,
      openStalls: () => this.street.openStalls(),
      sound: deps.sound,
      pan,
    });
    this.rooftops = new Rooftops({ summonPigeons: (x, y, n) => void this.birds.summonToPerchNear(x, y, 'pigeon', n), dronePad: scene.city.dronePad });
    scene.roofLife.addChild(this.rooftops.container);
    this.sky = new SkyTraffic();
    this.fireworks = new Fireworks(deps.sound, pan);
    scene.skyLife.addChild(this.sky.container, this.fireworks.container);
    scene.birdsMid.addChild(this.sky.nearContainer);
    this.cat = new RooftopCat(deps.sound, deps.canTap);
    deps.layers.sillBack.addChild(this.cat.container);
    this.pigeons = new StreetPigeons({ container: this.street.container, project: scene.project, tintAt, sound: deps.sound, pan });
    // Each burst: people in the street stop and look up, and so do the busker's crowd.
    this.fireworks.onBurst = () => {
      this.street.lookUp(0.3, [3, 7]);
      this.performers.lookUp(5);
    };
  }

  thunder(distance: number): void {
    // Indoors too: a crack overhead and the cat's off the sill.
    if (distance < 0.5) this.cat.startle();
  }

  stage(name: string): boolean {
    switch (name) {
      case 'fireworks':
        this.fireworks.summon(40);
        return true;
      case 'taxi':
        this.traffic.summon('taxi');
        return true;
      case 'busker':
        this.performers.summon();
        return true;
      case 'pigeons':
        this.pigeons.summon();
        return true;
      case 'washing':
        return this.rooftops.garden.rescueWashing();
      case 'searchlight':
        this.sky.summon('helicopter');
        return true;
    }
    return false;
  }

  /** Who's noticed what: the taxi and its fare, the busker and the passers-by, the searchlight overhead. */
  private interplay(dt: number, env: Environment): void {
    const walkers = this.street.walkers();
    const project = this.scene.project;

    // A taxi coming: someone at the kerb ahead of it hails it, it pulls in, they get in and it's off.
    const taxi = this.traffic.freeTaxi;
    if (taxi && !this.fare && chance(3, dt)) {
      const dir = Math.sign(taxi.speed);
      // Someone a little way up the street from it (the taxi creeps along: half a block is a good ten seconds).
      const hailer = walkers.find((w) => !w.busy && (w.depth - taxi.depth) * dir > 0.3 && (w.depth - taxi.depth) * dir < 0.9 && w.depth > 1.3 && w.depth < 6);
      if (hailer && this.traffic.hail(hailer.depth)) {
        this.street.moment(hailer.id, 'hail', 30, 'side', hailer.gx > 0 ? -1 : 1);
        this.fare = { id: hailer.id, depth: hailer.depth, boarding: 0 };
      }
    }
    if (this.fare) {
      const waiting = this.traffic.taxiWaiting;
      if (waiting !== null && Math.abs(waiting - this.fare.depth) < 0.3) {
        this.fare.boarding += dt;
        // A moment to open the door and get in.
        if (this.fare.boarding > 1.2) {
          this.street.take(this.fare.id);
          this.fare = null;
        }
      } else if (!walkers.some((w) => w.id === this.fare?.id) || (!this.traffic.freeTaxi && waiting === null && !this.traffic.traffic().some((v) => v.kind === 'taxi'))) this.fare = null;
    }

    // The busker: some passers-by stop to listen, others drop a coin as they pass.
    if (this.performers.isPlaying) {
      const pitch = this.performers.pitch;
      for (const w of walkers) {
        if (w.busy || this.passed.has(w.id)) continue;
        if (Math.abs(w.gx - pitch.gx) > 60 || Math.abs(w.depth - pitch.depth) > 0.12) continue;
        this.passed.add(w.id);
        const roll = Math.random();
        if (roll < 0.12 && this.performers.addListener(w.look)) this.street.take(w.id);
        else if (roll < 0.26) {
          this.street.moment(w.id, 'crouch', 0.8, 'side', pitch.gx > w.gx ? 1 : -1);
          this.performers.tossFrom(w.gx, w.depth);
        }
      }
      if (this.passed.size > 200) this.passed.clear();
    }

    // The helicopter's searchlight sweeping the street: those it passes over glance up.
    this.lookTimer -= dt;
    if (this.lookTimer <= 0) {
      this.lookTimer = 0.4;
      const ground = project(0, 2.5).y;
      const foot = this.sky.searchlightAt(ground);
      if (foot !== null) {
        for (const w of walkers) {
          if (w.busy || Math.random() > 0.3) continue;
          if (Math.abs(project(w.gx, w.depth).x - foot) < 16) this.street.moment(w.id, 'look-up', 1.2 + Math.random() * 1.4, 'front');
        }
      }
    }

    // Pigeons on the pavement by the food stalls; crows at dawn where the night market was.
    const open = this.street.openStalls();
    const threats = [
      ...walkers.map((w) => ({ gx: w.gx, depth: w.depth, speed: w.heading })),
      ...this.traffic.traffic().map((v) => ({ gx: v.gx, depth: v.depth, speed: v.stopped ? 0 : v.speed, big: v.kind === 'sweeper' || v.kind === 'cart' || v.kind === 'taxi' })),
    ];
    const packedUp = this.scene.city.stallSpots.filter((s) => s.shift === 'night' && !open.some((o) => Math.abs(o.depth - s.depth) < 0.01 && Math.sign(o.gx) === Math.sign(s.gx)));
    // Near enough to see them bob about: the stalls on the first stretch of the street.
    this.pigeons.update(dt, env, threats, open.filter((o) => o.depth < 2.8), packedUp.filter((o) => o.depth < 2.8));
  }

  get ambienceLevel(): number {
    return this.street.crowdLevel;
  }

  tap(screenX: number, screenY: number): boolean {
    return this.birds.tap(screenX, screenY);
  }

  startleAll(probability: number): void {
    this.birds.startleAll(probability);
  }

  startleNear(sillX: number, radius: number): void {
    this.birds.startleNear(sillX, radius);
  }

  update(dt: number, env: Environment, sill: SillBase): void {
    const state: SillState = { ...sill, catX: this.cat.position, catStalking: this.cat.isStalking };
    this.cat.update(dt, env, state, this.birds.sillBirds());
    this.birds.update(dt, env, { ...state, catX: this.cat.position, catStalking: this.cat.isStalking });
    // A bird flashing past the window: the cat on the sill turns and chatters at it.
    const flyby = this.birds.nearFlights(state)[0];
    if (flyby !== undefined) this.cat.watchBird(flyby);
    this.street.update(dt, env);
    this.traffic.update(dt, env);
    this.performers.update(dt, env);
    this.interplay(dt, env);
    this.rooftops.update(dt, env);
    this.sky.update(dt, env);
    this.fireworks.update(dt, env);
  }
}
