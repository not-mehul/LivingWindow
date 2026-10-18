# Mobile testing checklist

Living Window is meant to run for hours on a phone or tablet propped up as an
ambient display. Automated checks run in Chromium with device emulation (see
below), but audio policies, the iOS silent switch and wake locks only behave
for real on real hardware. Run through this list on at least one iPhone/iPad
(Safari) and one Android device (Chrome) before a release.

Serve the build on your network first:

```sh
docker compose up -d --build     # or: npm run build && npm run preview
```

and open `http://<LAN-IP>:8080` on the device.

## First load

- [ ] The window appears within a few seconds and the panel is shown.
- [ ] On a phone in portrait, only the landscape chips and Time are expanded;
      the scene is visible below the panel.
- [ ] Nothing is audible yet (browsers block audio before a gesture) and there
      is no error.

## Audio unlock

- [ ] A **single tap** anywhere starts the ambience; there is no need to find a
      specific button.
- [ ] iOS: with the **silent switch on**, the sound still plays (the app asks
      for a `playback` audio session; iOS 17+).
- [ ] Turn the radio on, lock the screen, unlock: ambience and radio resume
      after returning to the tab (a tap may be needed on older iOS).
- [ ] Switch to another app and back: no stuck or doubled sounds.
- [ ] Opening/closing the window (tap the bottom rail of the sash) muffles and
      un-muffles the outside sound smoothly.

## Touch

- [ ] Swiping left/right on the scene looks around with momentum, and the page
      itself never scrolls or rubber-bands.
- [ ] Pinching does not zoom the page; double-tap does not zoom.
- [ ] Long-pressing the scene shows no "Save image" callout or text selection.
- [ ] Tapping a bird shoos it, tapping the cat pets it, tapping the bowl adds
      seed. Targets are easy to hit with a finger.
- [ ] The panel scrolls inside itself when it is taller than the screen
      (landscape phones) without scrolling the page.
- [ ] Sliders (time, volumes) can be dragged without the view panning.
- [ ] The panel hides after a few seconds and a tap brings it back.

## Orientation & sizes

- [ ] Rotating portrait ↔ landscape re-fits the frame without stretching or a
      blank band; the view stays roughly where it was.
- [ ] On a notched phone the frame isn't hidden under the notch or home bar.
- [ ] iPad split view / Android multi-window: the layout adapts.

## Long running

- [ ] Window → **Keep screen awake**: the screen stays on past the device's
      auto-lock time. After switching apps and returning, it is still active
      (the button label says so).
- [ ] After 30+ minutes the device is warm but not hot, and the frame rate is
      stable. On older devices, check that adaptive quality engaged
      (`?quality=low` forces it for comparison).
- [ ] Switching landscapes (chips) fades smoothly, including on a slow network
      (each landscape is loaded on first use).

## Home-screen install

- [ ] iOS Safari → Share → **Add to Home Screen**: the icon is the pixel
      window, and it opens fullscreen with no Safari bars.
- [ ] Android Chrome → **Install app / Add to Home screen**: same; the icon
      isn't clipped by the adaptive mask.

## Automated emulation (Chromium)

What was verified with Playwright's `iPhone 13` and `Pixel 7` profiles (touch
events sent through the DevTools protocol, with an `AudioContext` patched to
enforce gesture-only `resume()`, as iOS does):

| Check | Result |
| ----- | ------ |
| `(pointer: coarse)` detected, panel folds sections | ✅ (panel covers 39–50% of a portrait phone) |
| Audio `suspended` before, `running` after one tap | ✅ |
| Tap reveals the panel | ✅ |
| Touch-drag pans the view | ✅ |
| No page scroll, pinch leaves `visualViewport.scale` at 1 | ✅ |
| Rotation re-fits the canvas to the new viewport | ✅ |
| Manifest served and parsed (fullscreen, 3 icons) | ✅ |
| Wake-lock button shown where supported | ✅ |
| Async landscape switch, no console errors | ✅ |

Emulation cannot exercise WebKit's own audio policy, the silent switch, real
wake-lock behaviour, or thermal throttling. That is what the checklist above
is for.
