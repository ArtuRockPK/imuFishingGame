/*
 * M5StickS3 + BMI270: BLE controller built on the sensor's on-chip gesture recognition
 *
 * Libraries (Arduino Library Manager):
 *   - M5Unified (a recent version: it has the IMU orientation fix for StickS3)
 *   - M5GFX
 *   - SparkFun BMI270 Arduino Library (only the Bosch BMI270 API bundled in it is used)
 *   - BLE - part of the ESP32 core
 *
 * Board in Arduino IDE: M5StickS3 (M5Stack package).
 * For Serial Monitor output: Tools -> USB CDC On Boot: Enabled,
 *                            Tools -> USB Mode: Hardware CDC and JTAG.
 * On battery the debug log can be turned off: DEBUG_LOG 0.
 *
 * Sensor firmware: Bosch "legacy" config (bmi270_legacy). It has taps
 * (single/double/triple), orientation, flat, high-g, low-g, but no wrist gestures.
 * The SparkFun wrapper can only load the main config, so the sensor is driven
 * directly through the Bosch API (bmi270_legacy_*).
 *
 * Events are read by polling the interrupt status register over I2C.
 * On StickS3 the BMI270 INT1 pin goes to the M5PM1, not straight to the ESP32-S3,
 * so I2C polling is simpler and more reliable here.
 *
 * IMPORTANT about I2C: the BMI270 sits on the internal bus (SDA=47, SCL=48) together with the M5PM1.
 * M5Unified drives this bus with its own M5.In_I2C driver (I2C1 controller) and on EVERY
 * transaction re-attaches pins 47/48 to I2C1 (e.g. M5.update() polls the power button
 * through the PM1). If Arduino Wire (I2C0) is started on the same pins, the very first
 * M5.update() "steals" the pins from Wire, and all BMI270 reads silently stop working.
 * That is why every BMI270 access goes through M5.In_I2C (it has an internal mutex,
 * so using the bus from different tasks is safe).
 *
 * FreeRTOS tasks:
 *   imuTask (core 0) - polls the BMI270, puts events into two queues: screen and BLE;
 *   bleTask (core 0) - BLE GATT server, sends events as notifications plus the battery level;
 *   micTask (core 0) - microphone on game request: detects blowing into the stick (BLOW);
 *   loop()  (core 1) - screen and buttons.
 * Tasks talk to each other only through queues and atomic variables.
 *
 * BLE protocol (service BLE_SERVICE_UUID):
 *   event characteristic BLE_EVENT_UUID (read + notify), 12 bytes, little-endian:
 *     [0]    event id (EventId), 0xFF = state packet (sent on connect)
 *     [1]    detail code: ORIENT 0..3 (PORT UP, LAND L, PORT DN, LAND R),
 *            HIGH-G: bits 0-1 axis (0=X, 1=Y, 2=Z, 3=?), bit 7 = minus sign;
 *            FLAT: 1 = stick lies flat, 0 = picked up (sent on change, computed from the accelerometer);
 *            BLOW: blow strength 1..255 (start), 0 = blow ended;
 *            BUTTON (id 12): 1 = button A pressed;
 *            state packet 0xFF: 1 = stick is lying flat right now; otherwise 0
 *     [2]    event sequence number (uint8); a gap in numbering = an event was lost
 *            on the stick (BLE queue overflow). Not counted for the state packet.
 *            ANY/NO MOTION are sent no more often than BLE_THROTTLE_MS.
 *     [3]    REEL: spin direction in sensor axes (like HIGH-G): bits 0-1 axis (0=X, 1=Y, 2=Z),
 *            how it is spun: bit 5 = twist (the stick turns around its own axis),
 *            bit 4 = circle seen by the accelerometer, neither = circle seen by the gyroscope;
 *            bit 6 = direction is known, bit 7 = minus sign. Without bit 6 the other bits
 *            still hold the best guess (for diagnostics). Otherwise 0
 *     [4..7] stick time, ms (uint32)
 *     [8..9] for REEL - turns since the reel was enabled, in hundredths (uint16); otherwise 0
 *     [10]   REEL: strength of the best direction method, rad x40 (diagnostics); otherwise 0
 *     [11]   REEL: share of the main axis in it, % (diagnostics); otherwise 0
 *   command characteristic BLE_CMD_UUID (write), 1 byte:
 *     BLE_CMD_REEL_ON (1) - enable the reel, BLE_CMD_REEL_OFF (0) - disable,
 *     BLE_CMD_MIC_ON (3) - enable the microphone, BLE_CMD_MIC_OFF (2) - disable
 *   standard Battery Service 0x180F / 0x2A19 (read + notify), %.
 *
 * Reel (REEL, id 10): the game enables it while playing a fish. While it is on,
 * the gyroscope runs, and every REEL_SEND_MS a REEL arrives: code = speed of twisting
 * the stick with the wrist in tenths of a turn per second (15 = 1.5 rev/s), direction does not matter.
 * When the stick stops spinning, one REEL with code 0 arrives, then silence.
 *
 * Power saving: CPU 80 MHz; speaker, microphone (runs only on game request), RTC, 5V output and LED are off;
 * the gyroscope runs only while the reel (REEL) is on; BLE TX 0 dBm, slow advertising, dimmed screen.
 * The screen stays on for SCREEN_TIMEOUT_MS after power-on or a button press, then turns off;
 * sensor events do not wake it, only a button does.
 *
 * Microphone (BLOW, id 11): the game enables it for the night campfire. While it is on,
 * a loud blow longer than BLOW_START_MS gives a BLOW with its strength, the end of the blow gives
 * a BLOW with code 0 (see micTask). Id 11 used to be ACTIVITY - the step counter is unused and never enabled.
 *
 * Screen: stick name and BLE/battery status on top, tiles for all events below.
 * An inactive tile is dim; on an event it lights up in its color and fades after 1.5 s.
 * ORIENT and HIGH-G tiles show the detail while lit.
 *
 * Any button: press - turn the screen on for SCREEN_TIMEOUT_MS.
 * Button A (big, front): hold 2 s - power off.
 */

#include <M5Unified.h>
#include <atomic>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLE2902.h>
#include "SparkFun_BMI270_Arduino_Library.h"   // needed so the IDE links the library with the Bosch API
#include "bmi270_api/bmi270_legacy.h"

#define DEBUG_LOG 1
#if DEBUG_LOG
#define LOG(...) Serial.printf(__VA_ARGS__)
#else
#define LOG(...) do {} while (0)
#endif

// Event from the IMU task to loop() and bleTask. Declared before the first function: the Arduino IDE
// inserts auto-prototypes (addEvent(const ImuEvent&)) before the sketch's first function.
struct ImuEvent {
  uint32_t t;
  uint8_t  idx;          // EventId
  uint8_t  code;         // detail code for BLE (see the protocol in the header)
  uint8_t  seq;          // BLE packet sequence number
  uint16_t extra;        // extra data for bytes 8..9 (REEL: turns x100)
  uint8_t  aux;          // byte 3 (REEL: spin direction, see the protocol in the header)
  uint16_t diag;         // bytes 10..11 (REEL: direction diagnostics)
  char     detail[12];   // tile detail ("" if none)
};

// ---------- Settings ----------
const char*    BLE_NAME         = "StickS3-Rod";
const char*    BLE_SERVICE_UUID = "b5e10001-6d2a-4c8e-9f3b-1a7c5e2d9f40";
const char*    BLE_EVENT_UUID   = "b5e10002-6d2a-4c8e-9f3b-1a7c5e2d9f40";
const char*    BLE_CMD_UUID     = "b5e10003-6d2a-4c8e-9f3b-1a7c5e2d9f40";
const uint8_t  BLE_STATE_PACKET = 0xFF;
const uint8_t  BLE_CMD_REEL_OFF = 0x00;
const uint8_t  BLE_CMD_REEL_ON  = 0x01;
const uint8_t  BLE_CMD_MIC_OFF  = 0x02;
const uint8_t  BLE_CMD_MIC_ON   = 0x03;
const uint32_t BATTERY_PERIOD_MS = 60000;
const uint32_t SCREEN_TIMEOUT_MS = 10000;  // screen turns off this long after power-on / a button press
const uint8_t  SCREEN_BRIGHTNESS = 60;     // 0..255
const uint32_t IMU_POLL_MS       = 25;
const uint32_t BLE_THROTTLE_MS   = 500;    // ANY/NO MOTION to BLE no more often than this
const uint32_t FLAT_CHECK_MS     = 200;    // how often to check whether the stick is lying flat
const float    FLAT_ON_Z_G       = 0.90f;  // |z| above this - the stick was laid flat
const float    FLAT_OFF_Z_G      = 0.75f;  // |z| below this - the stick was picked up (hysteresis against bouncing)

// Tap tuning (found by experiment; current values are printed to Serial at startup).
// A tap is detected on ONE axis only: on StickS3 Z = knocking on the screen/back cover,
// X and Y = knocking on the ends/sides of the case.
const int   TAP_AXIS            = 2;      // 0 = X, 1 = Y, 2 = Z, -1 = keep the Bosch firmware default
const float TAP_THRESHOLD_SCALE = 0.6f;   // threshold multiplier: < 1 - more sensitive, > 1 - less sensitive, 1 - default
const float TAP_GESTURE_SCALE   = 1.5f;   // multiplier of the window between taps: > 1 - double/triple taps can be slower

// Orientation (ORIENT) tuning. Bosch default is blocking = 3, the strictest
// blocking: while the stick moves fast or is tilted more than ORIENT_THETA, an orientation
// change is not counted. While playing a fish the stick is being twisted, so turns got lost.
const int   ORIENT_BLOCKING     = 1;      // 0 - no blocking, 1 - by angle only, 2/3 - by angle and motion; -1 - Bosch firmware default
const float ORIENT_HYST_SCALE   = 1.5f;   // hysteresis multiplier (default 0.0625 g): < 1 - triggers earlier but may bounce

// HIGH-G (rod jerk) tuning. Bosch default is 4.9 g for 20 ms - sharp short tap knocks
// also match that. A jerk is weaker but longer than a tap, so the threshold is lower
// and the duration longer: a short tap knock does not reach HIGH-G.
const float    HIGH_G_THRESHOLD_G = 3.0f;   // acceleration threshold, g (default 4.9)
const uint16_t HIGH_G_DURATION_MS = 50;     // how long to stay above the threshold, ms (default 20, step 5)

// Reel (REEL) while playing a fish: see reelUpdate(). Found by experiment.
const uint32_t REEL_POLL_MS     = 10;     // sensor polling while the reel is on (100 Hz)
const uint32_t REEL_SEND_MS     = 100;    // how often to send the speed over BLE
const uint32_t REEL_MAX_MS      = 60000;  // safety: the reel turns itself off after a minute
const float    REEL_MIN_DPS     = 100.0f; // gyroscope: slower rotation is ignored
const float    REEL_MIN_ACC_G   = 0.25f;  // accelerometer: weaker motion is ignored
const float    REEL_GRAVITY_K   = 0.02f;  // how fast the gravity filter follows tilt (0.02 = ~0.5 s)
const float    REEL_SMOOTH      = 0.4f;   // spin-up smoothing: 1 - none, lower - smoother
const float    REEL_SMOOTH_DOWN = 0.8f;   // slow-down smoothing: closer to 1 - speed drops almost immediately
const float    REEL_MIN_SPEED   = 0.1f;   // slower than this (rev/s) - treated as not spinning
const uint32_t REEL_STOP_MS     = 80;     // gyroscope sees no rotation for this many ms - send speed 0 right away
const float    REEL_DIR_MIN     = 0.5f;   // less consistent rotation than this (rad, ~30 deg) - direction unknown
const float    REEL_DIR_KEEP    = 0.5f;   // direction memory between sends: 0.5 = about the last 0.2 s
const float    REEL_DIR_CLEAR   = 0.5f;   // the main axis must carry this share of the vector, otherwise unknown

// ---------- BMI270 access through M5.In_I2C ----------
const uint8_t  BMI_ADDR = BMI2_I2C_PRIM_ADDR;   // 0x68
const uint32_t BMI_FREQ = 400000;

static BMI2_INTF_RETURN_TYPE bmiRead(uint8_t reg, uint8_t* data, uint32_t len, void*) {
  return M5.In_I2C.readRegister(BMI_ADDR, reg, data, len, BMI_FREQ) ? BMI2_INTF_RET_SUCCESS : BMI2_E_COM_FAIL;
}

static BMI2_INTF_RETURN_TYPE bmiWrite(uint8_t reg, const uint8_t* data, uint32_t len, void*) {
  return M5.In_I2C.writeRegister(BMI_ADDR, reg, data, len, BMI_FREQ) ? BMI2_INTF_RET_SUCCESS : BMI2_E_COM_FAIL;
}

static void bmiDelayUs(uint32_t us, void*) {
  if (us >= 1000) delay(us / 1000);
  delayMicroseconds(us % 1000);
}

bmi2_dev bmi;
M5Canvas canvas(&M5.Display);

// ---------- Event definitions ----------
enum EventId : uint8_t {
  EV_TAP1, EV_TAP2, EV_TAP3,
  EV_ANY_MOT, EV_NO_MOT, EV_SIG_MOT,
  EV_HIGH_G, EV_LOW_G, EV_FLAT,
  EV_ORIENT,
  EV_REEL,          // 10 (this id used to be STEP)
  EV_BLOW,          // 11 - the player blows into the microphone (this id used to be ACTIVITY)
  EV_BTN,           // 12 - button: A pressed
  EV_COUNT
};

struct EventDef {
  const char* name;      // on-screen text
  uint16_t color;
};

// Order matches EventId and the tile layout (3 per row)
const EventDef EVENTS[EV_COUNT] = {
  { "TAP x1",   TFT_WHITE },
  { "TAP x2",   TFT_GOLD },
  { "TAP x3",   TFT_PINK },
  { "ANY MOT",  TFT_ORANGE },
  { "NO MOT",   TFT_CYAN },
  { "SIG MOT",  TFT_RED },
  { "HIGH-G",   TFT_MAGENTA },
  { "LOW-G",    0xB81F },   // purple, lighter than TFT_PURPLE
  { "FLAT",     TFT_SKYBLUE },
  { "ORIENT",   TFT_GREENYELLOW },
  { "REEL",     TFT_GREEN },   // reel: spin speed
  { "BLOW",     TFT_YELLOW },  // blowing into the mic: strength
  { "BUTTON",   TFT_LIGHTGREY },  // button pressed (the game can use it to pick a spot)
};
const int EVENT_COUNT = EV_COUNT;

// Features to enable (Bosch feature IDs). The gyroscope is not needed here - not enabled.
struct FeatureDef { uint8_t id; const char* name; };
const FeatureDef FEATURES[] = {
  { BMI2_ACCEL,         "accel"        },
  { BMI2_ANY_MOTION,    "any-motion"   },
  { BMI2_NO_MOTION,     "no-motion"    },
  { BMI2_SIG_MOTION,    "sig-motion"   },
  { BMI2_SINGLE_TAP,    "single-tap"   },
  { BMI2_DOUBLE_TAP,    "double-tap"   },
  { BMI2_TRIPLE_TAP,    "triple-tap"   },
  { BMI2_ORIENTATION,   "orientation"  },
  { BMI2_HIGH_G,        "high-g"       },
  { BMI2_LOW_G,         "low-g"        },
  { BMI2_FLAT,          "flat"         },
};
const int FEATURE_COUNT = sizeof(FEATURES) / sizeof(FEATURES[0]);

// Features mapped to INT1 (in legacy all taps go through the shared BMI2_TAP)
const uint8_t INT_MAP[] = {
  BMI2_SIG_MOTION, BMI2_TAP,
  BMI2_ORIENTATION, BMI2_HIGH_G, BMI2_LOW_G, BMI2_FLAT,
  BMI2_ANY_MOTION, BMI2_NO_MOTION,
};
const int INT_MAP_COUNT = sizeof(INT_MAP) / sizeof(INT_MAP[0]);

// Accel: 8G -> 4096 LSB/g
const float ACC_LSB_PER_G = 4096.0f;
// Gyro: 2000 dps -> 16.4 LSB/(deg/s)
const float GYR_LSB_PER_DPS = 16.4f;

// ---------- Inter-task communication ----------
QueueHandle_t eventQueue = nullptr;   // imuTask -> loop (screen)
QueueHandle_t bleQueue = nullptr;     // imuTask -> bleTask
std::atomic<uint32_t> i2cErrors{0};
std::atomic<bool>     bleConnected{false};
std::atomic<bool>     stickFlat{false};    // stick is lying flat (computed by imuTask)
std::atomic<int>      batteryPct{-1};
std::atomic<bool>     reelWanted{false};   // the game asks to enable the reel (BLE command)
TaskHandle_t imuTaskHandle = nullptr;
TaskHandle_t bleTaskHandle = nullptr;

// ---------- Event tiles (loop only) ----------
const uint32_t HIGHLIGHT_MS = 1500;   // how long a tile stays lit after an event
const uint16_t DIM_TEXT   = 0x4208;   // dim text of an inactive tile
const uint16_t DIM_BORDER = 0x2945;   // dim border of an inactive tile
const uint16_t BLE_COLOR  = 0x3D7F;   // light blue - BLE connected

uint32_t lastEventTime[EVENT_COUNT] = {0};
bool     eventSeen[EVENT_COUNT] = {false};
char     eventDetail[EVENT_COUNT][12] = {};
uint32_t litMask = 0;      // which tiles are lit now (bit = EventId)

bool needRedraw = true;
int initErrors = 0;        // init result (for display)

bool     screenOn = true;
uint32_t lastActivityMs = 0;

void addEvent(const ImuEvent& ev) {
  lastEventTime[ev.idx] = ev.t;
  eventSeen[ev.idx] = true;
  strlcpy(eventDetail[ev.idx], ev.detail, sizeof(eventDetail[ev.idx]));
  needRedraw = true;
}

uint32_t calcLitMask(uint32_t now) {
  uint32_t mask = 0;
  for (int i = 0; i < EVENT_COUNT; i++) {
    if (eventSeen[i] && now - lastEventTime[i] < HIGHLIGHT_MS) mask |= 1u << i;
  }
  return mask;
}

void setScreen(bool on) {
  if (on == screenOn) return;
  screenOn = on;
  if (on) {
    M5.Display.wakeup();
    M5.Display.setBrightness(SCREEN_BRIGHTNESS);
    needRedraw = true;
  } else {
    M5.Display.setBrightness(0);
    M5.Display.sleep();
  }
}

// ---------- BMI270 setup ----------
void logTapConfig(const char* title, const bmi2_tap_config& t) {
  LOG("%s: sens_thres=%u max_gest_dur=%u quiet_after=%u wait_timeout=%u axis=%u data_reg_en=%u\n",
      title, t.tap_sens_thres, t.max_gest_dur, t.quite_time_after_gest,
      t.wait_for_timeout, t.axis_sel, t.data_reg_en);
}

uint16_t scaleU16(uint16_t v, float k) {
  float r = v * k + 0.5f;
  if (r < 1) r = 1;
  if (r > 0xFFFF) r = 0xFFFF;
  return (uint16_t)r;
}

bool setupTap() {
  bmi2_sens_config tap;
  memset(&tap, 0, sizeof(tap));
  tap.type = BMI2_TAP;
  int8_t r = bmi270_legacy_get_sensor_config(&tap, 1, &bmi);
  if (r != BMI2_OK) { LOG("tap get_config FAILED: %d\n", r); return false; }
  logTapConfig("tap default", tap.cfg.tap_conf);

  if (TAP_AXIS >= 0 && TAP_AXIS <= 2) tap.cfg.tap_conf.axis_sel = TAP_AXIS;
  tap.cfg.tap_conf.tap_sens_thres = scaleU16(tap.cfg.tap_conf.tap_sens_thres, TAP_THRESHOLD_SCALE);
  tap.cfg.tap_conf.max_gest_dur   = scaleU16(tap.cfg.tap_conf.max_gest_dur, TAP_GESTURE_SCALE);

  r = bmi270_legacy_set_sensor_config(&tap, 1, &bmi);
  if (r != BMI2_OK) { LOG("tap set_config FAILED: %d\n", r); return false; }

  // Read back to make sure the sensor accepted the values
  memset(&tap.cfg, 0, sizeof(tap.cfg));
  if (bmi270_legacy_get_sensor_config(&tap, 1, &bmi) == BMI2_OK) logTapConfig("tap applied", tap.cfg.tap_conf);
  return true;
}

bool setupOrient() {
  bmi2_sens_config o;
  memset(&o, 0, sizeof(o));
  o.type = BMI2_ORIENTATION;
  int8_t r = bmi270_legacy_get_sensor_config(&o, 1, &bmi);
  if (r != BMI2_OK) { LOG("orient get_config FAILED: %d\n", r); return false; }
  bmi2_orient_config& c = o.cfg.orientation;
  LOG("orient default: ud_en=%u mode=%u blocking=%u theta=%u hyst=%u\n",
      c.ud_en, c.mode, c.blocking, c.theta, c.hysteresis);

  if (ORIENT_BLOCKING >= 0 && ORIENT_BLOCKING <= 3) c.blocking = ORIENT_BLOCKING;
  c.hysteresis = scaleU16(c.hysteresis, ORIENT_HYST_SCALE);

  r = bmi270_legacy_set_sensor_config(&o, 1, &bmi);
  if (r != BMI2_OK) { LOG("orient set_config FAILED: %d\n", r); return false; }

  memset(&o.cfg, 0, sizeof(o.cfg));
  if (bmi270_legacy_get_sensor_config(&o, 1, &bmi) == BMI2_OK) {
    LOG("orient applied: blocking=%u theta=%u hyst=%u\n", c.blocking, c.theta, c.hysteresis);
  }
  return true;
}

bool setupHighG() {
  bmi2_sens_config h;
  memset(&h, 0, sizeof(h));
  h.type = BMI2_HIGH_G;
  int8_t r = bmi270_legacy_get_sensor_config(&h, 1, &bmi);
  if (r != BMI2_OK) { LOG("high-g get_config FAILED: %d\n", r); return false; }
  bmi2_high_g_config& c = h.cfg.high_g;
  LOG("high-g default: threshold=%u hyst=%u duration=%u\n", c.threshold, c.hysteresis, c.duration);

  c.threshold = (uint16_t)(HIGH_G_THRESHOLD_G * 2048 + 0.5f);   // 1 g = 2048
  c.duration  = HIGH_G_DURATION_MS / 5;                          // in 200 Hz samples

  r = bmi270_legacy_set_sensor_config(&h, 1, &bmi);
  if (r != BMI2_OK) { LOG("high-g set_config FAILED: %d\n", r); return false; }

  memset(&h.cfg, 0, sizeof(h.cfg));
  if (bmi270_legacy_get_sensor_config(&h, 1, &bmi) == BMI2_OK) {
    LOG("high-g applied: threshold=%u duration=%u\n", c.threshold, c.duration);
  }
  return true;
}

bool setupImu() {
  LOG("In_I2C: SDA=%d SCL=%d enabled=%d\n",
      (int)M5.getPin(m5::pin_name_t::in_i2c_sda),
      (int)M5.getPin(m5::pin_name_t::in_i2c_scl),
      (int)M5.In_I2C.isEnabled());

  // Quick check that the chip responds: CHIP_ID (0x00) must be 0x24
  uint8_t chipId = M5.In_I2C.readRegister8(BMI_ADDR, 0x00, BMI_FREQ);
  LOG("BMI270 CHIP_ID = 0x%02X (expected 0x24)\n", chipId);

  memset(&bmi, 0, sizeof(bmi));
  bmi.intf = BMI2_I2C_INTF;
  bmi.read = bmiRead;
  bmi.write = bmiWrite;
  bmi.delay_us = bmiDelayUs;
  bmi.intf_ptr = nullptr;
  bmi.read_write_len = 128;        // the config file is loaded in 128-byte chunks
  bmi.config_file_ptr = nullptr;   // nullptr = built-in legacy config

  // Load the config file (~8 KB)
  int tries = 0;
  int8_t r;
  while ((r = bmi270_legacy_init(&bmi)) != BMI2_OK) {
    LOG("bmi270_legacy_init failed: %d, retry...\n", r);
    if (++tries >= 5) return false;
    delay(500);
  }
  uint8_t cfgMajor = 0, cfgMinor = 0;
  bmi2_get_config_file_version(&cfgMajor, &cfgMinor, &bmi);
  LOG("BMI270 legacy OK, config v%u.%u\n", cfgMajor, cfgMinor);

  int failed = 0;

  // Disable advanced power save: otherwise the API toggles it on every read
  r = bmi2_set_adv_power_save(BMI2_DISABLE, &bmi);
  if (r != BMI2_OK) { failed++; LOG("adv_power_save FAILED: %d\n", r); }

  // Accelerometer: 200 Hz (taps need a higher rate), 8G range (headroom for high-g)
  bmi2_sens_config acc;
  acc.type = BMI2_ACCEL;
  r = bmi270_legacy_get_sensor_config(&acc, 1, &bmi);
  if (r == BMI2_OK) {
    acc.cfg.acc.odr = BMI2_ACC_ODR_200HZ;
    acc.cfg.acc.range = BMI2_ACC_RANGE_8G;
    acc.cfg.acc.bwp = BMI2_ACC_NORMAL_AVG4;
    acc.cfg.acc.filter_perf = BMI2_PERF_OPT_MODE;
    r = bmi270_legacy_set_sensor_config(&acc, 1, &bmi);
  }
  if (r != BMI2_OK) { failed++; LOG("accel config FAILED: %d\n", r); }

  // Gyroscope: configured now, enabled only while the reel (REEL) is on
  bmi2_sens_config gyr;
  gyr.type = BMI2_GYRO;
  r = bmi270_legacy_get_sensor_config(&gyr, 1, &bmi);
  if (r == BMI2_OK) {
    gyr.cfg.gyr.odr = BMI2_GYR_ODR_100HZ;
    gyr.cfg.gyr.range = BMI2_GYR_RANGE_2000;
    gyr.cfg.gyr.bwp = BMI2_GYR_NORMAL_MODE;
    gyr.cfg.gyr.filter_perf = BMI2_POWER_OPT_MODE;
    gyr.cfg.gyr.noise_perf = BMI2_POWER_OPT_MODE;
    r = bmi270_legacy_set_sensor_config(&gyr, 1, &bmi);
  }
  if (r != BMI2_OK) { failed++; LOG("gyro config FAILED: %d\n", r); }

  // Enable the features and count the ones that failed
  for (int i = 0; i < FEATURE_COUNT; i++) {
    r = bmi270_legacy_sensor_enable(&FEATURES[i].id, 1, &bmi);
    if (r != BMI2_OK) {
      failed++;
      LOG("enable(%s) FAILED: %d\n", FEATURES[i].name, r);
    }
  }

  if (!setupTap()) failed++;
  if (!setupOrient()) failed++;
  if (!setupHighG()) failed++;

  // Interrupt pin setup (for the status register)
  bmi2_int_pin_config pinCfg;
  memset(&pinCfg, 0, sizeof(pinCfg));
  pinCfg.pin_type = BMI2_INT1;
  pinCfg.int_latch = BMI2_INT_LATCH;
  pinCfg.pin_cfg[0].lvl = BMI2_INT_ACTIVE_LOW;
  pinCfg.pin_cfg[0].od = BMI2_INT_OPEN_DRAIN;   // the line goes to the PM1, do not drive it
  pinCfg.pin_cfg[0].output_en = BMI2_INT_OUTPUT_ENABLE;
  pinCfg.pin_cfg[0].input_en = BMI2_INT_INPUT_DISABLE;
  r = bmi2_set_int_pin_config(&pinCfg, &bmi);
  if (r != BMI2_OK) {
    failed++;
    LOG("set_int_pin_config FAILED: %d\n", r);
  }

  for (int i = 0; i < INT_MAP_COUNT; i++) {
    bmi2_sens_int_config ic;
    ic.type = INT_MAP[i];
    ic.hw_int_pin = BMI2_INT1;
    r = bmi270_legacy_map_feat_int(&ic, 1, &bmi);
    if (r != BMI2_OK) {
      failed++;
      LOG("map_feat_int(%u) FAILED: %d\n", INT_MAP[i], r);
    }
  }

  initErrors = failed;
  LOG("init: %d errors\n", failed);
  return true;
}

// ---------- FreeRTOS task: BMI270 polling ----------
// Frequent events (ANY/NO MOTION arrive on almost every poll while the stick moves)
// are sent over BLE no more often than BLE_THROTTLE_MS. Otherwise they clog the BLE queue:
// a notification goes out roughly once per connection interval (30-50 ms), the queue
// overflows, and rare important events (ORIENT, TAP, HIGH-G) get dropped.
uint32_t lastBleSentMs[EV_COUNT] = {0};
uint8_t  bleSeq = 0;

bool isFrequentEvent(uint8_t idx) {
  return idx == EV_ANY_MOT || idx == EV_NO_MOT;
}

void sendEvent(uint8_t idx, const char* detail = "", uint8_t code = 0, uint16_t extra = 0,
               uint8_t aux = 0, uint16_t diag = 0) {
  ImuEvent ev;
  ev.t = millis();
  ev.idx = idx;
  ev.code = code;
  ev.extra = extra;
  ev.aux = aux;
  ev.diag = diag;
  strlcpy(ev.detail, detail, sizeof(ev.detail));
  if (idx == EV_REEL) {}       // REEL comes 10 times a second - not logged
  else if (detail[0]) LOG("[%lu ms] %s (%s)\n", (unsigned long)ev.t, EVENTS[idx].name, detail);
  else           LOG("[%lu ms] %s\n", (unsigned long)ev.t, EVENTS[idx].name);
  xQueueSend(eventQueue, &ev, 0);

  if (isFrequentEvent(idx) && ev.t - lastBleSentMs[idx] < BLE_THROTTLE_MS) return;
  lastBleSentMs[idx] = ev.t;
  // The number is assigned here, not when sending: if the event does not fit in the queue,
  // the receiver will see a gap in the numbering
  ev.seq = bleSeq++;
  if (xQueueSend(bleQueue, &ev, 0) != pdTRUE) {
    LOG("BLE queue full, %s dropped\n", EVENTS[idx].name);
  }
}

bool readFeature(bmi2_feat_sensor_data& f, uint8_t type) {
  f.type = type;
  if (bmi270_legacy_get_feature_data(&f, 1, &bmi) == BMI2_OK) return true;
  i2cErrors++;
  return false;
}

// Acceleration in g per axis; false on error
bool readAccel(float& x, float& y, float& z) {
  bmi2_sens_data d;
  memset(&d, 0, sizeof(d));
  if (bmi2_get_sensor_data(&d, &bmi) != BMI2_OK) { i2cErrors++; return false; }
  x = d.acc.x / ACC_LSB_PER_G;
  y = d.acc.y / ACC_LSB_PER_G;
  z = d.acc.z / ACC_LSB_PER_G;
  return true;
}

// |a| in g, or -1 on error
float readAccelMagnitude() {
  float x, y, z;
  if (!readAccel(x, y, z)) return -1;
  return sqrtf(x * x + y * y + z * z);
}

// ---------- Reel (REEL) ----------
// How rotation is measured: when the wrist moves in a circle, two vectors rotate -
// angular velocity (gyroscope) and acceleration without gravity (accelerometer).
// One wrist circle = one turn of the vector. SpinMeter sums the angles between
// consecutive samples of the vector; of the two sensors, the one that counted more wins.
// Direction does not matter - only angles are summed.
struct SpinMeter {
  float px = 0, py = 0, pz = 0, pm = 0;   // previous sample and its length
  bool  have = false;
  float angle = 0;                         // accumulated angle, rad

  void add(float x, float y, float z, float minMag) {
    float m = sqrtf(x * x + y * y + z * z);
    // Skip a weak vector and restart the comparison: when rocking back and forth
    // the vector passes through zero and flips sign - that is not rotation
    if (m < minMag) { have = false; return; }
    if (have) {
      float c = (x * px + y * py + z * pz) / (m * pm);
      c = c > 1 ? 1 : (c < -1 ? -1 : c);
      float a = acosf(c);
      if (a < 1.2f) angle += a;   // more than ~70 degrees per sample - a jump, not rotation
    }
    px = x; py = y; pz = z; pm = m;
    have = true;
  }
};

struct ReelState {
  bool     on = false;
  uint32_t startMs = 0, lastSendMs = 0;
  SpinMeter gyro, acc;
  float    gx = 0, gy = 0, gz = 0;       // gravity: slow average of acceleration
  float    speed = 0;                    // smoothed speed, rev/s
  float    turns = 0;                    // turns since enabled
  uint8_t  lastCode = 0;
  uint32_t lastSpinMs = 0;              // when the gyroscope last saw rotation
  float    nx = 0, ny = 0, nz = 0;       // summed rotation, deg (net turn: direction for a twist)
  float    kx = 0, ky = 0, kz = 0;       // summed cross products of acceleration samples (circle by the accelerometer)
  float    cx = 0, cy = 0, cz = 0;       // summed cross products of gyro samples (direction for a circle)
  uint32_t lastDirMs = 0;
};
ReelState reel;   // imuTask only

bool setGyro(bool on) {
  uint8_t s = BMI2_GYRO;
  int8_t r = on ? bmi270_legacy_sensor_enable(&s, 1, &bmi) : bmi270_legacy_sensor_disable(&s, 1, &bmi);
  if (r == BMI2_OK) return true;
  LOG("gyro %s FAILED: %d\n", on ? "on" : "off", r);
  i2cErrors++;
  return false;
}

void reelStart(uint32_t now) {
  if (!setGyro(true)) { reelWanted = false; return; }
  reel = ReelState();
  reel.on = true;
  reel.startMs = reel.lastSendMs = reel.lastDirMs = now;
  float x, y, z;
  if (readAccel(x, y, z)) { reel.gx = x; reel.gy = y; reel.gz = z; }
  LOG("[%lu ms] REEL on\n", (unsigned long)now);
}

void reelStop(const char* why) {
  setGyro(false);
  reel.on = false;
  reelWanted = false;
  if (reel.lastCode) sendEvent(EV_REEL, "STOP", 0, (uint16_t)fminf(65535, reel.turns * 100));
  LOG("[%lu ms] REEL off (%s), %.1f turns\n", (unsigned long)millis(), why, reel.turns);
}

// Spin direction (byte 3 of REEL). Two ways to spin the stick:
// - twist: it turns around its own axis, angular velocity points one way all the time -
//   the direction is the sign of the summed rotation (nx, ny, nz);
// - circle: the wrist draws a circle. If the stick tilts along, angular velocity goes round -
//   the direction is the axis of that circle: the sum of cross products of consecutive samples
//   (cx, cy, cz). If the stick moves round without tilting (like a real reel handle), the gyroscope
//   sees only wobble, but acceleration goes round - the same sum for it (kx, ky, kz, reelTrackAcc).
// reelDir picks the clearest of the three.
void reelTrackDir(uint32_t now, float wx, float wy, float wz) {
  float dt = (now - reel.lastDirMs) / 1000.0f;
  reel.lastDirMs = now;
  float m = sqrtf(wx * wx + wy * wy + wz * wz);
  if (m < REEL_MIN_DPS || dt > 0.1f) return;
  reel.nx += wx * dt; reel.ny += wy * dt; reel.nz += wz * dt;
  if (reel.gyro.have) {   // the previous sample was strong too
    float k = 1.0f / (reel.gyro.pm * m);
    reel.cx += (reel.gyro.py * wz - reel.gyro.pz * wy) * k;
    reel.cy += (reel.gyro.pz * wx - reel.gyro.px * wz) * k;
    reel.cz += (reel.gyro.px * wy - reel.gyro.py * wx) * k;
  }
}

// Circle seen by the accelerometer: cross products of consecutive linear acceleration samples
// (called before reel.acc.add, so reel.acc still holds the previous sample)
void reelTrackAcc(float lx, float ly, float lz) {
  float m = sqrtf(lx * lx + ly * ly + lz * lz);
  if (m < REEL_MIN_ACC_G || !reel.acc.have) return;
  float k = 1.0f / (reel.acc.pm * m);
  reel.kx += (reel.acc.py * lz - reel.acc.pz * ly) * k;
  reel.ky += (reel.acc.pz * lx - reel.acc.px * lz) * k;
  reel.kz += (reel.acc.px * ly - reel.acc.py * lx) * k;
}

// Direction code for the packet; older rotation is gradually forgotten
uint8_t reelDir(uint8_t& cand, uint16_t& diag) {
  float tw = sqrtf(reel.nx * reel.nx + reel.ny * reel.ny + reel.nz * reel.nz) * (PI / 180);
  float gc = sqrtf(reel.cx * reel.cx + reel.cy * reel.cy + reel.cz * reel.cz);
  float ac = sqrtf(reel.kx * reel.kx + reel.ky * reel.ky + reel.kz * reel.kz);
  // The clearest way wins: all three are "consistent rotation in radians"
  float v[3];
  uint8_t mode;
  float best;
  if (tw >= gc && tw >= ac) { v[0] = reel.nx; v[1] = reel.ny; v[2] = reel.nz; mode = 0x20; best = tw; }
  else if (ac >= gc)        { v[0] = reel.kx; v[1] = reel.ky; v[2] = reel.kz; mode = 0x10; best = ac; }
  else                      { v[0] = reel.cx; v[1] = reel.cy; v[2] = reel.cz; mode = 0;    best = gc; }
  // Forget the older part, so a change of direction shows up in about 0.2 s
  reel.nx *= REEL_DIR_KEEP; reel.ny *= REEL_DIR_KEEP; reel.nz *= REEL_DIR_KEEP;
  reel.cx *= REEL_DIR_KEEP; reel.cy *= REEL_DIR_KEEP; reel.cz *= REEL_DIR_KEEP;
  reel.kx *= REEL_DIR_KEEP; reel.ky *= REEL_DIR_KEEP; reel.kz *= REEL_DIR_KEEP;
  int axis = 0;
  for (int i = 1; i < 3; i++) if (fabsf(v[i]) > fabsf(v[axis])) axis = i;
  float share = best > 0 ? fabsf(v[axis]) / best : 0;
  // Diagnostics for the test page: strength of the winning method (rad x40) and main axis share (%)
  diag = (uint16_t)fminf(255, best * 40) | (uint16_t)(share * 100 + 0.5f) << 8;
  cand = mode | (v[axis] < 0 ? 0x80 : 0) | axis;   // best guess, sent even when the direction is unknown
  if (best < REEL_DIR_MIN) return 0;   // too little consistent rotation
  if (share < REEL_DIR_CLEAR) return 0;   // no clear main axis
  return 0x40 | cand;
}

void reelUpdate(uint32_t now) {
  bmi2_sens_data d;
  memset(&d, 0, sizeof(d));
  if (bmi2_get_sensor_data(&d, &bmi) != BMI2_OK) { i2cErrors++; return; }

  float ax = d.acc.x / ACC_LSB_PER_G, ay = d.acc.y / ACC_LSB_PER_G, az = d.acc.z / ACC_LSB_PER_G;
  reel.gx += (ax - reel.gx) * REEL_GRAVITY_K;
  reel.gy += (ay - reel.gy) * REEL_GRAVITY_K;
  reel.gz += (az - reel.gz) * REEL_GRAVITY_K;
  reelTrackAcc(ax - reel.gx, ay - reel.gy, az - reel.gz);
  reel.acc.add(ax - reel.gx, ay - reel.gy, az - reel.gz, REEL_MIN_ACC_G);
  float wx = d.gyr.x / GYR_LSB_PER_DPS, wy = d.gyr.y / GYR_LSB_PER_DPS, wz = d.gyr.z / GYR_LSB_PER_DPS;
  reelTrackDir(now, wx, wy, wz);
  reel.gyro.add(wx, wy, wz, REEL_MIN_DPS);
  if (reel.gyro.have) reel.lastSpinMs = now;   // have = rotation faster than REEL_MIN_DPS
  bool spinning = now - reel.lastSpinMs < REEL_STOP_MS;

  // Stop: the gyroscope sees right away that the wrist froze. Send 0 immediately,
  // without waiting for the REEL_SEND_MS window to end, so the game stops reeling in the line
  if (!spinning && reel.lastCode) {
    reel.speed = 0;
    reel.lastCode = 0;
    reel.gyro.angle = reel.acc.angle = 0;
    reel.lastSendMs = now;
    sendEvent(EV_REEL, "STOP", 0, (uint16_t)fminf(65535, reel.turns * 100));
    return;
  }

  if (now - reel.lastSendMs < REEL_SEND_MS) return;
  float dt = (now - reel.lastSendMs) / 1000.0f;
  reel.lastSendMs = now;
  // No turns are counted without gyroscope rotation: after a stop the accelerometer
  // still sees leftover motion for a while, that is not rotation
  float turns = spinning ? fmaxf(reel.gyro.angle, reel.acc.angle) / (2 * PI) : 0;
  reel.gyro.angle = reel.acc.angle = 0;
  reel.turns += turns;
  // Spin-up is smoothed a lot, slow-down barely: stop spinning and the speed
  // drops at once, so the game does not keep reeling in the line (important under tension)
  float raw = turns / dt;
  reel.speed += (raw - reel.speed) * (raw < reel.speed ? REEL_SMOOTH_DOWN : REEL_SMOOTH);
  if (reel.speed < REEL_MIN_SPEED) reel.speed = 0;

  uint8_t code = (uint8_t)fminf(255, reel.speed * 10 + 0.5f);
  if (code == 0 && reel.lastCode == 0) return;   // not spinning - keep the air quiet
  reel.lastCode = code;
  char det[12];
  uint8_t cand = 0;
  uint16_t diag = 0;
  uint8_t dir = code ? reelDir(cand, diag) : 0;
  snprintf(det, sizeof(det), "%.1f %c%c%c", reel.speed, dir ? "XYZ"[dir & 3] : '?',
           !dir ? ' ' : (dir & 0x80 ? '-' : '+'), !dir ? ' ' : (dir & 0x20 ? 't' : (dir & 0x10 ? 'a' : 'g')));
  sendEvent(EV_REEL, code ? det : "STOP", code, (uint16_t)fminf(65535, reel.turns * 100),
            dir ? dir : cand, diag);
}

void imuTask(void*) {
  TickType_t lastWake = xTaskGetTickCount();
  uint32_t lastDebug = 0;
  uint32_t lastFlatCheck = 0;
  bmi2_feat_sensor_data f;

  static const char* ORIENT_NAMES[]   = { "PORT UP", "LAND L", "PORT DN", "LAND R" };

  for (;;) {
    // Poll the event status (reading clears the flags, events are latched in the sensor)
    uint16_t status = 0;
    if (bmi2_get_int_status(&status, &bmi) != BMI2_OK) {
      i2cErrors++;
    } else if (status) {
      LOG("[%lu ms] INT_STATUS=0x%04X\n", (unsigned long)millis(), status);

      if (status & BMI270_LEGACY_TAP_STATUS_MASK) {
        // The tap type is in a separate register
        uint8_t tap = 0;
        if (bmi2_get_regs(BMI270_LEGACY_TAP_STATUS_REG, &tap, 1, &bmi) == BMI2_OK) {
          LOG("  tap reg=0x%02X\n", tap);
          if (tap & BMI270_LEGACY_SINGLE_TAP_MASK) sendEvent(EV_TAP1);
          if (tap & BMI270_LEGACY_DOUBLE_TAP_MASK) sendEvent(EV_TAP2);
          if (tap & BMI270_LEGACY_TRIPLE_TAP_MASK) sendEvent(EV_TAP3);
        } else {
          i2cErrors++;
        }
      }

      if (status & BMI270_LEGACY_ANY_MOT_STATUS_MASK) sendEvent(EV_ANY_MOT);
      if (status & BMI270_LEGACY_NO_MOT_STATUS_MASK)  sendEvent(EV_NO_MOT);
      if (status & BMI270_LEGACY_SIG_MOT_STATUS_MASK) sendEvent(EV_SIG_MOT);
      // The sensor's FLAT is unreliable - use it only as a reason to re-check
      // the position right away (the main check is below, every FLAT_CHECK_MS)
      if (status & BMI270_LEGACY_FLAT_STATUS_MASK) lastFlatCheck = 0;

      // High-g and low-g share one bit: tell them apart by the current acceleration
      if (status & BMI270_LEGACY_HIGH_G_STATUS_MASK) {
        float g = readAccelMagnitude();
        if (g >= 0 && g < 0.6f) {
          sendEvent(EV_LOW_G);
        } else if (readFeature(f, BMI2_HIGH_G)) {
          uint8_t h = f.sens_data.high_g_output;
          uint8_t axisIdx = (h & BMI270_LEGACY_HIGH_G_DETECT_X) ? 0
                          : (h & BMI270_LEGACY_HIGH_G_DETECT_Y) ? 1
                          : (h & BMI270_LEGACY_HIGH_G_DETECT_Z) ? 2 : 3;
          bool neg = h & BMI270_LEGACY_HIGH_G_DETECT_SIGN;
          char d[12];
          snprintf(d, sizeof(d), "HIGH-G %c%c", "XYZ?"[axisIdx], neg ? '-' : '+');
          sendEvent(EV_HIGH_G, d, axisIdx | (neg ? 0x80 : 0));
        }
      }

      if (status & BMI270_LEGACY_ORIENT_STATUS_MASK) {
        if (readFeature(f, BMI2_ORIENTATION)) {
          uint8_t pl = f.sens_data.orient_output.portrait_landscape & 0x03;
          LOG("  orient: %s, face %s\n", ORIENT_NAMES[pl],
              f.sens_data.orient_output.faceup_down ? "down" : "up");
          sendEvent(EV_ORIENT, ORIENT_NAMES[pl], pl);
        }
      }
    }

    uint32_t now = millis();

    // Reel: the gyroscope runs only on game request and while BLE is connected
    bool wantReel = reelWanted && bleConnected;
    if (wantReel && !reel.on) reelStart(now);
    else if (reel.on && !wantReel) reelStop("command");
    else if (reel.on && now - reel.startMs >= REEL_MAX_MS) reelStop("timeout");
    if (reel.on) reelUpdate(now);

    // Is the stick lying flat: computed here from the accelerometer, with hysteresis.
    // The FLAT event (code 1/0) is sent only when the state changes.
    if (lastFlatCheck == 0 || now - lastFlatCheck >= FLAT_CHECK_MS) {
      lastFlatCheck = now;
      float x, y, z;
      if (readAccel(x, y, z)) {
        float az = fabsf(z);
        bool flat = stickFlat.load();
        if (!flat && az > FLAT_ON_Z_G)  flat = true;
        if (flat  && az < FLAT_OFF_Z_G) flat = false;
        if (flat != stickFlat.load()) {
          stickFlat = flat;
          sendEvent(EV_FLAT, flat ? "FLAT ON" : "FLAT OFF", flat ? 1 : 0);
        }
      }
    }

#if DEBUG_LOG
    // Debug every 2 s: shows that the task is alive and the bus works
    if (now - lastDebug >= 2000) {
      lastDebug = now;
      bmi2_sens_data d;
      memset(&d, 0, sizeof(d));
      if (bmi2_get_sensor_data(&d, &bmi) == BMI2_OK) {
        LOG("[%lu ms] acc=%.2f %.2f %.2f g  flat=%d  i2cErr=%lu  ble=%d  bat=%d%%\n",
            (unsigned long)now,
            d.acc.x / ACC_LSB_PER_G, d.acc.y / ACC_LSB_PER_G, d.acc.z / ACC_LSB_PER_G,
            (int)stickFlat.load(),
            (unsigned long)i2cErrors.load(),
            (int)bleConnected.load(), batteryPct.load());
      } else {
        i2cErrors++;
        LOG("[%lu ms] get_sensor_data FAILED, i2cErr=%lu\n",
            (unsigned long)now, (unsigned long)i2cErrors.load());
      }
    }
#else
    (void)lastDebug;
#endif

    vTaskDelayUntil(&lastWake, pdMS_TO_TICKS(reel.on ? REEL_POLL_MS : IMU_POLL_MS));
  }
}

// ---------- Microphone: the player blows (BLOW) ----------
// The microphone is enabled only on game request (night campfire) and while BLE is connected.
// Sound is read in chunks of MIC_CHUNK samples (16 ms); each chunk's loudness is computed as
// RMS without the DC component (0..32767). The background noise level is tracked automatically,
// so the stick works both in a quiet room and outdoors in the noise.
// Blowing = louder than BLOW_MIN_RMS and BLOW_RATIO times louder than the noise for longer than BLOW_START_MS
// (short dips up to BLOW_GAP_MS do not interrupt it). Then a BLOW with strength code 1..255 is sent.
// Quiet for BLOW_END_MS - a BLOW with code 0 is sent. One blow = one event with a strength.
// Thresholds are tuned on the device: while the mic is on, loudness (rms) and noise (noise)
// are printed to Serial every 0.5 s.
const uint32_t MIC_RATE       = 16000;   // sample rate, Hz
const size_t   MIC_CHUNK      = 256;     // samples per chunk (16 ms)
const uint32_t MIC_WARMUP_MS  = 300;     // ignore the first ms after power-on (power-on click)
const uint32_t MIC_MAX_MS     = 180000;  // safety: the mic turns itself off after 3 minutes
const float    BLOW_MIN_RMS   = 2000;    // quieter - definitely not blowing
const float    BLOW_RATIO     = 4.0f;    // how many times louder than the noise
const uint32_t BLOW_START_MS  = 120;     // loud for this many ms - blowing
const uint32_t BLOW_GAP_MS    = 60;      // shorter dips do not break the start of a blow
const uint32_t BLOW_END_MS    = 200;     // quiet for this many ms - the blow is over
const float    MIC_NOISE_K    = 0.03f;   // how fast the noise level follows silence

std::atomic<bool> micWanted{false};   // the game asks to enable the mic (BLE command)
std::atomic<bool> micOn{false};       // the mic is running now (set by micTask)

struct BlowState {
  float    noise = 0;          // noise: loudness of silence
  float    peak = 0;           // loudest chunk of the current blow
  uint32_t loudSince = 0;      // when it got loud (0 - quiet)
  uint32_t quietSince = 0;     // when it got quiet in the middle of a loud stretch
  bool     blowing = false;    // BLOW already sent, waiting for the blow to end
} blow;

// Chunk loudness: RMS without the DC component
float micRms(const int16_t* s, size_t n) {
  int32_t sum = 0;
  for (size_t i = 0; i < n; i++) sum += s[i];
  float mean = (float)sum / n, acc = 0;
  for (size_t i = 0; i < n; i++) { float v = s[i] - mean; acc += v * v; }
  return sqrtf(acc / n);
}

void blowStep(uint32_t now, float rms) {
  if (blow.noise <= 0) blow.noise = rms;
  bool loud = rms > BLOW_MIN_RMS && rms > blow.noise * BLOW_RATIO;
  if (!loud && !blow.blowing) blow.noise += (rms - blow.noise) * MIC_NOISE_K;   // learn the noise level only from silence

  if (loud) {
    blow.quietSince = 0;
    if (!blow.loudSince) { blow.loudSince = now; blow.peak = 0; }
    if (rms > blow.peak) blow.peak = rms;
    if (!blow.blowing && now - blow.loudSince >= BLOW_START_MS) {
      blow.blowing = true;
      uint8_t code = (uint8_t)constrain((int)(blow.peak / 128), 1, 255);
      char d[12];
      snprintf(d, sizeof(d), "BLOW %u", code);
      sendEvent(EV_BLOW, d, code);
    }
    return;
  }
  if (!blow.loudSince) return;
  if (!blow.quietSince) blow.quietSince = now;
  uint32_t quiet = now - blow.quietSince;
  if (blow.blowing && quiet >= BLOW_END_MS) {
    blow.blowing = false;
    blow.loudSince = 0;
    sendEvent(EV_BLOW, "STOP", 0);
  } else if (!blow.blowing && quiet >= BLOW_GAP_MS) {
    blow.loudSince = 0;       // it was not a blow but a short sound (clap, knock)
  }
}

void micTask(void*) {
  static int16_t buf[2][MIC_CHUNK];
  int cur = 0;
  uint32_t onSince = 0, lastLog = 0;
  float lastRms = 0;
  for (;;) {
    uint32_t now = millis();
    bool want = micWanted && bleConnected;
    if (want && !micOn) {
      if (M5.Mic.begin()) {
        blow = BlowState();
        cur = 0;
        onSince = now;
        M5.Mic.record(buf[0], MIC_CHUNK, MIC_RATE);   // two chunks queued - audio flows without gaps
        M5.Mic.record(buf[1], MIC_CHUNK, MIC_RATE);
        micOn = true;
        LOG("[%lu ms] MIC on\n", (unsigned long)now);
      } else {
        micWanted = false;
        LOG("MIC begin FAILED\n");
      }
    } else if (micOn && (!want || now - onSince >= MIC_MAX_MS)) {
      if (blow.blowing) sendEvent(EV_BLOW, "STOP", 0);
      while (M5.Mic.isRecording()) vTaskDelay(1);
      M5.Mic.end();
      micOn = false;
      micWanted = false;
      LOG("[%lu ms] MIC off\n", (unsigned long)now);
    }
    if (!micOn) { vTaskDelay(pdMS_TO_TICKS(50)); continue; }

    // A chunk is ready when one is left in the record queue (the other is still recording)
    if (M5.Mic.isRecording() >= 2) { vTaskDelay(1); continue; }
    float rms = micRms(buf[cur], MIC_CHUNK);
    M5.Mic.record(buf[cur], MIC_CHUNK, MIC_RATE);
    cur ^= 1;
    if (now - onSince < MIC_WARMUP_MS) continue;
    blowStep(now, rms);
    if (rms > lastRms) lastRms = rms;
    if (now - lastLog >= 500) {
      LOG("[%lu ms] mic rms=%.0f noise=%.0f%s\n", (unsigned long)now, lastRms, blow.noise, blow.blowing ? " BLOW" : "");
      lastLog = now;
      lastRms = 0;
    }
  }
}

// ---------- FreeRTOS task: BLE ----------
// Commands from the game (BLE_CMD_UUID characteristic)
class CmdCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* c) override {
    if (c->getLength() < 1) return;
    uint8_t cmd = c->getData()[0];
    LOG("BLE cmd 0x%02X\n", cmd);
    if (cmd == BLE_CMD_REEL_ON)  reelWanted = true;
    if (cmd == BLE_CMD_REEL_OFF) reelWanted = false;
    if (cmd == BLE_CMD_MIC_ON)   micWanted = true;
    if (cmd == BLE_CMD_MIC_OFF)  micWanted = false;
  }
};

class BleServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer*) override { bleConnected = true; }
  void onDisconnect(BLEServer*) override { bleConnected = false; }
};

BLECharacteristic* addNotifyCharacteristic(BLEService* svc, BLEUUID uuid) {
  BLECharacteristic* c = svc->createCharacteristic(
      uuid, BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY);
#if defined(CONFIG_BLUEDROID_ENABLED)
  c->addDescriptor(new BLE2902());   // NimBLE adds the 0x2902 descriptor by itself
#endif
  return c;
}

void packEvent(uint8_t* p, uint8_t id, uint8_t code, uint8_t seq, uint32_t t, uint16_t extra = 0,
               uint8_t aux = 0, uint16_t diag = 0) {
  p[0] = id;
  p[1] = code;
  p[2] = seq;
  p[3] = aux;
  memcpy(p + 4, &t, 4);       // ESP32 is little-endian
  memcpy(p + 8, &extra, 2);
  memcpy(p + 10, &diag, 2);
}

void bleTask(void*) {
  BLEDevice::init(BLE_NAME);
  BLEDevice::setPower(ESP_PWR_LVL_N0);     // 0 dBm: enough for a room, saves battery

  BLEServer* server = BLEDevice::createServer();
  server->setCallbacks(new BleServerCallbacks());

  BLEService* svc = server->createService(BLE_SERVICE_UUID);
  BLECharacteristic* evtChar = addNotifyCharacteristic(svc, BLEUUID(BLE_EVENT_UUID));
  BLECharacteristic* cmdChar = svc->createCharacteristic(
      BLEUUID(BLE_CMD_UUID), BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_WRITE_NR);
  cmdChar->setCallbacks(new CmdCallbacks());
  svc->start();

  BLEService* batSvc = server->createService(BLEUUID((uint16_t)0x180F));
  BLECharacteristic* batChar = addNotifyCharacteristic(batSvc, BLEUUID((uint16_t)0x2A19));
  batSvc->start();

  // Advertising: service UUID in the main packet (the browser filters by it), name in the scan response
  BLEAdvertising* adv = BLEDevice::getAdvertising();
  BLEAdvertisementData advData;
  advData.setFlags(0x06);   // LE General Discoverable, BR/EDR not supported
  advData.setCompleteServices(BLEUUID(BLE_SERVICE_UUID));
  BLEAdvertisementData scanData;
  scanData.setName(BLE_NAME);
  adv->setAdvertisementData(advData);
  adv->setScanResponseData(scanData);
  adv->setMinInterval(480);   // 300 ms (0.625 ms units) - slow advertising saves battery
  adv->setMaxInterval(800);   // 500 ms
  BLEDevice::startAdvertising();
  LOG("BLE advertising as \"%s\"\n", BLE_NAME);

  uint8_t pkt[12];
  bool wasConnected = false;
  uint32_t lastBattery = 0;
  bool batteryDue = true;

  for (;;) {
    ImuEvent ev;
    if (xQueueReceive(bleQueue, &ev, pdMS_TO_TICKS(1000)) == pdTRUE) {
      // While nobody is connected, events are simply dropped
      if (bleConnected) {
        packEvent(pkt, ev.idx, ev.code, ev.seq, ev.t, ev.extra, ev.aux, ev.diag);
        evtChar->setValue(pkt, sizeof(pkt));
        evtChar->notify();
      }
    }

    bool connected = bleConnected;
    if (connected != wasConnected) {
      wasConnected = connected;
      if (connected) {
        LOG("BLE connected\n");
        // The client needs time to subscribe to notifications
        vTaskDelay(pdMS_TO_TICKS(500));
        // State packet code = is the stick lying flat now (seq is not counted)
        packEvent(pkt, BLE_STATE_PACKET, stickFlat ? 1 : 0, 0, millis());
        evtChar->setValue(pkt, sizeof(pkt));
        evtChar->notify();
        batteryDue = true;
      } else {
        LOG("BLE disconnected, advertising again\n");
        vTaskDelay(pdMS_TO_TICKS(300));
        BLEDevice::startAdvertising();
      }
    }

    uint32_t now = millis();
    if (batteryDue || now - lastBattery >= BATTERY_PERIOD_MS) {
      batteryDue = false;
      lastBattery = now;
      int level = M5.Power.getBatteryLevel();
      if (level >= 0 && level <= 100) {
        batteryPct = level;
        uint8_t b = (uint8_t)level;
        batChar->setValue(&b, 1);
        if (connected) batChar->notify();
      }
    }
  }
}

// ---------- Drawing ----------
void draw() {
  canvas.fillSprite(TFT_BLACK);
  canvas.setFont(&fonts::Font2);
  canvas.setTextDatum(top_left);

  // Header: stick name
  canvas.setTextColor(TFT_WHITE);
  canvas.drawString(BLE_NAME, 2, 2);

  // Right side: errors, otherwise BLE status and battery
  canvas.setTextDatum(top_right);
  if (i2cErrors.load()) {
    canvas.setTextColor(TFT_RED);
    canvas.drawString("I2C ERR", canvas.width() - 2, 2);
  } else if (initErrors) {
    canvas.setTextColor(TFT_RED);
    canvas.drawString(String("INIT ERR ") + initErrors, canvas.width() - 2, 2);
  } else {
    bool c = bleConnected.load();
    int bat = batteryPct.load();
    String s = c ? "BLE OK" : "BLE adv";
    if (stickFlat.load()) s = "FLAT " + s;   // shows whether the stick thinks it is lying flat
    if (bat >= 0) s += String("  ") + bat + "%";
    canvas.setTextColor(c ? BLE_COLOR : TFT_DARKGREY);
    canvas.drawString(s, canvas.width() - 2, 2);
  }

  canvas.drawFastHLine(0, 20, canvas.width(), TFT_DARKGREY);

  // Tiles: 3-column grid, same order as EVENTS
  const int COLS = 3;
  const int GAP = 3;
  const int top = 23;
  const int rows = (EVENT_COUNT + COLS - 1) / COLS;
  const int tileH = (canvas.height() - top - GAP * (rows - 1)) / rows;
  const int tileW = (canvas.width() - GAP * (COLS - 1)) / COLS;

  canvas.setTextDatum(middle_center);
  for (int i = 0; i < EVENT_COUNT; i++) {
    int row = i / COLS;
    int col = i % COLS;
    int x = col * (tileW + GAP);
    int y = top + row * (tileH + GAP);

    if (litMask & (1u << i)) {
      canvas.fillRoundRect(x, y, tileW, tileH, 4, EVENTS[i].color);
      canvas.setTextColor(TFT_BLACK);
      const char* text = eventDetail[i][0] ? eventDetail[i] : EVENTS[i].name;
      canvas.drawString(text, x + tileW / 2, y + tileH / 2);
    } else {
      canvas.drawRoundRect(x, y, tileW, tileH, 4, DIM_BORDER);
      canvas.setTextColor(DIM_TEXT);
      canvas.drawString(EVENTS[i].name, x + tileW / 2, y + tileH / 2);
    }
  }
  canvas.setTextDatum(top_left);

  canvas.pushSprite(0, 0);
  needRedraw = false;
}

// ---------- Arduino ----------
void setup() {
  setCpuFrequencyMhz(80);     // the minimum at which BLE works

  auto cfg = M5.config();
  cfg.serial_baudrate = 115200;
  cfg.internal_imu = false;   // the IMU is driven by us through the Bosch API
  cfg.internal_spk = false;   // everything unneeded is off to save battery
  cfg.internal_mic = true;    // the mic is only configured; micTask turns it on on game request
  cfg.internal_rtc = false;
  cfg.output_power = false;   // the 5V output on the connector is not needed
  cfg.led_brightness = 0;
  M5.begin(cfg);              // M5.begin calls Serial.begin itself

#if DEBUG_LOG
  // USB CDC: give Serial Monitor time to connect, otherwise the first lines are lost
  uint32_t t0 = millis();
  while (!Serial && millis() - t0 < 3000) delay(10);
#endif
  LOG("\n=== StickS3 BMI270 BLE controller (legacy) ===\n");
  LOG("Board id: %d, CPU %lu MHz\n", (int)M5.getBoard(), (unsigned long)getCpuFrequencyMhz());

  M5.BtnA.setHoldThresh(2000);
  M5.Display.setRotation(1);  // landscape: 240x135
  M5.Display.setBrightness(SCREEN_BRIGHTNESS);
  canvas.createSprite(M5.Display.width(), M5.Display.height());

  canvas.fillSprite(TFT_BLACK);
  canvas.setFont(&fonts::Font2);
  canvas.setTextColor(TFT_WHITE);
  canvas.setCursor(2, 2);
  canvas.println("BMI270 init...");
  canvas.pushSprite(0, 0);

  if (!setupImu()) {
    canvas.fillSprite(TFT_BLACK);
    canvas.setTextColor(TFT_RED);
    canvas.setCursor(2, 2);
    canvas.println("BMI270 NOT FOUND");
    canvas.println("Check Serial log");
    canvas.pushSprite(0, 0);
    while (true) delay(1000);
  }

  eventQueue = xQueueCreate(16, sizeof(ImuEvent));
  bleQueue = xQueueCreate(64, sizeof(ImuEvent));
  // loop() runs on core 1; the IMU and BLE tasks go to core 0 (where the BLE stack lives)
  xTaskCreatePinnedToCore(imuTask, "imuTask", 4096, nullptr, 2, &imuTaskHandle, 0);
  xTaskCreatePinnedToCore(bleTask, "bleTask", 8192, nullptr, 1, &bleTaskHandle, 0);
  xTaskCreatePinnedToCore(micTask, "micTask", 4096, nullptr, 1, nullptr, 0);

  lastActivityMs = millis();
  draw();
}

void loop() {
  M5.update();
  uint32_t now = millis();

  if (M5.BtnA.wasHold()) {
    LOG("Power off\n");
    M5.Display.setBrightness(0);
    M5.Power.powerOff();
  }
  // Button A goes to the game as BUTTON (some players pick the cast spot with it instead of a double tap)
  if (M5.BtnA.wasPressed()) sendEvent(EV_BTN, "A", 1);
  // Any button keeps the screen on for another SCREEN_TIMEOUT_MS
  if (M5.BtnA.wasPressed() || M5.BtnB.wasPressed() || M5.BtnPWR.wasPressed()) {
    lastActivityMs = now;
    setScreen(true);
  }

  // Events only update the tiles and do not wake the screen (saves battery)
  ImuEvent ev;
  while (xQueueReceive(eventQueue, &ev, 0) == pdTRUE) addEvent(ev);

  if (screenOn && now - lastActivityMs >= SCREEN_TIMEOUT_MS) setScreen(false);

  // Redraw when a tile lights up/fades,
  // plus once a second (BLE status, battery, errors). A dark screen is not drawn.
  static uint32_t lastDraw = 0;
  uint32_t mask = calcLitMask(now);
  if (mask != litMask) {
    litMask = mask;
    needRedraw = true;
  }
  if (screenOn && (needRedraw || now - lastDraw >= 1000)) {
    lastDraw = now;
    draw();
  }

  delay(screenOn ? 10 : 50);   // with the screen off loop() wakes up less often
}
