# imuFishingGame — Pixel Fishing

**[English](#english) · [Русский](#русский)**

▶ **Play:** https://arturockpk.github.io/imuFishingGame/web/fishing/

---

## English

An 8-bit browser fishing game where the rod is an M5 controller with a motion sensor:
flick it to cast, jerk to hook, twist your wrist to turn the reel, and at night blow into
the microphone to light a campfire. The controller sends its events to the game over Bluetooth.

### What's inside

| Folder / file | What it is |
|---|---|
| `StickS3_BMI270_events.ino` | Firmware for **M5StickS3** (BMI270, built-in gesture recognition) |
| `CardputerADV_BMI270_events/` | Firmware for **M5Cardputer ADV** (BMI270) |
| `StickCPlus2_MPU6886_events/` | Firmware for **M5StickC Plus2** (MPU6886, gestures recognized in firmware) |
| `web/fishing/` | **The game**: `index.html` + plain JS, no build step, no backend. Details (in Russian) — [web/fishing/README.md](web/fishing/README.md) |
| `web/ble_test.html` | Test page: connect a controller and watch all of its events |

All three firmwares share the same BLE protocol and event IDs, so the game works with any of them.

### Flashing a controller

1. Arduino IDE with the **M5Stack** board package and the **M5Unified** and **M5GFX** libraries;
   StickS3 and Cardputer ADV also need the **SparkFun BMI270 Arduino Library**.
2. Open the `.ino` for your device, select the board (M5StickS3 / M5Cardputer / M5StickCPlus2) and upload.
3. Board settings and recognition thresholds are described in the comment at the top of each `.ino`.

### Playing

You need **Chrome** or **Edge** (desktop or Android) — only they support Web Bluetooth.
The page must be served over `https://` or from `localhost`. Either use the link above, or run locally:

```
cd web
python -m http.server
```

and open `http://localhost:8000/fishing/`. Without a controller you can play with the keyboard:
`Space` — double tap, `H` — jerk (HIGH-G), `L` — drop (LOW-G), `O` — turn (ORIENT),
`R` / `T` (hold) — reel fast / slow, `F` — lay the stick flat, `B` (hold) — blow, `J` — skip an hour of game time.

---

## Русский

Браузерная 8-битная рыбалка. Удочка — контроллер M5 с датчиком движения:
им забрасывают (рывок), подсекают, крутят катушку (вращение кистью), а ночью
раздувают костёр (дуют в микрофон). Контроллер передаёт события в игру по Bluetooth.

### Что в репозитории

| Папка / файл | Что это |
|---|---|
| `StickS3_BMI270_events.ino` | Прошивка для **M5StickS3** (BMI270, встроенное распознавание жестов) |
| `CardputerADV_BMI270_events/` | Прошивка для **M5Cardputer ADV** (BMI270) |
| `StickCPlus2_MPU6886_events/` | Прошивка для **M5StickC Plus2** (MPU6886, распознавание в самой прошивке) |
| `web/fishing/` | **Игра**: `index.html` + JS, без сборки и без сервера. Подробно — [web/fishing/README.md](web/fishing/README.md) |
| `web/ble_test.html` | Тестовая страница: подключить контроллер и посмотреть все его события |

У всех трёх прошивок одинаковый BLE-протокол и номера событий, игра работает с любой из них.

### Как прошить контроллер

1. Arduino IDE, пакет плат **M5Stack**, библиотеки **M5Unified** и **M5GFX**;
   для StickS3 и Cardputer ADV ещё **SparkFun BMI270 Arduino Library**.
2. Открыть `.ino` нужного устройства, выбрать плату (M5StickS3 / M5Cardputer / M5StickCPlus2), прошить.
3. Подробности (настройки платы, пороги распознавания) — в комментарии в начале каждого `.ino`.

### Как играть

Нужен **Chrome** или **Edge** (на компьютере или Android): только в них есть Web Bluetooth.
Страница должна быть открыта по `https://` или с `localhost`. Можно играть по ссылке выше
или запустить у себя:

```
cd web
python -m http.server
```

и открыть `http://localhost:8000/fishing/`. Без контроллера можно играть с клавиатуры —
клавиши описаны в [web/fishing/README.md](web/fishing/README.md).
