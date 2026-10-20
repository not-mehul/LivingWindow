/**
 * The window's mood, read live by scenes and creatures. Set from the
 * viewer's preferences (see main.ts); calm by default.
 */
export const mood = {
  /** Calm mode: fewer visitors, softer city lights and effects, gentler storms. */
  calm: true,
};

/** How much longer the gaps between foreground visitors (dog, cat, squirrel) are in calm mode. */
export function visitGapScale(): number {
  return mood.calm ? 2.5 : 1;
}

/** How much less often birds come down to the sill in calm mode. */
export function sillBirdScale(): number {
  return mood.calm ? 0.45 : 1;
}
