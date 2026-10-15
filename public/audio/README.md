# Audio assets

Living Window synthesizes every sound in the browser, so it works with this
folder empty. To use real recordings instead, drop files in here and list them
in `manifest.json` (paths are relative to the site root, e.g. `audio/rain.ogg`).
Anything listed replaces its synthesized version; anything left out keeps the synth.

```json
{
  "sounds": {
    "sparrow-chirp": ["audio/birds/sparrow-1.ogg", "audio/birds/sparrow-2.ogg"],
    "pigeon-coo": ["audio/birds/pigeon-1.ogg"],
    "crow-caw": [],
    "wing-flap": [],
    "glass-tap": [],
    "seed-pour": [],
    "window-slide": [],
    "window-thunk": [],
    "car-horn": []
  },
  "beds": {
    "rain": "audio/ambience/rain-loop.ogg",
    "wind": "audio/ambience/wind-loop.ogg",
    "city": "audio/ambience/city-loop.ogg",
    "meadows": "audio/ambience/stream-loop.ogg",
    "beach": "audio/ambience/surf-loop.ogg",
    "forest": "audio/ambience/forest-wind-loop.ogg"
  },
  "thunder": ["audio/weather/thunder-1.ogg"],
  "radio": {
    "playlist": ["audio/radio/track-1.mp3"],
    "stream": "https://example.com/lofi.mp3"
  }
}
```

- **Sound ids**: `sparrow-chirp`, `pigeon-coo`, `crow-caw`, `woodpecker-drum`,
  `jay-call`, `chickadee-call`, `finch-song`, `bluebird-song`, `robin-song`,
  `gull-cry`, `sandpiper-peep`, `owl-hoot`, `eagle-cry`, `wing-flap`,
  `glass-tap`, `seed-pour`, `window-slide`, `window-thunk`, `car-horn`,
  `cat-meow`, `cat-purr`, `squirrel-chatter`, `deer-snort`, `cow-moo`,
  `chicken-cluck`, `splash`.
- **One-shots** with several variants are picked at random, and every play
  still gets the ±8% pitch / ±15% gain variation.
- **Beds** should loop seamlessly; levels follow the weather and time of day.
- **Radio**: a `stream` (Icecast/Shoutcast URL) takes priority over the
  `playlist`; with neither, the built-in generative station plays. Listeners
  can also paste a stream URL into the overlay. Streams served without CORS
  headers still play, but skip the radio's warm EQ.

Good sources: [Xeno-canto](https://xeno-canto.org) for bird calls and
[Freesound](https://freesound.org) for ambience (check each file's licence).
