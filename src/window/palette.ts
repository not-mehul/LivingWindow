/** Shared colours for the interior (sash glass, bowl, plant, seed). */
export const GLASS = {
  tint: 0xbfe3ff,
  tintAlpha: 0.14,
  highlight: 0xffffff,
  highlightAlpha: 0.2,
  edgeShade: 0x1b2a3a,
  edgeShadeAlpha: 0.22,
} as const;

/** The seed dish: unglazed terracotta. */
export const CERAMIC = {
  outline: '#3a1a0e',
  shadow: '#7e3a1e',
  base: '#a8552e',
  light: '#c8744a',
  rim: '#df9a6c',
  shine: '#f0bc8e',
  chip: '#f6d4b0',
  inside: '#5a2814',
  insideDark: '#42200f',
  insideLight: '#743418',
} as const;

/** The potted plant on the sill. */
export const PLANT = {
  potOutline: '#3a1a0e',
  potShadow: '#7e3a1e',
  pot: '#a8552e',
  potLight: '#c8744a',
  potRim: '#df9a6c',
  soil: '#3a2616',
  leafOutline: '#1e2e14',
  leafDark: '#3e5a28',
  leaf: '#5a7a36',
  leafLight: '#7e9a4a',
  leafVein: '#a4b866',
} as const;

export const SEED = {
  dark: '#6b4a24',
  base: '#a77a3e',
  light: '#d8b06a',
  pale: '#efdcae',
} as const;

export interface WoodPalette {
  outline: string;
  shadow: string;
  dark: string;
  base: string;
  light: string;
  highlight: string;
  shine: string;
}

export interface WallPalette {
  base: string;
  light: string;
  dark: string;
  trim: string;
}

/** How the window and the room around it look: the wood, and the boarded wall round it. */
export interface FrameTheme {
  wood: WoodPalette;
  wall: WallPalette;
}

/** The window from the reference: oiled, weathered oak with iron fittings. */
export const RUSTIC_THEME: FrameTheme = {
  wood: {
    outline: '#24140b',
    shadow: '#4a2c18',
    dark: '#6a4225',
    base: '#8a5a33',
    light: '#a8743f',
    highlight: '#c4925a',
    shine: '#ddb47c',
  },
  wall: { base: '#6e4a2c', light: '#82593a', dark: '#563820', trim: '#3a2414' },
};

/** Iron hinges and handles. */
export const IRON = {
  outline: '#1a1a1e',
  dark: '#3a3a40',
  base: '#5e5e66',
  light: '#8a8a92',
  shine: '#b8b8c0',
} as const;
