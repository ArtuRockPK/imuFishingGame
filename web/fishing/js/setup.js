'use strict';
// =====================================================================
//  НАСТРОЙКА КОНТРОЛЛЕРА (окно после подключения, перед первой игрой)
//
//  По очереди показывает ролик с жестом и ждёт, пока игрок его сделает.
//  Заодно запоминает, какой знак вращения у стика значит «по часовой стрелке», а какой -
//  «против»: знак зависит от того, как держат контроллер, поэтому заранее его не узнать.
//  Пока идёт ролик «по часовой», игрок крутит так же - это направление и запоминается.
//
//  Результат хранится в браузере отдельно для каждого контроллера (по имени в Bluetooth).
//  Пройти заново: кнопка «Подключить и настроить» на экране подключения. Ещё настройка
//  запускается сама, когда игрок поменял что-то в настройках игры (гаечка, settings.js).
//  Если место заброса выбирают кнопкой - шаг «двойной тап» заменяется шагом «нажми кнопку».
//
//  Ролики - media/gestures/<clip>.mp4. Для Cardputer ADV свои ролики кладутся
//  в media/gestures/cardputer/ с теми же именами; если их нет - показываются обычные.
// =====================================================================

const SETUP_STEPS = [
  { id: 'hold',      clip: 'hold' },                         // только показать, дальше - кнопкой
  { id: 'doubletap', clip: 'doubletap', ev: EV.TAP2 },
  { id: 'jerk',      clip: 'jerk',      ev: EV.HIGH_G },
  { id: 'drop',      clip: 'drop',      ev: EV.LOW_G },
  { id: 'laydown',   clip: 'laydown',   ev: EV.NO_MOT },     // или FLAT ON - что придёт раньше
  { id: 'reel_cw',   clip: 'reel_cw',   reel: true },        // запоминаем, как выглядит «по часовой»
  { id: 'reel_ccw',  clip: 'reel_ccw',  reel: true },        // и «против часовой» (должно отличаться)
];
// Шаг «нажми кнопку» вместо двойного тапа (настройка aimInput = 'button'). Ролика у него нет
const SETUP_BUTTON_STEP = { id: 'button', ev: EV.BTN };

// Шаги этой настройки с учётом настроек игры
function setupSteps() {
  return SETUP_STEPS.map(st => st.id === 'doubletap' && settings.aimInput === 'button' ? SETUP_BUTTON_STEP : st);
}

const SETUP_REEL_NEED = 45;     // пакетов REEL с известным направлением (~4.5 с вращения - чтобы игрок точно понял)
const SETUP_REEL_PURE = 0.7;    // столько из них должны показать одно и то же направление
const SETUP_REEL_GIVEUP = 50;   // столько пакетов вращения почти без направления - прошивка не умеет
const SETUP_NEXT_DELAY = 900;   // мс между «Есть!» и следующим шагом

let setup = null;               // идёт настройка: { steps, i, onFinish, got, votes, known, moving, cw, ccw, unsupported }
let controllerSetup = null;     // сохранённая настройка подключённого контроллера: { cw, ccw } или null

const overlayVideo = document.getElementById('overlayVideo');
const overlayBar = document.getElementById('overlayBar');

function setupKey() { return 'fishing.setup.' + ((device && device.name) || 'stick'); }

// Загрузить настройку этого контроллера. null - ещё не настраивали
function loadSetup() {
  try { controllerSetup = JSON.parse(localStorage.getItem(setupKey())); } catch (_) { controllerSetup = null; }
  return controllerSetup;
}

function saveSetup() {
  controllerSetup = { cw: setup.cw, ccw: setup.ccw };
  try { localStorage.setItem(setupKey(), JSON.stringify(controllerSetup)); } catch (_) {}
}

// Направление катушки по байту 3 пакета REEL: 1 - по часовой, -1 - против часовой,
// 0 - непонятно или не настроено (старая настройка без cw тоже даёт 0).
// Ключ направления = ось + знак (биты 0-1 и 7); каким способом стик его понял - не важно
function reelDirection(aux) {
  if (!(aux & 0x40) || !controllerSetup || controllerSetup.cw == null) return 0;
  const k = aux & 0x83;
  if (k === controllerSetup.cw) return 1;
  if (k === controllerSetup.ccw || k === (controllerSetup.cw ^ 0x80)) return -1;
  return 0;
}

function setupActive() { return !!setup; }

// Начать настройку; onFinish вызывается, когда игрок закончил или пропустил её
function startSetup(onFinish) {
  setup = { steps: setupSteps(), i: 0, onFinish, cw: null, ccw: null, unsupported: false };
  showSetupStep();
}

function clipUrl(clip) {
  const cardputer = device && /cardputer/i.test(device.name || '');
  return 'media/gestures/' + (cardputer ? 'cardputer/' : '') + clip + '.mp4';
}

function showClip(clip) {
  if (!clip) { overlayVideo.style.display = 'none'; overlayVideo.removeAttribute('src'); return; }
  const url = clipUrl(clip);
  overlayVideo.onerror = url.includes('/cardputer/')
    ? () => { overlayVideo.onerror = null; overlayVideo.src = 'media/gestures/' + clip + '.mp4'; }
    : null;
  overlayVideo.src = url;
  overlayVideo.style.display = '';
  overlayVideo.play().catch(() => {});
}

function setBar(p) {
  overlayBar.style.display = p == null ? 'none' : '';
  if (p != null) overlayBar.firstElementChild.style.width = Math.round(Math.min(1, p) * 100) + '%';
}

function showSetupStep() {
  const st = setup.steps[setup.i];
  Object.assign(setup, { got: false, votes: {}, known: 0, moving: 0 });
  const buttons = st.ev === undefined && !st.reel
    ? [{ label: T('btn_next'), onClick: nextSetupStep }]
    : [{ label: T('btn_skip'), secondary: true, onClick: nextSetupStep }];
  buttons.push({ label: T('btn_skip_setup'), secondary: true, onClick: finishSetup });
  // Сразу под роликом «как держать» - подпись, что это лишь один из способов
  const text = (st.id === 'hold' ? T('setup_hold_note') + '\n\n' : '') + T('setup_' + st.id + '_text');
  showOverlay(T('setup_' + st.id), text, buttons, st.ev === undefined && !st.reel ? '' : T('setup_waiting'));
  overlayTitle.dataset.step = T('setup_step', { n: setup.i + 1, m: setup.steps.length });
  showClip(st.clip);
  setBar(st.reel ? 0 : null);
  setReel(!!st.reel);
}

function nextSetupStep() {
  if (!setup) return;
  setup.i++;
  // Прошивка без направления катушки - шаги с катушкой пропускаем
  while (setup.i < setup.steps.length && setup.steps[setup.i].reel && setup.unsupported) setup.i++;
  if (setup.i >= setup.steps.length) showSetupDone();
  else showSetupStep();
}

// Жест пойман: галочка, звук и через мгновение следующий шаг
function setupGot() {
  setup.got = true;
  sfx.lock();
  setStatus('✓ ' + T('setup_got'));
  overlayStatus.className = 'ok';   // крупно и зелёным (style.css)
  const i = setup.i;
  setTimeout(() => { if (setup && setup.i === i && setup.got) nextSetupStep(); }, SETUP_NEXT_DELAY);
}

function showSetupDone() {
  setReel(false);
  saveSetup();
  showOverlay(T('setup_done'), T('setup_done_text') + (setup.unsupported ? ' ' + T('setup_reel_unsupported') : ''),
              [{ label: T('btn_play'), onClick: finishSetup }]);
  delete overlayTitle.dataset.step;
  overlayVideo.style.display = 'none';
  setBar(null);
  sfx.ready();
}

function finishSetup() {
  if (!setup) return;
  const done = setup.onFinish;
  if (setup.i < setup.steps.length) saveSetup();   // пропустили - всё равно не спрашиваем каждый раз
  setReel(false);
  setup = null;
  delete overlayTitle.dataset.step;
  overlayVideo.style.display = 'none';
  overlayVideo.removeAttribute('src');
  setBar(null);
  done();
}

// Контроллер отключился посреди настройки - бросаем её, после переподключения начнём заново
function cancelSetup() {
  if (!setup) return;
  setup = null;
  delete overlayTitle.dataset.step;
  overlayVideo.style.display = 'none';
  setBar(null);
}

// Событие от стика, пока идёт настройка (в игру оно не попадает)
function setupEvent(id, code, aux) {
  const st = setup.steps[setup.i];
  if (setup.got) return;
  if (st.ev !== undefined) {
    if (id === st.ev || (st.id === 'laydown' && id === EV.FLAT && code === 1)) setupGot();
    return;
  }
  if (!st.reel || id !== EV.REEL || code === 0) return;

  setup.moving++;
  if (aux & 0x40) {
    const k = aux & 0x83;
    setup.votes[k] = (setup.votes[k] || 0) + 1;
    setup.known++;
  }
  setBar(setup.known / SETUP_REEL_NEED);

  if (setup.known < 3 && setup.moving >= SETUP_REEL_GIVEUP) {   // старая прошивка: направления нет
    setup.unsupported = true;
    setup.cw = setup.ccw = null;
    setStatus(T('setup_reel_unsupported'), true);
    setup.got = true;
    const i = setup.i;
    setTimeout(() => { if (setup && setup.i === i) nextSetupStep(); }, 2500);
    return;
  }
  if (setup.known < SETUP_REEL_NEED) {
    setStatus(T('setup_reel_progress', { p: Math.round(100 * setup.known / SETUP_REEL_NEED) }));
    return;
  }

  // Набрали достаточно: какое направление было чаще всего и насколько уверенно
  let best = null;
  for (const k in setup.votes) if (best === null || setup.votes[k] > setup.votes[best]) best = k;
  const pure = setup.votes[best] / setup.known;
  best = Number(best);
  Object.assign(setup, { votes: {}, known: 0, moving: 0 });
  if (pure < SETUP_REEL_PURE) { setStatus(T('setup_reel_unstable'), true); setBar(0); return; }

  if (st.id === 'reel_cw') {
    setup.cw = best;                  // это и есть «по часовой» для этого контроллера и хвата
  } else if (best === setup.cw) {     // «против» вышло то же, что «по» - крутят не в ту сторону
    setStatus(T('setup_reel_same'), true);
    setBar(0);
    return;
  } else {
    setup.ccw = best;
  }
  setBar(1);
  setupGot();
}
