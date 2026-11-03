'use strict';
// =====================================================================
//  РЫБАК, УДОЧКА, ПОПЛАВОК, РЫБА
// =====================================================================

const FISHER_X = ISLAND.cx - 6;            // левый верхний угол спрайта рыбака
const FISHER_Y = ISLAND.cy - 23;
const HAND_IDLE   = { x: FISHER_X + 11, y: FISHER_Y + 9 };   // где рука держит удочку
const HAND_STANCE = { x: FISHER_X + 11, y: FISHER_Y + 6 };   // в стойке руки выше
const ROD_LEN = 24;

// Углы удочки в радианах (0 - вправо, отрицательные - вверх)
const ROD_ANGLE = {
  idle: -1.15,     // удочка вверх-вправо
  back: -0.15,     // замах: удочка отведена вбок
  forward: -1.85,  // конец взмаха
  hold: -1.35,     // после заброса
  fight: -1.6,     // стойка: удочка вверх
};

// Текущее положение рыбака и удочки (меняется из states.js)
let rodAngle = ROD_ANGLE.idle;
let stance = false;     // рыбак в стойке (поклёвка/вываживание)
let sitting = false;    // рыбак сидит на стульчике, удочка лежит на земле
let rodBend = 0;        // 0..1 - насколько гнётся удочка

// Удочка на земле: комель у ног, кончик над водой, посередине рогатка-подставка
const ROD_REST_BASE = { x: FISHER_X + 13, y: FISHER_Y + 18 };
const ROD_REST_ANGLE = -0.55;

function hand() { return stance ? HAND_STANCE : HAND_IDLE; }

// Где сейчас кончик удочки (от него идёт леска)
function rodTip() {
  if (sitting) {
    return { x: ROD_REST_BASE.x + Math.cos(ROD_REST_ANGLE) * ROD_LEN,
             y: ROD_REST_BASE.y + Math.sin(ROD_REST_ANGLE) * ROD_LEN };
  }
  const h = hand();
  return { x: h.x + Math.cos(rodAngle) * ROD_LEN, y: h.y + Math.sin(rodAngle) * ROD_LEN };
}

// Рисует рыбака с удочкой. target - куда тянется согнутая удочка (поплавок) или null.
// Возвращает точку кончика удочки.
function drawFisher(target) {
  if (sitting) {
    sprite(FISHER_SIT, FISHER_PAL, FISHER_X, FISHER_Y + 3);
    const tip = rodTip();
    const fork = { x: ROD_REST_BASE.x + Math.cos(ROD_REST_ANGLE) * 9, y: ROD_REST_BASE.y + Math.sin(ROD_REST_ANGLE) * 9 };
    line(fork.x, fork.y, fork.x, fork.y + 5, '#7c5800');           // рогатка
    px(fork.x - 1, fork.y - 1, '#7c5800'); px(fork.x + 1, fork.y - 1, '#7c5800');
    line(ROD_REST_BASE.x, ROD_REST_BASE.y, tip.x, tip.y, C.rod);
    px(tip.x, tip.y, C.rodTip);
    return tip;
  }
  sprite(stance ? FISHER_STANCE : FISHER, FISHER_PAL, FISHER_X, FISHER_Y);
  const h = hand();
  const straight = rodTip();
  if (rodBend > 0.01 && target) {
    // Согнутая удочка: кончик тянется к поплавку
    const dx = target.x - straight.x, dy = target.y - straight.y;
    const d = Math.hypot(dx, dy) || 1;
    const tip = { x: straight.x + dx / d * 6 * rodBend, y: straight.y + dy / d * 6 * rodBend + 3 * rodBend };
    const mid = { x: h.x + Math.cos(rodAngle) * ROD_LEN * 0.6, y: h.y + Math.sin(rodAngle) * ROD_LEN * 0.6 };
    curve(h, mid, tip, C.rod, 10);
    px(tip.x, tip.y, C.rodTip);
    return tip;
  }
  line(h.x, h.y, straight.x, straight.y, C.rod);
  px(straight.x, straight.y, C.rodTip);
  return straight;
}

// Провисающая леска от a до b
function drawSaggingLine(a, b, sag) {
  curve(a, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 + sag }, b, C.line);
}

// Поплавок. submerged - сколько нижних строк ушло под воду
function drawFloat(x, y, submerged = 0) {
  sprite(FLOAT, FLOAT_PAL, x - 2, y - 7 + submerged, FLOAT.length - submerged);   // 3 верхние строки - антенна
}

// Рыба вида type (из FISH_TYPES) с центром в (x, y). flip - смотрит в другую сторону, s - увеличение
function drawFish(type, x, y, flip, s = 1) {
  const pal = { b: type.body, s: type.stripe, f: type.fin, k: '#000000' };
  sprite(FISH_SPRITE, pal, x - 6 * s, y - 3 * s, FISH_SPRITE.length, flip, s);
}
