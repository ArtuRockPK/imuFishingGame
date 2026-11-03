'use strict';
// =====================================================================
//  ВРЕМЯ СУТОК: часы, небо (солнце, луна, звёзды, облака), освещение сцены
//
//  Как рисуется кадр с учётом времени суток (draw.js):
//   1. сцена рисуется как днём, но небо остаётся прозрачным;
//   2. lightScene() перекрашивает её под время суток: на рассвете и закате теплее,
//      ночью темнее и синее; вода отражает небо, по ней бежит дорожка от солнца
//      или луны, вокруг фонаря рыбака светлее;
//   3. drawSkyBehind() подкладывает под сцену небо (рисуется в отдельном холсте).
//  Цвета неба по часам - SKY_KEYS ниже, длительность частей суток - DAYTIME в config.js.
//
//  События времени суток (на будущее):
//    onDayPart('night', () => ...)   - наступила ночь ('dawn', 'day', 'dusk', 'night')
//    atHour(6, () => ...)            - часы дошли до 6:00
//    dayPart() === 'night'           - что сейчас
// =====================================================================

const clock = { hour: DAYTIME.startHour, day: 0, part: null };

const inHours = (h, from, to) => from <= to ? h >= from && h < to : h >= from || h < to;
const partHours = (p) => (p.to - p.from + 24) % 24 || 24;
function dayPartAt(h) { return DAYTIME.parts.find(p => inHours(h, p.from, p.to)) || DAYTIME.parts[0]; }
function dayPart() { return dayPartAt(clock.hour).id; }

const dayPartHandlers = {}, hourHandlers = [];
function onDayPart(id, fn) { (dayPartHandlers[id] = dayPartHandlers[id] || []).push(fn); }
function atHour(h, fn) { hourHandlers.push({ h, fn }); }

// Каждый кадр игры (game.js): часы идут со скоростью своей части суток
function updateDaytime(dt) {
  const p = dayPartAt(clock.hour);
  advanceClock(dt * partHours(p) / p.sec);
  updateNatureLife(dt);
}

function advanceClock(hours) {
  const before = clock.hour;
  clock.hour += hours;
  if (clock.hour >= 24) { clock.hour -= 24; clock.day++; }
  for (const e of hourHandlers) {
    if (inHours(e.h, before, clock.hour)) e.fn();
  }
  const id = dayPart();
  if (id !== clock.part) {
    const first = clock.part === null;
    clock.part = id;
    if (!first) for (const fn of dayPartHandlers[id] || []) fn();
  }
}

// Часы для HUD: "05:12"
function clockText() {
  const m = Math.floor(clock.hour * 60);
  return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
}

// ---------- Цвета по часам ----------
// sky - небо сверху вниз: верх, середина, низ, у горизонта; cloud - облако (свет, тень);
// light - во сколько раз умножить красный, зелёный и синий сцены; water - насколько
// вода окрашивается в цвет неба у горизонта; stars - видимость звёзд (0..1)
const NIGHT_KEY = { sky: ['#040818', '#081030', '#102048', '#1c3060'], cloud: ['#34406c', '#1c2448'], light: [0.30, 0.36, 0.62], water: 0.4, stars: 1 };
const DAY_KEY   = { sky: [C.sky1, C.sky2, C.sky3, C.sky3], cloud: [C.cloud, C.cloudShade], light: [1, 1, 1], water: 0, stars: 0 };
const SKY_KEYS = [
  { h: 0, ...NIGHT_KEY },
  { h: 3.6, ...NIGHT_KEY },
  // Рассвет: сначала сиреневые сумерки, потом розовое и персиковое небо
  { h: 4.6,  sky: ['#0c1440', '#28306c', '#64407c', '#b8607c'], cloud: ['#6c5c8c', '#3c3460'], light: [0.42, 0.42, 0.64], water: 0.5,  stars: 0.6 },
  { h: 5.4,  sky: ['#1c3478', '#5c5ca0', '#d07888', '#f8a070'], cloud: ['#f8b0a0', '#9c5c7c'], light: [0.66, 0.55, 0.66], water: 0.55, stars: 0.15 },
  { h: 6.0,  sky: ['#2c4c98', '#7c80c0', '#f8a088', '#fcd088'], cloud: ['#fcd0b0', '#d07c80'], light: [0.88, 0.70, 0.66], water: 0.55, stars: 0 },
  { h: 6.8,  sky: ['#3c74d0', '#78a8e8', '#f8c8a8', '#fce4b8'], cloud: ['#fce8d8', '#d8b0b8'], light: [0.98, 0.90, 0.84], water: 0.3,  stars: 0 },
  { h: 7.8, ...DAY_KEY },
  { h: 17.4, ...DAY_KEY },
  // Закат: золотой час, потом оранжево-красный и малиновый, потом фиолетовые сумерки
  { h: 18.4, sky: ['#3c7cd0', '#80a8e0', '#f8d098', '#fcb860'], cloud: ['#fce0b0', '#e0a070'], light: [1.00, 0.88, 0.70], water: 0.3,  stars: 0 },
  { h: 19.3, sky: ['#384c98', '#9c6890', '#f88858', '#fcb840'], cloud: ['#fcb070', '#c04c4c'], light: [0.92, 0.62, 0.48], water: 0.55, stars: 0 },
  { h: 20.0, sky: ['#28306c', '#7c3c74', '#e85840', '#fc9830'], cloud: ['#f88c5c', '#882c4c'], light: [0.72, 0.46, 0.46], water: 0.6,  stars: 0.1 },
  { h: 20.7, sky: ['#141c4c', '#3c2868', '#88305c', '#d0503c'], cloud: ['#8c4c6c', '#4c2848'], light: [0.48, 0.38, 0.56], water: 0.55, stars: 0.4 },
  { h: 21.6, sky: ['#080c2c', '#141a48', '#2c2458', '#4c3060'], cloud: ['#3c3c6c', '#202448'], light: [0.34, 0.36, 0.60], water: 0.45, stars: 0.85 },
  { h: 24, ...NIGHT_KEY },
];
const hexRgb = (s) => { const n = parseInt(s.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
const rgbCss = (c) => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
const mixRgb = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
const clamp01 = (v) => Math.max(0, Math.min(1, v));
for (const k of SKY_KEYS) { k.sky = k.sky.map(hexRgb); k.cloud = k.cloud.map(hexRgb); }

const SUN_PATH = [64, 206];      // x восхода и заката
const MOON_PATH = [50, 220];

// Всё про свет в час h: цвета неба, освещение, положение солнца и луны
function lightAt(h) {
  let i = 0;
  while (i < SKY_KEYS.length - 2 && SKY_KEYS[i + 1].h <= h) i++;
  const a = SKY_KEYS[i], b = SKY_KEYS[i + 1];
  let u = (h - a.h) / (b.h - a.h);
  u = u * u * (3 - 2 * u);                       // плавно, без рывков на ключевых точках
  const L = {
    sky: a.sky.map((c, j) => mixRgb(c, b.sky[j], u)),
    cloud: a.cloud.map((c, j) => mixRgb(c, b.cloud[j], u)),
    light: mixRgb(a.light, b.light, u),
    water: a.water + (b.water - a.water) * u,
    stars: a.stars + (b.stars - a.stars) * u,
  };
  // Солнце: восходит слева, заходит правее центра - не под надписями в правом углу.
  // elev - высота (1 - в зените, меньше 0 - за горизонтом)
  const su = (h - DAYTIME.sunrise) / (DAYTIME.sunset - DAYTIME.sunrise);
  L.sun = { x: SUN_PATH[0] + su * (SUN_PATH[1] - SUN_PATH[0]), elev: Math.sin(Math.PI * Math.max(-0.5, Math.min(1.5, su))) };
  // Луна: от заката до рассвета, тоже слева направо
  const nightLen = 24 - (DAYTIME.sunset - DAYTIME.sunrise);
  const mu = ((h - DAYTIME.sunset + 24) % 24) / nightLen;
  L.moon = { x: MOON_PATH[0] + mu * (MOON_PATH[1] - MOON_PATH[0]), elev: mu <= 1.2 ? Math.sin(Math.PI * Math.min(1.5, mu)) : -1 };
  L.sun.y = HORIZON - 7 - L.sun.elev * 28;       // на горизонте диск наполовину над холмами
  L.moon.y = HORIZON - 3 - L.moon.elev * 30;
  // Фонарь рыбака: плавно разгорается и гаснет за полчаса
  const lampH = inHours(h, DAYTIME.lanternOn, DAYTIME.lanternOff);
  const sinceOn = (h - DAYTIME.lanternOn + 24) % 24, toOff = (DAYTIME.lanternOff - h + 24) % 24;
  L.lamp = lampH ? clamp01(Math.min(sinceOn, toOff) * 2) : 0;
  return L;
}

// Цвет неба на высоте y (0 - верх экрана, HORIZON - горизонт)
const SKY_STOPS = [0, 15, 30, HORIZON];
function skyColorAt(L, y) {
  let i = 0;
  while (i < 2 && y > SKY_STOPS[i + 1]) i++;
  return mixRgb(L.sky[i], L.sky[i + 1], clamp01((y - SKY_STOPS[i]) / (SKY_STOPS[i + 1] - SKY_STOPS[i])));
}

// Цвет солнца: днём почти белое, у горизонта оранжевое, садится красным
function sunColor(elev) {
  if (elev > 0.5) return hexRgb('#fcfcd8');
  if (elev > 0.2) return mixRgb(hexRgb('#fcd070'), hexRgb('#fcfcd8'), (elev - 0.2) / 0.3);
  if (elev > 0) return mixRgb(hexRgb('#fc8830'), hexRgb('#fcd070'), elev / 0.2);
  return hexRgb('#f85020');
}

// ---------- Небо (свой холст, подкладывается под сцену) ----------
const skyCanvas = document.createElement('canvas');
skyCanvas.width = W; skyCanvas.height = HORIZON;
const sctx = skyCanvas.getContext('2d');
function sfill(x, y, w, h, c) { sctx.fillStyle = typeof c === 'string' ? c : rgbCss(c); sctx.fillRect(Math.round(x), Math.round(y), w, h); }

// Звёзды: x в "небесных" координатах (небо поворачивается вместе с луной), яркость, мерцание
const stars = [];
(function makeStars() {
  let seed = 11;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 80; i++) {
    stars.push({ x: rnd() * W, y: Math.floor(Math.pow(rnd(), 1.4) * (HORIZON - 6)),
                 big: rnd() < 0.08, bright: 0.4 + rnd() * 0.6, phase: rnd() * 7, speed: 1 + rnd() * 3 });
  }
})();

let meteor = null;   // падающая звезда

// Диск радиуса r построчно; color(x, y) - цвет точки или null (пропустить)
function disc(cx, cy, r, color) {
  cx = Math.round(cx); cy = Math.round(cy);
  for (let dy = -r; dy <= r; dy++) {
    const half = Math.round(Math.sqrt(r * r - dy * dy + r * 0.8));
    for (let dx = -half; dx <= half; dx++) {
      const c = color(cx + dx, cy + dy, dx, dy);
      if (c) sfill(cx + dx, cy + dy, 1, 1, c);
    }
  }
}

// Ореол вокруг солнца или луны: несколько колец, у края - шахматкой (как на NES).
// sx - насколько ореол растянут в стороны (низкое солнце даёт широкую полосу у горизонта)
function glow(L, cx, cy, r, sx, color, strength) {
  const rings = [[r + 24, 0.2], [r + 14, 0.38], [r + 6, 0.6]];
  for (const [R, k0] of rings) {
    const k = k0 * strength;
    for (let y = Math.max(0, Math.round(cy - R)); y <= Math.min(HORIZON - 1, cy + R); y++) {
      const dy = y - cy, half = Math.round(Math.sqrt(Math.max(0, R * R - dy * dy)) * sx);
      if (half <= 0) continue;
      const c = rgbCss(mixRgb(skyColorAt(L, y), color, k));
      const edge = Math.max(1, Math.round(half * 0.15));
      sfill(cx - half + edge, y, (half - edge) * 2, 1, c);
      for (let x = -half; x < -half + edge; x++) if ((x + y) & 1) { sfill(cx + x, y, 1, 1, c); sfill(cx - x - 1, y, 1, 1, c); }
    }
  }
}

function drawSkyLayer(L, t, dt) {
  // Градиент полосами по 3 пикселя, на стыке полос - строка шахматкой
  for (let y = 0; y < HORIZON; y++) {
    const band = Math.floor(y / 3);
    const c = rgbCss(skyColorAt(L, band * 3 + 1));
    sfill(0, y, W, 1, c);
    if (y % 3 === 0 && band > 0) {
      const prev = rgbCss(skyColorAt(L, band * 3 - 2));
      sctx.fillStyle = prev;
      for (let x = y & 1; x < W; x += 2) sctx.fillRect(x, y, 1, 1);
    }
  }

  // Звёзды: медленно плывут вместе с небом, мерцают, у горизонта тускнеют
  if (L.stars > 0.01) {
    const shift = ((clock.hour - DAYTIME.sunset + 24) % 24) * 6;
    for (const s of stars) {
      const tw = 0.65 + 0.35 * Math.sin(t * s.speed + s.phase);
      const k = L.stars * s.bright * tw * clamp01((HORIZON - 4 - s.y) / 14);
      if (k < 0.12) continue;
      const x = Math.round((s.x + shift) % W), bg = skyColorAt(L, s.y);
      const c = rgbCss(mixRgb(bg, [252, 252, 236], k));
      sfill(x, s.y, 1, 1, c);
      if (s.big && k > 0.5) {
        const c2 = rgbCss(mixRgb(bg, [200, 216, 252], k * 0.5));
        sfill(x - 1, s.y, 1, 1, c2); sfill(x + 1, s.y, 1, 1, c2);
        sfill(x, s.y - 1, 1, 1, c2); sfill(x, s.y + 1, 1, 1, c2);
      }
    }
    // Падающая звезда: изредка, только глубокой ночью
    if (!meteor && L.stars > 0.8 && dt > 0 && Math.random() < dt / 25) {
      meteor = { x: rand(40, W - 40), y: rand(2, 14), vx: rand(90, 140) * (Math.random() < 0.5 ? -1 : 1), vy: rand(25, 45), age: 0, life: rand(0.5, 0.8) };
    }
  }
  if (meteor) {
    meteor.age += dt;
    if (meteor.age > meteor.life) meteor = null;
    else {
      const k = Math.sin(Math.PI * meteor.age / meteor.life);
      for (let i = 0; i < 10; i++) {
        const u = i / 10, x = meteor.x + meteor.vx * (meteor.age - u * 0.08), y = meteor.y + meteor.vy * (meteor.age - u * 0.08);
        if (y >= HORIZON - 2) continue;
        sfill(x, y, 1, 1, mixRgb(skyColorAt(L, y), [252, 252, 236], k * (1 - u)));
      }
    }
  }

  // Луна: каждую ночь новая фаза (полная -> серп -> снова полная)
  const moon = L.moon;
  if (moon.elev > -0.15) {
    const vis = 0.35 + 0.65 * L.stars;
    const nightNo = clock.hour >= 12 ? clock.day : clock.day - 1;
    const SHADOW = [null, 8, 5, 3, -3, -5, -8];             // сдвиг тени по x
    const sh = SHADOW[((nightNo % SHADOW.length) + SHADOW.length) % SHADOW.length];
    glow(L, moon.x, moon.y, 5, 1, [200, 208, 240], 0.45 * vis);
    const body = hexRgb('#fcf4d0'), crater = hexRgb('#d8cca0');
    const CRATERS = [[-2, -1], [1, 2], [2, -2], [-1, 2]];
    disc(moon.x, moon.y, 5, (x, y, dx, dy) => {
      if (y >= HORIZON) return null;
      const bg = skyColorAt(L, y);
      if (sh !== null && (dx - sh) ** 2 + dy * dy <= 30) return mixRgb(bg, body, 0.1 * vis);   // тёмная часть
      const lit = CRATERS.some(([cx, cy]) => cx === dx && cy === dy) ? crater : body;
      return mixRgb(bg, lit, vis);
    });
  }

  // Солнце с ореолом: у горизонта ореол ярче и шире - самые красивые минуты
  const sun = L.sun;
  if (sun.elev > -0.2) {
    const low = 1 - clamp01(sun.elev / 0.45);
    const col = sunColor(sun.elev);
    const r = low > 0.7 ? 7 : 6;                   // у горизонта солнце кажется больше
    glow(L, sun.x, sun.y, r, 1 + low * 2.4, col, 0.4 + low * 0.6);
    const core = mixRgb(col, [252, 252, 236], 0.55);
    disc(sun.x, sun.y, r, (x, y, dx, dy) => y < HORIZON ? (dx * dx + dy * dy < r * 2 ? core : col) : null);
  }

  // Облака: подсвечены снизу на рассвете и закате, тёмные ночью
  const pal = { w: rgbCss(L.cloud[0]), s: rgbCss(L.cloud[1]) };
  for (const c of clouds) {
    const x = Math.round(((c.x + t * c.speed) % (W + 40)) - 20);
    CLOUD.forEach((row, r) => [...row].forEach((ch, i) => { if (pal[ch]) sfill(x + i, c.y + r, 1, 1, pal[ch]); }));
  }
}

// Подложить небо под уже нарисованную сцену (там, где она прозрачная)
function drawSkyBehind(L, t, dt) {
  drawSkyLayer(L, t, dt);
  ctx.globalCompositeOperation = 'destination-over';
  ctx.drawImage(skyCanvas, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
}

// ---------- Свет на сцене ----------
// Чтобы отличать воду от рыбака и острова, сразу после drawWater() запоминаем кадр:
// пиксели, которые потом не поменялись, - это вода
let waterSnap = null;
function markWater() {
  waterSnap = ctx.getImageData(0, HORIZON, W, H - HORIZON).data;
}

const LANTERN = { x: ISLAND.cx + 22, y: ISLAND.cy - 13, r: 48 };

// Дорожка на воде от солнца (низкого) или луны
function reflectionOf(L) {
  const s = L.sun;
  if (s.elev > -0.04 && s.elev < 0.45) {
    const k = clamp01(1 - s.elev / 0.45) * clamp01((s.elev + 0.04) / 0.08);
    return { x: s.x, color: mixRgb(sunColor(s.elev), [252, 252, 220], 0.2), k, len: 70, width: 0.45 };
  }
  if (L.moon.elev > 0 && L.stars > 0.3) {
    return { x: L.moon.x, color: hexRgb('#d8e0f8'), k: 0.75 * L.stars * clamp01(L.moon.elev / 0.1), len: 80, width: 0.25 };
  }
  return null;
}

// Псевдослучайное число 0..1 для клетки (a, b, c) - всегда одно и то же
function hash(a, b, c) {
  const v = Math.sin(a * 12.9898 + b * 78.233 + c * 37.719) * 43758.5453;
  return v - Math.floor(v);
}

// Источники света у рыбака: фонарь вечером и ночью, костёр после ночного ивента (campfire.js).
// x, y - где, r - радиус, k - яркость 0..1, c - во сколько раз умножить красный/зелёный/синий
// в самой середине (больше 1 - ярче дневного)
function sceneLights(L, t) {
  const lights = [];
  if (L.lamp) lights.push({ x: LANTERN.x, y: LANTERN.y, r: LANTERN.r, k: L.lamp, c: [1.05, 0.86, 0.58] });
  if (game.campfireLit) lights.push(islandFireLight(t));
  return lights;
}

// Перекрасить сцену под время суток. opts:
//   water  - на сцене есть озеро: вода отражает небо, по ней бежит дорожка (сцена у озера)
//   lift   - насколько смягчить темноту, 0..1 (вблизи, в мини-играх, ночью должно быть видно руку)
//   lights - источники света (см. sceneLights)
function lightScene(L, t, { water: hasWater = false, lift: soften = 0, lights = [] } = {}) {
  let [mr, mg, mb] = L.light;
  mr += (1 - mr) * soften; mg += (1 - mg) * soften; mb += (1 - mb) * soften;
  const refl = hasWater ? reflectionOf(L) : null;
  const wt = hasWater ? L.water : 0;
  if (mr > 0.995 && mg > 0.995 && mb > 0.995 && !refl && !lights.length && wt < 0.01) return;   // день - как есть

  const img = ctx.getImageData(0, 0, W, H), d = img.data;
  // Лёгкий подъём тёмных цветов ночью, чтобы силуэты не терялись в черноте
  const lift = (1 - mb) * 14;
  for (let y = 0; y < H; y++) {
    const water = hasWater && y >= HORIZON && waterSnap;
    const depth = y - HORIZON;
    // Вода отражает небо как зеркало: вдали - цвет у горизонта, ближе - всё выше по небу
    const mirror = water ? skyColorAt(L, Math.max(0, HORIZON - 1 - depth * 0.45)) : null;
    // Дорожка: блики-чёрточки по 3 пикселя, каждая строка мерцает в своём ритме,
    // ширина растёт к берегу
    let rx = 0, half = 0, rk = 0, step = 0;
    if (water && refl && depth < refl.len) {
      rx = refl.x + Math.sin(y * 0.8 + t * 1.3);
      half = 1.5 + depth * refl.width;
      rk = refl.k * (1 - depth / refl.len) * (y % 2 ? 0.5 : 1);
      step = Math.floor(t * 4 + y * 0.7);
    }
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (!d[i + 3]) continue;                          // прозрачно - там будет небо
      let r = d[i], g = d[i + 1], b = d[i + 2];
      let kr = mr, kg = mg, kb = mb;
      for (const l of lights) {
        const dx = x - l.x, dy = (y - l.y) * 1.6, dd = dx * dx + dy * dy;
        if (dd >= l.r * l.r) continue;
        let f = 1 - Math.sqrt(dd) / l.r;
        f = Math.min(1, l.k * f * f * 1.4);
        kr += (l.c[0] - kr) * f; kg += (l.c[1] - kg) * f; kb += (l.c[2] - kb) * f;
      }
      r = r * kr + lift * 0.5; g = g * kg + lift * 0.6; b = b * kb + lift;
      if (water) {
        const j = i - HORIZON * W * 4;
        if (d[i] === waterSnap[j] && d[i + 1] === waterSnap[j + 1] && d[i + 2] === waterSnap[j + 2]) {
          const mw = wt * (0.6 + 0.4 * (d[i + 2] < 200));      // гребни волн отражают меньше
          r += (mirror[0] * 0.85 - r) * mw; g += (mirror[1] * 0.85 - g) * mw; b += (mirror[2] * 0.85 - b) * mw;
          if (rk > 0) {
            const k = 1 - Math.abs(x - rx) / half;
            if (k > 0 && hash(Math.floor((x - rx + 300) / 3), y, step) < k * 1.3 * rk) {
              const c = refl.color, a = 0.6 + 0.4 * k;
              r += (c[0] - r) * a; g += (c[1] - g) * a; b += (c[2] - b) * a;
            }
          }
        }
      }
      d[i] = r; d[i + 1] = g; d[i + 2] = b;
    }
  }
  ctx.putImageData(img, 0, 0);
}

// Фонарь у рыбака: днём просто стоит, вечером горит (огонёк рисуется после lightScene)
function drawLantern() {
  const { x, y } = LANTERN;
  rect(x, y - 1, 1, 9, '#503000');                 // палка
  rect(x - 2, y - 7, 5, 1, '#303030');             // крышка
  rect(x - 2, y - 6, 1, 5, '#303030'); rect(x + 2, y - 6, 1, 5, '#303030');
  rect(x - 1, y - 6, 3, 5, '#7c7c7c');             // стекло
  rect(x - 2, y - 1, 5, 1, '#303030');
}
function drawLanternFlame(L, t) {
  if (!L.lamp) return;
  const { x, y } = LANTERN;
  const fl = Math.sin(t * 13) + Math.sin(t * 7.3) > 0.6;
  rect(x - 1, y - 6, 3, 5, mixColor('#7c7c7c', '#fcb000', L.lamp));
  rect(x, y - (fl ? 5 : 4), 1, fl ? 3 : 2, mixColor('#7c7c7c', '#fcfca8', L.lamp));
}

// ---------- Жизнь вокруг: светлячки ночью, рыба плещется на зорьке ----------
const fireflies = [];
for (let i = 0; i < 9; i++) {
  fireflies.push({ x: ISLAND.cx + rand(-70, 70), y: rand(120, 165), ph: rand(0, 7), sp: rand(0.3, 0.8), blink: rand(1.2, 2.5) });
}
function drawFireflies(L, t) {
  const k = clamp01((L.stars - 0.5) * 2);
  if (k <= 0) return;
  for (const f of fireflies) {
    const x = Math.round(f.x + Math.sin(t * f.sp + f.ph) * 14);
    const y = Math.round(f.y + Math.sin(t * f.sp * 1.3 + f.ph * 2) * 6);
    const on = Math.sin(t * f.blink + f.ph);
    if (on < 0.2) continue;
    ctx.globalAlpha = k * Math.min(1, (on - 0.2) * 2.5);
    ctx.globalAlpha *= 0.35;
    rect(x - 1, y, 3, 1, '#a8f040'); rect(x, y - 1, 1, 3, '#a8f040');
    ctx.globalAlpha = k * Math.min(1, (on - 0.2) * 2.5);
    px(x, y, '#e8fc98');
  }
  ctx.globalAlpha = 1;
}

// Рыба играет: на зорьке (рассвет и закат) часто, днём изредка, ночью почти никогда
function updateNatureLife(dt) {
  const part = dayPart();
  const every = part === 'dawn' || part === 'dusk' ? 7 : part === 'day' ? 30 : 60;
  if (Math.random() >= dt / every) return;
  const x = rand(AIM.xMin + 10, AIM.xMax - 10), y = rand(AIM.yFar, AIM.yNear - 10);
  if (Math.hypot(x - game.floatX, y - game.floatY) < 30) return;   // не путать с поклёвкой
  if (['bucket', 'mosquito', 'campfire'].includes(game.state)) return;
  addRipple(x, y, 1);
  addSplash(x, y, 4);
  ambiencePlop((x / W) * 2 - 1);
}
