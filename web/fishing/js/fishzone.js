'use strict';
// =====================================================================
//  РЫБНАЯ ЗОНА
//  Поле прицеливания (AIM) делится на 8x8 секторов. Рыбная зона - квадрат
//  4x4 сектора в случайном месте. В ней 3-5 рыб; когда они кончаются,
//  зона переезжает. Размеры и числа - в FISH (config.js).
// =====================================================================

let fishZone = null;   // { col, row, fish } - левый верхний сектор зоны и сколько рыб осталось

const cellW = (AIM.xMax - AIM.xMin) / FISH.grid;    // ширина сектора
const cellH = (AIM.yNear - AIM.yFar) / FISH.grid;   // высота сектора

// Выбрать новое случайное место для рыбы (не то же самое, что было)
function newFishZone() {
  const maxStart = FISH.grid - FISH.zoneSize;
  let col, row;
  do {
    col = randInt(0, maxStart);
    row = randInt(0, maxStart);
  } while (fishZone && col === fishZone.col && row === fishZone.row);
  fishZone = { col, row, fish: randInt(FISH.zoneFishMin, FISH.zoneFishMax) };
}

// Прямоугольник зоны в координатах экрана
function zoneRect() {
  return {
    x: AIM.xMin + fishZone.col * cellW,
    y: AIM.yFar + fishZone.row * cellH,
    w: FISH.zoneSize * cellW,
    h: FISH.zoneSize * cellH,
  };
}

// В какой сектор попадает точка (x, y)
function cellAt(x, y) {
  const col = Math.min(FISH.grid - 1, Math.max(0, Math.floor((x - AIM.xMin) / cellW)));
  const row = Math.min(FISH.grid - 1, Math.max(0, Math.floor((y - AIM.yFar) / cellH)));
  return { col, row };
}

// Попала ли точка в рыбную зону
function inZone(x, y) {
  const { col, row } = cellAt(x, y);
  return col >= fishZone.col && col < fishZone.col + FISH.zoneSize &&
         row >= fishZone.row && row < fishZone.row + FISH.zoneSize;
}

function takeFishFromZone() {
  fishZone.fish--;
}
