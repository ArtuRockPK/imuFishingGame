# Game architecture (pixel-art canvas game, plain JS)

## Contents
1. File layout
2. Main loop and state machine
3. Rendering: low-res scene + crisp text
4. Sprites and procedural pixel art
5. Day/night lighting
6. Sound
7. Internationalisation
8. Overlays and menus
9. Mini-game design patterns
10. Testing in a browser without hardware

## 1. File layout

Every file is a classic `<script>` (no modules, no build), loaded in dependency order;
each file starts with a comment block explaining what it does and how to extend it — this
is what lets a non-programmer (or the next AI session) add features safely.

```
index.html     stage (#game canvas, #hud canvas, gear button), shared overlay card, scripts
style.css      pixel fonts (Press Start 2P + DotGothic16 for CJK), overlay, gear
js/config.js   ALL tunable numbers grouped by feature (AIM, FISH, BALANCE, WOOD, CAMPFIRE…), EV ids
js/i18n.js     LANGUAGES, STRINGS, T()
js/render.js   canvases, fitCanvas, rect/px/line/curve/sprite/text
js/sprites.js  string-art sprites + palettes
js/sound.js    WebAudio beep / noiseHit / sfx.* presets
js/controller.js  BLE + keyboard input → onControllerEvent
js/setup.js    calibration overlay
js/settings.js gear + settings
js/stick.js    device-independent controller state (still, flat, reelDir)
js/game.js     game object, setState, onControllerEvent, update
js/states.js   STATES table — the main place for new mechanics
js/<feature>.js  one file per mini-game / subsystem (balance.js, wood.js, campfire.js …)
js/draw.js     draw(t, dt): scene per state + HUD
js/menu.js     language → firmware → difficulty → connect screens
js/main.js     requestAnimationFrame loop
README.md      table "file → responsibility", how to add a state / string / setting
```

Keep magic numbers in `config.js` with a comment each; mini-game feel is tuned there.

## 2. Main loop and state machine

```js
function frame(ms) {
  const dt = Math.min(0.05, ms / 1000 - last);   // clamp: no jump after a tab switch
  last = ms / 1000; now += dt;
  if (game.state !== 'wait' && !paused) update(dt);
  draw(now, paused ? 0 : dt);
  requestAnimationFrame(frame);
}
```

States are plain objects; all members optional:

```js
const STATES = {
  aimX: {
    hint: () => aimHint('hint_aim_x'),    // top-of-screen hint, translated
    alert: true,                          // blink the hint
    enter() {}, exit() {},                // e.g. setReel(true/false)
    onEvent(id, code) { if (isAimPick(id)) { game.targetX = game.markerX; setState('aimY'); } },
    update(dt, t) { game.markerX = lerp(xMin, xMax, pingPong(t, sweepSec)); },  // t = time in state
  },
};
function setState(s) { STATES[game.state]?.exit?.(); game.state = s; game.stateTime = 0; STATES[s]?.enter?.(); }
```

A bigger activity (campfire: chop → split → kindle by blowing → cook) is one state with an
internal `phase` field, routed inside its own file (`campfireEvent`, `updateCampfire`,
`drawCampfireScene`). Debounce gesture input per phase (e.g. ignore HIGH_G for 0.6 s after a
phase starts and for `axeTime` after each swing) so one jerk doesn't count twice.

## 3. Rendering: low-res scene + crisp text

- Scene canvas 320×180, scaled by an **integer** factor with
  `image-rendering: pixelated` → crisp pixels.
- Second canvas (`hud`) on top at real screen resolution × devicePixelRatio, with
  `setTransform(scale*dpr, …)` so it uses the same 320×180 coordinates. Text drawn there is
  sharp in any language; the scene stays chunky.
- Text in the scene is UPPERCASE (8-bit style) with a 1-px shadow; preload the CJK font when
  zh/ja is selected.
- HUD elements that may or may not exist (battery shown only with a BLE controller) shift
  the others via a helper (`hudShift()`), instead of hard-coded y's.

## 4. Sprites and procedural pixel art

- **String sprites**: rows of characters + a palette; `.` is transparent. Easy to edit by
  hand and to recolour (lost worm = black palette).

```js
const FLOAT = ['.r.', 'rrr', '.w.'];  const FLOAT_PAL = { r: '#e03020', w: '#fcfcfc' };
sprite(FLOAT, FLOAT_PAL, x, y, maxRows, flip, scale);
```

- **Offscreen canvas sprites** for larger or rotated objects (axe, logs, cooked fish): draw
  once into a small canvas, then `drawImage` with `imageSmoothingEnabled = false`. Rotate
  around a named pivot (e.g. `AXE_GRIP`) with translate/rotate; a flip flag mirrors it.
  Cache scaled variants (`drawFishScaled` keeps one canvas per type/scale).
- **Procedural detail** precomputed once (tree-cut rings, ash, stone ring sorted by depth for
  correct overlap) so frames stay cheap.
- Effects (splashes, sparks, ripples, floating "+1") are small particle arrays updated in
  `update` and drawn in `draw`.
- When the user sends a reference image, match its *composition and palette* in pixel art
  (e.g. stone ring + teepee of logs + layered flame) rather than tracing it.

## 5. Day/night lighting

Draw the scene as daytime with a transparent sky, then `lightScene()` recolours pixels for
the time of day (warmer at dawn/dusk, darker/bluer at night, a light pool around a lantern,
a sun/moon path on water), then draw the sky behind it. A game clock runs at a per-day-part
speed; `onDayPart('night', fn)` and `atHour(h, fn)` hooks trigger events (e.g. the campfire
activity at night). Reading back the canvas needs `getContext('2d', {willReadFrequently:true})`.

## 6. Sound

No audio files: WebAudio oscillators and filtered noise.

```js
beep(freq, dur, { type: 'square', vol: 0.06, slide: 0, delay: 0 });
noiseHit(dur, { type: 'bandpass', freq: 1000, freq2: 0, q: 1, vol: 0.1 });
const sfx = { lock() { beep(880, .06); }, bite() {...}, chop() { noiseHit(.08, {freq: 600}); } };
```

Create/resume the `AudioContext` on the first user click (autoplay policy). Ambient loops
(birds, crickets, mosquito buzz with stereo pan) are toggled with a key.

## 7. Internationalisation

```js
const LANGUAGES = [{ id: 'en', name: 'English' }, { id: 'ru', name: 'Русский' }, …];
const STRINGS = { msg_escaped: { en: 'IT GOT AWAY!', ru: 'СОРВАЛАСЬ!', zh: '…', ja: '…' } };
function T(key, vars) { /* current lang → fallback en; replace {name} */ }
// at load: console.warn for every missing translation
```

- Never write user-visible text inline — always `T('key')`. A new string = all languages at
  once.
- Language is the first screen; saved in `localStorage`; sets `<html lang>` (CSS can then
  enlarge CJK text with `:lang(zh)`).
- Overlay paragraphs use `white-space: pre-line` so `\n\n` in a string works.
- Check connotations per language (see SKILL.md rule about "чурка" → "полено").

## 8. Overlays and menus

One shared overlay card (`showOverlay(title, text, buttons, status, isErr)`) is reused by
menus, pause, calibration and settings — consistent look, one place to style. Start flow:
language → "update your controller firmware" (links per model) → difficulty → connect
(BLE / keyboard). Back buttons go to the previous screen.

## 9. Mini-game design patterns

All of these map noisy physical input onto something a player can read.

**Timing zone (chop the log).** An object slides at a speed that grows each round
(`logSpeed + round*logSpeedUp`); a green zone is marked; a jerk (HIGH_G) inside the zone
succeeds. Make the zone generous (~22 px on a 320 px screen), show it clearly, give a short
pause between rounds, and play a distinct hit/miss sound.

**Oscillating marker (split the block).** A marker ping-pongs across the target; a jerk when
it is within tolerance of the centre splits it. Speed rises per success. Show where the blow
landed on a miss.

**Balance with inertia (hold the fish).** A marker is pushed by a random "fish force" that
changes target every 0.35–1.1 s; spinning CW pushes it right, CCW left; the marker has
velocity (inertia) so it overshoots believably. A timer advances only while in the green
zone (faster in the centre); reaching an edge fails. Make the visual alive: the fish darts
(random offsets eased toward targets), changes depth (scale 5 → 2.2 and alpha/shadow offset),
ripples when surfacing.

**Speedometer (turn the spit).** Required spin speed window, e.g. 0.8–3.0 rev/s.
- Show a dial: red (too slow) / green / blue (too fast) arcs, ticks, a target triangle, a
  needle smoothed toward the measured speed (`needle += (speed − needle)·min(1, dt·2.5)`).
- Grace period (1.5 s) at the start.
- Separate "too slow" and "too fast" reserves (4 s / 3.5 s) that fill while outside the
  window and recover at 1.5× while inside; fail only when one fills → "burnt" or "raw".
  Show a danger bar and a hint ("FASTER!" / "SLOWER!") once a reserve passes ~40 %.
- On failure animate the result (the fish falls into the fire, sparks), then continue with
  the next item (next fish from the catch) instead of ending the activity.

**Blow to kindle.** Turn the mic on in the phase's enter; BLOW strength raises the fire level;
level decays over time; done at 100 %.

General: every mini-game has a hint line, an obvious success/fail message, sound, and a
keyboard equivalent that can hit the target exactly (for testing).

## 10. Testing in a browser without hardware

- Serve the folder locally (`python -m http.server 8765` from `web/`) and open
  `http://localhost:8765/<game>/index.html`; choose keyboard mode.
- After editing, bypass the cache: `await fetch(file, {cache: 'reload'})` for changed files,
  then `location.reload()`.
- Deterministic stepping from the console/automation: set `paused = true` (the rAF loop then
  skips `update`) and drive time yourself:

```js
function step(n) { for (let i = 0; i < n; i++) { now += 1/60; update(1/60); } }
setState('campfire'); onControllerEvent(EV.HIGH_G); step(30); draw(now, 1/60); // draw needs t
```

- To look at a frame, copy both canvases into an `<img>` overlay (`canvas.toDataURL()`) and
  screenshot that; it avoids cropping/scaling surprises.
- Watch the console: missing translations and unknown events are logged there.
