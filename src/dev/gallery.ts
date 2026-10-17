import type { Drawn } from '../sprites/kit';
import { drawPerson, randomLook, type PersonFacing, type PersonPose } from '../sprites/people';
import type { PixelGrid } from '../sprites/raster';
import { drawBird, SPECIES, type SpeciesId } from '../sprites/birdSprites';
import { DOLPHIN_FRAMES, drawDolphinSized, drawTurtleSized } from '../sprites/beachSprites';
import { drawDeerSized, drawSquirrelSized, type DeerKind, type DeerPose, type SquirrelPose } from '../sprites/forestSprites';
import { drawChickenSized, drawCowSized, drawRabbitSized, drawTopFishSized, type ChickenCoat, type CowCoat, type CowPose, type RabbitPose } from '../sprites/meadowSprites';
import { drawStallLightsSized, drawStallSized, STALL_LIGHT_PALETTE, type StallKind } from '../sprites/streetSprites';

/**
 * A dev page (open the app with `#gallery`) that lays out every procedural
 * sprite at the sizes and poses it's drawn in, magnified, on light and dark
 * grounds, for reviewing the pixel art side by side.
 */

interface Item {
  label: string;
  draw: () => Drawn | { grid: PixelGrid; colors: readonly number[] };
}

interface Section {
  title: string;
  rows: Item[][];
}

function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sections(): Section[] {
  const out: Section[] = [];
  // People: one look per row at every size, then poses at a near size.
  const people: Item[][] = [];
  const looks = Array.from({ length: 6 }, (_, i) => randomLook(seeded(i * 7919 + 101)));
  for (const look of looks.slice(0, 3)) {
    people.push([4, 6, 8, 10, 12, 14, 16, 20, 24, 28, 32, 40].map((h) => ({ label: `${h}`, draw: () => drawPerson(look, 'front', 'walk', 0, false, h) })));
  }
  const poses: Array<[PersonFacing, PersonPose, number, boolean]> = [];
  for (const facing of ['front', 'back', 'side'] as const) for (let f = 0; f < 4; f++) poses.push([facing, 'walk', f, false]);
  for (const facing of ['front', 'back', 'side'] as const) poses.push([facing, 'stand', 0, false], [facing, 'browse', 0, false], [facing, 'walk', 0, true]);
  for (const look of looks) {
    for (const h of [30, 16]) people.push(poses.map(([facing, pose, f, umbrella]) => ({ label: `${facing[0]}${pose[0]}${f}${umbrella ? 'u' : ''}`, draw: () => drawPerson(look, facing, pose, f, umbrella, h) })));
  }
  out.push({ title: 'People', rows: people });

  const stalls: Item[][] = [];
  for (const kind of ['fruit', 'flowers', 'cart', 'noodles', 'lanterns', 'trinkets'] as StallKind[]) {
    const row: Item[] = [6, 10, 14, 18, 24, 30, 38].map((h) => ({ label: `${kind} ${h}`, draw: () => drawStallSized(kind, 3, h) }));
    for (let stage = 0; stage < 3; stage++) row.push({ label: `stage ${stage}`, draw: () => drawStallSized(kind, stage, 30) });
    const lights = drawStallLightsSized(kind, 38);
    if (lights) row.push({ label: 'lights', draw: () => ({ grid: lights, colors: STALL_LIGHT_PALETTE }) });
    stalls.push(row);
  }
  out.push({ title: 'Stalls', rows: stalls });

  const cows: Item[][] = [];
  const cowPoses: CowPose[] = ['walk-1', 'walk-2', 'walk-3', 'walk-4', 'graze-1', 'graze-2', 'stand', 'lie'];
  for (const coat of ['holstein', 'jersey', 'brown'] as CowCoat[]) {
    cows.push([10, 14, 18, 24, 30, 40, 58].map((h) => ({ label: `${coat} ${h}`, draw: () => drawCowSized(coat, 'stand', h) })));
    cows.push(cowPoses.map((pose) => ({ label: pose, draw: () => drawCowSized(coat, pose, 40) })));
  }
  out.push({ title: 'Cows', rows: cows });

  const hens: Item[][] = [];
  for (const coat of ['white', 'brown', 'black'] as ChickenCoat[]) {
    const row: Item[] = [6, 8, 10, 12, 14, 18, 22].map((h) => ({ label: `${h}`, draw: () => drawChickenSized(coat, 'stand', h) }));
    for (const pose of ['peck', 'walk', 'walk-2', 'scratch', 'flap'] as const) row.push({ label: pose, draw: () => drawChickenSized(coat, pose, 20) });
    hens.push(row);
  }
  out.push({ title: 'Hens', rows: hens });

  const rabbitPoses: RabbitPose[] = ['sit', 'alert', 'groom', 'hop-1', 'hop-2', 'hop-3', 'peek'];
  out.push({
    title: 'Rabbits',
    rows: [
      [6, 8, 10, 12, 14, 16, 20].map((h) => ({ label: `${h}`, draw: () => drawRabbitSized('sit', h) })),
      rabbitPoses.map((pose) => ({ label: pose, draw: () => drawRabbitSized(pose, 16) })),
      rabbitPoses.map((pose) => ({ label: pose, draw: () => drawRabbitSized(pose, 10) })),
    ],
  });

  const deer: Item[][] = [];
  const deerPoses: DeerPose[] = ['walk-1', 'walk-2', 'walk-3', 'walk-4', 'graze-1', 'graze-2', 'alert', 'bound-1', 'bound-2'];
  for (const kind of ['doe', 'buck', 'fawn', 'roe', 'elk'] as DeerKind[]) {
    deer.push([8, 12, 16, 22, 30, 40, 48].map((h) => ({ label: `${kind} ${h}`, draw: () => drawDeerSized(kind, 'walk-1', h) })));
    if (kind === 'doe' || kind === 'buck') deer.push(deerPoses.map((pose) => ({ label: pose, draw: () => drawDeerSized(kind, pose, 40) })));
  }
  out.push({ title: 'Deer', rows: deer });

  const squirrelPoses: SquirrelPose[] = ['run-1', 'run-2', 'sit', 'nibble', 'climb-1', 'climb-2', 'cling'];
  out.push({
    title: 'Squirrels',
    rows: [
      ...[6, 8, 10, 13].map((size) => squirrelPoses.map((pose) => ({ label: `${pose} ${size}`, draw: () => drawSquirrelSized('red', pose, size) }))),
      squirrelPoses.map((pose) => ({ label: pose, draw: () => drawSquirrelSized('red', pose, 22) })),
      squirrelPoses.map((pose) => ({ label: pose, draw: () => drawSquirrelSized('grey', pose, 22) })),
    ],
  });

  const birds: Item[][] = [];
  for (const species of ['sparrow', 'pigeon', 'crow', 'robin', 'jay', 'seagull', 'sandpiper', 'bluebird'] as SpeciesId[]) {
    const row: Item[] = [];
    for (const size of [6, 8, 9, 12, 16]) {
      for (const pose of ['idle', 'peck-down', 'fly-mid'] as const) row.push({ label: `${size}${pose[0]}`, draw: () => ({ grid: drawBird(species, pose, size), colors: SPECIES[species].palette }) });
    }
    birds.push(row);
  }
  out.push({ title: 'Small birds', rows: birds });

  out.push({
    title: 'Sea turtles and dolphins',
    rows: [
      [8, 12, 16, 20, 28, 36, 54].map((w) => ({ label: `${w}`, draw: () => drawTurtleSized(1, w) })),
      ([0, 1, 2] as const).map((f) => ({ label: `crawl ${f}`, draw: () => drawTurtleSized(f, 40) })),
      Array.from({ length: DOLPHIN_FRAMES }, (_, f) => ({ label: `breach ${f}`, draw: () => drawDolphinSized(f) })),
      Array.from({ length: DOLPHIN_FRAMES }, (_, f) => ({ label: `breach ${f}`, draw: () => drawDolphinSized(f, 28) })),
    ],
  });

  out.push({
    title: 'Creek fish',
    rows: (['trout', 'minnow'] as const).map((kind) => Array.from({ length: 16 }, (_, h) => ({ label: `${h}`, draw: () => drawTopFishSized(kind, h, (h % 2) as 0 | 1) }))),
  });
  return out;
}

function render(item: Item, scale: number, dark: boolean): HTMLElement {
  const drawn = item.draw();
  const colors = 'palette' in drawn ? drawn.palette.colors : drawn.colors;
  const { grid } = drawn;
  const canvas = document.createElement('canvas');
  canvas.width = grid.width;
  canvas.height = grid.height;
  const ctx = canvas.getContext('2d');
  if (ctx) ctx.putImageData(new ImageData(grid.toRGBA(colors) as Uint8ClampedArray<ArrayBuffer>, grid.width, grid.height), 0, 0);
  canvas.style.cssText = `width:${grid.width * scale}px;height:${grid.height * scale}px;image-rendering:pixelated;background:${dark ? '#1c2230' : '#c8b898'}`;
  const cell = document.createElement('figure');
  cell.style.cssText = 'margin:0 6px 8px 0;display:inline-flex;flex-direction:column;align-items:center;vertical-align:bottom';
  const caption = document.createElement('figcaption');
  caption.textContent = item.label;
  caption.style.cssText = 'font:10px monospace;color:#8a8a8a';
  cell.append(canvas, caption);
  return cell;
}

export function showGallery(): void {
  const params = new URLSearchParams(location.hash.split('?')[1] ?? '');
  const scale = Number(params.get('scale') ?? 3);
  const only = params.get('only');
  document.body.style.cssText = 'position:static;margin:0;padding:16px;background:#0e1018;color:#e8e0d0;overflow:visible;height:auto';
  document.documentElement.style.cssText = 'overflow:auto;height:auto';
  const root = document.getElementById('app') ?? document.body;
  root.style.cssText = 'position:static;width:auto;height:auto';
  for (const section of sections()) {
    if (only && !section.title.toLowerCase().includes(only.toLowerCase())) continue;
    const h = document.createElement('h2');
    h.textContent = section.title;
    h.style.cssText = 'font:bold 14px monospace;margin:12px 0 6px';
    root.append(h);
    for (const row of section.rows) {
      for (const dark of [false, true]) {
        const line = document.createElement('div');
        line.style.cssText = 'display:flex;align-items:flex-end;flex-wrap:wrap';
        for (const item of row) line.append(render(item, scale, dark));
        root.append(line);
      }
    }
  }
  document.body.dataset.gallery = 'ready';
}
