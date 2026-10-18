import { describe, expect, it } from 'vitest';
import { MEADOW_HORIZON } from '../../sim/meadowGeometry';
import { carveMaze } from './farmstead';
import { generateMeadow } from './meadowGenerator';

describe('the farm', () => {
  it('cuts a maze you can walk all of from its gate', () => {
    const grid = carveMaze(6, 4, 99);
    expect(grid.length).toBe(9);
    expect(grid[0].length).toBe(13);
    const gate = grid[0].indexOf(true);
    expect(gate).toBeGreaterThan(0);
    const seen = new Set<string>();
    const queue: Array<[number, number]> = [[gate, 0]];
    while (queue.length) {
      const [x, y] = queue.pop()!;
      const key = `${x},${y}`;
      if (seen.has(key) || !grid[y]?.[x]) continue;
      seen.add(key);
      queue.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
    // Every cell's middle is reachable.
    for (let cy = 0; cy < 4; cy++) for (let cx = 0; cx < 6; cx++) expect(seen.has(`${2 * cx + 1},${2 * cy + 1}`)).toBe(true);
  });

  it('stands by the tree line behind the hen house, with its wind pump up against the sky', () => {
    const { farm, coop } = generateMeadow(6060, new Date(2026, 9, 18));
    expect(farm.windmill.y).toBeLessThan(MEADOW_HORIZON);
    expect(farm.windmill.baseY).toBeGreaterThan(MEADOW_HORIZON);
    expect(farm.windows.length).toBeGreaterThan(3);
    for (const w of farm.windows) expect(w.y).toBeLessThan(coop.baseY);
    expect(farm.chimney.y).toBeLessThan(farm.windows[0].y);
    expect(farm.scarecrow.baseY).toBeGreaterThan(farm.patch.y0 - 1);
    expect(farm.scarecrow.baseY).toBeLessThan(farm.patch.y1 + 1);
  });

  it('follows the season: bales on the stubble after the harvest', () => {
    const july = generateMeadow(6060, new Date(2026, 6, 25));
    const august = generateMeadow(6060, new Date(2026, 7, 25));
    expect(july.farm.crops.wheat.stage).toBe('ripe');
    expect(august.farm.crops.wheat.stage).toBe('stubble');
    expect(august.standing.length).toBeGreaterThan(july.standing.length);
  });
});
