## Why it reads fine and then goes to zeros

The bug is `Wire.begin(47,48)` combined with `M5.update()`. They fight over the same pins.

On the StickS3, SDA 47 / SCL 48 is the **internal I2C bus**. The BMI270 shares it with the M5PM1 power chip, and M5Unified already drives that bus itself through `M5.In_I2C`. Each time M5Unified talks on the bus, for example inside `M5.update()`, it attaches GPIO 47/48 to *its own* I2C driver again. Your `Wire` instance still thinks it owns the pins, but they've been taken from it silently. So:

- the first few reads work, before M5Unified has used the bus,
- after the first `M5.update()` that touches the bus, every `Wire` transaction fails, and the SparkFun lib returns errors or zeros,
- it never recovers, because `M5.update()` runs every loop.

A second, smaller conflict: by default `M5.begin()` also starts its **own** BMI270 driver (`M5.Imu`) and uploads a config to the same chip. Then `imu.beginI2C()` resets the chip and uploads the SparkFun config. That's two owners for one sensor.

**Fix:** don't use `Wire` on the internal bus at all. Send every IMU register read and write through `M5.In_I2C.readRegister()` / `writeRegister()`. It's the same driver M5Unified uses, and it has a mutex, so it's safe from `loop()` and from FreeRTOS tasks. Keep calling `M5.update()` for the buttons as before.

- **If you only need raw accel/gyro:** drop the SparkFun lib and use `M5.Imu.getAccel(&x,&y,&z)` / `getGyro()`.
- **If you want the chip's gestures (your next question):** set `cfg.internal_imu = false` so M5Unified leaves the BMI270 alone, and drive it yourself as described below.

## Single/double tap and orientation from the sensor itself

The BMI270 has two Bosch firmware configs you can upload at init:

- the **main** config, which is the one SparkFun's `beginI2C()` loads. It has wrist gestures and step counting but **no tap, orientation or high-g**.
- the **legacy** config. It has **single/double/triple tap, orientation, flat, high-g, low-g, and any/no/significant motion**, which is the set you want for a controller.

The SparkFun wrapper can't load the legacy config, but its source includes the full Bosch API (`bmi270_api/bmi270_legacy.h`). So keep the library installed, skip `imu.beginI2C()`, and call `bmi270_legacy_*` directly, with I2C callbacks that go through `M5.In_I2C`.

Two things specific to the StickS3:

- **Poll the interrupt status register; don't wire INT1.** On the StickS3, the BMI270's INT1 pin goes to the power chip, not to the ESP32. Configure INT1 as **latched, active-low, open-drain** (open-drain because it shares a line with the PM1), map the features to it, and call `bmi2_get_int_status()` every 20–25 ms. The read clears the latched flags, and latching means you won't miss a gesture between polls.
- **The tap type is in a separate register.** The status word only says "a tap happened". Read `BMI270_LEGACY_TAP_STATUS_REG` and check the single/double/triple masks. Orientation comes from `bmi270_legacy_get_feature_data(BMI2_ORIENTATION)`. It gives portrait up, landscape left, portrait down or landscape right, plus face up/down.

### Setup steps (all in the attached sketch)

1. `M5.begin()` with `cfg.internal_imu = false`. Check the chip ID (0x24 at 0x68) through `M5.In_I2C`.
2. Fill in `bmi2_dev`: your read/write/delay callbacks, `read_write_len = 128`, and `config_file_ptr = nullptr` (this selects the built-in legacy config). Then call `bmi270_legacy_init()`, retrying up to 5 times.
3. `bmi2_set_adv_power_save(BMI2_DISABLE)`. Otherwise the API toggles power save around every access.
4. Accel at **200 Hz** (taps need it), ±8 g, `NORMAL_AVG4`, performance mode.
5. Enable `BMI2_ACCEL, BMI2_SINGLE_TAP, BMI2_DOUBLE_TAP, BMI2_TRIPLE_TAP, BMI2_ORIENTATION`.
6. Map `BMI2_TAP` (legacy taps share it) and `BMI2_ORIENTATION` to INT1, and set INT1 to latched / active-low / open-drain.
7. In `loop()`: `M5.update()`, your buttons, then every 20 ms run `pollGestures()`.

### Tuning (the Bosch defaults aren't ideal for a handheld stick)

| Setting | Change | Why |
|---|---|---|
| Tap `axis_sel` | Z only | Only knocks on the screen or back count; bumps along the stick are ignored |
| Tap threshold | ×0.6 | The default needs quite a hard knock |
| Tap `max_gest_dur` | ×1.5 | Accepts slower, more natural double taps |
| Orientation `blocking` | 3 → 1 | The default blocks orientation changes *while the device moves*, which is exactly when a player twists it |
| Orientation hysteresis | ×1.5 | Less flicker near 45° |

The sketch reads each config, scales it, writes it back, reads it again and prints the before and after values to Serial. These are named constants at the top of the file, so you can tune them yourself. Also, the sketch skips the **first** ORIENT after boot, because that one is the chip reporting its starting state, not a player action.

### If you add more gestures later

- High-g and low-g **share one status bit** in the legacy config. To tell them apart, read |a| right away: below 0.6 g it's low-g (a drop), otherwise read `high_g_output` for the axis.
- To tell a **jerk** from a tap, set high-g to about **3.0 g for 50 ms** (`threshold = g*2048`, `duration = ms/5`). A tap knock is stronger but much shorter, so it won't fire high-g.
- The chip's FLAT flag is unreliable. Compute "flat" yourself from accel Z with hysteresis (on above 0.90 g, off below 0.75 g).

## Files

- `StickS3_BMI270_TapOrient.ino`: a complete sketch. It sets up the legacy config through `M5.In_I2C`, polls taps (single/double/triple) and orientation, shows them on screen and prints them to Serial, and keeps `M5.update()` and buttons A/B in `loop()`.

  **Board:** M5StickS3. **Libraries:** M5Unified (a recent version), M5GFX, and SparkFun BMI270 (needed only for the Bosch API inside it). **Tools menu:** set *USB CDC On Boot: Enabled* and *USB Mode: Hardware CDC and JTAG* to get Serial.

**I haven't compiled it.** Bosch API names shift a little between SparkFun library versions. If a symbol doesn't resolve, the ones most likely to differ are the `BMI270_LEGACY_*_MASK` / `BMI270_LEGACY_TAP_STATUS_REG` names and the fields of the tap config struct. Find the current spelling in the library's `src/bmi270_api/bmi270_legacy.h` and `bmi2_defs.h` and paste it in. If anything doesn't work after flashing, send me the Serial output from startup.
