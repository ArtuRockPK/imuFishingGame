/*
 * M5StickS3 + BMI270: BLE-контроллер на встроенных событиях распознавания
 *
 * Библиотеки (Arduino Library Manager):
 *   - M5Unified (свежая версия, там исправлена ориентация IMU для StickS3)
 *   - M5GFX
 *   - SparkFun BMI270 Arduino Library (используется только встроенный в неё Bosch BMI270 API)
 *   - BLE - входит в ядро ESP32
 *
 * Плата в Arduino IDE: M5StickS3 (пакет M5Stack).
 * Для вывода в Serial Monitor: Tools -> USB CDC On Boot: Enabled,
 *                               Tools -> USB Mode: Hardware CDC and JTAG.
 * Для работы от батареи отладку можно выключить: DEBUG_LOG 0.
 *
 * Прошивка датчика: "legacy" конфиг Bosch (bmi270_legacy). В нём есть тапы
 * (одиночный/двойной/тройной), ориентация, flat, high-g, low-g, но нет жестов запястья.
 * SparkFun-обёртка умеет грузить только основной конфиг, поэтому датчик ведётся
 * напрямую через Bosch API (bmi270_legacy_*).
 *
 * События читаются опросом регистра статуса прерываний по I2C.
 * Вывод INT1 у BMI270 на StickS3 идёт на M5PM1, а не напрямую на ESP32-S3,
 * поэтому опрос по I2C здесь проще и надёжнее.
 *
 * ВАЖНО про I2C: BMI270 сидит на внутренней шине (SDA=47, SCL=48) вместе с M5PM1.
 * M5Unified ведёт эту шину своим драйвером M5.In_I2C (контроллер I2C1) и при КАЖДОЙ
 * транзакции заново подключает пины 47/48 к I2C1 (например, M5.update() опрашивает
 * кнопку питания через PM1). Если поднять Arduino Wire (I2C0) на тех же пинах,
 * то после первого же M5.update() пины "уводятся" у Wire, и все чтения BMI270
 * молча перестают работать. Поэтому все обращения к BMI270 идут через M5.In_I2C
 * (у него внутри мьютекс, так что обращаться к шине из разных задач безопасно).
 *
 * Задачи FreeRTOS:
 *   imuTask (ядро 0) - опрос BMI270, кладёт события в две очереди: экран и BLE;
 *   bleTask (ядро 0) - BLE GATT-сервер, отправляет события уведомлениями и уровень батареи;
 *   micTask (ядро 0) - микрофон по команде игры: распознаёт, что в стик дуют (BLOW);
 *   loop()  (ядро 1) - экран и кнопки.
 * Задачи общаются только через очереди и atomic-переменные.
 *
 * BLE-протокол (сервис BLE_SERVICE_UUID):
 *   характеристика событий BLE_EVENT_UUID (read + notify), 12 байт, little-endian:
 *     [0]    id события (EventId), 0xFF = пакет состояния (при подключении)
 *     [1]    код подробности: ORIENT 0..3 (PORT UP, LAND L, PORT DN, LAND R),
 *            HIGH-G: биты 0-1 ось (0=X, 1=Y, 2=Z, 3=?), бит 7 = знак минус;
 *            FLAT: 1 = стик лежит плашмя, 0 = поднят (шлётся при смене, считается по акселерометру);
 *            пакет состояния 0xFF: 1 = стик сейчас лежит плашмя; иначе 0
 *     [2]    порядковый номер события (uint8); дырка в нумерации = событие потеряно
 *            на стике (переполнилась BLE-очередь). У пакета состояния не учитывается.
 *            ANY/NO MOTION отправляются не чаще BLE_THROTTLE_MS.
 *     [3]    резерв (0)
 *     [4..7] время на стике, мс (uint32)
 *            BLOW: сила выдоха 1..255 (начало), 0 - выдох закончился;
 *     [8..9] у REEL - сколько оборотов с включения катушки, в сотых (uint16); иначе 0
 *     [10..11] резерв (0)
 *   характеристика команд BLE_CMD_UUID (write), 1 байт:
 *     BLE_CMD_REEL_ON (1) - включить катушку, BLE_CMD_REEL_OFF (0) - выключить,
 *     BLE_CMD_MIC_ON (3) - включить микрофон, BLE_CMD_MIC_OFF (2) - выключить
 *   стандартный Battery Service 0x180F / 0x2A19 (read + notify), %.
 *
 * Катушка (REEL, id 10): игра включает её на время вываживания. Пока она включена,
 * работает гироскоп, и раз в REEL_SEND_MS приходит REEL: код = скорость вращения стика
 * кистью в десятых оборота в секунду (15 = 1.5 об/с), направление не важно.
 * Когда стик перестали крутить, приходит один REEL с кодом 0, дальше тишина.
 *
 * Энергосбережение: CPU 80 МГц, выключены динамик, микрофон (работает только по команде игры), RTC, 5V-выход, светодиод,
 * гироскоп работает только пока включена катушка (REEL), BLE TX 0 дБм, редкий advertising, экран притушен.
 * Экран горит SCREEN_TIMEOUT_MS после включения или нажатия кнопки и гаснет; события
 * датчика его не будят, включить заново можно только кнопкой.
 *
 * Микрофон (BLOW, id 11): игра включает его на время ночного костра. Пока он включён,
 * громкий выдох дольше BLOW_START_MS даёт BLOW с силой, конец выдоха - BLOW с кодом 0
 * (см. micTask). Номер 11 раньше был у ACTIVITY - шагомер не используется и не включается.
 *
 * Экран: сверху имя стика и статус BLE/батареи, ниже плитки всех событий.
 * Неактивная плитка - бледная, при событии подсвечивается его цветом и гаснет через 1.5 с.
 * У ORIENT и HIGH-G на подсвеченной плитке показывается подробность.
 *
 * Любая кнопка: нажатие - включить экран на SCREEN_TIMEOUT_MS.
 * Кнопка A (большая, передняя): удержание 2 с - выключить питание.
 */

#include <M5Unified.h>
#include <atomic>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLE2902.h>
#include "SparkFun_BMI270_Arduino_Library.h"   // нужен, чтобы IDE подключила библиотеку с Bosch API
#include "bmi270_api/bmi270_legacy.h"

#define DEBUG_LOG 1
#if DEBUG_LOG
#define LOG(...) Serial.printf(__VA_ARGS__)
#else
#define LOG(...) do {} while (0)
#endif

// Событие из задачи IMU в loop() и bleTask. Объявлено до первой функции: Arduino IDE
// вставляет автопрототипы (addEvent(const ImuEvent&)) перед первой функцией скетча.
struct ImuEvent {
  uint32_t t;
  uint8_t  idx;          // EventId
  uint8_t  code;         // код подробности для BLE (см. протокол в шапке)
  uint8_t  seq;          // порядковый номер BLE-пакета
  uint16_t extra;        // доп. данные для байтов 8..9 (REEL: обороты x100)
  char     detail[12];   // подробность для плитки ("" если нет)
};

// ---------- Настройки ----------
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
const uint32_t SCREEN_TIMEOUT_MS = 10000;  // экран гаснет через столько после включения / нажатия кнопки
const uint8_t  SCREEN_BRIGHTNESS = 60;     // 0..255
const uint32_t IMU_POLL_MS       = 25;
const uint32_t BLE_THROTTLE_MS   = 500;    // ANY/NO MOTION в BLE не чаще этого
const uint32_t FLAT_CHECK_MS     = 200;    // как часто проверять, лежит ли стик
const float    FLAT_ON_Z_G       = 0.90f;  // |z| больше - стик положили плашмя
const float    FLAT_OFF_Z_G      = 0.75f;  // |z| меньше - стик подняли (гистерезис от дребезга)

// Настройка тапов (подбираются опытным путём, текущие значения печатаются в Serial при старте).
// Тап ловится только по ОДНОЙ оси: на StickS3 Z - стук по экрану/задней крышке,
// X и Y - стук по торцам/бокам корпуса.
const int   TAP_AXIS            = 2;      // 0 = X, 1 = Y, 2 = Z, -1 = оставить как в прошивке Bosch
const float TAP_THRESHOLD_SCALE = 0.6f;   // множитель порога: < 1 - чувствительнее, > 1 - грубее, 1 - как было
const float TAP_GESTURE_SCALE   = 1.5f;   // множитель окна между тапами: > 1 - двойной/тройной можно стучать медленнее

// Настройка ориентации (ORIENT). По умолчанию у Bosch blocking = 3 - самая строгая
// блокировка: пока стик быстро движется или наклонён больше ORIENT_THETA, смена
// ориентации не засчитывается. При вываживании стик как раз крутят, и повороты терялись.
const int   ORIENT_BLOCKING     = 1;      // 0 - без блокировки, 1 - только по углу, 2/3 - по углу и движению; -1 - как в прошивке Bosch
const float ORIENT_HYST_SCALE   = 1.5f;   // множитель гистерезиса (по умолчанию 0.0625 g): < 1 - срабатывает раньше, но может дребезжать

// Настройка HIGH-G (рывок удочкой). По умолчанию у Bosch порог 4.9 g на 20 мс - под это
// попадают и резкие короткие удары тапа. Рывок слабее, но длиннее тапа, поэтому порог ниже,
// а время больше: короткий удар тапа до HIGH-G не дотягивает.
const float    HIGH_G_THRESHOLD_G = 3.0f;   // порог ускорения, g (по умолчанию 4.9)
const uint16_t HIGH_G_DURATION_MS = 50;     // сколько держаться выше порога, мс (по умолчанию 20, шаг 5)

// Катушка (REEL) при вываживании: см. reelUpdate(). Подбираются опытным путём.
const uint32_t REEL_POLL_MS     = 10;     // опрос датчика, пока катушка включена (100 Гц)
const uint32_t REEL_SEND_MS     = 100;    // как часто отправлять скорость в BLE
const uint32_t REEL_MAX_MS      = 60000;  // страховка: катушка сама выключается через минуту
const float    REEL_MIN_DPS     = 100.0f; // гироскоп: вращение медленнее - не считается
const float    REEL_MIN_ACC_G   = 0.25f;  // акселерометр: движение слабее - не считается
const float    REEL_GRAVITY_K   = 0.02f;  // как быстро фильтр гравитации догоняет наклон (0.02 = ~0.5 с)
const float    REEL_SMOOTH      = 0.4f;   // сглаживание разгона: 1 - без сглаживания, меньше - плавнее
const float    REEL_SMOOTH_DOWN = 0.8f;   // сглаживание остановки: ближе к 1 - скорость падает почти сразу
const float    REEL_MIN_SPEED   = 0.1f;   // медленнее (об/с) - считаем, что не крутят
const uint32_t REEL_STOP_MS     = 80;     // гироскоп не видит вращения столько мс - сразу шлём скорость 0

// ---------- Доступ к BMI270 через M5.In_I2C ----------
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

// ---------- Описание событий ----------
enum EventId : uint8_t {
  EV_TAP1, EV_TAP2, EV_TAP3,
  EV_ANY_MOT, EV_NO_MOT, EV_SIG_MOT,
  EV_HIGH_G, EV_LOW_G, EV_FLAT,
  EV_ORIENT,
  EV_REEL,          // 10 (раньше этот номер был у STEP)
  EV_BLOW,          // 11 - игрок дует в микрофон (раньше номер был у ACTIVITY)
  EV_COUNT
};

struct EventDef {
  const char* name;      // текст на экране
  uint16_t color;
};

// Порядок совпадает с EventId и с расположением плиток (3 в ряд)
const EventDef EVENTS[EV_COUNT] = {
  { "TAP x1",   TFT_WHITE },
  { "TAP x2",   TFT_GOLD },
  { "TAP x3",   TFT_PINK },
  { "ANY MOT",  TFT_ORANGE },
  { "NO MOT",   TFT_CYAN },
  { "SIG MOT",  TFT_RED },
  { "HIGH-G",   TFT_MAGENTA },
  { "LOW-G",    0xB81F },   // фиолетовый, светлее TFT_PURPLE
  { "FLAT",     TFT_SKYBLUE },
  { "ORIENT",   TFT_GREENYELLOW },
  { "REEL",     TFT_GREEN },   // катушка: скорость вращения
  { "BLOW",     TFT_YELLOW },  // дуют в микрофон: сила
};
const int EVENT_COUNT = EV_COUNT;

// Какие функции включаем (ID функций Bosch). Гироскоп не нужен - не включаем.
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

// Какие функции выводим на INT1 (в legacy все тапы идут через общий BMI2_TAP)
const uint8_t INT_MAP[] = {
  BMI2_SIG_MOTION, BMI2_TAP,
  BMI2_ORIENTATION, BMI2_HIGH_G, BMI2_LOW_G, BMI2_FLAT,
  BMI2_ANY_MOTION, BMI2_NO_MOTION,
};
const int INT_MAP_COUNT = sizeof(INT_MAP) / sizeof(INT_MAP[0]);

// Accel: 8G -> 4096 LSB/g
const float ACC_LSB_PER_G = 4096.0f;
// Gyro: 2000 dps -> 16.4 LSB/(град/с)
const float GYR_LSB_PER_DPS = 16.4f;

// ---------- Связь задач ----------
QueueHandle_t eventQueue = nullptr;   // imuTask -> loop (экран)
QueueHandle_t bleQueue = nullptr;     // imuTask -> bleTask
std::atomic<uint32_t> i2cErrors{0};
std::atomic<bool>     bleConnected{false};
std::atomic<bool>     stickFlat{false};    // стик лежит плашмя (считает imuTask)
std::atomic<int>      batteryPct{-1};
std::atomic<bool>     reelWanted{false};   // игра просит включить катушку (BLE-команда)
TaskHandle_t imuTaskHandle = nullptr;
TaskHandle_t bleTaskHandle = nullptr;

// ---------- Плитки событий (только из loop) ----------
const uint32_t HIGHLIGHT_MS = 1500;   // сколько плитка горит после события
const uint16_t DIM_TEXT   = 0x4208;   // бледный текст неактивной плитки
const uint16_t DIM_BORDER = 0x2945;   // бледная рамка неактивной плитки
const uint16_t BLE_COLOR  = 0x3D7F;   // голубой - BLE подключён

uint32_t lastEventTime[EVENT_COUNT] = {0};
bool     eventSeen[EVENT_COUNT] = {false};
char     eventDetail[EVENT_COUNT][12] = {};
uint32_t litMask = 0;      // какие плитки сейчас подсвечены (бит = EventId)

bool needRedraw = true;
int initErrors = 0;        // результат инициализации (для отображения)

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

// ---------- Настройка BMI270 ----------
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

  // Читаем обратно, чтобы убедиться, что датчик принял значения
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
  c.duration  = HIGH_G_DURATION_MS / 5;                          // в отсчётах 200 Гц

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

  // Быстрая проверка, что чип отвечает: CHIP_ID (0x00) должен быть 0x24
  uint8_t chipId = M5.In_I2C.readRegister8(BMI_ADDR, 0x00, BMI_FREQ);
  LOG("BMI270 CHIP_ID = 0x%02X (expected 0x24)\n", chipId);

  memset(&bmi, 0, sizeof(bmi));
  bmi.intf = BMI2_I2C_INTF;
  bmi.read = bmiRead;
  bmi.write = bmiWrite;
  bmi.delay_us = bmiDelayUs;
  bmi.intf_ptr = nullptr;
  bmi.read_write_len = 128;        // кусками по 128 байт грузится конфиг-файл
  bmi.config_file_ptr = nullptr;   // nullptr = встроенный legacy-конфиг

  // Загрузка конфиг-файла (~8 КБ)
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

  // Advanced power save выключаем: иначе API включает/выключает его на каждое чтение
  r = bmi2_set_adv_power_save(BMI2_DISABLE, &bmi);
  if (r != BMI2_OK) { failed++; LOG("adv_power_save FAILED: %d\n", r); }

  // Акселерометр: 200 Гц (тапам нужна частота повыше), диапазон 8G (запас для high-g)
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

  // Гироскоп: настраиваем сразу, а включаем только на время катушки (REEL)
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

  // Включаем функции и запоминаем, какие не включились
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

  // Настройка вывода прерываний (для регистра статуса)
  bmi2_int_pin_config pinCfg;
  memset(&pinCfg, 0, sizeof(pinCfg));
  pinCfg.pin_type = BMI2_INT1;
  pinCfg.int_latch = BMI2_INT_LATCH;
  pinCfg.pin_cfg[0].lvl = BMI2_INT_ACTIVE_LOW;
  pinCfg.pin_cfg[0].od = BMI2_INT_OPEN_DRAIN;   // линия идёт на PM1, не мешаем ей
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

// ---------- Задача FreeRTOS: опрос BMI270 ----------
// Частые события (ANY/NO MOTION приходят почти на каждом опросе, пока стик двигается)
// в BLE отправляются не чаще BLE_THROTTLE_MS. Иначе они забивают BLE-очередь:
// уведомление уходит примерно раз в интервал соединения (30-50 мс), очередь
// переполняется, и редкие важные события (ORIENT, TAP, HIGH-G) выбрасываются.
uint32_t lastBleSentMs[EV_COUNT] = {0};
uint8_t  bleSeq = 0;

bool isFrequentEvent(uint8_t idx) {
  return idx == EV_ANY_MOT || idx == EV_NO_MOT;
}

void sendEvent(uint8_t idx, const char* detail = "", uint8_t code = 0, uint16_t extra = 0) {
  ImuEvent ev;
  ev.t = millis();
  ev.idx = idx;
  ev.code = code;
  ev.extra = extra;
  strlcpy(ev.detail, detail, sizeof(ev.detail));
  if (idx == EV_REEL) {}       // REEL идёт 10 раз в секунду - в лог не пишем
  else if (detail[0]) LOG("[%lu ms] %s (%s)\n", (unsigned long)ev.t, EVENTS[idx].name, detail);
  else           LOG("[%lu ms] %s\n", (unsigned long)ev.t, EVENTS[idx].name);
  xQueueSend(eventQueue, &ev, 0);

  if (isFrequentEvent(idx) && ev.t - lastBleSentMs[idx] < BLE_THROTTLE_MS) return;
  lastBleSentMs[idx] = ev.t;
  // Номер присваивается здесь, а не при отправке: если событие не влезло в очередь,
  // на приёмной стороне будет видна дырка в нумерации
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

// Ускорение в g по осям; false при ошибке
bool readAccel(float& x, float& y, float& z) {
  bmi2_sens_data d;
  memset(&d, 0, sizeof(d));
  if (bmi2_get_sensor_data(&d, &bmi) != BMI2_OK) { i2cErrors++; return false; }
  x = d.acc.x / ACC_LSB_PER_G;
  y = d.acc.y / ACC_LSB_PER_G;
  z = d.acc.z / ACC_LSB_PER_G;
  return true;
}

// |a| в g, или -1 при ошибке
float readAccelMagnitude() {
  float x, y, z;
  if (!readAccel(x, y, z)) return -1;
  return sqrtf(x * x + y * y + z * z);
}

// ---------- Катушка (REEL) ----------
// Как считается вращение: при круговом движении кистью вращаются два вектора -
// угловая скорость (гироскоп) и ускорение без гравитации (акселерометр).
// Один круг кистью = один оборот вектора. SpinMeter складывает углы между
// соседними отсчётами вектора; из двух датчиков берётся тот, что насчитал больше.
// Направление вращения не важно - складываются только углы.
struct SpinMeter {
  float px = 0, py = 0, pz = 0, pm = 0;   // прошлый отсчёт и его длина
  bool  have = false;
  float angle = 0;                         // накопленный угол, рад

  void add(float x, float y, float z, float minMag) {
    float m = sqrtf(x * x + y * y + z * z);
    // Слабый вектор пропускаем и начинаем сравнение заново: при качании туда-сюда
    // вектор проходит через ноль и меняет знак - это не вращение
    if (m < minMag) { have = false; return; }
    if (have) {
      float c = (x * px + y * py + z * pz) / (m * pm);
      c = c > 1 ? 1 : (c < -1 ? -1 : c);
      float a = acosf(c);
      if (a < 1.2f) angle += a;   // больше ~70 градусов за один отсчёт - скачок, не вращение
    }
    px = x; py = y; pz = z; pm = m;
    have = true;
  }
};

struct ReelState {
  bool     on = false;
  uint32_t startMs = 0, lastSendMs = 0;
  SpinMeter gyro, acc;
  float    gx = 0, gy = 0, gz = 0;       // гравитация: медленное среднее ускорения
  float    speed = 0;                    // сглаженная скорость, об/с
  float    turns = 0;                    // оборотов с включения
  uint8_t  lastCode = 0;
  uint32_t lastSpinMs = 0;              // когда гироскоп последний раз видел вращение
};
ReelState reel;   // только из imuTask

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
  reel.startMs = reel.lastSendMs = now;
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

void reelUpdate(uint32_t now) {
  bmi2_sens_data d;
  memset(&d, 0, sizeof(d));
  if (bmi2_get_sensor_data(&d, &bmi) != BMI2_OK) { i2cErrors++; return; }

  float ax = d.acc.x / ACC_LSB_PER_G, ay = d.acc.y / ACC_LSB_PER_G, az = d.acc.z / ACC_LSB_PER_G;
  reel.gx += (ax - reel.gx) * REEL_GRAVITY_K;
  reel.gy += (ay - reel.gy) * REEL_GRAVITY_K;
  reel.gz += (az - reel.gz) * REEL_GRAVITY_K;
  reel.acc.add(ax - reel.gx, ay - reel.gy, az - reel.gz, REEL_MIN_ACC_G);
  reel.gyro.add(d.gyr.x / GYR_LSB_PER_DPS, d.gyr.y / GYR_LSB_PER_DPS, d.gyr.z / GYR_LSB_PER_DPS,
                REEL_MIN_DPS);
  if (reel.gyro.have) reel.lastSpinMs = now;   // have = вращение быстрее REEL_MIN_DPS
  bool spinning = now - reel.lastSpinMs < REEL_STOP_MS;

  // Остановка: гироскоп сразу видит, что кисть замерла. Шлём 0 немедленно,
  // не дожидаясь конца окна REEL_SEND_MS, чтобы игра перестала подматывать леску
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
  // Без вращения по гироскопу обороты не считаем: после остановки акселерометр
  // ещё какое-то время видит остаток движения, это не вращение
  float turns = spinning ? fmaxf(reel.gyro.angle, reel.acc.angle) / (2 * PI) : 0;
  reel.gyro.angle = reel.acc.angle = 0;
  reel.turns += turns;
  // Разгон сглаживаем сильно, а торможение почти нет: перестал крутить - скорость
  // сразу падает, и игра не продолжает подматывать леску (важно при натяжении)
  float raw = turns / dt;
  reel.speed += (raw - reel.speed) * (raw < reel.speed ? REEL_SMOOTH_DOWN : REEL_SMOOTH);
  if (reel.speed < REEL_MIN_SPEED) reel.speed = 0;

  uint8_t code = (uint8_t)fminf(255, reel.speed * 10 + 0.5f);
  if (code == 0 && reel.lastCode == 0) return;   // не крутят - эфир не засоряем
  reel.lastCode = code;
  char det[12];
  snprintf(det, sizeof(det), "%.1f t/s", reel.speed);
  sendEvent(EV_REEL, code ? det : "STOP", code, (uint16_t)fminf(65535, reel.turns * 100));
}

void imuTask(void*) {
  TickType_t lastWake = xTaskGetTickCount();
  uint32_t lastDebug = 0;
  uint32_t lastFlatCheck = 0;
  bmi2_feat_sensor_data f;

  static const char* ORIENT_NAMES[]   = { "PORT UP", "LAND L", "PORT DN", "LAND R" };

  for (;;) {
    // Опрос статуса событий (чтение сбрасывает флаги, события защёлкнуты в датчике)
    uint16_t status = 0;
    if (bmi2_get_int_status(&status, &bmi) != BMI2_OK) {
      i2cErrors++;
    } else if (status) {
      LOG("[%lu ms] INT_STATUS=0x%04X\n", (unsigned long)millis(), status);

      if (status & BMI270_LEGACY_TAP_STATUS_MASK) {
        // Тип тапа лежит в отдельном регистре
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
      // FLAT от датчика срабатывает ненадёжно - используем его только как повод
      // сразу перепроверить положение (основная проверка ниже, раз в FLAT_CHECK_MS)
      if (status & BMI270_LEGACY_FLAT_STATUS_MASK) lastFlatCheck = 0;

      // High-g и low-g делят один бит: различаем по текущему ускорению
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

    // Катушка: гироскоп работает только по команде игры и пока BLE подключён
    bool wantReel = reelWanted && bleConnected;
    if (wantReel && !reel.on) reelStart(now);
    else if (reel.on && !wantReel) reelStop("command");
    else if (reel.on && now - reel.startMs >= REEL_MAX_MS) reelStop("timeout");
    if (reel.on) reelUpdate(now);

    // Лежит ли стик плашмя: считаем сами по акселерометру, с гистерезисом.
    // Событие FLAT (код 1/0) отправляется только при смене состояния.
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
    // Отладка раз в 2 с: видно, что задача жива и шина работает
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

// ---------- Микрофон: игрок дует (BLOW) ----------
// Микрофон включается только по команде игры (ночной костёр) и пока BLE подключён.
// Звук читается кусками по MIC_CHUNK отсчётов (16 мс), у каждого куска считается громкость -
// RMS без постоянной составляющей (0..32767). Сам собой отслеживается фон - громкость тишины,
// поэтому стик работает и в тихой комнате, и на шумной улице.
// Дуют = громче BLOW_MIN_RMS и в BLOW_RATIO раз громче фона дольше BLOW_START_MS
// (короткие провалы до BLOW_GAP_MS не мешают). Тогда уходит BLOW с кодом силы 1..255.
// Стихло на BLOW_END_MS - уходит BLOW с кодом 0. Один выдох = одно событие с силой.
// Пороги подбираются на устройстве: пока микрофон включён, раз в 0.5 с в Serial
// печатается громкость (rms) и фон (noise).
const uint32_t MIC_RATE       = 16000;   // частота, Гц
const size_t   MIC_CHUNK      = 256;     // отсчётов в куске (16 мс)
const uint32_t MIC_WARMUP_MS  = 300;     // первые мс после включения не слушаем (щелчок включения)
const uint32_t MIC_MAX_MS     = 180000;  // страховка: микрофон сам выключается через 3 минуты
const float    BLOW_MIN_RMS   = 2000;    // тише - точно не дуют
const float    BLOW_RATIO     = 4.0f;    // во сколько раз громче фона
const uint32_t BLOW_START_MS  = 120;     // столько мс громко - значит дуют
const uint32_t BLOW_GAP_MS    = 60;      // провалы короче не прерывают начало выдоха
const uint32_t BLOW_END_MS    = 200;     // столько мс тихо - выдох закончился
const float    MIC_NOISE_K    = 0.03f;   // как быстро фон догоняет тишину

std::atomic<bool> micWanted{false};   // игра просит включить микрофон (BLE-команда)
std::atomic<bool> micOn{false};       // микрофон сейчас работает (ставит micTask)

struct BlowState {
  float    noise = 0;          // фон: громкость тишины
  float    peak = 0;           // самый громкий кусок текущего выдоха
  uint32_t loudSince = 0;      // когда стало громко (0 - тихо)
  uint32_t quietSince = 0;     // когда стало тихо посреди громкого
  bool     blowing = false;    // BLOW уже отправлен, ждём конца выдоха
} blow;

// Громкость куска: RMS без постоянной составляющей
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
  if (!loud && !blow.blowing) blow.noise += (rms - blow.noise) * MIC_NOISE_K;   // фон учим только по тишине

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
    blow.loudSince = 0;       // это был не выдох, а короткий звук (хлопок, стук)
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
        M5.Mic.record(buf[0], MIC_CHUNK, MIC_RATE);   // два куска в очереди - звук идёт без пропусков
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

    // Кусок готов, когда в очереди записи остался один (второй ещё пишется)
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

// ---------- Задача FreeRTOS: BLE ----------
// Команды от игры (характеристика BLE_CMD_UUID)
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
  c->addDescriptor(new BLE2902());   // в NimBLE дескриптор 0x2902 добавляется сам
#endif
  return c;
}

void packEvent(uint8_t* p, uint8_t id, uint8_t code, uint8_t seq, uint32_t t, uint16_t extra = 0) {
  p[0] = id;
  p[1] = code;
  p[2] = seq;
  p[3] = 0;
  memcpy(p + 4, &t, 4);       // ESP32 - little-endian
  memcpy(p + 8, &extra, 2);
  p[10] = p[11] = 0;          // резерв
}

void bleTask(void*) {
  BLEDevice::init(BLE_NAME);
  BLEDevice::setPower(ESP_PWR_LVL_N0);     // 0 дБм: хватает на комнату, экономит батарею

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

  // Advertising: UUID сервиса в основном пакете (по нему фильтрует браузер), имя - в scan response
  BLEAdvertising* adv = BLEDevice::getAdvertising();
  BLEAdvertisementData advData;
  advData.setFlags(0x06);   // LE General Discoverable, BR/EDR not supported
  advData.setCompleteServices(BLEUUID(BLE_SERVICE_UUID));
  BLEAdvertisementData scanData;
  scanData.setName(BLE_NAME);
  adv->setAdvertisementData(advData);
  adv->setScanResponseData(scanData);
  adv->setMinInterval(480);   // 300 мс (единицы 0.625 мс) - редкий advertising экономит батарею
  adv->setMaxInterval(800);   // 500 мс
  BLEDevice::startAdvertising();
  LOG("BLE advertising as \"%s\"\n", BLE_NAME);

  uint8_t pkt[12];
  bool wasConnected = false;
  uint32_t lastBattery = 0;
  bool batteryDue = true;

  for (;;) {
    ImuEvent ev;
    if (xQueueReceive(bleQueue, &ev, pdMS_TO_TICKS(1000)) == pdTRUE) {
      // Пока никто не подключён, события просто выбрасываем
      if (bleConnected) {
        packEvent(pkt, ev.idx, ev.code, ev.seq, ev.t, ev.extra);
        evtChar->setValue(pkt, sizeof(pkt));
        evtChar->notify();
      }
    }

    bool connected = bleConnected;
    if (connected != wasConnected) {
      wasConnected = connected;
      if (connected) {
        LOG("BLE connected\n");
        // Клиенту нужно время, чтобы подписаться на уведомления
        vTaskDelay(pdMS_TO_TICKS(500));
        // Код пакета состояния = лежит ли стик сейчас (seq не учитывается)
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

// ---------- Отрисовка ----------
void draw() {
  canvas.fillSprite(TFT_BLACK);
  canvas.setFont(&fonts::Font2);
  canvas.setTextDatum(top_left);

  // Заголовок: имя стика
  canvas.setTextColor(TFT_WHITE);
  canvas.drawString(BLE_NAME, 2, 2);

  // Справа: ошибки, иначе статус BLE и батарея
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
    if (stickFlat.load()) s = "FLAT " + s;   // видно, считает ли стик себя лежащим
    if (bat >= 0) s += String("  ") + bat + "%";
    canvas.setTextColor(c ? BLE_COLOR : TFT_DARKGREY);
    canvas.drawString(s, canvas.width() - 2, 2);
  }

  canvas.drawFastHLine(0, 20, canvas.width(), TFT_DARKGREY);

  // Плитки: сетка 3 колонки, порядок как в EVENTS
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
  setCpuFrequencyMhz(80);     // минимум, при котором работает BLE

  auto cfg = M5.config();
  cfg.serial_baudrate = 115200;
  cfg.internal_imu = false;   // IMU будем вести сами через Bosch API
  cfg.internal_spk = false;   // всё лишнее выключаем ради батареи
  cfg.internal_mic = true;    // микрофон только настраивается, включает его micTask по команде игры
  cfg.internal_rtc = false;
  cfg.output_power = false;   // 5V-выход на разъём не нужен
  cfg.led_brightness = 0;
  M5.begin(cfg);              // M5.begin сам вызывает Serial.begin

#if DEBUG_LOG
  // USB CDC: даём Serial Monitor время подключиться, иначе первые строки теряются
  uint32_t t0 = millis();
  while (!Serial && millis() - t0 < 3000) delay(10);
#endif
  LOG("\n=== StickS3 BMI270 BLE controller (legacy) ===\n");
  LOG("Board id: %d, CPU %lu MHz\n", (int)M5.getBoard(), (unsigned long)getCpuFrequencyMhz());

  M5.BtnA.setHoldThresh(2000);
  M5.Display.setRotation(1);  // альбомная: 240x135
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
  // loop() крутится на ядре 1, задачи IMU и BLE ставим на ядро 0 (там же стек BLE)
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
  // Любая кнопка включает экран ещё на SCREEN_TIMEOUT_MS
  if (M5.BtnA.wasPressed() || M5.BtnB.wasPressed() || M5.BtnPWR.wasPressed()) {
    lastActivityMs = now;
    setScreen(true);
  }

  // События только обновляют плитки, экран не будят (экономия батареи)
  ImuEvent ev;
  while (xQueueReceive(eventQueue, &ev, 0) == pdTRUE) addEvent(ev);

  if (screenOn && now - lastActivityMs >= SCREEN_TIMEOUT_MS) setScreen(false);

  // Перерисовка, когда плитка зажглась/погасла,
  // плюс раз в секунду (статус BLE, батарея, ошибки). Погасший экран не рисуем.
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

  delay(screenOn ? 10 : 50);   // с погасшим экраном loop() просыпается реже
}
