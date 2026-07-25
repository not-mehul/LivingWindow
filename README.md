# The Living Window

An open casement onto a small wild place. A generative art-and-sound piece:
five etched landscapes — meadow, forest, shore, wetland, city — that compose
themselves in the browser, inhabited by birds and beasts whose voices are
**synthesized in real time from a fresh seed**. No recordings, no loops; no two
sessions are alike. Everything runs locally — nothing is sent anywhere.

## Running it

Because the app is split into ES modules, it must be served over HTTP — opening
`index.html` directly from the filesystem (`file://`) will not load the modules.
Start any static server from the project root:

```bash
# Python 3
python3 -m http.server 8000

# …or Node
npx serve .
```

Then open <http://localhost:8000/>. The window starts shut: press **Begin
listening** and the casement swings open (a browser gesture is required to
start audio). Headphones are recommended, as each voice is placed spatially.

Closing the window again — the last button in the top-right of the frame —
swings the leaves shut, stops every voice and every animal, and ends the
session. Nothing is kept: opening it again draws a fresh seed and a new
serial. The piece is meant to be ephemeral, so there is no pause and no way
back to an hour you have closed.

Left to itself the light moves on: dawn gives way to day, dusk, night and
round again, an hour of the day every half hour. Both the turning and its
pace live under **The passing of time** in settings.

The shuffle button in the frame's top-right corner takes you somewhere
else entirely — a new place, a new hour, and freshly generated ground,
drawn from a new seed. The serial in the header follows it, since that
serial *is* the land you are looking at. Choosing a place by hand from
settings does not re-roll the seed, so a place you leave and come back to
during a session is exactly as you left it.

## Project layout

```
index.html        Markup and the window chrome; links the stylesheet and the entry module
bestiary.html     A developer tool, separate from the piece: every creature at close
                  range, with its animations, voice and field notes (see below).
css/styles.css    All styling. Every colour is a semantic CSS custom property — a raw
                  colour in a component rule is a bug.
js/
  util.js         Shared primitives: seeded PRNG, colour math, world constants, and the
                  single mutable `state` object.
  species.js      The voices and their marks: field-guide pictograms, the low-level synth
                  primitives, and the species catalogue (habitat, hour weighting, synth).
  scene.js        The `Scene` class — canvas rendering of the five landscapes and their
                  drifting inhabitants.
  audio.js        The `AudioEngine` class — wind, aeolian drift, per-place ambience,
                  turn-taking voices, and the odd church bell.
  main.js         Entry point: theme toggle, the casement (opening and shutting the
                  window), the turning of the hours, subtitles, and all DOM wiring.
                  Boots the scene and the audio engine.
  bestiary.js     Logic for the bestiary page. Borrows the Scene's painters and the
                  species' synths; adds nothing to the piece itself.
```

### A note on caching

There is no build step, so the stylesheet and every module carry an explicit
`?v=N` on their URLs — in `index.html`, `bestiary.html`, and on every `import`
inside `js/`. Browsers cache scripts and styles far more eagerly than markup,
and a cached script running against fresh markup fails in confusing ways (a
handler that binds to a control which no longer exists throws, and every
control wired after it silently stops working). **Bump the number everywhere
at once when shipping a change**; keeping them equal is what guarantees the
whole app is one version. As a second line of defence, `main.js` binds through
a small `on(id, …)` helper that warns about a missing control instead of
taking the rest of the page down with it.

### How the modules fit together

The dependency graph is acyclic:

```
util.js  ◄─────────────┐
   ▲                   │
   │                   │
species.js ◄──┐        │
   ▲          │        │
   │          │        │
scene.js   audio.js    │
   ▲          ▲        │
   └────┬─────┘        │
      main.js ─────────┘
```

`main.js` owns the concrete instances. Rather than reaching for globals, the
audio engine is **given** what it needs: `new AudioEngine({ scene, emit })`,
where `scene` is the live `Scene` and `emit` is the subtitle callback. This
keeps `audio.js` free of any direct dependency on the DOM or the canvas.

## The bestiary — a developer's field bench

Open <http://localhost:8000/bestiary.html> (from the same static server) for a
tool that sits apart from the piece itself: every animal and bird in the window
laid out as field-guide cards. Each card shows

- the creature **animated at close range**, with buttons to switch between its
  states (idle / sing / take off, walk / graze, drum, probe, blink, and so on);
- a **▶ voice** button that plays the species' call through the very same
  synth the window uses — freshly generated each press, never sampled;
- **when** it appears — its hour weighting across dawn, day, dusk and night;
- **where** it appears — its habitats, faded where it is rarer, plus a note on
  how it enters the scene (perched, afloat, crossing the sky, or voice-only).

The bestiary imports the live `Scene` painters and `SPECIES` catalogue, so it
can never drift out of date: what you inspect there is exactly what the window
draws and sings. It honours the same Dawn/Dusk themes and
`prefers-reduced-motion`.

## Design notes

- **Generative.** Every voice is built from oscillators and filtered noise via the
  Web Audio API — nothing is sampled. A session's seed drives both the landscape
  and its cast.
- **Faithful.** Each place keeps its own company; a species only sings where it
  would actually live (see `habitats` / `hw` in `species.js`).
- **Ephemeral.** There is no pause and no going back. A shut window keeps no
  time, holds no animals and makes no sound; opening it begins somewhere new.
- **Accessible.** Honours `prefers-reduced-motion` and `prefers-color-scheme`, and
  ships light ("Dawn") and dark ("Dusk") themes.
- **Private.** No dependencies, no build step, no network calls. Just static files.
