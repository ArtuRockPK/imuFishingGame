'use strict';
// =====================================================================
//  НОЧНОЙ КОСТЁР (ивент, который бывает только ночью)
//
//  Когда наступает ночь (daytime.js, onDayPart('night')), после текущей попытки
//  камера показывает кострище на берегу острова: камни, шалаш из поленьев, тлеют угли.
//   1. kindle - дуть в стик (микрофон, событие BLOW): каждый выдох раздувает огонь,
//      пока дуешь - пламя вспыхивает. Нужно CAMPFIRE.blowsMin..blowsMax выдохов.
//   2. lit    - костёр разгорелся, освещает всё вокруг.
//   3. cook   - над огнём рыба на вертеле: крутить стик кистью, как катушку (REEL),
//      CAMPFIRE.cookMin..cookMax секунд - рыба поворачивается и румянится.
//   4. eat    - рыбак ест: рыба исчезает по кусочку, остаётся скелет.
//   5. done   - назад к рыбалке. Костёр так и горит рядом с рыбаком до утра (CAMPFIRE.outHour).
//  Тройной тап на шаге 1 - зажечь костёр сразу (если микрофон не работает).
//  Состояние 'campfire' - в states.js, настройки CAMPFIRE - в config.js.
// =====================================================================

const Z = 2;                          // крупность костра: во сколько раз ближе камера (1 - далеко)
const FIRE_X = 160, FIRE_Y = 150;     // центр кострища в сцене
const SPIT_Y = FIRE_Y - 76;           // высота вертела (языки пламени лижут рыбу)
const SPIT_S = 6;                     // увеличение рыбы на вертеле
const SHORE_Y = 60;                   // где кончается вода и начинается берег
const ISLAND_FIRE = { x: ISLAND.cx - 19, y: ISLAND.cy - 3 };   // костёр у рыбака после ивента

const fire = {
  phase: 'kindle',            // 'kindle' - раздуваем, 'lit' - разгорелся, 'cook' - вертел, 'eat' - едим, 'done'
  phaseT: 0,                  // когда началась фаза (game.stateTime)
  blows: 0, need: 0,          // сколько раз подули / сколько нужно
  level: 0,                   // сила огня 0..1 (плавно догоняет цель)
  flare: 0,                   // вспышка от выдоха 0..1
  blowing: false,             // сейчас дуют (BLOW пришёл, конец выдоха ещё нет)
  cook: 0, cookNeed: 0,       // сколько секунд крутили вертел / сколько нужно
  spin: 0,                    // угол поворота вертела
  reelSpeed: 0, reelAt: 0,    // скорость вращения стика, об/с, и когда пришла
  sizzleAt: 0,
  bites: 0,                   // сколько раз откусили (0..4)
  fish: null,                 // какая рыба на вертеле (последняя пойманная)
  sparks: [], smoke: [], crumbs: [],
};

function setFirePhase(p) {
  fire.phase = p;
  fire.phaseT = game.stateTime;
}

// Наступила ночь: если игрок как раз выбирает место - сразу к костру, иначе после попытки
onDayPart('night', () => {
  if (game.campfireLit || ['wait', 'gameover', 'win'].includes(game.state)) return;
  if (game.state === 'aimX') setState('campfire');
  else game.campfirePending = true;
});

// Утром костёр у рыбака гаснет и ещё немного дымит
atHour(CAMPFIRE.outHour, () => {
  if (!game.campfireLit) return;
  game.campfireLit = false;
  game.campfireOutAt = now;
});

function startCampfire() {
  Object.assign(fire, {
    blows: 0, need: randInt(CAMPFIRE.blowsMin, CAMPFIRE.blowsMax),
    level: 0, flare: 0, blowing: false,
    cook: 0, cookNeed: rand(CAMPFIRE.cookMin, CAMPFIRE.cookMax), spin: 0,
    reelSpeed: 0, reelAt: 0, sizzleAt: 0, bites: 0,
    fish: game.fish || FISH_TYPES[0],
    sparks: [], smoke: [], crumbs: [],
  });
  setFirePhase('kindle');
  say(T('msg_night'), C.accent);
  setMic(true);                 // controller.js: стик включает микрофон
}

function stopCampfire() {
  setMic(false);
  setReel(false);
  fire.blowing = false;
}

function campfireEvent(id, code) {
  if (id === EV.BLOW) {
    if (!code) { fire.blowing = false; return; }
    if (fire.blowing || fire.phase !== 'kindle') return;
    fire.blowing = true;
    fire.blows++;
    fire.flare = 1;
    sfx.blow();
    addSparks(6 + Math.round(10 * fire.level));
    if (fire.blows >= fire.need) igniteFire();
  } else if (id === EV.REEL) {
    fire.reelSpeed = code / 10;
    fire.reelAt = game.stateTime;
  } else if (id === EV.TAP3 && fire.phase === 'kindle') {
    igniteFire();                 // запасной путь, если микрофон не работает
  }
}

function igniteFire() {
  setMic(false);
  fire.blowing = false;
  fire.flare = 1;
  setFirePhase('lit');
  sfx.ignite();
  say(T('msg_fire_lit'), C.accent);
  addSparks(40);
}

function addSparks(n) {
  for (let i = 0; i < n; i++) {
    fire.sparks.push({ x: FIRE_X + rand(-14, 14) * Z * (0.4 + fire.level), y: FIRE_Y - rand(4, 20) * Z * (0.3 + fire.level),
                       vx: rand(-15, 15) * Z, vy: -rand(25, 70) * Z * (0.6 + fire.level), age: 0, life: rand(0.5, 1.4) });
  }
}

// Частицы: искры летят вверх, дым поднимается и расплывается, крошки падают
function updateParticles(list, dt, gravity) {
  for (let i = list.length - 1; i >= 0; i--) {
    const p = list[i];
    p.age += dt;
    if (p.age >= p.life) { list.splice(i, 1); continue; }
    p.vy += gravity * dt;
    p.x += p.vx * dt + Math.sin(p.age * 6 + i) * 6 * dt;
    p.y += p.vy * dt;
  }
}

function updateCampfire(dt, t) {
  const pt = t - fire.phaseT;

  // Сила огня: пока раздуваем - по числу выдохов, потом в полную силу
  const target = fire.phase === 'kindle' ? 0.75 * fire.blows / fire.need : 1;
  fire.level += (target - fire.level) * Math.min(1, dt * 1.5);
  fire.flare = fire.blowing ? Math.max(fire.flare, 0.7) : Math.max(0, fire.flare - dt * 1.5);

  if (Math.random() < dt * (fire.level * 10 + fire.flare * 20)) addSparks(1);
  // Дым: слабый огонь сильно дымит, разгоревшийся - чуть-чуть
  if (Math.random() < dt * (fire.level < 0.7 ? 6 : 1.5)) {
    fire.smoke.push({ x: FIRE_X + rand(-6, 6) * Z, y: FIRE_Y - (6 + fire.level * 20) * Z, vx: rand(4, 12) * Z, vy: -rand(10, 18) * Z,
                      r: rand(3, 5) * Z, age: 0, life: rand(2.5, 4) });
  }
  updateParticles(fire.sparks, dt, 15);
  updateParticles(fire.smoke, dt, 0);
  updateParticles(fire.crumbs, dt, 160);

  if (fire.phase === 'lit' && pt >= CAMPFIRE.litTime) {
    setFirePhase('cook');
    fire.reelAt = t;
    setReel(true);              // стик включает гироскоп, как при вываживании
  } else if (fire.phase === 'cook') {
    // Скорость не приходила полсекунды (пакеты потерялись) - считаем, что не крутят
    if (inputMode === 'ble' && t - fire.reelAt > 0.5) fire.reelSpeed = 0;
    if (fire.reelSpeed >= FISH.reelMinSpeed) {
      fire.cook += dt;
      fire.spin += fire.reelSpeed * Math.PI * 2 * dt * 0.5;
      if (t >= fire.sizzleAt) {          // шкворчит
        noiseHit(0.15, { vol: 0.05, type: 'highpass', freq: rand(3000, 5000) });
        fire.sizzleAt = t + rand(0.08, 0.2);
      }
    }
    if (fire.cook >= fire.cookNeed) {
      setReel(false);
      fire.reelSpeed = 0;
      fire.spin = 0;
      sfx.pickup();
      say(T('msg_cooked'), C.good);
      setFirePhase('eat');
    }
  } else if (fire.phase === 'eat') {
    // Четыре укуса по ходу CAMPFIRE.eatTime, крошки летят на землю
    const bites = Math.max(0, Math.min(4, Math.floor((pt - 0.6) / ((CAMPFIRE.eatTime - 0.8) / 4)) + 1));
    while (fire.bites < bites) {
      fire.bites++;
      sfx.crunch();
      const bx = FIRE_X - 6 * SPIT_S + fire.bites * 3 * SPIT_S;
      for (let i = 0; i < 6; i++) fire.crumbs.push({ x: bx, y: SPIT_Y, vx: rand(-30, 30), vy: -rand(10, 50), age: 0, life: 0.8 });
    }
    if (pt >= CAMPFIRE.eatTime) {
      sfx.yum();
      say(T('msg_yummy'), C.accent);
      setFirePhase('done');
    }
  } else if (fire.phase === 'done' && pt >= 2) {
    game.campfireLit = true;    // костёр остаётся у рыбака до утра
    finishCast();               // game.js: обратно к рыбалке
  }
}

// ---------- Рисование ----------
function fillEllipseAt(cx, cy, rx, ry, color) {
  for (let y = -ry; y <= ry; y++) {
    const half = Math.round(rx * Math.sqrt(1 - (y / ry) ** 2));
    rect(cx - half, cy + y, half * 2, 1, color);
  }
}

// Пламя из квадратиков s x s: столбики разной высоты дрожат, в середине жарче (светлее)
function drawFlames(cx, baseY, h, halfW, t, s) {
  if (h < s) return;
  const cols = Math.max(1, Math.round(halfW / s));
  for (let i = -cols; i <= cols; i++) {
    const u = i / (cols + 0.5);
    const flick = 0.72 + 0.18 * Math.sin(t * 9 + i * 1.7) + 0.1 * Math.sin(t * 23 + i * 3.1);
    const n = Math.floor(h * Math.pow(1 - u * u, 0.8) * flick / s);
    for (let j = 0; j < n; j++) {
      const heat = (1 - j / n) * (1 - Math.abs(u) * 0.6);
      const c = heat > 0.75 ? '#fcfcd8' : heat > 0.52 ? '#fce040' : heat > 0.28 ? '#fc9800' : '#e84000';
      rect(cx + i * s - s / 2, baseY - (j + 1) * s, s, s, c);
    }
    if (n > 1 && Math.sin(t * 13 + i * 2.3) > 0.8) rect(cx + i * s - s / 2, baseY - (n + 2) * s, s, s, '#e84000');   // язычок
  }
}

// Угли под костром: тлеют, при выдохе разгораются
const EMBERS = [[-14, 1], [-9, -2], [-5, 3], [-1, -1], [3, 2], [7, -2], [11, 1], [15, 3], [-11, 4], [0, 4], [9, 4], [-3, -3], [5, -4]];
function drawEmbers(t, glow) {
  for (const [dx, dy] of EMBERS) {
    const k = Math.min(1, glow * (0.7 + 0.3 * Math.sin(t * 5 + dx * 3 + dy)));
    rect(FIRE_X + dx * Z, FIRE_Y + dy * Z, 3 * Z, 2 * Z, mixColor('#3c1000', '#fc8000', k));
  }
}

// Поленья шалашом: от камней к верхушке
const LOGS = [[-26, 5], [24, 6], [-14, -5], [15, -4], [2, 8]];
function drawLogs(front) {
  const top = { x: FIRE_X, y: FIRE_Y - 30 * Z };
  for (const [dx, dy] of LOGS) {
    if ((dy > 0) !== front) continue;
    const bx = FIRE_X + dx * Z, by = FIRE_Y + dy * Z, tx = top.x + Math.sign(dx) * 2 * Z;
    for (let o = -2; o <= 2; o++) line(bx + o, by, tx + o, top.y, '#5c3400');
    line(bx - 1, by, tx - 1, top.y, '#9c6020');
    line(bx, by, tx, top.y, '#9c6020');
  }
}

// Камни вокруг кострища: задние рисуются до поленьев, передние - после
function drawStones(front) {
  for (let i = 0; i < 16; i++) {
    const a = i / 16 * Math.PI * 2;
    if ((Math.sin(a) > 0) !== front) continue;
    const x = FIRE_X + Math.cos(a) * 40 * Z - 3 * Z, y = FIRE_Y + Math.sin(a) * 12 * Z - 2 * Z;
    rect(x, y, 7 * Z, 4 * Z, '#8c8c8c');
    rect(x + Z, y, 5 * Z, Z, '#bcbcbc');
    rect(x, y + 3 * Z, 7 * Z, Z, '#5c5c5c');
  }
}

// Рыба, которая готовится: цвета плавно уходят в золотисто-коричневый
const cookedCache = {};
function cookedFishCanvas(type, k) {
  const key = type.name + ':' + Math.round(k * 10);
  if (cookedCache[key]) return cookedCache[key];
  const c = document.createElement('canvas');
  c.width = FISH_SPRITE[0].length;
  c.height = FISH_SPRITE.length;
  const g = c.getContext('2d');
  const q = Math.round(k * 10) / 10 * 0.85;
  const pal = { b: mixColor(type.body, '#c07828', q), s: mixColor(type.stripe, '#6c3810', q),
                f: mixColor(type.fin, '#5c3010', q), k: '#000000' };
  FISH_SPRITE.forEach((row, y) => [...row].forEach((ch, x) => {
    if (ch === '.') return;
    g.fillStyle = pal[ch];
    g.fillRect(x, y, 1, 1);
  }));
  return (cookedCache[key] = c);
}

// Скелет: виден там, где рыбу уже откусили
function drawBones() {
  const k = SPIT_S / 4;                                             // скелет под размер рыбы
  const x0 = FIRE_X - 22 * k, x1 = FIRE_X + 18 * k;
  rect(x0, SPIT_Y - k, x1 - x0, 2 * k, '#e8e8e8');                 // хребет
  for (let x = x0 + 6 * k; x < x1 - 4 * k; x += 6 * k) {
    rect(x, SPIT_Y - 7 * k, k, 6 * k, '#d8d8d8');                   // рёбра
    rect(x, SPIT_Y + k, k, 5 * k, '#d8d8d8');
  }
  fillEllipseAt(x0 - 2 * k, SPIT_Y, Math.round(4 * k), Math.round(4 * k), '#e8e8e8');   // голова
  rect(x0 - 4 * k, SPIT_Y - 2 * k, 2 * k, 2 * k, '#303030');
  for (let i = 0; i < 6 * k; i++) rect(x1 + i, SPIT_Y - i, 1, i * 2 + 1, '#d8d8d8');   // хвост
}

function drawSpit(t, st) {
  const pt = st - fire.phaseT;
  // Рогатины по бокам и вертел. На правом конце - ручка, она крутится вместе с рыбой
  for (const sx of [FIRE_X - 100, FIRE_X + 100]) {
    rect(sx - 2, SPIT_Y + 3, 4, FIRE_Y - SPIT_Y + 8, '#5c3400');
    for (let o = -1; o <= 1; o++) {
      line(sx + o, SPIT_Y + 5, sx - 7 + o, SPIT_Y - 7, '#5c3400');
      line(sx + o, SPIT_Y + 5, sx + 7 + o, SPIT_Y - 7, '#5c3400');
    }
  }
  const drop = fire.phase === 'cook' ? Math.max(0, 1 - pt / 0.4) * 90 : 0;   // рыба опускается на рогатины
  const y = SPIT_Y - drop;
  rect(FIRE_X - 112, y - 1, 224, 3, '#c8a060');
  const hx = FIRE_X + 112, hy = Math.round(Math.cos(fire.spin) * 10);
  rect(hx, Math.min(y, y + hy), 3, Math.abs(hy) + 1, '#c8a060');
  rect(hx - 2, y + hy - 2, 7, 5, '#7c4800');

  if (fire.phase === 'eat' || fire.phase === 'done') drawBones();
  const fw = FISH_SPRITE[0].length, fh = FISH_SPRITE.length;
  const cut = fire.phase === 'eat' || fire.phase === 'done' ? Math.min(fw, fire.bites * 3) : 0;
  if (cut >= fw) return;
  const src = cookedFishCanvas(fire.fish, fire.cook / fire.cookNeed);
  // Поворот на вертеле: рыба сплющивается по высоте и переворачивается
  const c = Math.cos(fire.spin);
  const h = Math.max(2, Math.round(fh * SPIT_S * Math.abs(c)));
  ctx.imageSmoothingEnabled = false;
  ctx.save();
  ctx.translate(FIRE_X, Math.round(y));
  if (c < 0) ctx.scale(1, -1);
  ctx.drawImage(src, cut, 0, fw - cut, fh, Math.round(-fw * SPIT_S / 2 + cut * SPIT_S), -Math.round(h / 2), (fw - cut) * SPIT_S, h);
  ctx.restore();
}

// Свет костра: чем сильнее огонь, тем дальше освещает
function campfireLight(t) {
  const lv = Math.min(1, Math.max(0.12, fire.level) + fire.flare * 0.3);
  const flick = 0.9 + 0.1 * Math.sin(t * 11) * Math.sin(t * 7.7);
  return { x: FIRE_X, y: FIRE_Y - 12 * Z, r: (30 + 95 * lv) * (1 + Z) / 2, k: (0.4 + 0.8 * lv) * flick, c: [1.25, 0.88, 0.55] };
}

const SHORE_TUFTS = [];
(function makeTufts() {
  let seed = 5;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 40; i++) SHORE_TUFTS.push([Math.floor(rnd() * W), SHORE_Y + 6 + Math.floor(rnd() * (H - SHORE_Y - 8))]);
})();

function drawCampfireScene(L, t, dt, st) {
  // Тот берег, озеро и наш берег. Озеро запоминаем как воду - в нём отражается небо и луна
  ctx.clearRect(0, 0, W, H);
  drawFarShore();
  drawWater(t);
  markWater();
  rect(0, SHORE_Y - 2, W, 3, C.sand);
  rect(0, SHORE_Y + 1, W, H - SHORE_Y, C.grassDark);
  rect(0, SHORE_Y + 1, W, 3, C.grass);
  for (const [x, y] of SHORE_TUFTS) {
    px(x, y, C.grassTuft); px(x - 1, y + 1, C.grassTuft); px(x + 1, y + 1, C.grassTuft);
  }

  // Кострище: зола, камни, поленья, вертел с рыбой, дым
  fillEllipseAt(FIRE_X, FIRE_Y, 36 * Z, 10 * Z, '#3c2c1c');
  drawStones(false);
  drawLogs(false);
  drawLogs(true);
  drawStones(true);
  if (fire.phase !== 'kindle' && fire.phase !== 'lit') drawSpit(t, st);
  for (const p of fire.crumbs) rect(p.x, p.y, Z + 1, Z + 1, '#c07828');
  for (const p of fire.smoke) {
    const k = p.age / p.life;
    ctx.globalAlpha = 0.35 * (1 - k);
    fillEllipseAt(p.x, p.y, Math.round(p.r * (1 + k * 2)), Math.round(p.r * (1 + k * 2) * 0.7), '#a0a0a0');
  }
  ctx.globalAlpha = 1;

  // Ночь вокруг, костёр освещает поляну. Потом небо и всё, что светится само
  lightScene(L, t, { water: true, lights: [campfireLight(t)] });
  drawSkyBehind(L, t, dt);
  drawEmbers(t, Math.max(0.35, fire.level, fire.flare));
  const strength = Math.min(1.2, fire.level * 0.9 + fire.flare * 0.35);
  drawFlames(FIRE_X, FIRE_Y + 2 * Z, 42 * Z * strength, (6 + 22 * fire.level) * Z, t, 3);
  for (const p of fire.sparks) {
    const k = p.age / p.life;
    rect(p.x, p.y, k < 0.5 ? 3 : 2, k < 0.5 ? 3 : 2, k < 0.3 ? '#fce040' : k < 0.7 ? '#fc9800' : '#c83000');
  }
  // Пар от рыбы, пока крутим вертел
  if (fire.phase === 'cook' && fire.reelSpeed >= FISH.reelMinSpeed) {
    ctx.globalAlpha = 0.5;
    for (let i = 0; i < 4; i++) {
      const u = (t * 0.8 + i / 4) % 1;
      rect(FIRE_X - 27 + i * 18 + Math.sin(t * 3 + i) * 3, SPIT_Y - 20 - u * 26, 2, 2, '#fcfcfc');
    }
    ctx.globalAlpha = 1;
  }

  // Шкалы: сколько ещё дуть / сколько ещё крутить
  if (fire.phase === 'kindle') drawBar(FIRE_X - 40, 17, 80, fire.blows / fire.need, C.accent);
  if (fire.phase === 'cook') drawBar(FIRE_X - 40, 17, 80, fire.cook / fire.cookNeed, C.barFill);
}

// ---------- Костёр у рыбака (после ивента, до утра) ----------
function islandFireLight(t) {
  return { x: ISLAND_FIRE.x, y: ISLAND_FIRE.y - 4, r: 64, k: 0.85 + 0.15 * Math.sin(t * 11) * Math.sin(t * 7.7), c: [1.15, 0.82, 0.5] };
}

// Камни и поленья (до освещения, их освещает сам костёр)
function drawIslandFire() {
  const smoking = now - game.campfireOutAt < 20;
  if (!game.campfireLit && !smoking) return;
  const { x, y } = ISLAND_FIRE;
  for (let i = 0; i < 7; i++) {
    const a = i / 7 * Math.PI * 2;
    rect(x + Math.cos(a) * 6 - 1, y + Math.sin(a) * 2, 2, 2, '#8c8c8c');
  }
  line(x - 4, y + 1, x, y - 4, '#5c3400');
  line(x + 4, y + 1, x, y - 4, '#5c3400');
}

// Огонь, искры, а утром - дымок от погасшего костра (после освещения)
function drawIslandFireFlame(t) {
  const { x, y } = ISLAND_FIRE;
  if (game.campfireLit) {
    drawFlames(x + 0.5, y + 1, 10, 4, t, 1);
    const u = (t * 0.7) % 1;
    if (Math.sin(t * 3) > 0) px(x + Math.sin(t * 5) * 3, y - 10 - u * 14, u < 0.5 ? '#fce040' : '#fc9800');
  } else if (now - game.campfireOutAt < 20) {
    ctx.globalAlpha = 0.5 * (1 - (now - game.campfireOutAt) / 20);
    for (let i = 0; i < 3; i++) {
      const u = (t * 0.4 + i / 3) % 1;
      rect(x + Math.sin(t + i * 2) * 2 + u * 6, y - 3 - u * 20, 2, 2, '#a0a0a0');
    }
    ctx.globalAlpha = 1;
  }
}
