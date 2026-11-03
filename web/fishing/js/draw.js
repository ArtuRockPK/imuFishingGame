'use strict';
// =====================================================================
//  ОТРИСОВКА КАДРА
//  Порядок важен: что нарисовано позже - оказывается сверху.
//  фон -> вода и эффекты -> прицел -> островок и рыбак -> леска и поплавок
//  -> шкалы -> фото -> текст
// =====================================================================

// Маркер прицела: прыгающая стрелка над поплавком
function drawMarker(x, y, t, bait = false) {
  const bob = Math.round(Math.sin(t * 6) * 1.5);
  sprite(ARROW, ARROW_PAL, x - 3, y - 14 + bob);
  if (bait) drawBaitBall(x, y - 3);           // выбираем место прикормки
  else drawFloat(x, y);
}

// Бегущий пунктир по вертикали и по горизонтали
function drawDashedV(x, y0, y1, color, t) {
  const off = Math.floor(t * 8) % 4;
  for (let y = y0 + off; y < y1; y += 4) rect(x, y, 1, 2, color);
}
function drawDashedH(y, x0, x1, color, t) {
  const off = Math.floor(t * 8) % 4;
  for (let x = x0 + off; x < x1; x += 4) rect(x, y, 2, 1, color);
}

// Мигающая мишень в выбранной точке
function drawTarget(x, y, t) {
  if (Math.floor(t * 4) % 2) return;
  const c = C.marker;
  line(x - 4, y - 2, x - 2, y - 1, c); line(x + 4, y - 2, x + 2, y - 1, c);
  line(x - 4, y + 2, x - 2, y + 1, c); line(x + 4, y + 2, x + 2, y + 1, c);
}

// Смешать два цвета '#rrggbb': k = 0 - первый, 1 - второй
function mixColor(a, b, k) {
  const ca = parseInt(a.slice(1), 16), cb = parseInt(b.slice(1), 16);
  const ch = (sh) => Math.round(((ca >> sh) & 255) + (((cb >> sh) & 255) - ((ca >> sh) & 255)) * k);
  return '#' + ((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0');
}

// Индикатор натяжения лески: полоса от зелёного (level 0) к красному (level 1)
// и справа иконка удочки: при зелёном слегка согнута и подрагивает (рыба на крючке),
// при переходе гнётся сильнее, при красном согнута до упора и трясётся
function drawTension(x, y, level, t) {
  const w = 80, h = 6;
  rect(x - 1, y - 1, w + 2, h + 2, C.barBg);
  // Через жёлтый, а не напрямую: зелёный + красный в середине дают грязно-бурый
  rect(x, y, w, h, level < 0.5 ? mixColor(C.good, C.accent, level * 2)
                               : mixColor(C.accent, C.bad, level * 2 - 1));

  // Удочка: от рукояти (слева внизу) к кончику (справа вверху), толщина 2 пикселя.
  // bend - насколько клонится кончик: при зелёном чуть-чуть, при красном до упора.
  // Кончик дрожит: при зелёном слегка, при красном сильно
  const L = 24;                                    // длина удочки, пикселей
  const bend = 0.2 + 0.8 * level;
  const shake = level >= 1 ? Math.sin(t * 45) * 2 : Math.sin(t * 17) * 0.8;
  const bx = x + w + 4, by = y + h + 2;            // рукоять
  let tipX = bx, tipY = by;
  for (let i = 0; i <= L * 2; i++) {
    const s = i / (L * 2);
    const rx = Math.round(bx + s * L);
    const ry = Math.round(by - s * L + (bend * 20 + shake) * s * s);
    rect(rx, ry, 2, 2, s < 0.3 ? C.rodHandle : (s > 0.85 ? C.rodTip : C.rod));
    tipX = rx; tipY = ry;
  }
  // Леска с кончика в воду: чем сильнее натяжение, тем сильнее её тянет в сторону
  line(tipX + 1, tipY + 1, tipX + 1 + Math.round(level * 6), by + 4, C.line);
}

// Шкала: k от 0 (пусто) до 1 (полная)
function drawBar(x, y, w, k, color) {
  rect(x - 1, y - 1, w + 2, 5, C.barBg);
  rect(x, y, Math.round(w * Math.max(0, Math.min(1, k))), 3, color);
}

// Червячки (жизни) в правом верхнем углу: живые - розовые, потерянные - тёмные.
// Только что потерянный червячок мигает 1.5 секунды.
function drawWorms(t) {
  const k = 2;                                  // увеличение спрайта
  const step = (WORM[0].length + 1) * k;
  const x0 = W - 4 - FISH.worms * step + k;
  for (let i = 0; i < FISH.worms; i++) {
    const alive = i < game.worms;
    const justLost = i === game.worms && now - game.wormLostTime < 1.5;
    if (justLost && Math.floor(t * 8) % 2) continue;
    ctx.globalAlpha = alive || justLost ? 1 : 0.35;
    const wiggle = alive && Math.floor(t * 2 + i) % 2 ? -1 : 0;   // живые шевелятся
    sprite(WORM, alive || justLost ? WORM_PAL : WORM_LOST_PAL, x0 + i * step, 13 + wiggle, WORM.length, false, k);
  }
  ctx.globalAlpha = 1;
}

// Отладка (клавиша G): сетка 8x8 и рамка рыбной зоны
function drawDebugGrid() {
  for (let i = 0; i <= FISH.grid; i++) {
    const x = AIM.xMin + i * cellW, y = AIM.yFar + i * cellH;
    for (let yy = AIM.yFar; yy <= AIM.yNear; yy += 2) px(x, yy, '#000000');
    for (let xx = AIM.xMin; xx <= AIM.xMax; xx += 2) px(xx, y, '#000000');
  }
  const r = zoneRect();
  ctx.strokeStyle = C.marker;
  ctx.lineWidth = 1;
  ctx.strokeRect(Math.round(r.x) + 0.5, Math.round(r.y) + 0.5, Math.round(r.w), Math.round(r.h));
}

// Леска и поплавок (или рыба) - зависят от состояния
function drawLineAndFloat(s, st, tip) {
  const floatOut = ['casting', 'waiting', 'bite', 'fight', 'reeling'].includes(s);

  if (s === 'casting') {
    line(tip.x, tip.y, game.floatX, game.floatY - 3, C.line);
    drawFloat(game.floatX, game.floatY);
  } else if (s === 'bite') {
    // Поклёвка: поплавок утащило под воду, видна только натянутая леска
    line(tip.x, tip.y, game.floatX, game.floatY, C.line);
  } else if (s === 'fight') {
    // После подсечки поплавок снова показался, но притоплен
    line(tip.x, tip.y, game.floatX, game.floatY - 1, C.line);
    drawFloat(game.floatX, game.floatY, 5);
  } else if (s === 'reeling' && game.hooked) {
    // Тянем пойманный предмет вместо поплавка
    line(tip.x, tip.y, game.floatX, game.floatY - 4, C.line);
    drawFloaterSprite(game.hooked.type, game.floatX, game.floatY, st);
  } else if (floatOut) {
    // Перед поклёвкой поплавок уходит под воду (floatDive в game.js)
    drawSaggingLine(tip, { x: game.floatX, y: game.floatY - 3 }, 6);
    const dive = floatDive();
    if (dive < 1) drawFloat(game.floatX, game.floatY, Math.round(dive * FLOAT.length));
  } else if (s === 'caught') {
    // Рыба летит по дуге к рыбаку и висит на леске
    const u = Math.min(1, st / 0.7);
    const fx = game.floatX + (tip.x - game.floatX) * u;
    const fy = game.floatY + (tip.y + 12 - game.floatY) * u - 30 * 4 * u * (1 - u);
    line(tip.x, tip.y, fx, fy - 3, C.line);
    drawFish(game.fish, fx, fy + Math.round(Math.sin(st * 18) * (1 - u * 0.5)), Math.floor(st * 6) % 2 === 0);
  } else {
    // Поплавок висит у кончика удочки
    const hang = { x: tip.x, y: tip.y + 7 };
    line(tip.x, tip.y, hang.x, hang.y - 3, C.line);
    drawFloat(hang.x, hang.y);
  }
}

// Весь текст поверх сцены
function drawHud(s, st, photo) {
  const hint = hintFor(s);
  const alert = STATES[s] && STATES[s].alert;
  const blink = alert && Math.floor(st * 3) % 2;
  if (hint && !blink) text(hint, W / 2, 4, alert ? C.accent : C.text);

  // Сообщение по центру (say), 2.2 секунды
  if (now - game.messageTime < 2.2 && s !== 'photo') {
    text(game.message, W / 2, game.messageSize > 8 ? 62 : 70, game.messageColor, 'center', game.messageSize);
  }

  // Подпись под фото: вид, вес, редкость
  if (photo && st > 0.35) {
    text(T(game.fish.name), W / 2, photo.captionY, C.text, 'center', 8);
    text(game.fishWeight.toFixed(2) + ' ' + T('kg'), W / 2, photo.captionY + 10, C.text, 'center', 8);
    text(T(game.rarity.name), W / 2, photo.captionY + 19, C.text, 'center', 8);
  }

  // Прогресс к цели: сколько кг поймано из нужных; под ним часы
  if (s !== 'wait') {
    const done = game.totalWeight >= FISH.goalKg;
    text(`${game.totalWeight.toFixed(1)}/${FISH.goalKg} ${T('kg')}`, W - 4, 36, done ? C.good : C.text, 'right');
    text(clockText(), W - 4, 47, C.text, 'right', 6);
  }

  // Проигрыш / победа
  const result = T('result_line', { n: game.caughtCount, kg: game.totalWeight.toFixed(2) });
  if (s === 'gameover' && st > 0.5) {
    text(T('gameover_title'), W / 2, 58, C.bad, 'center', 12);
    text(result, W / 2, 80, C.text);
  }
  if (s === 'win' && st > 0.5) {
    text(T('win_title'), W / 2, 54, C.accent, 'center', 16);
    text(result, W / 2, 80, C.text);
  }

  // Низ экрана: последнее событие стика справа, подсказки по управлению / состояние стика слева
  if (now - game.lastEventTime < 1.2) text(game.lastEvent, W - 4, H - 11, C.accent, 'right');
  if (inputMode === 'keyboard') {
    text('SPC=TAP2 H=HI-G L=LO-G O=ORI R/T=REEL F=FLAT B=BLOW', 4, H - 11, C.text, 'left', 6);
  } else if (inputMode === 'ble') {
    const state = T(stick.still ? 'stick_still' : 'stick_moving');
    text((battery !== null ? battery + '% ' : '') + state, 4, H - 11,
         stickResting() ? C.good : C.text, 'left', 6);
  }

  if (showDebug && fishZone) {
    const left = s === 'waiting'
      ? `  ДО ПОКЛЁВКИ ${Math.max(0, (game.biteAt - game.waited) / (sitting ? FISH.restingSpeedup : 1)).toFixed(0)}С`
      : '';
    text(`ЗОНА ${fishZone.col},${fishZone.row} РЫБ ${fishZone.fish}${left}`, 4, 16, C.marker, 'left');
    text(`FLAT ${stick.flat ? 1 : 0} STILL ${stick.still ? 1 : 0} ТИШИНА ${(now - stick.lastMotion).toFixed(0)}С`, 4, 26, C.marker, 'left');
    text(floater ? 'ПЛЫВЁТ: ' + T(floater.type.name) : `ПРЕДМЕТ ЧЕРЕЗ ${Math.max(0, FLOATERS.interval - floaterTimer).toFixed(0)}С`, 4, 36, C.marker, 'left');
    text(`ВРЕМЯ ${clockText()} ${dayPart().toUpperCase()} ДЕНЬ ${clock.day + 1}`, 4, 56, C.marker, 'left');
    if (baitSpot) text(`ПРИКОРМКА ${baitSpot.col},${baitSpot.row} ОСТАЛОСЬ ${baitSpot.timeLeft.toFixed(0)}С`, 4, 46, C.marker, 'left');
  }

}

// Один кадр. t - время с запуска, dt - секунд с прошлого кадра
function draw(t, dt) {
  hctx.clearRect(0, 0, W, H);
  const s = game.state, st = game.stateTime;
  const L = lightAt(clock.hour);              // время суток: цвета неба, свет, солнце и луна (daytime.js)

  // Мини-игра с ведром: своя сцена (bucket.js)
  if (s === 'bucket') {
    drawBucketScene(t, st);
    lightScene(L, t, { lift: 0.35 });
    drawHud(s, st, null);
    return;
  }

  // Ночной костёр: своя сцена (campfire.js)
  if (s === 'campfire') {
    drawCampfireScene(L, t, dt, st);
    drawHud(s, st, null);
    return;
  }

  // Мини-игра с комаром: своя сцена с рукой (mosquito.js). Пока слышен писк - обычная сцена
  if (s === 'mosquito' && st >= MOSQUITO.introTime) {
    drawMosquitoScene(t, st);
    lightScene(L, t, { lift: 0.35 });
    drawHud(s, st, null);
    return;
  }

  // Фон и вода. Небо пока прозрачное - оно подкладывается после освещения (drawSkyBehind)
  ctx.clearRect(0, 0, W, H);
  drawFarShore();
  drawWater(t);
  markWater();
  if (fishZone) drawBubbles(dt);
  drawBait(t, dt);
  if (showDebug && fishZone) drawDebugGrid();
  drawRipples(dt);
  drawFloaters(t);

  // Прицел
  if (s === 'aimX' || s === 'baitAimX') {
    drawDashedV(Math.round(game.markerX), HORIZON + 4, AIM.yNear + 6, C.guide, t);
  }
  if (s === 'aimY' || s === 'baitAimY') {
    drawDashedV(Math.round(game.targetX), HORIZON + 4, AIM.yNear + 6, C.guide, 0);
    drawDashedH(Math.round(game.markerY), AIM.xMin, AIM.xMax, C.guide, t);
  }
  if (s === 'ready' || s === 'baitReady') drawTarget(game.targetX, game.targetY, st);

  // Островок, фонарь, рыбак, леска
  drawIsland(t);
  drawLantern();
  drawIslandFire(t);                          // костёр после ночного ивента (campfire.js)
  const floatOut = ['casting', 'waiting', 'bite', 'fight', 'reeling'].includes(s);
  const tip = drawFisher(floatOut ? { x: game.floatX, y: game.floatY } : null);
  drawLineAndFloat(s, st, tip);
  drawSplashes(dt);

  // Летящий хлеб-прикормка
  if (s === 'baitThrow') {
    const u = Math.min(1, st / BAIT.throwTime);
    const fx = game.baitFromX, fy = game.baitFromY;
    const arc = 30 + Math.hypot(game.targetX - fx, game.targetY - fy) * 0.3;
    drawBaitBall(fx + (game.targetX - fx) * u, fy + (game.targetY - fy) * u - arc * 4 * u * (1 - u));
  }

  // Время суток: перекрасить сцену, подложить небо, зажечь фонарь и светлячков (daytime.js).
  // Всё, что ниже, - подсказки и шкалы, они не темнеют
  lightScene(L, t, { water: true, lights: sceneLights(L, t) });
  drawSkyBehind(L, t, dt);
  drawLanternFlame(L, t);
  drawIslandFireFlame(t);
  drawFireflies(L, t);

  if (['aimX', 'aimY', 'baitAimX', 'baitAimY'].includes(s)) {
    drawMarker(game.markerX, game.markerY, t, s.startsWith('bait'));
  }

  // Шкалы подсечки и вываживания над рыбаком
  if (s === 'bite') drawBar(FISHER_X - 14, FISHER_Y - 10, 40, 1 - st / game.difficulty.hookWindow, C.barTime);
  if (s === 'fight') {
    // Натяжение: зелёный - крути смело, плавно краснеет - готовься, красный - медленно!
    drawTension(FISHER_X - 34, FISHER_Y - 18, game.tensionLevel, t);
    drawBar(FISHER_X - 14, FISHER_Y - 8, 40, game.turns / game.fightTurns, C.barFill);
  }

  if (s !== 'wait') drawWorms(t);

  // Проигрыш или победа: затемняем сцену
  if (s === 'gameover' || s === 'win') {
    ctx.globalAlpha = Math.min(0.55, st);
    rect(0, 0, W, H, '#000000');
    ctx.globalAlpha = 1;
  }

  // Фото улова поверх всего
  const photo = s === 'photo' ? drawPhoto(st) : null;

  drawHud(s, st, photo);
}
