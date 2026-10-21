import { describe, expect, it } from 'vitest';
import { createRng } from '../../core/random';
import { Carriageway, drawLoco, drawTransitArt, drawVehicle, drawWagon, FreightLine, trainLength, TRANSIT_X0, TRANSIT_X1 } from './DistantTransit';

describe('distant super highway', () => {
  it('keeps traffic flowing one way, in order, without vehicles running into each other', () => {
    for (const dir of [1, -1] as const) {
      const lane = new Carriageway(dir, createRng(3));
      for (let t = 0; t < 120; t += 1 / 30) {
        lane.update(1 / 30, 1);
        for (let i = 1; i < lane.vehicles.length; i++) {
          const ahead = lane.vehicles[i - 1];
          const v = lane.vehicles[i];
          expect((ahead.x - v.x) * dir, 'order and gap').toBeGreaterThanOrEqual(ahead.length);
        }
        for (const v of lane.vehicles) {
          expect(v.x).toBeGreaterThanOrEqual(TRANSIT_X0 - 12);
          expect(v.x).toBeLessThanOrEqual(TRANSIT_X1 + 12);
        }
      }
    }
  });

  it('is busy at rush hour and a trickle in the small hours', () => {
    const count = (busy: number) => {
      const lane = new Carriageway(1, createRng(9));
      let total = 0;
      for (let t = 0; t < 300; t += 0.1) {
        lane.update(0.1, busy);
        if (t > 60) total += lane.vehicles.length;
      }
      return total;
    };
    expect(count(1)).toBeGreaterThan(count(0.08) * 3);
  });

  it('moves fast: a car crosses the view in seconds', () => {
    const lane = new Carriageway(1, createRng(5));
    const v = lane.vehicles[lane.vehicles.length - 1];
    const x0 = v.x;
    lane.update(1, 0);
    // Unless it's held up behind another, it has gone at least 46 px in a second.
    expect(v.x - x0).toBeGreaterThan(0);
    expect(Math.max(...lane.vehicles.map((u) => u.speed))).toBeGreaterThanOrEqual(46);
  });
});

describe('freight line', () => {
  it('sends a train through only now and then, and it passes right across', () => {
    const line = new FreightLine(createRng(11));
    let trains = 0;
    let busySeconds = 0;
    let previous: unknown = null;
    for (let t = 0; t < 3600; t += 0.5) {
      line.update(0.5);
      if (line.train && line.train !== previous) trains++;
      if (line.train) busySeconds += 0.5;
      previous = line.train;
    }
    // Every few minutes, each one taking well under a minute to pass.
    expect(trains).toBeGreaterThanOrEqual(10);
    expect(trains).toBeLessThanOrEqual(40);
    expect(busySeconds / trains).toBeLessThan(60);
    expect(busySeconds / 3600).toBeLessThan(0.5);
  });

  it('makes long, mixed trains', () => {
    const line = new FreightLine(createRng(2));
    const train = line.dispatch();
    expect(train.wagons.length).toBeGreaterThanOrEqual(16);
    expect(new Set(train.wagons.map((w) => w.kind)).size).toBeGreaterThan(1);
    expect(trainLength(train)).toBeGreaterThan(150);
  });
});

describe('transit drawing', () => {
  it('draws the deck, lamps and viaduct, and every vehicle and wagon', () => {
    const { art, lamps } = drawTransitArt();
    expect(art.width).toBe(TRANSIT_X1 - TRANSIT_X0);
    const ink = (p: { data: Uint8ClampedArray }) => p.data.some((v, i) => i % 4 === 3 && v > 0);
    expect(ink(art) && ink(lamps)).toBe(true);
    for (const kind of ['car', 'van', 'truck'] as const) {
      const { body, lights } = drawVehicle(kind, 0x3c5a88);
      expect(ink(body) && ink(lights)).toBe(true);
    }
    for (const kind of ['container', 'tank', 'hopper', 'flat'] as const) expect(ink(drawWagon(kind, 0xa0442e))).toBe(true);
    expect(ink(drawLoco().body)).toBe(true);
  });
});
