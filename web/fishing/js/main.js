'use strict';
// =====================================================================
//  ГЛАВНЫЙ ЦИКЛ: браузер вызывает frame() ~60 раз в секунду.
//  Каждый кадр: обновить игру (update) и нарисовать (draw).
// =====================================================================

let now = 0;                          // секунд с запуска страницы (игровое время)
let last = performance.now() / 1000;

function frame(ms) {
  const tNow = ms / 1000;
  const dt = Math.min(0.05, tNow - last);   // не больше 0.05 с, чтобы после паузы не было скачка
  last = tNow;
  now += dt;
  if (game.state !== 'wait' && !paused) update(dt);
  draw(now, paused ? 0 : dt);
  updateAmbience(dt);                 // звуки природы (ambience.js)
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
