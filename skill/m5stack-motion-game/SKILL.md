---
name: m5stack-motion-game
description: >-
  Build browser games (or any web app) controlled by motion gestures from M5Stack ESP32 controllers over Bluetooth LE — StickS3 (BMI270), StickC Plus2 (MPU6886), Cardputer ADV (BMI270) and similar. Covers Arduino firmware (taps, jerks, drops, orientation, wrist spin speed and direction, blowing into the mic, buttons), a compact BLE event protocol, the Web Bluetooth client with keyboard fallback, calibration with gesture videos, a pixel-art state-machine game with mini-games, i18n, settings, and GitHub Pages + M5Burner distribution. Use this skill whenever the user wants to turn an M5Stick / M5StickC / Cardputer / ESP32 with an accelerometer or gyroscope into a game controller, motion remote, "Wii-like" wand, fishing rod, sword, steering wheel or similar; wants Web Bluetooth to receive sensor events in a browser; asks about BMI270 / MPU6886 tap or gesture detection; or wants to add a feature to such a controller+game pair — even if they never say "skill" or name this project.
---

# Motion-controlled browser game with M5Stack controllers

This skill packages what was learned building **Pixel Fishing**, an 8-bit browser fishing game
played with an M5Stack stick as the rod (reference implementation:
https://github.com/ArtuRockPK/imuFishingGame). Use it to build a similar app — a different
game, a different gesture set, a different controller — without rediscovering the pitfalls.

The core idea: **the controller recognises gestures and sends small named events; the game
never sees raw sensor data.** That keeps BLE traffic tiny, makes every controller model
interchangeable (they all speak the same protocol), and lets the game be tested from the
keyboard with no hardware at all.

```
 M5 controller (Arduino, FreeRTOS)            Browser (plain JS, no build step)
 ┌───────────────────────────────┐   BLE     ┌───────────────────────────────────┐
 │ imuTask: IMU → gesture events │ notify →  │ controller.js: Web Bluetooth       │
 │ micTask: mic → BLOW events    │ 12-byte   │   ↳ setup.js (calibration)         │
 │ loop:    buttons → BTN events │ packets   │   ↳ onControllerEvent(id, code)    │
 │ bleTask: GATT server, battery │ ← write   │ states.js: state machine (game)    │
 └───────────────────────────────┘ 1-byte    │ draw.js / sprites: canvas pixel art│
                                   commands  └───────────────────────────────────┘
```

## How to work through a project like this

1. **Pin down the gestures first.** List each player action and map it to a physical gesture
   and one event id (e.g. "cast = sharp jerk = HIGH_G", "pick spot = double tap or button").
   Prefer gestures the sensor can recognise reliably; see the gesture table in
   `references/firmware.md`. Fewer, distinct gestures beat many similar ones — a tap and a jerk
   are only distinguishable because the jerk is *longer* (≥50 ms above 3 g), not stronger.
2. **Freeze the protocol** (`references/protocol.md`). Every controller firmware and the web
   client share it. Append new event ids at the end; never renumber — old firmware in the
   wild must keep working.
3. **Write the firmware** for each controller model (`references/firmware.md`). When there are
   several models, every protocol feature goes into all of them in the same change, otherwise
   the game ends up depending on a feature half the players don't have.
4. **Build a test page first** (`ble_test.html`: one tile per event that lights up). It is the
   fastest way to tune thresholds on real hardware and to let players check their controller.
5. **Write the game** around a state machine with a keyboard mapping for every event
   (`references/web-client.md`, `references/game-architecture.md`).
6. **Add calibration** — a step-by-step overlay with a short video of each gesture, waiting
   for the real event. It teaches the player and learns per-controller facts such as which
   spin sign means clockwise.
7. **Ship**: game on GitHub Pages (Web Bluetooth needs HTTPS), firmware via M5Burner, and a
   "flash the latest firmware" screen in the game (`references/distribution.md`).

## Hard-won rules (read these even if you read nothing else)

- **Never use Arduino `Wire` on the internal I2C bus** of StickS3 / Cardputer. M5Unified's
  `M5.In_I2C` re-attaches the pins on every transaction (e.g. inside `M5.update()`), silently
  stealing them from `Wire`; the IMU just stops answering. Route all IMU register access
  through `M5.In_I2C.readRegister/writeRegister` — it has a mutex, so it is safe from tasks.
- **BMI270 gestures: use Bosch's *legacy* config** (`bmi270_legacy_*` from the Bosch API bundled
  inside the SparkFun BMI270 library). It has single/double/triple tap, orientation, flat,
  high-g, low-g, any/no/sig-motion. The SparkFun wrapper can only load the main config, so
  drive the Bosch API directly. Poll the interrupt status register instead of wiring INT1
  (on StickS3 INT1 goes to the power chip, not the ESP32).
- **MPU6886 has no gesture engine** — detect everything in software at 200 Hz from
  `M5.Imu.getAccel()`; templates are in `references/firmware.md`.
- **Throttle chatty events** (ANY/NO_MOTION) to ≤ 2/s before the BLE queue, or they crowd out
  the rare important ones (a notification leaves roughly once per 30–50 ms connection interval).
  Put a sequence number in each packet so the client can detect drops.
- **Turn power-hungry parts on only on request**: the gyroscope only while the game asks for
  spin ("REEL on"), the microphone only while it asks for blowing. Commands are 1-byte writes.
  Add a safety timeout on the device in case the browser disappears.
- **Spin direction depends on how the player holds the device**, so it cannot be hard-coded.
  The firmware reports *axis + sign*; the game learns which axis+sign is "clockwise" during
  calibration and stores it per device name in `localStorage`.
- **Everything the game reacts to must also work from the keyboard** (Space = double tap,
  H = jerk, R/E = spin CW/CCW while held, …). It is how you, testers and players without
  hardware exercise every state, and how you verify changes in a browser automatically.
- **Gentle tolerances for skill mini-games.** Raw sensor-driven values are noisy; show the
  player a smoothed indicator (needle, marker) with a visible target zone, add a grace
  period, and fail only after a *reserve* runs out rather than on the first wrong frame.
  Players who "lost without understanding why" was the most common feedback.
- **Words matter in every language.** A word that is neutral in one language can be rude in
  another (in Russian "чурка" for a wood block reads as a slur — use "полено"). Have every
  new string reviewed in all supported languages.

## Reference files — read the one you need

| File | Read when |
|---|---|
| `references/protocol.md` | Defining or extending the BLE service, packet layout, event ids, commands |
| `references/firmware.md` | Writing/porting controller firmware: BMI270 legacy setup, MPU6886 software detection, reel spin meter, blow detection, buttons/keyboard, FreeRTOS layout, power saving |
| `references/web-client.md` | Web Bluetooth connection, command queue, keyboard fallback, calibration with videos, settings gear |
| `references/game-architecture.md` | Game code layout, state machine, pixel-art canvas, sprites, day/night, sound, i18n, mini-game design patterns, testing in a browser |
| `references/distribution.md` | GitHub Pages, M5Burner, firmware screen, test page, release notes |
| `assets/controller_skeleton.ino` | Starting point for a new controller firmware (M5Unified, any IMU) |
| `assets/ble-client.js` | Starting point for the browser side (connect, parse, commands, keyboard) |

The assets are compact starting templates written from the working project; they have not
been compiled as-is, so build and tune them on the target hardware.

## Working with the user

- The user usually builds and flashes the firmware themselves (Arduino IDE). Don't run
  `arduino-cli` or try to flash unless asked; instead say exactly which board, libraries and
  Tools settings are needed (listed at the top of each firmware file).
- Ask for (or record) short phone videos of each gesture for the calibration screens —
  they help players more than any text. Separate videos per device type if the hold differs.
- Gesture thresholds are tuned by experiment on real hardware. Keep them as named constants
  at the top of the firmware with a comment saying what raising/lowering does, and print the
  live values to Serial so the user can tune without your help.
- When the game is changed, verify it in a browser preview with the keyboard controls (and
  the deterministic stepping trick in `references/game-architecture.md`) before reporting done.
