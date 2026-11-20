'use strict';
// =====================================================================
//  НАСТРОЙКИ ИГРЫ (гаечка в левом верхнем углу)
//
//  Клик по гаечке ставит игру на паузу и открывает окно настроек. Выбор сразу
//  запоминается в браузере (localStorage, SETTINGS_KEY) и действует в следующих играх.
//  Если со стиком что-то поменяли - после «Продолжить» заново проходим настройку
//  контроллера (setup.js): жесты могли поменяться (например, кнопка вместо двойного тапа).
//
//  Новая настройка = строка в SETTINGS_ITEMS (+ значение по умолчанию в SETTINGS_DEFAULTS
//  и тексты в i18n.js), окно нарисуется само. Читать в игре: settings.<key>.
//
//  Сейчас одна настройка:
//    aimInput - чем выбирать место и дальность заброса (и прикормки):
//      'tap'    - двойной тап по корпусу (как было);
//      'button' - кнопка: A на StickS3 / StickC Plus2, любая клавиша или G0 на Cardputer
//                 (событие BUTTON, id 12 - нужна свежая прошивка контроллера).
// =====================================================================

const SETTINGS_KEY = 'fishing.settings';
const SETTINGS_DEFAULTS = { aimInput: 'tap' };

// Что показывать в окне: заголовок пункта и варианты (value - что сохраняется)
const SETTINGS_ITEMS = [
  { key: 'aimInput', title: 'settings_aim', note: 'settings_aim_note', options: [
    { value: 'tap',    label: 'settings_aim_tap' },
    { value: 'button', label: 'settings_aim_btn', sub: 'settings_aim_btn_sub' },
  ] },
];

const settings = Object.assign({}, SETTINGS_DEFAULTS, (() => {
  try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; } catch (e) { return {}; }
})());

function saveSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) { /* приватный режим - не беда */ }
}

// Выбирают место кнопкой? С клавиатуры работают и пробел, и A - кому как удобнее
function aimByButton() { return inputMode === 'ble' && settings.aimInput === 'button'; }

// Это событие - «выбрать место / дальность»? (states.js: aimX, aimY, baitAimX, baitAimY)
function isAimPick(id) {
  if (inputMode === 'keyboard') return id === EV.TAP2 || id === EV.BTN;
  return id === (settings.aimInput === 'button' ? EV.BTN : EV.TAP2);
}

// Подсказка прицела: про кнопку или про двойной тап
function aimHint(key) { return T(aimByButton() ? key + '_btn' : key); }

// ---------- Окно настроек ----------
let settingsOpen = false;
let settingsChanged = false;     // в этот раз что-то поменяли - нужна новая калибровка
let pausedBeforeSettings = false;
const gearBtn = document.getElementById('gear');

function openSettings() {
  if (settingsOpen) return;
  settingsOpen = true;
  settingsChanged = false;
  pausedBeforeSettings = paused;
  paused = true;
  renderSettings();
}

function closeSettings() {
  if (!settingsOpen) return;
  settingsOpen = false;
  // Поменяли настройку со стиком - калибровка заново, игра стоит, пока её не пройдут
  if (settingsChanged && inputMode === 'ble' && !pausedBeforeSettings) {
    startSetup(() => { hideOverlay(); paused = false; });
    return;
  }
  paused = pausedBeforeSettings;
  hideOverlay();
}

function renderSettings() {
  showOverlay(T('settings_title'), '', []);
  for (const item of SETTINGS_ITEMS) {
    const head = document.createElement('div');
    head.className = 'setting-title';
    head.textContent = T(item.title);
    overlayButtons.appendChild(head);
    for (const o of item.options) {
      const el = document.createElement('button');
      el.textContent = T(o.label);
      if (o.sub) {
        const small = document.createElement('small');
        small.textContent = T(o.sub);
        el.appendChild(small);
      }
      el.classList.add('secondary');
      if (settings[item.key] === o.value) el.classList.add('selected');
      el.addEventListener('click', () => {
        if (settings[item.key] !== o.value) settingsChanged = true;
        settings[item.key] = o.value;
        saveSettings();
        renderSettings();
      });
      overlayButtons.appendChild(el);
    }
    if (item.note) {
      const note = document.createElement('p');
      note.className = 'setting-note';
      note.textContent = T(item.note);
      overlayButtons.appendChild(note);
    }
  }
  const ok = document.createElement('button');
  ok.textContent = T(settingsChanged && inputMode === 'ble' ? 'btn_resume_setup' : 'btn_resume');
  ok.addEventListener('click', closeSettings);
  overlayButtons.appendChild(ok);
}

gearBtn.title = 'Settings';
gearBtn.addEventListener('click', (e) => { e.currentTarget.blur(); openSettings(); });
addEventListener('keydown', (e) => { if (e.code === 'Escape' && settingsOpen) closeSettings(); });

// Гаечку видно, когда идёт игра и не открыто никакое окно (меню, пауза, настройка контроллера)
function updateGear() {
  const show = game.state !== 'wait' && overlay.classList.contains('hidden');
  gearBtn.style.display = show ? '' : 'none';
  gearBtn.title = T('settings_title');
}
