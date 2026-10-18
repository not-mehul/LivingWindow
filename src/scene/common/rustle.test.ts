import { Texture, TextureSource } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { PixelBuffer } from '../../core/pixelBuffer';
import { rustleFrames } from './rustle';
import { SwayMesh } from './SwayMesh';

describe('leaf rustle', () => {
  const LEAF = [0x40a040, 0x60c060];
  const BARK = 0x6a4a30;
  const art = new PixelBuffer(30, 30);
  for (let y = 0; y < 30; y++) for (let x = 0; x < 30; x++) art.set(x, y, x < 8 ? BARK : (x + y) % 3 ? LEAF[0] : LEAF[1]);

  it('stirs the leaves in every frame but leaves the bark alone', () => {
    const frames = rustleFrames(art, 4, 7, (c) => LEAF.includes(c));
    expect(frames).toHaveLength(4);
    expect(frames[0]).toBe(art);
    for (const f of frames.slice(1)) {
      let changed = 0;
      for (let y = 0; y < 30; y++) {
        for (let x = 0; x < 30; x++) {
          if (x < 8) expect(f.get(x, y)).toBe(BARK);
          else if (f.get(x, y) !== art.get(x, y)) changed++;
        }
      }
      expect(changed).toBeGreaterThan(10);
    }
  });
});

describe('swaying perches', () => {
  it('report where a point on the art has moved to', () => {
    const texture = new Texture({ source: new TextureSource({ width: 40, height: 90 }) });
    const sway = new SwayMesh(texture, { anchor: 'bottom', amplitude: 6, phase: 1 });
    sway.update(2, 0.8);
    const top = sway.offsetAt(20, 0);
    const root = sway.offsetAt(20, 90);
    expect(Math.abs(top.x)).toBeGreaterThan(0.5);
    expect(Math.abs(root.x)).toBeLessThan(0.05);
    const bough = new SwayMesh(new Texture({ source: new TextureSource({ width: 120, height: 30 }) }), { anchor: 'right', amplitude: 4, phase: 1 });
    bough.update(2, 0.8);
    // A bough bobs: its free tip moves up or down, its trunk end stays.
    expect(Math.abs(bough.offsetAt(0, 10).y)).toBeGreaterThan(Math.abs(bough.offsetAt(118, 10).y));
  });
});
