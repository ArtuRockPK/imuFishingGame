I wrote two files: the firmware for the stick and a one-page game. I haven't compiled the firmware. You'll build it yourself, and the gesture thresholds will need some tuning on the real stick. I did play the game in a browser without the stick: slashes, specials, KOs, the next dummy, and pause and resume all worked, with no errors in the console.

## Files

- `StickCP2_Sword/StickCP2_Sword.ino` is the Arduino firmware. Arduino IDE needs the folder and the sketch to have the same name, so keep it like this.
- `index.html` is the game: one page, a canvas, plain JavaScript, no build step.

## How it works

The stick works out the gestures itself and sends short named events over Bluetooth LE. The browser never gets raw sensor data. The same events come from the stick, the keyboard and the on-screen buttons, so the game behaves the same with or without the stick.

| You do | Stick sends | Game does | Without the stick |
|---|---|---|---|
| Sharp swing | `HIGH_G`: more than 3 g for at least 50 ms | **Slash**: 8–12 damage, combo bonus, crits | `H` / `Enter` / click the game / SLASH button |
| Double tap on the case (screen or back) | `TAP2` | **Special "cross slash"**: 30–40 damage, 4 s cooldown | `Space` / SPECIAL button |
| Lay it flat on the table | `FLAT 1`; picking it up sends `FLAT 0` | **Pause / resume** | `F` toggles / LAY FLAT button |
| Button A | `BTN` | spare special key | `A` |

`G` opens an event log under the game. It works with the stick connected too and shows each event, its sequence number, any lost events, battery and the flat state.

Some decisions that matter:
- **A swing and a tap are told apart by how long they last, not how hard they are.** A knock is a short spike, while a swing stays above 3 g for at least 50 ms. Taps are ignored during a swing and for 400 ms after it, so a swing never fires a special by accident.
- **"Flat" means flat *and still* for 0.6 s.** Holding the sword level in the middle of a fight won't pause the game. If you move it clearly or tilt it, the game resumes.
- About 0.5 s after connecting, the stick sends a "state packet". If it was already lying on the table, the game starts paused.
- If Bluetooth drops, the game pauses and shows **Reconnect**, which doesn't open the device picker again, and **Play without stick**.

## Building the firmware (Arduino IDE)

1. Boards Manager: install **M5Stack**. Board: **M5Stack → M5StickCPlus2**.
2. Library Manager: install **M5Unified** (a recent version); it brings M5GFX with it. Bluetooth comes with the ESP32 core.
3. If you get "Sketch too big": **Tools → Partition Scheme →** pick one with a bigger app area, for example "Huge APP (3MB No OTA)". The Bluetooth stack is large.
4. Upload, then open the Serial Monitor at **115200**.

On the stick, the screen shows the connection, the battery and the last gesture in a coloured box for 1.5 s, which helps when tuning. Hold **A for 2 s** to switch it off. The screen goes dark after 30 s and A wakes it.

The MPU6886 has no built-in gesture detection like newer chips do, so the firmware detects everything itself, 200 times a second.

## Tuning (on the real stick)

All thresholds are named constants at the top of the `.ino`, each with a note on what raising or lowering it does. Twice a second the Serial Monitor prints the strongest acceleration (`peak|a|`), the biggest jump on the tap axis (`peakTapJump`), the tilt (`gz`) and how much the stick is moving (`motion`). Use these numbers to set:
- **Swings missed:** lower `HIGH_G_G` to 2.5. **Waving counts as a slash:** raise it to 3.5.
- **Double tap comes out as two single taps:** raise `TAP_GAP_MS`. **Light taps missed:** lower `TAP_JERK_G` to about 0.7.
- **Taps on the side of the case don't work:** taps are only detected on the screen and back (Z axis). Set `TAP_AXIS` to 0 or 1 for the sides.
- **Pause triggers too soon or too late:** change `FLAT_STILL_MS`.

## Running the game

- **With the stick:** Web Bluetooth only works in **Chrome or Edge** (desktop or Android), and only from `https://` or `http://localhost`. In the game folder run `python -m http.server 8000`, open `http://localhost:8000/`, click **Connect stick** and choose **StickCP2-Sword**. To play from anywhere, put `index.html` on GitHub Pages, which gives you HTTPS for free.
- **Without the stick:** click **Play without stick**. This works in any browser, even if you just double-click `index.html` (as a `file://` page), and on a phone with the on-screen buttons.

## Changing it later

- All game numbers (HP, damage, cooldown, combo window) are in `CFG` at the top of the script.
- The firmware and the page share the Bluetooth service ID and event numbers. If you add a gesture, give it a **new** event number at the end of the list and don't renumber the existing ones. The rest of the list is already reserved in both files: tilt, drop, wrist spin and so on.
- Testing from the browser console: `__test.pause(true)`, then `__test.ev(__test.EV.HIGH_G)`, then `__test.step(30)`, then `__test.draw()`.
- If you film a short clip of each gesture with your phone, they could go into a calibration screen that teaches new players the moves.
