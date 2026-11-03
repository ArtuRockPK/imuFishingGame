'use strict';
// =====================================================================
//  СОСТОЯНИЕ СТИКА (не зависит от того, что сейчас происходит в игре)
//
//  still - стик отложили: пришёл NO MOT и после него не было ANY MOT.
//  flat  - стик лежит экраном вверх (FLAT с кодом 1). Сейчас только для отладки (клавиша G).
// =====================================================================

const stick = { flat: false, still: false, stillSince: 0, lastMotion: 0 };

// Вызывается на каждое событие от стика, до игровой логики
function updateStickState(id, code) {
  if (id === EV.FLAT) stick.flat = code === 1;
  if (id === EV.NO_MOT && !stick.still) { stick.still = true; stick.stillSince = now; }
  // Неподвижность сбрасывает только ANY MOT: ORIENT и SIG MOT датчик присылает с задержкой,
  // уже после того как стик положили - они не означают, что стик взяли в руки.
  if (id === EV.ANY_MOT || (id === EV.REEL && code > 0)) { stick.still = false; stick.lastMotion = now; }
}

// Стик лежит уже FISH.sitDelay секунд - рыбак садится на стульчик
function stickResting() {
  return stick.still && now - stick.stillSince >= FISH.sitDelay;
}
