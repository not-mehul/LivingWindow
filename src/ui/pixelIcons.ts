import { GLYPH_COLORS } from '../window/SillTablet';

/**
 * The panel's icons, drawn on a 12×12 pixel grid in the tablet sprite's
 * colours and turned into crisp inline SVG. `#` takes the text colour;
 * other letters are looked up in `PALETTE`, `.` is empty.
 */
const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
const PALETTE: Readonly<Record<string, string>> = {
  '#': 'currentColor',
  s: hex(GLYPH_COLORS.s),
  o: '#f0a030',
  c: hex(GLYPH_COLORS.c),
  m: hex(GLYPH_COLORS.m),
  d: '#a8b4c8',
  r: hex(GLYPH_COLORS.r),
  l: hex(GLYPH_COLORS.l),
  w: '#d8ecff',
};

export const ICON_ART: Readonly<Record<string, readonly string[]>> = {
  close: [
    '............',
    '.##......##.',
    '.###....###.',
    '..###..###..',
    '...######...',
    '....####....',
    '....####....',
    '...######...',
    '..###..###..',
    '.###....###.',
    '.##......##.',
    '............',
  ],
  play: [
    '............',
    '...#........',
    '...##.......',
    '...###......',
    '...####.....',
    '...#####....',
    '...#####....',
    '...####.....',
    '...###......',
    '...##.......',
    '...#........',
    '............',
  ],
  pause: [
    '............',
    '............',
    '...##..##...',
    '...##..##...',
    '...##..##...',
    '...##..##...',
    '...##..##...',
    '...##..##...',
    '...##..##...',
    '...##..##...',
    '............',
    '............',
  ],
  auto: [
    '...s........',
    '.s.s.s......',
    '..sss.......',
    'sssssss.....',
    '..ssscc.....',
    '.s.scccc....',
    '...ccccccc..',
    '.ccccccccc..',
    'ccccccccccc.',
    'ccccccccccc.',
    '.ddddddddd..',
    '............',
  ],
  clear: [
    '.....ss.....',
    '.s........s.',
    '..s.ssss.s..',
    '...ssssss...',
    '..ssssssso..',
    's.ssssssso.s',
    's.ssssssso.s',
    '..sssssooo..',
    '...ssoooo...',
    '..s.oooo.s..',
    '.s........s.',
    '.....ss.....',
  ],
  night: [
    '............',
    '....mmm.....',
    '...mmm......',
    '..mmm.......',
    '..mmm.....m.',
    '.mmmm.......',
    '.mmmm.......',
    '.mmmmm......',
    '..mmmmm..mm.',
    '..mmmmmmmm..',
    '....mmmmm...',
    '..m.........',
  ],
  overcast: [
    '............',
    '............',
    '.....ccc....',
    '....ccccc...',
    '..cccccccc..',
    '.cccccccccc.',
    'cccccccccccc',
    'cccccccccccc',
    '.dddddddddd.',
    '............',
    '............',
    '............',
  ],
  'light-rain': [
    '.....ccc....',
    '....ccccc...',
    '..cccccccc..',
    '.cccccccccc.',
    'cccccccccccc',
    '.dddddddddd.',
    '............',
    '..r...r...r.',
    '.r...r...r..',
    '............',
    '...r...r....',
    '..r...r.....',
  ],
  thunderstorm: [
    '.....ccc....',
    '....ccccc...',
    '..cccccccc..',
    '.cccccccccc.',
    'cccccccccccc',
    '.dddddddddd.',
    '.....ll.....',
    '....ll......',
    '...lllll....',
    '.....ll.....',
    '....ll......',
    '...l........',
  ],
  snow: [
    '.....ww.....',
    '...w.ww.w...',
    '....wwww....',
    '.w...ww...w.',
    '..w..ww..w..',
    'wwwwwwwwwwww',
    'wwwwwwwwwwww',
    '..w..ww..w..',
    '.w...ww...w.',
    '....wwww....',
    '...w.ww.w...',
    '.....ww.....',
  ],
};

/** An icon as inline SVG, `size` CSS pixels square (a multiple of 12 keeps it crisp). */
export function pixelIcon(name: string, size = 24): string {
  const rows = ICON_ART[name] ?? [];
  const rects: string[] = [];
  rows.forEach((row, y) => {
    // One rect per run of a colour along the row.
    for (let x = 0; x < row.length; ) {
      const ch = row[x];
      let end = x + 1;
      while (end < row.length && row[end] === ch) end++;
      const fill = PALETTE[ch];
      if (fill) rects.push(`<rect x="${x}" y="${y}" width="${end - x}" height="1" fill="${fill}"/>`);
      x = end;
    }
  });
  return `<svg class="px-icon" viewBox="0 0 12 12" width="${size}" height="${size}" shape-rendering="crispEdges" aria-hidden="true">${rects.join('')}</svg>`;
}
