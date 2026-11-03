'use strict';
// =====================================================================
//  ИГРА: общие данные и переходы между состояниями
//
//  Игра всегда находится в одном СОСТОЯНИИ (game.state). Что делает каждое
//  состояние - описано в states.js. Здесь - то, что нужно всем состояниям.
//
//  Ход игры:
//   aimX -> aimY -> ready -> casting -> waiting -> bite -> fight -> caught -> photo -> aimX
//                                         |         |       |
//                                         |         +-------+-> reeling -> aimX  (рыба сорвалась)
//                                         +-> reeling  (двойной тап до поклёвки)
//   Каждая сорвавшаяся рыба уносит червячка (game.worms). Кончились - gameover -> новая игра.
// =====================================================================

const game = {
  state: 'wait',          // текущее состояние ('wait' - ждём подключения контроллера)
  stateTime: 0,           // сколько секунд прошло в текущем состоянии
  markerX: AIM.xMin, markerY: AIM.rowY,   // где маркер прицела
  targetX: 0, targetY: 0,                 // куда летит поплавок
  floatX: 0, floatY: 0,                   // где поплавок сейчас
  castFrom: null, castDur: 1,             // откуда и сколько секунд летит поплавок
  castInZone: false,                      // попали ли в рыбную зону
  castInBait: false, baitPending: false,  // попали ли в прикормку / надо бросить прикормку
  baitKind: 'bread',                      // чем прикармливаем: 'bread' (из пакета) или 'mosquito'
  baitFromX: 0, baitFromY: 0,             // откуда летит хлеб-прикормка
  biteAt: 0, waited: 0,                   // когда клюнет / сколько уже ждали (в покое идёт быстрее)
  diving: false,                          // поплавок уходит под воду (за FISH.diveTime до поклёвки)
  hookType: 'turn',                       // 'turn' - подсечка поворотом (ORIENT), 'jerk' - рывком (HIGH-G)
  turns: 0, lastTurn: 0,                  // вываживание: сколько оборотов катушки и когда крутили последний раз
  fightTurns: 0,                          // сколько оборотов нужно для этой рыбы (rollFish)
  reelSpeed: 0, reelAt: 0,                // скорость катушки, об/с, и когда она пришла со стика
  tension: false,                         // натяжение лески (красный): сейчас нельзя крутить быстро
  tensionPhase: 'calm',                   // 'calm' - зелёный, 'warn' - краснеет, 'tension' - красный, 'relax' - зеленеет
  tensionLevel: 0,                        // 0 - зелёный, 1 - красный (для индикатора)
  tensionStart: 0, tensionNext: 0,        // когда натяжение началось / когда сменится фаза
  tensionShortGap: false,                 // прошлая пауза между натяжениями была короткой
  difficulty: DIFFICULTIES[1],            // уровень сложности (выбирается на стартовом экране)
  fish: null, fishWeight: 0, rarity: null,   // пойманная рыба: вид, вес (кг), редкость
  bucketFish: [],                         // рыбы в ведре (мини-игра bucket.js), для рисования
  campfirePending: false,                 // наступила ночь - после этой попытки разводим костёр (campfire.js)
  campfireLit: false, campfireOutAt: -100,  // костёр у рыбака горит / когда погас (дымок)
  caughtCount: 0, totalWeight: 0,         // сколько рыб поймано и их общий вес (кг)
  hooked: null,                           // предмет на крючке (floaters.js), пока сматываем
  worms: FISH.worms, wormLostTime: -10,   // сколько червячков осталось / когда пропал последний
  message: '', messageColor: C.text, messageSize: 8, messageTime: -10,   // сообщение по центру
  lastEvent: '', lastEventTime: -10,      // последнее событие стика (в углу экрана)
};
let showDebug = false;   // отладка: сетка, рыбная зона, таймеры (клавиша G)

// Перейти в другое состояние
function setState(s) {
  const prev = STATES[game.state];
  if (prev && prev.exit) prev.exit();       // уходим из состояния (например, выключить катушку)
  game.state = s;
  game.stateTime = 0;
  stance = (s === 'bite' || s === 'fight');
  if (!stance) rodBend = 0;
  if (s !== 'waiting') sitting = false;
  if (STATES[s] && STATES[s].enter) STATES[s].enter();
}

// Вываживание: подмотали n оборотов. Каждую четверть оборота щёлкает катушка
function addTurns(n) {
  const before = Math.floor(game.turns * 4);
  game.turns += n;
  game.lastTurn = game.stateTime;
  if (Math.floor(game.turns * 4) !== before) {
    sfx.crank();
    addRipple(game.floatX, game.floatY + 1, 1);
  }
}

// Показать сообщение по центру экрана на 2 секунды
function say(msg, color = C.text, size = 8) {
  game.message = msg;
  game.messageColor = color;
  game.messageSize = size;
  game.messageTime = now;
}

// Начать игру (после подключения контроллера)
function startGame() {
  rodAngle = ROD_ANGLE.idle;
  startAmbience();                            // звуки природы (ambience.js)
  if (!fishZone) newFishZone();
  setState('aimX');
}

// Новая игра после проигрыша или победы: всё с начала
function restartGame() {
  game.worms = FISH.worms;
  game.caughtCount = 0;
  game.totalWeight = 0;
  game.bucketFish = [];
  game.campfirePending = false;
  game.campfireLit = false;
  floater = null;
  floaterTimer = 0;
  baitSpot = null;
  game.baitPending = false;
  newFishZone();
  setState('aimX');
}

// Рыбу упустили (не подсёк или не вывел) - рыба уносит червячка
function loseFish(reason) {
  if (game.castInZone) takeFishFromZone();   // штраф: зона истощается быстрее
  loseWorm(reason);
}

// Червячок потерян: минус жизнь, сообщение, сматываем леску
function loseWorm(reason) {
  game.worms = Math.max(0, game.worms - 1);
  game.wormLostTime = now;
  say(reason, C.bad);
  sfx.lost();
  setState('reeling');
}

// Рыба на крючке: случайная редкость -> вес в её пределах -> подходящий вид.
// Выбирается сразу при подсечке: от редкости и веса зависит, сколько крутить (turns в RARITIES).
// На прикормке редкость почти всегда элитная или эпическая (bait.js)
function rollFish() {
  let rarity = game.castInBait ? baitRarity() : null;
  if (!rarity) {
    let r = Math.random();
    rarity = RARITIES[0];
    for (const rr of RARITIES) {
      if (r < rr.chance) { rarity = rr; break; }
      r -= rr.chance;
    }
  }
  const kinds = FISH_TYPES.filter(f => f.rarity.includes(rarity.id));
  game.rarity = rarity;
  game.fishWeight = rand(rarity.min, rarity.max);
  game.fish = kinds.length ? kinds[randInt(0, kinds.length - 1)] : FISH_TYPES[0];
  // Обороты: чем тяжелее рыба в пределах своей редкости, тем больше
  const k = (game.fishWeight - rarity.min) / (rarity.max - rarity.min);
  game.fightTurns = Math.round(rarity.turns[0] + (rarity.turns[1] - rarity.turns[0]) * k);
}

// Рыба в ведре (bucket.js): идёт в зачёт
function landFish() {
  game.caughtCount++;
  game.totalWeight += game.fishWeight;
}

// Попытка закончена: если в зоне не осталось рыбы - она переезжает в другое место.
// Набрали цель - победа; червячков не осталось - проигрыш; иначе снова прицеливаемся.
function finishCast() {
  game.hooked = null;
  game.castInBait = false;
  if (fishZone.fish <= 0) newFishZone();
  if (game.totalWeight >= FISH.goalKg) setState('win');
  else if (game.worms <= 0) setState('gameover');
  else if (game.campfirePending) { game.campfirePending = false; setState('campfire'); }   // ночной костёр
  else if (game.baitPending) { game.baitPending = false; setState('baitAimX'); }   // бросить прикормку
  else setState('aimX');
}

// После фото улова - всегда мини-игра с ведром (bucket.js)
function afterPhoto() {
  setState('bucket');
}

// После ведра: если рыба в ведре и она каждая MOSQUITO.every-я - прилетает комар (mosquito.js),
// иначе следующая попытка. Если цель уже набрана или прикормка ждёт броска - комара не будет.
function afterBucket(ok) {
  if (ok && game.totalWeight < FISH.goalKg && !game.baitPending && game.caughtCount % MOSQUITO.every === 0) {
    setState('mosquito');
  } else {
    finishCast();
  }
}

// Сколько поплавок уже ушёл под воду: 0 - на поверхности, 1 - скрылся.
// Ныряет за FISH.diveTime настоящих секунд до поклёвки (сидя ожидание идёт быстрее - учитываем)
function floatDive() {
  if (game.state === 'bite') return 1;
  if (game.state !== 'waiting') return 0;
  const left = (game.biteAt - game.waited) / (sitting ? FISH.restingSpeedup : 1);
  return Math.max(0, Math.min(1, 1 - left / FISH.diveTime));
}

// Пришло событие от стика (или клавиатуры) - id из EV, code - подробность
function onControllerEvent(id, code = 0) {
  game.lastEvent = EV_NAMES[id] || ('#' + id);
  if (id === EV.FLAT) game.lastEvent += code ? ' ON' : ' OFF';
  game.lastEventTime = now;

  updateStickState(id, code);                 // stick.js - работает в любом состоянии

  const st = STATES[game.state];
  if (st && st.onEvent) st.onEvent(id, code); // states.js - реакция текущего состояния
}

// Вызывается каждый кадр (~60 раз в секунду). dt - сколько секунд прошло с прошлого кадра
function update(dt) {
  game.stateTime += dt;
  updateDaytime(dt);        // часы, рыба плещется (daytime.js)
  if (game.state !== 'gameover' && game.state !== 'win') {
    updateFloaters(dt);     // плавающие предметы
    updateBait(dt);         // таймер прикормки
  }
  const st = STATES[game.state];
  if (st && st.update) st.update(dt, game.stateTime);
}

// Подсказка вверху экрана для текущего состояния
function hintFor(s) {
  const st = STATES[s];
  if (!st || !st.hint) return '';
  return typeof st.hint === 'function' ? st.hint() : st.hint;
}
