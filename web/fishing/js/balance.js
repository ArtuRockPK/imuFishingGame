'use strict';
// =====================================================================
//  УДЕРЖАНИЕ РЫБЫ (часть вываживания, состояние fight)
//
//  На середине шкалы вываживания вид меняется на воду сверху: видно рыбу на леске,
//  вверху шкала с маркером. Рыба тянет маркер то в одну, то в другую сторону.
//  Игрок возвращает его к центру катушкой: по часовой - маркер едет вправо,
//  против часовой - влево. Маркер дошёл до края - рыба сорвалась.
//  Перед этим - сигнал и «Приготовься!» (BALANCE.warnTime секунд, обычный вид).
//  Таймер удержания идёт, только пока маркер в зелёной зоне, в центральной - быстрее.
//  Набрал BALANCE.time секунд - снова обычный вид, крутим дальше.
//
//  Направление вращения приходит со стика (stick.reelDir, controller.js + setup.js),
//  на клавиатуре: R - по часовой, E - против часовой.
//  Настройки - BALANCE в config.js. Обороты в это время не копятся, натяжения нет.
// =====================================================================

// Можно ли удерживать: нужно знать направление вращения
function balanceSupported() {
  return inputMode === 'keyboard' || !!(controllerSetup && controllerSetup.cw != null);
}

// game.balance: { warn, time, hold, p, mv, v, vTarget, nextChange, spin, inCenter, beepAt }
//   warn - ещё предупреждаем («приготовься», обычный вид); time - секунд удержания на воде сверху;
//   hold - сколько набрано на таймер (идёт только в зелёной зоне, в центральной быстрее);
//   p - где маркер: -1 левый край, 0 центр, 1 правый край; mv - его скорость (инерция)
function startBalance() {
  game.balance = { warn: true, time: 0, hold: 0, p: 0, mv: 0, v: 0, vTarget: 0, nextChange: 0,
                   spin: 0, inCenter: false, beepAt: 0,
                   // рыба мечется: смещение от места маркера, куда рвётся, когда следующий рывок;
                   // depth - глубина 0 (у поверхности) .. 1 (глубоко); fx - где рыба на экране, face - куда смотрит
                   dx: 0, dy: 0, tdx: 0, tdy: 0, dartAt: 0, depth: 0.3, tDepth: 0.3, depthAt: 0, fx: W / 2, face: 1 };
  game.tension = false;
  game.tensionPhase = 'calm';
  game.tensionLevel = 0;
  game.tensionNext = Infinity;                // натяжения нет до конца удержания
  sfx.getReady();
  say(T('msg_balance_ready'), C.accent, 12);
}

// Каждый кадр, пока идёт удержание (из fight.update)
function updateBalance(dt, t) {
  const b = game.balance;
  b.time += dt;
  game.lastTurn = t;                          // рыба не сходит из-за того, что «не крутят»
  if (b.warn) {                               // «Приготовься!»: обычный вид, крутить можно (states.js)
    if (b.time >= BALANCE.warnTime) {
      b.warn = false;
      b.time = 0;
      game.messageTime = -10;                 // убрать «Приготовься», чтобы не закрывало шкалу
    }
    return;
  }

  // Рыба время от времени меняет, куда тянет: в случайную сторону, само к центру не вернётся.
  // Первый раз - сразу, чтобы маркер поехал с первого кадра
  if (b.time >= b.nextChange) {
    const side = Math.random() < 0.5 ? -1 : 1;
    b.vTarget = side * BALANCE.drift * rand(0.6, 1.2);
    if (b.nextChange === 0) { b.v = b.vTarget; b.mv = b.vTarget * 0.5; }
    b.nextChange = b.time + rand(BALANCE.changeMin, BALANCE.changeMax);
  }
  b.v += (b.vTarget - b.v) * Math.min(1, dt * 3);

  // Катушка двигает маркер в сторону вращения. Маркер тяжёлый: скорость меняется плавно,
  // поэтому он не дёргается от пакетов стика и проезжает по инерции
  const speed = Math.min(game.reelSpeed, BALANCE.maxSpeed);
  const want = b.v + stick.reelDir * speed * BALANCE.push;
  b.mv += (want - b.mv) * Math.min(1, dt * BALANCE.inertia);
  b.p += b.mv * dt;

  // Центральная зона: пока маркер в ней - короткий приятный бип (сразу при входе и потом
  // каждые BALANCE.beepEvery секунд), чтобы игрок осознанно стремился туда
  const inCenter = Math.abs(b.p) < BALANCE.center;
  if (inCenter && (!b.inCenter || b.time >= b.beepAt)) {
    sfx.sweet();
    b.beepAt = b.time + BALANCE.beepEvery;
  }
  b.inCenter = inCenter;

  // Таймер удержания идёт только в зелёной зоне, в центральной - в BALANCE.centerBoost раз быстрее
  if (inCenter) b.hold += dt * BALANCE.centerBoost;
  else if (Math.abs(b.p) < BALANCE.safe) b.hold += dt;

  // Рыба мечется: то и дело резко рвётся в новую точку, а то уходит на глубину и снова поднимается
  if (b.time >= b.dartAt) {
    b.tdx = rand(-BALANCE.dartX, BALANCE.dartX);
    b.tdy = rand(-BALANCE.dartY, BALANCE.dartY);
    b.dartAt = b.time + rand(BALANCE.dartMin, BALANCE.dartMax);
  }
  b.dx += (b.tdx - b.dx) * Math.min(1, dt * BALANCE.dartSpeed);
  b.dy += (b.tdy - b.dy) * Math.min(1, dt * BALANCE.dartSpeed);
  if (b.time >= b.depthAt) {
    b.tDepth = b.tDepth > 0.5 ? rand(0, 0.35) : rand(0.65, 1);   // то вниз, то наверх
    b.depthAt = b.time + rand(BALANCE.depthMin, BALANCE.depthMax);
  }
  const wasDeep = b.depth > 0.4;
  b.depth += (b.tDepth - b.depth) * Math.min(1, dt * 1.6);
  if (wasDeep && b.depth <= 0.4) addRipple(b.fx, 112 + b.dy, 2.5);   // всплыла - круги по воде

  // Щелчки катушки, как при обычном вываживании
  const before = Math.floor(b.spin * 4);
  b.spin += speed * dt;
  if (Math.floor(b.spin * 4) !== before) sfx.crank();

  if (Math.abs(b.p) >= 1) {                   // упёрся в край - рыба ушла
    game.balance = null;
    sfx.snap();
    loseFish(T('msg_balance_lost'));
    return;
  }
  if (b.hold >= BALANCE.time) {               // продержался
    game.balance = null;
    game.balanceDone = true;
    game.tensionNext = t + rand(TENSION.firstMin, TENSION.firstMax);
    sfx.hook();
    say(T('msg_balance_ok'), C.good);
  }
}

// ---------- Рисование: вода сверху, рыба на леске, шкала ----------
const BAL_BAR = { x: 10, y: 68, w: 300, h: 10 };   // во всю ширину, ниже червячков и часов

function drawBalanceScene(t, dt, st) {
  const b = game.balance;
  // Вода сверху: синий фон и бегущие блики
  rect(0, 0, W, H, C.water1);
  for (let i = 0; i < 70; i++) {
    const sp = 6 + (i % 4) * 4;
    const x = ((i * 53 + t * sp) % (W + 10)) - 5, y = (i * 37 + (i % 5) * 11) % H;
    if (Math.sin(t * 2 + i) < -0.2) continue;
    rect(x, y, 3 + (i % 3), 1, i % 7 === 0 ? C.foam : C.water3);
  }
  for (let i = 0; i < 9; i++) rect((i * 71) % W, (i * 43 + 20) % H, 22, 10, C.water2);

  // Рыба: её сносит в ту сторону, куда уехал маркер, и она мечется вокруг этого места.
  // На глубине меньше, бледнее (сквозь воду) и тень почти под ней; у поверхности крупная, тень в стороне
  const fs = BALANCE.sizeNear - (BALANCE.sizeNear - BALANCE.sizeDeep) * b.depth;
  const fx = Math.max(20, Math.min(W - 20, W / 2 + b.p * 100 + b.dx + Math.sin(t * 7) * 2));
  const fy = 112 + b.dy + Math.sin(t * 2.1) * 3;
  if (Math.abs(fx - b.fx) > 0.3) b.face = fx > b.fx ? 1 : -1;        // смотрит туда, куда плывёт
  b.fx = fx;
  const facingRight = b.face > 0;
  const off = 2 + 8 * (1 - b.depth);                                 // тень на дне: чем ближе к поверхности, тем дальше
  ctx.globalAlpha = 0.3;
  drawFishScaled({ body: '#000000', stripe: '#000000', fin: '#000000' }, fx + off * 0.6, fy + off, facingRight, fs);
  ctx.globalAlpha = 1 - 0.55 * b.depth;
  drawFishScaled(game.fish, fx, fy + (Math.floor(t * 10) % 2), facingRight, fs);
  ctx.globalAlpha = 1;
  if (b.depth < 0.35 && Math.random() < 0.25) addRipple(fx + (facingRight ? -7 : 7) * fs, fy, 1.2);   // хвост бьёт по воде
  drawRipples(dt);
  const mouthX = fx + (facingRight ? 6 : -6) * fs;
  line(W / 2, H + 1, mouthX, fy - fs, C.line);              // леска от удочки снизу к пасти

  // Смена вида: из темноты
  if (b.time < 0.4) {
    ctx.globalAlpha = 1 - b.time / 0.4;
    rect(0, 0, W, H, '#000000');
    ctx.globalAlpha = 1;
  }
}

// Рыба любого размера (s может быть дробным): спрайт увеличивается без размытия
const fishSpriteCache = {};
function drawFishScaled(type, x, y, flip, s) {
  const key = type.body + type.stripe + type.fin;
  let c = fishSpriteCache[key];
  if (!c) {
    c = fishSpriteCache[key] = document.createElement('canvas');
    c.width = FISH_SPRITE[0].length; c.height = FISH_SPRITE.length;
    const g = c.getContext('2d'), pal = { b: type.body, s: type.stripe, f: type.fin, k: '#000000' };
    FISH_SPRITE.forEach((row, r) => [...row].forEach((ch, i) => {
      if (!pal[ch]) return;
      g.fillStyle = pal[ch];
      g.fillRect(i, r, 1, 1);
    }));
  }
  ctx.imageSmoothingEnabled = false;
  ctx.save();
  ctx.translate(Math.round(x), Math.round(y));
  if (flip) ctx.scale(-1, 1);
  ctx.drawImage(c, Math.round(-6 * s), Math.round(-3 * s), Math.round(c.width * s), Math.round(c.height * s));
  ctx.restore();
}

// Шкала и подсказки - после освещения, чтобы ночью не темнели
function drawBalanceHud(t) {
  const b = game.balance, { x, y, w, h } = BAL_BAR;
  rect(x - 2, y - 2, w + 4, h + 4, C.barBg);
  for (let i = 0; i < w; i++) {
    const d = Math.abs(i / (w - 1) * 2 - 1);                // 0 - центр, 1 - край
    const col = d < BALANCE.safe ? C.good : mixColor(C.accent, C.bad, (d - BALANCE.safe) / (1 - BALANCE.safe));
    rect(x + i, y, 1, h, col);
  }
  // Центральная зона: светлая полоса в рамке, пока маркер в ней - мигает
  const cw = Math.round(BALANCE.center * w / 2), cx = Math.round(x + w / 2);
  const glow = b.inCenter && Math.floor(t * 8) % 2;
  rect(cx - cw, y, cw * 2, h, glow ? '#ffffff' : C.center);
  rect(cx - cw - 1, y - 3, 1, h + 6, '#ffffff');
  rect(cx + cw, y - 3, 1, h + 6, '#ffffff');

  // Маркер: тонкая чёрная черта с белыми уголками сверху и снизу
  const mx = Math.round(x + (b.p + 1) / 2 * (w - 1));
  rect(mx, y - 3, 1, h + 6, '#000000');
  rect(mx - 2, y - 5, 5, 2, '#000000');
  rect(mx - 2, y + h + 3, 5, 2, '#000000');

  // Время удержания
  // Таймер удержания: стоит (серый) вне зелёной зоны, в центральной идёт быстрее (салатовый)
  const running = Math.abs(b.p) < BALANCE.safe;
  drawBar(W / 2 - 40, y + h + 11, 80, 1 - b.hold / BALANCE.time,
          b.inCenter ? C.center : running ? C.barTime : '#808080');
}

// Подсказка, куда крутить (текстом на холсте HUD)
function drawBalanceText(t) {
  const b = game.balance;
  if (!b || b.warn || Math.abs(b.p) < BALANCE.safe) return;
  const warn = Math.abs(b.p) > 0.7 && Math.floor(t * 6) % 2;
  text(T(b.p < 0 ? 'balance_cw' : 'balance_ccw'), W / 2, BAL_BAR.y + BAL_BAR.h + 20,
       warn ? C.bad : C.accent, 'center', 6);
}
