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

export const CERAMIC = {
  outline: '#22303c',
  shadow: '#3f6278',
  base: '#5f8fa8',
  light: '#86b6c9',
  rim: '#c9e4ec',
  inside: '#2c3f4f',
} as const;

export const SEED = {
  dark: '#6b4a24',
  base: '#a77a3e',
  light: '#d8b06a',
  pale: '#efdcae',
} as const;
