# Distribution and release

## Repository layout (what worked)

```
<Device1>_events.ino                      firmware at repo root (Arduino needs folder = sketch name,
<Device2>_events/<Device2>_events.ino      so secondary firmwares live in same-named folders)
web/ble_test.html                         test page: one tile per event + REEL diagnostics
web/<game>/index.html, js/, media/        the game
GESTURES.md                               player-facing: every gesture, where it's used, keyboard keys
README.md                                 EN + RU: what it is, links to play / flash
.gitignore                                raw video footage (video/), build output
```

## The game: GitHub Pages

Web Bluetooth needs HTTPS → GitHub Pages from the `main` branch is ideal and free. Link to the
game and the test page from the README. Relative paths only (the site lives under
`/<repo>/`). Remind players: Chrome or Edge on desktop/Android; enable Bluetooth; on Linux
Chrome may need `chrome://flags/#enable-experimental-web-platform-features`.

## The firmware: M5Burner

M5Burner (desktop app and web flasher at burner.m5stack.com) lets players flash a compiled
binary with no Arduino IDE.
1. In Arduino IDE: *Sketch → Export Compiled Binary* (merged/combined `.bin` for the board).
2. Upload it to M5Burner as a firmware for the device, with a description and version.
3. Use the share link (e.g. `https://burner.m5stack.com/XXXXXX`) per device.

Each time firmware changes the user rebuilds and re-uploads; the links can change, so keep
them in one array in the game:

```js
const FIRMWARE_LINKS = [
  { name: 'StickS3',       url: 'https://burner.m5stack.com/…' },
  { name: 'StickC Plus2',  url: 'https://burner.m5stack.com/…' },
  { name: 'Cardputer ADV', url: 'https://burner.m5stack.com/…' },
];
// buttons: window.open(url, '_blank', 'noopener')
```

Show a "Update your controller firmware" screen right after language selection with one
button per model and "Firmware is up to date — next". Features that need new firmware should
say so where they are offered (settings note).

## Test page

`ble_test.html`: Connect button, tiles that light up per event with detail, sequence-gap
counter, battery, REEL speed + direction + diagnostics bytes, buttons to send REEL/MIC
commands. Players use it to check their controller; you use it to tune thresholds.

## Release checklist

- [ ] All firmwares updated together (protocol header comment, enum, tiles).
- [ ] Test page knows any new event.
- [ ] Game: keyboard mapping, translations for every language, README/GESTURES updated.
- [ ] Verified in a browser in keyboard mode (and on hardware by the user).
- [ ] Release notes (players read them): what's new, in plain words, in each README language.
- [ ] Commit, push to `main` → Pages redeploys in a minute or two.
- [ ] User rebuilds firmware, uploads to M5Burner, sends new links → update `FIRMWARE_LINKS`
      and README.
