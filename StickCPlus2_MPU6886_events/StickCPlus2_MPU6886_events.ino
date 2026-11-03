/*
 * M5StickC Plus2 + MPU6886: BLE-контроллер с программным распознаванием событий
 * (порт прошивки StickS3_BMI270_events: те же события, тот же BLE-протокол,
 *  поэтому игра и ble_test.html работают с ним без изменений)
 *
 * Библиотеки (Arduino Library Manager): M5Unified, M5GFX. BLE входит в ядро ESP32.
 * Другие библиотеки не нужны: у MPU6886 нет встроенного распознавания жестов, а готовой
 * библиотеки с тапами/ориентацией/рывками под него нет, поэтому всё считается здесь.
 *
 * Плата в Arduino IDE: M5StickCPlus2 (пакет M5Stack). Serial Monitor 115200,
 * USB-CDC настраивать не нужно (на StickC Plus2 USB-UART мост).
 * Для работы от батареи отладку можно выключить: DEBUG_LOG 0.
 *
 * Датчик: MPU6886 на внутренней шине I2C (SDA=21, SCL=22). M5Unified сам находит его
 * и настраивает (+-8 g, +-2000 град/с, 250 Гц). Какой датчик найден - печатается в Serial.
 * Чтение - через M5.Imu (внутри мьютекс шины, безопасно из задачи на другом ядре).
 *
 * Распознавание (imuTask, опрос каждые IMU_POLL_MS = 5 мс, 200 Гц):
 *   TAP x1/x2/x3 - резкий скачок ускорения по оси TAP_AXIS между соседними отсчётами
 *                  (удар длится миллисекунды), потом тишина; тапы с паузой меньше
 *                  TAP_GAP_MS складываются в двойной/тройной.
 *   HIGH-G       - |a| выше HIGH_G_THRESHOLD_G дольше HIGH_G_DURATION_MS (рывок длиннее тапа).
 *   LOW-G        - |a| ниже LOW_G_THRESHOLD_G дольше LOW_G_DURATION_MS (резко опустили стик).
 *   ANY MOT      - ускорение отличается от медленно усреднённого больше чем на MOTION_G.
 *   NO MOT       - движения нет NO_MOT_MS.
 *   SIG MOT      - движение без перерывов дольше SIG_MOT_MS.
 *   ORIENT       - по вектору гравитации: какая сторона смотрит вниз (4 положения),
 *                  только пока стик не лежит плашмя; смена должна продержаться ORIENT_HOLD_MS.
 *   FLAT         - |z| гравитации больше FLAT_ON_Z_G / меньше FLAT_OFF_Z_G.
 *   REEL         - катушка: как в прошивке StickS3, гироскоп включается по команде игры.
 *   BLOW         - дуют в микрофон (встроенный PDM-микрофон SPM1423), как в прошивке StickS3:
 *                  микрофон включается по команде игры, см. micTask.
 * Все пороги - в разделе "Настройки распознавания", подбираются опытным путём.
 *
 * BLE-протокол (сервис BLE_SERVICE_UUID):
 *   характеристика событий BLE_EVENT_UUID (read + notify), 12 байт, little-endian:
 *     [0]    id события (EventId), 0xFF = пакет состояния (при подключении)
 *     [1]    код подробности: ORIENT 0..3 (PORT UP, LAND L, PORT DN, LAND R),
 *            HIGH-G: биты 0-1 ось (0=X, 1=Y, 2=Z), бит 7 = знак минус;
 *            FLAT: 1 = стик лежит плашмя, 0 = поднят;
 *            REEL: скорость вращения в десятых оборота в секунду;
 *            пакет состояния 0xFF: 1 = стик сейчас лежит плашмя; иначе 0
 *     [2]    порядковый номер события (uint8); дырка в нумерации = событие потеряно
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
 * Энергосбережение: CPU 80 МГц, выключены динамик, микрофон (работает только по команде игры), RTC, светодиод,
 * гироскоп в режиме ожидания, пока не включена катушка, BLE TX 0 дБм, редкий advertising.
 * Экран горит SCREEN_TIMEOUT_MS после включения или нажатия кнопки и гаснет.
 *
 * Любая кнопка (A - большая передняя, B - боковая, питание - другой бок): включить экран.
 * Кнопка A: удержание 2 с - выключить питание (от USB стик не выключится - питание с кабеля).
 */

#include <M5Unified.h>
#include <atomic>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLE2902.h>

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
const char*    BLE_NAME         = "StickCP2-Rod";
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
const uint32_t IMU_POLL_MS       = 5;      // 200 Гц: тапу нужна частота повыше
const uint32_t BLE_THROTTLE_MS   = 500;    // ANY/NO MOTION в BLE не чаще этого

// ---------- Настройки распознавания (подбираются опытным путём) ----------
// Тап: скачок ускорения по одной оси между соседними отсчётами (5 мс)
const int      TAP_AXIS           = 2;      // 0 = X, 1 = Y, 2 = Z (стук по экрану/задней крышке)
const float    TAP_JERK_G         = 0.9f;   // скачок больше этого (g за отсчёт) - удар
const uint32_t TAP_SHOCK_MS       = 40;     // удар должен утихнуть за это время, иначе это не тап
const uint32_t TAP_QUIET_MS       = 80;     // после удара столько не ловим следующий (дребезг корпуса)
const uint32_t TAP_GAP_MS         = 350;    // пауза между тапами двойного/тройного
const float    TAP_QUIET_G        = 0.35f;  // "утихло": скачки меньше этого
// Рывок и падение
const float    HIGH_G_THRESHOLD_G = 3.0f;   // рывок: |a| выше этого...
const uint32_t HIGH_G_DURATION_MS = 50;     // ...дольше этого (тап короче)
const uint32_t HIGH_G_LOCK_MS     = 400;    // после рывка столько не ловим следующий
const float    LOW_G_THRESHOLD_G  = 0.4f;   // резко опустили: |a| ниже этого...
const uint32_t LOW_G_DURATION_MS  = 30;     // ...дольше этого
const uint32_t LOW_G_LOCK_MS      = 400;
// Движение
const float    MOTION_G           = 0.08f;  // отличие от усреднённого ускорения - движение
const uint32_t ANY_MOT_EVERY_MS   = 200;    // ANY MOT не чаще (на экран и в лог)
const uint32_t NO_MOT_MS          = 2000;   // столько без движения - NO MOT
const uint32_t SIG_MOT_MS         = 5000;   // столько движения без перерывов - SIG MOT
const uint32_t MOTION_GAP_MS      = 1000;   // перерыв короче этого не прерывает "долгое движение"
// Ориентация и лежание
const float    GRAVITY_K          = 0.04f;  // сглаживание гравитации (0.04 при 200 Гц = ~0.1 с)
const float    MOTION_K           = 0.02f;  // усреднение для ANY MOT (~0.25 с)
const float    ORIENT_MIN_G       = 0.5f;   // сторона "смотрит вниз", если её проекция больше этого
const float    ORIENT_MARGIN_G    = 0.15f;  // и больше соседней хотя бы на столько (гистерезис)
const float    ORIENT_FLAT_Z_G    = 0.8f;   // стик почти плашмя - ориентацию не меняем
const uint32_t ORIENT_HOLD_MS     = 60;     // новое положение должно продержаться столько
const float    FLAT_ON_Z_G        = 0.90f;  // |z| больше - стик положили плашмя
const float    FLAT_OFF_Z_G       = 0.75f;  // |z| меньше - стик подняли (гистерезис от дребезга)

// Катушка (REEL) при вываживании: см. reelUpdate(). Подбираются опытным путём.
const uint32_t REEL_SEND_MS     = 100;    // как часто отправлять скорость в BLE
const uint32_t REEL_MAX_MS      = 60000;  // страховка: катушка сама выключается через минуту
const float    REEL_MIN_DPS     = 100.0f; // гироскоп: вращение медленнее - не считается
const float    REEL_MIN_ACC_G   = 0.25f;  // акселерометр: движение слабее - не считается
const float    REEL_GRAVITY_K   = 0.01f;  // как быстро фильтр гравитации догоняет наклон (~0.5 с при 200 Гц)
const float    REEL_SMOOTH      = 0.4f;   // сглаживание разгона: 1 - без сглаживания, меньше - плавнее
const float    REEL_SMOOTH_DOWN = 0.8f;   // сглаживание остановки: ближе к 1 - скорость падает почти сразу
const float    REEL_MIN_SPEED   = 0.1f;   // медленнее (об/с) - считаем, что не крутят
const uint32_t REEL_STOP_MS     = 80;     // гироскоп не видит вращения столько мс - сразу шлём скорость 0

// MPU6886: регистр PWR_MGMT_2 - режим ожидания гироскопа (экономия, пока не нужна катушка)
const uint8_t  MPU_ADDR        = 0x68;
const uint8_t  MPU_PWR_MGMT_2  = 0x6C;
const uint8_t  MPU_GYRO_STBY   = 0x07;    // биты STBY_XG/YG/ZG
const uint32_t MPU_FREQ        = 400000;

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
bool imuIsMpu6886 = false;

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

// ---------- Отправка событий ----------
// Частые события (ANY/NO MOTION) в BLE отправляются не чаще BLE_THROTTLE_MS,
// иначе они забивают BLE-очередь и вытесняют редкие важные (TAP, HIGH-G, ORIENT).
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

// ---------- Датчик ----------
// Гироскоп MPU6886 в режим ожидания / обратно (M5Unified такой функции не даёт)
bool setGyro(bool on) {
  if (!imuIsMpu6886) return true;   // другой датчик - не трогаем, гироскоп просто всегда включён
  bool ok = M5.In_I2C.writeRegister8(MPU_ADDR, MPU_PWR_MGMT_2, on ? 0x00 : MPU_GYRO_STBY, MPU_FREQ);
  if (!ok) { i2cErrors++; LOG("gyro %s FAILED\n", on ? "on" : "off"); }
  return ok;
}

// ---------- Распознавание событий (только из imuTask) ----------
struct Detector {
  bool     init = false;
  float    prev[3] = {0, 0, 0};        // прошлый отсчёт (для скачка тапа)
  float    grav[3] = {0, 0, 1};        // гравитация (быстрое сглаживание) - ориентация, лежание
  float    avg[3]  = {0, 0, 1};        // среднее для ANY MOT
  // тап
  uint32_t shockAt = 0;                // когда был удар (0 - нет)
  bool     shockBig = false;           // в удар вмешался долгий рывок - это не тап
  uint32_t lastTapAt = 0;
  int      taps = 0;
  // рывок / падение
  uint32_t highSince = 0, highLockUntil = 0;
  float    highPeak = 0; uint8_t highCode = 0;
  uint32_t lowSince = 0, lowLockUntil = 0;
  // движение
  uint32_t lastMotionAt = 0, lastAnyMotSent = 0, motionSince = 0;
  bool     still = false;
  // ориентация
  int      orient = -1, orientCand = -1;
  uint32_t orientCandSince = 0;
};
Detector det;

static const char* ORIENT_NAMES[] = { "PORT UP", "LAND L", "PORT DN", "LAND R" };

void detectorStep(uint32_t now, float ax, float ay, float az) {
  float a[3] = { ax, ay, az };
  if (!det.init) {
    for (int i = 0; i < 3; i++) det.prev[i] = det.grav[i] = det.avg[i] = a[i];
    det.init = true;
    det.lastMotionAt = now;
  }
  float mag = sqrtf(ax * ax + ay * ay + az * az);
  for (int i = 0; i < 3; i++) {
    det.grav[i] += (a[i] - det.grav[i]) * GRAVITY_K;
    det.avg[i]  += (a[i] - det.avg[i]) * MOTION_K;
  }

  // ---- HIGH-G: долго выше порога ----
  if (mag > HIGH_G_THRESHOLD_G) {
    if (!det.highSince) { det.highSince = now; det.highPeak = 0; }
    if (mag > det.highPeak) {
      // ось и знак самой большой составляющей в пике
      int axis = 0;
      for (int i = 1; i < 3; i++) if (fabsf(a[i]) > fabsf(a[axis])) axis = i;
      det.highPeak = mag;
      det.highCode = axis | (a[axis] < 0 ? 0x80 : 0);
    }
    if (now - det.highSince >= HIGH_G_DURATION_MS && now >= det.highLockUntil) {
      char d[12];
      snprintf(d, sizeof(d), "HIGH-G %c%c", "XYZ"[det.highCode & 3], (det.highCode & 0x80) ? '-' : '+');
      sendEvent(EV_HIGH_G, d, det.highCode);
      det.highLockUntil = now + HIGH_G_LOCK_MS;
      det.shockBig = true;            // это рывок, не тап
      det.taps = 0;
    }
  } else {
    det.highSince = 0;
  }

  // ---- LOW-G: долго почти невесомость ----
  if (mag < LOW_G_THRESHOLD_G) {
    if (!det.lowSince) det.lowSince = now;
    if (now - det.lowSince >= LOW_G_DURATION_MS && now >= det.lowLockUntil) {
      sendEvent(EV_LOW_G);
      det.lowLockUntil = now + LOW_G_LOCK_MS;
    }
  } else {
    det.lowSince = 0;
  }

  // ---- TAP: короткий удар по оси TAP_AXIS, потом тишина ----
  float jerk = fabsf(a[TAP_AXIS] - det.prev[TAP_AXIS]);
  if (det.shockAt) {
    // идёт удар: ждём, пока утихнет; если затянулся - это не тап
    if (now - det.shockAt > TAP_SHOCK_MS) {
      det.shockAt = 0;
    } else if (jerk < TAP_QUIET_G && now - det.shockAt >= 15) {
      if (!det.shockBig) {
        det.taps = det.taps < 3 ? det.taps + 1 : 3;
        det.lastTapAt = det.shockAt;
      }
      det.shockAt = 0;
    }
  } else if (jerk > TAP_JERK_G && now - det.lastTapAt >= TAP_QUIET_MS) {
    det.shockAt = now;
    det.shockBig = false;
  }
  // Пауза после последнего тапа вышла - отдаём TAP x1/x2/x3
  if (det.taps && !det.shockAt && now - det.lastTapAt > TAP_GAP_MS) {
    sendEvent(det.taps == 1 ? EV_TAP1 : det.taps == 2 ? EV_TAP2 : EV_TAP3);
    det.taps = 0;
  }
  for (int i = 0; i < 3; i++) det.prev[i] = a[i];

  // ---- ANY / NO / SIG MOTION ----
  float dx = ax - det.avg[0], dy = ay - det.avg[1], dz = az - det.avg[2];
  bool moving = sqrtf(dx * dx + dy * dy + dz * dz) > MOTION_G;
  if (moving) {
    if (!det.motionSince || now - det.lastMotionAt > MOTION_GAP_MS) det.motionSince = now;   // новое движение
    det.lastMotionAt = now;
    det.still = false;
    if (now - det.lastAnyMotSent >= ANY_MOT_EVERY_MS) {
      sendEvent(EV_ANY_MOT);
      det.lastAnyMotSent = now;
    }
    if (det.motionSince && now - det.motionSince >= SIG_MOT_MS) {
      sendEvent(EV_SIG_MOT);
      det.motionSince = now;           // следующий - ещё через SIG_MOT_MS движения
    }
  } else if (!det.still && now - det.lastMotionAt >= NO_MOT_MS) {
    sendEvent(EV_NO_MOT);
    det.still = true;
    det.motionSince = 0;
  }

  // ---- FLAT: лежит ли стик плашмя (по сглаженной гравитации, с гистерезисом) ----
  float gz = fabsf(det.grav[2]);
  bool flat = stickFlat.load();
  if (!flat && gz > FLAT_ON_Z_G)  flat = true;
  if (flat  && gz < FLAT_OFF_Z_G) flat = false;
  if (flat != stickFlat.load()) {
    stickFlat = flat;
    sendEvent(EV_FLAT, flat ? "FLAT ON" : "FLAT OFF", flat ? 1 : 0);
  }

  // ---- ORIENT: какая сторона смотрит вниз (4 положения) ----
  if (gz < ORIENT_FLAT_Z_G) {
    // проекции: 0 PORT UP (-y вниз), 1 LAND L (+x), 2 PORT DN (+y), 3 LAND R (-x)
    float p[4] = { -det.grav[1], det.grav[0], det.grav[1], -det.grav[0] };
    int best = 0;
    for (int i = 1; i < 4; i++) if (p[i] > p[best]) best = i;
    float second = -10;
    for (int i = 0; i < 4; i++) if (i != best && p[i] > second) second = p[i];
    if (best != det.orient && p[best] > ORIENT_MIN_G && p[best] - second > ORIENT_MARGIN_G) {
      if (best != det.orientCand) { det.orientCand = best; det.orientCandSince = now; }
      else if (now - det.orientCandSince >= ORIENT_HOLD_MS) {
        bool first = det.orient < 0;
        det.orient = best;
        if (!first) sendEvent(EV_ORIENT, ORIENT_NAMES[best], best);   // первое положение после старта не шлём
      }
    } else {
      det.orientCand = -1;
    }
  }
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

void reelStart(uint32_t now, float ax, float ay, float az) {
  if (!setGyro(true)) { reelWanted = false; return; }
  reel = ReelState();
  reel.on = true;
  reel.startMs = reel.lastSendMs = now;
  reel.gx = ax; reel.gy = ay; reel.gz = az;
  LOG("[%lu ms] REEL on\n", (unsigned long)now);
}

void reelStop(const char* why) {
  setGyro(false);
  reel.on = false;
  reelWanted = false;
  if (reel.lastCode) sendEvent(EV_REEL, "STOP", 0, (uint16_t)fminf(65535, reel.turns * 100));
  LOG("[%lu ms] REEL off (%s), %.1f turns\n", (unsigned long)millis(), why, reel.turns);
}

void reelUpdate(uint32_t now, float ax, float ay, float az) {
  float gx, gy, gz;
  if (!M5.Imu.getGyro(&gx, &gy, &gz)) { i2cErrors++; return; }

  reel.gx += (ax - reel.gx) * REEL_GRAVITY_K;
  reel.gy += (ay - reel.gy) * REEL_GRAVITY_K;
  reel.gz += (az - reel.gz) * REEL_GRAVITY_K;
  reel.acc.add(ax - reel.gx, ay - reel.gy, az - reel.gz, REEL_MIN_ACC_G);
  reel.gyro.add(gx, gy, gz, REEL_MIN_DPS);
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
  char d[12];
  snprintf(d, sizeof(d), "%.1f t/s", reel.speed);
  sendEvent(EV_REEL, code ? d : "STOP", code, (uint16_t)fminf(65535, reel.turns * 100));
}

// ---------- Задача FreeRTOS: опрос MPU6886 и распознавание ----------
void imuTask(void*) {
  TickType_t lastWake = xTaskGetTickCount();
  uint32_t lastDebug = 0;

  for (;;) {
    uint32_t now = millis();
    float ax, ay, az;
    if (M5.Imu.getAccel(&ax, &ay, &az)) {
      detectorStep(now, ax, ay, az);

      // Катушка: гироскоп работает только по команде игры и пока BLE подключён
      bool wantReel = reelWanted && bleConnected;
      if (wantReel && !reel.on) reelStart(now, ax, ay, az);
      else if (reel.on && !wantReel) reelStop("command");
      else if (reel.on && now - reel.startMs >= REEL_MAX_MS) reelStop("timeout");
      if (reel.on) reelUpdate(now, ax, ay, az);

#if DEBUG_LOG
      // Отладка раз в 2 с: видно, что задача жива и что показывает датчик
      if (now - lastDebug >= 2000) {
        lastDebug = now;
        LOG("[%lu ms] acc=%.2f %.2f %.2f g  flat=%d orient=%d  i2cErr=%lu  ble=%d  bat=%d%%\n",
            (unsigned long)now, ax, ay, az, (int)stickFlat.load(), det.orient,
            (unsigned long)i2cErrors.load(), (int)bleConnected.load(), batteryPct.load());
      }
#else
      (void)lastDebug;
#endif
    } else {
      i2cErrors++;
    }
    vTaskDelayUntil(&lastWake, pdMS_TO_TICKS(IMU_POLL_MS));
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
  cfg.internal_imu = true;    // MPU6886 ведёт M5Unified, мы только читаем данные
  cfg.internal_spk = false;   // всё лишнее выключаем ради батареи
  cfg.internal_mic = true;    // микрофон только настраивается, включает его micTask по команде игры
  cfg.internal_rtc = false;
  cfg.led_brightness = 0;
  M5.begin(cfg);              // M5.begin сам вызывает Serial.begin

  LOG("\n=== StickC Plus2 MPU6886 BLE controller ===\n");
  LOG("Board id: %d, CPU %lu MHz\n", (int)M5.getBoard(), (unsigned long)getCpuFrequencyMhz());

  M5.BtnA.setHoldThresh(2000);
  M5.Display.setRotation(1);  // альбомная: 240x135
  M5.Display.setBrightness(SCREEN_BRIGHTNESS);
  canvas.createSprite(M5.Display.width(), M5.Display.height());

  // Какой датчик нашёл M5Unified
  m5::imu_t imu = M5.Imu.getType();
  static const char* IMU_NAMES[] = { "none", "unknown", "SH200Q", "MPU6050", "MPU6886", "MPU9250", "BMI270" };
  const char* imuName = (int)imu < 7 ? IMU_NAMES[(int)imu] : "?";
  LOG("IMU: %s\n", imuName);
  imuIsMpu6886 = imu == m5::imu_mpu6886;

  if (imu == m5::imu_none) {
    canvas.fillSprite(TFT_BLACK);
    canvas.setFont(&fonts::Font2);
    canvas.setTextColor(TFT_RED);
    canvas.setCursor(2, 2);
    canvas.println("IMU NOT FOUND");
    canvas.println("Check Serial log");
    canvas.pushSprite(0, 0);
    while (true) delay(1000);
  }
  setGyro(false);             // гироскоп нужен только катушке

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
