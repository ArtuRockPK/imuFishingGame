'use strict';
// =====================================================================
//  ПРИКОРМКА
//
//  Если поймать пакет, когда все червячки на месте, игрок бросает прикормку:
//  выбирает сектор так же, как место заброса, и делает LOW-G (резко опускает стик).
//  Прикормленный сектор бурлит. Заброс в него - почти наверняка элитная или
//  эпическая рыба. Сектор действует BAIT.time секунд (config.js), потом исчезает.
//  Состояния броска (baitAimX, baitAimY, baitReady, baitThrow) - в states.js.
// =====================================================================

let baitSpot = null;     // { col, row, timeLeft } - прикормленный сектор и сколько секунд он ещё действует

// Прикормить сектор, в который попала точка (x, y)
function newBaitSpot(x, y) {
  const { col, row } = cellAt(x, y);
  baitSpot = { col, row, timeLeft: BAIT.time };
}

// Прямоугольник сектора в координатах экрана
function baitRect() {
  return { x: AIM.xMin + baitSpot.col * cellW, y: AIM.yFar + baitSpot.row * cellH, w: cellW, h: cellH };
}

// Попала ли точка в прикормленный сектор
function inBait(x, y) {
  if (!baitSpot) return false;
  const { col, row } = cellAt(x, y);
  return col === baitSpot.col && row === baitSpot.row;
}

// Каждый кадр: отсчёт времени. Если поплавок уже лёг в прикормку, а время вышло,
// эта попытка всё равно идёт с бонусом (game.castInBait).
function updateBait(dt) {
  if (!baitSpot) return;
  baitSpot.timeLeft -= dt;
  if (baitSpot.timeLeft <= 0) baitSpot = null;
}

// Редкость улова на прикормке: elite / epic с шансами из BAIT, иначе обычный розыгрыш (null)
function baitRarity() {
  const r = Math.random();
  if (r < BAIT.epicChance) return RARITIES.find(x => x.id === 'epic');
  if (r < BAIT.epicChance + BAIT.eliteChance) return RARITIES.find(x => x.id === 'elite');
  return null;
}

// ---------- Рисование: бурлящая вода ----------
const baitBubbles = [];
const BAIT_COLORS = ['#fcfcfc', '#d8f8f8', '#c88c30', '#ac7c00'];   // пена и крошки прикормки

function drawBait(t, dt) {
  if (!baitSpot) return;
  const r = baitRect();

  // Тёмное пятно прикормки под водой
  ctx.fillStyle = 'rgba(120, 80, 20, 0.35)';
  ctx.fillRect(Math.round(r.x + 2), Math.round(r.y + 1), Math.round(r.w - 4), Math.round(r.h - 2));

  // Вода кипит: ~60 пузырей и крошек в секунду, пузыри растут и лопаются брызгами.
  // Последние 5 секунд бурление стихает - видно, что прикормка заканчивается.
  const fade = Math.min(1, baitSpot.timeLeft / 5);
  if (dt > 0) {
    const n = Math.floor(dt * 60 * fade + Math.random());
    for (let i = 0; i < n; i++) {
      baitBubbles.push({
        x: rand(r.x + 2, r.x + r.w - 2), y: rand(r.y + 2, r.y + r.h - 1),
        age: 0, life: rand(0.3, 0.7), color: BAIT_COLORS[randInt(0, BAIT_COLORS.length - 1)],
      });
    }
    if (Math.random() < dt * 6 * fade) addRipple(rand(r.x + 4, r.x + r.w - 4), r.y + r.h / 2, 0.4);
  }
  for (let i = baitBubbles.length - 1; i >= 0; i--) {
    const b = baitBubbles[i];
    b.age += dt;
    if (b.age >= b.life) { baitBubbles.splice(i, 1); continue; }
    const k = b.age / b.life;
    const y = b.y - k * 6;                  // поднимаются выше обычных
    const foam = b.color === BAIT_COLORS[0] || b.color === BAIT_COLORS[1];
    if (foam && k > 0.8) {
      // лопнул: брызги в стороны и вверх
      px(b.x - 2, y, C.foam); px(b.x + 2, y, C.foam); px(b.x, y - 2, C.foam);
    } else if (foam && k > 0.35) {
      rect(b.x, y - 1, 2, 2, b.color);      // пузырь подрос
    } else {
      px(b.x, y, b.color);
    }
  }
}

// Прикормка в полёте и на маркере, (x, y) - её центр: кусочек хлеба или комар
function drawBaitBall(x, y) {
  const [rows, pal] = game.baitKind === 'mosquito' ? [MOSQUITO_DEAD, MOSQUITO_PAL] : [BREAD, BREAD_PAL];
  sprite(rows, pal, x - rows[0].length / 2, y - rows.length / 2);
}
