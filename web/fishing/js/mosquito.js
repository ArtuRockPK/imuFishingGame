'use strict';
// =====================================================================
//  КОМАР (мини-игра после улова)
//
//  После ведра с каждой MOSQUITO.every-й рыбой слышен писк, и открывается сцена:
//  по центру предплечье и ладонь, большой комар мечется из стороны в сторону,
//  отскакивая от краёв экрана (скорость - mosquitoSpeed уровня сложности, config.js).
//  HIGH-G, когда комар над ладонью, - сверху опускается вторая рука и прихлопывает его.
//  Пойманный комар идёт на прикормку (как хлеб из пакета, bait.js).
//  Попытка одна: промахнулся (или не хлопнул за MOSQUITO.time секунд) - комар
//  хихикает и улетает за край экрана.
//  Состояние 'mosquito' - в states.js, писк комара - buzz...() в sound.js.
// =====================================================================

const HAND = { cx: 160, cy: 112 };    // центр ладони на экране

const MOSQ_MARGIN = 20;      // как близко к краю экрана подлетает комар (центр спрайта)

const mosq = {
  x: 0, y: 0, baseY: 0,      // где комар
  dir: -1,                   // куда летит: -1 влево, 1 вправо
  flyT: 0,                   // сколько секунд уже летает
  wait: 0,                   // пауза перед появлением, с
  slapT: -10,                // когда хлопнули (для анимации руки)
  hit: false, hitT: 0,       // прихлопнули / когда
  leaving: false, leaveT: 0, // улетает (промах или надоело) / когда начал
};

function startMosquito() {
  Object.assign(mosq, { dir: -1, flyT: 0, wait: MOSQUITO.introTime, slapT: -10, hit: false, leaving: false });
  mosq.x = W - MOSQ_MARGIN;              // появляется у правого края и летит влево
  newMosquitoHeight();
  buzzStart();
}

// Новая высота полёта (около ладони) - после каждого отскока от края
function newMosquitoHeight() {
  mosq.baseY = rand(HAND.cy - 34, HAND.cy - 10);
}

function updateMosquito(dt, t) {
  if (mosq.hit) {
    if (t - mosq.hitT >= 1.6) finishMosquito(true);
    return;
  }
  if (mosq.wait > 0) {
    mosq.wait -= dt;
    // Перед сценой писк нарастает
    buzzSet(0.3 + 0.7 * Math.min(1, t / MOSQUITO.introTime), 0.8);
    return;
  }
  mosq.x += mosq.dir * game.difficulty.mosquitoSpeed * dt;
  if (mosq.leaving) {
    // Улетает вверх и в сторону, уже не отскакивая от краёв
    mosq.baseY -= 90 * dt;
    if (t - mosq.leaveT >= 1.2) finishMosquito(false);
  } else {
    // Летит из стороны в сторону и отскакивает от краёв экрана
    mosq.flyT += dt;
    if (mosq.x < MOSQ_MARGIN)     { mosq.x = MOSQ_MARGIN;     mosq.dir = 1;  newMosquitoHeight(); }
    if (mosq.x > W - MOSQ_MARGIN) { mosq.x = W - MOSQ_MARGIN; mosq.dir = -1; newMosquitoHeight(); }
    if (mosq.flyT >= MOSQUITO.time) mosquitoLeaves(t);    // надоело ждать - улетает
  }
  mosq.y = mosq.baseY + Math.sin(t * 11) * 5 + Math.sin(t * 3.7) * 4;   // петляет
  // Чем ближе к середине, тем громче; звук едет туда же, куда комар
  buzzSet(1 - Math.min(1, Math.abs(mosq.x - HAND.cx) / W) * 0.6, Math.max(0, Math.min(1, mosq.x / W)));
}

// Комар хихикает и улетает: попытка потрачена
function mosquitoLeaves(t) {
  mosq.leaving = true;
  mosq.leaveT = t;
  sfx.laugh();
  say(T('msg_mosquito_gone'));
}

// HIGH-G: хлопок второй рукой. Попал, если комар сейчас над ладонью
function slapMosquito() {
  const t = game.stateTime;
  if (mosq.hit || mosq.leaving || t < MOSQUITO.introTime) return;   // попытка только одна
  mosq.slapT = t;
  if (mosq.wait <= 0 && Math.abs(mosq.x - HAND.cx) <= MOSQUITO.hitX) {
    mosq.hit = true;
    mosq.hitT = t;
    buzzStop();
    sfx.splat();
    say(T('msg_swatted'), C.good, 12);
  } else {
    sfx.slap();
    mosquitoLeaves(t);
  }
}

// Конец мини-игры: прихлопнул - комар идёт на прикормку, иначе просто дальше
function finishMosquito(ok) {
  if (ok) {
    game.baitPending = true;
    game.baitKind = 'mosquito';
    say(T('msg_mosquito_bait'), C.good, 12);
  }
  finishCast();
}

// ---------- Рисование ----------
const SKIN = { fill: '#fcbc8c', shade: '#e4986c', outline: '#7c3c1c', nail: '#fce0d0' };

// Части руки (ладонь вниз, пальцы вверх): прямоугольники x, y, w, h для нижней руки
const HAND_PARTS = [
  [146, 128, 28, 52],          // предплечье
  [136, 92, 48, 40],           // ладонь
  [140, 68, 9, 26],            // указательный
  [150, 63, 9, 31],            // средний
  [160, 66, 9, 28],            // безымянный
  [170, 73, 8, 21],            // мизинец
  [124, 104, 14, 11],          // большой палец: основание
  [118, 96, 10, 12],           // большой палец: кончик
];
const SLEEVE = [142, 158, 36, 22];   // манжета рукава

// Нарисовать руку. mirror - отразить по горизонтали вокруг центра ладони
// (другая рука: большой палец с другой стороны), dx, dy - сдвиг,
// palmUp - ладонью вверх (без ногтей, с линиями на ладони; так её рисует мини-игра с ведром)
function drawHand(mirror, dx, dy, palmUp = false) {
  const at = ([x, y, w, h]) => [(mirror ? 2 * HAND.cx - x - w : x) + dx, y + dy, w, h];
  // Сначала все контуры, потом заливка - части сливаются в одну руку
  for (const p of HAND_PARTS) { const [x, y, w, h] = at(p); rect(x - 1, y - 1, w + 2, h + 2, SKIN.outline); }
  for (const p of HAND_PARTS) { const [x, y, w, h] = at(p); rect(x, y, w, h, SKIN.fill); }
  // Пальцы: тень у основания и ногти на кончиках (у ладони вверх ногтей не видно)
  for (const p of HAND_PARTS.slice(2, 6)) {
    const [x, y, w, h] = at(p);
    if (!palmUp) rect(x + 2, y + 2, w - 4, 4, SKIN.nail);
    rect(x + 1, y + h - 3, w - 2, 3, SKIN.shade);
  }
  // Линии на ладони
  if (palmUp) {
    const [px0, py0] = at(HAND_PARTS[1]);
    rect(px0 + 6, py0 + 12, 30, 1, SKIN.shade);
    rect(px0 + 10, py0 + 22, 28, 1, SKIN.shade);
  }
  // Рукав (тянется до низа экрана, даже если рука поднята)
  const [sx, sy, sw, sh] = at(SLEEVE);
  const sleeveH = Math.max(sh, H - sy);
  rect(sx - 1, sy - 1, sw + 2, sleeveH + 2, '#7c1000');
  rect(sx, sy, sw, sleeveH, '#d82800');
}

function drawMosquitoScene(t, st) {
  // Размытый фон: небо, лес, вода
  rect(0, 0, W, 50, C.sky2);
  rect(0, 50, W, 30, C.hillDark);
  for (let i = 0; i < 12; i++) rect(i * 28 + 6, 44 + (i % 3) * 3, 18, 10, C.hill);
  rect(0, 80, W, H - 80, C.water1);
  for (let i = 0; i < 10; i++) rect((i * 37 + Math.floor(t * 8)) % W, 96 + (i % 4) * 20, 12, 1, C.water3);

  drawHand(false, 0, 0);

  // Комар: живой машет крыльями, прихлопнутый лежит на ладони
  if (mosq.hit) {
    sprite(MOSQUITO_DEAD, MOSQUITO_PAL, HAND.cx - 10, HAND.cy - 16, MOSQUITO_DEAD.length, false, 2);
  } else if (mosq.wait <= 0) {
    // Спрайт смотрит влево; летит вправо - отражаем
    const frame = Math.floor(t * 30) % 2 ? MOSQUITO_A : MOSQUITO_B;
    sprite(frame, MOSQUITO_PAL, mosq.x - 18, mosq.y - 12, frame.length, mosq.dir > 0, 2);
  }

  // Вторая рука (другая, отражённая) выскакивает снизу и накрывает ладонь за 0.1 с,
  // при попадании держится дольше, потом уезжает обратно вниз
  const k = st - mosq.slapT;
  const hold = mosq.hit ? 0.6 : 0.15;
  let off = null;
  if (k < 0.1) off = 150 * (1 - k / 0.1);
  else if (k < 0.1 + hold) off = 0;
  else if (k < 0.25 + hold) off = 150 * (k - 0.1 - hold) / 0.15;
  if (off !== null) drawHand(true, -4, off - 6);
}
