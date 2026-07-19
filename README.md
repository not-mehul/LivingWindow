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

Then open <http://localhost:8000/>. Sound begins when you press **Begin
listening** (a browser gesture is required to start audio); headphones are
recommended, as each voice is placed spatially.

## Project layout

```
index.html        Markup and the window chrome; links the stylesheet and the entry module
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
  main.js         Entry point: theme toggle, subtitles / field notes, and all DOM wiring.
                  Boots the scene and the audio engine.
```

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

## Design notes

- **Generative.** Every voice is built from oscillators and filtered noise via the
  Web Audio API — nothing is sampled. A session's seed drives both the landscape
  and its cast.
- **Faithful.** Each place keeps its own company; a species only sings where it
  would actually live (see `habitats` / `hw` in `species.js`).
- **Accessible.** Honours `prefers-reduced-motion` and `prefers-color-scheme`, and
  ships light ("Dawn") and dark ("Dusk") themes.
- **Private.** No dependencies, no build step, no network calls. Just static files.
