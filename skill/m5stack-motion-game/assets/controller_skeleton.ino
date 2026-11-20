/*
 * Minimal M5Stack motion controller — starting template (not compiled as-is; tune on hardware).
 *
 * Works on any M5Unified board with an IMU (StickS3, StickC Plus2, Cardputer ADV, ...):
 * gestures are detected in software from M5.Imu at 200 Hz, so no vendor gesture engine is needed.
 * For BMI270 boards the on-chip legacy gesture engine is better for taps — see references/firmware.md.
 *
 * Libraries: M5Unified, M5GFX. BLE comes with the ESP32 core.
 * Protocol: see references/protocol.md (12-byte event packets, 1-byte commands, Battery Service).
 */
#include <M5Unified.h>
#include <atomic>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLE2902.h>

// Declared before any function: the Arduino IDE inserts auto-prototypes above the first function
struct Event { uint32_t t; uint8_t id, code, seq, aux; uint16_t extra; };

// ---------- Settings ----------
const char* BLE_NAME   = "MyStick";                                  // unique per device model
const char* SVC_UUID   = "00000000-0000-4000-8000-000000000001";     // generate your own UUIDs
const char* EVT_UUID   = "00000000-0000-4000-8000-000000000002";
const char* CMD_UUID   = "00000000-0000-4000-8000-000000000003";

enum : uint8_t { EV_TAP1, EV_TAP2, EV_TAP3, EV_ANY_MOT, EV_NO_MOT, EV_SIG_MOT,
                 EV_HIGH_G, EV_LOW_G, EV_FLAT, EV_ORIENT, EV_REEL, EV_BLOW, EV_BTN };

const uint32_t POLL_MS        = 5;      // 200 Hz
const float    HIGH_G_G       = 3.0f;   // jerk: |a| above this...
const uint32_t HIGH_G_MS      = 50;     // ...for at least this long (a tap knock is shorter)
const uint32_t HIGH_G_LOCK_MS = 400;
const float    LOW_G_G        = 0.4f;   // drop: |a| below this...
const uint32_t LOW_G_MS       = 30;
const int      TAP_AXIS       = 2;      // knock on screen/back = Z
const float    TAP_JERK_G     = 0.9f;   // jump between consecutive samples that starts a tap
const float    TAP_QUIET_G    = 0.35f;  // "calmed down"
const uint32_t TAP_SHOCK_MS   = 40;     // must calm down within this, else not a tap
const uint32_t TAP_DEAD_MS    = 80;     // case ringing after a knock
const uint32_t TAP_GAP_MS     = 350;    // max pause inside a double/triple tap
const float    FLAT_ON_Z      = 0.90f, FLAT_OFF_Z = 0.75f;
const float    GRAVITY_K      = 0.04f;

QueueHandle_t bleQueue;
std::atomic<bool> bleConnected{false}, flatNow{false}, reelWanted{false}, micWanted{false};
uint8_t seq = 0;

void sendEvent(uint8_t id, uint8_t code = 0, uint8_t aux = 0, uint16_t extra = 0) {
  Event e{ millis(), id, code, seq++, aux, extra };
  if (xQueueSend(bleQueue, &e, 0) != pdTRUE) Serial.println("BLE queue full");   // client sees a seq gap
  Serial.printf("[%lu] event %u code %u\n", (unsigned long)e.t, id, code);
}

// ---------- Gesture detection (imuTask only) ----------
struct {
  bool init = false; float prev[3], grav[3];
  uint32_t highSince = 0, highLock = 0, lowSince = 0, lowLock = 0;
  float highPeak = 0; uint8_t highCode = 0;
  uint32_t shockAt = 0, lastTap = 0; bool shockBig = false; int taps = 0;
} d;

void detect(uint32_t now, float ax, float ay, float az) {
  float a[3] = { ax, ay, az };
  if (!d.init) { for (int i = 0; i < 3; i++) d.prev[i] = d.grav[i] = a[i]; d.init = true; }
  for (int i = 0; i < 3; i++) d.grav[i] += (a[i] - d.grav[i]) * GRAVITY_K;
  float mag = sqrtf(ax * ax + ay * ay + az * az);

  // HIGH-G: long strong acceleration; code = axis | sign of the largest component at the peak
  if (mag > HIGH_G_G) {
    if (!d.highSince) { d.highSince = now; d.highPeak = 0; }
    if (mag > d.highPeak) {
      int ax_ = 0; for (int i = 1; i < 3; i++) if (fabsf(a[i]) > fabsf(a[ax_])) ax_ = i;
      d.highPeak = mag; d.highCode = ax_ | (a[ax_] < 0 ? 0x80 : 0);
    }
    if (now - d.highSince >= HIGH_G_MS && now >= d.highLock) {
      sendEvent(EV_HIGH_G, d.highCode);
      d.highLock = now + HIGH_G_LOCK_MS; d.shockBig = true; d.taps = 0;   // a jerk, not a tap
    }
  } else d.highSince = 0;

  // LOW-G: near free fall
  if (mag < LOW_G_G) {
    if (!d.lowSince) d.lowSince = now;
    if (now - d.lowSince >= LOW_G_MS && now >= d.lowLock) { sendEvent(EV_LOW_G); d.lowLock = now + 400; }
  } else d.lowSince = 0;

  // TAP: short shock on one axis that calms down quickly; taps close together are combined
  float jerk = fabsf(a[TAP_AXIS] - d.prev[TAP_AXIS]);
  if (d.shockAt) {
    if (now - d.shockAt > TAP_SHOCK_MS) d.shockAt = 0;
    else if (jerk < TAP_QUIET_G && now - d.shockAt >= 15) {
      if (!d.shockBig) { d.taps = min(d.taps + 1, 3); d.lastTap = d.shockAt; }
      d.shockAt = 0;
    }
  } else if (jerk > TAP_JERK_G && now - d.lastTap >= TAP_DEAD_MS) { d.shockAt = now; d.shockBig = false; }
  if (d.taps && !d.shockAt && now - d.lastTap > TAP_GAP_MS) {
    sendEvent(d.taps == 1 ? EV_TAP1 : d.taps == 2 ? EV_TAP2 : EV_TAP3);
    d.taps = 0;
  }
  for (int i = 0; i < 3; i++) d.prev[i] = a[i];

  // FLAT with hysteresis, sent only on change
  float gz = fabsf(d.grav[2]);
  bool flat = flatNow;
  if (!flat && gz > FLAT_ON_Z) flat = true;
  if (flat && gz < FLAT_OFF_Z) flat = false;
  if (flat != flatNow) { flatNow = flat; sendEvent(EV_FLAT, flat ? 1 : 0); }
}

void imuTask(void*) {
  TickType_t wake = xTaskGetTickCount();
  for (;;) {
    float ax, ay, az;
    if (M5.Imu.getAccel(&ax, &ay, &az)) detect(millis(), ax, ay, az);
    // TODO: if (reelWanted && bleConnected) → gyro on + spin meter (references/firmware.md §5)
    vTaskDelayUntil(&wake, pdMS_TO_TICKS(POLL_MS));
  }
}

// ---------- BLE ----------
struct CmdCb : BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* c) override {
    if (c->getLength() < 1) return;
    uint8_t cmd = c->getData()[0];
    if (cmd <= 1) reelWanted = cmd == 1;        // 0 reel off, 1 reel on
    else if (cmd <= 3) micWanted = cmd == 3;    // 2 mic off, 3 mic on
  }
};
struct SrvCb : BLEServerCallbacks {
  void onConnect(BLEServer*) override { bleConnected = true; }
  void onDisconnect(BLEServer*) override { bleConnected = false; }
};

BLECharacteristic* notifyChar(BLEService* s, BLEUUID u) {
  BLECharacteristic* c = s->createCharacteristic(u, BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY);
#if defined(CONFIG_BLUEDROID_ENABLED)
  c->addDescriptor(new BLE2902());   // NimBLE adds it by itself
#endif
  return c;
}

void pack(uint8_t* p, const Event& e) {
  memset(p, 0, 12);
  p[0] = e.id; p[1] = e.code; p[2] = e.seq; p[3] = e.aux;
  memcpy(p + 4, &e.t, 4); memcpy(p + 8, &e.extra, 2);   // ESP32 is little-endian
}

void bleTask(void*) {
  BLEDevice::init(BLE_NAME);
  BLEDevice::setPower(ESP_PWR_LVL_N0);
  BLEServer* srv = BLEDevice::createServer();
  srv->setCallbacks(new SrvCb());
  BLEService* svc = srv->createService(SVC_UUID);
  BLECharacteristic* evt = notifyChar(svc, BLEUUID(EVT_UUID));
  BLECharacteristic* cmd = svc->createCharacteristic(BLEUUID(CMD_UUID),
      BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_WRITE_NR);
  cmd->setCallbacks(new CmdCb());
  svc->start();
  BLEService* bat = srv->createService(BLEUUID((uint16_t)0x180F));
  BLECharacteristic* batChar = notifyChar(bat, BLEUUID((uint16_t)0x2A19));
  bat->start();

  BLEAdvertising* adv = BLEDevice::getAdvertising();
  BLEAdvertisementData a, sr;
  a.setFlags(0x06);
  a.setCompleteServices(BLEUUID(SVC_UUID));   // browser filters by service UUID
  sr.setName(BLE_NAME);                       // name goes into the scan response
  adv->setAdvertisementData(a); adv->setScanResponseData(sr);
  adv->setMinInterval(480); adv->setMaxInterval(800);   // 300-500 ms: saves battery
  BLEDevice::startAdvertising();

  uint8_t pkt[12]; bool was = false; uint32_t lastBat = 0; bool batDue = true;
  for (;;) {
    Event e;
    if (xQueueReceive(bleQueue, &e, pdMS_TO_TICKS(1000)) == pdTRUE && bleConnected) {
      pack(pkt, e); evt->setValue(pkt, 12); evt->notify();
    }
    bool c = bleConnected;
    if (c != was) {
      was = c;
      if (c) {   // give the client time to subscribe, then send the state packet
        vTaskDelay(pdMS_TO_TICKS(500));
        Event s{ millis(), 0xFF, (uint8_t)(flatNow ? 1 : 0), 0, 0, 0 };
        pack(pkt, s); evt->setValue(pkt, 12); evt->notify();
        batDue = true;
      } else {
        reelWanted = micWanted = false;
        vTaskDelay(pdMS_TO_TICKS(300));
        BLEDevice::startAdvertising();
      }
    }
    if (batDue || millis() - lastBat >= 60000) {
      batDue = false; lastBat = millis();
      int lvl = M5.Power.getBatteryLevel();
      if (lvl >= 0 && lvl <= 100) { uint8_t b = lvl; batChar->setValue(&b, 1); if (c) batChar->notify(); }
    }
  }
}

// ---------- Arduino ----------
void setup() {
  auto cfg = M5.config();
  M5.begin(cfg);
  setCpuFrequencyMhz(80);            // lowest clock where BLE works
  Serial.begin(115200);
  M5.Display.setBrightness(60);
  M5.Display.fillScreen(TFT_BLACK);
  M5.Display.drawString(BLE_NAME, 4, 4);
  Serial.printf("IMU type: %d\n", (int)M5.Imu.getType());
  bleQueue = xQueueCreate(32, sizeof(Event));
  xTaskCreatePinnedToCore(imuTask, "imu", 4096, nullptr, 2, nullptr, 0);
  xTaskCreatePinnedToCore(bleTask, "ble", 8192, nullptr, 1, nullptr, 0);
}

void loop() {
  M5.update();
  if (M5.BtnA.wasPressed()) sendEvent(EV_BTN, 1);
  delay(10);
}
