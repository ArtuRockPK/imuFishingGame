# Spin direction for the tug-of-war mini-game

## Why grip breaks the obvious approach

Your current rev/s is almost certainly a magnitude, either `|gyro|` or one axis's absolute value. To get direction you need a sign, and the sign of any single gyro axis depends on how the stick is held:

- If the player spins around a different body axis than you expected, the axis you read only sees a small, noisy part of the motion.
- If the stick is held upside down, or in the other hand, the sign flips.
- "Clockwise" depends on where you look from. Clockwise seen from the top of the stick is counter-clockwise seen from the bottom.

No fixed axis plus a fixed sign survives all of that. So the work is split into two layers.

## Layer 1, firmware: learn the spin axis instead of assuming it (`SpinDirection.h`)

1. **Gyro bias tracking.** While the stick is still (|accel| ≈ 1 g and gyro small for 0.5 s), it slowly learns the gyro offset. Direction decisions happen near zero speed, which is where bias does the most damage.
2. **Unsigned axis learning.** While the stick spins faster than 0.5 rev/s, it averages the normalised gyro vector into an axis estimate (time constant about 1.2 s). Before averaging, each sample is flipped into the axis's current hemisphere. Reversing direction therefore doesn't drag the axis, and the axis's sign stays continuous: it never suddenly flips. If the player changes grip mid-game, the axis follows smoothly.
3. **Projection.** `signed rev/s = dot(gyro, axis)`. One physical spin direction always has the same sign, whatever the grip.
4. **Quality.** `|projection| / |gyro|`, from 0 to 1. Shaking or wobbling scores low, so the game can ignore it.
5. **Epoch.** A counter that goes up when the axis is re-learned: on the first spin, after a long-press of BtnA, or when the browser writes `0x01` to the command characteristic.

The first axis estimate always makes its largest component positive. The same grip therefore gets the same sign convention every session, so a saved calibration usually stays valid.

**BLE:** a new 4-byte notify characteristic at about 30 Hz, alongside your existing one so the current game keeps working:

| bytes | type | meaning |
|---|---|---|
| 0–1 | int16 LE | signed rev/s × 100 |
| 2 | uint8 | quality × 255 |
| 3 | uint8 | axis epoch |

`spin.speedRps()` returns the same unsigned value you send today, so the reel-in code can use it too. `firmware_integration.ino` shows the wiring: an IMU sample on every loop (aim for 100–200 Hz), a notify every 33 ms, the reset command and the BtnA long-press. The UUIDs in it are placeholders; use your own in the same service.

## Layer 2, browser: map the sign to "clockwise", and debounce (`spin-direction.js`)

- **Calibration, done once.** Show "Spin CLOCKWISE, as you see it, for 2 s". The timer starts at the first real spin, so a slow start doesn't count. If the average is clearly positive, then + means clockwise means push right; otherwise it's the reverse. The result is saved in `localStorage`. This also handles left-handers and players who hold the stick upside down, because it measures what *that player* calls clockwise.
- **"Controls backwards" button.** `invert()` flips the mapping in one tap. "Recalibrate" is `clearCalibration()`.
- **Filtering for reliability:**
  - Samples with quality < 0.55 count as no spin, so wobble is ignored.
  - A light EMA in the browser smooths the value further.
  - Hysteresis: pushing starts above 0.45 rev/s and stops below 0.25 rev/s, so the input doesn't flicker around the threshold.
  - Releasing is instant. Switching to the opposite direction has to hold for 90 ms, which stops the small back-swing at the end of each wrist turn from registering as a direction change.
  - If no packet arrives for 300 ms, the input goes neutral.
- **Output.** `read()` returns `{dir: -1|0|1, push: -1..1, calibrated}`. `push` grows with spin speed and reaches full strength at 2.5 rev/s, so spinning harder pulls harder.
- **`onEpochChange`.** Fires when the stick re-learned its axis. Use it to show a quick "spin clockwise to re-check" hint.

## The mini-game (`tug-minigame.js`)

A minimal loop you can drop into your renderer:

- The fish pulls the marker left or right with a smoothly ramping force. It mostly switches sides so the player has to change direction.
- The player's `push` moves the marker back.
- Staying at an edge for more than 1.2 s loses the fish. Holding it for 12 s wins.
- Calibration runs automatically the first time.

## Tuning tips

- **Too twitchy:** raise `switchMs` to 120–150, or raise `onRps`.
- **Feels laggy:** lower `smoothMs` on the JS side, or `outTau` on the firmware side.
- **Kids or weak spins:** lower `onRps` to about 0.3 and `fullRps` to about 1.8.
- **Speed limit:** the BMI270 gyro range of ±2000 °/s is about 5.5 rev/s. Faster spins clip the speed, but the sign is still correct.
- **Wrong direction straight after a grip change:** this almost always means the axis re-learned with the opposite sign. Watch for `epoch` changes and re-prompt, or let the player hit "Invert".

## Files

- `SpinDirection.h`: the firmware class (bias, axis learning, signed rate, quality, epoch, packet packing)
- `firmware_integration.ino`: BLE characteristics plus the loop wiring for M5Unified
- `spin-direction.js`: the Web Bluetooth decoder, calibration, hysteresis/debounce and the push output
- `tug-minigame.js`: an example mini-game loop and how to wire it up

Nothing here has been compiled or tested on hardware.
