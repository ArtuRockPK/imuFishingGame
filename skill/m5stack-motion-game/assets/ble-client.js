'use strict';
// Browser side of the M5 motion controller — starting template.
// Connects over Web Bluetooth (Chrome/Edge, HTTPS or localhost, must start from a click),
// parses 12-byte event packets, sends 1-byte commands, and offers a keyboard fallback that
// produces the same events. Everything ends up in onControllerEvent(id, code) — wire it to
// your game's state machine.

const BLE_SERVICE_UUID = '00000000-0000-4000-8000-000000000001';   // must match the firmware
const BLE_EVENT_UUID   = '00000000-0000-4000-8000-000000000002';
const BLE_CMD_UUID     = '00000000-0000-4000-8000-000000000003';

const EV = { TAP1: 0, TAP2: 1, TAP3: 2, ANY_MOT: 3, NO_MOT: 4, SIG_MOT: 5, HIGH_G: 6, LOW_G: 7,
             FLAT: 8, ORIENT: 9, REEL: 10, BLOW: 11, BTN: 12 };
const EV_NAMES = Object.fromEntries(Object.entries(EV).map(([k, v]) => [v, k]));

let inputMode = null;      // 'ble' | 'keyboard'
let device = null, cmdChar = null, battery = null, lastSeq = null;
const stick = { flat: false, reelDir: 0 };   // reelDir: 1 CW, -1 CCW, 0 unknown

// Replace with your game's dispatcher
function onControllerEvent(id, code = 0) { console.log('event', EV_NAMES[id] || id, code); }

// ---------- Bluetooth ----------
async function connectBle() {
  if (!navigator.bluetooth) throw new Error('Web Bluetooth is not available: use Chrome or Edge');
  if (!device) {
    device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [BLE_SERVICE_UUID] }], optionalServices: ['battery_service'] });
    device.addEventListener('gattserverdisconnected', onDisconnected);
  }
  const server = await device.gatt.connect();
  const svc = await server.getPrimaryService(BLE_SERVICE_UUID);
  const evt = await svc.getCharacteristic(BLE_EVENT_UUID);
  evt.addEventListener('characteristicvaluechanged', onBleEvent);
  await evt.startNotifications();
  try { cmdChar = await svc.getCharacteristic(BLE_CMD_UUID); } catch (_) { cmdChar = null; }
  try {
    const bat = await (await server.getPrimaryService('battery_service')).getCharacteristic('battery_level');
    bat.addEventListener('characteristicvaluechanged', e => { battery = e.target.value.getUint8(0); });
    battery = (await bat.readValue()).getUint8(0);
    await bat.startNotifications();
  } catch (_) { /* optional */ }
  inputMode = 'ble';
  lastSeq = null;
  loadCalibration();
}

function onDisconnected() {
  cmdChar = null;
  // pause the game and show a "Reconnect" button that calls connectBle() (device is kept)
}

function onBleEvent(e) {
  const dv = e.target.value;
  if (dv.byteLength < 1) return;
  const id = dv.getUint8(0);
  const code = dv.byteLength > 1 ? dv.getUint8(1) : 0;
  const seq = dv.byteLength > 2 ? dv.getUint8(2) : 0;
  const aux = dv.byteLength > 3 ? dv.getUint8(3) : 0;
  if (id === 0xFF) { stick.flat = code === 1; return; }                    // state packet
  if (lastSeq !== null && seq !== ((lastSeq + 1) & 0xFF)) console.warn('lost events before seq', seq);
  lastSeq = seq;
  if (id === EV.FLAT) stick.flat = code === 1;
  if (id === EV.REEL) stick.reelDir = code ? reelDirection(aux) : 0;
  onControllerEvent(id, code);
}

// ---------- Commands (serialised: a concurrent GATT write throws) ----------
let cmdQueue = Promise.resolve();
function sendCmd(byte) {
  if (inputMode !== 'ble' || !cmdChar) return;
  const ch = cmdChar;
  cmdQueue = cmdQueue.then(() => ch.writeValueWithoutResponse(Uint8Array.of(byte)))
                     .catch(err => console.warn('command failed', err));
}
const setReel = on => sendCmd(on ? 1 : 0);
const setMic  = on => sendCmd(on ? 3 : 2);

// ---------- Spin direction, learned per device in calibration ----------
let calibration = null;   // { cw, ccw } — direction keys (aux & 0x83)
const calibrationKey = () => 'mygame.setup.' + ((device && device.name) || 'stick');
function loadCalibration() {
  try { calibration = JSON.parse(localStorage.getItem(calibrationKey())); } catch (_) { calibration = null; }
}
function saveCalibration(cw, ccw) {
  calibration = { cw, ccw };
  try { localStorage.setItem(calibrationKey(), JSON.stringify(calibration)); } catch (_) {}
}
function reelDirection(aux) {
  if (!(aux & 0x40) || !calibration || calibration.cw == null) return 0;
  const k = aux & 0x83;
  if (k === calibration.cw) return 1;
  if (k === calibration.ccw || k === (calibration.cw ^ 0x80)) return -1;
  return 0;
}

// ---------- Keyboard fallback: same events, no hardware ----------
const KEY_EVENTS = { Space: EV.TAP2, KeyA: EV.BTN, KeyH: EV.HIGH_G, Enter: EV.HIGH_G,
                     KeyL: EV.LOW_G, KeyN: EV.NO_MOT, KeyM: EV.ANY_MOT, KeyO: EV.ORIENT };
const KEY_SPIN = { KeyR: [1, 6], KeyE: [-1, 6], KeyT: [1, 0.9] };   // [direction, rev/s] while held

function startKeyboard() { inputMode = 'keyboard'; }

addEventListener('keydown', e => {
  if (inputMode !== 'keyboard' || e.repeat) return;
  if (e.code === 'Space') e.preventDefault();
  if (e.code === 'KeyF') return onControllerEvent(EV.FLAT, stick.flat ? 0 : 1);
  if (e.code === 'KeyB') return onControllerEvent(EV.BLOW, 120);
  if (KEY_SPIN[e.code]) { const [dir, rps] = KEY_SPIN[e.code]; stick.reelDir = dir; return onControllerEvent(EV.REEL, Math.round(rps * 10)); }
  if (e.code in KEY_EVENTS) onControllerEvent(KEY_EVENTS[e.code]);
});
addEventListener('keyup', e => {
  if (inputMode !== 'keyboard') return;
  if (KEY_SPIN[e.code]) { stick.reelDir = 0; onControllerEvent(EV.REEL, 0); }
  if (e.code === 'KeyB') onControllerEvent(EV.BLOW, 0);
});
