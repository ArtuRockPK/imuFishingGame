/*
 * How to wire spin_direction.h into the reel code you already have (M5StickS3, BMI270).
 * This is a snippet, not a full sketch — names like readGyroDps()/readAccelG()/sendEvent()
 * stand for what your firmware already uses. Not compiled; build and tune on the stick.
 *
 * Board: M5StickS3. Libs: M5Unified (recent), M5GFX, SparkFun BMI270 (bundled Bosch API), ESP32 BLE.
 * Tools: USB CDC On Boot: Enabled, USB Mode: Hardware CDC and JTAG (for Serial).
 * Reminder: all BMI270 register access goes through M5.In_I2C, never Arduino Wire.
 */
#include "spin_direction.h"

// ---------------------------------------------------------------------------------------------
// 1) Event struct: make sure it carries aux (packet byte 3) and diag (bytes 10-11).
//    Declare it BEFORE any function (Arduino IDE auto-prototypes).
// struct ImuEvent { uint32_t t; uint8_t idx, code, seq; uint16_t extra; uint8_t aux; uint16_t diag; char detail[8]; };

// 2) Packing (in bleTask): byte 3 = aux, bytes 8-9 = turns*100, bytes 10-11 = diag
// void pack(uint8_t* p, const ImuEvent& e) {
//   memset(p, 0, 12);
//   p[0] = e.idx; p[1] = e.code; p[2] = e.seq; p[3] = e.aux;
//   memcpy(p + 4, &e.t, 4); memcpy(p + 8, &e.extra, 2); memcpy(p + 10, &e.diag, 2);   // little-endian
// }

// ---------------------------------------------------------------------------------------------
// 3) Reel-on safety timeout: restart it on EVERY "REEL on" command, so the game can keep the
//    reel alive with a periodic re-send during a long mini-game.
const uint32_t REEL_TIMEOUT_MS = 60000;
std::atomic<uint32_t> reelOnSince{0};
//   in CmdCb::onWrite:  if (cmd == 1) { reelWanted = true; reelOnSince = millis(); }
//                       if (cmd == 0)   reelWanted = false;

// ---------------------------------------------------------------------------------------------
// 4) Reel branch of imuTask (100 Hz while reel is on). Your speed meter stays as it is;
//    the new lines are marked NEW.
SpinDirection spinDir;                              // NEW
const uint32_t REEL_SEND_MS = 100;

void reelStep(uint32_t now) {                       // called every 10 ms while reelWanted && bleConnected
  static uint32_t lastSend = 0, lastSampleUs = 0, lastRotMs = 0;
  static bool spinning = false;

  if (now - reelOnSince > REEL_TIMEOUT_MS) { reelWanted = false; return; }   // browser vanished

  float gx, gy, gz, ax, ay, az;
  if (!readGyroDps(&gx, &gy, &gz) || !readAccelG(&ax, &ay, &az)) return;    // your BMI270 reads
  uint32_t us = micros();
  float dt = lastSampleUs ? (us - lastSampleUs) * 1e-6f : 0.01f;
  if (dt > 0.05f) dt = 0.01f;                                               // after a pause
  lastSampleUs = us;

  // ... your existing SpinMeter.add(...) calls and turn counting here ...
  spinDir.add(gx, gy, gz, ax, ay, az, dt);                                   // NEW

  float gyroDps = sqrtf(gx * gx + gy * gy + gz * gz);
  if (gyroDps >= SPIN_GYRO_MIN_DPS) lastRotMs = now;

  // Instant stop: gyro quiet for 80 ms -> send 0 right away (as you probably already do)
  if (spinning && now - lastRotMs > 80) {
    spinning = false;
    sendEvent(EV_REEL, "0", 0, turnsX100(), 0, 0);
    spinDir.reset();                                                         // NEW: next spin starts clean
    return;
  }

  if (now - lastSend >= REEL_SEND_MS) {
    lastSend = now;
    uint8_t aux = spinDir.encode();                                          // NEW (also decays)
    uint8_t speed10 = currentSpeedTenths();                                  // your smoothed rev/s * 10
    if (speed10 > 0) {
      spinning = true;
      char d[8]; snprintf(d, sizeof d, "%u.%u", speed10 / 10, speed10 % 10);
      sendEvent(EV_REEL, d, speed10, turnsX100(), aux, spinDir.diag());      // NEW: aux + diag
    }
    // Tuning output: watch this while spinning CW / CCW in different grips
    Serial.printf("reel %u.%u rps  dir %s axis %c%c known=%d  str=%u share=%u%%\n",
                  speed10 / 10, speed10 % 10, SpinDirection::methodName(aux),
                  (aux & 0x80) ? '-' : '+', "XYZ?"[aux & 3], (aux & 0x40) ? 1 : 0,
                  spinDir.diagStrength, spinDir.diagShare);
  }
}

// On reel off / disconnect: spinDir.reset(); and put the gyro back to standby
// (bmi2_sensor_disable for BMI2_GYRO) — the gyro only runs while the game asks for spin.

// ---------------------------------------------------------------------------------------------
// 5) Device screen (optional but handy): on the REEL tile draw an arrow for the direction key,
//    e.g. "+Z" / "-Z" in green when bit 6 is set, grey when it is only a guess.
//
// If you have other controller models (StickC Plus2, Cardputer ADV...), put the same
// SpinDirection into their firmware in the same change — it only needs gyro dps + accel g.
