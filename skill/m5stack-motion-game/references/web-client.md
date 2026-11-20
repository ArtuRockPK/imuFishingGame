# Browser side: connection, input, calibration, settings

Plain JavaScript files loaded in order by `index.html` (no bundler — easy for anyone to edit
and to host on GitHub Pages). Web Bluetooth works in Chrome/Edge on desktop and Android,
**only over HTTPS or localhost**, and `requestDevice` must be called from a user click.
Safari/iOS and Firefox have no Web Bluetooth — that's what the keyboard mode is for.

## Connect

```js
device = await navigator.bluetooth.requestDevice({
  filters: [{ services: [BLE_SERVICE_UUID] }],
  optionalServices: ['battery_service'],
});
device.addEventListener('gattserverdisconnected', onDisconnected);
const server = await device.gatt.connect();
const svc = await server.getPrimaryService(BLE_SERVICE_UUID);
const evt = await svc.getCharacteristic(BLE_EVENT_UUID);
evt.addEventListener('characteristicvaluechanged', onBleEvent);
await evt.startNotifications();
try { cmdChar = await svc.getCharacteristic(BLE_CMD_UUID); } catch { cmdChar = null; } // old firmware
try { /* battery_service → battery_level: read once + notifications */ } catch {}      // optional
```

Keep `device` after a disconnect so "Reconnect" doesn't open the chooser again
(`device.gatt.connect()` on the same object). On disconnect: pause the game, show an overlay
with a Reconnect button, cancel calibration if it was running, close the settings window.

## Parse

```js
function onBleEvent(e) {
  const dv = e.target.value;
  const id = dv.getUint8(0), code = dv.byteLength > 1 ? dv.getUint8(1) : 0;
  const aux = dv.byteLength > 3 ? dv.getUint8(3) : 0;
  if (id === 0xFF) { stick.flat = code === 1; return; }          // state packet
  if (setupActive()) { setupEvent(id, code, aux); return; }     // calibration eats events
  if (id === EV.REEL) stick.reelDir = code ? reelDirection(aux) : 0;
  onControllerEvent(id, code);                                   // the single game entry point
}
```

`onControllerEvent(id, code)` first updates device-independent state (`stick.still`,
`stick.flat`, last motion time), then forwards to the current state's `onEvent`. Return early
while the settings window is open.

## Commands

Serialise writes through one promise chain; a concurrent GATT write throws.

```js
let cmdQueue = Promise.resolve();
function sendCmd(byte) {
  if (inputMode !== 'ble' || !cmdChar) return;
  const ch = cmdChar;
  cmdQueue = cmdQueue.then(() => ch.writeValueWithoutResponse(Uint8Array.of(byte)))
                     .catch(err => console.warn('cmd failed', err));
}
const setReel = on => sendCmd(on ? 1 : 0), setMic = on => sendCmd(on ? 3 : 2);
```

Turn the reel/mic on in a state's `enter()` and off in its `exit()` so they never stay on.

## Keyboard mode

Chosen on the connect screen ("Play with keyboard"). Map every event to a key and route it
through the same `onControllerEvent`, so the game can't tell the difference.

| Key | Event | Note |
|---|---|---|
| Space | TAP2 | `preventDefault` so the page doesn't scroll |
| A | BTN | |
| H / Enter | HIGH_G | |
| L | LOW_G | |
| N / M | NO_MOT / ANY_MOT | |
| O | ORIENT | |
| F | FLAT toggle | |
| R / E / T (held) | REEL fast CW / fast CCW / slow CW | send speed×10 on keydown, `0` on keyup; set `stick.reelDir` ±1 |
| B (held) | BLOW 120, then 0 on keyup | |

Context-dependent speeds help test mini-games (e.g. R gives exactly the in-zone speed at the
campfire). Ignore `e.repeat`. Debug keys that also work with a controller: G toggle debug
overlay, J skip an hour of game time, V mute ambience.

## Calibration ("setup") with gesture videos

Runs after the first connect of a device (and on demand, and after a settings change that
affects gestures). One overlay step per gesture:

```js
const SETUP_STEPS = [
  { id: 'hold',      clip: 'hold' },                    // just show; "Next" button
  { id: 'doubletap', clip: 'doubletap', ev: EV.TAP2 },
  { id: 'jerk',      clip: 'jerk',      ev: EV.HIGH_G },
  { id: 'drop',      clip: 'drop',      ev: EV.LOW_G },
  { id: 'laydown',   clip: 'laydown',   ev: EV.NO_MOT },  // or FLAT code 1, whichever first
  { id: 'reel_cw',   clip: 'reel_cw',   reel: true },     // learn "clockwise"
  { id: 'reel_ccw',  clip: 'reel_ccw',  reel: true },     // learn "counter-clockwise"
];
```

- Each step shows a looping muted `<video autoplay loop muted playsinline>` of the gesture,
  a title, a short text, "Skip" and "Skip setup". On the first step add a note that the video
  shows just one way to hold the controller.
- Event steps: when the expected event arrives → green "✓ Got it!", a sound, next step after
  ~0.9 s. Events never reach the game during setup.
- Reel steps: turn the reel on, show a progress bar. Collect ≥ 45 REEL packets with bit 6
  (~4.5 s of spinning) and vote on `aux & 0x83`; accept if one key has ≥ 70 % of the votes,
  otherwise "spin steadily in one direction" and restart. CCW must differ from CW ("you're
  spinning the same way"). If ~50 spinning packets arrive with < 3 known directions, the
  firmware can't tell direction → mark unsupported, skip reel steps.
- Save `{cw, ccw}` in `localStorage['<game>.setup.' + device.name]`; save even if skipped so
  the player isn't asked every time. Read back with:

```js
function reelDirection(aux) {
  if (!(aux & 0x40) || !saved || saved.cw == null) return 0;
  const k = aux & 0x83;
  if (k === saved.cw) return 1;
  if (k === saved.ccw || k === (saved.cw ^ 0x80)) return -1;
  return 0;
}
```

- Device-specific clips: `media/gestures/<device-type>/<clip>.mp4`, chosen by device name,
  with an `onerror` fallback to the generic clip. Keep clips small (a few seconds, ~720p,
  H.264, no audio) and git-ignore raw footage.
- Steps can depend on settings: e.g. if the player picks spots with a button, replace the
  double-tap step with a "press the button" step (no clip → hide the video).

## In-game settings (gear icon)

- A pixel-art gear `<button>` (inline SVG, `shape-rendering="crispEdges"`) in a corner of the
  stage, visible only while playing and no overlay is open (update each frame).
- Click → remember `paused`, pause, render the window into the shared overlay: a title per
  setting, one button per option (`.selected` on the current), a small note, Continue.
  Escape closes.
- Data-driven so new options cost one line:

```js
const SETTINGS_DEFAULTS = { aimInput: 'tap' };
const SETTINGS_ITEMS = [
  { key: 'aimInput', title: 'settings_aim', note: 'settings_aim_note', options: [
    { value: 'tap', label: 'settings_aim_tap' },
    { value: 'button', label: 'settings_aim_btn', sub: 'settings_aim_btn_sub' } ] },
];
const settings = Object.assign({}, SETTINGS_DEFAULTS, JSON.parse(localStorage.getItem(KEY) || '{}'));
```

- Save on every click (wrap `localStorage` in try/catch — private mode). If something changed
  that affects controller gestures and a controller is connected, the Continue button says
  "Continue — redo controller setup" and runs calibration before unpausing.
- Gameplay reads settings through tiny helpers rather than `if`s everywhere, e.g.
  `isAimPick(id)` (keyboard accepts both Space and A) and `aimHint(key)` (picks `key + '_btn'`
  text when the button is used).
