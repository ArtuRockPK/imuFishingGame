# BLE protocol

One custom GATT service plus the standard Battery Service. All controller models use the
same UUIDs and layout, so the game and the test page work with any of them unchanged.
Generate your own UUIDs for a new project (any random 128-bit base) — the ones below are the
fishing game's.

```
Service          b5e10001-6d2a-4c8e-9f3b-1a7c5e2d9f40
 Event char      b5e10002-...  read + notify   12 bytes, little-endian
 Command char    b5e10003-...  write + write-without-response, 1 byte
Battery Service  0x180F / Battery Level 0x2A19  read + notify, percent
```

Advertising: put the **service UUID in the main advertising packet** (Web Bluetooth's
`requestDevice({filters:[{services:[UUID]}]})` filters on it) and the **name in the scan
response** (a 128-bit UUID plus a name don't fit together in 31 bytes). Give each model its own
name ("StickS3-Rod", "StickCP2-Rod", "Cardputer-Rod") — the game uses the name as the key for
per-device calibration and to pick device-specific gesture videos.

## Event packet (12 bytes)

| Byte | Meaning |
|---|---|
| 0 | event id (table below); `0xFF` = state packet sent ~0.5 s after connect |
| 1 | detail code (per event, below) |
| 2 | sequence number, uint8, wraps; assigned when queued, so a gap = event dropped on device |
| 3 | REEL: spin direction "aux" byte (below); otherwise 0 |
| 4–7 | device time, ms, uint32 |
| 8–9 | REEL: turns since reel enabled ×100, uint16; otherwise 0 |
| 10 | REEL diagnostics: strength of best direction method, rad×40 |
| 11 | REEL diagnostics: main-axis share, % |

Fixed size keeps parsing trivial and leaves room to grow; the client reads bytes it knows and
ignores the rest, so shorter packets from older firmware still parse.

## Event ids

Append only. Reusing a retired id is OK only if no shipped game reacts to the old meaning.

| id | name | code | how it is produced |
|---|---|---|---|
| 0 | TAP1 | – | single tap on the case |
| 1 | TAP2 | – | double tap |
| 2 | TAP3 | – | triple tap |
| 3 | ANY_MOT | – | device moved (throttled to ≤ 1 per 500 ms) |
| 4 | NO_MOT | – | still for ~2 s (throttled) |
| 5 | SIG_MOT | – | sustained motion |
| 6 | HIGH_G | bits 0-1 axis (0 X,1 Y,2 Z,3 ?), bit 7 sign | sharp jerk: > 3 g for ≥ 50 ms |
| 7 | LOW_G | – | free fall / sharp drop: < 0.4–0.6 g |
| 8 | FLAT | 1 laid flat, 0 picked up | from accel z with hysteresis, sent on change |
| 9 | ORIENT | 0 PORT UP, 1 LAND L, 2 PORT DN, 3 LAND R | which edge points down |
| 10 | REEL | spin speed, tenths of rev/s (15 = 1.5 rev/s) | only while reel enabled, every 100 ms while spinning, one `0` on stop |
| 11 | BLOW | 1..255 strength at start, 0 at end | only while mic enabled |
| 12 | BTN | 1 | button A (sticks) / any key or G0 (Cardputer) |
| 0xFF | state | 1 if lying flat now | once after connect |

## REEL aux byte (byte 3)

```
bit 7   sign (1 = minus)              bits 0-1  axis: 0 X, 1 Y, 2 Z
bit 6   direction known               bit 5     method: twist (spins around own axis)
                                      bit 4     method: circle seen by accelerometer
                                      neither   method: circle seen by gyroscope
```

Without bit 6 the other bits still carry the best guess (useful on the test page).
The **direction key** the game compares is `aux & 0x83` (axis + sign); the method bits are
ignored because the same physical motion can be classified differently from moment to
moment. Clockwise for *this* device and grip is learned in calibration; counter-clockwise is
either the learned CCW key or the CW key with the sign flipped (`cw ^ 0x80`).

## Commands (1 byte, write without response)

| byte | meaning |
|---|---|
| 0 | REEL off (gyro to standby) |
| 1 | REEL on |
| 2 | MIC off |
| 3 | MIC on |

The device honours a command only while a client is connected and auto-disables after a
timeout (reel 60 s, mic 3 min) in case the page was closed. On the browser side serialise
writes through one promise chain — Web Bluetooth rejects a write while another GATT
operation is in progress.

## Versioning tips

- Old firmware without the command characteristic: catch the `getCharacteristic` failure and
  fall back (the fishing game used ORIENT turns instead of spin speed).
- When a feature needs new firmware (e.g. BTN), say so in the settings note and on the
  firmware screen; don't silently break.
- Detect "firmware can't report direction" in calibration: many REEL packets with almost no
  bit-6 → mark unsupported and skip the direction steps.
