'use strict';
// =====================================================================
//  РУБИМ ДРОВА (начало ночного костра, campfire.js)
//
//  Прежде чем раздувать костёр, нужно наготовить дров. Две части, обе - рывком (HIGH_G):
//   1. chop  - вид сверху: бревно на большом спиле дерева выезжает слева направо. Топор бьёт по
//      неподвижной черте, справа от неё на земле зелёная метка. Рывок, когда конец бревна
//      в зелёной метке, - отрублено полено. Рано - топор бьёт мимо, полена нет.
//      Прозевал (конец проехал метку) - бревно откатывается назад, ещё попытка.
//      Нужно WOOD.chunks поленьев, бревно с каждым поленом едет быстрее.
//   2. split - вид сбоку: полено стоит на пеньке, над ней плавает маркер (куда упадёт топор).
//      Рывок, когда маркер в зелёной зоне по центру полена, - полено раскалывается на дрова.
//      Не по центру - топор отскакивает, пробуем ещё. Маркер с каждым поленом быстрее.
//  Потом - обычный костёр (fire.phase = 'kindle').
//  Настройки - WOOD в config.js.
// =====================================================================

const WOOD_LOG_Y = 62, WOOD_LOG_H = 44;     // бревно (вид сверху): верхний край и толщина
const WOOD_AXE_X = 214;                     // по какой черте бьёт топор
const STUMP_X = 160, STUMP_Y = 140;         // пенёк (вид сбоку): центр и верх
const BLOCK_W = 20, BLOCK_H = 36;           // полено на пеньке: полуширина и высота
const SPLIT_RANGE = 52;                     // насколько маркер уходит от центра, пикселей

const wood = {
  cut: 0,                     // сколько поленьев отрублено
  split: 0,                   // сколько расколото
  endX: 0, len: 0,            // правый конец бревна и его длина
  back: false,                // прозевали: бревно откатывается назад
  speed: 0,                   // скорость бревна, пикселей в секунду
  pieces: [],                 // отрубленные поленья, катятся вниз: { x0, x1, y, fromX, fromY, toX, toY, t }
  m: 0, mPhase: 0,            // маркер над поленом: -1..1 и фаза качания
  axeT: -10, axeX: 0, axeHit: '',   // когда ударил топор, куда, чем кончилось ('cut'/'miss'/'early'/'split'/'off')
  blockT: 0,                  // когда поставили новое полено (падает на пенёк сверху)
  halves: [],                 // половинки расколотого полена, разлетаются
  chips: [],                  // щепки
  doneT: -1,                  // когда закончили часть (пауза перед следующей)
};

function startWood() {
  Object.assign(wood, {
    cut: 0, split: 0,
    len: WOOD.chunks * (WOOD.zoneMax + 4) + 70,
    back: false, speed: WOOD.logSpeed, pieces: [],
    m: 0, mPhase: 0, axeT: -10, axeX: 0, axeHit: '', blockT: 0,
    halves: [], chips: [], doneT: -1,
  });
  wood.endX = 80;                            // бревно уже лежит, конец подъезжает к топору
  setFirePhase('chop');
}

function woodSwinging() { return game.stateTime - wood.axeT < WOOD.axeTime; }

function woodEvent(id) {
  if (id !== EV.HIGH_G || woodSwinging() || wood.doneT >= 0) return;
  if (game.stateTime - fire.phaseT < 0.6) return;     // не рубить случайно тем же рывком
  wood.axeT = game.stateTime;
  sfx.swing();
  if (fire.phase === 'chop') chopLog();
  else splitBlock();
}

// Удар по бревну: попали конец в зелёную метку - полено
function chopLog() {
  const d = wood.endX - WOOD_AXE_X;
  wood.axeX = WOOD_AXE_X;
  if (wood.back || d < WOOD.zoneMin) {
    wood.axeHit = 'early';
    if (d > 0 && !wood.back) { sfx.thunk(); addChips(WOOD_AXE_X, WOOD_LOG_Y + WOOD_LOG_H / 2, 4); }
    else sfx.thud();
    say(T('msg_wood_early'), C.bad);
    return;
  }
  wood.axeHit = 'cut';
  sfx.chop();
  addChips(WOOD_AXE_X, WOOD_LOG_Y + WOOD_LOG_H / 2, 10);
  const i = wood.cut;
  wood.pieces.push({ x0: WOOD_AXE_X, x1: wood.endX, fromX: WOOD_AXE_X, fromY: WOOD_LOG_Y,
                     toX: 8 + i * 72, toY: 124, t: game.stateTime });
  wood.cut++;
  wood.len -= d;
  wood.endX = WOOD_AXE_X;
  wood.speed += WOOD.logSpeedUp;
  if (wood.cut >= WOOD.chunks) {
    wood.doneT = game.stateTime;
    say(T('msg_wood_blocks'), C.good);
  } else say(T('msg_wood_cut'), C.good);
}

// Удар по полену: маркер в центре - раскололи
function splitBlock() {
  const dx = wood.m * SPLIT_RANGE;
  wood.axeX = STUMP_X + dx;
  if (Math.abs(dx) <= WOOD.splitTol) {
    wood.axeHit = 'split';
    sfx.crack();
    addChips(STUMP_X, STUMP_Y - BLOCK_H, 12);
    wood.halves = [-1, 1].map(side => ({ side, t: game.stateTime }));
    wood.split++;
    if (wood.split >= WOOD.chunks) {
      wood.doneT = game.stateTime;
      say(T('msg_wood_done'), C.good);
    } else {
      say(T('msg_wood_split'), C.good);
      wood.blockT = game.stateTime + 0.7;             // следующее полено - когда разлетятся половинки
    }
  } else {
    wood.axeHit = Math.abs(dx) < BLOCK_W ? 'off' : 'miss';
    if (wood.axeHit === 'off') { sfx.thunk(); addChips(wood.axeX, STUMP_Y - BLOCK_H, 3); }
    else sfx.thud();
    say(T('msg_wood_off'), C.bad);
  }
}

function addChips(x, y, n) {
  for (let i = 0; i < n; i++) {
    wood.chips.push({ x, y, vx: rand(-70, 70), vy: -rand(30, 110), age: 0, life: rand(0.4, 0.8) });
  }
}

function updateWood(dt, t) {
  updateParticles(wood.chips, dt, 260);       // campfire.js
  const pt = t - fire.phaseT;

  if (fire.phase === 'chop') {
    if (wood.doneT >= 0) {
      if (t - wood.doneT >= WOOD.pauseTime) {
        wood.blockT = t;
        wood.mPhase = Math.random() * Math.PI * 2;
        wood.doneT = -1;
        setFirePhase('split');
      }
      return;
    }
    if (wood.back) {                          // прозевали - откатываем, чтобы конец снова подъехал
      wood.endX -= 160 * dt;
      if (wood.endX <= WOOD_AXE_X - 40) wood.back = false;
    } else if (pt > 0.5) {
      wood.endX += wood.speed * dt;
      if (wood.endX - WOOD_AXE_X > WOOD.zoneMax + 6) {
        wood.back = true;
        sfx.lost();
        say(T('msg_wood_late'), C.bad);
      }
    }
  } else if (fire.phase === 'split') {
    if (wood.doneT >= 0) {
      if (t - wood.doneT >= WOOD.pauseTime) {
        wood.doneT = -1;
        startKindle();                        // campfire.js: дрова есть - раздуваем костёр
      }
      return;
    }
    // Маркер качается от края до края; пока топор поднимается после удара - стоит
    if (!woodSwinging() && t >= wood.blockT + 0.3) {
      wood.mPhase += dt * Math.PI * 2 * (WOOD.markerSpeed + wood.split * WOOD.markerSpeedUp);
    }
    wood.m = Math.sin(wood.mPhase);
  }
}

// ---------- Рисование ----------
// Кора бревна сверху: продольные тёмные полосы, сдвиг привязан к самому бревну
function drawLogTop(x0, x1, y, h, ox, cutLeft, cutRight) {
  x0 = Math.round(x0); x1 = Math.round(x1);
  if (x1 <= x0) return;
  rect(x0, y, x1 - x0, h, '#8c5418');
  rect(x0, y, x1 - x0, 3, '#b07434');
  rect(x0, y + h - 3, x1 - x0, 3, '#5c3400');
  const rows = Math.floor((h - 8) / 3);
  for (let k = 0; k < rows; k++) {
    const yy = y + 5 + k * 3;
    for (let x = x0; x < x1; x++) {
      const u = Math.floor(x - ox);
      if ((u * 7 + k * 13) % 23 < 9) px(x, yy, '#6c3c08');
    }
  }
  if (cutLeft) rect(x0, y, 3, h, '#e0b878');            // свежий срез светлый
  if (cutRight) rect(x1 - 3, y, 3, h, '#e0b878');
}

// Классический топор (спрайт): топорище вправо, на конце изгиб и набалдашник; слева стальной
// обух и широкое лезвие с бородкой, кромка смотрит вниз. Рукоять - в точке AXE_GRIP, кромка - AXE_EDGE
const AXE_GRIP = { x: 62, y: 6 }, AXE_EDGE = { x: 10, y: 23 };
const AXE_SPRITE = (() => {
  const c = document.createElement('canvas');
  c.width = 68; c.height = 24;
  const g = c.getContext('2d');
  const p = (x, y, w, h, col) => { g.fillStyle = col; g.fillRect(x, y, w, h); };
  for (let x = 12; x < 64; x++) {                        // толстое топорище, к концу чуть изгибается вниз
    const b = x > 52 ? 1 : 0;
    p(x, 1 + b, 1, 1, '#202020');
    p(x, 2 + b, 1, 2, '#e8b878');
    p(x, 4 + b, 1, 3, '#c08040');
    p(x, 7 + b, 1, 2, '#8c5418');
    p(x, 9 + b, 1, 1, '#202020');
    if (x % 9 === 0) p(x, 5 + b, 3, 1, '#a86c2c');       // волокна дерева
  }
  p(60, 0, 7, 12, '#202020');                            // набалдашник
  p(61, 1, 5, 10, '#8c5418');
  p(61, 1, 5, 3, '#b07434');
  p(5, 0, 15, 11, '#202020');                            // обух
  p(6, 1, 13, 9, '#6c6c6c');
  p(6, 1, 13, 2, '#a8a8a8');
  p(18, 2, 2, 7, '#4c4c4c');
  for (let y = 11; y < 23; y++) {                        // лезвие: расширяется книзу, бородка вперёд
    const k = y - 11;
    let l = 6 - Math.round(k * 0.55), r = 18 + Math.round(k * 0.25);
    if (y === 22) { l += 1; r -= 1; }                    // скруглённая кромка
    p(l - 1, y, r - l + 3, 1, '#202020');
    p(l, y, r - l + 1, 1, y >= 20 ? '#fcfcfc' : y >= 18 ? '#d0d0d0' : '#9c9c9c');
  }
  return c;
})();

// x, y - куда приходится кромка при ударе. k - насколько замахнулись (0 - лезвие в дереве,
// 1 - топор поднят над головой). flip - рукоять слева (вид сверху, чтобы не закрывать конец бревна)
function drawAxeAt(x, y, k, flip = false) {
  const dx = AXE_GRIP.x - AXE_EDGE.x, dy = AXE_GRIP.y - AXE_EDGE.y;
  ctx.save();
  ctx.translate(Math.round(x + (flip ? -dx : dx)), Math.round(y + dy));
  if (flip) ctx.scale(-1, 1);
  ctx.rotate(k * 1.3);                                   // замах: топор поворачивается вокруг рукояти
  ctx.drawImage(AXE_SPRITE, -AXE_GRIP.x, -AXE_GRIP.y);
  ctx.restore();
}

// Спил дерева, вид сверху: годичные кольца, трещины, по краям кора (рисуется один раз)
const CUT_BG = (() => {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const img = g.createImageData(W, H), d = img.data;
  const cx = 150, cy = 96, R = 176;
  const hex = (s) => [1, 3, 5].map(i => parseInt(s.slice(i, i + 2), 16));
  const cols = { a: hex('#e0b070'), b: hex('#c89050'), dark: hex('#a86c30'), heart: hex('#9c5c20'),
                 bark: hex('#5c3400'), bark2: hex('#3c2000'), ground: hex('#2c4c10') };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const ddx = x - cx, ddy = (y - cy) * 1.1;
      const r = Math.hypot(ddx, ddy), a = Math.atan2(ddy, ddx);
      const w = r + Math.sin(a * 3 + 1) * 3 * r / R + Math.sin(a * 7 + 2) * 1.5 * r / R;   // кольца неровные
      let col;
      if (w > R + 12) col = cols.ground;
      else if (w > R) col = Math.floor(a * 40) % 3 ? cols.bark : cols.bark2;
      else if (r < 7) col = cols.heart;
      else {
        const ring = Math.floor(w / 6);
        col = ring % 6 === 5 ? cols.dark : ring % 2 ? cols.b : cols.a;
      }
      const i = (y * W + x) * 4;
      d[i] = col[0]; d[i + 1] = col[1]; d[i + 2] = col[2]; d[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  // Трещины от сердцевины
  g.fillStyle = '#6c3c10';
  for (const [a0, len] of [[0.4, 120], [2.2, 90], [3.6, 140], [5.1, 70]]) {
    for (let r = 10; r < len; r++) {
      const a = a0 + Math.sin(r * 0.15) * 0.04;
      g.fillRect(Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r / 1.1), 1, 1);
    }
  }
  return c;
})();

function drawChopScene(L, t, dt) {
  const st = game.stateTime;
  // Смотрим сверху на большой спил дерева, на нём бревно (тень чуть ниже)
  ctx.drawImage(CUT_BG, 0, 0);
  const x0 = wood.endX - wood.len;
  ctx.globalAlpha = 0.3;
  rect(Math.round(x0), WOOD_LOG_Y + 5, Math.round(wood.endX - x0) + 3, WOOD_LOG_H, '#000000');
  ctx.globalAlpha = 1;
  drawLogTop(x0, wood.endX, WOOD_LOG_Y, WOOD_LOG_H, x0, false, wood.cut > 0);
  for (const p of wood.pieces) {
    const k = Math.min(1, (st - p.t) / 0.5), e = k * (2 - k);
    const x = p.fromX + (p.toX - p.fromX) * e, y = p.fromY + (p.toY - p.fromY) * e - Math.sin(k * Math.PI) * 20;
    ctx.globalAlpha = 0.3;
    rect(Math.round(x), Math.round(y) + 4 + Math.round(Math.sin(k * Math.PI) * 20), Math.round(p.x1 - p.x0) + 2, WOOD_LOG_H, '#000000');
    ctx.globalAlpha = 1;
    drawLogTop(x, x + (p.x1 - p.x0), y, WOOD_LOG_H, p.x0, true, true);
  }
  for (const p of wood.chips) rect(p.x, p.y, 2, 2, '#e0b878');

  lightScene(L, t, { lift: 0.45 });

  // После освещения: зелёная метка и черта топора, чтобы ночью их было видно
  const z0 = WOOD_AXE_X + WOOD.zoneMin, z1 = WOOD_AXE_X + WOOD.zoneMax;
  const inZone = !wood.back && wood.endX - WOOD_AXE_X >= WOOD.zoneMin && wood.endX - WOOD_AXE_X <= WOOD.zoneMax;
  const zc = inZone && Math.floor(t * 8) % 2 ? '#ffffff' : C.good;
  for (const y of [WOOD_LOG_Y - 9, WOOD_LOG_Y + WOOD_LOG_H + 3]) {
    rect(z0, y, z1 - z0, 6, zc);
    rect(z0, y, 1, 6, '#ffffff');
    rect(z1 - 1, y, 1, 6, '#ffffff');
  }
  for (let y = WOOD_LOG_Y - 10; y < WOOD_LOG_Y + WOOD_LOG_H + 10; y += 4) px(WOOD_AXE_X, y, '#ffffff');   // где рубит топор

  // Топор: поднят над чертой, при ударе - на бревне
  const sw = st - wood.axeT;
  const lift = sw < 0.08 ? 1 - sw / 0.08 : sw < WOOD.axeTime ? 0 : Math.min(1, (sw - WOOD.axeTime) / 0.15);
  drawAxeAt(WOOD_AXE_X, WOOD_LOG_Y + WOOD_LOG_H / 2 + 4, lift, true);

  drawBar(STUMP_X - 40, 17, 80, wood.cut / WOOD.chunks, C.barFill);
}

// Полено сбоку: кора с вертикальными полосами, сверху срез с кольцами
function drawBlock(cx, bottom, halfW, h, top) {
  rect(cx - halfW, bottom - h, halfW * 2, h, '#8c5418');
  for (let x = -halfW + 3; x < halfW - 2; x += 5) rect(cx + x, bottom - h + 2, 1, h - 3, '#5c3400');
  rect(cx - halfW, bottom - h, 2, h, '#b07434');
  rect(cx + halfW - 2, bottom - h, 2, h, '#5c3400');
  if (top) {
    fillEllipseAt(cx, bottom - h, halfW, 4, '#e0b878');
    fillEllipseAt(cx, bottom - h, Math.round(halfW * 0.6), 2, '#c89858');
    rect(cx - 1, bottom - h, 2, 1, '#a07038');
  }
}

function drawSplitScene(L, t, dt) {
  const st = game.stateTime;
  // Берег сбоку, как у костра: озеро вдали, поляна
  ctx.clearRect(0, 0, W, H);
  drawFarShore();
  drawWater(t);
  markWater();
  rect(0, SHORE_Y - 2, W, 3, C.sand);
  rect(0, SHORE_Y + 1, W, H - SHORE_Y, C.grassDark);
  rect(0, SHORE_Y + 1, W, 3, C.grass);
  for (const [x, y] of SHORE_TUFTS) { px(x, y, C.grassTuft); px(x - 1, y + 1, C.grassTuft); px(x + 1, y + 1, C.grassTuft); }

  // Поленница слева: по две половинки с каждого расколотого полена
  const done = wood.split * 2 - (wood.halves.length && st - wood.halves[0].t < 0.6 ? 2 : 0);
  for (let i = 0; i < done; i++) {
    const x = 18 + (i % 4) * 15, y = 168 - Math.floor(i / 4) * 7;
    rect(x, y, 14, 6, '#8c5418');
    rect(x, y, 14, 1, '#b07434');
    rect(x + 11, y, 3, 6, '#e0b878');
  }

  // Пенёк: кора, срез с кольцами
  rect(STUMP_X - 34, STUMP_Y, 68, H - STUMP_Y, '#5c3400');
  for (let x = -30; x < 32; x += 6) rect(STUMP_X + x, STUMP_Y + 4, 2, H - STUMP_Y - 4, '#3c2000');
  for (let o = -38; o < 40; o += 9) rect(STUMP_X + o, H - 4, 6, 4, '#5c3400');   // корни
  fillEllipseAt(STUMP_X, STUMP_Y, 34, 6, '#c89858');
  fillEllipseAt(STUMP_X, STUMP_Y, 24, 4, '#b08048');
  fillEllipseAt(STUMP_X, STUMP_Y, 12, 2, '#c89858');

  // Полено падает на пенёк сверху; после удачного удара - разлетается на две половинки
  const sw = st - wood.axeT;
  const showBlock = wood.split < WOOD.chunks && st >= wood.blockT;
  if (showBlock) {
    const k = Math.min(1, (st - wood.blockT) / 0.25);
    drawBlock(STUMP_X, STUMP_Y - (1 - k) * 110, BLOCK_W, BLOCK_H, true);
  }
  for (const hf of wood.halves) {
    const k = (st - hf.t) / 0.6;
    if (k >= 1) continue;
    const x = STUMP_X + hf.side * (BLOCK_W / 2 + k * 70), y = STUMP_Y - Math.sin(Math.min(1, k * 1.4) * Math.PI) * 30 + k * k * 40;
    rect(x - BLOCK_W / 2, y - BLOCK_H, BLOCK_W, BLOCK_H, '#8c5418');
    rect(hf.side < 0 ? x + BLOCK_W / 2 - 3 : x - BLOCK_W / 2, y - BLOCK_H, 3, BLOCK_H, '#e0b878');   // свежий скол
  }
  for (const p of wood.chips) rect(p.x, p.y, 2, 2, '#e0b878');

  lightScene(L, t, { water: true, lift: 0.45 });
  drawSkyBehind(L, t, dt);

  // После освещения: зелёная зона по центру полена, маркер и топор над ним
  const topY = STUMP_Y - BLOCK_H;
  if (showBlock && st - wood.blockT > 0.25) {
    const tol = WOOD.splitTol;
    const inZone = Math.abs(wood.m * SPLIT_RANGE) <= tol;
    rect(STUMP_X - tol, topY - 3, tol * 2 + 1, 6, inZone && Math.floor(t * 8) % 2 ? '#ffffff' : C.good);
    rect(STUMP_X - tol - 1, topY - 6, 1, 12, '#ffffff');
    rect(STUMP_X + tol + 1, topY - 6, 1, 12, '#ffffff');
  }
  const swinging = sw < WOOD.axeTime;
  const mx = Math.round(swinging ? wood.axeX : STUMP_X + wood.m * SPLIT_RANGE);
  if (!swinging && wood.doneT < 0 && showBlock) {
    for (let y = topY - 26; y < topY - 4; y += 3) rect(mx, y, 1, 2, '#ffffff');   // куда упадёт топор
    rect(mx - 2, topY - 30, 5, 2, '#ffffff');
  }
  // Топор: висит над маркером, при ударе падает на полено (или на пенёк мимо него)
  const hitY = wood.axeHit === 'miss' || wood.axeHit === 'split' ? STUMP_Y + 2 : topY;   // расколол - топор проходит до пенька
  const drop = sw < 0.08 ? sw / 0.08 : sw < WOOD.axeTime ? 1 : 0;
  if (wood.doneT < 0 || swinging) drawAxeAt(mx, hitY, 1 - drop);

  drawBar(STUMP_X - 40, 17, 80, wood.split / WOOD.chunks, C.barFill);
}

function drawWoodScene(L, t, dt) {
  if (fire.phase === 'chop') drawChopScene(L, t, dt);
  else drawSplitScene(L, t, dt);
}
