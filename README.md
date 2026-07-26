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
  main.js         Entry point: theme toggle, subtitles / field notes, and all DOM wiring.
                  Boots the scene and the audio engine.
  bestiary.js     Logic for the bestiary page. Borrows the Scene's painters and the
                  species' synths; adds nothing to the piece itself.
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

## Behaviour worth knowing about

- **Song posts are held.** An arriving bird takes a perch nobody is already
  sitting on (`Scene.pickPerch`), and a bird that sings again from the post it
  already holds is the same bird, not a second one drawn on top of the first.
- **Counter-singing.** Neighbouring territory-holders answer each other across a
  boundary: one sings, the other replies from its own post the moment the first
  falls quiet, and the turns tighten as the exchange goes on. Which species do
  this, and how readily, is `COUNTERSING` in `species.js`; the exchange itself is
  `AudioEngine.answer`.
- **Ground birds have somewhere to be.** A bird that comes down to a stone or a
  tussock takes a few steps — hopping or walking according to its species — has
  a look round, and works the turf for food before flying off.
- **Nothing dissolves in place.** Every visitor leaves by doing something: the
  owl tips off the branch and rows away, the pheasant walks out of frame or goes
  up like a firework, the kingfisher drops into the water, the cockerel sinks
  back behind the hill it came over.

## Design notes

- **Generative.** Every voice is built from oscillators and filtered noise via the
  Web Audio API — nothing is sampled. A session's seed drives both the landscape
  and its cast.
- **Faithful.** Each place keeps its own company; a species only sings where it
  would actually live (see `habitats` / `hw` in `species.js`). The same applies to
  behaviour: the fox's mousing pounce, the heron's strike, the squirrel caching a
  nut and the cuckoo's drooped-wing calling posture are all drawn from life.
- **Cheap to run.** A phrase costs two audio nodes, not two per note
  (`noteTrain` / `pulseTrain` in `species.js`), every voice's signal chain is
  unwired from the graph once it has decayed, and the canvas holds to a pixel
  budget with an adaptive render scale, so full screen on a dense display stays
  smooth.
- **Accessible.** Honours `prefers-reduced-motion` and `prefers-color-scheme`, and
  ships light ("Dawn") and dark ("Dusk") themes.
- **Private.** No dependencies, no build step, no network calls. Just static files.
