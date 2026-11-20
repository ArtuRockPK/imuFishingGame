# Spin direction for the "hold the fish" mini-game

## The key idea: the stick can't know "clockwise", only the game can

"Clockwise" depends on how the player holds the stick: screen up or down, button left or right, twisting the stick around its own length, or circling the wrist like a reel handle. The same physical motion gives an opposite gyro sign, or even a different axis, depending on the grip. So **don't hard-code a sign in the firmware.** Split the job:

1. **Firmware** reports *which IMU axis the rotation is around, and with which sign*, plus a flag for "I'm sure". That goes in the REEL packet's byte 3, the "aux" byte, which is still unused.
2. **The game** learns during a short calibration which axis+sign *this player* gets when spinning clockwise, and which they get counter-clockwise. It saves both per device name in `localStorage`.
3. **In the mini-game**, per-packet directions are never used raw. They are voted over about 0.5 s, held through short "unsure" gaps, and smoothed into a push value from -1 to +1. The mini-game is forgiving: it has inertia, a grace period and a strain reserve.

## Firmware part (StickS3)

Files: `firmware/spin_direction.h` (drop-in) and `firmware/reel_direction_integration.cpp` (where to hook it into your existing reel code).

`SpinDirection` takes the same gyro (deg/s) and accel (g) samples your speed meter already gets at 100 Hz. It tracks three ways a wrist can spin, because players really do all three:

| Method | Grip / motion | What is accumulated |
|---|---|---|
| twist | stick rotates around its own axis | Σ ω·dt |
| gyro circle | wrist circles and the stick tilts along | Σ (ω_prev × ω) / (\|ω_prev\|·\|ω\|) |
| accel circle | stick moves round without tilting, like a reel handle | same cross product on linear accel (accel minus slow gravity) |

- Each accumulator is multiplied by 0.5 every 100 ms send, so it covers roughly the last 0.2 s. The strongest one wins, and its largest component is the main axis.
- The direction counts as **known** (bit 6) only if the winner is ≥ 0.5 rad and the main axis carries ≥ 50 % of it.
- Packet layout (append-only; old clients just ignore it):
  - byte 3 = `sign(bit7) | known(bit6) | twist(bit5) | accel-circle(bit4) | axis(bits0-1)`
  - bytes 10–11 = diagnostics (strength ×40, main-axis share %), for tuning on a test page
- The game compares only `aux & 0x83` (axis + sign). The method bits flicker between methods for the same motion, so they are ignored.

Integration points:
- Call `spinDir.add(...)` per sample and `aux = spinDir.encode()` per 100 ms send. Put `aux` into byte 3 of the REEL event.
- Call `spinDir.reset()` when you send the instant-stop `0` and when the reel turns off.
- The reel's 60 s safety timeout restarts on every "REEL on" command. The game re-sends it every 20 s during the mini-game, so a long fight never loses the gyro.
- A Serial line per send prints `rps, method, ±axis, known, strength, share`. Spin CW and CCW in a few grips and watch it. The thresholds `SPIN_DIR_MIN_RAD` and `SPIN_DIR_MIN_SHARE` sit at the top of the header, with comments on what raising or lowering them does.
- Keep using `M5.In_I2C` for all BMI270 access (never `Wire`). The gyro stays on only while the reel is on.
- If you also have StickC Plus2 or Cardputer firmware, add the same class there in the same change. It only needs dps + g.

Board: M5StickS3. Libraries: M5Unified (recent), M5GFX, SparkFun BMI270 (bundled Bosch API). Serial needs USB CDC On Boot: Enabled.

## JS part

Files: `web/spin-direction.js` (calibration + direction filter + keyboard) and `web/hold-fish.js` (the mini-game state).

**Calibration (`spinSetup`).** Two overlay steps, "spin clockwise" and "spin counter-clockwise", each with a short looping video of the motion:
- Turns the reel on and collects 45 known-direction packets (about 4.5 s of spinning).
- Votes on `aux & 0x83` and accepts if one key has ≥ 70 % of the votes. Otherwise it shows "spin steadily in ONE direction" and restarts the step.
- CCW must differ from CW ("that was the same way").
- If about 50 spinning packets arrive with fewer than 3 known directions, the firmware can't report direction. Calibration then marks it `unsupported`, and the game falls back to a "spin speed pulls toward the centre" mode.
- The result `{cw, ccw}` is saved in `localStorage` per device name, even when skipped, so nobody is asked twice.
- CCW is stored separately rather than assumed to be `cw ^ 0x80`. Some grips report CW and CCW on different axes. The flipped key is still accepted as a fallback.

**Reliability in the game (`stickSpin`):**
- `reelDirection(aux)` returns +1 / −1 / 0. Unsure packets and unknown axes give 0; it never guesses.
- **Majority vote** over the last 5 known packets, with hysteresis. One stray packet can't flip the push; a real reversal flips it in about 0.2–0.3 s.
- **Holds** the last direction for 0.4 s through "unsure" packets. These are common at the moment of a wrist reversal.
- **Packet timeout** of 0.3 s: if the `0` stop packet is lost, the push still drops.
- Push = direction × (speed / 2 rev/s, capped at 1), with a dead zone below 0.3 rev/s, smoothed toward its target.
- **Grip-change detection:** if 12 confident packets in a row match neither learned key, it shows "Grip changed? Redo spin setup in ⚙".

**Mini-game (`HOLD_FISH_STATE`):**
- The marker has inertia (velocity + damping). The fish force picks a new random target every 0.35–1.1 s and eases toward it.
- Player push (gain 1.6) is stronger than the fish (0.9), so a player who spins the right way always wins the tug.
- 1.5 s grace at the start, then the fish force ramps in over 2 s.
- Progress fills only inside the green zone, faster near the centre (8 s to land the fish).
- Being outside fills a 2.5 s strain reserve that recovers 1.5× faster when you're back inside. The line snaps only when the reserve is full, so a one-frame touch of the edge never kills you.
- On-screen arrows show the fish's pull and the player's push separately, so players see *why* the marker moves. "PUSH LEFT/RIGHT!" appears once strain passes 40 %.
- The state turns the reel on in `enter()` and off in `exit()`. If a BLE player has no calibration yet, `enter()` runs the spin setup first.

**Keyboard:** hold **R** = clockwise, **E** = counter-clockwise, **T** = slow clockwise. These go through the same `stickSpin` path, so you can test the whole mini-game without the stick.

New strings to add in every language: `hint_hold_dir`, `hint_hold_speed`, `hint_push_left`, `hint_push_right`, `hint_grip_changed`, `spin_steady`, `spin_same_way`, `spin_unsupported`, plus the two calibration step titles and texts.

## What to do next
1. Flash the firmware and open your test page. Spin CW and CCW in 3–4 grips and check that bit 6 is set while spinning steadily, and that CW and CCW give different keys. Tune `SPIN_DIR_MIN_RAD` / `SPIN_DIR_MIN_SHARE` if needed.
2. Record two short phone clips (CW, CCW) for the calibration steps.
3. Try the mini-game with R/E first, then with the stick. Feel is tuned in the `HOLD` constants: `PUSH_GAIN`, `FISH_FORCE`, `ZONE`, `STRAIN_SEC`.

None of this has been compiled or run in a browser yet. `hold-fish.js` uses your game's `setState`, `T`, `sfx`, `paused` and `drawHintText` names, so adjust those to match your code.
