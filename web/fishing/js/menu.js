'use strict';
// =====================================================================
//  СТАРТОВЫЙ ЭКРАН (окно поверх игры)
//
//  Шаги: язык -> сложность -> подключение контроллера -> настройка жестов (setup.js,
//  только в первый раз для этого контроллера или по кнопке «Подключить и настроить»).
//  Каждый шаг - функция show...Menu(), которая рисует заголовок, текст и кнопки.
//  Тот же окошко используется для паузы, когда стик отключился (controller.js).
// =====================================================================

const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlayTitle');
const overlayText = document.getElementById('overlayText');
const overlayButtons = document.getElementById('overlayButtons');
const overlayStatus = document.getElementById('overlayStatus');

// Показать окно. buttons - список { label, sub, onClick, secondary, selected }
//   label - надпись, sub - мелкая вторая строка, secondary - серая кнопка,
//   selected - подсветить (выбрано в прошлый раз)
function showOverlay(title, textStr, buttons = [], status = '', isErr = false) {
  overlayTitle.textContent = title;
  overlayText.textContent = textStr;
  overlayText.style.display = textStr ? '' : 'none';
  overlayButtons.innerHTML = '';
  for (const b of buttons) {
    const el = document.createElement('button');
    el.textContent = b.label;
    if (b.sub) {
      const small = document.createElement('small');
      small.textContent = b.sub;
      el.appendChild(small);
    }
    if (b.lang) el.lang = b.lang;                 // кнопка на другом языке (выбор языка)
    if (b.secondary) el.classList.add('secondary');
    if (b.selected) el.classList.add('selected');
    el.addEventListener('click', b.onClick);
    overlayButtons.appendChild(el);
  }
  setStatus(status, isErr);
  // Ролик, полоска и номер шага бывают только в настройке контроллера - она включит их сама
  delete overlayTitle.dataset.step;
  document.getElementById('overlayVideo').style.display = 'none';
  document.getElementById('overlayBar').style.display = 'none';
  overlay.classList.remove('hidden');
}
function hideOverlay() { overlay.classList.add('hidden'); }

function setStatus(msg, isErr = false) {
  overlayStatus.textContent = msg;
  overlayStatus.className = isErr ? 'err' : '';
}

// Заблокировать кнопки, пока идёт подключение
function setButtonsDisabled(disabled) {
  for (const el of overlayButtons.querySelectorAll('button')) el.disabled = disabled;
}

// ---------- Шаг 1: язык ----------
function showLanguageMenu() {
  showOverlay(T('title'), T('choose_language'), LANGUAGES.map(l => ({
    label: l.name,
    lang: l.id,
    selected: l.id === lang,
    onClick: () => { setLanguage(l.id); showFirmwareMenu(); },
  })));
}

// ---------- Шаг 1.5: свежая прошивка контроллера ----------
// Новые функции игры (например, кнопка вместо двойного тапа) работают только со свежей прошивкой.
// Ссылки - веб-прошивальщик M5Burner (те же, что в README): открываются в новой вкладке
const FIRMWARE_LINKS = [
  { name: 'StickS3',        url: 'https://burner.m5stack.com/M6MGHS' },
  { name: 'StickC Plus2',   url: 'https://burner.m5stack.com/QKD7CU' },
  { name: 'Cardputer ADV',  url: 'https://burner.m5stack.com/MC6SGT' },
];

function showFirmwareMenu() {
  const buttons = FIRMWARE_LINKS.map(f => ({
    label: T('btn_flash', { name: f.name }),
    sub: 'M5Burner',
    secondary: true,
    onClick: () => window.open(f.url, '_blank', 'noopener'),
  }));
  buttons.push({ label: T('btn_firmware_ok'), onClick: showDifficultyMenu });
  buttons.push({ label: T('btn_back'), secondary: true, onClick: showLanguageMenu });
  showOverlay(T('firmware_title'), T('firmware_text'), buttons);
}

// ---------- Шаг 2: сложность ----------
function showDifficultyMenu() {
  const buttons = DIFFICULTIES.map(d => ({
    label: T(d.name),
    sub: T('hook_window', { s: d.hookWindow }),
    selected: d === game.difficulty,
    onClick: () => {
      game.difficulty = d;
      try { localStorage.setItem('fishing.difficulty', d.id); } catch (_) {}
      showConnectMenu();
    },
  }));
  buttons.push({ label: T('btn_back'), secondary: true, onClick: showFirmwareMenu });
  showOverlay(T('choose_difficulty'), T('goal_text', { kg: FISH.goalKg }), buttons);
}

// ---------- Шаг 3: подключение ----------
function showConnectMenu() {
  showOverlay(T(game.difficulty.name), T('connect_text'), [
    { label: T('btn_connect'), onClick: () => { forceSetup = false; connectBle(); } },
    { label: T('btn_connect_setup'), sub: T('btn_connect_setup_sub'), secondary: true,
      onClick: () => { forceSetup = true; connectBle(); } },
    { label: T('btn_keyboard'), secondary: true, onClick: startKeyboard },
    { label: T('btn_back'), secondary: true, onClick: showDifficultyMenu },
  ]);
}

// Сложность, выбранная в прошлый раз
try {
  const saved = DIFFICULTIES.find(d => d.id === localStorage.getItem('fishing.difficulty'));
  if (saved) game.difficulty = saved;
} catch (_) {}

setLanguage(lang);
showLanguageMenu();
