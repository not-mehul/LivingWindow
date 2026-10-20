import { Container, Sprite, type Texture } from 'pixi.js';
import { mood } from '../../state/mood';
import { lerpColor } from '../../core/color';
import { PixelBuffer } from '../../core/pixelBuffer';
import type { Lighting } from '../lighting';
import { glowTexture } from '../common/glow';
import { ADS, drawAd } from './ads';
import type { Billboard } from './cityGenerator';
import { clamp01 } from '../../core/math';

/** How much slower ads cycle in calm mode. */
const CALM_AD_PACE = 2.5;

interface Screen {
  board: Billboard;
  sprite: Sprite;
  glow: Sprite;
  frames: Array<Texture | undefined>;
  frame: number;
  timer: number;
  /** A brief brown-out now and then. */
  dip: number;
}

/**
 * The city's screens: each plays its ad's frames on its own rhythm, washed
 * out in daylight and blazing after dark, throwing a soft glow of its
 * colours on what's round it.
 */
export class Billboards {
  /** One container per layer, to slot in just after that layer's art. */
  readonly layers = { far: new Container(), mid: new Container(), near: new Container(), over: new Container() };
  private readonly screens: Screen[] = [];

  constructor(boards: readonly Billboard[], rng: () => number) {
    for (const board of boards) {
      const sprite = new Sprite();
      sprite.position.set(board.x, board.y);
      const spec = ADS[board.ad];
      const r = Math.max(board.w, board.h) * 0.75 + 6;
      const glow = new Sprite({ texture: glowTexture(Math.min(60, r), spec.glow, Math.min(1, Math.max(0.35, board.h / board.w)), false), blendMode: 'add', anchor: 0.5 });
      glow.position.set(board.x + board.w / 2, board.y + board.h / 2);
      glow.scale.set(r / Math.min(60, r));
      glow.visible = false;
      const layer = this.layers[board.band];
      layer.addChild(glow, sprite);
      this.screens.push({ board, sprite, glow, frames: [], frame: Math.floor(rng() * spec.frames), timer: rng() * 2, dip: 0 });
    }
    for (const s of this.screens) s.sprite.texture = this.texture(s, s.frame);
  }

  update(dt: number, lighting: Lighting, tints: Record<'far' | 'mid' | 'near' | 'over', number>): void {
    // Screens run brighter than the day around them, and blaze at night.
    const lit = clamp01((lighting.emissive - 0.15) / 0.7);
    for (const s of this.screens) {
      const spec = ADS[s.board.ad];
      s.timer -= dt;
      if (s.timer <= 0) {
        s.frame = (s.frame + 1) % spec.frames;
        // Calm mode: the ads play slower, so nothing flashes.
        const pace = mood.calm ? CALM_AD_PACE : 1;
        s.timer += spec.frameSeconds(s.frame) * pace;
        if (s.timer < 0) s.timer = spec.frameSeconds(s.frame) * pace;
        s.sprite.texture = this.texture(s, s.frame);
      }
      if (s.dip > 0) s.dip -= dt;
      else if (!mood.calm && Math.random() < dt * 0.015) s.dip = 0.05 + Math.random() * 0.15;
      const flick = s.dip > 0 ? 0.6 : 1;
      const day = lerpColor(tints[s.board.band], 0xffffff, 0.35);
      s.sprite.tint = lerpColor(day, 0xffffff, lit * flick);
      s.glow.visible = lit > 0.02;
      s.glow.alpha = lit * (mood.calm ? 0.38 : 0.55) * flick;
    }
  }

  private texture(s: Screen, frame: number): Texture {
    let t = s.frames[frame];
    if (t) return t;
    const { board } = s;
    const art = drawAd(board.ad, frame, board.artW, board.artH, board.flaw, board.seed);
    const out = new PixelBuffer(board.w, board.h);
    const src = art.data;
    for (let i = 0; i < board.map.length; i++) {
      const a = board.map[i];
      if (a < 0) continue;
      const k = a * 4;
      out.set(i % board.w, Math.floor(i / board.w), (src[k] << 16) | (src[k + 1] << 8) | src[k + 2]);
    }
    t = out.toTexture();
    s.frames[frame] = t;
    return t;
  }
}
