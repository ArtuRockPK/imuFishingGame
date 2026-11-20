# Controller firmware

## Contents
1. Boards, libraries, IDE settings
2. Task layout
3. BMI270 (StickS3, Cardputer ADV): Bosch legacy config
4. MPU6886 (StickC Plus2): software gesture detection
5. Reel: spin speed and direction
6. Blow detection (microphone)
7. Buttons and the Cardputer keyboard
8. BLE task
9. Power saving
10. Screen
11. Porting checklist

## 1. Boards, libraries, IDE settings

| Device | IMU | Internal I2C | Board in Arduino IDE | Extra libs |
|---|---|---|---|---|
| M5StickS3 | BMI270 @0x68 | SDA 47 / SCL 48 (shared with M5PM1 power chip) | M5StickS3 | SparkFun BMI270 (for the bundled Bosch API) |
| M5Cardputer ADV | BMI270 @0x68/0x69 (probe CHIP_ID 0x24) | SDA G8 / SCL G9 (shared with TCA8418 keyboard, ES8311 codec) | M5Cardputer | SparkFun BMI270 |
| M5StickC Plus2 | MPU6886 @0x68 | SDA 21 / SCL 22 | M5StickCPlus2 | – |

All: M5Unified (recent — it carries the StickS3 IMU orientation fix and Cardputer ADV board
id), M5GFX, BLE from the ESP32 core. For Serial on ESP32-S3 boards: *USB CDC On Boot:
Enabled*, *USB Mode: Hardware CDC and JTAG*. Put this list in the header comment of each
`.ino` — the user will need it.

Arduino IDE quirk: it auto-generates prototypes before the first function, so declare structs
used in function signatures (e.g. `struct ImuEvent`) **before any function**.

## 2. Task layout

```
imuTask (core 0)  poll IMU every 25 ms (5 ms on MPU6886, 10 ms while reel on) → sendEvent()
micTask (core 0)  idle until MIC command; then 16 kHz chunks → BLOW events
bleTask (core 0)  GATT server; drains bleQueue → notify; battery every 60 s
loop()  (core 1)  M5.update(), buttons → BTN, screen tiles
```

Tasks talk only through FreeRTOS queues and `std::atomic` flags (`bleConnected`,
`reelWanted`, `micWanted`, `stickFlat`, `batteryPct`). `sendEvent()` pushes to two queues:
one for the screen, one for BLE. Assign the sequence number at push time so a full queue
shows up as a gap on the client.

```cpp
void sendEvent(uint8_t idx, const char* detail = "", uint8_t code = 0, uint16_t extra = 0,
               uint8_t aux = 0, uint16_t diag = 0) {
  ImuEvent ev{ millis(), idx, code, 0, extra, aux, diag };
  strlcpy(ev.detail, detail, sizeof(ev.detail));
  xQueueSend(eventQueue, &ev, 0);                                   // screen
  if (isFrequentEvent(idx) && ev.t - lastBleSentMs[idx] < BLE_THROTTLE_MS) return;
  lastBleSentMs[idx] = ev.t;
  ev.seq = bleSeq++;
  if (xQueueSend(bleQueue, &ev, 0) != pdTRUE) LOG("BLE queue full\n");
}
```

## 3. BMI270: Bosch legacy config

Why legacy: the main BMI270 config has wrist gestures but no taps/orientation/high-g; the
*legacy* config has exactly the game-controller set. The SparkFun library only loads the main
config, so include `"SparkFun_BMI270_Arduino_Library.h"` (to get it linked) and
`"bmi270_api/bmi270_legacy.h"`, and call `bmi270_legacy_*` yourself.

Bus callbacks through M5Unified (never `Wire`):

```cpp
static BMI2_INTF_RETURN_TYPE bmiRead(uint8_t reg, uint8_t* d, uint32_t n, void*) {
  return M5.In_I2C.readRegister(BMI_ADDR, reg, d, n, 400000) ? BMI2_INTF_RET_SUCCESS : BMI2_E_COM_FAIL; }
static BMI2_INTF_RETURN_TYPE bmiWrite(uint8_t reg, const uint8_t* d, uint32_t n, void*) {
  return M5.In_I2C.writeRegister(BMI_ADDR, reg, d, n, 400000) ? BMI2_INTF_RET_SUCCESS : BMI2_E_COM_FAIL; }
bmi.intf = BMI2_I2C_INTF; bmi.read = bmiRead; bmi.write = bmiWrite; bmi.delay_us = bmiDelayUs;
bmi.read_write_len = 128;  bmi.config_file_ptr = nullptr;   // built-in legacy config
while (bmi270_legacy_init(&bmi) != BMI2_OK) { retry up to 5×, 500 ms apart }
```

Then:
- `bmi2_set_adv_power_save(BMI2_DISABLE)` — otherwise the API toggles it on every access.
- Accel: 200 Hz (taps need it), ±8 g (headroom for high-g), `NORMAL_AVG4`, perf mode.
  4096 LSB/g.
- Gyro: configure 100 Hz ±2000 dps (16.4 LSB/dps) but **enable it only for the reel**.
- Enable features: accel, any/no/sig-motion, single/double/triple tap, orientation, high-g,
  low-g, flat. Map to INT1: `BMI2_SIG_MOTION, BMI2_TAP, BMI2_ORIENTATION, BMI2_HIGH_G,
  BMI2_LOW_G, BMI2_FLAT, BMI2_ANY_MOTION, BMI2_NO_MOTION` (legacy taps share `BMI2_TAP`).
  INT pin: latched, active-low, **open-drain** (on StickS3 the line goes to the PM1).
- Poll `bmi2_get_int_status()` each cycle (reading clears latched flags). Tap type lives in a
  separate register `BMI270_LEGACY_TAP_STATUS_REG` (single/double/triple masks).

Tuning that mattered (read config → scale → write → read back and log):

| Feature | Change | Why |
|---|---|---|
| Tap | `axis_sel` = Z only; threshold ×0.6; `max_gest_dur` ×1.5 | knocks on screen/back; more sensitive; slower double taps accepted |
| Orientation | `blocking` 3 → 1; hysteresis ×1.5 | default blocks changes while moving — exactly when the player twists |
| High-g | 4.9 g/20 ms → **3.0 g / 50 ms** (`threshold = g*2048`, `duration = ms/5`) | a jerk is weaker but longer than a tap knock; this separates them |

Gotchas:
- **High-g and low-g share one status bit** in legacy. Disambiguate by reading |a| right
  away: `< 0.6 g` → LOW_G, else read `high_g_output` for axis/sign → HIGH_G.
- **The sensor's FLAT is unreliable.** Compute flat yourself every 200 ms from accel z with
  hysteresis (on > 0.90 g, off < 0.75 g) and send FLAT only on change; use the sensor flag
  only to trigger an immediate re-check.
- Don't send the first ORIENT after boot (it's not a player action).

## 4. MPU6886: software detection (200 Hz)

M5Unified configures it (±8 g, ±2000 dps). Read with `M5.Imu.getAccel/getGyro`. Gyro standby
via `PWR_MGMT_2` (0x6C) = 0x07 (off) / 0x00 (on) through `M5.In_I2C.writeRegister8`.

Per sample keep: previous sample, fast gravity estimate (`k = 0.04`), slow average for motion
(`k = 0.02`). Detectors (constants that worked):

- **HIGH_G**: |a| > 3.0 g continuously ≥ 50 ms; code = axis/sign of largest component at the
  peak; lock 400 ms; also cancels a pending tap (it was a jerk).
- **LOW_G**: |a| < 0.4 g for ≥ 30 ms; lock 400 ms.
- **TAP**: on the tap axis, `|a - prev| > 0.9 g` per 5 ms sample starts a "shock"; it must
  calm down (`< 0.35 g` jumps) within 40 ms, otherwise it wasn't a tap. Ignore new shocks for
  80 ms (case ringing). Count taps; when 350 ms pass without another, emit TAP1/2/3.
- **ANY_MOT**: |a − slow avg| > 0.08 g (emit ≤ every 200 ms). **NO_MOT**: none for 2 s.
  **SIG_MOT**: motion without a > 1 s gap for 5 s.
- **FLAT**: |gravity z| hysteresis 0.90/0.75.
- **ORIENT**: only while not flat (|gz| < 0.8). Projections `{-gy, gx, gy, -gx}`; the best must
  exceed 0.5 g and beat the runner-up by 0.15 g, and hold for 60 ms.

## 5. Reel: spin speed and direction

Enabled by command 1, only while connected; gyro on, poll at 100 Hz, send every 100 ms.

**Speed** — `SpinMeter` sums the angle between consecutive samples of a vector. Two vectors
rotate when a wrist circles: angular velocity (gyro) and linear acceleration (accel minus a
slow gravity filter, `k = 0.02`). Take the larger of the two per send window.

```cpp
void add(float x, float y, float z, float minMag) {
  float m = sqrtf(x*x + y*y + z*z);
  if (m < minMag) { have = false; return; }   // through zero = rocking, not rotation
  if (have) { float c = constrain((x*px + y*py + z*pz) / (m*pm), -1, 1);
              float a = acosf(c); if (a < 1.2f) angle += a; }   // >70°/sample = glitch
  px = x; py = y; pz = z; pm = m; have = true;
}
```

Thresholds: gyro ≥ 100 dps, accel ≥ 0.25 g. Count turns only while the gyro sees rotation
(the accelerometer keeps "moving" briefly after a stop). Smooth asymmetrically: spin-up
`k = 0.4`, slow-down `k = 0.8`, below 0.1 rev/s → 0. If the gyro sees nothing for 80 ms, send
`0` **immediately** — under line tension a late stop feels terrible. Send nothing while idle.

**Direction** — three candidate vectors, each decayed ×0.5 every send (≈ last 0.2 s):
- *twist* (device spins around its own axis): Σ ω·dt;
- *gyro circle* (wrist circles and the device tilts along): Σ (ωprev × ω)/(|ωprev||ω|);
- *accel circle* (device moves round without tilting, like a real reel handle):
  Σ (aprev × a)/(|aprev||a|) on linear acceleration.

Pick the one with the largest magnitude; main axis = largest component. Known only if the
magnitude ≥ 0.5 rad and the main axis carries ≥ 50 % of it. Encode as in `protocol.md`.

## 6. Blow detection (microphone)

`M5.Mic` at 16 kHz, 256-sample chunks (16 ms), double-buffered (`record()` twice so audio has
no gaps; a chunk is ready when `isRecording() < 2`). Per chunk RMS without DC.
- Learn background noise only from quiet chunks (`k = 0.03`).
- Loud = RMS > 2000 **and** > 4× noise. Loud for 120 ms (dips < 60 ms tolerated) → BLOW with
  strength `peak/128` (1..255). Quiet 200 ms → BLOW 0.
- Ignore the first 300 ms after `begin()` (power-on click). Log rms/noise every 0.5 s for
  tuning.

## 7. Buttons and the Cardputer keyboard

- Sticks: `if (M5.BtnA.wasPressed()) sendEvent(EV_BTN, "A", 1);` in `loop()` after
  `M5.update()`. Long-press A (2 s) powers off.
- Cardputer ADV: the TCA8418 keyboard sits on the same internal bus. Read its key-event FIFO
  via `M5.In_I2C`; count only **press** events (`event & 0x80`), not releases, or every key
  sends two BTN. `bool g0 = M5.BtnA.wasPressed(); if (g0 || key) sendEvent(EV_BTN, key ? "KEY" : "G0", 1);`
  The M5Cardputer library isn't needed. G0 long-press → deep sleep (no power chip).
- Any button also wakes the screen.

## 8. BLE task

- `BLEDevice::init(name)`, `setPower(ESP_PWR_LVL_N0)` (0 dBm is plenty for a room).
- Event char READ|NOTIFY (+`BLE2902` descriptor on Bluedroid; NimBLE adds it itself), command
  char WRITE|WRITE_NR with an `onWrite` that only sets atomics.
- Battery Service 0x180F/0x2A19 — browsers know it as `'battery_service'` / `'battery_level'`.
- Advertising interval 300–500 ms (`setMinInterval(480)`, `setMaxInterval(800)`).
- On connect: wait 500 ms (client subscribes), send the state packet, send battery.
  On disconnect: wait 300 ms, restart advertising. Drop queued events while disconnected.

## 9. Power saving

CPU 80 MHz (the minimum where BLE works), speaker/LED/RTC/5V out off, gyro and mic only on
request, 0 dBm TX, slow advertising, dimmed screen (brightness ~60) that turns off 10 s after
power-on or a button press — sensor events don't wake it.

## 10. Screen

Name + BLE/battery status on top, then one tile per event (3 per row). A tile lights up in
its colour for 1.5 s on its event, showing detail (ORIENT side, HIGH-G axis, REEL speed).
Draw into an `M5Canvas` sprite and push it, to avoid flicker. This doubles as on-device
diagnostics when the user tunes thresholds.

## 11. Porting checklist (new model or new feature)

- [ ] Same UUIDs, packet layout, event ids; new name.
- [ ] IMU through `M5.In_I2C` / `M5.Imu`; confirm chip id at boot and print it.
- [ ] Axis conventions: TAP axis and ORIENT mapping depend on how the IMU is mounted — check
      with the test page and fix in firmware, not in the game.
- [ ] New event? Add to the enum, the tile table, the header protocol comment, the test page,
      the game's `EV` / `EV_NAMES`, the keyboard map — and to **every** firmware.
- [ ] Constants named, commented, printed to Serial.
