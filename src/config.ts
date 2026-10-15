/**
 * Global tuning constants for Living Window.
 *
 * World units are "native" pixel-art pixels. Every landscape is authored on a
 * single panoramic 21:9 canvas and scaled up with nearest-neighbour sampling.
 */

/** Native width of the panoramic world canvas, in art pixels. */
export const WORLD_WIDTH = 840;
/** Native height of the panoramic world canvas, in art pixels. */
export const WORLD_HEIGHT = 360;

/**
 * On displays wider than 21:9 (e.g. 32:9 super-ultrawides) the world is first
 * allowed to crop vertically, but never below this fraction of its height.
 * Beyond that the window is pillarboxed and the room's wall fills the sides.
 */
export const MIN_VISIBLE_HEIGHT_FRACTION = 0.8;

/**
 * Where vertical cropping is taken from: 0 = keep the top, 1 = keep the
 * bottom, 0.5 = crop evenly. Slightly favouring the lower half keeps the
 * street / shoreline / forest floor in view.
 */
export const VERTICAL_FOCUS = 0.55;

/** Seconds for the glass sash to slide open or shut (matches the audio filter sweep). */
export const WINDOW_TRANSITION_SECONDS = 0.6;

/** Milliseconds of inactivity before the overlay UI fades out. */
export const UI_HIDE_DELAY_MS = 3000;

/** Pointer travel (CSS px) before a press is treated as a pan instead of a tap. */
export const DRAG_THRESHOLD_PX = 6;

/**
 * Multiplier applied to the chance of a bird visiting the foreground sill
 * when the birdseed bowl is completely full. Partially filled bowls scale
 * between half of this boost and the full value.
 */
export const BIRDSEED_MAX_ATTRACTION = 6;

/**
 * Simulated seconds per real second. At 6× a full 24-hour day takes four
 * real hours and one simulated hour passes every ten real minutes.
 */
export const TIME_SCALE = 6;

/** Real seconds for the weather to blend into a newly chosen state. */
export const WEATHER_BLEND_SECONDS = 45;
/** Faster blend used when the user picks the weather by hand. */
export const WEATHER_MANUAL_BLEND_SECONDS = 6;

/** Low-pass cutoff (Hz) for the exterior audio while the window is open: effectively bypassed. */
export const WINDOW_OPEN_CUTOFF_HZ = 20000;
/** Low-pass cutoff (Hz) for the exterior audio once the window is shut. */
export const WINDOW_CLOSED_CUTOFF_HZ = 450;
/** Extra attenuation of exterior audio with the window shut, in dB. */
export const WINDOW_CLOSED_GAIN_DB = -8;
