/*
 * M5StickS3 — BMI270 single/double/triple tap + orientation from the chip's own gesture engine.
 *
 * Board:     M5StickS3 (Arduino IDE, M5Stack ESP32 board package)
 * Tools:     USB CDC On Boot: Enabled, USB Mode: Hardware CDC and JTAG  (for Serial)
 * Libraries: M5Unified (recent), M5GFX, SparkFun BMI270 Arduino Library
 *            (used only for the Bosch BMI270 API it bundles — we do NOT call imu.beginI2C()).
 *
 * Key points
 *  - No Arduino Wire. The IMU sits on the internal bus (SDA 47 / SCL 48) shared with the M5PM1
 *    power chip. M5Unified's M5.In_I2C re-attaches those pins on its own transactions (e.g. inside
 *    M5.update()), which silently detaches Wire -> the IMU "stops answering". All register access
 *    goes through M5.In_I2C (it has a mutex, so it is also safe from a FreeRTOS task).
 *  - M5Unified's own IMU driver is switched off (cfg.internal_imu = false) so it doesn't upload its
 *    own config to the same chip.
 *  - Bosch "legacy" config: it has single/double/triple tap, orientation, flat, high-g, low-g,
 *    any/no/sig-motion. The SparkFun wrapper can only load the main config (no taps), so we drive
 *    the Bosch API (bmi270_legacy_*) directly.
 *  - We poll the interrupt status register instead of wiring INT1: on StickS3 INT1 goes to the
 *    power chip, not to the ESP32.
 *
 * Not compiled as-is: Bosch API symbol names can differ slightly between versions of the SparkFun
 * library — if something doesn't resolve, look it up in src/bmi270_api/bmi270_legacy.h / bmi2_defs.h.
 */
#include <M5Unified.h>
#include "SparkFun_BMI270_Arduino_Library.h"   // pulls the Bosch API into the build
#include "bmi270_api/bmi270_legacy.h"

// ---------- Settings (tune on hardware) ----------
const uint8_t  BMI_ADDR      = 0x68;
const uint32_t I2C_FREQ      = 400000;
const uint32_t POLL_MS       = 20;     // status poll period; latched flags wait for us, 20-25 ms is fine
const bool     TUNE_TAP      = true;   // apply the tap tuning below (set false to compare with Bosch defaults)
const float    TAP_THRES_K   = 0.6f;   // tap threshold scale: lower = more sensitive (more false taps)
const float    TAP_GEST_K    = 1.5f;   // max gesture duration scale: higher = slower double taps accepted
const bool     TAP_Z_ONLY    = true;   // only knocks on screen/back count (Z axis)
const uint8_t  ORIENT_BLOCK  = 1;      // Bosch default 3 blocks changes while moving (= while the player twists)
const float    ORIENT_HYST_K = 1.5f;   // more hysteresis = fewer flickers between sides

struct bmi2_dev bmi;
static uint8_t  dummyIntf;             // Bosch API wants a non-null intf_ptr

// ---------- Bus callbacks through M5Unified (never Wire) ----------
static BMI2_INTF_RETURN_TYPE bmiRead(uint8_t reg, uint8_t* d, uint32_t n, void*) {
  return M5.In_I2C.readRegister(BMI_ADDR, reg, d, n, I2C_FREQ) ? BMI2_INTF_RET_SUCCESS : BMI2_E_COM_FAIL;
}
static BMI2_INTF_RETURN_TYPE bmiWrite(uint8_t reg, const uint8_t* d, uint32_t n, void*) {
  return M5.In_I2C.writeRegister(BMI_ADDR, reg, d, n, I2C_FREQ) ? BMI2_INTF_RET_SUCCESS : BMI2_E_COM_FAIL;
}
static void bmiDelayUs(uint32_t us, void*) {
  if (us >= 1000) delay(us / 1000); else delayMicroseconds(us);
}

static bool check(const char* what, int8_t rslt) {
  if (rslt != BMI2_OK) Serial.printf("BMI270 %s failed: %d\n", what, rslt);
  return rslt == BMI2_OK;
}

bool bmiSetup() {
  uint8_t id = 0;
  if (!M5.In_I2C.readRegister(BMI_ADDR, 0x00, &id, 1, I2C_FREQ) || id != 0x24) {
    Serial.printf("BMI270 not found at 0x%02X (chip id 0x%02X)\n", BMI_ADDR, id);
    return false;
  }
  Serial.println("BMI270 chip id 0x24 OK");

  bmi.intf            = BMI2_I2C_INTF;
  bmi.read            = bmiRead;
  bmi.write           = bmiWrite;
  bmi.delay_us        = bmiDelayUs;
  bmi.intf_ptr        = &dummyIntf;
  bmi.read_write_len  = 128;           // config upload chunk size
  bmi.config_file_ptr = nullptr;       // nullptr = built-in LEGACY config

  int8_t rslt = BMI2_E_COM_FAIL;
  for (int i = 0; i < 5 && rslt != BMI2_OK; i++) {
    rslt = bmi270_legacy_init(&bmi);
    if (rslt != BMI2_OK) { Serial.printf("legacy_init try %d: %d\n", i + 1, rslt); delay(500); }
  }
  if (!check("legacy_init", rslt)) return false;

  // Otherwise the API keeps toggling advanced power save around every access
  check("adv_power_save", bmi2_set_adv_power_save(BMI2_DISABLE, &bmi));

  // Accel: 200 Hz (taps need it), +-8 g, normal avg4, performance mode. 4096 LSB/g.
  struct bmi2_sens_config acc = {};
  acc.type = BMI2_ACCEL;
  bmi270_legacy_get_sensor_config(&acc, 1, &bmi);
  acc.cfg.acc.odr         = BMI2_ACC_ODR_200HZ;
  acc.cfg.acc.range       = BMI2_ACC_RANGE_8G;
  acc.cfg.acc.bwp         = BMI2_ACC_NORMAL_AVG4;
  acc.cfg.acc.filter_perf = BMI2_PERF_OPT_MODE;
  check("accel config", bmi270_legacy_set_sensor_config(&acc, 1, &bmi));

  // Enable accel + the features we want (legacy taps are three separate "sensors")
  uint8_t sens[] = { BMI2_ACCEL, BMI2_SINGLE_TAP, BMI2_DOUBLE_TAP, BMI2_TRIPLE_TAP, BMI2_ORIENTATION };
  if (!check("sensor_enable", bmi270_legacy_sensor_enable(sens, sizeof(sens), &bmi))) return false;

  // Tuning: read -> scale -> write -> read back and log
  struct bmi2_sens_config f[2] = {};
  f[0].type = BMI2_TAP;
  f[1].type = BMI2_ORIENTATION;
  bmi270_legacy_get_sensor_config(f, 2, &bmi);
  Serial.printf("tap defaults: thres %u gest_dur %u axis %u | orient defaults: blocking %u hyst %u\n",
                f[0].cfg.tap.tap_sens_thres, f[0].cfg.tap.max_gest_dur, f[0].cfg.tap.axis_sel,
                f[1].cfg.orientation.blocking, f[1].cfg.orientation.hysteresis);
  if (TUNE_TAP) {
    f[0].cfg.tap.tap_sens_thres = (uint16_t)(f[0].cfg.tap.tap_sens_thres * TAP_THRES_K);
    f[0].cfg.tap.max_gest_dur   = (uint16_t)(f[0].cfg.tap.max_gest_dur * TAP_GEST_K);
    if (TAP_Z_ONLY) f[0].cfg.tap.axis_sel = 2;   // 0 = X, 1 = Y, 2 = Z
  }
  f[1].cfg.orientation.blocking   = ORIENT_BLOCK;
  f[1].cfg.orientation.hysteresis = (uint16_t)(f[1].cfg.orientation.hysteresis * ORIENT_HYST_K);
  check("feature config", bmi270_legacy_set_sensor_config(f, 2, &bmi));
  bmi270_legacy_get_sensor_config(f, 2, &bmi);
  Serial.printf("tap now:      thres %u gest_dur %u axis %u | orient now:      blocking %u hyst %u\n",
                f[0].cfg.tap.tap_sens_thres, f[0].cfg.tap.max_gest_dur, f[0].cfg.tap.axis_sel,
                f[1].cfg.orientation.blocking, f[1].cfg.orientation.hysteresis);

  // INT1: latched (flags stay until we read them), active-low, open-drain (line goes to the PM1).
  struct bmi2_int_pin_config pin = {};
  pin.pin_type = BMI2_INT1;
  bmi2_get_int_pin_config(&pin, &bmi);
  pin.pin_type             = BMI2_INT1;
  pin.int_latch            = BMI2_INT_LATCH;
  pin.pin_cfg[0].lvl       = BMI2_INT_ACTIVE_LOW;
  pin.pin_cfg[0].od        = BMI2_INT_OPEN_DRAIN;
  pin.pin_cfg[0].output_en = BMI2_INT_OUTPUT_ENABLE;
  pin.pin_cfg[0].input_en  = BMI2_INT_INPUT_DISABLE;
  check("int pin config", bmi2_set_int_pin_config(&pin, &bmi));

  // Map features to INT1 so their status bits get latched. Legacy taps share BMI2_TAP.
  struct bmi2_sens_int_config map[] = { { BMI2_TAP, BMI2_INT1 }, { BMI2_ORIENTATION, BMI2_INT1 } };
  if (!check("map_feat_int", bmi270_legacy_map_feat_int(map, 2, &bmi))) return false;

  uint16_t dummy; bmi2_get_int_status(&dummy, &bmi);   // clear anything latched during setup
  return true;
}

// ---------- Events ----------
const char* ORIENT_NAMES[] = { "portrait up", "landscape left", "portrait down", "landscape right" };
bool firstOrient = true;   // the first ORIENT after boot is not a player action

void onTap(int n) {
  Serial.printf("[%lu] TAP x%d\n", millis(), n);
  M5.Display.fillScreen(n == 1 ? TFT_BLUE : n == 2 ? TFT_GREEN : TFT_MAGENTA);
  M5.Display.drawString(n == 1 ? "SINGLE TAP" : n == 2 ? "DOUBLE TAP" : "TRIPLE TAP", 8, 8);
}

void onOrient(uint8_t side, uint8_t faceDown) {
  if (firstOrient) { firstOrient = false; return; }
  Serial.printf("[%lu] ORIENT %s, %s\n", millis(), side < 4 ? ORIENT_NAMES[side] : "?",
                faceDown ? "face down" : "face up");
  M5.Display.fillScreen(TFT_ORANGE);
  M5.Display.drawString(side < 4 ? ORIENT_NAMES[side] : "?", 8, 8);
}

void pollGestures() {
  uint16_t st = 0;
  if (bmi2_get_int_status(&st, &bmi) != BMI2_OK) { Serial.println("int status read failed"); return; }
  // Reading the status clears the latched flags.

  if (st & BMI270_LEGACY_TAP_STATUS_MASK) {
    // Which tap it was lives in a separate register
    uint8_t tap = 0;
    if (bmi2_get_regs(BMI270_LEGACY_TAP_STATUS_REG, &tap, 1, &bmi) == BMI2_OK) {
      if      (tap & BMI270_LEGACY_TRIPLE_TAP_MASK) onTap(3);
      else if (tap & BMI270_LEGACY_DOUBLE_TAP_MASK) onTap(2);
      else if (tap & BMI270_LEGACY_SINGLE_TAP_MASK) onTap(1);
    }
  }

  if (st & BMI270_LEGACY_ORIENT_STATUS_MASK) {
    struct bmi2_feat_sensor_data o = {};
    o.type = BMI2_ORIENTATION;
    if (bmi270_legacy_get_feature_data(&o, 1, &bmi) == BMI2_OK)
      onOrient(o.sens_data.orient_output.portrait_landscape, o.sens_data.orient_output.faceup_down);
  }
}

// ---------- Arduino ----------
bool imuOk = false;

void setup() {
  auto cfg = M5.config();
  cfg.internal_imu = false;            // we own the BMI270; don't let M5Unified load its config
  M5.begin(cfg);                       // this also sets up M5.In_I2C on SDA 47 / SCL 48
  Serial.begin(115200);
  M5.Display.setRotation(1);
  M5.Display.setTextSize(2);
  M5.Display.fillScreen(TFT_BLACK);

  imuOk = bmiSetup();
  M5.Display.drawString(imuOk ? "Tap or turn me" : "IMU init FAILED", 8, 8);
}

void loop() {
  M5.update();                         // safe now: M5.In_I2C and our IMU access share one driver + mutex
  if (M5.BtnA.wasPressed()) Serial.println("BtnA");
  if (M5.BtnB.wasPressed()) Serial.println("BtnB");

  static uint32_t last = 0;
  if (imuOk && millis() - last >= POLL_MS) { last = millis(); pollGestures(); }
  delay(5);
}
