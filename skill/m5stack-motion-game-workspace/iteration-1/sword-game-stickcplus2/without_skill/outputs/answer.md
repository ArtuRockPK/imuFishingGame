I've written both pieces: firmware that turns the M5StickC Plus2 into a Bluetooth sword, and a one-page browser game that works with or without the stick. I haven't compiled or flashed anything. The gesture thresholds are first guesses and may need adjusting on your stick (see "Tuning" below).

## Files

- `StickSword/StickSword.ino` — the Arduino firmware for the stick
- `index.html` — the whole game in one file (canvas, a training dummy with HP)

## Flashing the stick (Arduino IDE)

1. **Board:** install the M5Stack board package and pick **M5StickCPlus2**.
2. **Library:** install **M5Unified** from the Library Manager. Bluetooth support comes with the ESP32 core, so nothing else is needed.
3. **Upload** the sketch. If you get "Sketch too big", set Tools → Partition Scheme → **Huge APP (3MB No OTA)**. The Plus2 has 8 MB of flash, so this is safe.
4. **First boot:** keep the stick still for about a second while it calibrates the gyro. It beeps when it's done.

## How the stick detects each gesture

All detection runs on the stick itself. It sends short text messages over a BLE service that works like a serial cable (the common Nordic UART layout).

| Action | Message sent | How it's detected |
|---|---|---|
| Sharp swing | `SLASH 812` | Rotation speed goes above 350 °/s. The message is sent at the peak of the swing, and the number is that peak speed, which the game turns into damage. |
| Double tap on the case | `SPECIAL` | Two sharp jolts 90–450 ms apart while the stick is barely rotating. Taps right after a slash are ignored, so a swing doesn't count as a tap. |
| Button A | `SPECIAL` | Backup if tapping doesn't trigger reliably. |
| Lay flat on the table | `PAUSE` | Screen facing up or down, completely still (under 6 °/s) for 1 second. A hand can't hold it that still, so holding it level won't pause the game. |
| Pick it up | `RESUME` | |
| Every 10 s | `BAT 87` | Battery level, shown in the game. |

- **Recalibrate:** hold button B for 1 second, with the stick lying still.
- **Screen:** shows the connection state, battery and the last gesture.
- **Beep:** the game makes the stick beep when the dummy is destroyed.

## Running the game

You need Chrome or Edge on desktop or Android. Firefox and Safari don't support Web Bluetooth.

Web Bluetooth only works from a secure page, so serve the folder locally:

```
cd outputs
python -m http.server 8000
```

Then open http://localhost:8000, click **Connect stick (Bluetooth)** and choose **StickSword**. If the connection drops, the game tries to reconnect by itself.

## Testing without the stick

The simulator is always on and sends exactly the same messages as the stick, so the game code being tested is the same:

- **Slash:** swipe across the dummy with the mouse or a finger (a faster swipe hits harder), or press `Space` / `S`.
- **Special:** double-click, or press `D`. Your double-click stands in for the double tap.
- **Pause / resume:** press `P` to "lay the stick flat" and press it again to pick it up.
- **Buttons:** the same three actions are also buttons above the game area.

For this you can just open `index.html` straight from disk, no server needed.

## Game rules

- **Damage:** a stronger slash does more damage. Hits within 1.2 s of each other build a combo that adds bonus damage.
- **Special:** a large hit with a 3 s cooldown, shown as a ring in the top-right corner.
- **Respawn:** when the dummy is destroyed it comes back one level higher with more HP.
- **Pause:** freezes the game and dims the screen until you pick the stick up.

## Tuning

All the thresholds are constants at the top of the `.ino`:

- **Too many slashes from small movements:** raise `SLASH_TRIGGER_DPS` (try 450).
- **Double tap not triggering:** lower `TAP_JERK_G` (try 0.6).
- **Double tap triggering by accident:** raise `TAP_JERK_G` (try 1.1).
- **Doesn't pause on a table that vibrates:** raise `FLAT_MAX_GYRO_DPS` / `FLAT_MAX_JITTER_G` a little.
- **Seeing the raw numbers:** set `DEBUG_STREAM = true` and open the Serial Monitor at 115200 to watch what each gesture produces.
