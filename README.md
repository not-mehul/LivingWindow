# Living Window

A self-hosted, browser-based ambient simulation: a pixel-art window looking out
onto living, non-repeating worlds. See
[`living_window_project_design_document.md`](./living_window_project_design_document.md)
for the full vision and roadmap.

## Status

**Step 1 — Project scaffolding & responsive window frame** ✅

- Vite + TypeScript + PixiJS v8 project.
- Responsive viewport manager for the 840×360 panoramic (21:9) world:
  - **16:9**: the central 640×360 is shown; drag / scroll / arrow keys to look around.
  - **21:9 ultrawide**: the whole panorama is visible.
  - **32:9 super-ultrawide**: crops up to 20% vertically, then pillarboxes with the room's wall.
  - **Portrait mobile**: fits the height and touch-drags horizontally, with inertia.
  - The world renders at native resolution into an off-screen texture, then scales
    up with nearest-neighbour sampling, so every entity sits on a true pixel grid.
- Screen-space window frame (nine-slice), windowsill and interior wall, pinned to
  the viewport edges at an integer device-pixel scale so they stay crisp.
- **Open / close window**: the glass sash slides shut over 0.6 s (the same
  duration as the future audio low-pass sweep). Click its bottom rail, press
  `W`, or use the overlay.
- **Birdseed bowl** on the sill: click it (or press `B`) to fill it. Its state
  exposes `consume()` and an `attraction` multiplier for the birds in Step 4.
- Auto-hiding pixel-art overlay UI (fades after 3 s of inactivity, along with the cursor).
- A procedural placeholder city skyline stands in for the real scene art (Step 4).

**Step 2 — Chronos clock & weather engine** ✅

- **Simulated clock** running at 6× (a full day every 4 real hours, one
  simulated hour every 10 real minutes), starting from your local time. Pause
  it, scrub it with the slider or `[` / `]`, or jump to Dawn, Morning, Midday,
  Golden Hour, Dusk, Night or 2–4 AM; it carries on from wherever you leave it.
- **Lighting**: a 24-hour palette of keyframes drives a dithered pixel sky,
  sun and moon arcs with glows, twinkling stars and tinted clouds. Every
  scene layer is authored in daylight and multiplied by an ambient tint, with
  extra haze on distant layers. The room itself picks up daylight by day and a
  warm lamp glow at night.
- **Emissive layers**: city windows switch on and off one by one following a
  daily schedule (busy evenings, an almost dark 2–4 AM), and streetlamps
  flicker on individually at dusk.
- **Weather engine**: a Markov chain moves between Clear, Overcast, Light Rain,
  Thunderstorm and Snow on simulated time, while simplex noise drives gusts,
  downpour swells and lightning bursts so nothing repeats. Pick the weather by
  hand to lock it, or choose Auto to hand it back.
- **Weather rendering**: rain streaks that follow the wind and snowflakes that
  sway, in two depth layers (behind and in front of the nearest towers), with
  splashes on the street. Lightning flashes the world and the room, with
  pixel bolts for nearby strikes.
- **Rain on the glass** when the window is closed: drops land, merge, grow
  into runners that slide down, swallowing others and leaving bead trails,
  then dry off after the rain. Snowflakes stick and melt.

## Getting started

Requires Node.js 22.12 or newer.

```sh
npm install
npm run dev        # http://localhost:8080 (also reachable from your LAN)
```

| Command             | What it does                                |
| ------------------- | ------------------------------------------- |
| `npm run dev`       | Start the Vite dev server                   |
| `npm run build`     | Type-check and build the static site to `dist/` |
| `npm run preview`   | Serve the production build                  |
| `npm test`          | Run the unit tests (Vitest)                 |
| `npm run typecheck` | Type-check only                             |

### Controls

| Input                          | Action                |
| ------------------------------ | --------------------- |
| Drag / swipe, scroll, `←` `→`  | Look around (when the view is cropped) |
| Click the sash's bottom rail, `W` | Open / close the window |
| Click the bowl, `B`            | Add birdseed          |
| `Space`                        | Pause / resume time   |
| `[` `]`                        | Scrub time ∓30 minutes |
| `F`                            | Toggle fullscreen     |

## Project layout

```
src/
  config.ts                 Tuning constants (world size, timings, time scale)
  main.ts                   Bootstraps PixiJS and wires everything together
  core/
    viewportLayout.ts       Pure screen → world mapping math (unit tested)
    Viewport.ts             Off-screen world render target, panning & inertia
    input.ts                Pointer / wheel / keyboard input
    pixelTexture.ts         Helpers for drawing pixel art into crisp textures
    simplex.ts              Seedable 2D simplex noise
    Emitter.ts, math.ts, random.ts, color.ts
  state/
    WindowState.ts          Open/closed window model + transition events
    BirdseedState.ts        Seed level, depletion and bird attraction
    Clock.ts, timeOfDay.ts  Simulated clock, day phases and presets
    Weather.ts              Markov + noise weather engine, lightning events
  window/
    WindowFrame.ts          Wall, nine-slice frame and windowsill
    WindowSash.ts           Sliding glass pane (with a glass layer for rain, Step 2)
    BirdseedBowl.ts         Interactive bowl on the sill
  scene/
    WorldScene.ts           Contract every landscape implements
    Environment.ts          Per-frame lighting + weather passed to scenes
    lighting.ts             Time-of-day / weather lighting model (unit tested)
    sky/Sky.ts              Gradient, stars, sun, moon, clouds
    city/                   Placeholder city: generator, window lights, lamps
    weather/                Rain/snow particles, lightning, rain on the glass
  ui/
    Overlay.ts              Auto-hiding control panel
```

### Hooks for upcoming steps

- `WindowState` emits `toggle` (with its duration) and `settled`, ready for the
  audio low-pass filter (Step 3).
- `Weather` emits `lightning` with an `intensity` and `distance`, for thunder
  timing and volume (Step 3); `weather.snapshot` exposes live rain, wind and
  cloud values for the ambience mix.
- New scenes implement `WorldScene` and get the sky, lighting, precipitation,
  lightning and rain-on-glass for free (Steps 4–5).
- `Viewport.world` is where scene layers go, in native world pixels;
  `Viewport.worldXToStereo()` maps a world x to a stereo pan for spatial audio.
- The `sill-layer` container (in `main.ts`) holds z = 0 foreground entities.
  `BirdseedBowl.perchPoint` and `BirdseedState.attraction` feed the bird FSM (Step 4).
