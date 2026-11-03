'use strict';
// =====================================================================
//  УПРАВЛЕНИЕ: стик по Bluetooth и клавиатура для тестов
//  Всё, что приходит отсюда, передаётся в onControllerEvent(id, code) (game.js).
// =====================================================================

let inputMode = null;    // 'ble' - стик, 'keyboard' - клавиатура, null - ещё не выбрано
let paused = false;      // пауза (стик отключился)
let battery = null;      // заряд стика, %
let device = null;       // подключённый стик
let cmdChar = null;      // характеристика команд стику (нет у старой прошивки)

// ---------- Bluetooth ----------
// Пакет от стика: байт 0 - номер события (EV), байт 1 - код подробности.
// 0xFF - пакет состояния при подключении (код = стик лежит плашмя).
function onBleEvent(e) {
  const dv = e.target.value;
  if (dv.byteLength < 1) return;
  const id = dv.getUint8(0);
  const code = dv.byteLength > 1 ? dv.getUint8(1) : 0;
  console.log('BLE', id === 0xFF ? 'STATE' : (EV_NAMES[id] || id), 'code', code);   // видно в F12
  if (id === 0xFF) {
    stick.flat = code === 1;
    return;
  }
  onControllerEvent(id, code);
}

function onBattery(e) { battery = e.target.value.getUint8(0); }

function onDisconnected() {
  cmdChar = null;
  if (inputMode !== 'ble') return;
  paused = true;
  showOverlay(T('paused'), T('disconnected'), [{ label: T('btn_reconnect'), onClick: connectBle }],
              T('check_stick'), true);
}

async function connectBle() {
  if (!navigator.bluetooth) {
    setStatus(T('no_bluetooth'), true);
    return;
  }
  setButtonsDisabled(true);
  setStatus(T('searching'));
  try {
    if (!device) {
      device = await navigator.bluetooth.requestDevice({
        filters: [{ services: [BLE_SERVICE_UUID] }],
        optionalServices: ['battery_service'],
      });
      device.addEventListener('gattserverdisconnected', onDisconnected);
    }
    setStatus(T('connecting'));
    const server = await device.gatt.connect();
    const svc = await server.getPrimaryService(BLE_SERVICE_UUID);
    const evtChar = await svc.getCharacteristic(BLE_EVENT_UUID);
    evtChar.addEventListener('characteristicvaluechanged', onBleEvent);
    await evtChar.startNotifications();
    try {
      cmdChar = await svc.getCharacteristic(BLE_CMD_UUID);
    } catch (_) {
      cmdChar = null;   // старая прошивка: катушки нет, вываживание по ORIENT
    }
    try {
      const bat = await (await server.getPrimaryService('battery_service')).getCharacteristic('battery_level');
      bat.addEventListener('characteristicvaluechanged', onBattery);
      battery = (await bat.readValue()).getUint8(0);
      await bat.startNotifications();
    } catch (_) { /* батарея не обязательна */ }

    const firstStart = inputMode === null;
    inputMode = 'ble';
    paused = false;
    hideOverlay();
    if (firstStart || game.state === 'wait') startGame();
  } catch (err) {
    setStatus(T('error', { msg: err.message }), true);
    setButtonsDisabled(false);
  }
}

// ---------- Катушка (REEL) ----------
// Игра включает катушку на время вываживания: стик включает гироскоп и присылает
// скорость вращения (EV.REEL). Команды идут по очереди, чтобы не мешать друг другу.
let cmdQueue = Promise.resolve();
function setReel(on) {
  if (inputMode !== 'ble' || !cmdChar) return;
  const ch = cmdChar;
  cmdQueue = cmdQueue
    .then(() => ch.writeValueWithoutResponse(Uint8Array.of(on ? 1 : 0)))
    .catch((err) => console.warn('REEL cmd failed', err));
}

// ---------- Микрофон (BLOW) ----------
// Игра включает микрофон на время ночного костра: стик присылает BLOW, когда в него дуют
function setMic(on) {
  if (inputMode !== 'ble' || !cmdChar) return;
  const ch = cmdChar;
  cmdQueue = cmdQueue
    .then(() => ch.writeValueWithoutResponse(Uint8Array.of(on ? 3 : 2)))
    .catch((err) => console.warn('MIC cmd failed', err));
}

// Умеет ли контроллер катушку (клавиатура умеет: клавиша R)
function reelSupported() {
  return inputMode === 'keyboard' || !!cmdChar;
}

// ---------- Клавиатура (тест без стика) ----------
function startKeyboard() {
  inputMode = 'keyboard';
  paused = false;
  hideOverlay();
  startGame();
}

// R / T: пока клавиша зажата - катушка крутится быстро / медленно (для натяжения), об/с
const KEYBOARD_REEL_SPEED = 6;
const KEYBOARD_REEL_SLOW = 0.9;

// Какая клавиша какое событие стика изображает
const KEYBOARD_EVENTS = {
  Space: EV.TAP2,
  KeyH: EV.HIGH_G,
  KeyL: EV.LOW_G,
  Enter: EV.HIGH_G,
  KeyO: EV.ORIENT,
  KeyN: EV.NO_MOT,
  KeyM: EV.ANY_MOT,
};

addEventListener('keydown', (e) => {
  if (e.code === 'KeyG') { showDebug = !showDebug; return; }   // отладка работает и со стиком
  if (e.code === 'KeyJ' && game.state !== 'wait') { advanceClock(1); return; }   // промотать время на час
  if (e.code === 'KeyV') { ambienceOn = !ambienceOn; return; }                  // звуки природы вкл/выкл
  if (inputMode !== 'keyboard' || e.repeat) return;
  if (e.code === 'Space') e.preventDefault();                 // чтобы страница не прокручивалась
  if (e.code === 'KeyF') { onControllerEvent(EV.FLAT, stick.flat ? 0 : 1); return; }   // положить / поднять
  if (e.code === 'KeyR') { onControllerEvent(EV.REEL, KEYBOARD_REEL_SPEED * 10); return; }   // крутим катушку
  if (e.code === 'KeyT') { onControllerEvent(EV.REEL, KEYBOARD_REEL_SLOW * 10); return; }    // медленно
  if (e.code === 'KeyB') { onControllerEvent(EV.BLOW, 120); return; }                         // дуем, пока зажата
  if (e.code in KEYBOARD_EVENTS) onControllerEvent(KEYBOARD_EVENTS[e.code]);
});

addEventListener('keyup', (e) => {
  if (inputMode === 'keyboard' && (e.code === 'KeyR' || e.code === 'KeyT')) onControllerEvent(EV.REEL, 0);   // отпустили - не крутим
  if (inputMode === 'keyboard' && e.code === 'KeyB') onControllerEvent(EV.BLOW, 0);                            // выдох кончился
});
