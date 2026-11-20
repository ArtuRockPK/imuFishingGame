/*
  StickSword — M5StickC Plus2 as a Bluetooth (BLE) sword controller.

  Gestures (detected on the stick itself, sent as short text messages):
    sharp swing            -> "SLASH <peak_dps>"   e.g. "SLASH 812"
    lay flat on the table  -> "PAUSE"               (after ~1 s of lying still)
    pick it up again       -> "RESUME"
    double tap on the case -> "SPECIAL"
    button A (big front)   -> "SPECIAL"             (manual fallback)
    every 10 s             -> "BAT <percent>"
  On connect the stick sends "HELLO StickSword 1" and its current pause state.

  The game may write "BEEP" to the RX characteristic -> the stick beeps.

  Button B (side) long press (1 s) -> recalibrate gyro (lay the stick still first).

  Board:     M5StickCPlus2 (M5Stack board package)
  Libraries: M5Unified (Library Manager); BLE comes with the ESP32 core.
  If you get "Sketch too big": Tools -> Partition Scheme -> "Huge APP (3MB No OTA)".

  BLE: Nordic-UART-style service
    service 6e400001-b5a3-f393-e0a9-e50e24dcca9e
    TX (notify, stick->game) 6e400003-...
    RX (write,  game->stick) 6e400002-...
*/

#include <M5Unified.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

// ------------------------------------------------------------------ config
#define DEVICE_NAME  "StickSword"
#define SERVICE_UUID "6e400001-b5a3-f393-e0a9-e50e24dcca9e"
#define RX_UUID      "6e400002-b5a3-f393-e0a9-e50e24dcca9e"
#define TX_UUID      "6e400003-b5a3-f393-e0a9-e50e24dcca9e"

// Set to true to print raw sensor values to Serial (115200) for tuning.
static const bool DEBUG_STREAM = false;

// Slash: gyro speed (deg/s, magnitude of all 3 axes)
static const float    SLASH_TRIGGER_DPS = 350.0f;  // must exceed this to count as a swing
static const float    SLASH_REARM_DPS   = 120.0f;  // must fall below this before next slash
static const uint32_t SLASH_MIN_GAP_MS  = 250;

// Double tap: sudden jump of acceleration between two samples while the stick is NOT rotating much
static const float    TAP_JERK_G        = 0.85f;   // lower = more sensitive
static const float    TAP_MAX_GYRO_DPS  = 180.0f;  // ignore "taps" during swings
static const uint32_t TAP_DEBOUNCE_MS   = 70;      // one knock rings for a few ms
static const uint32_t TAP_MIN_GAP_MS    = 90;      // min time between the two taps
static const uint32_t TAP_MAX_GAP_MS    = 450;     // max time between the two taps
static const uint32_t TAP_AFTER_SLASH_MS = 400;    // no taps right after a slash

// Flat on the table
static const float    FLAT_MIN_Z_G      = 0.92f;   // |az| close to 1 g (screen up or down)
static const float    FLAT_MAX_XY_G     = 0.20f;
static const float    FLAT_MAX_GYRO_DPS = 6.0f;    // really still (hands shake more than this)
static const float    FLAT_MAX_JITTER_G = 0.03f;
static const uint32_t FLAT_HOLD_MS      = 1000;    // still this long -> PAUSE
static const uint32_t UNFLAT_HOLD_MS    = 200;     // moved this long -> RESUME

// ------------------------------------------------------------------ BLE
BLEServer*         bleServer = nullptr;
BLECharacteristic* txChar    = nullptr;
volatile bool      bleConnected   = false;
volatile bool      bleJustConnected = false;
volatile bool      beepRequested  = false;
bool               wasConnected   = false;

class ServerCB : public BLEServerCallbacks {
  void onConnect(BLEServer*) override    { bleConnected = true; bleJustConnected = true; }
  void onDisconnect(BLEServer*) override { bleConnected = false; }
};

class RxCB : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* c) override {
    auto v = c->getValue();            // std::string (core 2.x) or String (core 3.x)
    String s = String(v.c_str());
    s.trim();
    if (s == "BEEP") beepRequested = true;
  }
};

// ------------------------------------------------------------------ state
float gyroBiasX = 0, gyroBiasY = 0, gyroBiasZ = 0;
float prevAx = 0, prevAy = 0, prevAz = 1;
bool  havePrev = false;

// slash
bool     slashArmed     = true;
bool     inSwing        = false;
float    swingPeak      = 0;
uint32_t lastSlashMs    = 0;

// taps
uint32_t lastTapMs      = 0;     // last accepted single tap
uint32_t pendingTapMs   = 0;     // first tap of a possible double tap (0 = none)

// flat / pause
bool     paused         = false;
uint32_t flatSinceMs    = 0;
uint32_t unflatSinceMs  = 0;

// UI
String   lastEvent      = "-";
bool     uiDirty        = true;
uint32_t lastBatMs      = 0;
uint32_t eventShownMs   = 0;

// ------------------------------------------------------------------ helpers
void sendMsg(const String& msg) {
  Serial.println(msg);
  if (bleConnected && txChar) {
    txChar->setValue((uint8_t*)msg.c_str(), msg.length());
    txChar->notify();
  }
}

void showEvent(const String& e) {
  lastEvent = e;
  eventShownMs = millis();
  uiDirty = true;
}

void drawUi() {
  auto& d = M5.Display;
  d.startWrite();
  d.fillScreen(paused ? TFT_NAVY : TFT_BLACK);
  d.setTextColor(TFT_WHITE);
  d.setTextSize(2);
  d.setCursor(6, 6);
  d.print("StickSword");

  d.setCursor(6, 32);
  d.setTextColor(bleConnected ? TFT_GREEN : TFT_ORANGE);
  d.print(bleConnected ? "BLE connected" : "BLE waiting...");

  d.setTextColor(TFT_LIGHTGREY);
  d.setCursor(6, 58);
  d.printf("Bat %d%%  %s", (int)M5.Power.getBatteryLevel(), paused ? "PAUSED" : "");

  d.setTextColor(TFT_YELLOW);
  d.setTextSize(3);
  d.setCursor(6, 90);
  d.print(lastEvent);
  d.endWrite();
  uiDirty = false;
}

void beep(int freq, int ms) {
  M5.Speaker.tone(freq, ms);
}

// Average gyro while the stick lies still -> removes sensor offset.
void calibrateGyro() {
  M5.Display.fillScreen(TFT_BLACK);
  M5.Display.setTextSize(2);
  M5.Display.setTextColor(TFT_WHITE);
  M5.Display.setCursor(6, 40);
  M5.Display.print("Calibrating...");
  M5.Display.setCursor(6, 70);
  M5.Display.print("keep still");

  float sx = 0, sy = 0, sz = 0;
  int n = 0;
  uint32_t start = millis();
  while (n < 300 && millis() - start < 4000) {
    if (M5.Imu.update()) {
      auto d = M5.Imu.getImuData();
      sx += d.gyro.x; sy += d.gyro.y; sz += d.gyro.z;
      n++;
    }
    delay(2);
  }
  if (n > 50) {
    gyroBiasX = sx / n; gyroBiasY = sy / n; gyroBiasZ = sz / n;
  }
  Serial.printf("Gyro bias: %.2f %.2f %.2f (n=%d)\n", gyroBiasX, gyroBiasY, gyroBiasZ, n);
  beep(3000, 60);
  uiDirty = true;
}

void setupBle() {
  BLEDevice::init(DEVICE_NAME);
  bleServer = BLEDevice::createServer();
  bleServer->setCallbacks(new ServerCB());

  BLEService* svc = bleServer->createService(SERVICE_UUID);

  txChar = svc->createCharacteristic(TX_UUID, BLECharacteristic::PROPERTY_NOTIFY);
  txChar->addDescriptor(new BLE2902());

  BLECharacteristic* rx = svc->createCharacteristic(
      RX_UUID, BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_WRITE_NR);
  rx->setCallbacks(new RxCB());

  svc->start();

  // Advertise only the name (the 128-bit UUID + name would not fit into 31 bytes).
  BLEAdvertising* adv = BLEDevice::getAdvertising();
  adv->setScanResponse(true);
  BLEDevice::startAdvertising();
}

// ------------------------------------------------------------------ gesture logic
void processSample(float ax, float ay, float az, float gx, float gy, float gz) {
  uint32_t now = millis();
  gx -= gyroBiasX; gy -= gyroBiasY; gz -= gyroBiasZ;
  float gyroMag = sqrtf(gx * gx + gy * gy + gz * gz);

  float jerk = 0;
  if (havePrev) {
    float dx = ax - prevAx, dy = ay - prevAy, dz = az - prevAz;
    jerk = sqrtf(dx * dx + dy * dy + dz * dz);
  }
  prevAx = ax; prevAy = ay; prevAz = az; havePrev = true;

  if (DEBUG_STREAM) {
    Serial.printf("a %.2f %.2f %.2f  g %.0f  jerk %.2f\n", ax, ay, az, gyroMag, jerk);
  }

  // ---------- SLASH: fire at the peak of a fast rotation ----------
  if (!slashArmed && gyroMag < SLASH_REARM_DPS && now - lastSlashMs > SLASH_MIN_GAP_MS) {
    slashArmed = true;
  }
  if (slashArmed && !paused) {
    if (gyroMag > SLASH_TRIGGER_DPS) {
      inSwing = true;
      if (gyroMag > swingPeak) swingPeak = gyroMag;
      // peak passed (speed dropped 15% below max) -> slash now
      if (gyroMag < swingPeak * 0.85f) {
        sendMsg("SLASH " + String((int)swingPeak));
        showEvent("SLASH!");
        lastSlashMs = now;
        slashArmed = false; inSwing = false; swingPeak = 0;
        pendingTapMs = 0;  // a swing is never a tap
      }
    } else if (inSwing) {
      // dropped below trigger before we saw a 15% fall: still a slash
      sendMsg("SLASH " + String((int)swingPeak));
      showEvent("SLASH!");
      lastSlashMs = now;
      slashArmed = false; inSwing = false; swingPeak = 0;
      pendingTapMs = 0;
    }
  }

  // ---------- DOUBLE TAP ----------
  bool tapAllowed = gyroMag < TAP_MAX_GYRO_DPS && !inSwing && now - lastSlashMs > TAP_AFTER_SLASH_MS;
  if (tapAllowed && jerk > TAP_JERK_G && now - lastTapMs > TAP_DEBOUNCE_MS) {
    lastTapMs = now;
    if (pendingTapMs && now - pendingTapMs >= TAP_MIN_GAP_MS && now - pendingTapMs <= TAP_MAX_GAP_MS) {
      sendMsg("SPECIAL");
      showEvent("SPECIAL!");
      pendingTapMs = 0;
    } else {
      pendingTapMs = now;
    }
  }
  if (pendingTapMs && now - pendingTapMs > TAP_MAX_GAP_MS) pendingTapMs = 0;

  // ---------- FLAT ON TABLE -> PAUSE ----------
  bool flat = fabsf(az) > FLAT_MIN_Z_G &&
              sqrtf(ax * ax + ay * ay) < FLAT_MAX_XY_G &&
              gyroMag < FLAT_MAX_GYRO_DPS &&
              jerk < FLAT_MAX_JITTER_G;
  if (flat) {
    unflatSinceMs = 0;
    if (!flatSinceMs) flatSinceMs = now;
    if (!paused && now - flatSinceMs > FLAT_HOLD_MS) {
      paused = true;
      sendMsg("PAUSE");
      showEvent("PAUSE");
    }
  } else {
    flatSinceMs = 0;
    if (paused) {
      if (!unflatSinceMs) unflatSinceMs = now;
      if (now - unflatSinceMs > UNFLAT_HOLD_MS) {
        paused = false;
        unflatSinceMs = 0;
        sendMsg("RESUME");
        showEvent("RESUME");
      }
    }
  }
}

// ------------------------------------------------------------------ setup / loop
void setup() {
  auto cfg = M5.config();
  M5.begin(cfg);              // also keeps the Plus2 power latch (GPIO4) on
  Serial.begin(115200);
  M5.Display.setRotation(1);  // landscape 240x135
  M5.Speaker.setVolume(120);

  if (!M5.Imu.isEnabled()) {
    M5.Display.fillScreen(TFT_RED);
    M5.Display.setCursor(6, 40);
    M5.Display.setTextSize(2);
    M5.Display.print("IMU not found");
    while (true) delay(1000);
  }

  calibrateGyro();
  setupBle();
  drawUi();
}

void loop() {
  M5.update();
  uint32_t now = millis();

  // IMU
  if (M5.Imu.update()) {
    auto d = M5.Imu.getImuData();
    processSample(d.accel.x, d.accel.y, d.accel.z, d.gyro.x, d.gyro.y, d.gyro.z);
  }

  // buttons
  if (M5.BtnA.wasPressed()) {
    sendMsg("SPECIAL");
    showEvent("SPECIAL!");
  }
  if (M5.BtnB.pressedFor(1000)) {
    calibrateGyro();
    while (M5.BtnB.isPressed()) { M5.update(); delay(10); }
  }

  // BLE connection changes
  if (bleJustConnected) {
    bleJustConnected = false;
    delay(300);                    // give the browser time to subscribe
    sendMsg("HELLO StickSword 1");
    sendMsg(paused ? "PAUSE" : "RESUME");
    sendMsg("BAT " + String((int)M5.Power.getBatteryLevel()));
    beep(2500, 40);
    uiDirty = true;
  }
  if (wasConnected && !bleConnected) {
    delay(200);
    bleServer->startAdvertising();  // let the browser reconnect
    uiDirty = true;
  }
  wasConnected = bleConnected;

  if (beepRequested) {
    beepRequested = false;
    beep(1800, 80);
  }

  if (now - lastBatMs > 10000) {
    lastBatMs = now;
    sendMsg("BAT " + String((int)M5.Power.getBatteryLevel()));
    uiDirty = true;
  }

  // clear event text after a while; redraw only when needed (drawing is slow)
  if (lastEvent != "-" && lastEvent != "PAUSE" && now - eventShownMs > 1500) {
    lastEvent = "-";
    uiDirty = true;
  }
  if (uiDirty) drawUi();
}
