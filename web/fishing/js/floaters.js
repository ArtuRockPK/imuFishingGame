'use strict';
// =====================================================================
//  ПЛАВАЮЩИЕ ПРЕДМЕТЫ (события на воде)
//
//  Раз в FLOATERS.interval секунд по воде проплывает случайный предмет из
//  FLOATER_TYPES. Если забросить поплавок прямо в него - предмет цепляется
//  на крючок, срабатывает его эффект (effect), и его сматывают к берегу.
//  Если поплавок уже в воде и предмет проплывает через него - подсечка (HIGH-G)
//  в этот момент тоже цепляет предмет (states.js, состояние waiting).
//
//  Чтобы добавить новый предмет - добавьте блок в FLOATER_TYPES:
//    {
//      name: 'item_bottle',          // ключ перевода в i18n.js (видно в отладке)
//      sprite: BOTTLE, pal: BOTTLE_PAL,   // картинка из sprites.js
//      speed: 12,                    // скорость, пикселей в секунду
//      chance: 1,                    // как часто выпадает относительно других (вес)
//      effect() { ... },             // что происходит, когда поймали
//    },
// =====================================================================

const FLOATER_TYPES = [
  {
    name: 'item_bag',
    sprite: BAG, pal: BAG_PAL,
    speed: 28,
    chance: 1,
    effect() {
      if (game.worms >= FISH.worms) {
        // Червячки и так все - в пакете прикормка: после сматывания бросаем её (bait.js)
        game.baitPending = true;
        game.baitKind = 'bread';
        say(T('msg_bait'), C.good, 12);
      } else {
        game.worms = FISH.worms;                     // все червячки снова на месте
        say(T('msg_bag'), C.good, 12);
      }
      sfx.pickup();
    },
  },
];

let floater = null;            // предмет, который сейчас плывёт (или null)
let floaterTimer = 0;          // секунд с прошлого появления

// Выбрать случайный тип с учётом chance
function pickFloaterType() {
  let total = 0;
  for (const f of FLOATER_TYPES) total += f.chance;
  let r = Math.random() * total;
  for (const f of FLOATER_TYPES) { r -= f.chance; if (r <= 0) return f; }
  return FLOATER_TYPES[0];
}

// Запустить предмет: с левого или правого края, на случайной дальности
function spawnFloater() {
  const type = pickFloaterType();
  const w = type.sprite[0].length;
  const fromLeft = Math.random() < 0.5;
  floater = {
    type,
    x: fromLeft ? -w : W + w,
    y: rand(AIM.yFar + 6, AIM.yNear - 6),
    dir: fromLeft ? 1 : -1,
  };
}

// Каждый кадр: таймер появления и движение
function updateFloaters(dt) {
  floaterTimer += dt;
  if (!floater && floaterTimer >= FLOATERS.interval) {
    floaterTimer = 0;
    spawnFloater();
  }
  if (floater) {
    floater.x += floater.dir * floater.type.speed * dt;
    const w = floater.type.sprite[0].length;
    if (floater.x < -w * 2 || floater.x > W + w * 2) floater = null;   // уплыл за край
  }
}

// Поплавок упал в точку (x, y): попали в предмет? Если да - он на крючке
function hitFloater(x, y) {
  if (!floater) return null;
  if (Math.abs(x - floater.x) > FLOATERS.hitX || Math.abs(y - floater.y) > FLOATERS.hitY) return null;
  const caught = floater;
  floater = null;
  caught.type.effect();
  return caught;
}

// Рисуем предмет так, чтобы (x, y) была серединой ватерлинии; он покачивается на волнах
function drawFloaterSprite(type, x, y, t) {
  const rows = type.sprite;
  const bob = Math.round(Math.sin(t * 2) * 0.7);
  sprite(rows, type.pal, x - rows[0].length / 2, y - rows.length + 2 + bob);
}

function drawFloaters(t) {
  if (!floater) return;
  drawFloaterSprite(floater.type, floater.x, floater.y, t);
  if (Math.random() < 0.05) addRipple(floater.x, floater.y + 2, 0);
}
