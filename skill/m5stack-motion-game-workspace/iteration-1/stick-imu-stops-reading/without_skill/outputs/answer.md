# Why the BMI270 goes to zeros, and how to get tap/orientation events from the chip

## What's wrong: two I2C drivers are fighting over GPIO47/48

On the StickS3, GPIO47 (SDA) and GPIO48 (SCL) are the **internal I2C bus**. The BMI270 (0x68) is on it, and so is the power-management chip. **M5Unified owns that bus.** `M5.begin()` sets it up with its own driver (`M5.In_I2C`), and `M5.update()` talks over it on every loop: power button, battery/PMIC state, and so on.

`Wire.begin(47, 48)` attaches a **second** ESP32 I2C controller to the same two pins. The ESP32 GPIO matrix only lets one controller drive a pin at a time, and the most recent one to attach wins. So:

1. Your first few `imu` reads come before the first `M5.update()` bus transaction (or win the race), so they work.
2. Then `M5.update()` runs an I2C transaction and the pins get routed to M5Unified's controller.
3. From then on every `Wire` transaction goes nowhere. The SparkFun lib gets NACKs/timeouts, which show up as zeros or error codes. It never recovers, because nothing reattaches the pins to `Wire`.

The sensor is fine. Removing `M5.update()` would "fix" it, but then your buttons stop working. The real fix is **one driver for the bus**: talk to the BMI270 through `M5.In_I2C`, and never call `Wire.begin(47,48)` on this board.

Quick options, depending on what you need:

| Need | Do this |
|---|---|
| Raw accel/gyro only | Drop the SparkFun lib and use `M5.Imu.update(); M5.Imu.getImuData()` (or `getAccel/getGyro`). M5Unified already drives the BMI270 on the shared bus. |
| Chip features (tap, orientation...) | Use Bosch's BMI270 Sensor API with read/write callbacks that go through `M5.In_I2C`, and set `cfg.internal_imu = false` so M5Unified doesn't load its own config. This is the sketch below. |

## Tap and orientation from the sensor itself

The BMI270 runs these detectors on its own internal feature engine. It only has the detectors that are in the **config blob** uploaded at init, though. Bosch ships several blobs:

- **standard `bmi270`** (as far as I know, the one the SparkFun library uploads): any/no-motion, step counter, wrist gestures, etc. **No orientation**, and no single/double/triple tap set.
- **`bmi270_legacy`**: **single / double / triple tap, orientation (portrait/landscape + face up/down), flat, high-g, low-g**, any/no-motion, step counter.

So what you want is the **legacy** config. The SparkFun lib can't give it to you without hacking it. Use Bosch's official API instead. It's plain C and compiles fine inside an Arduino sketch.

### Setup

1. Download these from https://github.com/boschsensortec/BMI270_SensorAPI (branch `master`) and put them **in the sketch folder** next to the `.ino`:
   `bmi2.c  bmi2.h  bmi2_defs.h  bmi270_legacy.c  bmi270_legacy.h`
2. Remove `#include <SparkFun_BMI270_Arduino_Library.h>` from this sketch. SparkFun bundles its own copy of `bmi2.c`, and having both gives you duplicate-symbol link errors.
3. Use `StickS3_BMI270_Events/StickS3_BMI270_Events.ino` (included).

### How the sketch works

- `M5.begin()` with `cfg.internal_imu = false`. M5Unified still owns the bus (so buttons and `M5.update()` work) but leaves the BMI270 to us. No `Wire` anywhere.
- The Bosch `bmi2_dev` gets `read`/`write` callbacks that call `M5.In_I2C.readRegister/writeRegister(0x68, ...)`. Everything shares one driver, so nothing fights.
- `bmi270_legacy_init()` uploads the legacy config (about 8 KB, in 32-byte chunks; takes a moment at boot).
- Enabled: accel (200 Hz, ±4 g; tap detection needs ≥200 Hz), gyro, `BMI2_SINGLE_TAP / DOUBLE_TAP / TRIPLE_TAP`, `BMI2_ORIENTATION` (with face-up/down enabled).
- Tap and orientation are **mapped to INT1**. You don't need the INT pin wired to a GPIO, but the status bits only latch for features that are mapped to a pin.
- `loop()` polls `bmi2_get_int_status()` about every 10 ms:
  - `BMI270_LEGACY_TAP_STATUS_MASK`: read `BMI270_LEGACY_TAP_STATUS_REG` and check the `SINGLE/DOUBLE/TRIPLE_TAP_MASK` bits.
  - `BMI270_LEGACY_ORIENT_STATUS_MASK`: `bmi270_legacy_get_feature_data(BMI2_ORIENTATION)` gives `portrait_landscape` (0 upright, 1 landscape left, 2 upside down, 3 landscape right) and `faceup_down`.
  - INT_STATUS is **clear-on-read**. Read it once per poll and handle every bit from that single read. Don't call it twice.
- Raw accel/gyro still works alongside the features (`bmi2_get_sensor_data`), printed every 500 ms.

### Notes / tuning

- With all three tap types enabled, the chip waits briefly after the first tap to see whether a second one follows. Single taps therefore arrive with a small delay; that's normal. If you only need single and double, leave `BMI2_TRIPLE_TAP` out of the enable list.
- Tap sensitivity and timing are in `config.cfg.tap` (legacy) via `bmi270_legacy_get_sensor_config` / `set_sensor_config` with `type = BMI2_TAP`. Check the field names in your copy of `bmi2_defs.h`.
- "Landscape left/right" is relative to the chip's axes, not the screen. Rotate the stick once and map the four codes to your display rotation.
- Bosch renames functions between releases. If something doesn't compile, compare with `bmi270_legacy_examples/tap/tap.c` and `orient/orient.c` in the same download; those match the files you have.
- If you'd rather not use INT polling: the INT1 line can be routed to a GPIO only if the board actually wires it. Polling at 100 Hz over I2C is cheap and works on any board.
