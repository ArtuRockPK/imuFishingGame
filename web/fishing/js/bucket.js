'use strict';
// =====================================================================
//  ВЕДРО (мини-игра после каждого улова)
//
//  После фото рыбы - вид от первого лица сверху вниз (как в мини-игре с комаром):
//  на траве стоит ведро (видно круглое горлышко, вода и уже пойманные рыбы),
//  внизу ноги игрока, снизу тянется правая рука (та же, что в сцене с комаром),
//  рыба лежит на ладони. Рука плавно ездит из стороны в сторону, ведро каждый раз
//  стоит в новом месте.
//  LOW-G (резко опустить стик), когда рыба над ведром, - она падает в ведро и идёт
//  в улов (landFish). Промах - рыба падает на траву, прибегает кот и уносит её.
//  Если не отпустить рыбу за BUCKET.time секунд, рука устаёт и роняет её сама.
//  Состояние 'bucket' - в states.js, настройки BUCKET - в config.js.
// =====================================================================

const BUCKET_Y = 82;          // центр ведра на экране (вид сверху)
const BUCKET_R = 30;          // радиус горлышка
const PALM_DY = -26;          // насколько рука выше, чем в сцене с комаром
const FISH_Y = HAND.cy + PALM_DY - 2;   // где лежит рыба на ладони (по высоте)
const LAND_Y = 92;            // где лежит рыба, упавшая на траву

const bucket = {
  x: 160,                     // где стоит ведро (центр)
  handX: 160, handDir: 1,     // где рука (центр ладони) и куда едет
  phase: 'aim',               // 'aim' - целимся, 'drop' - рыба падает, 'in' - в ведре, 'miss' - на траве
  phaseT: 0,                  // когда началась фаза (game.stateTime)
  fishX: 0,                   // где отпустили рыбу
  hit: false,                 // попадёт ли в ведро
  catX: 0, catDir: 1,         // кот: где и куда смотрит
  catPhase: 'none',           // 'none', 'walk' - идёт к рыбе, 'grab' - схватил, 'run' - убегает
  catT: 0,
};

const DROP_TIME = 0.35;       // сколько падает рыба (уменьшается - удаляется от глаз)

function startBucket() {
  Object.assign(bucket, {
    x: rand(60, W - 60),
    handX: Math.random() < 0.5 ? 50 : W - 50,
    handDir: Math.random() < 0.5 ? 1 : -1,
    phase: 'aim', phaseT: 0, hit: false, catPhase: 'none',
  });
}

function setBucketPhase(p) {
  bucket.phase = p;
  bucket.phaseT = game.stateTime;
}

function updateBucket(dt, t) {
  const pt = t - bucket.phaseT;

  if (bucket.phase === 'aim') {
    // Рука ездит туда-сюда между краями
    bucket.handX += bucket.handDir * BUCKET.handSpeed * dt;
    if (bucket.handX < 40)     { bucket.handX = 40;     bucket.handDir = 1; }
    if (bucket.handX > W - 40) { bucket.handX = W - 40; bucket.handDir = -1; }
    if (t >= BUCKET.time) dropBucketFish();          // рука устала - роняет сама
    return;
  }

  if (bucket.phase === 'drop') {
    if (pt < DROP_TIME) return;
    if (bucket.hit) {
      game.bucketFish.push(game.fish);
      landFish();                                    // game.js: рыба идёт в улов
      sfx.splash();
      say(T('msg_bucket'), C.good, 12);
      setBucketPhase('in');
    } else {
      sfx.slap();
      // Кот прибегает с ближнего края
      bucket.catDir = bucket.fishX < W / 2 ? 1 : -1;
      bucket.catX = bucket.catDir > 0 ? -34 : W + 34;
      bucket.catPhase = 'walk';
      setBucketPhase('miss');
    }
    return;
  }

  if (bucket.phase === 'in') {
    if (pt >= 1.4) afterBucket(true);
    return;
  }

  // Промах: кот идёт к рыбе, хватает, убегает
  if (bucket.catPhase === 'walk') {
    bucket.catX += bucket.catDir * 110 * dt;
    if ((bucket.fishX - bucket.catX) * bucket.catDir <= 18) {
      bucket.catPhase = 'grab';
      bucket.catT = t;
      sfx.meow();
      say(T('msg_cat'), C.bad, 12);
    }
  } else if (bucket.catPhase === 'grab') {
    if (t - bucket.catT >= 0.5) { bucket.catPhase = 'run'; bucket.catDir = -bucket.catDir; }
  } else if (bucket.catPhase === 'run') {
    bucket.catX += bucket.catDir * 220 * dt;
    if (bucket.catX < -40 || bucket.catX > W + 40) afterBucket(false);
  }
}

// LOW-G: стряхнуть рыбу с ладони. Попадёт, если рыба над горлышком ведра
function dropBucketFish() {
  if (bucket.phase !== 'aim') return;
  bucket.fishX = bucket.handX;
  bucket.hit = Math.abs(bucket.handX - bucket.x) <= BUCKET.hitX;
  setBucketPhase('drop');
}

// ---------- Рисование ----------

// Закрашенный пиксельный эллипс
function fillEllipse(cx, cy, rx, ry, color) {
  for (let dy = -ry; dy <= ry; dy++) {
    const half = Math.round(rx * Math.sqrt(1 - (dy / ry) * (dy / ry)));
    rect(cx - half, cy + dy, half * 2, 1, color);
  }
}

// Пиксельная окружность (контур), толщина 1
function ringPx(cx, cy, r, color, from = 0, to = Math.PI * 2) {
  const n = Math.max(12, Math.round(r * 7));
  for (let i = 0; i <= n; i++) {
    const a = from + (to - from) * i / n;
    px(Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r), color);
  }
}

// Ведро сверху: тень, ободок, стенка внутри, вода с рыбами, дужка откинута набок
function drawBucket(t, st) {
  const x = Math.round(bucket.x), y = BUCKET_Y, r = BUCKET_R;
  fillEllipse(x + 3, y + 4, r + 1, r + 1, C.grassDark);                 // тень
  for (let i = 0; i < 2; i++) ringPx(x, y, r + 7 + i, '#3c3c3c', 0.15 * Math.PI, 0.85 * Math.PI);   // дужка
  fillEllipse(x, y, r + 1, r + 1, '#3c3c3c');                           // ободок
  fillEllipse(x, y, r, r, '#d8d8d8');
  fillEllipse(x, y, r - 3, r - 3, '#787878');                           // стенка внутри
  fillEllipse(x, y + 2, r - 5, r - 6, C.water2);                        // вода

  // Пойманные рыбы плавают в воде (последние 5), обрезаем по воде
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(x, y + 2, r - 5, r - 6, 0, 0, Math.PI * 2);
  ctx.clip();
  game.bucketFish.slice(-5).forEach((f, i) => {
    const a = t * 0.6 + i * 1.3;                                        // плавают по кругу
    drawFish(f, x + Math.cos(a) * 12, y + 2 + Math.sin(a) * 9, Math.sin(a) > 0, 1);
  });
  // Всплеск: круги по воде, когда рыба только что упала
  if (bucket.phase === 'in') {
    const k = st - bucket.phaseT;
    for (let i = 0; i < 2; i++) {
      const rr = 3 + (k - i * 0.15) * 30;
      if (rr > 3 && rr < r) ringPx(x, y + 2, rr, C.foam);
    }
  }
  ctx.restore();
}

// Размер рыбы на ладони зависит от редкости: обычная - BUCKET.fishScale,
// каждая следующая редкость в BUCKET.fishGrow раз крупнее
function bucketFishScale() {
  return BUCKET.fishScale * Math.pow(BUCKET.fishGrow, Math.max(0, RARITIES.indexOf(game.rarity)));
}

// Рыба любого (в том числе дробного) размера: спрайт рисуется в маленький холст и
// растягивается без сглаживания. Тёмный контур - та же рыба тёмной, сдвинутая на пиксель
const fishCanvasCache = {};
function fishCanvas(type, dark) {
  const key = type.name + (dark ? ':dark' : '');
  if (fishCanvasCache[key]) return fishCanvasCache[key];
  const c = document.createElement('canvas');
  c.width = FISH_SPRITE[0].length;
  c.height = FISH_SPRITE.length;
  const g = c.getContext('2d');
  const pal = { b: type.body, s: type.stripe, f: type.fin, k: '#000000' };
  FISH_SPRITE.forEach((row, y) => [...row].forEach((ch, x) => {
    if (ch === '.') return;
    g.fillStyle = dark ? '#202020' : pal[ch];
    g.fillRect(x, y, 1, 1);
  }));
  return (fishCanvasCache[key] = c);
}
function drawBigFish(type, cx, cy, scale) {
  const w = Math.round(FISH_SPRITE[0].length * scale), h = Math.round(FISH_SPRITE.length * scale);
  const x = Math.round(cx - w / 2), y = Math.round(cy - h / 2);
  ctx.imageSmoothingEnabled = false;
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) ctx.drawImage(fishCanvas(type, true), x + dx, y + dy, w, h);
  ctx.drawImage(fishCanvas(type, false), x, y, w, h);
}

// Ноги игрока внизу экрана: штанины и носки (как на фото, вид от первого лица)
function drawFeet() {
  for (const [x, y] of [[140, 166], [178, 168]]) {
    rect(x - 11, y + 4, 22, H - y, '#20202c');                 // штанина
    fillEllipse(x, y, 10, 9, '#3c3028');                        // носок
    fillEllipse(x, y - 2, 8, 6, '#54443a');
  }
}

function drawBucketScene(t, st) {
  // Трава под ногами (вид сверху), кустики травы
  rect(0, 0, W, H, C.grass);
  for (let i = 0; i < 60; i++) {
    const gx = (i * 53) % W, gy = (i * 37) % H;
    px(gx, gy, C.grassTuft); px(gx + 2, gy, C.grassTuft); px(gx + 1, gy + 1, C.grassDark);
  }

  drawBucket(t, st);

  drawFeet();

  const p = bucket.phase, pt = st - bucket.phaseT;
  const fs = bucketFishScale();

  // Падающая рыба: удаляется от глаз - становится меньше
  if (p === 'drop') {
    drawBigFish(game.fish, bucket.fishX, FISH_Y, fs * (1 - 0.5 * pt / DROP_TIME));
  }

  // Промах: рыба бьётся на траве, пока её не схватил кот
  if (p === 'miss' && bucket.catPhase === 'walk') {
    const flop = Math.floor(st * 5) % 2;
    drawFish(game.fish, bucket.fishX, LAND_Y - flop * 2, flop === 1, 3);
  }

  // Правая рука ладонью вверх (из mosquito.js). Рыбу стряхнули - рука уходит вниз
  const handOff = p === 'aim' ? 0 : Math.min(160, pt * 500);
  drawHand(true, Math.round(bucket.handX - HAND.cx), PALM_DY + handOff, true);

  // Рыба лежит на ладони и чуть шевелится
  if (p === 'aim') {
    const wiggle = Math.round(Math.sin(t * 6));
    drawBigFish(game.fish, bucket.handX, FISH_Y + wiggle, fs);
  }

  // Кот: идёт, хватает, убегает с рыбой в зубах
  if (p === 'miss' && bucket.catPhase !== 'none') {
    const frame = bucket.catPhase === 'grab' || Math.floor(st * 8) % 2 ? CAT_A : CAT_B;
    const cx = Math.round(bucket.catX), cy = LAND_Y - 14;
    sprite(frame, CAT_PAL, cx - 16, cy, frame.length, bucket.catDir < 0, 2);
    if (bucket.catPhase !== 'walk') drawFish(game.fish, cx + bucket.catDir * 18, cy + 9, bucket.catDir > 0);
  }
}
