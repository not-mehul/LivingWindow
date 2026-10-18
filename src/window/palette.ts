/** Shared colours for the interior (frame, sill, sash, bowl, wall). */
export const WOOD = {
  outline: '#2a1a12',
  shadow: '#4a2e1f',
  dark: '#5e3b27',
  base: '#7a4e32',
  light: '#9a6842',
  highlight: '#c08a58',
  shine: '#dcae78',
} as const;

export const WALL = {
  base: '#3b3044',
  light: '#463a52',
  dark: '#30273a',
  trim: '#251d2e',
} as const;

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

/** The linen curtain. */
export const LINEN = {
  outline: '#5a4a3c',
  shadow: '#9a8a76',
  dark: '#b8a890',
  base: '#d4c6ae',
  light: '#e6dac4',
  highlight: '#f2ead8',
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

/** How the window and the room around it look in each landscape. */
export interface FrameTheme {
  id: string;
  wood: WoodPalette;
  wall: WallPalette;
  wallPattern: 'plaster' | 'logs' | 'boards';
  /** Colour of bare wood showing through chipped paint, if painted. */
  chipped?: string;
}

export const CITY_THEME: FrameTheme = { id: 'apartment', wood: WOOD, wall: WALL, wallPattern: 'plaster' };

export const CABIN_THEME: FrameTheme = {
  id: 'cabin',
  wood: {
    outline: '#1a100a',
    shadow: '#3a2414',
    dark: '#4a2e1a',
    base: '#6a4226',
    light: '#84552f',
    highlight: '#9e6a3c',
    shine: '#b88050',
  },
  wall: { base: '#5a3a24', light: '#6a462c', dark: '#3e2818', trim: '#2a1a10' },
  wallPattern: 'logs',
};

export const BEACH_THEME: FrameTheme = {
  id: 'beach-house',
  wood: {
    outline: '#3a4652',
    shadow: '#7a8a96',
    dark: '#98a8b2',
    base: '#c4d0d6',
    light: '#dce4e8',
    highlight: '#eef2f4',
    shine: '#ffffff',
  },
  wall: { base: '#6a8a9e', light: '#7a9aae', dark: '#56768a', trim: '#3e5a6a' },
  wallPattern: 'boards',
  chipped: '#9a7a5a',
};

export const FARMHOUSE_THEME: FrameTheme = {
  id: 'farmhouse',
  wood: {
    outline: '#243024',
    shadow: '#3e5038',
    dark: '#4e6448',
    base: '#6a8460',
    light: '#809a74',
    highlight: '#98b28a',
    shine: '#b4c8a4',
  },
  wall: { base: '#cbbc9c', light: '#d8caac', dark: '#b4a484', trim: '#8a7a5e' },
  wallPattern: 'plaster',
  chipped: '#8a6a4a',
};

/** The window from the reference: oiled, weathered oak with iron fittings. */
export const RUSTIC_THEME: FrameTheme = {
  id: 'rustic',
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
  wallPattern: 'boards',
};

/** Iron hinges and handles. */
export const IRON = {
  outline: '#1a1a1e',
  dark: '#3a3a40',
  base: '#5e5e66',
  light: '#8a8a92',
  shine: '#b8b8c0',
} as const;
