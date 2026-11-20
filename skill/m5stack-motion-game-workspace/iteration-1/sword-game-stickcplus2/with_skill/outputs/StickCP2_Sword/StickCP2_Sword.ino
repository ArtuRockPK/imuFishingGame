/*
 * StickCP2_Sword — M5StickC Plus2 as a Bluetooth LE "sword" controller for a browser game.
 *
 * The stick recognises gestures itself and sends small named events; the browser never sees
 * raw sensor data. Gestures (all detected in software from the MPU6886 at 200 Hz — this IMU
 * has no gesture engine):
 *   sharp swing                  -> HIGH_G  (|a| > 3 g for >= 50 ms)        = SLASH
 *   laid flat on the table, still -> FLAT 1, picked up -> FLAT 0             = PAUSE / RESUME
 *   double tap on the case        -> TAP2   (knock on the screen or back)    = SPECIAL ATTACK
 *   (also sent: TAP1, TAP3, BTN for button A — the game uses BTN as a spare special/start key)
 *
 * ---------------------------------------------------------------------------------------------
 * HOW TO BUILD (Arduino IDE)
 *   Board package : "M5Stack" boards (Boards Manager -> search "M5Stack")
 *   Board         : Tools -> Board -> M5Stack -> M5StickCPlus2
 *   Libraries     : M5Unified (recent version) + M5GFX (installed with it). BLE comes with the core.
 *   Partition     : if you get "Sketch too big", Tools -> Partition Scheme -> pick one with a
 *                   bigger app area (e.g. "Huge APP (3MB No OTA)" or the 8 MB default).
 *   Serial Monitor: 115200 baud — prints every event and live sensor values for tuning.
 *
 * BUTTONS
 *   A (front, under the screen): short press = BTN event (+ wakes the screen); hold 2 s = power off.
 *   Power button (left side): press to power on.
 *
 * ---------------------------------------------------------------------------------------------
 * BLE PROTOCOL (the web page must use the same UUIDs)
 *   Device name      : "StickCP2-Sword"   (in the scan response)
 *   Service          : 7a1c0001-3f5e-4b2a-9d6c-8e4f2b1a0c57   (in the advertising packet)
 *     Event char     : 7a1c0002-3f5e-4b2a-9d6c-8e4f2b1a0c57   read + notify, 12 bytes LE
 *   Battery Service  : 0x180F / Battery Level 0x2A19          read + notify, percent
 *
 *   Event packet (12 bytes):
 *     [0] event id (below), 0xFF = state packet sent ~0.5 s after connect (code = 1 if flat now)
 *     [1] code (HIGH_G: bits 0-1 axis 0=X 1=Y 2=Z, bit 7 = negative sign; FLAT: 1 flat / 0 up)
 *     [2] sequence number (uint8, wraps) — a gap on the client means an event was dropped
 *     [3] reserved (0)
 *     [4..7] device time, ms, uint32
 *     [8..11] reserved (0) — room to grow; the client ignores bytes it does not know
 *
 *   Event ids (append-only; never renumber, old firmware must keep working):
 *     0 TAP1  1 TAP2  2 TAP3  3 ANY_MOT  4 NO_MOT  5 SIG_MOT  6 HIGH_G  7 LOW_G
 *     8 FLAT  9 ORIENT  10 REEL  11 BLOW  12 BTN
 *   This firmware sends: TAP1, TAP2, TAP3, HIGH_G, FLAT, BTN. The other ids are reserved so
 *   this controller stays compatible with the larger protocol if you add gestures later.
 */
#include <M5Unified.h>
#include <atomic>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLE2902.h>

// Declared before any function: the Arduino IDE inserts auto-prototypes above the first function
struct Event { uint32_t t; uint8_t id, code, seq; };

// ============================== Settings ==============================
const char* BLE_NAME = "StickCP2-Sword";
const char* SVC_UUID = "7a1c0001-3f5e-4b2a-9d6c-8e4f2b1a0c57";
const char* EVT_UUID = "7a1c0002-3f5e-4b2a-9d6c-8e4f2b1a0c57";

enum : uint8_t { EV_TAP1, EV_TAP2, EV_TAP3, EV_ANY_MOT, EV_NO_MOT, EV_SIG_MOT,
                 EV_HIGH_G, EV_LOW_G, EV_FLAT, EV_ORIENT, EV_REEL, EV_BLOW, EV_BTN };
const char* EV_LABEL[] = { "TAP", "DOUBLE TAP", "TRIPLE TAP", "MOVE", "STILL", "SIG MOT",
                           "SLASH", "DROP", "FLAT", "ORIENT", "REEL", "BLOW", "BUTTON" };

// ---- Gesture thresholds: tune on your hardware (watch the Serial Monitor) ----
const uint32_t POLL_MS        = 5;      // 200 Hz sampling (taps need it)

// SLASH (HIGH_G). A swing is weaker than a knock but LONGER — that is what separates them.
const float    HIGH_G_G       = 3.0f;   // |a| must exceed this... raise if normal waving slashes,
                                        //   lower if real swings are missed (try 2.5)
const uint32_t HIGH_G_MS      = 50;     // ...continuously for this long. Lower = more sensitive,
                                        //   but taps may start counting as slashes
const uint32_t HIGH_G_LOCK_MS = 400;    // one swing = one slash; raise if a swing gives two

// DOUBLE TAP (knock with a fingertip on the screen or the back)
const int      TAP_AXIS       = 2;      // Z = through the screen. 0/1 for side knocks (X/Y)
const float    TAP_JERK_G     = 0.9f;   // jump between consecutive samples that starts a tap;
                                        //   lower = lighter taps work, but more false taps
const float    TAP_QUIET_G    = 0.35f;  // the shock must calm down below this...
const uint32_t TAP_SHOCK_MS   = 40;     // ...within this time, otherwise it was not a tap
const uint32_t TAP_DEAD_MS    = 80;     // ignore case ringing right after a knock
const uint32_t TAP_GAP_MS     = 350;    // max pause between taps of one double tap; raise if
                                        //   your double taps come out as two single taps

// FLAT (pause). "Lying on the table" = screen up or down AND still for a moment, so holding
// the sword horizontally mid-fight does not pause the game.
const float    FLAT_ON_Z      = 0.90f;  // gravity on Z above this (g) can count as flat...
const float    FLAT_OFF_Z     = 0.75f;  // ...and below this it is no longer flat (hysteresis)
const float    STILL_MOT_G    = 0.04f;  // smoothed motion below this = "lying still"
const uint32_t FLAT_STILL_MS  = 600;    // must lie flat and still this long before pausing
const float    PICKUP_MOT_G   = 0.15f;  // smoothed motion above this = picked up (even if level)
const float    GRAVITY_K      = 0.04f;  // gravity low-pass (per 5 ms sample, ~125 ms)
const float    MOTION_K       = 0.05f;  // motion smoothing (~100 ms); taps barely move it

// Screen / power
const uint8_t  SCREEN_BRIGHT  = 60;     // 0..255; lower saves battery
const uint32_t SCREEN_OFF_MS  = 30000;  // screen off after this long without a button press (0 = never)
const uint32_t POWER_OFF_HOLD = 2000;   // hold button A this long to power off

// ============================== Shared state ==============================
QueueHandle_t bleQueue, screenQueue;
std::atomic<bool> bleConnected{false}, flatNow{false};
std::atomic<int>  batteryPct{-1};
std::atomic<uint8_t> bleSeq{0};
// live values for the Serial tuning printout (written by imuTask only)
volatile float dbgPeakG = 0, dbgGz = 0, dbgMot = 0, dbgPeakJerk = 0;

void sendEvent(uint8_t id, uint8_t code = 0) {
  Event e{ millis(), id, code, 0 };
  xQueueSend(screenQueue, &e, 0);
  Serial.printf("[%lu] EVENT %s code=0x%02X\n", (unsigned long)e.t, EV_LABEL[id], code);
  if (!bleConnected) return;                       // drop events while nobody listens
  e.seq = bleSeq++;                                // assigned at push time -> a full queue shows as a gap
  if (xQueueSend(bleQueue, &e, 0) != pdTRUE) Serial.println("BLE queue full");
}

// ============================== Gesture detection (imuTask only) ==============================
struct {
  bool init = false; float prev[3], grav[3]; float mot = 0;
  uint32_t highSince = 0, highLock = 0; float highPeak = 0; uint8_t highCode = 0;
  uint32_t shockAt = 0, lastTap = 0; int taps = 0;
  uint32_t flatCandSince = 0;
} d;

void detect(uint32_t now, float ax, float ay, float az) {
  float a[3] = { ax, ay, az };
  if (!d.init) { for (int i = 0; i < 3; i++) d.prev[i] = d.grav[i] = a[i]; d.init = true; }
  for (int i = 0; i < 3; i++) d.grav[i] += (a[i] - d.grav[i]) * GRAVITY_K;
  float mag = sqrtf(ax * ax + ay * ay + az * az);
  float lx = ax - d.grav[0], ly = ay - d.grav[1], lz = az - d.grav[2];
  float lin = sqrtf(lx * lx + ly * ly + lz * lz);     // linear acceleration (gravity removed)
  d.mot += (lin - d.mot) * MOTION_K;
  if (mag > dbgPeakG) dbgPeakG = mag;

  // ---- SLASH: long strong acceleration; code = axis | sign of the largest component at the peak
  if (mag > HIGH_G_G) {
    if (!d.highSince) { d.highSince = now; d.highPeak = 0; }
    if (mag > d.highPeak) {
      int m = 0; for (int i = 1; i < 3; i++) if (fabsf(a[i]) > fabsf(a[m])) m = i;
      d.highPeak = mag; d.highCode = m | (a[m] < 0 ? 0x80 : 0);
    }
    if (now - d.highSince >= HIGH_G_MS && now >= d.highLock) {
      sendEvent(EV_HIGH_G, d.highCode);
      d.highLock = now + HIGH_G_LOCK_MS;
      d.taps = 0; d.shockAt = 0;                     // it was a swing, not taps
    }
  } else d.highSince = 0;

  // ---- TAP: short shock on one axis that calms down quickly; taps close together are combined
  float jerk = fabsf(a[TAP_AXIS] - d.prev[TAP_AXIS]);
  if (jerk > dbgPeakJerk) dbgPeakJerk = jerk;
  bool swinging = now < d.highLock || d.highSince;    // no taps during / right after a swing
  if (d.shockAt) {
    if (now - d.shockAt > TAP_SHOCK_MS || swinging) d.shockAt = 0;         // too long: not a tap
    else if (jerk < TAP_QUIET_G && now - d.shockAt >= 15) {
      d.taps = min(d.taps + 1, 3); d.lastTap = d.shockAt; d.shockAt = 0;
    }
  } else if (!swinging && jerk > TAP_JERK_G && now - d.lastTap >= TAP_DEAD_MS) d.shockAt = now;
  if (d.taps && !d.shockAt && now - d.lastTap > TAP_GAP_MS) {
    sendEvent(d.taps == 1 ? EV_TAP1 : d.taps == 2 ? EV_TAP2 : EV_TAP3);
    d.taps = 0;
  }
  for (int i = 0; i < 3; i++) d.prev[i] = a[i];

  // ---- FLAT: level + still for FLAT_STILL_MS -> 1; tilted or clearly moving -> 0 (sent on change)
  float gz = fabsf(d.grav[2]);
  dbgGz = gz; dbgMot = d.mot;
  bool flat = flatNow;
  if (!flat) {
    if (gz > FLAT_ON_Z && d.mot < STILL_MOT_G) {
      if (!d.flatCandSince) d.flatCandSince = now;
      if (now - d.flatCandSince >= FLAT_STILL_MS) flat = true;
    } else d.flatCandSince = 0;
  } else if (gz < FLAT_OFF_Z || d.mot > PICKUP_MOT_G) {
    flat = false; d.flatCandSince = 0;
  }
  if (flat != flatNow) { flatNow = flat; sendEvent(EV_FLAT, flat ? 1 : 0); }
}

void imuTask(void*) {
  TickType_t wake = xTaskGetTickCount();
  uint32_t lastDbg = 0;
  for (;;) {
    float ax, ay, az;
    if (M5.Imu.getAccel(&ax, &ay, &az)) detect(millis(), ax, ay, az);
    if (millis() - lastDbg >= 500) {                // tuning printout, twice a second
      lastDbg = millis();
      Serial.printf("peak|a|=%.2fg (slash>%.1f)  peakTapJump=%.2fg (tap>%.2f)  gz=%.2f  motion=%.3f  flat=%d\n",
                    dbgPeakG, HIGH_G_G, dbgPeakJerk, TAP_JERK_G, dbgGz, dbgMot, (int)flatNow);
      dbgPeakG = 0; dbgPeakJerk = 0;
    }
    vTaskDelayUntil(&wake, pdMS_TO_TICKS(POLL_MS));
  }
}

// ============================== BLE ==============================
struct SrvCb : BLEServerCallbacks {
  void onConnect(BLEServer*) override { bleConnected = true; }
  void onDisconnect(BLEServer*) override { bleConnected = false; }
};

BLECharacteristic* notifyChar(BLEService* s, BLEUUID u) {
  BLECharacteristic* c = s->createCharacteristic(u, BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY);
#if defined(CONFIG_BLUEDROID_ENABLED)
  c->addDescriptor(new BLE2902());   // NimBLE adds the CCCD by itself
#endif
  return c;
}

void pack(uint8_t* p, const Event& e) {
  memset(p, 0, 12);
  p[0] = e.id; p[1] = e.code; p[2] = e.seq;
  memcpy(p + 4, &e.t, 4);            // ESP32 is little-endian
}

void bleTask(void*) {
  BLEDevice::init(BLE_NAME);
  BLEDevice::setPower(ESP_PWR_LVL_N0);              // 0 dBm is plenty for a room
  BLEServer* srv = BLEDevice::createServer();
  srv->setCallbacks(new SrvCb());
  BLEService* svc = srv->createService(SVC_UUID);
  BLECharacteristic* evt = notifyChar(svc, BLEUUID(EVT_UUID));
  svc->start();
  BLEService* bat = srv->createService(BLEUUID((uint16_t)0x180F));
  BLECharacteristic* batChar = notifyChar(bat, BLEUUID((uint16_t)0x2A19));
  bat->start();

  BLEAdvertising* adv = BLEDevice::getAdvertising();
  BLEAdvertisementData a, sr;
  a.setFlags(0x06);
  a.setCompleteServices(BLEUUID(SVC_UUID));         // the browser filters by service UUID
  sr.setName(BLE_NAME);                             // 128-bit UUID + name don't fit in one packet
  adv->setAdvertisementData(a);
  adv->setScanResponseData(sr);
  adv->setMinInterval(480); adv->setMaxInterval(800);   // 300-500 ms: saves battery
  BLEDevice::startAdvertising();
  Serial.println("BLE advertising as StickCP2-Sword");

  uint8_t pkt[12]; bool was = false; uint32_t lastBat = 0; bool batDue = true;
  for (;;) {
    Event e;
    if (xQueueReceive(bleQueue, &e, pdMS_TO_TICKS(200)) == pdTRUE && bleConnected) {
      pack(pkt, e); evt->setValue(pkt, 12); evt->notify();
    }
    bool c = bleConnected;
    if (c != was) {
      was = c;
      if (c) {   // give the browser time to subscribe, then tell it whether the stick lies flat
        Serial.println("BLE connected");
        vTaskDelay(pdMS_TO_TICKS(500));
        Event s{ millis(), 0xFF, (uint8_t)(flatNow ? 1 : 0), 0 };
        pack(pkt, s); evt->setValue(pkt, 12); evt->notify();
        batDue = true;
      } else {
        Serial.println("BLE disconnected");
        xQueueReset(bleQueue);
        vTaskDelay(pdMS_TO_TICKS(300));
        BLEDevice::startAdvertising();
      }
    }
    if (batDue || millis() - lastBat >= 60000) {
      batDue = false; lastBat = millis();
      int lvl = batteryPct;
      if (lvl >= 0 && lvl <= 100) { uint8_t b = lvl; batChar->setValue(&b, 1); if (c) batChar->notify(); }
    }
  }
}

// ============================== Screen (loop, core 1) ==============================
M5Canvas canvas(&M5.Display);
Event lastEv{ 0, 0xFE, 0, 0 };
uint32_t lastEvShownAt = 0, lastButtonAt = 0;
bool screenOn = true;

uint16_t eventColor(uint8_t id) {
  switch (id) {
    case EV_HIGH_G: return TFT_RED;
    case EV_TAP2:   return TFT_MAGENTA;
    case EV_FLAT:   return TFT_BLUE;
    case EV_BTN:    return TFT_DARKGREEN;
    default:        return TFT_DARKGREY;
  }
}

void drawScreen() {
  canvas.fillSprite(TFT_BLACK);
  canvas.setTextDatum(top_left);
  canvas.setTextColor(TFT_WHITE);
  canvas.setFont(&fonts::Font2);
  canvas.drawString("SWORD", 4, 4);
  int b = batteryPct;
  canvas.drawString(b >= 0 ? String(b) + "%" : String("--"), 96, 4);
  canvas.setTextColor(bleConnected ? TFT_GREEN : TFT_ORANGE);
  canvas.drawString(bleConnected ? "connected" : "waiting...", 4, 24);
  canvas.setTextColor(TFT_LIGHTGREY);
  canvas.drawString(flatNow ? "FLAT (pause)" : "in hand", 4, 44);

  // last event tile: lit for 1.5 s
  bool lit = lastEv.id != 0xFE && millis() - lastEvShownAt < 1500;
  canvas.fillRoundRect(4, 72, 127, 70, 6, lit ? eventColor(lastEv.id) : 0x2104);
  canvas.setTextDatum(middle_center);
  canvas.setTextColor(TFT_WHITE);
  if (lastEv.id != 0xFE) {
    canvas.setFont(&fonts::Font2);
    canvas.drawString(EV_LABEL[lastEv.id], 67, 98);
    if (lastEv.id == EV_HIGH_G) {
      char s[8]; snprintf(s, sizeof s, "%c%c", (lastEv.code & 0x80) ? '-' : '+', "XYZ?"[lastEv.code & 3]);
      canvas.drawString(s, 67, 120);
    } else if (lastEv.id == EV_FLAT) canvas.drawString(lastEv.code ? "laid down" : "picked up", 67, 120);
  } else canvas.drawString("swing me!", 67, 107);

  canvas.setTextDatum(top_left);
  canvas.setFont(&fonts::Font0);
  canvas.setTextColor(TFT_DARKGREY);
  canvas.drawString("swing   = slash", 4, 156);
  canvas.drawString("2x tap  = special", 4, 168);
  canvas.drawString("lay flat= pause", 4, 180);
  canvas.drawString("hold A 2s = off", 4, 200);
  canvas.drawString(BLE_NAME, 4, 222);
  canvas.pushSprite(0, 0);
}

// ============================== Arduino ==============================
void setup() {
  auto cfg = M5.config();
  M5.begin(cfg);                                    // also keeps the Plus2 power-hold pin high
  setCpuFrequencyMhz(80);                           // lowest clock where BLE works
  Serial.begin(115200);
  M5.Speaker.end();                                 // not used: save power
  M5.Display.setRotation(0);                        // portrait 135x240, held like a sword hilt
  M5.Display.setBrightness(SCREEN_BRIGHT);
  canvas.createSprite(M5.Display.width(), M5.Display.height());

  Serial.printf("IMU type: %d (expect MPU6886)\n", (int)M5.Imu.getType());
  if (!M5.Imu.isEnabled()) Serial.println("IMU NOT FOUND - gestures will not work");
  batteryPct = M5.Power.getBatteryLevel();

  bleQueue    = xQueueCreate(32, sizeof(Event));
  screenQueue = xQueueCreate(16, sizeof(Event));
  xTaskCreatePinnedToCore(imuTask, "imu", 4096, nullptr, 2, nullptr, 0);
  xTaskCreatePinnedToCore(bleTask, "ble", 8192, nullptr, 1, nullptr, 0);
  lastButtonAt = millis();
}

void loop() {
  M5.update();
  uint32_t now = millis();

  if (M5.BtnA.wasPressed()) {
    lastButtonAt = now;
    if (!screenOn) { screenOn = true; M5.Display.wakeup(); M5.Display.setBrightness(SCREEN_BRIGHT); }
    sendEvent(EV_BTN, 1);
  }
  if (M5.BtnA.pressedFor(POWER_OFF_HOLD)) {
    canvas.fillSprite(TFT_BLACK); canvas.setTextDatum(middle_center);
    canvas.drawString("bye", 67, 120); canvas.pushSprite(0, 0);
    delay(500);
    M5.Power.powerOff();
  }

  Event e;
  while (xQueueReceive(screenQueue, &e, 0) == pdTRUE) { lastEv = e; lastEvShownAt = now; }

  static uint32_t lastBatRead = 0;
  if (now - lastBatRead >= 30000) { lastBatRead = now; batteryPct = M5.Power.getBatteryLevel(); }

  if (SCREEN_OFF_MS && screenOn && now - lastButtonAt > SCREEN_OFF_MS) {
    screenOn = false; M5.Display.setBrightness(0); M5.Display.sleep();
  }
  static uint32_t lastDraw = 0;
  if (screenOn && now - lastDraw >= 50) { lastDraw = now; drawScreen(); }
  delay(10);
}
