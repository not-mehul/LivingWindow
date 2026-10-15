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
| `F`                            | Toggle fullscreen     |

## Project layout

```
src/
  config.ts                 Tuning constants (world size, timings, crop limits)
  main.ts                   Bootstraps PixiJS and wires everything together
  core/
    viewportLayout.ts       Pure screen → world mapping math (unit tested)
    Viewport.ts             Off-screen world render target, panning & inertia
    input.ts                Pointer / wheel / keyboard input
    pixelTexture.ts         Helpers for drawing pixel art into crisp textures
    Emitter.ts, math.ts, random.ts
  state/
    WindowState.ts          Open/closed window model + transition events
    BirdseedState.ts        Seed level, depletion and bird attraction
  window/
    WindowFrame.ts          Wall, nine-slice frame and windowsill
    WindowSash.ts           Sliding glass pane (with a glass layer for rain, Step 2)
    BirdseedBowl.ts         Interactive bowl on the sill
  scene/
    PlaceholderCityScene.ts Procedural stand-in skyline
  ui/
    Overlay.ts              Auto-hiding control panel
```

### Hooks for upcoming steps

- `WindowState` emits `toggle` (with its duration) and `settled`, ready for the
  audio low-pass filter (Step 3) and rain-on-glass (Step 2).
- `WindowSash.glassLayer` is a masked container on the pane for droplets and snow.
- `Viewport.world` is where scene layers go, in native world pixels;
  `Viewport.worldXToStereo()` maps a world x to a stereo pan for spatial audio.
- The `sill-layer` container (in `main.ts`) holds z = 0 foreground entities.
  `BirdseedBowl.perchPoint` and `BirdseedState.attraction` feed the bird FSM (Step 4).
