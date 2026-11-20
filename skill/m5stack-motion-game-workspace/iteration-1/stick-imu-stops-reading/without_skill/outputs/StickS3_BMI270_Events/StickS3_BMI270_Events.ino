// M5StickS3 + BMI270: single/double/triple tap and orientation events from the
// sensor's own feature engine (Bosch "legacy" config), sharing the internal I2C
// bus with M5Unified instead of fighting it with Wire.
//
// Put these files from https://github.com/boschsensortec/BMI270_SensorAPI
// (branch master) into THIS sketch folder, next to the .ino:
//   bmi2.c  bmi2.h  bmi2_defs.h  bmi270_legacy.c  bmi270_legacy.h
//
// Do NOT also install/include the SparkFun BMI270 library in this sketch: it bundles
// its own copy of bmi2.c / bmi2_defs.h and you'll get duplicate symbols.

#include <M5Unified.h>

extern "C" {
#include "bmi270_legacy.h"
}

static constexpr uint8_t  IMU_ADDR = 0x68;     // BMI270 on StickS3
static constexpr uint32_t I2C_FREQ = 400000;

static struct bmi2_dev bmi;
static uint8_t imuAddr = IMU_ADDR;

// ---- Bosch API glue: go through M5Unified's I2C driver (M5.In_I2C) ----------
static BMI2_INTF_RETURN_TYPE bmiRead(uint8_t reg, uint8_t *data, uint32_t len, void *intf) {
  uint8_t addr = *(uint8_t *)intf;
  return M5.In_I2C.readRegister(addr, reg, data, len, I2C_FREQ) ? BMI2_INTF_RET_SUCCESS : -1;
}

static BMI2_INTF_RETURN_TYPE bmiWrite(uint8_t reg, const uint8_t *data, uint32_t len, void *intf) {
  uint8_t addr = *(uint8_t *)intf;
  return M5.In_I2C.writeRegister(addr, reg, data, len, I2C_FREQ) ? BMI2_INTF_RET_SUCCESS : -1;
}

static void bmiDelayUs(uint32_t us, void *) {
  if (us >= 1000) delay((us + 999) / 1000);
  else delayMicroseconds(us);
}

static bool check(const char *what, int8_t rslt) {
  if (rslt != BMI2_OK) Serial.printf("[BMI270] %s failed: %d\n", what, rslt);
  return rslt == BMI2_OK;
}

// Orientation codes (same values Bosch's orient example uses)
static const char *portraitName(uint8_t v) {
  switch (v) {
    case 0x00: return "portrait upright";
    case 0x01: return "landscape left";
    case 0x02: return "portrait upside down";
    case 0x03: return "landscape right";
    default:   return "?";
  }
}

static bool imuSetup() {
  bmi.intf           = BMI2_I2C_INTF;
  bmi.intf_ptr       = &imuAddr;
  bmi.read           = bmiRead;
  bmi.write          = bmiWrite;
  bmi.delay_us       = bmiDelayUs;
  bmi.read_write_len = 32;      // config blob is uploaded in chunks of this size (must be even)
  bmi.config_file_ptr = NULL;   // NULL = use the legacy config built into bmi270_legacy.c

  // Uploads the ~8 KB legacy feature config (tap, orientation, flat, high/low-g...)
  if (!check("bmi270_legacy_init", bmi270_legacy_init(&bmi))) return false;

  uint8_t sens[] = { BMI2_ACCEL, BMI2_GYRO, BMI2_SINGLE_TAP, BMI2_DOUBLE_TAP,
                     BMI2_TRIPLE_TAP, BMI2_ORIENTATION };
  if (!check("sensor_enable", bmi270_legacy_sensor_enable(sens, sizeof(sens), &bmi))) return false;

  // Accel: 200 Hz, +-4 g, performance mode (tap detection wants >= 200 Hz)
  struct bmi2_sens_config cfg[3];
  cfg[0].type = BMI2_ACCEL;
  cfg[1].type = BMI2_GYRO;
  cfg[2].type = BMI2_ORIENTATION;
  if (!check("get_sensor_config", bmi270_legacy_get_sensor_config(cfg, 3, &bmi))) return false;

  cfg[0].cfg.acc.odr         = BMI2_ACC_ODR_200HZ;
  cfg[0].cfg.acc.range       = BMI2_ACC_RANGE_4G;
  cfg[0].cfg.acc.bwp         = BMI2_ACC_NORMAL_AVG4;
  cfg[0].cfg.acc.filter_perf = BMI2_PERF_OPT_MODE;

  cfg[1].cfg.gyr.odr         = BMI2_GYR_ODR_200HZ;
  cfg[1].cfg.gyr.range       = BMI2_GYR_RANGE_2000;
  cfg[1].cfg.gyr.bwp         = BMI2_GYR_NORMAL_MODE;
  cfg[1].cfg.gyr.noise_perf  = BMI2_POWER_OPT_MODE;
  cfg[1].cfg.gyr.filter_perf = BMI2_PERF_OPT_MODE;

  // Orientation settings taken from Bosch's orient example
  cfg[2].cfg.orientation.ud_en      = 0x01;  // report face up / face down too
  cfg[2].cfg.orientation.mode       = 0x02;
  cfg[2].cfg.orientation.blocking   = 0x01;
  cfg[2].cfg.orientation.theta      = 0x33;
  cfg[2].cfg.orientation.hysteresis = 0x80;
  if (!check("set_sensor_config", bmi270_legacy_set_sensor_config(cfg, 3, &bmi))) return false;

  // Feature status bits only latch when the feature is mapped to an INT pin.
  // We never wire INT1 to a GPIO; we just poll INT_STATUS.
  struct bmi2_sens_int_config ints[2] = {
    { .type = BMI2_TAP,         .hw_int_pin = BMI2_INT1 },
    { .type = BMI2_ORIENTATION, .hw_int_pin = BMI2_INT1 },
  };
  if (!check("map_feat_int", bmi270_legacy_map_feat_int(ints, 2, &bmi))) return false;

  return true;
}

static bool imuOk = false;

void setup() {
  auto cfg = M5.config();
  cfg.serial_baudrate = 115200;
  cfg.internal_imu = false;   // we drive the BMI270 ourselves; don't let M5Unified load its own config
  M5.begin(cfg);              // M5Unified now owns GPIO47/48 (internal I2C) -- no Wire.begin(47,48)!

  M5.Display.setRotation(1);
  M5.Display.setTextSize(2);

  imuOk = imuSetup();
  M5.Display.clear();
  M5.Display.setCursor(0, 0);
  M5.Display.println(imuOk ? "BMI270 OK" : "BMI270 FAIL");
  Serial.println(imuOk ? "BMI270 ready: tap it / rotate it" : "BMI270 init failed");
}

static void showEvent(const char *txt) {
  Serial.println(txt);
  M5.Display.fillRect(0, 24, M5.Display.width(), 24, TFT_BLACK);
  M5.Display.setCursor(0, 24);
  M5.Display.print(txt);
}

void loop() {
  M5.update();                       // buttons/PMIC: safe now, same driver as the IMU
  if (!imuOk) { delay(100); return; }

  static uint32_t lastPoll = 0;
  if (millis() - lastPoll >= 10) {   // poll events at ~100 Hz
    lastPoll = millis();

    // INT_STATUS is clear-on-read: read once, handle every bit from this one read.
    uint16_t st = 0;
    if (bmi2_get_int_status(&st, &bmi) == BMI2_OK && st) {

      if (st & BMI270_LEGACY_TAP_STATUS_MASK) {
        uint8_t tap = 0;
        bmi2_get_regs(BMI270_LEGACY_TAP_STATUS_REG, &tap, 1, &bmi);
        if (tap & BMI270_LEGACY_TRIPLE_TAP_MASK)      showEvent("TRIPLE TAP");
        else if (tap & BMI270_LEGACY_DOUBLE_TAP_MASK) showEvent("DOUBLE TAP");
        else if (tap & BMI270_LEGACY_SINGLE_TAP_MASK) showEvent("SINGLE TAP");
      }

      if (st & BMI270_LEGACY_ORIENT_STATUS_MASK) {
        struct bmi2_feat_sensor_data fd = {};
        fd.type = BMI2_ORIENTATION;
        if (bmi270_legacy_get_feature_data(&fd, 1, &bmi) == BMI2_OK) {
          char buf[48];
          snprintf(buf, sizeof(buf), "%s, %s",
                   portraitName(fd.sens_data.orient_output.portrait_landscape),
                   fd.sens_data.orient_output.faceup_down ? "face down" : "face up");
          showEvent(buf);
        }
      }
    }
  }

  // Raw data still works alongside the features:
  static uint32_t lastRaw = 0;
  if (millis() - lastRaw >= 500) {
    lastRaw = millis();
    struct bmi2_sens_data d = {};
    if (bmi2_get_sensor_data(&d, &bmi) == BMI2_OK) {
      const float aScale = 4.0f / 32768.0f;      // +-4 g
      const float gScale = 2000.0f / 32768.0f;   // +-2000 dps
      Serial.printf("acc %.2f %.2f %.2f g | gyr %.1f %.1f %.1f dps\n",
                    d.acc.x * aScale, d.acc.y * aScale, d.acc.z * aScale,
                    d.gyr.x * gScale, d.gyr.y * gScale, d.gyr.z * gScale);
    }
  }
}
